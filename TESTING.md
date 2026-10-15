# Testing

**Rule:** nothing below is marked “passed” unless it was actually run. Last verified run: 2026-10-15 on Windows 11, Node 24.

## Results

Last verified run: 2026-10-15 (Windows 11, Node 24, Chrome stable via Playwright `channel: "chrome"`), against hosted Supabase project `pmtdaopxvisqwyhaenvz`.

| Suite | Command | Result |
|-------|---------|--------|
| Type check | `npm run typecheck` | ✅ pass |
| Lint | `npm run lint` | ✅ pass |
| Production build | `npm run build` | ✅ pass (Next 16.4.1) |
| Unit | `npm test` | ✅ **71 / 71** (6 files) |
| Integration: live Open-Meteo | `npm run test:integration` | ✅ **2 / 2** — real HTTPS requests |
| Integration: RLS / storage / schema (real Supabase) | `npm run test:integration` | ✅ **52 / 52** (54 total with the weather file; includes 2 live geocoding checks) |
| Playwright E2E | `npm run e2e` | ✅ **17 / 17** — core flow (2), viewer flows (6), search + hierarchy + criticality (4), locations (4), first-run onboarding (1) |

E2E specs clean up the rows they create (`e2e/cleanup.ts`, service-role key); a full run leaves the database at its seed state (verified by row counts).
Not covered by automated tests: direct HTTP tests of every route, mobile layout, the pan tool (drag to scroll), email-confirmation sign-up flow, upload rejection paths (non-PDF, >25 MB) in the browser.

`e2e/viewer-flows.spec.ts` covers: drawing an issue box by dragging and a callout; thread reply; creating a maintenance issue from an annotation;
resolving it (button disabled until a note is typed; log entry written); granting and revoking a group's access in the Access tab with a second
browser session confirming 200 → 404; live weather panel (real Open-Meteo) and the no-coordinates note; weather failure fallback with Retry;
90° view rotation keeps the seeded box on the same drawing feature (and 360° returns to the start); page navigation, fit-to-page/width, zoom,
annotation visibility toggle and annotations-panel collapse for a read-only user.

## Coverage map (requirement → test)

| Required test | Where | Status |
|---------------|-------|--------|
| Normalized annotation coordinates | `tests/unit/coords.test.ts` (zoom independence, rotation round trips, fit scale), `schemas.test.ts` (rejects pixel values) | ✅ run |
| Annotation persistence & retrieval | `tests/integration/rls.test.ts` “annotation persistence + retrieval”; E2E steps 5–7 | ✅ run |
| Machine metadata validation | `tests/unit/schemas.test.ts`; DB uniqueness in `rls.test.ts` | ✅ run |
| Cross-organization access denial | `rls.test.ts` “cross-organization denial”; `permissions.test.ts` (non-member ⇒ null) | ✅ run |
| Group-based schematic permissions | `permissions.test.ts`; `rls.test.ts` “group + individual grants” | ✅ run |
| Viewer read-only | `permissions.test.ts` (cap); `rls.test.ts` “viewer is read-only”; E2E step 8 | ✅ run |
| Unauthorized PDF download denial | `rls.test.ts` “PDF storage access” (outsider, ungranted technician, private bucket, viewer upload/delete) | ✅ run |
| External API failure handling | `tests/unit/weather.test.ts` (no location, HTTP 503, network error, timeout, malformed body, cache) | ✅ run |

`e2e/machines-hierarchy.spec.ts` covers: search by location / name / manufacturer / model, field scoping (searching a column that lacks the text finds nothing),
case-insensitive partial and multi-word matching; the seeded critical HPU with an open high issue making the press show "Inoperable (inherited)" in the list, detail banner,
sub-machine list and dashboard; the cause machine's own notice; creating a sub-machine from its parent (parent pre-selected, critical checkbox disabled until a parent is chosen),
raising a high issue → parent banner names it, resolving → banner clears; Viewer sees the state but no add/edit controls (with positive controls so absence checks are not vacuous).
`e2e/locations.spec.ts` covers: shared list visible to all members (Technician can add but sees no edit/delete, Viewer read-only, Admin positive control);
adding a location through place lookup (geocode API stubbed for determinism; failure shows a message and manual entry still works), half-pair and duplicate-name rejection;
registering a machine by choosing the location from the dropdown with **live Open-Meteo weather from the inherited coordinates**; renaming a location updates machines and location search;
deleting a location keeps the machine and the weather panel falls back. `e2e/onboarding.spec.ts` covers a brand-new user with no organization (redirect to onboarding from every page, JSON 403 from the API).
`tests/integration/locations.test.ts` covers RLS per role, cross-organization isolation, forged `created_by`, case-insensitive uniqueness, coordinate checks, cross-org references, name sync/rename propagation,
un-linking on delete, and the live geocoding API (real request).
`tests/integration/hierarchy.test.ts` covers the SQL rule: propagation through critical parents and stopping at a non-critical one, minor severities ignored, non-critical children ignored,
resolve/reopen, masking of the cause's name for users who cannot see it, cross-organization isolation, loop/self/cross-org/depth rejection, un-linking on parent delete, partial updates keeping stored values.

Playwright flow (`e2e/annotation-flow.spec.ts`): sign in → create machine → upload sample PDF → open schematic → pin annotation →
reload → verify normalized position **and** rendered pixel position (also after zooming) → sign in as Viewer, verify the private
schematic is 404, the shared one is read-only, and direct API writes are refused.

## How to run the credential-dependent tests

1. Apply all nine migrations in `supabase/migrations/` (README → Supabase setup). For a throw-away project, disable "Confirm email".
2. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
3. `npm run seed` (idempotent).
4. `npm run test:integration` — 54 tests (52 RLS/storage/schema/hierarchy/locations + 2 weather).
5. `npm run e2e` — uses installed Chrome (`E2E_CHANNEL=chrome`, default). To use Playwright's bundled Chromium run `npx playwright install chromium` and set `E2E_CHANNEL=chromium`.
   Set `E2E_BASE_URL` to test a deployed URL instead of starting `npm run dev`.

Use a dedicated/dev project: the suites write and delete rows and temporarily change one grant (restored in `finally`).
