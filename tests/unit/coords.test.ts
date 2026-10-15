import { describe, expect, it } from "vitest";
import {
  displayedToStored,
  fitScale,
  normalizeRotation,
  normToPixels,
  pixelsToNorm,
  rectDisplayedToStored,
  rectStoredToDisplayed,
  storedToDisplayed,
  type Rotation,
} from "@/lib/coords";

const ROTS: Rotation[] = [0, 90, 180, 270];

describe("normalized coordinates", () => {
  it("converts pixels to normalized and back independent of zoom", () => {
    for (const zoom of [0.5, 1, 2.5]) {
      const displayed = { width: 612 * zoom, height: 792 * zoom };
      const n = pixelsToNorm({ x: 306 * zoom, y: 198 * zoom }, displayed);
      expect(n.x).toBeCloseTo(0.5, 9);
      expect(n.y).toBeCloseTo(0.25, 9);
      const back = normToPixels(n, displayed);
      expect(back.x).toBeCloseTo(306 * zoom, 6);
    }
  });

  it("clamps points outside the page", () => {
    expect(pixelsToNorm({ x: -5, y: 9999 }, { width: 100, height: 100 })).toEqual({ x: 0, y: 1 });
  });

  it("rejects a zero-sized page", () => {
    expect(() => pixelsToNorm({ x: 1, y: 1 }, { width: 0, height: 10 })).toThrow(RangeError);
  });

  it("round-trips through every rotation", () => {
    const p = { x: 0.2, y: 0.7 };
    for (const r of ROTS) {
      const back = displayedToStored(storedToDisplayed(p, r), r);
      expect(back.x).toBeCloseTo(p.x, 12);
      expect(back.y).toBeCloseTo(p.y, 12);
    }
  });

  it("maps the stored top-left corner correctly under clockwise rotation", () => {
    expect(storedToDisplayed({ x: 0, y: 0 }, 90)).toEqual({ x: 1, y: 0 });
    expect(storedToDisplayed({ x: 0, y: 0 }, 180)).toEqual({ x: 1, y: 1 });
    expect(storedToDisplayed({ x: 0, y: 0 }, 270)).toEqual({ x: 0, y: 1 });
  });

  it("keeps rectangles axis-aligned and consistent under rotation", () => {
    const r = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 };
    for (const rot of ROTS) {
      const d = rectStoredToDisplayed(r, rot);
      const s = rectDisplayedToStored(d, rot);
      expect(s.x).toBeCloseTo(r.x, 12);
      expect(s.y).toBeCloseTo(r.y, 12);
      expect(s.width).toBeCloseTo(r.width, 12);
      expect(s.height).toBeCloseTo(r.height, 12);
    }
    const d90 = rectStoredToDisplayed(r, 90);
    expect(d90.width).toBeCloseTo(0.1, 12);
    expect(d90.height).toBeCloseTo(0.3, 12);
  });

  it("normalizes arbitrary rotation values", () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(0)).toBe(0);
  });

  it("computes fit scales", () => {
    const page = { width: 600, height: 800 };
    const container = { width: 1048, height: 648 };
    expect(fitScale(page, container, "width")).toBeCloseTo(1000 / 600, 9);
    expect(fitScale(page, container, "page")).toBeCloseTo(600 / 800, 9);
  });
});
