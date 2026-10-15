# Handoff

_Last updated: 2026-10-15._

## Where things stand

| Stage | Status | Verified by |
|-------|--------|-------------|
| 1 Scaffold + structure | ✅ done | build, dev server |
| 2 Supabase schema, auth, storage | ✅ applied (5 migrations), advisors reviewed | MCP apply + advisors; 23 RLS/storage tests |
| 3 Machines + PDF upload | ✅ works end to end | Playwright (create machine, upload PDF) |
| 4 Viewer + annotations | ✅ point/box/callout, threads, rotation, zoom/fit, toggle | Playwright (8 tests) |
| 5 Issues + roles/groups/grants | ✅ verified in DB and in the UI (create/resolve issue, grant/revoke) | RLS tests, Playwright |
| 6 Open-Meteo | ✅ real API + weather panel in browser + failure fallback | live tests, Playwright |
| 7 Tests, docs, deploy prep | ✅ docs + suites run (see TESTING.md); Vercel deploy not done | — |

## Deployment (Vercel)
- Project `schematics-viewer` (team Paladins) is Git-linked to NightmarePaladin/Schematics-Viewer; every push to `main` deploys to production at `https://schematics-viewer.vercel.app`.
- Env vars set on Vercel (production + preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key). No service-role key on Vercel.
- Verified 2026-10-15: deployment READY; `/login` renders the sign-in page (before the variables were added it rendered `/setup`); no runtime errors.
- **Not verified on the live site:** an actual sign-in/upload (Vercel SSO protection is on, so Playwright cannot reach it without a bypass), and email-confirmation sign-ups.
- Still to do by the project owner in Supabase **Authentication → URL Configuration**: Site URL = the Vercel URL; add `https://schematics-viewer.vercel.app/**` (and the preview pattern) to Redirect URLs. Password sign-in works without it; confirmation emails need it.
- Vercel "Vercel Authentication" (SSO) is enabled on deployments: visitors need a Vercel login until it is disabled in Project Settings → Deployment Protection (owner's decision).

## Latest additions
- Machine search by location/name/manufacturer/model/all (multi-word). Machine hierarchy (`parent_id`) and critical components (`is_critical`) with derived inherited-inoperable state.
  Rule: critical child + unresolved **high/critical** issue ⇒ parent inoperable, propagating only through critical parents; clears automatically on resolution.
- Demo data: Hydraulic Press 7 is **inoperable (inherited)** by default because its critical HPU has an open high issue; resolve "Pump P1 bearing failure" to see it clear (re-run `npm run seed` only re-creates it if missing).
- Decision to confirm with the project owner: "major" = severity high **or** critical (constant `MAJOR_SEVERITIES`; SQL function `inoperable_machines`).
- Open item for the project owner: enable **leaked password protection** in Supabase Auth settings (advisor warning).

## Status and tree list (latest)
- **Effective status** = critical fault (own unresolved critical-severity issue) > inoperable (inherited from a critical sub-component with a high/critical issue) > stored status. Derived live; clears on resolution. Filterable.
- Machines list shows top-level machines only; expand with the chevron, or search/filter to see sub-machines directly. The machine detail page still lists its sub-machines.
- The demo "Pump P1 bearing failure" issue was resolved by a user, so the seeded Hydraulic Press 7 is currently operable; raise a high issue on "Hydraulic Power Unit HPU-7" (a critical component) to see the inheritance, or a *critical* issue to see "critical fault".
- Run E2E against `next start` for reliability (see TESTING.md).

## Locations
- Premade `locations` (name + optional coordinates), managed on **/locations** (button on the Machines page). Machines choose one from a dropdown; weather uses the machine's own coordinates if set, otherwise its location's.
- A "Look up coordinates" button queries the Open-Meteo Geocoding API (no key). Existing free-text locations were converted by migration 9.
- Data note for the project owner: the migrated location **"Shaw South Carolina"** has longitude **+80.4706**. South Carolina is in the western hemisphere, so it should almost certainly be **-80.4706** (edit it on /locations). I did not change your data.

## What was decided
- User chose a hosted Supabase project (ref `pmtdaopxvisqwyhaenvz`, from their MCP link) but then asked to **build the site first** and set up
  `.env.local` themselves. Migrations 1-4 were applied on 2026-10-15 with the user's approval; no rows have been written yet (seed not run).
- GitHub target: <https://github.com/NightmarePaladin/Schematics-Viewer>. This folder is **not yet a git repository / nothing committed or pushed.**
- Vercel link deferred by the user until GitHub + Supabase are working.

## Next steps
1. Connect Vercel (README → Deploying): add `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, then add the Vercel URL to Supabase Auth redirect URLs. Run `E2E_BASE_URL=<url> npm run e2e` against it.
2. Mobile-width pass (sidebar overlay) and the pan tool are the remaining un-automated UI paths.
3. Consider direct-to-storage uploads before relying on >4.5 MB PDFs on Vercel Hobby.

## Known limitations / unfinished
- Not yet checked in a browser: pan tool, mobile-width layout.
- Uploads pass through a Route Handler → Vercel Hobby body limit ≈ 4.5 MB. Use direct signed uploads for large PDFs.
- Only PDF is supported (extensible via `UPLOAD_HANDLERS`).
- Issue list has no pagination; annotations load all pages at once (fine for MVP sizes).
- No realtime collaboration (annotations appear after refresh/save), no email invitations (Admin adds already-registered users by email).
- Machines cannot be deleted from the UI (API `DELETE` exists); storage objects of a deleted machine's schematics are cascaded in DB but not removed from the bucket.
- Weather cache is in-memory per server instance (acceptable on serverless; use Upstash/KV for a shared cache).
- Supabase "Confirm email" setting affects sign-up flow (UI shows a message when confirmation is required).

## Key files
`supabase/migrations/*` · `src/lib/{coords,permissions,schemas,weather,auth,api}.ts` · `src/app/api/**` · `src/components/viewer/*` ·
`scripts/{seed,make-demo-pdf}.ts` · `tests/{unit,integration}` · `e2e/annotation-flow.spec.ts`
