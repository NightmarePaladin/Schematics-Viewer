-- Critical components: if a machine marked is_critical has an unresolved MAJOR issue (severity high or critical),
-- its parent system/machine is treated as inoperable. The state is DERIVED (never stored), so it clears automatically
-- when the issue is resolved. It propagates upward only through machines that are themselves marked critical.
alter table public.machines add column is_critical boolean not null default false;

create or replace function public.inoperable_machines(p_org uuid)
returns table (machine_id uuid, source_id uuid, source_name text)
language sql stable security definer set search_path = '' as $$
  with recursive major as (
    select distinct i.machine_id
    from public.maintenance_issues i
    where i.org_id = p_org and i.status <> 'resolved' and i.severity in ('high', 'critical')
  ),
  chain as (
    select m.parent_id as machine_id, m.id as source_id, 1 as depth
    from public.machines m join major on major.machine_id = m.id
    where m.org_id = p_org and m.is_critical and m.parent_id is not null
    union all
    select p.parent_id, c.source_id, c.depth + 1
    from chain c join public.machines p on p.id = c.machine_id
    where p.is_critical and p.parent_id is not null and c.depth < 25
  )
  select distinct c.machine_id, c.source_id,
         case when public.can_view_machine(c.source_id) then s.name else null end as source_name
  from chain c join public.machines s on s.id = c.source_id
  where public.is_org_member(p_org)
$$;
revoke all on function public.inoperable_machines(uuid) from public, anon;
grant execute on function public.inoperable_machines(uuid) to authenticated;
