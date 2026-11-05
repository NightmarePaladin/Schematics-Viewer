/**
 * Extra test data for one account: a machine hierarchy, generated drawing sets (real PDFs with searchable text), and a few
 * annotations including links between parent and sub-machine drawings. Safe to re-run (everything is keyed by serial / document number).
 *
 *   npm run seed:bob                      # defaults to bob@bob.com in "Acme Industrial (demo)"
 *   SEED_EMAIL=you@x.com SEED_ORG="My Org" npm run seed:bob
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY in .env.local (see .env.example). Never run this from the web app.
 * Remove the data again with:  npm run seed:bob -- --remove
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { adminClient, hasSupabaseCreds } from "./lib/seed-lib";

const EMAIL = process.env.SEED_EMAIL ?? "bob@bob.com";
const ORG_NAME = process.env.SEED_ORG ?? "Acme Industrial (demo)";
const TAG = "BOBTEST-";

interface M { serial: string; name: string; cat: string; model: string; parent?: string; critical?: boolean; place: string; descr: string }
const MACHINES: M[] = [
  { serial: "PKG3", name: "Packaging Line 3", cat: "Packaging", model: "PKG-3000", place: "Plant 1 / Bay 3", descr: "Test data: end-of-line packaging system with conveyor and control cabinet." },
  { serial: "CNC5", name: "CNC Mill 5", cat: "Machining", model: "CNC-5X", place: "Plant 1 / Bay 3", descr: "Test data: 5-axis mill with spindle and coolant subsystems." },
  { serial: "AH2", name: "Air Handler AH-2", cat: "HVAC", model: "AH-200", place: "Plant 1 roof", descr: "Test data: standalone unit with a 3-page drawing set (thumbnails, search)." },
  { serial: "C12", name: "Conveyor C-12", cat: "Conveyor", model: "CNV-12", parent: "PKG3", place: "Plant 1 / Bay 3", descr: "Test data: infeed conveyor." },
  { serial: "PC3", name: "Control Cabinet PC-3", cat: "Controls", model: "CAB-3", parent: "PKG3", critical: true, place: "Plant 1 / Bay 3", descr: "Test data: line control cabinet." },
  { serial: "SP5", name: "Spindle Assembly SP-5", cat: "Spindle", model: "SPN-5", parent: "CNC5", critical: true, place: "Plant 1 / Bay 3", descr: "Test data: spindle." },
  { serial: "CP5", name: "Coolant Pump CP-5", cat: "Pump", model: "CPM-5", parent: "CNC5", place: "Plant 1 / Bay 3", descr: "Test data: coolant pump." },
  { serial: "M12", name: "Drive Motor M-12", cat: "Motor", model: "MTR-12", parent: "C12", critical: true, place: "Plant 1 / Bay 3", descr: "Test data: conveyor drive motor." },
  { serial: "R1", name: "PLC Rack R1", cat: "Controls", model: "PLC-R1", parent: "PC3", place: "Plant 1 / Bay 3", descr: "Test data: PLC rack inside PC-3." },
];

interface S { machine: string; title: string; doc: string; rev: string; pages: string[][] }
const SCHEMATICS: S[] = [
  { machine: "PKG3", title: "Packaging Line 3 - System overview", doc: "PKG3-100", rev: "A", pages: [["Conveyor C-12", "Control Cabinet PC-3", "Infeed Sensor S1"], ["Pallet Wrapper W1", "Labeler L2", "Case Packer CP1", "Main Disconnect Q1", "Air Supply AV-3", "E-Stop Chain ES"]] },
  { machine: "C12", title: "Conveyor C-12 - Layout and sensors", doc: "CNV12-200", rev: "B", pages: [["Drive Motor M-12", "Gearbox GB-12", "Belt Tracking BT-12"], ["Photo-eye PE-1", "Photo-eye PE-2", "Limit Switch LS-4"]] },
  { machine: "M12", title: "Drive Motor M-12 - Power and control", doc: "MTR12-300", rev: "A", pages: [["Motor M-12 (5 HP)", "VFD D-12", "Overload OL-1", "Brake BR-12", "Encoder E-12", "Terminal Box TB-12"]] },
  { machine: "PC3", title: "Control Cabinet PC-3 - Panel schematic", doc: "PC3-210", rev: "C", pages: [["PLC Rack R1", "24VDC Supply PS-1", "Safety Relay SR-1"], ["Contactor K1", "Contactor K4", "Fuse Block F1-F6"]] },
  { machine: "R1", title: "PLC Rack R1 - I/O map", doc: "PLCR1-310", rev: "A", pages: [["CPU Module 1", "Digital In DI-16", "Digital Out DO-16", "Analog In AI-8", "Ethernet Switch ES-1", "HMI Port"]] },
  { machine: "CNC5", title: "CNC Mill 5 - System overview", doc: "CNC5-100", rev: "A", pages: [["Spindle Assembly SP-5", "Coolant Pump CP-5", "Tool Changer TC-5"], ["X-Axis Servo", "Y-Axis Servo", "Z-Axis Servo"]] },
  { machine: "SP5", title: "Spindle Assembly SP-5 - Assembly drawing", doc: "SP5-200", rev: "A", pages: [["Spindle Motor", "Drawbar", "Chiller Loop", "Encoder", "Bearing Preload", "Lube Line"]] },
  { machine: "CP5", title: "Coolant Pump CP-5 - Hydraulic schematic", doc: "CP5-210", rev: "A", pages: [["Pump P-5", "Level Switch LV-5", "Filter F-5"]] },
  { machine: "AH2", title: "Air Handler AH-2 - Drawing set", doc: "AH2-100", rev: "A", pages: [["Supply Fan SF-1", "Heating Coil HC-1", "Cooling Coil CC-1"], ["Damper Actuator DA-1", "Filter Bank FB-1", "Temp Sensor TS-2"], ["VFD V-2", "Controller C-2", "Disconnect Q-2"]] },
];

// Block layout, as fractions of the page from the top-left. Annotations below use the same numbers.
const bx = (col: number) => 0.08 + 0.3 * col;
const by = (row: number) => 0.22 + 0.33 * row;
const BW = 0.24;
const BH = 0.2;
const block = (i: number) => ({ x: bx(i % 3), y: by(Math.floor(i / 3)), width: BW, height: BH });

async function makePdf(s: S): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 792;
  const H = 612;
  s.pages.forEach((labels, pi) => {
    const page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 20, y: 20, width: W - 40, height: H - 40, borderColor: rgb(0, 0, 0), borderWidth: 1.5 });
    page.drawText(s.title, { x: 40, y: H - 52, size: 16, font: bold });
    page.drawText(`Doc ${s.doc}   Rev ${s.rev}   Sheet ${pi + 1} of ${s.pages.length}   (demo test data)`, { x: 40, y: H - 72, size: 10, font });
    labels.forEach((label, i) => {
      const b = block(i);
      const x = b.x * W;
      const w = b.width * W;
      const h = b.height * H;
      const y = H - b.y * H - h;
      page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.1, 0.1, 0.4), borderWidth: 1.5, color: rgb(0.95, 0.96, 1) });
      const tw = bold.widthOfTextAtSize(label, 11);
      page.drawText(label, { x: x + Math.max(4, (w - tw) / 2), y: y + h / 2 - 4, size: 11, font: bold });
      page.drawText(`W${pi + 1}${Math.floor(i / 3)}${i % 3}1`, { x: x + 6, y: y + 8, size: 8, font });
      if (i % 3 < 2 && labels[i + 1]) page.drawLine({ start: { x: x + w, y: y + h / 2 }, end: { x: bx((i % 3) + 1) * W, y: y + h / 2 }, thickness: 1.2, color: rgb(0.2, 0.2, 0.2) });
      if (i < 3 && labels[i + 3]) page.drawLine({ start: { x: x + w / 2, y }, end: { x: x + w / 2, y: H - by(1) * H }, thickness: 1.2, color: rgb(0.2, 0.2, 0.2) });
    });
    page.drawText(`${s.doc} / sheet ${pi + 1}`, { x: W - 190, y: 32, size: 9, font });
  });
  return pdf.save();
}

async function main() {
  if (!hasSupabaseCreds()) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, a public key and SUPABASE_SERVICE_ROLE_KEY in .env.local first.");
  const sb = adminClient();
  const remove = process.argv.includes("--remove");

  const { data: profile } = await sb.from("profiles").select("id").ilike("email", EMAIL).maybeSingle();
  if (!profile) throw new Error(`No account with email ${EMAIL}`);
  const { data: mem } = await sb.from("organization_memberships").select("org_id, organizations!inner(name)").eq("user_id", profile.id);
  const org = (mem ?? []).find((m) => (m.organizations as unknown as { name: string }).name === ORG_NAME);
  if (!org) throw new Error(`${EMAIL} is not a member of "${ORG_NAME}"`);
  const orgId = org.org_id as string;
  console.log(`Account ${EMAIL} in "${ORG_NAME}"`);

  if (remove) {
    const { data: ms } = await sb.from("machines").select("id").eq("org_id", orgId).like("serial_number", `${TAG}%`);
    const ids = (ms ?? []).map((m) => m.id as string);
    if (ids.length) {
      const { data: ss } = await sb.from("schematics").select("id, storage_path").in("machine_id", ids);
      if (ss?.length) await sb.storage.from("schematics").remove(ss.map((x) => x.storage_path as string));
      await sb.from("machines").delete().in("id", ids); // schematics, annotations cascade
    }
    console.log(`Removed ${ids.length} machines and their drawings.`);
    return;
  }

  // machines (parents first)
  const machineId = new Map<string, string>();
  for (const m of MACHINES) {
    const serial = TAG + m.serial;
    const { data: existing } = await sb.from("machines").select("id").eq("org_id", orgId).eq("serial_number", serial).maybeSingle();
    if (existing) { machineId.set(m.serial, existing.id as string); continue; }
    const { data: place } = await sb.from("locations").select("id").eq("org_id", orgId).eq("name", m.place).maybeSingle();
    const { data, error } = await sb.from("machines").insert({
      org_id: orgId, name: m.name, category: m.cat, manufacturer: "Demo Works", model_number: m.model, serial_number: serial,
      description: m.descr, created_by: profile.id, is_critical: !!m.critical, location_id: place?.id ?? null,
      parent_id: m.parent ? machineId.get(m.parent) : null, installed_on: "2024-03-01",
    }).select("id").single();
    if (error) throw new Error(`machine ${m.name}: ${error.message}`);
    machineId.set(m.serial, data.id as string);
  }
  console.log(`Machines ready: ${machineId.size}`);

  // schematics: row + generated PDF
  const schematicId = new Map<string, string>();
  for (const s of SCHEMATICS) {
    const { data: found } = await sb.from("schematics").select("id").eq("org_id", orgId).eq("document_number", s.doc).maybeSingle();
    const id = (found?.id as string | undefined) ?? crypto.randomUUID();
    const bytes = await makePdf(s);
    const path = `${orgId}/${id}.pdf`;
    if (!found) {
      const ins = await sb.from("schematics").insert({
        id, org_id: orgId, machine_id: machineId.get(s.machine), title: s.title, document_number: s.doc, revision: s.rev,
        storage_path: path, file_size: bytes.length, mime_type: "application/pdf", uploaded_by: profile.id,
      });
      if (ins.error) throw new Error(`schematic ${s.doc}: ${ins.error.message}`);
    }
    const up = await sb.storage.from("schematics").upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error(`upload ${s.doc}: ${up.error.message}`);
    await sb.from("schematics").update({ file_size: bytes.length }).eq("id", id);
    schematicId.set(s.machine, id);
  }
  console.log(`Drawings ready: ${schematicId.size}`);

  // annotations (skipped for a drawing that already has some)
  type A = { sch: string; page: number; type: string; body: string; status?: string; at: { x: number; y: number; width?: number; height?: number }; link?: string; path?: number[][] };
  const A_: A[] = [
    { sch: "PKG3", page: 1, type: "box", body: "Infeed conveyor: open its drawing", at: block(0), link: "C12" },
    { sch: "PKG3", page: 1, type: "box", body: "Line control cabinet", at: block(1), link: "PC3" },
    { sch: "PKG3", page: 1, type: "point", body: "Check sensor alignment", status: "open", at: { x: 0.82, y: 0.32 } },
    { sch: "PKG3", page: 2, type: "highlight", body: "E-stop chain: verify after rewiring", status: "in_progress", at: block(5) },
    { sch: "PKG3", page: 2, type: "arrow", body: "Disconnect location", at: { x: 0.3, y: 0.5 }, path: [[0.32, 0.5], [0.2, 0.6]] },
    { sch: "PKG3", page: 2, type: "comment", body: "Air supply regulator needs a new gauge.", status: "open", at: { x: 0.5, y: 0.62 } },
    { sch: "C12", page: 1, type: "box", body: "Drive motor: open its drawing", at: block(0), link: "M12" },
    { sch: "PC3", page: 1, type: "box", body: "PLC rack: open its I/O map", at: block(0), link: "R1" },
    { sch: "CNC5", page: 1, type: "box", body: "Spindle: open its drawing", at: block(0), link: "SP5" },
    { sch: "CNC5", page: 1, type: "box", body: "Coolant pump: open its drawing", at: block(1), link: "CP5" },
    { sch: "AH2", page: 2, type: "comment", body: "Filter bank last changed in March.", status: "resolved", at: { x: 0.45, y: 0.3 } },
    { sch: "AH2", page: 3, type: "pen", body: "Sketch of the wiring change", at: { x: 0.2, y: 0.25 }, path: [[0.2, 0.25], [0.3, 0.35], [0.4, 0.25], [0.5, 0.35], [0.6, 0.25]] },
  ];
  const seeded = new Set<string>(); // drawings that already carry annotations are left alone
  for (const sid of schematicId.values()) {
    const { count } = await sb.from("annotations").select("id", { count: "exact", head: true }).eq("schematic_id", sid);
    if (count) seeded.add(sid);
  }
  const done = new Set<string>();
  for (const a of A_) {
    const sid = schematicId.get(a.sch)!;
    if (seeded.has(sid)) continue;
    const { error } = await sb.from("annotations").insert({
      org_id: orgId, schematic_id: sid, page_number: a.page, type: a.type, body: a.body, status: a.status ?? null, author_id: profile.id,
      x: a.at.x, y: a.at.y, width: a.at.width ?? null, height: a.at.height ?? null,
      linked_schematic_id: a.link ? schematicId.get(a.link) : null, path: a.path ?? null,
    });
    if (error) throw new Error(`annotation on ${a.sch}: ${error.message}`);
    done.add(sid);
  }
  console.log(`Annotated ${done.size} drawings. Sign in as ${EMAIL} and switch to "${ORG_NAME}".`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
