/**
 * Generates a synthetic, non-proprietary 2-page hydraulic schematic for demos and tests.
 * Output: samples/demo-hydraulic-schematic.pdf   (run: npm run demo-pdf)
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const W = 792; // US Letter landscape
const H = 612;

export async function buildDemoPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("SYNTHETIC DEMO - Hydraulic Power Unit");
  pdf.setAuthor("SchematicHub demo data");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.15);

  const frame = (page: ReturnType<typeof pdf.addPage>, title: string, sheet: string) => {
    page.drawRectangle({ x: 20, y: 20, width: W - 40, height: H - 40, borderColor: ink, borderWidth: 1.5 });
    page.drawRectangle({ x: W - 270, y: 20, width: 250, height: 60, borderColor: ink, borderWidth: 1 });
    page.drawText(title, { x: W - 262, y: 58, size: 11, font: bold, color: ink });
    page.drawText("DWG DEMO-1042   REV A   SYNTHETIC - NOT FOR USE", { x: W - 262, y: 42, size: 7, font, color: ink });
    page.drawText(`SHEET ${sheet}`, { x: W - 262, y: 28, size: 8, font, color: ink });
  };
  const box = (page: ReturnType<typeof pdf.addPage>, x: number, y: number, w: number, h: number, label: string) => {
    page.drawRectangle({ x, y, width: w, height: h, borderColor: ink, borderWidth: 1.2 });
    page.drawText(label, { x: x + 6, y: y + h / 2 - 3, size: 9, font: bold, color: ink });
  };
  const line = (page: ReturnType<typeof pdf.addPage>, x1: number, y1: number, x2: number, y2: number) =>
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 1.2, color: ink });

  const p1 = pdf.addPage([W, H]);
  frame(p1, "HYDRAULIC POWER UNIT - CIRCUIT", "1 / 2");
  box(p1, 60, 400, 110, 60, "RESERVOIR T1");
  box(p1, 260, 400, 110, 60, "PUMP P1");
  box(p1, 460, 400, 110, 60, "RELIEF V1");
  box(p1, 460, 260, 110, 60, "FILTER F1");
  box(p1, 260, 260, 110, 60, "VALVE SV2");
  box(p1, 60, 260, 110, 60, "CYLINDER C1");
  line(p1, 170, 430, 260, 430);
  line(p1, 370, 430, 460, 430);
  line(p1, 515, 400, 515, 320);
  line(p1, 460, 290, 370, 290);
  line(p1, 260, 290, 170, 290);
  p1.drawText("Pressure line 210 bar max", { x: 380, y: 438, size: 8, font, color: ink });
  p1.drawText("Return line", { x: 380, y: 298, size: 8, font, color: ink });
  p1.drawText("NOTE: Verify SV2 coil resistance 24 VDC", { x: 60, y: 120, size: 9, font, color: ink });

  const p2 = pdf.addPage([W, H]);
  frame(p2, "HYDRAULIC POWER UNIT - CONTROL WIRING", "2 / 2");
  box(p2, 80, 380, 130, 70, "PLC DI/DO");
  box(p2, 330, 380, 130, 70, "RELAY K1");
  box(p2, 560, 380, 130, 70, "SOLENOID SV2");
  box(p2, 330, 220, 130, 70, "PRESSURE SW");
  line(p2, 210, 415, 330, 415);
  line(p2, 460, 415, 560, 415);
  line(p2, 395, 380, 395, 290);
  p2.drawText("24 VDC", { x: 250, y: 422, size: 8, font, color: ink });
  p2.drawText("Fuse F3 - 2 A", { x: 480, y: 422, size: 8, font, color: ink });

  return pdf.save();
}

async function main() {
  const out = path.join(process.cwd(), "samples", "demo-hydraulic-schematic.pdf");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, await buildDemoPdf());
  console.log(`Wrote ${out}`);
}

if (process.argv[1]?.includes("make-demo-pdf")) void main();
