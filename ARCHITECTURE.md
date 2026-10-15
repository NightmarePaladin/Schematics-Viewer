# Architecture

## Overview

```
Browser (React 19, PDF.js, SVG overlay)
   │  fetch /api/*   (cookies = Supabase session)
   ▼
Next.js server  ──  src/proxy.ts   refresh session, gate pages
   │               src/app/api/**  Route Handlers: Zod → authz → query
   │               src/lib/auth.ts session + membership + schematic level
   ▼
Supabase (as the signed-in user: anon key + user JWT)
   ├─ Postgres  tables + RLS + SQL permission functions
   ├─ Storage   private bucket "schematics"  (signed URLs only)
   └─ Auth      email/password

Open-Meteo  ◄── src/lib/weather.ts (server-side only, via /api/weather)
```

**No service-role key exists in the web app.** All data access runs with the caller's JWT, so Row Level Security is the
enforcement boundary and the Route Handlers add precise status codes (401/403/404/409/422). The service-role key is used only
by `scripts/` and test fixtures.

## Authorization layers (defence in depth)

1. **Session** (`getSession`): the user comes from the verified Supabase JWT. The active organization comes from a cookie but is
   **only honoured if it matches one of the caller's own memberships**; client-supplied org ids/roles in request bodies are ignored
   (org id is derived from the machine/schematic row the caller can already see).
2. **Route Handler checks**: role gates (`canCreateMachine`, …) and `requireSchematicLevel()` which calls the SQL function
   `schematic_level()` — the same function RLS uses. A caller with no access receives **404** (existence is not leaked); insufficient
   access gets **403**.
3. **Row Level Security** on every table (see DATABASE.md) — even a buggy handler cannot read or write across organizations.
4. **Storage RLS**: `storage.objects` policies call `has_schematic_level(storage_schematic_id(name), …)`. Signed URLs are created with
   the caller's token, so the storage layer authorizes again. URLs live 60 seconds; there is no public URL.

`src/lib/permissions.ts` mirrors the SQL rules in TypeScript (unit-tested) so the logic is documented and testable without a database.

### Permission model
| Role (org) | Machines | Schematics |
|------------|----------|------------|
| Admin | everything | implicit **Manage** on all org schematics; manages members, groups |
| Maintenance Manager | everything | implicit **Manage** on all org schematics; manages groups |
| Technician | register; edit own | only what is granted (uploader receives Manage); can log work and report issues |
| Viewer | read-only | only what is granted, **capped at View** even if a higher level is granted |

Schematic grants (View < Comment < Edit < Manage) target a **user** or a **group**; effective level = max over individual + group
grants, evaluated within the schematic's organization. Composite foreign keys `(id, org_id)` make cross-organization grants,
group memberships and annotations impossible at the schema level.

## Viewer and coordinates

- PDF.js renders each page to a `<canvas>`; the source PDF is never modified.
- Annotations are an SVG layer positioned over the canvas.
- **Stored coordinates are fractions (0‥1) of the unrotated page, origin top-left.** The DB has CHECK constraints for this.
- `src/lib/coords.ts` converts between stored frame ⇄ displayed frame (view rotation 0/90/180/270) ⇄ pixels at the current zoom.
  The page's own `/Rotate` is part of the rendered frame (`getViewport({rotation: page.rotate + viewRotation})`).
- Result: markers stay aligned across zoom, fit modes, window resizes, rotation and devices.

## API surface

| Route | Methods | Notes |
|-------|---------|-------|
| `/api/organizations` | POST, PUT | create org (Admin) via RPC; switch active org (validated) |
| `/api/members` | GET, POST | Admin adds registered user by email via RPC |
| `/api/groups`, `/api/groups/[id]/members` | GET, POST / POST, DELETE | managers |
| `/api/machines`, `/api/machines/[id]` | GET, POST / GET, PATCH, DELETE | `?q=&field=all\|name\|manufacturer\|model\|location&status=&category=`; serial unique per org+manufacturer → 409; `parent_id`, `is_critical`; responses include `effective_status` + `inoperable_because` |
| `/api/schematics` | GET, POST (multipart) | type/magic-byte/size validation; private by default |
| `/api/schematics/[id]` | GET, PATCH, DELETE | metadata; delete needs Manage |
| `/api/schematics/[id]/file` | GET | 60 s signed URL after permission check; audited |
| `/api/schematics/[id]/grants` | GET, POST, DELETE | Manage only; user or group |
| `/api/annotations`, `/api/annotations/[id]` | GET, POST / PATCH, DELETE | Comment to create; Edit or author to change |
| `/api/annotations/[id]/replies` | GET, POST | threads, resolution notes |
| `/api/issues`, `/api/issues/[id]` | GET, POST / GET, PATCH | linked to annotation; resolving needs a note and writes a log entry |
| `/api/maintenance-logs` | GET, POST | append-only |
| `/api/weather?machine_id=` | GET | authz → Open-Meteo using the machine's own or its location's coordinates → `{ok, …}` or `{ok:false, reason}` |
| `/api/locations`, `/api/locations/[id]` | GET, POST / PATCH, DELETE | premade locations; members read, writers add, managers edit/delete; responses include machine counts |
| `/api/geocode?q=` | GET | server-side proxy to the Open-Meteo Geocoding API (members only, 5 s timeout, typed failures) |

Errors share one shape: `{ "error": { "code", "message", "details?" } }` with 400/401/403/404/409/413/415/422/502/503.

## Machine search and hierarchy
- `src/lib/machine-search.ts` is shared by the Machines page and `GET /api/machines`: every word must match (case-insensitive, partial) at least one column of the chosen field group.
- `src/lib/machine-tree.ts` holds pure tree helpers (ancestors, descendants, cycle check) plus a TypeScript mirror of the SQL inheritance rule for unit tests.
- `src/lib/machines.ts` loads the derived inoperable state through the `inoperable_machines` RPC and validates that a chosen parent is visible to the caller.

## Extensibility
- **More file types:** add an entry to `UPLOAD_HANDLERS` in `src/app/api/schematics/route.ts` and to `ACCEPTED` in `upload-form.tsx`;
  allow the MIME type in the storage migration. The viewer would need a renderer per type.
- **Direct-to-storage uploads** for files above serverless body limits: create the row, then use `createSignedUploadUrl`.
