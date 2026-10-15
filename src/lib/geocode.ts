/**
 * Place-name -> coordinates lookup using the free Open-Meteo Geocoding API (no key):
 * https://open-meteo.com/en/docs/geocoding-api . Used to fill a location's latitude/longitude without typing numbers.
 * Server-side only (called from /api/geocode), with a timeout and typed failures like the weather client.
 */

export interface GeocodeMatch {
  name: string;
  region: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  label: string;
}

export type GeocodeResult =
  | { ok: true; matches: GeocodeMatch[] }
  | { ok: false; reason: "too_short" | "timeout" | "upstream_error" | "bad_response"; message: string };

const ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
export const GEOCODE_TIMEOUT_MS = 5000;

export async function geocodePlace(
  query: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<GeocodeResult> {
  const q = query.trim();
  if (q.length < 2) return { ok: false, reason: "too_short", message: "Type at least 2 characters." };

  const url = new URL(ENDPOINT);
  url.searchParams.set("name", q);
  url.searchParams.set("count", "5");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? GEOCODE_TIMEOUT_MS);
  try {
    const res = await (opts.fetchImpl ?? fetch)(url.toString(), { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return { ok: false, reason: "upstream_error", message: `Geocoding service responded with HTTP ${res.status}.` };
    const json = (await res.json()) as {
      results?: { name?: string; admin1?: string; country?: string; latitude?: number; longitude?: number }[];
    };
    if (json.results !== undefined && !Array.isArray(json.results)) {
      return { ok: false, reason: "bad_response", message: "Geocoding service returned an unexpected response." };
    }
    const matches: GeocodeMatch[] = (json.results ?? [])
      .filter((r) => typeof r.name === "string" && typeof r.latitude === "number" && typeof r.longitude === "number")
      .map((r) => ({
        name: r.name as string,
        region: r.admin1 ?? null,
        country: r.country ?? null,
        latitude: r.latitude as number,
        longitude: r.longitude as number,
        label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
      }));
    return { ok: true, matches };
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return { ok: false, reason: "timeout", message: "Place lookup timed out. Try again." };
    return { ok: false, reason: "upstream_error", message: "Could not reach the place lookup service." };
  } finally {
    clearTimeout(timer);
  }
}
