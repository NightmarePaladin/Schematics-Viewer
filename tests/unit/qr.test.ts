import jsQR from "jsqr";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { labelOrigin, machineUrl, qrPng, qrSvg } from "@/lib/qr";

/** Decode a PNG the way a phone camera would. */
function decode(png: Buffer): string | null {
  const img = PNG.sync.read(png);
  return jsQR(new Uint8ClampedArray(img.data), img.width, img.height)?.data ?? null;
}

const ID = "6f1b7c64-1d8a-4f5e-9d3c-0a1b2c3d4e5f";

describe("machine QR codes", () => {
  it("builds the machine page URL from the origin, tolerating trailing slashes", () => {
    expect(machineUrl("https://schematics-viewer.vercel.app", ID)).toBe(`https://schematics-viewer.vercel.app/machines/${ID}`);
    expect(machineUrl("http://localhost:3000/", ID)).toBe(`http://localhost:3000/machines/${ID}`);
    expect(machineUrl("https://x.test//", ID)).toBe(`https://x.test/machines/${ID}`);
  });

  it("a generated PNG scans back to exactly the machine URL", async () => {
    const url = machineUrl("https://schematics-viewer.vercel.app", ID);
    expect(decode(await qrPng(url, 512))).toBe(url);
  });

  it("stays scannable at small and large sizes, and clamps absurd sizes", async () => {
    const url = machineUrl("http://localhost:3000", ID);
    for (const size of [128, 256, 1024]) expect(decode(await qrPng(url, size))).toBe(url);
    expect(PNG.sync.read(await qrPng(url, 99999)).width).toBeLessThanOrEqual(2048);
    expect(PNG.sync.read(await qrPng(url, 1)).width).toBeGreaterThanOrEqual(128);
  });

  it("different machines get different codes", async () => {
    const a = await qrPng(machineUrl("https://x.test", ID), 256);
    const b = await qrPng(machineUrl("https://x.test", "11111111-1111-4111-8111-111111111111"), 256);
    expect(a.equals(b)).toBe(false);
    expect(decode(b)).toBe("https://x.test/machines/11111111-1111-4111-8111-111111111111");
  });

  it("the SVG is a scalable vector with fixed black-on-white colours (safe in dark mode and when printed)", async () => {
    const svg = await qrSvg(machineUrl("https://x.test", ID));
    expect(svg).toContain("<svg");
    expect(svg).toContain("viewBox");
    expect(svg.toLowerCase()).toContain("#000000");
    expect(svg.toLowerCase()).toContain("#ffffff");
    expect(svg).not.toContain("<script");
  });

  it("the code carries only the URL, never machine data", async () => {
    const decoded = decode(await qrPng(machineUrl("https://x.test", ID), 512));
    expect(decoded).toBe(`https://x.test/machines/${ID}`);
    expect(decoded).not.toMatch(/serial|secret|token|password/i);
  });
});

describe("which site a printed label points at", () => {
  it("uses the production domain on Vercel, whatever origin the page was opened from", () => {
    const env = { VERCEL_PROJECT_PRODUCTION_URL: "schematics-viewer.vercel.app" };
    expect(labelOrigin("https://schematics-viewer-git-main-paladins2.vercel.app", env)).toBe("https://schematics-viewer.vercel.app");
    expect(labelOrigin("http://localhost:3000", env)).toBe("https://schematics-viewer.vercel.app");
  });
  it("tolerates a scheme or trailing slash in the variable", () => {
    expect(labelOrigin("http://x", { VERCEL_PROJECT_PRODUCTION_URL: "https://plant.example.com/" })).toBe("https://plant.example.com");
  });
  it("falls back to the request origin locally (or when the variable is blank)", () => {
    expect(labelOrigin("http://localhost:3000", {})).toBe("http://localhost:3000");
    expect(labelOrigin("http://localhost:3000", { VERCEL_PROJECT_PRODUCTION_URL: "  " })).toBe("http://localhost:3000");
  });
});
