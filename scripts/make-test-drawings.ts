/**
 * Generates a folder of test PDFs (no credentials, no network): the 9 demo drawings plus a few special-purpose files that each
 * exercise one feature. Upload them through the app (machine page -> Upload) and follow samples/test-drawings/README.md.
 *
 *   npm run test-drawings
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { PNG } from "pngjs";
import { makePdf, SCHEMATICS, type S } from "./lib/demo-drawings";

const OUT = path.join("samples", "test-drawings");
const MACHINE_NAME: Record<string, string> = {
  PKG3: "Packaging Line 3", C12: "Conveyor C-12", M12: "Drive Motor M-12", PC3: "Control Cabinet PC-3", R1: "PLC Rack R1",
  CNC5: "CNC Mill 5", SP5: "Spindle Assembly SP-5", CP5: "Coolant Pump CP-5", AH2: "Air Handler AH-2",
};

const written: { file: string; bytes: number }[] = [];
async function save(name: string, bytes: Uint8Array) {
  await writeFile(path.join(OUT, name), bytes);
  written.push({ file: name, bytes: bytes.length });
}

/** 4 pages, each carrying a different intrinsic /Rotate: exercises display rotation, annotation placement and export alignment. */
async function rotated(): Promise<Uint8Array> {
  const src = await PDFDocument.load(await makePdf({ machine: "AH2", title: "Rotation test drawing", doc: "ROT-1", rev: "A", pages: [["North block", "East block", "South block"], ["West block", "Up block", "Down block"], ["Left", "Middle", "Right"], ["Alpha", "Beta", "Gamma"]] }));
  src.getPages().forEach((p, i) => p.setRotation(degrees(i * 90)));
  return src.save();
}

/** One A1 page with ~190 small labelled parts: zoom, pan, pinch, thumbnails and text search all get a workout. */
async function bigSheet(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 1684;
  const H = 2384;
  const page = pdf.addPage([W, H]);
  page.drawRectangle({ x: 30, y: 30, width: W - 60, height: H - 60, borderColor: rgb(0, 0, 0), borderWidth: 3 });
  page.drawText("LARGE FORMAT TEST SHEET (A1)  Doc A1-001  Rev A", { x: 60, y: H - 90, size: 34, font: bold });
  const cols = 10;
  const rows = 19;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = 70 + c * 156;
      const y = H - 190 - r * 118;
      page.drawRectangle({ x, y: y - 70, width: 130, height: 70, borderColor: rgb(0.1, 0.1, 0.4), borderWidth: 1, color: rgb(0.96, 0.97, 1) });
      page.drawText(`K${r * cols + c + 1}`, { x: x + 8, y: y - 28, size: 16, font: bold });
      page.drawText(`Relay ${String.fromCharCode(65 + (c % 26))}${r + 1}`, { x: x + 8, y: y - 50, size: 9, font });
      if (c < cols - 1) page.drawLine({ start: { x: x + 130, y: y - 35 }, end: { x: x + 156, y: y - 35 }, thickness: 1, color: rgb(0.3, 0.3, 0.3) });
    }
  }
  return pdf.save();
}

/** Vector shapes only, no text layer at all: the search should report "No matches" (like a scanned drawing). */
async function noText(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([792, 612]);
  page.drawRectangle({ x: 20, y: 20, width: 752, height: 572, borderColor: rgb(0, 0, 0), borderWidth: 1.5 });
  for (let i = 0; i < 6; i++) {
    page.drawRectangle({ x: 70 + (i % 3) * 230, y: 330 - Math.floor(i / 3) * 190, width: 190, height: 120, borderColor: rgb(0.1, 0.1, 0.4), borderWidth: 1.5 });
    page.drawCircle({ x: 165 + (i % 3) * 230, y: 390 - Math.floor(i / 3) * 190, size: 22, borderColor: rgb(0.6, 0.1, 0.1), borderWidth: 1.5 });
  }
  return pdf.save();
}

/** ~7 MB of incompressible image data inside a one-page PDF: above Vercel's ~4.5 MB request limit, under the app's 25 MB cap. */
async function heavy(): Promise<Uint8Array> {
  const size = 1500;
  const png = new PNG({ width: size, height: size, colorType: 2, inputHasAlpha: false });
  let seed = 123456789;
  for (let i = 0; i < png.data.length; i++) {
    seed = (1664525 * seed + 1013904223) >>> 0; // deterministic noise
    png.data[i] = i % 4 === 3 ? 255 : seed >>> 24;
  }
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const img = await pdf.embedPng(PNG.sync.write(png, { colorType: 2, inputColorType: 6, inputHasAlpha: true, deflateLevel: 0 }));
  const page = pdf.addPage([792, 612]);
  page.drawImage(img, { x: 56, y: 20, width: 680, height: 540 });
  page.drawText("HEAVY FILE TEST (about 7 MB)  Doc HVY-1  Rev A", { x: 56, y: 575, size: 16, font });
  return pdf.save();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  let n = 1;
  for (const s of SCHEMATICS) {
    await save(`${String(n++).padStart(2, "0")} - ${MACHINE_NAME[s.machine]} - ${s.doc} rev ${s.rev}.pdf`, await makePdf(s));
  }
  // the AH-2 set again as revision B with one block renamed: upload it as a NEW REVISION of AH2-100
  const ah2 = SCHEMATICS.find((s) => s.machine === "AH2")!;
  const revB: S = { ...ah2, rev: "B", pages: ah2.pages.map((p, i) => (i === 0 ? ["Supply Fan SF-1B (upgraded)", ...p.slice(1)] : p)) };
  await save("10 - Air Handler AH-2 - AH2-100 rev B (use as new revision).pdf", await makePdf(revB));
  await save("11 - TEST rotated pages 0-90-180-270.pdf", await rotated());
  await save("12 - TEST large format A1.pdf", await bigSheet());
  await save("13 - TEST no text layer.pdf", await noText());
  await save("14 - TEST heavy 7MB (expected to fail upload on Vercel).pdf", await heavy());
  for (const w of written) console.log(`${(w.bytes / 1024).toFixed(0).padStart(6)} KB  ${w.file}`);
  console.log(`\nWrote ${written.length} files to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
