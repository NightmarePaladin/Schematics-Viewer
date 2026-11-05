/**
 * Browser-side PDF export: draws the notes (points, comments, boxes, callouts, highlights, pen strokes, arrows) onto a copy of the
 * drawing and optionally appends a notes list. Runs in the browser, so there is no server upload limit and it works offline.
 * The original file is never modified.
 */
import type { PDFFont, PDFPage } from "pdf-lib";
import { PALETTES, type A11yPrefs } from "@/lib/accessibility";
import type { Ann, Path } from "@/components/viewer/types";

export interface ExportOptions {
  pdfBytes: Uint8Array;
  annotations: Ann[];
  title: string;
  revision: string;
  includeAnnotations: boolean;
  summaryPage: boolean;
  exportedBy?: string;
  /** colour palette for status colours (defaults to the standard one) */
  palette?: A11yPrefs["cvd"];
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
function colorOf(status: string | null, palette: A11yPrefs["cvd"]): [number, number, number] {
  const p = PALETTES[palette] ?? PALETTES.none;
  return hex(status === "open" || status === "in_progress" || status === "resolved" ? p[status] : p.none);
}

/** Standard PDF fonts only cover Latin-1: swap common typographic characters and replace anything else. */
export function clean(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[\r\t]/g, " ")
    .replace(/[^\n\x20-\x7e\xa0-\xff]/gu, "?"); // `u`: one replacement per character, even outside the BMP
}

/** Greedy word wrap using real glyph widths. */
export function wrap(text: string, font: Pick<PDFFont, "widthOfTextAtSize">, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of clean(text).split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth || !line) line = next;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Map a point stored as fractions of the page in the DISPLAY frame (origin top-left, with the page's own rotation applied)
 * to PDF user space (origin bottom-left, unrotated media box).
 */
export function toUser(nx: number, ny: number, W: number, H: number, rotation: number): { x: number; y: number } {
  switch (((rotation % 360) + 360) % 360) {
    case 90: return { x: ny * W, y: nx * H };
    case 180: return { x: W - nx * W, y: ny * H };
    case 270: return { x: W - ny * W, y: H - nx * H };
    default: return { x: nx * W, y: H - ny * H };
  }
}

export async function buildExport(o: ExportOptions): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb, degrees } = await import("pdf-lib");
  const doc = await PDFDocument.load(o.pdfBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  const numbered = o.annotations.map((a, i) => ({ a, n: i + 1 }));

  if (o.includeAnnotations) {
    for (const { a, n } of numbered) {
      const page = pages[a.page_number - 1];
      if (!page) continue;
      drawAnnotation(page, a, n, { rgb, degrees, bold, palette: o.palette ?? "none" });
    }
  }

  const stamp = clean(`Exported ${new Date().toISOString().slice(0, 10)}${o.exportedBy ? ` by ${o.exportedBy}` : ""} - ${o.title} rev ${o.revision}`);
  for (const page of pages) {
    const rot = page.getRotation().angle;
    const { width: W, height: H } = page.getSize();
    const at = toUser(0.02, 0.992, W, H, rot);
    page.drawText(stamp, { x: at.x, y: at.y, size: 6, font, color: rgb(0.45, 0.45, 0.45), rotate: degrees(rot) });
  }

  if (o.summaryPage && o.annotations.length) addSummary(doc, o, numbered, font, bold, rgb);
  return doc.save();
}

type Pdf = typeof import("pdf-lib");

