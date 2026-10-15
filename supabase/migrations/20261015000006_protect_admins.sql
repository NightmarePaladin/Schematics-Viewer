-- Bug: an Admin could lower their own role (via add_member_by_email with their own email, or a direct membership update),
-- and the last Admin could remove themselves, leaving an organization nobody can administer.

-- 1) Admins cannot change their own role; another Admin must do it.
create or replace function public.add_member_by_email(p_org uuid, p_email text, p_role public.org_role) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_id uuid;
begin
  if not public.is_org_admin(p_org) then raise exception 'only organization admins can add members' using errcode = '42501'; end if;
  select id into v_user from public.profiles where lower(email) = lower(trim(p_email));
  if v_user is null then raise exception 'no registered user with that email' using errcode = 'P0002'; end if;
  if v_user = auth.uid() and p_role <> 'admin' then
    raise exception 'admins cannot lower their own role; ask another admin' using errcode = '42501';
  end if;
  insert into public.organization_memberships (org_id, user_id, role) values (p_org, v_user, p_role)
  on conflict (org_id, user_id) do update set role = excluded.role
  returning id into v_id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'member.upsert', 'user', v_user, jsonb_build_object('role', p_role));
  return v_id;
end $$;

drop policy memberships_update on public.organization_memberships;
create policy memberships_update on public.organization_memberships for update to authenticated
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id) and (user_id <> (select auth.uid()) or role = 'admin'));

-- 2) An organization can never lose its last Admin (demotion or removal), regardless of who asks.
create or replace function public.protect_last_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin') then
    -- allow when the whole organization is being deleted
    if exists (select 1 from public.organizations where id = old.org_id)
       and not exists (
         select 1 from public.organization_memberships
         where org_id = old.org_id and role = 'admin' and id <> old.id
       ) then
      raise exception 'an organization must keep at least one admin' using errcode = 'P0001';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.protect_last_admin() from public, anon, authenticated;

create trigger memberships_protect_last_admin
  before update of role or delete on public.organization_memberships
  for each row execute function public.protect_last_admin();
