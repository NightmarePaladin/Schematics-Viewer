-- Schematic links: an annotation can point at another schematic, so tapping a part on a system drawing can jump to the
-- drawing of that part. Rule: the target schematic must belong to a DESCENDANT machine (sub-system / component) of the
-- machine that owns the annotated schematic. The user also still needs View on the target (enforced by RLS on read).
alter table public.annotations add column linked_schematic_id uuid;

-- same organization; deleting the target schematic just removes the link
alter table public.annotations
  add constraint annotations_linked_schematic_fkey foreign key (linked_schematic_id, org_id)
  references public.schematics (id, org_id) on delete set null (linked_schematic_id);
create index annotations_linked_schematic_idx on public.annotations (linked_schematic_id) where linked_schematic_id is not null;

-- SECURITY DEFINER so the walk sees the whole tree regardless of RLS; the caller's own access is checked separately.
create or replace function public.check_annotation_link() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_src uuid; v_dst uuid;
begin
  if new.linked_schematic_id is null then return new; end if;
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
  -- the person creating the link must be able to see the target
  if auth.uid() is not null and not public.has_schematic_level(new.linked_schematic_id, 'view') then
    raise exception 'schematic not found' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.check_annotation_link() from public, anon, authenticated;

create trigger annotations_check_link before insert or update of linked_schematic_id on public.annotations
  for each row execute function public.check_annotation_link();
