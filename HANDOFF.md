# Handoff

_Last updated: 2026-10-15._

## Where things stand

| Stage | Status | Verified by |
|-------|--------|-------------|
| 1 Scaffold + structure | ✅ done | build, dev server |
| 2 Supabase schema, auth, storage | ✅ applied (5 migrations), advisors reviewed | MCP apply + advisors; 23 RLS/storage tests |
| 3 Machines + PDF upload | ✅ works end to end | Playwright (create machine, upload PDF) |
| 4 Viewer + annotations | ✅ point annotation works: persists, reload + zoom keep position | Playwright |
| 5 Issues + roles/groups/grants | ✅ permissions verified in DB and for the Viewer role in the UI; ⚠️ issue/log/grant **UI flows** not clicked through by an automated test | RLS tests, Playwright step 8 |
| 6 Open-Meteo | ✅ verified against the real API; ⚠️ weather panel on a machine page not yet checked in a browser | live tests |
| 7 Tests, docs, deploy prep | ✅ docs + suites run (see TESTING.md); Vercel deploy not done | — |

## What was decided
- User chose a hosted Supabase project (ref `pmtdaopxvisqwyhaenvz`, from their MCP link) but then asked to **build the site first** and set up
  `.env.local` themselves. Migrations 1-4 were applied on 2026-10-15 with the user's approval; no rows have been written yet (seed not run).
- GitHub target: <https://github.com/NightmarePaladin/Schematics-Viewer>. This folder is **not yet a git repository / nothing committed or pushed.**
- Vercel link deferred by the user until GitHub + Supabase are working.

## Next steps
1. Manually click through: draw a box/callout, reply in a thread, create an issue from an annotation and resolve it, grant a group access in the Access tab, view weather on the seeded "Outdoor Compressor C2" page, rotate the view and confirm markers stay put.
2. `git init`, add the GitHub remote, commit, push (nothing is committed yet). Then connect Vercel (README → Deploying) and add the Vercel URL to Supabase redirect URLs.
3. Optional cleanup of E2E leftovers: delete machines named "E2E Test Pump" from the dev project.

## Known limitations / unfinished
- Not yet checked in a browser: pan, box/callout drawing, rotation, mobile sidebar overlay, issue/grant UI flows.
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
