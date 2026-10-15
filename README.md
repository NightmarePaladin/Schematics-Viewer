# SchematicHub

Collaborative technical-schematic viewer and machine maintenance documentation platform.
Register machines, upload PDF schematics, share them with the right people, and pin comments, issue boxes and
maintenance records to exact coordinates on a drawing page.

**Stack:** Next.js 16 (App Router) · TypeScript · React 19 · Tailwind v4 + shadcn/ui · Supabase (Postgres, Auth, private Storage, RLS) · PDF.js · SVG overlay · Open-Meteo · Zod · Vitest · Playwright.

> Status: code complete for the MVP scope; see [HANDOFF.md](HANDOFF.md) for exactly what has and has not been executed against a live Supabase project.

## Boot camp requirement matrix

| # | Requirement | Where it is fulfilled |
|---|-------------|-----------------------|
| 1 | Working server-side backend | Next.js Route Handlers in `src/app/api/**` with Zod validation, server-side authorization (`src/lib/auth.ts`, `src/lib/permissions.ts`), proxy session refresh (`src/proxy.ts`). 17 route files, see [ARCHITECTURE.md](ARCHITECTURE.md#api-surface). |
| 2 | Persistent database | Supabase PostgreSQL: 13 tables, FKs, indexes, RLS, triggers — `supabase/migrations/*.sql`, described in [DATABASE.md](DATABASE.md). Private Storage bucket for PDFs. |
| 3 | Real external API | Open-Meteo weather, requested server-side by `src/lib/weather.ts` via `GET /api/weather`. 5 s timeout, 10 min cache, fallback states. Verified by a live-network test (`tests/integration/weather-live.test.ts`). |
| 4 | New technology / novel use case | PDF.js rendering with an SVG annotation layer using **normalized, rotation-aware page coordinates** (`src/lib/coords.ts`); RLS-enforced document ACL with user + group grants resolved in SQL and mirrored in storage policies; signed-URL-only delivery. |
| 5 | Iterate and test | Unit tests (37), live-network test (2), RLS/storage integration tests (23), Playwright E2E (2), and a candid change log in [ITERATIONS.md](ITERATIONS.md). Results in [TESTING.md](TESTING.md). |

## Quick start

```bash
npm install
cp .env.example .env.local      # fill in the Supabase values (see below)
npm run dev                     # http://localhost:3000
```

Without `.env.local` the app still starts and shows a `/setup` page explaining what is missing.

### 1. Supabase setup

1. Create a project at <https://supabase.com> (or use an existing one).
2. **Project Settings → API**: copy the project URL and the `anon`/publishable key into `.env.local`
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
3. Apply the migrations **in order (5 files)** — either paste each file into **SQL Editor → Run**, or with the CLI:
   ```bash
   npx supabase link --project-ref <your-ref>
   npx supabase db push
   ```
   Files: `20261015000001_schema.sql`, `20261015000002_functions_rls.sql`, `20261015000003_storage.sql`, `20261015000004_fk_indexes.sql`, `20261015000005_machines_select_returning_fix.sql`.
4. **Authentication → Providers → Email**: for quick local demos turn **off** “Confirm email” (otherwise new users must
   click an emailed link first). **Authentication → URL Configuration**: add `http://localhost:3000/**` and your Vercel URL
   as redirect URLs.
5. *(Optional demo data + test users)* put the **service_role** key in `.env.local` as `SUPABASE_SERVICE_ROLE_KEY`
   (server-only; never `NEXT_PUBLIC_`) and run:
   ```bash
   npm run demo-pdf   # regenerates samples/demo-hydraulic-schematic.pdf
   npm run seed       # creates 6 users, 2 orgs, 3 machines + a schematic, grants, issue, logs
   ```
   Seeded sign-ins (password = `SEED_PASSWORD`, default in `.env.example`):
   `admin@`, `manager@`, `tech@`, `tech2@`, `viewer@schematichub.test`, and `outsider@othercorp.test` (a different organization).

### 2. Using the app

1. Sign up → create an organization (you become Admin) → **Machines → Register machine**.
2. On the machine page: **Upload a schematic** (PDF, ≤ 25 MB). It is private; you hold Manage.
3. In the viewer, open the **Access** tab to grant View/Comment/Edit/Manage to people or groups (Teams page creates groups).
4. Pick a tool (point, comment, issue box, callout), click/drag on the drawing, write a note, save. Click a marker to open its thread, reply, set status, or create a maintenance issue.
5. Add coordinates (latitude/longitude) to a machine to see live weather context on its page.

### Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` / `build` / `start` | Run / build / serve |
| `npm run typecheck` · `npm run lint` | Static checks |
| `npm test` | Unit tests (no network, no Supabase) |
| `npm run test:integration` | Live weather + RLS/storage tests (the RLS ones need Supabase creds; they skip otherwise) |
| `npm run e2e` | Playwright (needs Supabase + seed; first run: `npx playwright install chromium`) |
| `npm run seed` · `npm run demo-pdf` | Demo data · synthetic PDF |

## Deploying to Vercel

1. Push the repo to GitHub and **Import** it in Vercel (framework: Next.js, defaults are fine).
2. **Environment Variables** (Production + Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   **Do not** add the service-role key to Vercel — the app never uses it.
3. In Supabase **Authentication → URL Configuration** set *Site URL* to the Vercel URL and add `https://<your-app>.vercel.app/**`.
4. Deploy. Open the URL, sign up, create an organization.

Notes: uploads go through a Route Handler, so the Vercel request-body limit (4.5 MB on Hobby serverless functions) caps upload size
on that plan; the app validates up to 25 MB. For larger files switch to direct-to-storage signed upload URLs (listed in HANDOFF.md).

## Why weather context?

Outdoor industrial equipment (compressors, pumps, switchgear, cooling towers) is sensitive to ambient conditions. Cold affects
oil viscosity and seals, humidity correlates with insulation faults and condensation, wind affects cooling and enclosure loads.
Seeing temperature, humidity and wind next to the schematic helps a technician decide whether a fault is environmental before
replacing parts. It is optional: machines without coordinates simply show a note.

## Documentation

[ARCHITECTURE.md](ARCHITECTURE.md) · [DATABASE.md](DATABASE.md) · [TESTING.md](TESTING.md) · [ITERATIONS.md](ITERATIONS.md) · [HANDOFF.md](HANDOFF.md)
