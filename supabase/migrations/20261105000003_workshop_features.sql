-- Markup geometry, precise links, revisions, attachments, notifications and realtime.
-- Requires 20261105000002 (new enum values) to be committed first.

-- ───────────── markup (pen / arrow / highlight) ─────────────
alter table public.annotations add column path jsonb; -- [[x,y], ...] normalized, stored (unrotated) frame

-- replace the "boxes and callouts have a size" check (its generated name is not known, so find it by definition)
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.annotations'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%callout%'
  loop
    execute format('alter table public.annotations drop constraint %I', c);
  end loop;
end $$;
alter table public.annotations add constraint annotations_size_by_type
  check ((type in ('box', 'callout', 'highlight')) = (width is not null and height is not null));
alter table public.annotations add constraint annotations_path_by_type
  check ((type in ('pen', 'arrow')) = (path is not null)
         and (path is null or (jsonb_typeof(path) = 'array' and jsonb_array_length(path) between 2 and 600)));

-- ───────────── precise links: open on a page, or on a specific annotation of the target ─────────────
alter table public.annotations add column linked_page int check (linked_page is null or linked_page >= 1);
alter table public.annotations add column linked_annotation_id uuid;
alter table public.annotations
  add constraint annotations_linked_annotation_fkey foreign key (linked_annotation_id, org_id)
  references public.annotations (id, org_id) on delete set null (linked_annotation_id);
create index annotations_linked_annotation_idx on public.annotations (linked_annotation_id) where linked_annotation_id is not null;

create or replace function public.check_annotation_link() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_src uuid; v_dst uuid;
begin
  if new.linked_schematic_id is null then
    new.linked_page := null;
    new.linked_annotation_id := null;
    return new;
  end if;
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
  if auth.uid() is not null and not public.has_schematic_level(new.linked_schematic_id, 'view') then
    raise exception 'schematic not found' using errcode = 'P0001';
  end if;
  if new.linked_annotation_id is not null then
    if not exists (select 1 from public.annotations a where a.id = new.linked_annotation_id and a.schematic_id = new.linked_schematic_id) then
      raise exception 'that annotation is not on the linked schematic' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.check_annotation_link() from public, anon, authenticated;

drop trigger if exists annotations_check_link on public.annotations;
create trigger annotations_check_link before insert or update of linked_schematic_id, linked_page, linked_annotation_id on public.annotations
  for each row execute function public.check_annotation_link();

-- ───────────── schematic revisions ─────────────
-- `schematics` always holds the CURRENT revision; this table keeps the superseded ones (their PDFs stay in storage).
create table public.schematic_revisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  schematic_id uuid not null,
  revision text not null,
  storage_path text not null,
  file_size bigint,
  superseded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  superseded_at timestamptz not null default now(),
  foreign key (schematic_id, org_id) references public.schematics (id, org_id) on delete cascade
);
create index schematic_revisions_schematic_idx on public.schematic_revisions (schematic_id, superseded_at desc);
create index schematic_revisions_by_idx on public.schematic_revisions (superseded_by);
alter table public.schematic_revisions enable row level security;
create policy revisions_select on public.schematic_revisions for select to authenticated
  using (public.has_schematic_level(schematic_id, 'view'));
-- rows are written only by revise_schematic() below (runs as the caller, so it needs Edit)
create policy revisions_insert on public.schematic_revisions for insert to authenticated
  with check (public.has_schematic_level(schematic_id, 'edit') and superseded_by = (select auth.uid()));

-- the revision an annotation was drawn on (null = still the current one)
alter table public.annotations add column schematic_revision text;
create or replace function public.stamp_annotation_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.schematic_revision is null then
    select s.revision into new.schematic_revision from public.schematics s where s.id = new.schematic_id;
  end if;
  return new;
end $$;
create trigger annotations_stamp_revision before insert on public.annotations
  for each row execute function public.stamp_annotation_revision();

-- Storage names may now be "<org>/<schematic_id>.pdf" or "<org>/<schematic_id>--<anything>.pdf".
create or replace function public.storage_schematic_id(p_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return nullif(substring(split_part(p_name, '/', 2) from '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'), '')::uuid;
exception when others then
  return null;
end $$;

-- A new revision's object is uploaded BEFORE the row is switched over, so the old exact-path check no longer applies.
drop policy if exists schematic_files_insert on storage.objects;
create policy schematic_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'schematics'
    and public.has_schematic_level(public.storage_schematic_id(name), 'edit')
    and exists (
      select 1 from public.schematics s
      where s.id = public.storage_schematic_id(name) and s.org_id::text = split_part(name, '/', 1) and public.can_write_org(s.org_id)
    )
  );

-- Swap in a new revision (call after the file is uploaded). Runs as the caller: RLS still requires Edit.
create or replace function public.revise_schematic(p_schematic uuid, p_revision text, p_path text, p_size bigint)
returns void language plpgsql set search_path = '' as $$
declare s public.schematics%rowtype;
begin
  select * into s from public.schematics where id = p_schematic;
  if not found or not public.has_schematic_level(p_schematic, 'edit') then
    raise exception 'schematic not found' using errcode = 'P0001';
  end if;
  if p_path not like s.org_id::text || '/' || p_schematic::text || '%' then
    raise exception 'invalid storage path' using errcode = 'P0001';
  end if;
  insert into public.schematic_revisions (org_id, schematic_id, revision, storage_path, file_size)
    values (s.org_id, s.id, s.revision, s.storage_path, s.file_size);
  update public.annotations set schematic_revision = s.revision where schematic_id = s.id and schematic_revision is null;
  update public.schematics set revision = p_revision, storage_path = p_path, file_size = p_size where id = s.id;
