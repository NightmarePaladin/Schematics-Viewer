import { describe, expect, it, vi } from "vitest";
import { geocodePlace } from "@/lib/geocode";
import { effectiveCoords, firstOf, formatCoords } from "@/lib/location-utils";
import { locationCreateSchema, locationUpdateSchema, machineCreateSchema, machineUpdateSchema } from "@/lib/schemas";

describe("coordinates inherited from a location", () => {
  const place = { latitude: 41.88, longitude: -87.63 };

  it("a machine inherits its location's coordinates", () => {
    expect(effectiveCoords({ latitude: null, longitude: null, place })).toEqual({ latitude: 41.88, longitude: -87.63, source: "location" });
  });

  it("a machine's own coordinates override the location's", () => {
    expect(effectiveCoords({ latitude: 10, longitude: 20, place })).toEqual({ latitude: 10, longitude: 20, source: "machine" });
  });

  it("no coordinates anywhere (or a location without coordinates) means none", () => {
    expect(effectiveCoords({ latitude: null, longitude: null }).source).toBe("none");
    expect(effectiveCoords({ latitude: null, longitude: null, place: null }).source).toBe("none");
    expect(effectiveCoords({ latitude: null, longitude: null, place: { latitude: null, longitude: null } }).source).toBe("none");
  });

  it("treats a half-filled pair as missing, and 0,0 as a real position", () => {
    expect(effectiveCoords({ latitude: 5, longitude: null, place }).source).toBe("location");
    expect(effectiveCoords({ latitude: 0, longitude: 0, place }).source).toBe("machine");
  });

  it("formats and normalizes", () => {
    expect(formatCoords({ latitude: 41.8781, longitude: -87.6298 })).toBe("41.8781, -87.6298");
    expect(formatCoords({ latitude: null, longitude: null })).toBe("no coordinates");
    expect(firstOf([{ a: 1 }])).toEqual({ a: 1 });
    expect(firstOf(null)).toBeNull();
    expect(firstOf({ a: 2 })).toEqual({ a: 2 });
  });
});

describe("location validation", () => {
  it("accepts a name alone, or with a coordinate pair", () => {
    expect(locationCreateSchema.parse({ name: "Yard" })).toMatchObject({ name: "Yard", latitude: null, longitude: null });
    expect(locationCreateSchema.safeParse({ name: "Yard", latitude: "41.88", longitude: "-87.63" }).success).toBe(true);
  });
  it("rejects blank names, half pairs and out-of-range values", () => {
    expect(locationCreateSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(locationCreateSchema.safeParse({ name: "x", latitude: 10 }).success).toBe(false);
    expect(locationCreateSchema.safeParse({ name: "x", latitude: 100, longitude: 0 }).success).toBe(false);
    expect(locationCreateSchema.safeParse({ name: "x", latitude: 0, longitude: 181 }).success).toBe(false);
  });
  it("partial updates send only what changed", () => {
    expect(locationUpdateSchema.parse({ name: "New" })).toEqual({ name: "New" });
    expect(locationUpdateSchema.safeParse({ latitude: 1 }).success).toBe(false);
  });
  it("machines accept a location id, and partial updates do not wipe it", () => {
    const base = { name: "n", category: "c", manufacturer: "m", model_number: "x", serial_number: "s" };
    expect(machineCreateSchema.parse({ ...base, location_id: "6f1b7c64-1d8a-4f5e-9d3c-0a1b2c3d4e5f" }).location_id).toBeTruthy();
    expect(machineCreateSchema.parse({ ...base, location_id: "" }).location_id).toBeNull();
    expect(machineCreateSchema.safeParse({ ...base, location_id: "nope" }).success).toBe(false);
    expect(machineUpdateSchema.parse({ name: "x" })).toEqual({ name: "x" });
  });
});

describe("place lookup (Open-Meteo geocoding) failure handling", () => {
  const ok = (results: unknown) => new Response(JSON.stringify({ results }), { status: 200 });

  it("rejects very short queries without calling the network", async () => {
    const f = vi.fn();
    expect(await geocodePlace(" a ", { fetchImpl: f as unknown as typeof fetch })).toMatchObject({ ok: false, reason: "too_short" });
    expect(f).not.toHaveBeenCalled();
  });

  it("maps results to labelled matches and drops incomplete ones", async () => {
    const f = vi.fn().mockResolvedValue(ok([
      { name: "Chicago", admin1: "Illinois", country: "United States", latitude: 41.85, longitude: -87.65 },
      { name: "Broken", latitude: 1 },
    ]));
    const r = await geocodePlace("Chicago", { fetchImpl: f });
    expect(r).toEqual({ ok: true, matches: [{ name: "Chicago", region: "Illinois", country: "United States", latitude: 41.85, longitude: -87.65, label: "Chicago, Illinois, United States" }] });
    expect(String(f.mock.calls[0][0])).toContain("geocoding-api.open-meteo.com");
  });

  it("returns an empty list when the place is unknown (API omits `results`)", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ generationtime_ms: 1 }), { status: 200 }));
    expect(await geocodePlace("zzzzqq", { fetchImpl: f })).toEqual({ ok: true, matches: [] });
  });

  it("maps HTTP errors, network failures and malformed bodies", async () => {
    expect(await geocodePlace("Chicago", { fetchImpl: vi.fn().mockResolvedValue(new Response("x", { status: 502 })) })).toMatchObject({ ok: false, reason: "upstream_error" });
    expect(await geocodePlace("Chicago", { fetchImpl: vi.fn().mockRejectedValue(new TypeError("fetch failed")) })).toMatchObject({ ok: false, reason: "upstream_error" });
    expect(await geocodePlace("Chicago", { fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: "oops" }), { status: 200 })) })).toMatchObject({ ok: false, reason: "bad_response" });
  });

  it("times out slow lookups", async () => {
    const slow = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    );
    expect(await geocodePlace("Chicago", { fetchImpl: slow as unknown as typeof fetch, timeoutMs: 20 })).toMatchObject({ ok: false, reason: "timeout" });
  });
});
