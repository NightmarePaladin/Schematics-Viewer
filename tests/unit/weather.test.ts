import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildWeatherUrl, clearWeatherCache, getWeather } from "@/lib/weather";

const okBody = {
  current: { time: "2026-10-15T12:00", temperature_2m: 14.2, relative_humidity_2m: 61, wind_speed_10m: 12.5 },
};
const okResponse = () => new Response(JSON.stringify(okBody), { status: 200 });

beforeEach(() => clearWeatherCache());

describe("weather client (failure handling)", () => {
  it("returns a no_location fallback without calling the network", async () => {
    const f = vi.fn();
    const r = await getWeather(null, null, { fetchImpl: f as unknown as typeof fetch });
    expect(r).toMatchObject({ ok: false, reason: "no_location" });
    expect(f).not.toHaveBeenCalled();
  });

  it("maps HTTP errors to upstream_error", async () => {
    const f = vi.fn().mockResolvedValue(new Response("nope", { status: 503 }));
    const r = await getWeather(40, -74, { fetchImpl: f });
    expect(r).toMatchObject({ ok: false, reason: "upstream_error" });
  });

  it("maps network failures to upstream_error", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    expect(await getWeather(40, -74, { fetchImpl: f })).toMatchObject({ ok: false, reason: "upstream_error" });
  });

  it("times out slow requests", async () => {
    const f = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () =>
            rej(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const r = await getWeather(40, -74, { fetchImpl: f as unknown as typeof fetch, timeoutMs: 20 });
    expect(r).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("rejects malformed bodies", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ current: {} }), { status: 200 }));
    expect(await getWeather(40, -74, { fetchImpl: f })).toMatchObject({ ok: false, reason: "bad_response" });
  });

  it("parses a good response and caches it briefly", async () => {
    const f = vi.fn().mockImplementation(async () => okResponse());
    let t = 1_000_000;
    const first = await getWeather(40.1, -74.1, { fetchImpl: f, now: () => t });
    expect(first).toMatchObject({ ok: true, temperatureC: 14.2, humidityPct: 61, windSpeedKmh: 12.5, cached: false });
    t += 60_000;
    const second = await getWeather(40.1, -74.1, { fetchImpl: f, now: () => t });
    expect(second).toMatchObject({ ok: true, cached: true });
    expect(f).toHaveBeenCalledTimes(1);
    t += 11 * 60_000;
    await getWeather(40.1, -74.1, { fetchImpl: f, now: () => t });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("builds an Open-Meteo URL", () => {
    const u = new URL(buildWeatherUrl(40.7128, -74.006));
    expect(u.host).toBe("api.open-meteo.com");
    expect(u.searchParams.get("current")).toContain("temperature_2m");
  });
});