end $$;
grant execute on function public.revise_schematic(uuid, text, text, bigint) to authenticated;

-- ───────────── photo / voice attachments ─────────────
create table public.annotation_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  annotation_id uuid not null,
  kind text not null check (kind in ('photo', 'audio')),
  storage_path text not null,
  content_type text not null,
  file_size int,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  foreign key (annotation_id, org_id) references public.annotations (id, org_id) on delete cascade
);
create index annotation_attachments_annotation_idx on public.annotation_attachments (annotation_id, created_at);
create index annotation_attachments_by_idx on public.annotation_attachments (created_by);
alter table public.annotation_attachments enable row level security;

create or replace function public.annotation_schematic_of(p_annotation uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select schematic_id from public.annotations where id = p_annotation
$$;
revoke all on function public.annotation_schematic_of(uuid) from public, anon;
grant execute on function public.annotation_schematic_of(uuid) to authenticated;

create policy attachments_select on public.annotation_attachments for select to authenticated
  using (public.has_schematic_level(public.annotation_schematic_of(annotation_id), 'view'));
create policy attachments_insert on public.annotation_attachments for insert to authenticated
  with check (created_by = (select auth.uid()) and public.has_schematic_level(public.annotation_schematic_of(annotation_id), 'comment'));
create policy attachments_delete on public.annotation_attachments for delete to authenticated
  using (public.has_schematic_level(public.annotation_schematic_of(annotation_id), 'manage')
         or (created_by = (select auth.uid()) and public.has_schematic_level(public.annotation_schematic_of(annotation_id), 'comment')));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('annotation-files', 'annotation-files', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/x-m4a'])
on conflict (id) do update set public = false;

-- objects are named "<org_id>/<annotation_id>/<file>"
create or replace function public.storage_annotation_id(p_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return nullif(split_part(p_name, '/', 2), '')::uuid;
exception when others then
  return null;
end $$;

create policy annotation_files_select on storage.objects for select to authenticated
  using (bucket_id = 'annotation-files'
         and public.has_schematic_level(public.annotation_schematic_of(public.storage_annotation_id(name)), 'view'));
create policy annotation_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'annotation-files'
              and public.has_schematic_level(public.annotation_schematic_of(public.storage_annotation_id(name)), 'comment'));
create policy annotation_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'annotation-files'
         and public.has_schematic_level(public.annotation_schematic_of(public.storage_annotation_id(name)), 'manage'));

-- ───────────── notifications ─────────────
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  message text not null,
  href text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = (select auth.uid()));
-- no insert policy: only the triggers below create notifications

create or replace function public.notify_on_reply() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ann public.annotations%rowtype; v_title text; v_name text;
begin
  select * into v_ann from public.annotations where id = new.annotation_id;
  if not found or v_ann.author_id = new.author_id then return new; end if;
  select title into v_title from public.schematics where id = v_ann.schematic_id;
  select display_name into v_name from public.profiles where id = new.author_id;
  insert into public.notifications (org_id, user_id, kind, message, href)
  values (new.org_id, v_ann.author_id, 'reply',
          coalesce(v_name, 'Someone') || ' replied to your note on ' || coalesce(v_title, 'a schematic'),
          '/schematics/' || v_ann.schematic_id || '?page=' || v_ann.page_number || '&focus=' || v_ann.id);
  return new;
end $$;
revoke all on function public.notify_on_reply() from public, anon, authenticated;
create trigger replies_notify after insert on public.annotation_replies for each row execute function public.notify_on_reply();

create or replace function public.notify_on_issue() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_machine text; v_owner uuid; v_actor uuid := auth.uid();
begin
  select name, created_by into v_machine, v_owner from public.machines where id = new.machine_id;
  if tg_op = 'INSERT' then
    if v_owner is not null and v_owner is distinct from new.reporter_id then
      insert into public.notifications (org_id, user_id, kind, message, href)
      values (new.org_id, v_owner, 'issue', 'New ' || new.severity || ' issue on ' || coalesce(v_machine, 'a machine') || ': ' || new.title, '/machines/' || new.machine_id);
    end if;
  end if;
  if new.assignee_id is not null and new.assignee_id is distinct from v_actor
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    insert into public.notifications (org_id, user_id, kind, message, href)
    values (new.org_id, new.assignee_id, 'assigned', 'You were assigned: ' || new.title || ' (' || coalesce(v_machine, 'machine') || ')', '/machines/' || new.machine_id);
  end if;
  return new;
end $$;
revoke all on function public.notify_on_issue() from public, anon, authenticated;
create trigger issues_notify after insert or update of assignee_id on public.maintenance_issues
  for each row execute function public.notify_on_issue();

-- ───────────── realtime (RLS still filters what each user receives) ─────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.annotations;
    alter publication supabase_realtime add table public.annotation_replies;
    alter publication supabase_realtime add table public.annotation_attachments;
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
