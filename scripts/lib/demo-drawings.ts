/** Shared by the seed script and the local test-drawing generator: demo drawing sets and a PDF renderer (no credentials needed). */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface S { machine: string; title: string; doc: string; rev: string; pages: string[][] }
export const SCHEMATICS: S[] = [
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
export const bx = (col: number) => 0.08 + 0.3 * col;
export const by = (row: number) => 0.22 + 0.33 * row;
export const BW = 0.24;
export const BH = 0.2;
export const block = (i: number) => ({ x: bx(i % 3), y: by(Math.floor(i / 3)), width: BW, height: BH });

export async function makePdf(s: S): Promise<Uint8Array> {
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

