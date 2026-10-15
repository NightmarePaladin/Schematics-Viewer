/**
 * Normalized annotation coordinates.
 *
 * Annotations are stored relative to the *unrotated* PDF page, as fractions in
 * [0, 1] with the origin at the top-left of the page. They never contain screen
 * pixels, so they stay aligned across zoom levels, window sizes and devices.
 *
 * The viewer may display a page rotated (0/90/180/270 degrees clockwise). The
 * helpers below convert between the stored (unrotated) frame and the displayed
 * (rotated) frame, and between normalized units and pixels of the displayed page.
 */

export type Rotation = 0 | 90 | 180 | 270;

export interface NormPoint {
  x: number;
  y: number;
}

export interface NormRect extends NormPoint {
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function normalizeRotation(deg: number): Rotation {
  const r = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return r as Rotation;
}

/** Pixel position inside an element of `displayed` size -> normalized, clamped. */
export function pixelsToNorm(px: NormPoint, displayed: Size): NormPoint {
  if (displayed.width <= 0 || displayed.height <= 0) {
    throw new RangeError("Displayed page size must be positive");
  }
  return { x: clamp01(px.x / displayed.width), y: clamp01(px.y / displayed.height) };
}

/** Normalized (displayed frame) -> pixel position inside an element of `displayed` size. */
export function normToPixels(n: NormPoint, displayed: Size): NormPoint {
  return { x: n.x * displayed.width, y: n.y * displayed.height };
}

/**
 * Convert a point from the displayed (rotated) frame to the stored (unrotated)
 * frame. `rotation` is the clockwise rotation currently applied to the page.
 */
export function displayedToStored(p: NormPoint, rotation: Rotation): NormPoint {
  switch (rotation) {
    case 0:
      return { x: p.x, y: p.y };
    case 90:
      return { x: p.y, y: 1 - p.x };
    case 180:
      return { x: 1 - p.x, y: 1 - p.y };
    case 270:
      return { x: 1 - p.y, y: p.x };
  }
}

/** Convert a point from the stored (unrotated) frame to the displayed (rotated) frame. */
export function storedToDisplayed(p: NormPoint, rotation: Rotation): NormPoint {
  switch (rotation) {
    case 0:
      return { x: p.x, y: p.y };
    case 90:
      return { x: 1 - p.y, y: p.x };
    case 180:
      return { x: 1 - p.x, y: 1 - p.y };
    case 270:
      return { x: p.y, y: 1 - p.x };
  }
}

/** Rectangle from stored frame -> displayed frame (axis-aligned, so exact). */
export function rectStoredToDisplayed(r: NormRect, rotation: Rotation): NormRect {
  const a = storedToDisplayed({ x: r.x, y: r.y }, rotation);
  const b = storedToDisplayed({ x: r.x + r.width, y: r.y + r.height }, rotation);
  return rectFromCorners(a, b);
}

/** Rectangle from displayed frame -> stored frame. */
export function rectDisplayedToStored(r: NormRect, rotation: Rotation): NormRect {
  const a = displayedToStored({ x: r.x, y: r.y }, rotation);
  const b = displayedToStored({ x: r.x + r.width, y: r.y + r.height }, rotation);
  return rectFromCorners(a, b);
}

export function rectFromCorners(a: NormPoint, b: NormPoint): NormRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** Size of a page once rotated. */
export function rotatedSize(size: Size, rotation: Rotation): Size {
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width }
    : { ...size };
}

/** Round to a fixed precision so database values compare stably. */
export function roundNorm(v: number, digits = 6): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export type FitMode = "width" | "page";

/** Scale that fits a page of `page` size (already rotated) inside `container`. */
export function fitScale(page: Size, container: Size, mode: FitMode, padding = 24): number {
  const availW = Math.max(1, container.width - padding * 2);
  const availH = Math.max(1, container.height - padding * 2);
  const sw = availW / page.width;
  return mode === "width" ? sw : Math.min(sw, availH / page.height);
}
