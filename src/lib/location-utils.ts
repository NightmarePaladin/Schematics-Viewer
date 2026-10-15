/** Pure helpers for locations (no server-only imports so they can be unit-tested and used in client components). */

export interface Coords {
  latitude: number | null;
  longitude: number | null;
}

export interface MachineCoordsInput extends Coords {
  /** The linked location record, when the machine has one. */
  place?: Coords | null;
}

export type CoordSource = "machine" | "location" | "none";

/**
 * Coordinates used for weather: a machine's OWN coordinates (an override, e.g. a rooftop unit) win;
 * otherwise it inherits its location's coordinates; otherwise none.
 */
export function effectiveCoords(m: MachineCoordsInput): { latitude: number | null; longitude: number | null; source: CoordSource } {
  if (m.latitude != null && m.longitude != null) return { latitude: m.latitude, longitude: m.longitude, source: "machine" };
  const p = m.place;
  if (p && p.latitude != null && p.longitude != null) return { latitude: p.latitude, longitude: p.longitude, source: "location" };
  return { latitude: null, longitude: null, source: "none" };
}

export function formatCoords(c: Coords): string {
  return c.latitude != null && c.longitude != null ? `${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}` : "no coordinates";
}

/** Supabase embeds return an object or a one-item array depending on the relationship; normalize. */
export function firstOf<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}
