-- Role-based tool limits and expiring share links. Requires 20261105000002-4.

-- ───────────── tool limits ─────────────
-- organizations.tool_limits = { "<tool|export|share>": "<minimum org role>" } (overrides only; see src/lib/tool-limits.ts)
alter table public.organizations add column tool_limits jsonb not null default '{}'::jsonb
  check (jsonb_typeof(tool_limits) = 'object');

create or replace function public.role_rank(p_role public.org_role) returns int
language sql immutable set search_path = '' as $$
  select case p_role when 'viewer' then 1 when 'technician' then 2 when 'maintenance_manager' then 3 when 'admin' then 4 else 0 end
$$;

-- May the CURRENT user (auth.uid()) use this tool / action in this organization?
create or replace function public.tool_allowed(p_org uuid, p_key text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.org_role; v_min public.org_role; v_raw text;
begin
  select m.role into v_role from public.organization_memberships m where m.org_id = p_org and m.user_id = (select auth.uid());
  if v_role is null then return false; end if;
  select o.tool_limits ->> p_key into v_raw from public.organizations o where o.id = p_org;
  begin
    v_min := v_raw::public.org_role;
  exception when others then
    v_min := null;
  end;
  if v_min is null then
    v_min := case p_key when 'share' then 'maintenance_manager' when 'export' then 'viewer' else 'technician' end;
  end if;
  return public.role_rank(v_role) >= public.role_rank(v_min);
end $$;
revoke all on function public.tool_allowed(uuid, text) from public, anon;
grant execute on function public.tool_allowed(uuid, text) to authenticated;

-- Annotation creation is gated by the organization's limits (service-role / seed scripts have no auth.uid() and are not affected).
create or replace function public.enforce_tool_limits() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not public.tool_allowed(new.org_id, new.type::text) then
    raise exception 'your role cannot use the % tool in this organization', new.type using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger annotations_enforce_tool_limits before insert on public.annotations
  for each row execute function public.enforce_tool_limits();

-- ───────────── share links ─────────────
-- A share is a SNAPSHOT: the browser builds a PDF (optionally with the notes burned in), uploads it to a private bucket and
-- mints an expiring signed URL. Revoking deletes the file, which kills the link.
create table public.schematic_shares (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  schematic_id uuid not null,
  storage_path text not null unique,
  label text not null default '' check (char_length(label) <= 120),
  include_notes boolean not null default true,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  foreign key (schematic_id, org_id) references public.schematics (id, org_id) on delete cascade,
  check (expires_at > created_at and expires_at <= created_at + interval '31 days')
);
create index schematic_shares_schematic_idx on public.schematic_shares (schematic_id, created_at desc);
create index schematic_shares_created_by_idx on public.schematic_shares (created_by);
alter table public.schematic_shares enable row level security;

create policy shares_select on public.schematic_shares for select to authenticated
  using (created_by = (select auth.uid()) or public.has_schematic_level(schematic_id, 'manage'));
create policy shares_insert on public.schematic_shares for insert to authenticated
  with check (created_by = (select auth.uid()) and public.has_schematic_level(schematic_id, 'view') and public.tool_allowed(org_id, 'share'));
create policy shares_update on public.schematic_shares for update to authenticated
  using (created_by = (select auth.uid()) or public.has_schematic_level(schematic_id, 'manage'))
  with check (created_by = (select auth.uid()) or public.has_schematic_level(schematic_id, 'manage'));
create policy shares_delete on public.schematic_shares for delete to authenticated
  using (created_by = (select auth.uid()) or public.has_schematic_level(schematic_id, 'manage'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('schematic-shares', 'schematic-shares', false, 52428800, array['application/pdf'])
on conflict (id) do update set public = false;

-- objects are "<org_id>/<schematic_id>/<uuid>.pdf" (the schematic id is the 2nd path part, like storage_schematic_id expects)
create policy share_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'schematic-shares'
    and public.has_schematic_level(public.storage_schematic_id(name), 'view')
    and exists (
      select 1 from public.schematics s
      where s.id = public.storage_schematic_id(name) and s.org_id::text = split_part(name, '/', 1) and public.tool_allowed(s.org_id, 'share')
    )
  );
-- reading (needed to sign URLs) and deleting (revoking): the creator, or anyone with Manage on the drawing
create policy share_files_select on storage.objects for select to authenticated
  using (
    bucket_id = 'schematic-shares'
    and exists (
      select 1 from public.schematic_shares sh
      where sh.storage_path = name and (sh.created_by = (select auth.uid()) or public.has_schematic_level(sh.schematic_id, 'manage'))
    )
  );
create policy share_files_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'schematic-shares'
    and (
      public.has_schematic_level(public.storage_schematic_id(name), 'manage')
      or exists (select 1 from public.schematic_shares sh where sh.storage_path = name and sh.created_by = (select auth.uid()))
    )
  );
