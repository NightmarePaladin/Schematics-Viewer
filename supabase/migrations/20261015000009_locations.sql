-- Locations: premade, reusable places (name + optional coordinates) that machines pick from a dropdown.
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  check ((latitude is null) = (longitude is null))
);
create unique index locations_org_name_key on public.locations (org_id, lower(name));
create index locations_created_by_idx on public.locations (created_by);
create trigger locations_updated before update on public.locations
  for each row execute function public.set_updated_at();

-- a machine references a location (same organization enforced by the composite FK); deleting a location un-links machines
alter table public.machines add column location_id uuid;
alter table public.machines
  add constraint machines_location_fk foreign key (location_id, org_id)
  references public.locations (id, org_id) on delete set null (location_id);
create index machines_location_idx on public.machines (location_id, org_id);

-- machines.location (text) stays as the display/search copy of the location name, so it can never drift from the location record
create or replace function public.sync_machine_location() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.location_id is not null then
    new.location := (select l.name from public.locations l where l.id = new.location_id and l.org_id = new.org_id);
  end if;
  return new;
end $$;
revoke all on function public.sync_machine_location() from public, anon, authenticated;
create trigger machines_sync_location before insert or update of location_id on public.machines
  for each row execute function public.sync_machine_location();

create or replace function public.propagate_location_rename() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name then
    update public.machines set location = new.name where location_id = new.id;
  end if;
  return new;
end $$;
revoke all on function public.propagate_location_rename() from public, anon, authenticated;
create trigger locations_propagate_rename after update of name on public.locations
  for each row execute function public.propagate_location_rename();

-- RLS: every member can read the shared list; writers can add; managers can edit and delete
alter table public.locations enable row level security;
create policy locations_select on public.locations for select to authenticated using (public.is_org_member(org_id));
create policy locations_insert on public.locations for insert to authenticated
  with check (public.can_write_org(org_id) and created_by = (select auth.uid()));
create policy locations_update on public.locations for update to authenticated
  using (public.is_org_manager(org_id)) with check (public.is_org_manager(org_id));
create policy locations_delete on public.locations for delete to authenticated using (public.is_org_manager(org_id));

-- One-time conversion of existing free-text machine locations into location records (coordinates taken from the first machine that has them)
insert into public.locations (org_id, name, latitude, longitude, created_by)
select m.org_id,
       min(btrim(m.location)),
       (array_agg(m.latitude order by m.created_at) filter (where m.latitude is not null))[1],
       (array_agg(m.longitude order by m.created_at) filter (where m.longitude is not null))[1],
       null
from public.machines m
where m.location is not null and btrim(m.location) <> ''
group by m.org_id, lower(btrim(m.location));

update public.machines m set location_id = l.id
from public.locations l
where l.org_id = m.org_id and lower(l.name) = lower(btrim(m.location)) and m.location_id is null;

-- machines that simply repeat their location's coordinates now inherit them instead of storing a copy
update public.machines m set latitude = null, longitude = null
from public.locations l
where l.id = m.location_id and m.latitude = l.latitude and m.longitude = l.longitude;
