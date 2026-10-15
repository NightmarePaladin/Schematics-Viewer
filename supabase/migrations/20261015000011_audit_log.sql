-- Tamper-resistant audit log.
--   * Every user-attributed change to the main tables is recorded by DATABASE TRIGGERS (cannot be skipped or forged by a client).
--   * Readable only by organization Admins (RLS).
--   * Append-only: no role except the database owner (Supabase `postgres` / `supabase_admin`) can UPDATE, DELETE or TRUNCATE it —
--     enforced by revoked privileges AND guard triggers, so even the service-role key cannot alter history.
-- Changes made with no signed-in user (service-role scripts, SQL editor) are not attributed to anyone and are not logged.

alter table public.audit_events add column actor_label text;  -- "Name (email)" snapshot, survives user deletion

update public.audit_events e
set actor_label = p.display_name || ' (' || p.email || ')'
from public.profiles p
where p.id = e.actor_id and e.actor_label is null;

-- ───────────── who can read / write ─────────────
drop policy audit_select on public.audit_events;
drop policy audit_insert on public.audit_events;
create policy audit_select on public.audit_events for select to authenticated using (public.is_org_admin(org_id));
-- (no INSERT/UPDATE/DELETE policies: clients can never write here)

revoke insert, update, delete, truncate on public.audit_events from anon, authenticated, service_role;
revoke select on public.audit_events from anon;

-- ───────────── append-only guard (defence in depth) ─────────────
create or replace function public.audit_events_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- only the database owner may correct or purge history
  if current_user in ('postgres', 'supabase_admin') then
    return coalesce(new, old);
  end if;
  raise exception 'audit_events is append-only; only the database owner can modify it' using errcode = '42501';
end $$;
create trigger audit_events_no_change before update or delete on public.audit_events
  for each row execute function public.audit_events_guard();
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function public.audit_events_guard();

-- ───────────── automatic recording ─────────────
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
    return case when tg_op = 'DELETE' then old else new end;  -- not a user action: nothing to attribute
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
      return new;  -- nothing meaningful changed
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
  -- the organization itself is being removed: nothing left to attach the event to
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.audit_row_change() from public, anon, authenticated;

create trigger audit_organizations after insert or update on public.organizations
  for each row execute function public.audit_row_change('organization', 'id');
create trigger audit_memberships after insert or update or delete on public.organization_memberships
  for each row execute function public.audit_row_change('membership');
create trigger audit_groups after insert or update or delete on public.groups
  for each row execute function public.audit_row_change('group');
create trigger audit_group_members after insert or delete on public.group_memberships
  for each row execute function public.audit_row_change('group_member');
create trigger audit_machines after insert or update or delete on public.machines
  for each row execute function public.audit_row_change('machine');
create trigger audit_locations after insert or update or delete on public.locations
  for each row execute function public.audit_row_change('location');
create trigger audit_schematics after insert or update or delete on public.schematics
  for each row execute function public.audit_row_change('schematic');
create trigger audit_grants after insert or update or delete on public.schematic_access_grants
  for each row execute function public.audit_row_change('grant');
create trigger audit_annotations after insert or update or delete on public.annotations
  for each row execute function public.audit_row_change('annotation');
create trigger audit_replies after insert or update or delete on public.annotation_replies
  for each row execute function public.audit_row_change('reply');
create trigger audit_issues after insert or update or delete on public.maintenance_issues
  for each row execute function public.audit_row_change('issue');
create trigger audit_logs after insert on public.maintenance_logs
  for each row execute function public.audit_row_change('log');

-- ───────────── reads that cannot be seen by triggers ─────────────
create or replace function public.log_schematic_view(p_schematic uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_title text; v_label text;
begin
  if auth.uid() is null or not public.has_schematic_level(p_schematic, 'view') then return; end if;
  select org_id, title into v_org, v_title from public.schematics where id = p_schematic;
  select p.display_name || ' (' || p.email || ')' into v_label from public.profiles p where p.id = auth.uid();
  insert into public.audit_events (org_id, actor_id, actor_label, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), v_label, 'schematic.viewed', 'schematic', p_schematic, jsonb_build_object('label', v_title));
end $$;
revoke all on function public.log_schematic_view(uuid) from public, anon;
grant execute on function public.log_schematic_view(uuid) to authenticated;

-- The two RPCs used to write their own events; the triggers above now cover those changes (avoids duplicates).
create or replace function public.create_organization(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  insert into public.organizations (name, created_by) values (trim(p_name), auth.uid()) returning id into v_org;
  insert into public.organization_memberships (org_id, user_id, role) values (v_org, auth.uid(), 'admin');
  return v_org;
end $$;

create or replace function public.add_member_by_email(p_org uuid, p_email text, p_role public.org_role) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_id uuid;
begin
  if not public.is_org_admin(p_org) then raise exception 'only organization admins can add members' using errcode = '42501'; end if;
  select id into v_user from public.profiles where lower(email) = lower(trim(p_email));
  if v_user is null then raise exception 'no registered user with that email' using errcode = 'P0002'; end if;
  if v_user = auth.uid() and p_role <> 'admin' then
    raise exception 'admins cannot lower their own role; ask another admin' using errcode = '42501';
  end if;
  insert into public.organization_memberships (org_id, user_id, role) values (p_org, v_user, p_role)
  on conflict (org_id, user_id) do update set role = excluded.role
  returning id into v_id;
  return v_id;
end $$;
