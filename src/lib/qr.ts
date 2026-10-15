import QRCode from "qrcode";

/**
 * QR codes for machine labels. A code contains ONLY the machine page's URL: scanning it opens that page, and the normal
 * sign-in and permission checks still apply, so a QR sticker never exposes any data by itself.
 */

/** Absolute URL a label points at. */
export function machineUrl(origin: string, machineId: string): string {
  return `${origin.replace(/\/+$/, "")}/machines/${machineId}`;
}

/**
 * Origin a printed label should point at. On Vercel this is the project's PRODUCTION domain (set automatically by the platform),
 * so labels printed from a preview deployment or by someone browsing another alias still link to the real site;
 * elsewhere (local dev) it is the origin of the current request.
 */
export function labelOrigin(requestOrigin: string, env: Record<string, string | undefined> = process.env): string {
  const prod = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return prod ? `https://${prod.replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : requestOrigin;
}

const COLORS = { dark: "#000000", light: "#ffffff" }; // fixed so it scans in dark mode and prints correctly

/** Inline-able SVG (scales to any label size). Error correction M tolerates scuffs and smudges. */
export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: COLORS });
}

/** PNG for downloads / external label printers. `size` is the width in pixels. */
export function qrPng(text: string, size = 512): Promise<Buffer> {
  const width = Math.min(2048, Math.max(128, Math.round(size)));
  return QRCode.toBuffer(text, { type: "png", errorCorrectionLevel: "M", margin: 2, width, color: COLORS });
}
