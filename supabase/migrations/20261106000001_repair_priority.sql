-- Priority of repair for maintenance issues. Separate from `severity` (how bad the fault is): priority says how soon it should be
-- fixed, so a minor fault on the line's bottleneck can still be urgent. Enum order is the sort order (low < normal < high < urgent).
create type public.repair_priority as enum ('low', 'normal', 'high', 'urgent');

alter table public.maintenance_issues add column repair_priority public.repair_priority not null default 'normal';

-- the dashboard and the issue list read open work highest priority first
create index maintenance_issues_priority_idx on public.maintenance_issues (org_id, repair_priority desc, created_at desc)
  where status <> 'resolved';
