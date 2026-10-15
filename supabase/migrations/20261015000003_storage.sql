-- Private bucket for schematic PDFs. Objects are named "<org_id>/<schematic_id>.pdf".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('schematics', 'schematics', false, 26214400, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 26214400, allowed_mime_types = array['application/pdf'];

-- Reading (incl. creating signed URLs) requires View on the schematic row that owns the object.
create policy schematic_files_select on storage.objects for select to authenticated
  using (bucket_id = 'schematics' and public.has_schematic_level(public.storage_schematic_id(name), 'view'));

-- Uploading requires Edit on the (already created) schematic row and a non-viewer role.
create policy schematic_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'schematics'
    and public.has_schematic_level(public.storage_schematic_id(name), 'edit')
    and exists (
      select 1 from public.schematics s
      where s.id = public.storage_schematic_id(name) and s.storage_path = name and s.org_id::text = split_part(name, '/', 1)
        and public.can_write_org(s.org_id)
    )
  );

create policy schematic_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'schematics' and public.has_schematic_level(public.storage_schematic_id(name), 'manage'));
-- no UPDATE policy: stored revisions are immutable; upload a new revision instead.
