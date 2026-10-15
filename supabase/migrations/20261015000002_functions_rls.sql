-- Authorization helpers + Row Level Security.
-- Helpers are SECURITY DEFINER so policies on one table can read others without recursion.

create or replace function public.level_rank(l public.perm_level) returns int
language sql immutable set search_path = '' as $$
  select case l when 'view' then 1 when 'comment' then 2 when 'edit' then 3 when 'manage' then 4 else 0 end
$$;

create or replace function public.org_role_of(p_org uuid) returns public.org_role
language sql stable security definer set search_path = '' as $$
  select role from public.organization_memberships where org_id = p_org and user_id = (select auth.uid())
$$;

create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organization_memberships where org_id = p_org and user_id = (select auth.uid()))
$$;

create or replace function public.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.org_role_of(p_org) = 'admin', false)
$$;

create or replace function public.is_org_manager(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.org_role_of(p_org) in ('admin', 'maintenance_manager'), false)
$$;

create or replace function public.can_write_org(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.org_role_of(p_org) in ('admin', 'maintenance_manager', 'technician'), false)
$$;

-- Effective permission on a schematic for the calling user (null = no access).
create or replace function public.schematic_level(p_schematic uuid) returns public.perm_level
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
  v_role public.org_role;
  v_best int;
begin
  select org_id into v_org from public.schematics where id = p_schematic;
  if v_org is null then return null; end if;
  v_role := public.org_role_of(v_org);
  if v_role is null then return null; end if;           -- cross-organization: no access
  if v_role in ('admin', 'maintenance_manager') then return 'manage'; end if;

  select max(public.level_rank(g.level)) into v_best
  from public.schematic_access_grants g
  where g.schematic_id = p_schematic
    and (
      g.user_id = (select auth.uid())
      or g.group_id in (select gm.group_id from public.group_memberships gm where gm.user_id = (select auth.uid()))
    );
  if v_best is null then return null; end if;
  if v_role = 'viewer' and v_best > 1 then v_best := 1; end if;  -- Viewer role is read-only
  return case v_best when 1 then 'view' when 2 then 'comment' when 3 then 'edit' else 'manage' end::public.perm_level;
end $$;

create or replace function public.has_schematic_level(p_schematic uuid, p_min public.perm_level) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.level_rank(public.schematic_level(p_schematic)) >= public.level_rank(p_min)
$$;

-- Machines are visible to managers, their creator, or anyone who can view one of their schematics.
create or replace function public.can_view_machine(p_machine uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.machines m
    where m.id = p_machine
      and (
        public.is_org_manager(m.org_id)
        or (m.created_by = (select auth.uid()) and public.is_org_member(m.org_id))
        or exists (
          select 1 from public.schematics s
          where s.machine_id = m.id and public.has_schematic_level(s.id, 'view')
        )
      )
  )
$$;

