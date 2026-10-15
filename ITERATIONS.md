# Iterations

A candid log of what was built first, what went wrong, and what changed. Entries marked **(found by tooling)** were caught by
`tsc`, `eslint`, `next build` or the dev server; **(found by review)** by re-reading my own code against the requirements.
No entry claims a defect was found by a test that has not run (see TESTING.md).

## Iteration 1 — scaffold and core libraries
- Scaffolded Next.js 16.4.1 (App Router, Turbopack, Tailwind v4), shadcn/ui (base-nova), Zod, Vitest, Playwright, pdfjs-dist, pdf-lib.
- Wrote pure, database-free modules first so they could be tested immediately: `coords.ts`, `permissions.ts`, `schemas.ts`, `weather.ts` → **37 unit tests green on first run**.

## Iteration 2 — problems found and fixed
| # | Problem | How found | Fix |
|---|---------|-----------|-----|
| 1 | Generated scaffold enabled `cacheComponents`/`partialPrefetching` and a Turbopack CSS-loader override | review of `next.config.ts` | removed; standard `@tailwindcss/postcss` instead |
| 2 | shadcn init added a stray `cn` npm package; components imported `cn` from it and `lib/utils.ts` re-exported it | tsc | replaced with real `clsx` + `tailwind-merge` implementation |
| 3 | `next/font/google` missing — `node_modules` was incomplete after an interrupted copy | tsc | clean reinstall |
| 4 | Vitest 5 peer-requires `@types/node` ≥ 22 | npm ERESOLVE | upgraded to `@types/node@24` |
| 5 | Route files exported helpers (`ISSUE_SELECT`, a TTL constant, a leftover re-export); Next only allows HTTP methods/config exports | review | moved to `src/lib/selects.ts` / made private |
| 6 | `check()` returned possibly-null rows → TS errors and potential runtime nulls | tsc | returns `NonNullable<T>`, throws 404 |
| 7 | `next build` failed prerendering `/` when env vars missing (cookies read after the env check) | build | read `cookies()` first so pages are always dynamic; `/setup` page + proxy 503 JSON for `/api` |
| 8 | **Design bug:** inserting a schematic with `RETURNING` would fail RLS for non-admin uploaders, because their Manage grant is created by an AFTER trigger and is invisible to the same statement | review | API inserts without returning, then re-selects; documented in DATABASE.md |
| 9 | **Design bug:** deleting a schematic row first would remove the authorization needed to delete its storage object | review | delete file, then row |
| 10 | Grants list tried to embed `profiles` through a composite FK that PostgREST cannot resolve | review | removed embed; UI maps names from the members list |
| 11 | ESLint (React Compiler rules) flagged `setState` in data-fetching effects | eslint | rule disabled with justification in `eslint.config.mjs` |
| 12 | Typing error in seed grant loop | tsc | simplified |

## Iteration 3 — improvements
- Viewer shows view-only users a “View only” badge and hides edit tools and the Access tab; server remains the authority.
- Resolving an issue now **requires a resolution note**, appends a maintenance-log entry and posts a resolution reply on the linked annotation.
- Open-Meteo client gained timeout + 10-minute cache + typed fallbacks (`no_location`, `timeout`, `upstream_error`, `bad_response`); a live test confirms the real API contract.
- E2E asserts the **rendered pixel position** and re-checks after zoom, not just database values.

## Next iteration (not yet done)
- Apply migrations to a live project, run `rls.test.ts` and Playwright, and log every real failure here.
- Direct-to-storage uploads for >4.5 MB on Vercel Hobby; PDF thumbnails; image/DXF handlers.

## Iteration 4 — first live apply (2026-10-15)
- Applied migrations 1-3 to the hosted project via the Supabase MCP: **no SQL errors**.
- Advisors: security = 11 intentional SECURITY DEFINER warnings (documented); performance = 18 unindexed composite FKs → fixed in migration 4; unused-index INFO is expected on an empty DB.
- Hardening made while applying (and synced back into the migration files): `search_path = ''` on trigger/helper functions, `(select auth.uid())` in policies (planner caching), `revoke execute` on trigger functions, extra attribution indexes.
- Not yet done: seeding and the RLS/E2E suites — they need the service-role key in `.env.local` (not exposed to me by the MCP).

## Iteration 5 — first live test run (2026-10-15)
| # | Finding | Found by | Fix |
|---|---------|----------|-----|
| 13 | Seed script ran cleanly; 22 integration tests (RLS, storage, schema constraints, live weather) all passed first time | `npm run seed`, `npm run test:integration` | — |
| 14 | **Real defect:** registering a machine failed with "You do not have permission" for an Admin. `INSERT ... RETURNING` evaluates the SELECT policy, which called `can_view_machine(id)` — a STABLE function that looks the row up by id and cannot see a row inserted by the same statement | Playwright E2E (screenshot showed the error) — *not* caught by the RLS suite, which never inserted a machine | migration 5: `machines_select` checks the row's own columns directly; added regression test "technician can insert a machine and get the row back" |
| 15 | Playwright locator `getByLabel("Title")` matched both the upload form and the issue form | Playwright | `{ exact: true }` |
| 16 | Base UI warned that `Button render={<Link/>}` must set `nativeButton={false}` | dev-server log during E2E | set on both buttons |
| 17 | Playwright's bundled browser was not installed | Playwright | config uses the installed Chrome (`channel`), overridable via `E2E_CHANNEL` |

