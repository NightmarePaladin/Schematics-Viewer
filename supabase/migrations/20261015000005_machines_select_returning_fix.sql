-- INSERT ... RETURNING on machines failed with 42501: the old policy called can_view_machine(id), a STABLE function that
-- looks the machine up by id, and cannot see a row inserted by the same statement. Evaluate the row's own columns directly.
drop policy machines_select on public.machines;
create policy machines_select on public.machines for select to authenticated using (
  public.is_org_manager(org_id)
  or (created_by = (select auth.uid()) and public.is_org_member(org_id))
  or exists (
    select 1 from public.schematics s
    where s.machine_id = machines.id and public.has_schematic_level(s.id, 'view')
  )
);