create or replace function public.annotation_schematic(p_annotation uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select schematic_id from public.annotations where id = p_annotation
$$;

-- Storage objects are named "<org_id>/<schematic_id>.pdf".
create or replace function public.storage_schematic_id(p_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return nullif(regexp_replace(split_part(p_name, '/', 2), '\.pdf$', ''), '')::uuid;
exception when others then
  return null;
end $$;

-- ───────────── RPCs ─────────────
create or replace function public.create_organization(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  insert into public.organizations (name, created_by) values (trim(p_name), auth.uid()) returning id into v_org;
  insert into public.organization_memberships (org_id, user_id, role) values (v_org, auth.uid(), 'admin');
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id)
  values (v_org, auth.uid(), 'organization.create', 'organization', v_org);
  return v_org;
end $$;

create or replace function public.add_member_by_email(p_org uuid, p_email text, p_role public.org_role) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_id uuid;
begin
  if not public.is_org_admin(p_org) then raise exception 'only organization admins can add members' using errcode = '42501'; end if;
  select id into v_user from public.profiles where lower(email) = lower(trim(p_email));
  if v_user is null then raise exception 'no registered user with that email' using errcode = 'P0002'; end if;
  insert into public.organization_memberships (org_id, user_id, role) values (p_org, v_user, p_role)
  on conflict (org_id, user_id) do update set role = excluded.role
  returning id into v_id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'member.upsert', 'user', v_user, jsonb_build_object('role', p_role));
  return v_id;
end $$;

-- Uploaders keep Manage on their own documents; default access is otherwise private.
create or replace function public.grant_uploader_manage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.schematic_access_grants (org_id, schematic_id, user_id, level, granted_by)
  select new.org_id, new.id, new.uploaded_by, 'manage', new.uploaded_by
  where exists (select 1 from public.organization_memberships where org_id = new.org_id and user_id = new.uploaded_by)
  on conflict do nothing;
  return new;
end $$;
create trigger schematics_uploader_grant after insert on public.schematics
  for each row execute function public.grant_uploader_manage();
revoke all on function public.grant_uploader_manage() from public, anon, authenticated;

revoke all on function public.create_organization(text), public.add_member_by_email(uuid, text, public.org_role) from public, anon;
grant execute on function public.create_organization(text), public.add_member_by_email(uuid, text, public.org_role) to authenticated;
revoke all on function public.org_role_of(uuid), public.is_org_member(uuid), public.is_org_admin(uuid), public.is_org_manager(uuid),
  public.can_write_org(uuid), public.schematic_level(uuid), public.has_schematic_level(uuid, public.perm_level),
  public.can_view_machine(uuid), public.annotation_schematic(uuid) from public, anon;
grant execute on function public.org_role_of(uuid), public.is_org_member(uuid), public.is_org_admin(uuid), public.is_org_manager(uuid),
  public.can_write_org(uuid), public.schematic_level(uuid), public.has_schematic_level(uuid, public.perm_level),
  public.can_view_machine(uuid), public.annotation_schematic(uuid) to authenticated;

-- ───────────── Row Level Security ─────────────
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.groups enable row level security;
alter table public.group_memberships enable row level security;
alter table public.machines enable row level security;
alter table public.schematics enable row level security;
alter table public.schematic_access_grants enable row level security;
alter table public.annotations enable row level security;
alter table public.annotation_replies enable row level security;
alter table public.maintenance_issues enable row level security;
alter table public.maintenance_logs enable row level security;
alter table public.audit_events enable row level security;

-- organizations (creation goes through create_organization())
create policy org_select on public.organizations for select to authenticated using (public.is_org_member(id));
create policy org_update on public.organizations for update to authenticated
  using (public.is_org_admin(id)) with check (public.is_org_admin(id));

-- profiles: yourself, or people who share an organization with you
create policy profiles_select on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or exists (
    select 1 from public.organization_memberships a
    join public.organization_memberships b on a.org_id = b.org_id
    where a.user_id = (select auth.uid()) and b.user_id = profiles.id
  )
);
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- memberships: members see peers; only admins change roles / remove (adding is via RPC)
create policy memberships_select on public.organization_memberships for select to authenticated
  using (public.is_org_member(org_id));
create policy memberships_update on public.organization_memberships for update to authenticated
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy memberships_delete on public.organization_memberships for delete to authenticated
  using (public.is_org_admin(org_id) or user_id = (select auth.uid()));

-- groups
create policy groups_select on public.groups for select to authenticated using (public.is_org_member(org_id));
create policy groups_insert on public.groups for insert to authenticated with check (public.is_org_manager(org_id));
create policy groups_update on public.groups for update to authenticated
  using (public.is_org_manager(org_id)) with check (public.is_org_manager(org_id));
create policy groups_delete on public.groups for delete to authenticated using (public.is_org_manager(org_id));

create policy group_members_select on public.group_memberships for select to authenticated using (public.is_org_member(org_id));
create policy group_members_insert on public.group_memberships for insert to authenticated with check (public.is_org_manager(org_id));
create policy group_members_delete on public.group_memberships for delete to authenticated using (public.is_org_manager(org_id));

-- machines
create policy machines_select on public.machines for select to authenticated using (public.can_view_machine(id));
create policy machines_insert on public.machines for insert to authenticated
  with check (public.can_write_org(org_id) and created_by = (select auth.uid()));
create policy machines_update on public.machines for update to authenticated
  using (public.is_org_manager(org_id) or (created_by = (select auth.uid()) and public.can_write_org(org_id)))
  with check (public.is_org_manager(org_id) or (created_by = (select auth.uid()) and public.can_write_org(org_id)));
create policy machines_delete on public.machines for delete to authenticated using (public.is_org_manager(org_id));

-- schematics
create policy schematics_select on public.schematics for select to authenticated
  using (public.has_schematic_level(id, 'view'));
create policy schematics_insert on public.schematics for insert to authenticated
  with check (public.can_write_org(org_id) and uploaded_by = (select auth.uid()) and public.can_view_machine(machine_id));
