-- Audit entries for access changes now record WHO the change was about and WHAT it applied to, as a permanent snapshot.
-- (Names can change or be deleted later; the log must still say who lost access to which drawing.)
--   grant        -> grantee (person or group name), grantee_kind, schematic title
--   membership   -> member (name + email) and role
--   group_member -> member and group name
-- Existing entries are left untouched; the admin page resolves their names from the ids at display time.

create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_entity text := tg_argv[0];
  v_org_col text := coalesce(tg_argv[1], 'org_id');
  v_row jsonb;
  v_org uuid;
  v_id uuid;
  v_label text;
  v_meta jsonb;
  v_diff jsonb;
  v_actor_label text;
begin
  if v_actor is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_row := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_org := nullif(v_row ->> v_org_col, '')::uuid;
  v_id := nullif(v_row ->> 'id', '')::uuid;
  v_label := left(coalesce(v_row ->> 'name', v_row ->> 'title', v_row ->> 'serial_number', v_row ->> 'body', v_row ->> 'role', ''), 120);

  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'label', nullif(v_label, ''),
    'machine_id', v_row -> 'machine_id',
    'schematic_id', v_row -> 'schematic_id',
    'annotation_id', v_row -> 'annotation_id',
    'page_number', v_row -> 'page_number',
    'user_id', v_row -> 'user_id',
    'group_id', v_row -> 'group_id',
    'role', v_row -> 'role',
    'level', v_row -> 'level',
    'severity', v_row -> 'severity',
    'status', v_row -> 'status',
    'entry_type', v_row -> 'entry_type'
  ));

  -- who/what the change was about, as a snapshot
  if v_entity = 'grant' then
    v_meta := v_meta || jsonb_strip_nulls(jsonb_build_object(
      'grantee_kind', case when v_row ->> 'group_id' is not null then 'group' else 'person' end,
      'grantee', coalesce(
        (select g.name from public.groups g where g.id = nullif(v_row ->> 'group_id', '')::uuid),
        (select p.display_name || ' (' || p.email || ')' from public.profiles p where p.id = nullif(v_row ->> 'user_id', '')::uuid)
      ),
      'schematic', (select s.title from public.schematics s where s.id = nullif(v_row ->> 'schematic_id', '')::uuid)
    ));
  elsif v_entity in ('membership', 'group_member') then
    v_meta := v_meta || jsonb_strip_nulls(jsonb_build_object(
      'member', (select p.display_name || ' (' || p.email || ')' from public.profiles p where p.id = nullif(v_row ->> 'user_id', '')::uuid),
      'group', (select g.name from public.groups g where g.id = nullif(v_row ->> 'group_id', '')::uuid)
    ));
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(
             n.key,
             jsonb_build_object('from', left(coalesce(o.value #>> '{}', 'null'), 200), 'to', left(coalesce(n.value #>> '{}', 'null'), 200))
           )
      into v_diff
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o on o.key = n.key
     where n.value is distinct from o.value and n.key not in ('updated_at', 'resolved_at');
    if v_diff is null then
      return new;
    end if;
    v_meta := v_meta || jsonb_build_object('changes', v_diff);
  end if;

  select p.display_name || ' (' || p.email || ')' into v_actor_label from public.profiles p where p.id = v_actor;

  insert into public.audit_events (org_id, actor_id, actor_label, action, entity_type, entity_id, metadata)
  values (
    v_org, v_actor, v_actor_label,
    v_entity || '.' || case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,
    v_entity, v_id, v_meta
  );
  return case when tg_op = 'DELETE' then old else new end;
exception when foreign_key_violation then
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.audit_row_change() from public, anon, authenticated;
