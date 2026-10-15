/**
 * Open-Meteo integration (https://open-meteo.com/en/docs). No API key required.
 *
 * Why it matters for troubleshooting: outdoor industrial equipment (pumps,
 * compressors, switchgear, cooling towers) is sensitive to ambient conditions.
 * Low temperature affects fluid viscosity and seals, high humidity correlates
 * with insulation faults and condensation, and wind affects cooling and
 * enclosures. Showing conditions beside the schematic helps technicians judge
 * whether a fault is environmental before replacing parts.
 */

export type WeatherResult =
  | {
      ok: true;
      temperatureC: number;
      humidityPct: number;
      windSpeedKmh: number;
      observedAt: string | null;
      fetchedAt: string;
      cached: boolean;
    }
  | { ok: false; reason: "no_location" | "timeout" | "upstream_error" | "bad_response"; message: string };

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";
export const WEATHER_TIMEOUT_MS = 5000;
export const WEATHER_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  expires: number;
  data: Extract<WeatherResult, { ok: true }>;
}
const cache = new Map<string, CacheEntry>();

export function clearWeatherCache() {
  cache.clear();
}

export function buildWeatherUrl(lat: number, lon: number): string {
  const url = new URL(ENDPOINT);
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,wind_speed_10m");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("timezone", "UTC");
  return url.toString();
}

export async function getWeather(
  lat: number | null | undefined,
  lon: number | null | undefined,
  opts: { fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number } = {},
): Promise<WeatherResult> {
  if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) {
    return { ok: false, reason: "no_location", message: "This machine has no latitude/longitude, so weather is unavailable." };
  }
  const now = opts.now ?? Date.now;
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && hit.expires > now()) return { ...hit.data, cached: true };

  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? WEATHER_TIMEOUT_MS);
  try {
    const res = await doFetch(buildWeatherUrl(lat, lon), { signal: controller.signal, cache: "no-store" });
    if (!res.ok) {
      return { ok: false, reason: "upstream_error", message: `Open-Meteo responded with HTTP ${res.status}.` };
    }
    const json = (await res.json()) as {
      current?: {
        time?: string;
        temperature_2m?: number;
        relative_humidity_2m?: number;
        wind_speed_10m?: number;
      };
    };
    const c = json.current;
    if (
      !c ||
      typeof c.temperature_2m !== "number" ||
      typeof c.relative_humidity_2m !== "number" ||
      typeof c.wind_speed_10m !== "number"
    ) {
      return { ok: false, reason: "bad_response", message: "Open-Meteo returned an unexpected response." };
    }
    const data = {
      ok: true as const,
      temperatureC: c.temperature_2m,
      humidityPct: c.relative_humidity_2m,
      windSpeedKmh: c.wind_speed_10m,
      observedAt: c.time ? `${c.time}Z` : null,
      fetchedAt: new Date(now()).toISOString(),
      cached: false,
    };
    cache.set(key, { expires: now() + WEATHER_TTL_MS, data });
    return data;
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      return { ok: false, reason: "timeout", message: "Weather service timed out. Try again shortly." };
    }
    return { ok: false, reason: "upstream_error", message: "Could not reach the weather service." };
  } finally {
    clearTimeout(timer);
  }
}
