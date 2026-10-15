# Testing

**Rule:** nothing below is marked “passed” unless it was actually run. Last verified run: 2026-10-15 on Windows 11, Node 24.

## Results

Last verified run: 2026-10-15 (Windows 11, Node 24, Chrome stable via Playwright `channel: "chrome"`), against hosted Supabase project `pmtdaopxvisqwyhaenvz`.

| Suite | Command | Result |
|-------|---------|--------|
| Type check | `npm run typecheck` | ✅ pass |
| Lint | `npm run lint` | ✅ pass |
| Production build | `npm run build` | ✅ pass (Next 16.4.1) |
| Unit | `npm test` | ✅ **37 / 37** (4 files) |
| Integration: live Open-Meteo | `npm run test:integration` | ✅ **2 / 2** — real HTTPS requests |
| Integration: RLS / storage / schema (real Supabase) | `npm run test:integration` | ✅ **28 / 28** (30 total with the weather file) |
| Playwright E2E | `npm run e2e` | ✅ **8 / 8** — 2 core-flow tests + 6 viewer-flow tests (below) |

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

Playwright flow (`e2e/annotation-flow.spec.ts`): sign in → create machine → upload sample PDF → open schematic → pin annotation →
reload → verify normalized position **and** rendered pixel position (also after zooming) → sign in as Viewer, verify the private
schematic is 404, the shared one is read-only, and direct API writes are refused.

## How to run the credential-dependent tests

1. Apply all six migrations in `supabase/migrations/` (README → Supabase setup). For a throw-away project, disable "Confirm email".
2. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
3. `npm run seed` (idempotent).
4. `npm run test:integration` — 30 tests (28 RLS/storage/schema + 2 weather).
5. `npm run e2e` — uses installed Chrome (`E2E_CHANNEL=chrome`, default). To use Playwright's bundled Chromium run `npx playwright install chromium` and set `E2E_CHANNEL=chromium`.
   Set `E2E_BASE_URL` to test a deployed URL instead of starting `npm run dev`.

Use a dedicated/dev project: the suites write and delete rows and temporarily change one grant (restored in `finally`).
