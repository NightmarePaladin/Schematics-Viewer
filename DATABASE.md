# Database

Migrations (apply in order) live in `supabase/migrations/`:

1. `20261015000001_schema.sql` — enums, 13 tables, constraints, indexes, triggers, new-user profile trigger
2. `20261015000002_functions_rls.sql` — permission functions, RPCs, Row Level Security policies
3. `20261015000003_storage.sql` — private `schematics` bucket + `storage.objects` policies
4. `20261015000004_fk_indexes.sql` — covering indexes suggested by the performance advisor
5. `20261015000005_machines_select_returning_fix.sql` — machines SELECT policy fix (INSERT … RETURNING)
6. `20261015000006_protect_admins.sql` — admins cannot lower their own role; an organization can never lose its last admin (trigger)
7. `20261015000007_machine_hierarchy.sql` — `machines.parent_id` (composite FK, same organization), no self/loop parents, depth limit 10
8. `20261015000008_critical_components.sql` — `machines.is_critical` and `inoperable_machines(org)` (derived inherited state)
12. `20261015000012_audit_who_and_what.sql` — access, role and group-membership entries record the person/group and the drawing as a permanent snapshot
11. `20261015000011_audit_log.sql` — trigger-based, admin-readable, append-only audit log
10. `20261015000010_critical_faults.sql` — `critical_fault_machines(org)`: machines with their own unresolved critical-severity issue (derived)
9. `20261015000009_locations.sql` — `locations` table, `machines.location_id`, name-sync triggers, RLS, conversion of existing free-text locations

> **Status:** all twelve migrations were applied successfully to Supabase project `pmtdaopxvisqwyhaenvz` on 2026-10-15 (no SQL errors).
> Supabase security advisor: 11 WARN `authenticated_security_definer_function_executable` — **intentional**: the RLS helper functions and the two RPCs
> must be callable by signed-in users (the API calls `schematic_level` and the RPCs as the user); they only reveal the caller's own access.
> Performance advisor: composite-FK indexes added in migration 4; remaining INFO "unused index" notices are expected on an empty database.

## Tables

| Table | Purpose / key constraints |
|-------|---------------------------|
| `organizations` | workspace |
| `profiles` | 1:1 with `auth.users` (trigger-created); unique lower(email) |
| `organization_memberships` | `(org_id, user_id)` unique; `role` enum admin/maintenance_manager/technician/viewer |
| `groups` | unique `(org_id, lower(name))`; `unique(id, org_id)` for composite FKs |
| `group_memberships` | PK `(group_id, user_id)`; FKs `(group_id, org_id)` and `(org_id, user_id)` ⇒ users can only join groups of their own org |
| `machines` | required: name, category, manufacturer, model_number, serial_number; optional asset, description, location, lat/lon (both or neither), installed_on, status. **Unique `(org_id, lower(manufacturer), lower(serial_number))`** |
| `schematics` | FK `(machine_id, org_id)`; title, document_number, revision, storage_path, file_size ≤ 25 MB, mime = application/pdf, uploaded_by; unique `(machine_id, document_number, revision)` |
| `schematic_access_grants` | exactly one of `user_id`/`group_id`; level view/comment/edit/manage; partial unique indexes per grantee; composite FKs keep grantee in the same org |
| `annotations` | `page_number ≥ 1`, type point/comment/box/callout, **x,y ∈ [0,1], width/height ∈ (0,1], x+width ≤ 1**, box/callout require size, body, optional status, author_id, timestamps |
| `annotation_replies` | thread; `is_resolution_note`; FK `(annotation_id, org_id)` |
| `maintenance_issues` | machine, optional schematic/annotation/page, title, description, status, severity, reporter, assignee, resolution_note, resolved_at (trigger) |
| `maintenance_logs` | append-only history (no UPDATE/DELETE policy) |
| `audit_events` | who did what (uploads, file views, grants, member changes…) |

Timestamps default to `now()` on the server; `updated_at` is maintained by triggers. Creator attribution columns
(`created_by`, `uploaded_by`, `author_id`, `reporter_id`, `performed_by`) are `NOT NULL`/`SET NULL`-safe and are checked against
`auth.uid()` in the insert policies, so they cannot be forged. Deleting a schematic/annotation keeps issues and logs (`ON DELETE SET NULL`).

## Functions

- `schematic_level(schematic_id) → perm_level|null` — effective permission of `auth.uid()`; admin/manager ⇒ manage; else max(user grants, group grants); Viewer role capped at `view`; non-members ⇒ null.
- `has_schematic_level(id, min)`, `can_view_machine(id)`, `org_role_of`, `is_org_member/admin/manager`, `can_write_org`, `annotation_schematic`, `storage_schematic_id(name)`.
- RPC `create_organization(name)`, `add_member_by_email(org, email, role)` (Admin only).
- Trigger `grant_uploader_manage` — uploader receives a Manage grant (default access is otherwise private).

All helper functions are `SECURITY DEFINER` with `search_path = ''`, executable only by `authenticated`.

