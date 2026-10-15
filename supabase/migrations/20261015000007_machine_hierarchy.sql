-- Machines can be a sub-part of a system or another machine (tree: system -> sub-system -> component).
alter table public.machines add column parent_id uuid;

-- composite FK keeps parent and child in the same organization; deleting a parent un-links children rather than deleting them
alter table public.machines
  add constraint machines_parent_fk foreign key (parent_id, org_id)
  references public.machines (id, org_id) on delete set null (parent_id);
alter table public.machines add constraint machines_not_own_parent check (parent_id is null or parent_id <> id);
create index machines_parent_idx on public.machines (parent_id, org_id);

-- No cycles (A under B under A) and a sane depth. SECURITY DEFINER so the walk sees every ancestor regardless of RLS.
create or replace function public.check_machine_hierarchy() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_depth int;
begin
  if new.parent_id is null then return new; end if;
  with recursive up as (
    select m.id, m.parent_id, 1 as depth from public.machines m where m.id = new.parent_id
    union all
    select m.id, m.parent_id, up.depth + 1 from public.machines m join up on m.id = up.parent_id where up.depth < 25
  )
  select max(depth) into v_depth from up;
  if exists (
    with recursive up as (
      select m.id, m.parent_id, 1 as depth from public.machines m where m.id = new.parent_id
      union all
      select m.id, m.parent_id, up.depth + 1 from public.machines m join up on m.id = up.parent_id where up.depth < 25
    )
    select 1 from up where id = new.id
  ) then
    raise exception 'a machine cannot be placed under itself or one of its own sub-parts' using errcode = 'P0001';
  end if;
  if coalesce(v_depth, 0) >= 10 then
    raise exception 'machine hierarchy is limited to 10 levels' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.check_machine_hierarchy() from public, anon, authenticated;

create trigger machines_check_hierarchy before insert or update of parent_id on public.machines
  for each row execute function public.check_machine_hierarchy();