function drawAnnotation(page: PDFPage, a: Ann, n: number, k: { rgb: Pdf["rgb"]; degrees: Pdf["degrees"]; bold: PDFFont; palette: A11yPrefs["cvd"] }) {
  const { rgb, degrees, bold } = k;
  const rot = page.getRotation().angle;
  const { width: W, height: H } = page.getSize();
  const u = (x: number, y: number) => toUser(x, y, W, H, rot);
  const [r, g, b] = colorOf(a.status, k.palette);
  const col = rgb(r, g, b);
  const badge = (x: number, y: number, size = 8) => {
    page.drawCircle({ x, y, size, color: col, borderColor: rgb(1, 1, 1), borderWidth: 1 });
    const label = String(n);
    const w = bold.widthOfTextAtSize(label, 8);
    // keep the number upright on rotated pages (approximate centring is fine for a 1-3 digit label)
    const off = { x: -w / 2, y: -3 };
    const ang = (rot * Math.PI) / 180;
    page.drawText(label, {
      x: x + off.x * Math.cos(ang) - off.y * Math.sin(ang),
      y: y + off.x * Math.sin(ang) + off.y * Math.cos(ang),
      size: 8, font: bold, color: rgb(1, 1, 1), rotate: degrees(rot),
    });
  };

  if ((a.type === "pen" || a.type === "arrow") && a.path && a.path.length >= 2) {
    const pts = (a.path as Path).map(([x, y]) => u(x, y));
    for (let i = 1; i < pts.length; i++) page.drawLine({ start: pts[i - 1], end: pts[i], thickness: 2, color: col });
    if (a.type === "arrow") {
      const p = pts[pts.length - 2];
      const q = pts[pts.length - 1];
      const ang = Math.atan2(q.y - p.y, q.x - p.x);
      for (const d of [0.45, -0.45]) {
        page.drawLine({ start: q, end: { x: q.x - 10 * Math.cos(ang - d), y: q.y - 10 * Math.sin(ang - d) }, thickness: 2, color: col });
      }
    }
    badge(pts[0].x, pts[0].y, 7);
    return;
  }

  if ((a.type === "box" || a.type === "callout" || a.type === "highlight") && a.width && a.height) {
    const p1 = u(a.x, a.y);
    const p2 = u(a.x + a.width, a.y + a.height);
    const x = Math.min(p1.x, p2.x);
    const y = Math.min(p1.y, p2.y);
    const w = Math.abs(p1.x - p2.x);
    const h = Math.abs(p1.y - p2.y);
    if (a.type === "highlight") {
      page.drawRectangle({ x, y, width: w, height: h, color: rgb(0.98, 0.8, 0.08), opacity: 0.35 });
    } else {
      page.drawRectangle({
        x, y, width: w, height: h, color: col, opacity: a.type === "box" ? 0.14 : 0.08, borderColor: col, borderWidth: 1.5, borderOpacity: 1,
        borderDashArray: a.type === "callout" ? [6, 3] : undefined,
      });
    }
    badge(p1.x, p1.y, 8);
    return;
  }

  const c = u(a.x, a.y);
  badge(c.x, c.y, 8);
}

function addSummary(doc: import("pdf-lib").PDFDocument, o: ExportOptions, items: { a: Ann; n: number }[], font: PDFFont, bold: PDFFont, rgb: Pdf["rgb"]) {
  const W = 612;
  const H = 792;
  const M = 48;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const heading = (t: string) => { page.drawText(clean(t), { x: M, y, size: 14, font: bold }); y -= 22; };
  const ensure = (need: number) => {
    if (y - need < M) { page = doc.addPage([W, H]); y = H - M; }
  };
  heading(`Notes - ${o.title} (rev ${o.revision})`);
  for (const { a, n } of items) {
    const author = Array.isArray(a.author) ? a.author[0]?.display_name : a.author?.display_name;
    const meta = clean(`#${n}  page ${a.page_number}  ${a.type}${a.status ? `  ${a.status.replace("_", " ")}` : ""}${author ? `  ${author}` : ""}  ${a.created_at.slice(0, 10)}`);
    const body = wrap(a.body || "(no text)", font, 10, W - 2 * M);
    ensure(14 + body.length * 12 + 10);
    page.drawText(meta, { x: M, y, size: 9, font: bold, color: rgb(0.2, 0.2, 0.2) });
    y -= 13;
    for (const line of body) { page.drawText(line, { x: M, y, size: 10, font }); y -= 12; }
    y -= 8;
  }
}
