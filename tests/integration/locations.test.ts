import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { geocodePlace } from "@/lib/geocode";
import { adminClient, hasSupabaseCreds, seed, userClient, USERS, type SeedResult } from "../../scripts/lib/seed-lib";

/** Locations: RLS, constraints, name syncing and un-linking, against the real database. */
describe.skipIf(!hasSupabaseCreds())("locations (real Supabase)", () => {
  let s: SeedResult;
  let admin: SupabaseClient;
  const c = {} as Record<keyof typeof USERS, SupabaseClient>;
  const tempLocations: string[] = [];
  const tempMachines: string[] = [];
  const stamp = Date.now();

  const newLocation = async (name: string, extra: Record<string, unknown> = {}, orgId = s.orgId) => {
    const { data, error } = await admin.from("locations").insert({ org_id: orgId, name, created_by: s.ids.admin, ...extra }).select("id").single();
    expect(error).toBeNull();
    tempLocations.push(data!.id);
    return data!.id as string;
  };

  beforeAll(async () => {
    s = await seed();
    admin = adminClient();
    for (const k of Object.keys(USERS) as (keyof typeof USERS)[]) c[k] = await userClient(USERS[k].email);
  });

  afterAll(async () => {
    if (tempMachines.length) await admin.from("machines").delete().in("id", tempMachines);
    if (tempLocations.length) await admin.from("locations").delete().in("id", tempLocations);
  });

  describe("access control", () => {
    it("every organization member can read the shared list", async () => {
      for (const who of ["viewer", "tech", "manager", "admin"] as const) {
        const { data } = await c[who].from("locations").select("id, name").eq("org_id", s.orgId);
        expect(data?.map((l) => l.name)).toEqual(expect.arrayContaining(["Plant 1 / Bay 3", "Yard North", "Plant 1 roof"]));
      }
    });

    it("another organization sees none of them and cannot add to ours", async () => {
      expect((await c.outsider.from("locations").select("id").eq("org_id", s.orgId)).data).toEqual([]);
      const res = await c.outsider.from("locations").insert({ org_id: s.orgId, name: `forged-${stamp}`, created_by: s.ids.outsider });
      expect(res.error).not.toBeNull();
    });

    it("a Viewer cannot add a location; a Technician can; only managers can edit or delete", async () => {
      const viewerTry = await c.viewer.from("locations").insert({ org_id: s.orgId, name: `viewer-${stamp}`, created_by: s.ids.viewer });
      expect(viewerTry.error).not.toBeNull();

      const techAdd = await c.tech.from("locations").insert({ org_id: s.orgId, name: `tech-${stamp}`, created_by: s.ids.tech }).select().single();
      expect(techAdd.error).toBeNull();
      tempLocations.push(techAdd.data!.id);

      const techEdit = await c.tech.from("locations").update({ name: "renamed by tech" }).eq("id", techAdd.data!.id).select();
      expect(techEdit.data ?? []).toEqual([]);
      const techDelete = await c.tech.from("locations").delete().eq("id", techAdd.data!.id).select();
      expect(techDelete.data ?? []).toEqual([]);

      const mgrEdit = await c.manager.from("locations").update({ description: "edited by manager" }).eq("id", techAdd.data!.id).select();
      expect(mgrEdit.data?.length).toBe(1);
    });

    it("created_by cannot be forged", async () => {
      const forged = await c.tech.from("locations").insert({ org_id: s.orgId, name: `forged-by-${stamp}`, created_by: s.ids.admin });
      expect(forged.error).not.toBeNull();
    });
  });

  describe("constraints", () => {
    it("names are unique per organization, case-insensitively, but may repeat across organizations", async () => {
      await newLocation(`Dup Site ${stamp}`);
      const dup = await admin.from("locations").insert({ org_id: s.orgId, name: `dup site ${stamp}`, created_by: s.ids.admin });
      expect(dup.error?.code).toBe("23505");
      const other = await admin.from("locations").insert({ org_id: s.otherOrgId, name: `Dup Site ${stamp}`, created_by: s.ids.outsider }).select("id").single();
      expect(other.error).toBeNull();
      tempLocations.push(other.data!.id);
    });

    it("coordinates come as a valid pair or not at all", async () => {
      const half = await admin.from("locations").insert({ org_id: s.orgId, name: `half-${stamp}`, latitude: 10 });
      expect(half.error?.code).toBe("23514");
      const range = await admin.from("locations").insert({ org_id: s.orgId, name: `range-${stamp}`, latitude: 95, longitude: 0 });
      expect(range.error?.code).toBe("23514");
      const ok = await admin.from("locations").insert({ org_id: s.orgId, name: `ok-${stamp}`, latitude: -33.86, longitude: 151.2 }).select("id").single();
      expect(ok.error).toBeNull();
      tempLocations.push(ok.data!.id);
    });

    it("a machine cannot use a location from another organization", async () => {
      const foreign = await newLocation(`Foreign ${stamp}`, { created_by: s.ids.outsider }, s.otherOrgId);
      const res = await admin.from("machines").update({ location_id: foreign }).eq("id", s.machines.press);
      expect(res.error?.code).toBe("23503");
    });
  });

  describe("machine <-> location behaviour", () => {
    it("assigning a location copies its name to the machine and the machine inherits coordinates", async () => {
      const loc = await newLocation(`Depot ${stamp}`, { latitude: 40.7128, longitude: -74.006 });
      const { data, error } = await admin
        .from("machines")
        .insert({ org_id: s.orgId, name: `loc-machine-${stamp}`, category: "T", manufacturer: "Loc Works", model_number: "L", serial_number: `L-${stamp}`, created_by: s.ids.admin, location_id: loc })
        .select("id, location, latitude, longitude")
        .single();
      expect(error).toBeNull();
      tempMachines.push(data!.id);
      expect(data!.location).toBe(`Depot ${stamp}`);
      expect(data!.latitude).toBeNull(); // inherits at read time; nothing copied

      const { data: viaTech } = await c.manager.from("machines").select("id, place:locations(latitude, longitude)").eq("id", data!.id).single();
      const place = Array.isArray(viaTech!.place) ? viaTech!.place[0] : viaTech!.place;
      expect(place).toEqual({ latitude: 40.7128, longitude: -74.006 });
    });

    it("renaming a location renames it on every machine that uses it", async () => {
      const loc = await newLocation(`Before ${stamp}`);
      const { data: m } = await admin
        .from("machines")
        .insert({ org_id: s.orgId, name: `rename-machine-${stamp}`, category: "T", manufacturer: "Loc Works", model_number: "L", serial_number: `R-${stamp}`, created_by: s.ids.admin, location_id: loc })
        .select("id")
        .single();
      tempMachines.push(m!.id);
      await c.manager.from("locations").update({ name: `After ${stamp}` }).eq("id", loc);
      const { data: after } = await admin.from("machines").select("location").eq("id", m!.id).single();
      expect(after!.location).toBe(`After ${stamp}`);
    });

    it("searching by location text finds machines through the synced name", async () => {
      const { data } = await c.manager.from("machines").select("name").eq("org_id", s.orgId).ilike("location", "%yard%");
      expect(data?.map((d) => d.name)).toContain("Outdoor Compressor C2");
    });

    it("deleting a location keeps the machines and un-links them", async () => {
      const loc = await newLocation(`Doomed ${stamp}`);
      const { data: m } = await admin
        .from("machines")
        .insert({ org_id: s.orgId, name: `survivor-${stamp}`, category: "T", manufacturer: "Loc Works", model_number: "L", serial_number: `S-${stamp}`, created_by: s.ids.admin, location_id: loc })
        .select("id")
        .single();
      tempMachines.push(m!.id);
      expect((await c.manager.from("locations").delete().eq("id", loc)).error).toBeNull();
      const { data: after } = await admin.from("machines").select("id, location_id").eq("id", m!.id).single();
      expect(after).toEqual({ id: m!.id, location_id: null });
    });
  });

  describe("place lookup against the real Open-Meteo geocoding API", () => {
    it("finds Chicago with plausible coordinates", async () => {
      const r = await geocodePlace("Chicago");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.matches.length).toBeGreaterThan(0);
      const top = r.matches[0];
      expect(top.latitude).toBeGreaterThan(41);
      expect(top.latitude).toBeLessThan(42.5);
      expect(top.longitude).toBeLessThan(-87);
      expect(top.label).toContain("Chicago");
    });

    it("returns an empty list for nonsense", async () => {
      const r = await geocodePlace("zzqxjv-not-a-place-12345");
      expect(r).toEqual({ ok: true, matches: [] });
    });
  });
});
