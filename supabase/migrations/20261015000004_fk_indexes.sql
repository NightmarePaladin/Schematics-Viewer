-- Covering indexes for composite (id, org_id) foreign keys and attribution columns (from the Supabase performance advisor).
create index if not exists annotation_replies_fk_idx on public.annotation_replies (annotation_id, org_id);
create index if not exists annotations_schematic_fk_idx on public.annotations (schematic_id, org_id);
create index if not exists group_memberships_group_fk_idx on public.group_memberships (group_id, org_id);
create index if not exists group_memberships_member_fk_idx on public.group_memberships (org_id, user_id);
create index if not exists groups_created_by_idx on public.groups (created_by);
create index if not exists machines_created_by_idx on public.machines (created_by);
create index if not exists issues_annotation_fk_idx on public.maintenance_issues (annotation_id, org_id);
create index if not exists issues_machine_fk_idx on public.maintenance_issues (machine_id, org_id);
create index if not exists issues_schematic_fk_idx on public.maintenance_issues (schematic_id, org_id);
create index if not exists logs_annotation_fk_idx on public.maintenance_logs (annotation_id, org_id);
create index if not exists logs_issue_fk_idx on public.maintenance_logs (issue_id, org_id);
create index if not exists logs_machine_fk_idx on public.maintenance_logs (machine_id, org_id);
create index if not exists logs_schematic_fk_idx on public.maintenance_logs (schematic_id, org_id);
create index if not exists organizations_created_by_idx on public.organizations (created_by);
create index if not exists grants_group_fk_idx on public.schematic_access_grants (group_id, org_id);
create index if not exists grants_member_fk_idx on public.schematic_access_grants (org_id, user_id);
create index if not exists grants_schematic_fk_idx on public.schematic_access_grants (schematic_id, org_id);
create index if not exists schematics_machine_fk_idx on public.schematics (machine_id, org_id);
