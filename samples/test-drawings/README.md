# Test drawings

Generate the PDFs (they are git-ignored; each run produces the same files):

```bash
npm run test-drawings
```

Upload them in the app: open a machine → **Upload schematic** (title, document number and revision are in each file name).
The machines below already exist for **bob@bob.com** in **Acme Industrial (demo)** (serials `BOBTEST-…`).

| # | File | Upload to machine | What it is for |
|---|------|-------------------|----------------|
| 01 | Packaging Line 3 - PKG3-100 rev A | Packaging Line 3 | Parent drawing, 2 pages. Blocks are labelled Conveyor C-12, Control Cabinet PC-3 … |
| 02 | Conveyor C-12 - CNV12-200 rev B | Conveyor C-12 | Child of Line 3, parent of the motor |
| 03 | Drive Motor M-12 - MTR12-300 rev A | Drive Motor M-12 | Grandchild (link chain Line 3 → C-12 → M-12) |
| 04 | Control Cabinet PC-3 - PC3-210 rev C | Control Cabinet PC-3 | Second child of Line 3 |
| 05 | PLC Rack R1 - PLCR1-310 rev A | PLC Rack R1 | Child of PC-3 |
| 06 | CNC Mill 5 - CNC5-100 rev A | CNC Mill 5 | Second system |
| 07 | Spindle Assembly SP-5 - SP5-200 rev A | Spindle Assembly SP-5 | Child of CNC 5 (critical) |
| 08 | Coolant Pump CP-5 - CP5-210 rev A | Coolant Pump CP-5 | Child of CNC 5 |
| 09 | Air Handler AH-2 - AH2-100 rev A | Air Handler AH-2 | 3 pages: thumbnails, page jump, revisions |
| 10 | AH2-100 rev B | (new revision of 09) | Upload via the drawing's **Details → Upload a new revision** |
| 11 | TEST rotated pages | any machine | Pages rotated 0/90/180/270 |
| 12 | TEST large format A1 | any machine | One huge page with ~190 labelled parts (K1…K190) |
| 13 | TEST no text layer | any machine | Drawing with no searchable text |
| 14 | TEST heavy 7MB | any machine | Over Vercel's ~4.5 MB request limit: **expected to fail** until direct-to-storage uploads exist |

## Things to try

**Links** (needs 01–05)
1. On 01 page 1 use the Issue box tool around "Conveyor C-12", save with *Links to schematic* = Conveyor C-12. Tap the box: you get "Open the schematic for this part?".
2. Open it: a *Back to Packaging Line 3* chip and the trail *Packaging Line 3 › Conveyor C-12* appear. In 02's Details tab, "Referenced from" lists the box.
3. Create a link with *Opens on* = a specific pin on the target.
4. **Break it:** edit machine *Conveyor C-12* and set its parent to *CNC Mill 5*. Reopen 01: the box shows a red "!", the panel shows who removed the part and when, and offers *Replace with another part* or *Remove link permanently*. The author gets a bell notification.

**Reading**: thumbnails on 09 (`T`) and 12; search `K42`, `Relay`, `SF-1` (`/` or Ctrl+F); search on 13 says "No matches"; filter notes by status/type/"Mine".

**Markup**: pen, arrow, highlighter (phone: pencil button). Use them on 11 and rotate the view.

**Export / share**: on 11, add a note on every page, then Export: check the marks line up on the rotated pages. Create a share link (1 day), open it in a private window, revoke it, confirm it stops working.

**Tool limits**: Settings → Tool permissions: set *Highlighter* to "Maintenance manager and up", then sign in as a technician (`tech@schematichub.test`; the demo password is `SEED_PASSWORD`, default in `.env.example`) and check the tool is gone.

**Revisions**: put a few notes on 09, then upload 10 as a new revision: the stale-notes banner appears and *Rev A* opens read-only with a "Superseded" banner.

**Also**: open a drawing, go offline in DevTools, reload (offline copy chip); open one drawing in two browsers to see notes appear live; reply as another user to see the bell; add a photo or voice note to a note; print a machine QR label and scan it (goes straight to the drawing when the machine has exactly one).
