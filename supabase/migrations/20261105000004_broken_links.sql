-- Broken links: when a sub-machine is moved out from under (or deleted from) the machine whose drawing links to it, the link is
-- invalidated and annotated ("Sub-machine X was removed from Y by NAME on DATE") instead of silently staying valid.
-- People with Edit can then replace the link with another part or remove it permanently.
-- Requires 20261105000003.
alter table public.annotations add column link_broken_at timestamptz;
alter table public.annotations add column link_broken_by uuid references public.profiles (id) on delete set null;
alter table public.annotations add column link_broken_note text;
create index annotations_link_broken_by_idx on public.annotations (link_broken_by) where link_broken_by is not null;

-- A link that passes validation is (again) a good link, so clear any earlier break. Otherwise identical to migration 3.
create or replace function public.check_annotation_link() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_src uuid; v_dst uuid;
begin
  if new.linked_schematic_id is null then
    new.linked_page := null;
    new.linked_annotation_id := null;
    return new;
  end if;
  select machine_id into v_src from public.schematics where id = new.schematic_id;
  select machine_id into v_dst from public.schematics where id = new.linked_schematic_id;
  if v_src is null or v_dst is null or v_src = v_dst then
    raise exception 'a link must point at a schematic of a sub-machine' using errcode = 'P0001';
  end if;
  if not exists (
    with recursive up as (
      select m.id, m.parent_id, 1 as depth from public.machines m where m.id = v_dst
      union all
      select m.id, m.parent_id, up.depth + 1 from public.machines m join up on m.id = up.parent_id where up.depth < 25
    )
    select 1 from up where id = v_src and id <> v_dst
  ) then
    raise exception 'you can only link to schematics of machines that are part of this one' using errcode = 'P0001';
  end if;
  if auth.uid() is not null and not public.has_schematic_level(new.linked_schematic_id, 'view') then
    raise exception 'schematic not found' using errcode = 'P0001';
  end if;
  if new.linked_annotation_id is not null then
    if not exists (select 1 from public.annotations a where a.id = new.linked_annotation_id and a.schematic_id = new.linked_schematic_id) then
      raise exception 'that annotation is not on the linked schematic' using errcode = 'P0001';
    end if;
  end if;
  new.link_broken_at := null;
  new.link_broken_by := null;
  new.link_broken_note := null;
  return new;
end $$;
revoke all on function public.check_annotation_link() from public, anon, authenticated;

-- Mark every link into p_machine's subtree that is no longer valid. A link is valid while the machine that owns the annotated
-- schematic is still a strict ancestor of the machine that owns the target. p_deleted: p_machine itself is going away, so links
-- straight to ITS schematics break even though the ancestor relationship still holds at that moment.
create or replace function public.break_links_for_machine(p_machine uuid, p_deleted boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_name text;
begin
  select display_name into v_name from public.profiles where id = v_actor;
  with recursive sub as (
    select m.id, 1 as depth from public.machines m where m.id = p_machine
    union all
    select m.id, sub.depth + 1 from public.machines m join sub on m.parent_id = sub.id where sub.depth < 25
  ),
  hit as (
    select a.id, a.author_id, a.schematic_id, a.page_number, tm.name as part_name, sm.name as parent_name, ss.title as source_title
    from public.annotations a
    join public.schematics ts on ts.id = a.linked_schematic_id
    join public.machines tm on tm.id = ts.machine_id
    join public.schematics ss on ss.id = a.schematic_id
    join public.machines sm on sm.id = ss.machine_id
    where a.link_broken_at is null
      and ts.machine_id in (select id from sub)
      and ((p_deleted and ts.machine_id = p_machine) or not exists (
        with recursive up as (
          select m.id, m.parent_id, 1 as depth from public.machines m where m.id = ts.machine_id
          union all
          select m.id, m.parent_id, up.depth + 1 from public.machines m join up on m.id = up.parent_id where up.depth < 25
        )
        select 1 from up where up.id = ss.machine_id and up.id <> ts.machine_id
      ))
  ),
  upd as (
    update public.annotations a
       set link_broken_at = now(),
           link_broken_by = v_actor,
           link_broken_note = 'Part / sub-machine "' || hit.part_name || '" '
             || case when p_deleted then 'was deleted' else 'was removed from "' || hit.parent_name || '"' end
             || ' by ' || coalesce(v_name, 'an administrator') || ' on ' || to_char(now(), 'YYYY-MM-DD')
      from hit
     where a.id = hit.id
    returning a.id, a.org_id, hit.author_id, hit.schematic_id, hit.page_number, hit.source_title, hit.part_name
  )
  insert into public.notifications (org_id, user_id, kind, message, href)
  select u.org_id, u.author_id, 'link_broken',
         'A link on "' || u.source_title || '" to "' || u.part_name || '" is no longer valid: replace or remove it',
         '/schematics/' || u.schematic_id || '?page=' || u.page_number || '&focus=' || u.id
    from upd u
   where u.author_id is distinct from v_actor;
end $$;
revoke all on function public.break_links_for_machine(uuid, boolean) from public, anon, authenticated;

create or replace function public.machines_break_links_on_move() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.break_links_for_machine(new.id, false);
  return new;
end $$;
revoke all on function public.machines_break_links_on_move() from public, anon, authenticated;
create trigger machines_links_after_move after update of parent_id on public.machines
  for each row when (old.parent_id is distinct from new.parent_id) execute function public.machines_break_links_on_move();

create or replace function public.machines_break_links_on_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.break_links_for_machine(old.id, true);
  return old;
end $$;
revoke all on function public.machines_break_links_on_delete() from public, anon, authenticated;
create trigger machines_links_before_delete before delete on public.machines
  for each row execute function public.machines_break_links_on_delete();
