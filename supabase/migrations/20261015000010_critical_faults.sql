-- A machine with its OWN unresolved critical-severity issue is in "critical fault". Like the inherited state it is derived, never stored,
-- so it clears the moment the issue is resolved. (Inherited state: inoperable_machines(), migration 8.)
create or replace function public.critical_fault_machines(p_org uuid)
returns table (machine_id uuid, issue_count int)
language sql stable security definer set search_path = '' as $$
  select i.machine_id, count(*)::int
  from public.maintenance_issues i
  where i.org_id = p_org
    and i.status <> 'resolved'
    and i.severity = 'critical'
    and public.is_org_member(p_org)
  group by i.machine_id
$$;
revoke all on function public.critical_fault_machines(uuid) from public, anon;
grant execute on function public.critical_fault_machines(uuid) to authenticated;
