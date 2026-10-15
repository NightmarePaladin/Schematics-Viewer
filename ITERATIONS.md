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