Lesson recorded: the 22 passing database tests had not exercised the most basic write path through the real API; only the end-to-end test did.
Added 3 tests (machine insert-returning, machine metadata visibility, technician cannot edit another's machine) → 25 integration tests, all passing.

## Iteration 6 — UI click-through as automated tests (2026-10-15)
Wrote `e2e/viewer-flows.spec.ts` for the flows not yet exercised and inspected screenshots of the results.
| # | Finding | Fix |
|---|---------|-----|
| 18 | Two buttons shared the accessible name "Collapse sidebar" (app nav and annotations panel) — ambiguous for screen-reader and test users | viewer button renamed "Collapse/Expand annotations panel" |
| 19 | Toast notifications covered the reply input in the thread panel | toasts moved to top-right |
| 20 | Repeated E2E runs accumulated annotations/machines in the demo data | `e2e/cleanup.ts` run in `afterAll`; leftovers from earlier runs removed; row counts confirmed back to seed state |
| 21 | Four of my own test assertions were too loose (ambiguous text/label matches) | tightened; no application defect behind them |
Result: box/callout drawing, thread replies, issue create/resolve, grants (grant → 200, revoke → 404 for the group member), live weather, weather failure fallback, rotation and viewer controls all work as designed. Visual check of screenshots: markers follow the drawing under rotation.
Known cosmetic item: the seeded sample box sits next to, not over, the relief valve on the demo drawing.

## Iteration 7 — user-reported defects (2026-10-15)
| # | Report | Root cause | Fix |
|---|--------|-----------|-----|
| 22 | Options in dropdown boxes were impossible to read (dark mode) | native `<select>` popups ignore the transparent background used by the styled control; light text on a light popup | explicit `background`/`color` for `select`/`option` plus `color-scheme`; verified computed colors in a dark-mode browser run |
| 23 | **Security/logic bug:** an Admin could lower their own role (account bob@bob.com ended up as Maintenance Manager, leaving the organization with **zero admins**) | `add_member_by_email` upserted any role for any email, including the caller's own; nothing protected the last admin | migration 6: admins cannot lower their own role (RPC + RLS WITH CHECK), and a trigger refuses to demote or delete an organization's last admin; API returns 403/409 with a clear message; affected account restored to Admin |
Lesson: the original RLS tests covered *who can read/write data* but not *can a privileged user damage their own access*. Added 5 regression tests (own-role lowering via RPC and direct update, last-admin removal/demotion, normal role changes still work, a second admin may step down). Integration suite is now 30 tests (28 RLS/storage/schema + 2 live weather), all passing.

## Iteration 8 — search, machine hierarchy, critical components (2026-10-15)
User requests: search by location/name/manufacturer/model; link machines as sub-parts of a system; critical sub-machines make the parent inoperable while a major issue is open.
Built: shared search module + "Search in" selector; migrations 7-8; parent/critical UI; derived `inoperable_machines()`; dashboard stat; demo data (critical HPU with an open high issue under the press).
| # | Finding | Fix |
|---|---------|-----|
| 24 | **Latent bug found while extending the schema:** `machineUpdateSchema = base.partial()` kept Zod `.default()` values, so an API `PATCH {name}` would silently reset `status` (and now `is_critical`/`parent_id`) | defaults moved out of the shared field set; update schema has none; regression unit test (`PATCH {name}` parses to exactly `{name}`) and DB test |
| 25 | **Accessibility + vacuous test:** Base UI renders `<Button render={<Link/>}>` as `<a role="button">`, so links were announced as buttons and my earlier "Viewer has no Register machine *link*" assertion could never fail | real `<Link className={buttonVariants()}>` elements; absence assertions now paired with positive controls |
| 26 | Integration test premise wrong: a technician cannot see the HPU, so the cause's name is (correctly) masked | tests assert masking for tech/viewer and the name for a manager |
| 27 | Service-role client is not an org member so `inoperable_machines` returns nothing for it (by design) | tests use a real member client |
| 28 | Several E2E locators became ambiguous once child rows repeated the parent's name | locators scoped to the name column |
| 29 | The failing component itself still read "Operational" with nothing marking it as the cause | "major issue" marker in list/sub-machine list and a notice on its own page naming what it has taken down |
Supabase security advisor: still only the intentional SECURITY DEFINER warnings (12, incl. `inoperable_machines`) plus **leaked-password protection disabled** (an Auth dashboard setting for the project owner).

## Iteration 9 — locations as premade objects (2026-10-15) and first-run fix
Request: premade locations with coordinates, picked from a dropdown. Built `locations` (migration 9), CRUD API, Locations page, machine form dropdown, inherited coordinates for weather, and a place-name lookup using the Open-Meteo Geocoding API.
| # | Finding | Fix |
|---|---------|-----|
| 30 | **Production log:** a brand-new user with no organization hit the dashboard and got a 403 "Create or join an organization first" instead of being sent to onboarding | pages use `requireOrgPage()` (redirects to /login or /onboarding); API handlers still return JSON errors; new E2E covers every page for a no-org user; onboarding title made a real `<h1>` |
| 31 | Design choice to avoid drift: keeping both `machines.location` text and a new `location_id` could disagree | trigger copies the name from the location (and on rename); coordinates are never copied, only inherited at read time |
| 32 | Existing free-text locations and coordinates would have been orphaned | migration converts them into location rows and links machines; machine coordinates that merely repeated the location's are cleared so they inherit |
| 33 | **Styling bug:** outline-variant links ("Edit", "Add sub-machine", "Locations") showed no border — `buttonVariants()` used directly on a `<Link>` skips class merging, so base `border-transparent` beat `border-border` | `linkButton()` helper that merges classes; found by inspecting a screenshot and computed styles |
Verified live: a machine at a location with coordinates shows real Open-Meteo temperature/humidity/wind with "from location …"; unit-tested geocoding failure modes; real geocoding request returns Chicago at ~41.9, -87.6.