create policy schematics_update on public.schematics for update to authenticated
  using (public.has_schematic_level(id, 'edit')) with check (public.has_schematic_level(id, 'edit'));
create policy schematics_delete on public.schematics for delete to authenticated
  using (public.has_schematic_level(id, 'manage'));

-- access grants: only Manage (or admin roles) may change; grantees can see their own
create policy grants_select on public.schematic_access_grants for select to authenticated using (
  public.has_schematic_level(schematic_id, 'manage')
  or user_id = (select auth.uid())
  or group_id in (select gm.group_id from public.group_memberships gm where gm.user_id = (select auth.uid()))
);
create policy grants_insert on public.schematic_access_grants for insert to authenticated
  with check (public.has_schematic_level(schematic_id, 'manage'));
create policy grants_update on public.schematic_access_grants for update to authenticated
  using (public.has_schematic_level(schematic_id, 'manage')) with check (public.has_schematic_level(schematic_id, 'manage'));
create policy grants_delete on public.schematic_access_grants for delete to authenticated
  using (public.has_schematic_level(schematic_id, 'manage'));

-- annotations inherit access from their parent schematic
create policy annotations_select on public.annotations for select to authenticated
  using (public.has_schematic_level(schematic_id, 'view'));
create policy annotations_insert on public.annotations for insert to authenticated
  with check (author_id = (select auth.uid()) and public.has_schematic_level(schematic_id, 'comment'));
create policy annotations_update on public.annotations for update to authenticated
  using (
    public.has_schematic_level(schematic_id, 'edit')
    or (author_id = (select auth.uid()) and public.has_schematic_level(schematic_id, 'comment'))
  )
  with check (
    public.has_schematic_level(schematic_id, 'edit')
    or (author_id = (select auth.uid()) and public.has_schematic_level(schematic_id, 'comment'))
  );
create policy annotations_delete on public.annotations for delete to authenticated
  using (
    public.has_schematic_level(schematic_id, 'manage')
    or (author_id = (select auth.uid()) and public.has_schematic_level(schematic_id, 'comment'))
  );

create policy replies_select on public.annotation_replies for select to authenticated
  using (public.has_schematic_level(public.annotation_schematic(annotation_id), 'view'));
create policy replies_insert on public.annotation_replies for insert to authenticated
  with check (author_id = (select auth.uid()) and public.has_schematic_level(public.annotation_schematic(annotation_id), 'comment'));
create policy replies_update on public.annotation_replies for update to authenticated
  using (author_id = (select auth.uid()) and public.has_schematic_level(public.annotation_schematic(annotation_id), 'comment'))
  with check (author_id = (select auth.uid()));
create policy replies_delete on public.annotation_replies for delete to authenticated
  using (author_id = (select auth.uid()) or public.has_schematic_level(public.annotation_schematic(annotation_id), 'manage'));

-- maintenance issues & logs
create policy issues_select on public.maintenance_issues for select to authenticated using (public.can_view_machine(machine_id));
create policy issues_insert on public.maintenance_issues for insert to authenticated with check (
  reporter_id = (select auth.uid()) and public.can_write_org(org_id) and public.can_view_machine(machine_id)
  and (schematic_id is null or public.has_schematic_level(schematic_id, 'comment'))
);
create policy issues_update on public.maintenance_issues for update to authenticated
  using (public.is_org_manager(org_id) or reporter_id = (select auth.uid()) or assignee_id = (select auth.uid()))
  with check (public.is_org_manager(org_id) or reporter_id = (select auth.uid()) or assignee_id = (select auth.uid()));
create policy issues_delete on public.maintenance_issues for delete to authenticated using (public.is_org_manager(org_id));

create policy logs_select on public.maintenance_logs for select to authenticated using (public.can_view_machine(machine_id));
create policy logs_insert on public.maintenance_logs for insert to authenticated with check (
  performed_by = (select auth.uid()) and public.can_write_org(org_id) and public.can_view_machine(machine_id)
);
-- logs are append-only: no update/delete policies (history is preserved)

-- audit: managers read; any member appends their own events; never updated or deleted
create policy audit_select on public.audit_events for select to authenticated using (public.is_org_manager(org_id));
create policy audit_insert on public.audit_events for insert to authenticated
  with check (public.is_org_member(org_id) and actor_id = (select auth.uid()));
