-- SchematicHub core schema. See DATABASE.md for the access model.
create extension if not exists pgcrypto;

-- ───────────── enums ─────────────
create type public.org_role as enum ('admin', 'maintenance_manager', 'technician', 'viewer');
create type public.perm_level as enum ('view', 'comment', 'edit', 'manage');
create type public.machine_status as enum ('operational', 'degraded', 'down', 'maintenance', 'retired');
create type public.issue_status as enum ('open', 'in_progress', 'resolved');
create type public.severity as enum ('low', 'medium', 'high', 'critical');
create type public.annotation_type as enum ('point', 'comment', 'box', 'callout');
create type public.log_type as enum ('inspection', 'repair', 'calibration', 'note');

-- ───────────── helpers ─────────────
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ───────────── organizations / people ─────────────
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null,
  created_at timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.org_role not null default 'viewer',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index org_memberships_user_idx on public.organization_memberships (user_id);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, org_id)
);
create unique index groups_org_name_key on public.groups (org_id, lower(name));

create table public.group_memberships (
  group_id uuid not null,
  user_id uuid not null,
  org_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id),
  -- both FKs include org_id so a group can only contain members of its own organization
  foreign key (group_id, org_id) references public.groups (id, org_id) on delete cascade,
  foreign key (org_id, user_id) references public.organization_memberships (org_id, user_id) on delete cascade
);
create index group_memberships_user_idx on public.group_memberships (user_id);

-- ───────────── machines ─────────────
create table public.machines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  category text not null,
  manufacturer text not null,
  model_number text not null,
  serial_number text not null,
  asset_number text,
  description text,
  location text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  installed_on date,
  status public.machine_status not null default 'operational',
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  check ((latitude is null) = (longitude is null))
);
-- serial numbers are unique per organization + manufacturer, not globally
create unique index machines_serial_scope_key
  on public.machines (org_id, lower(manufacturer), lower(serial_number));
create index machines_org_idx on public.machines (org_id, name);
create trigger machines_updated before update on public.machines
  for each row execute function public.set_updated_at();

-- ───────────── schematics ─────────────
create table public.schematics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  machine_id uuid not null,
  title text not null,
  document_number text not null,
  revision text not null,
  storage_path text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 26214400),
  mime_type text not null default 'application/pdf' check (mime_type = 'application/pdf'),
  uploaded_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  unique (machine_id, document_number, revision),
  foreign key (machine_id, org_id) references public.machines (id, org_id) on delete cascade
);
create index schematics_machine_idx on public.schematics (machine_id);
create index schematics_org_idx on public.schematics (org_id, created_at desc);
create index schematics_uploader_idx on public.schematics (uploaded_by);
create trigger schematics_updated before update on public.schematics
  for each row execute function public.set_updated_at();

create table public.schematic_access_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  schematic_id uuid not null,
  user_id uuid,
  group_id uuid,
  level public.perm_level not null,
  granted_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((user_id is null) <> (group_id is null)),
  foreign key (schematic_id, org_id) references public.schematics (id, org_id) on delete cascade,
  foreign key (group_id, org_id) references public.groups (id, org_id) on delete cascade,
  foreign key (org_id, user_id) references public.organization_memberships (org_id, user_id) on delete cascade
);
create index grants_granted_by_idx on public.schematic_access_grants (granted_by);
create unique index grants_user_key on public.schematic_access_grants (schematic_id, user_id) where user_id is not null;
create unique index grants_group_key on public.schematic_access_grants (schematic_id, group_id) where group_id is not null;
create index grants_user_idx on public.schematic_access_grants (user_id) where user_id is not null;
create index grants_group_idx on public.schematic_access_grants (group_id) where group_id is not null;

