import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { Ann } from "@/components/viewer/types";
import { buildExport, clean, toUser, wrap } from "@/lib/export-pdf";

const W = 600;
const H = 400;

describe("toUser: display fractions -> PDF user space", () => {
  it("unrotated: top-left is (0,H), bottom-right is (W,0)", () => {
    expect(toUser(0, 0, W, H, 0)).toEqual({ x: 0, y: H });
    expect(toUser(1, 1, W, H, 0)).toEqual({ x: W, y: 0 });
  });

  it("rotated 90 clockwise: the display's top-left is the page's bottom-left, top-right is the page's top-left", () => {
    expect(toUser(0, 0, W, H, 90)).toEqual({ x: 0, y: 0 });
    expect(toUser(1, 0, W, H, 90)).toEqual({ x: 0, y: H });
    expect(toUser(1, 1, W, H, 90)).toEqual({ x: W, y: H });
  });

  it("180 and 270 map the corners to the opposite / next corner", () => {
    expect(toUser(0, 0, W, H, 180)).toEqual({ x: W, y: 0 });
    expect(toUser(0, 0, W, H, 270)).toEqual({ x: W, y: H });
    expect(toUser(1, 1, W, H, 270)).toEqual({ x: 0, y: 0 });
  });

  it("is a bijection of the corners for every rotation", () => {
    for (const rot of [0, 90, 180, 270]) {
      const pts = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => JSON.stringify(toUser(x, y, W, H, rot)));
      expect(new Set(pts).size).toBe(4);
    }
  });
});

describe("text helpers", () => {
  it("clean() makes text safe for the standard fonts", () => {
    expect(clean("It’s “fine” — ok …")).toBe("It's \"fine\" - ok ...");
    expect(clean("pump → valve \u{1F527}")).toBe("pump ? valve ?");
  });

  it("wrap() breaks on widths and keeps explicit newlines", () => {
    const font = { widthOfTextAtSize: (t: string) => t.length * 5 };
    expect(wrap("aaaa bbbb cccc", font, 10, 50)).toEqual(["aaaa bbbb", "cccc"]);
    expect(wrap("one\ntwo", font, 10, 500)).toEqual(["one", "two"]);
    expect(wrap("supercalifragilistic", font, 10, 20)).toEqual(["supercalifragilistic"]); // never loops on an over-long word
  });
});

function ann(partial: Partial<Ann> & Pick<Ann, "type" | "x" | "y">, i: number): Ann {
  return {
    id: `a${i}`, page_number: 1, width: null, height: null, body: `note ${i}`, status: null, author_id: "u", created_at: "2026-11-05T10:00:00Z",
    author: { display_name: "Bob" }, replies: null, issue: null, linked_schematic_id: null, link_broken_at: null, link_broken_note: null,
    linked_page: null, linked_annotation_id: null, path: null, schematic_revision: null, attachments: null, linked: null, ...partial,
  } as Ann;
}

describe("buildExport", () => {
  async function sample(rotation = 0, pages = 2) {
    const d = await PDFDocument.create();
    for (let i = 0; i < pages; i++) d.addPage([W, H]).setRotation({ type: "degrees" as never, angle: rotation } as never);
    return d.save();
  }
  const all: Ann[] = [
    ann({ type: "point", x: 0.5, y: 0.5, status: "open" }, 1),
    ann({ type: "comment", x: 0.2, y: 0.2, status: "resolved" }, 2),
    ann({ type: "box", x: 0.1, y: 0.1, width: 0.2, height: 0.1, status: "in_progress" }, 3),
    ann({ type: "callout", x: 0.4, y: 0.4, width: 0.2, height: 0.1 }, 4),
    ann({ type: "highlight", x: 0.6, y: 0.6, width: 0.2, height: 0.1 }, 5),
    ann({ type: "pen", x: 0.1, y: 0.8, path: [[0.1, 0.8], [0.2, 0.85], [0.3, 0.8]] }, 6),
    ann({ type: "arrow", x: 0.7, y: 0.2, path: [[0.7, 0.2], [0.9, 0.3]] }, 7),
    ann({ type: "point", x: 0.5, y: 0.5, page_number: 2 }, 8),
  ];
  const base = { title: "Demo drawing", revision: "B", exportedBy: "Bob" };

  it("draws every annotation type and appends a notes page", async () => {
    const original = await sample();
    const out = await buildExport({ ...base, pdfBytes: original, annotations: all, includeAnnotations: true, summaryPage: true });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3); // 2 drawing pages + 1 notes page
    expect(out.length).toBeGreaterThan(original.length);
  });

  it("without annotations or summary it only stamps the footer", async () => {
    const original = await sample();
    const out = await buildExport({ ...base, pdfBytes: original, annotations: all, includeAnnotations: false, summaryPage: false });
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });

  it("works on rotated pages and ignores annotations that point at a missing page", async () => {
    for (const rot of [90, 180, 270]) {
      const out = await buildExport({ ...base, pdfBytes: await sample(rot, 1), annotations: [...all, ann({ type: "point", x: 0.1, y: 0.1, page_number: 9 }, 9)], includeAnnotations: true, summaryPage: false });
      expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
    }
  });

  it("handles long notes (summary spills onto more pages) and non-Latin text", async () => {
    const many = Array.from({ length: 80 }, (_, i) => ann({ type: "comment", x: 0.5, y: 0.5, body: `Long note ${i} — ${"word ".repeat(60)} \u{1F527}` }, i));
    const out = await buildExport({ ...base, pdfBytes: await sample(0, 1), annotations: many, includeAnnotations: true, summaryPage: true });
    expect((await PDFDocument.load(out)).getPageCount()).toBeGreaterThan(2);
  });
});
