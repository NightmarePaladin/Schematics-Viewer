import { describe, expect, it } from "vitest";
import { clearWeatherCache, getWeather } from "@/lib/weather";

/** Makes a REAL HTTP request to Open-Meteo (no API key needed). Needs internet access; no Supabase required. */
describe("Open-Meteo (live network)", () => {
  it("returns current conditions for Chicago and caches the second call", async () => {
    clearWeatherCache();
    const first = await getWeather(41.8781, -87.6298);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.temperatureC).toBeGreaterThan(-60);
    expect(first.temperatureC).toBeLessThan(60);
    expect(first.humidityPct).toBeGreaterThanOrEqual(0);
    expect(first.humidityPct).toBeLessThanOrEqual(100);
    expect(first.windSpeedKmh).toBeGreaterThanOrEqual(0);
    expect(first.cached).toBe(false);
    expect(Date.parse(first.fetchedAt)).not.toBeNaN();
    console.log("Open-Meteo live:", JSON.stringify(first));

    const second = await getWeather(41.8781, -87.6298);
    expect(second.ok && second.cached).toBe(true);
  });

  it("reports a clear error for an unreachable host (simulated by an impossible timeout)", async () => {
    clearWeatherCache();
    const r = await getWeather(10, 10, { timeoutMs: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["timeout", "upstream_error"]).toContain(r.reason);
  });
});