-- ───────────── annotations ─────────────
-- Coordinates are normalized fractions (0..1) of the unrotated PDF page, origin top-left.
create table public.annotations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  schematic_id uuid not null,
  page_number int not null check (page_number >= 1),
  type public.annotation_type not null,
  x double precision not null check (x between 0 and 1),
  y double precision not null check (y between 0 and 1),
  width double precision check (width > 0 and width <= 1),
  height double precision check (height > 0 and height <= 1),
  body text not null default '',
  status public.issue_status,
  author_id uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (schematic_id, org_id) references public.schematics (id, org_id) on delete cascade,
  check ((type in ('box', 'callout')) = (width is not null and height is not null)),
  check ((width is null) = (height is null)),
  check (x + coalesce(width, 0) <= 1.000001 and y + coalesce(height, 0) <= 1.000001)
);
create index annotations_page_idx on public.annotations (schematic_id, page_number);
create index annotations_author_idx on public.annotations (author_id);
create trigger annotations_updated before update on public.annotations
  for each row execute function public.set_updated_at();

create table public.annotation_replies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  annotation_id uuid not null,
  body text not null check (char_length(body) between 1 and 4000),
  is_resolution_note boolean not null default false,
  author_id uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (annotation_id, org_id) references public.annotations (id, org_id) on delete cascade
);
create index replies_annotation_idx on public.annotation_replies (annotation_id, created_at);
create index replies_author_idx on public.annotation_replies (author_id);
create trigger replies_updated before update on public.annotation_replies
  for each row execute function public.set_updated_at();

-- ───────────── maintenance ─────────────
create table public.maintenance_issues (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  machine_id uuid not null,
  schematic_id uuid,
  annotation_id uuid unique,
  page_number int check (page_number >= 1),
  title text not null,
  description text not null default '',
  status public.issue_status not null default 'open',
  severity public.severity not null default 'medium',
  reporter_id uuid not null default auth.uid() references public.profiles (id),
  assignee_id uuid references public.profiles (id) on delete set null,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (machine_id, org_id) references public.machines (id, org_id) on delete cascade,
  foreign key (schematic_id, org_id) references public.schematics (id, org_id) on delete set null (schematic_id),
  foreign key (annotation_id, org_id) references public.annotations (id, org_id) on delete set null (annotation_id)
);
create index issues_machine_idx on public.maintenance_issues (machine_id, created_at desc);
create index issues_status_idx on public.maintenance_issues (org_id, status);
create index issues_assignee_idx on public.maintenance_issues (assignee_id) where assignee_id is not null;
create index issues_reporter_idx on public.maintenance_issues (reporter_id);
create index issues_schematic_idx on public.maintenance_issues (schematic_id) where schematic_id is not null;

create or replace function public.issue_resolved_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  if new.status = 'resolved' and (tg_op = 'INSERT' or old.status <> 'resolved') then
    new.resolved_at = now();
  elsif new.status <> 'resolved' then
    new.resolved_at = null;
  end if;
  return new;
end $$;
create trigger issues_stamp before insert or update on public.maintenance_issues
  for each row execute function public.issue_resolved_stamp();

create table public.maintenance_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  machine_id uuid not null,
  issue_id uuid,
  schematic_id uuid,
  annotation_id uuid,
  entry_type public.log_type not null default 'note',
  body text not null check (char_length(body) between 1 and 4000),
  performed_by uuid not null default auth.uid() references public.profiles (id),
  performed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (machine_id, org_id) references public.machines (id, org_id) on delete cascade,
  foreign key (issue_id, org_id) references public.maintenance_issues (id, org_id) on delete set null (issue_id),
  foreign key (schematic_id, org_id) references public.schematics (id, org_id) on delete set null (schematic_id),
  foreign key (annotation_id, org_id) references public.annotations (id, org_id) on delete set null (annotation_id)
);
create index logs_machine_idx on public.maintenance_logs (machine_id, performed_at desc);
create index logs_performer_idx on public.maintenance_logs (performed_by);

create table public.audit_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid default auth.uid() references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_org_idx on public.audit_events (org_id, created_at desc);
create index audit_actor_idx on public.audit_events (actor_id);

-- ───────────── new-user profile ─────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1))
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
revoke all on function public.handle_new_user() from public, anon, authenticated;
