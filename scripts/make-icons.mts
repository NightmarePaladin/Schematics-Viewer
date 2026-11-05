/**
 * Builds the favicon set from the app's logo mark (the orange "S" badge in the sidebar):
 *   src/app/icon.svg        vector icon (modern browsers)
 *   src/app/favicon.ico     16/32/48 px (legacy browsers, bookmarks)
 *   src/app/apple-icon.png  180 px, full-bleed (iOS home screen applies its own rounding)
 * Run: npx tsx scripts/make-icons.mts   (needs Chrome, which Playwright already uses)
 */
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const ORANGE = "#f59e0b";
// The S is a stroked curve (not a font glyph) so it renders identically everywhere.
const S_PATH = "M22 10.2C22 6.8 10 6.6 10 12.6C10 17.6 22 14.4 22 19.9C22 25.4 10 25.2 10 21.8";
const mark = (rx: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="${rx}" fill="${ORANGE}"/>` +
  `<path d="${S_PATH}" fill="none" stroke="#fff" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL ?? "chrome" });
const page = await browser.newPage();
async function png(svg: string, size: number): Promise<Buffer> {
  await page.setViewportSize({ width: size, height: size });
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block}</style><img src="${src}" width="${size}" height="${size}">`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** ICO container holding PNG images (supported by every browser that still reads .ico). */
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([head, ...entries, ...images.map((i) => i.data)]);
}

await writeFile("src/app/icon.svg", mark(7) + "\n");
await writeFile("src/app/favicon.ico", ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(mark(7), size) })))));
await writeFile("src/app/apple-icon.png", await png(mark(0), 180));
await browser.close();
console.log("wrote src/app/icon.svg, favicon.ico, apple-icon.png");