## Row Level Security summary

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| organizations | member | via RPC | admin | — |
| profiles | self or shares an org | trigger | self | — |
| memberships | member | via RPC | admin | admin or self |
| groups / group_memberships | member | admin/manager | admin/manager | admin/manager |
| machines | admin/manager, creator, or can view one of its schematics | admin/manager/technician (`created_by = uid`) | admin/manager or technician-creator | admin/manager |
| schematics | level ≥ view | write role, uploader = uid, machine visible | level ≥ edit | level ≥ manage |
| grants | level = manage, or own/group grant | level = manage | level = manage | level = manage |
| annotations | level ≥ view | author = uid and level ≥ comment | level ≥ edit, or author with comment | level = manage, or author |
| replies | via parent annotation view | author = uid and comment | author | author or manage |
| issues | `can_view_machine` | reporter = uid, write role | manager, reporter, assignee | manager |
| logs | `can_view_machine` | performed_by = uid, write role | — | — |
| audit_events | admin/manager | member, actor = uid | — | — |
| storage.objects (`schematics`) | view | edit + matching schematic row | — | manage |

## Machine hierarchy and critical components
- `machines.parent_id` links a machine to the system/machine it is a part of (tree, single parent). FK `(parent_id, org_id)` keeps both in one organization;
  `ON DELETE SET NULL (parent_id)` un-links children when a parent is deleted. Trigger `check_machine_hierarchy` rejects loops (A under B under A) and depth > 10.
- `machines.is_critical` marks a critical component. **Rule:** a critical machine with an unresolved issue of severity `high` or `critical` makes its parent inoperable;
  the effect continues to the grandparent only if the parent is itself critical. Nothing is stored: `inoperable_machines(p_org)` (SECURITY DEFINER, members only)
  derives it from open issues, so it clears the moment the issue is resolved (or downgraded to low/medium). It returns the cause machine's name only to callers who can view that machine.
- The stored `status` field is untouched. **Effective status** (`src/lib/machine-status.ts`) = `critical` if `critical_fault_machines()` lists the machine (own unresolved critical-severity issue),
  else `inoperable` if `inoperable_machines()` lists it (inherited), else the stored status; a `retired` machine stays retired. Both functions are SECURITY DEFINER, members-only, and read live issues, so nothing needs cleaning up on resolution.

## Audit log (`audit_events`)
- **Recorded by the database, not the app.** AFTER triggers (`audit_row_change`) on organizations, memberships, groups, group members, machines, locations, schematics, access grants, annotations, replies, issues and maintenance logs write one row per change:
  `actor_id`, `actor_label` (name + email snapshot), `action` (`machine.created|updated|deleted`, …), `entity_type`, `entity_id` and `metadata` (a label, related ids, and for updates a `changes` object `{column: {from, to}}`; no-op updates and bookkeeping columns are skipped).
  File views (which triggers cannot see) are recorded by `log_schematic_view()` (SECURITY DEFINER; ignores callers without View access).
- **Only user-attributed actions are logged** (`auth.uid()` must be present). Changes made with the service-role key, scripts or the SQL editor have no signed-in user and are not logged.
- **Who can read:** organization **Admins** only (RLS `is_org_admin`). Maintenance managers, technicians and viewers see nothing.
- **Who can write:** nobody through the API. `INSERT/UPDATE/DELETE/TRUNCATE` are revoked from `anon`, `authenticated` and `service_role`, there are no write policies, and guard triggers (`audit_events_guard`) raise unless `current_user` is `postgres` or `supabase_admin`
  (the roles behind the Supabase SQL editor). Cascades from deleting an organization run as the table owner and are allowed.
- **Owner maintenance** (Supabase dashboard → SQL editor, which runs as `postgres`). Example: remove entries made by the demo/test accounts:
  `delete from public.audit_events where actor_label ilike '%@schematichub.test%';` (this is destructive and is itself not logged).
- **Who/what snapshot (migration 12):** `grant` entries carry `grantee` (person "Name (email)" or group name), `grantee_kind` and `schematic` (title); `membership` entries carry `member`; `group_member` entries carry `member` and `group`. They are captured when the event happens, so renaming or deleting the person, group or drawing later never changes what the log says.
  Entries recorded before migration 12 have only ids; the admin page resolves their names from the ids when it draws the page (a deleted user/group/schematic is shown as "a deleted ..."). History itself was not modified. Name search only matches entries that carry the snapshot.
- Entries written before migration 11 by the old app-level logger remain (action names like `machine.create`); they are displayed as-is.

## Locations
- `locations(org_id, name, description, latitude, longitude)`: unique name per organization (case-insensitive); coordinates optional but both-or-neither and range-checked.
- `machines.location_id` -> composite FK `(location_id, org_id)` (a machine can only use a location of its own organization); deleting a location un-links machines (they are kept).
- `machines.location` (text) is kept as a **synced display/search copy** of the location name: trigger `sync_machine_location` copies it when a machine's location changes and
  `propagate_location_rename` updates it when a location is renamed, so the two can never drift. Machines without a `location_id` may still carry legacy free text.
- Coordinates are **not copied**: a machine's own `latitude/longitude` (optional override) wins, otherwise it inherits its location's at read time (`effectiveCoords`).
- RLS: all members read; Admin / Maintenance Manager / Technician add (`created_by = uid`); only Admin / Maintenance Manager edit or delete.
- Migration 9 also converted existing machine location text into location rows (coordinates from the first machine that had them) and cleared machine coordinates that merely repeated them.

## Known modelling choices
- Uploader trigger grant is created after the INSERT statement, so the API inserts the schematic without `RETURNING` and re-selects afterwards.
- `maintenance_issues.annotation_id` is unique: one issue per annotation.
