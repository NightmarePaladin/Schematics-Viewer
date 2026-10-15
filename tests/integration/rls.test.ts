import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasSupabaseCreds, seed, userClient, USERS, type SeedResult } from "../../scripts/lib/seed-lib";

/**
 * Integration tests against a real Supabase project: Row Level Security, storage policies and
 * schema constraints exercised as real signed-in users. Skipped (not passed) without credentials.
 */
describe.skipIf(!hasSupabaseCreds())("RLS + storage (real Supabase)", () => {
  let s: SeedResult;
  let admin: SupabaseClient;
  const c = {} as Record<keyof typeof USERS, SupabaseClient>;
  const created: string[] = [];

  beforeAll(async () => {
    s = await seed();
    admin = adminClient();
    for (const k of Object.keys(USERS) as (keyof typeof USERS)[]) c[k] = await userClient(USERS[k].email);
  });

  afterAll(async () => {
    if (created.length) await admin.from("annotations").delete().in("id", created);
  });

  const level = async (who: keyof typeof USERS, schematic: string) => (await c[who].rpc("schematic_level", { p_schematic: schematic })).data;

  describe("cross-organization denial", () => {
    it("outsider sees none of another org's machines, schematics or annotations", async () => {
      expect((await c.outsider.from("machines").select("id").eq("id", s.machines.press)).data).toEqual([]);
      expect((await c.outsider.from("schematics").select("id").eq("id", s.schematicId)).data).toEqual([]);
      expect((await c.outsider.from("annotations").select("id").eq("schematic_id", s.schematicId)).data).toEqual([]);
      expect((await c.outsider.from("maintenance_issues").select("id").eq("org_id", s.orgId)).data).toEqual([]);
      expect(await level("outsider", s.schematicId)).toBeNull();
    });

    it("outsider cannot write into another org even by forging org_id", async () => {
      const res = await c.outsider.from("machines").insert({
        org_id: s.orgId, name: "x", category: "x", manufacturer: "x", model_number: "x", serial_number: "forged", created_by: s.ids.outsider,
      });
      expect(res.error).not.toBeNull();
      const ann = await c.outsider.from("annotations").insert({
        org_id: s.orgId, schematic_id: s.schematicId, page_number: 1, type: "point", x: 0.1, y: 0.1, author_id: s.ids.outsider,
      });
      expect(ann.error).not.toBeNull();
    });

    it("same serial number may exist in different organizations", async () => {
      const dupes = await admin.from("machines").select("org_id").ilike("serial_number", "AM-77310");
      expect(new Set(dupes.data?.map((d) => d.org_id)).size).toBe(2);
    });

    it("serial numbers are unique within organization + manufacturer", async () => {
      const dup = await admin.from("machines").insert({
        org_id: s.orgId, name: "dup", category: "Compressor", manufacturer: "airmaster", model_number: "x", serial_number: "am-77310",
      });
      expect(dup.error?.code).toBe("23505");
    });
  });

  describe("machine registry access", () => {
    it("a technician can insert a machine and get the row back (regression: INSERT ... RETURNING under RLS)", async () => {
      const serial = `RET-${Date.now()}`;
      const res = await c.tech.from("machines").insert({
        org_id: s.orgId, name: "Returning test", category: "Test", manufacturer: "RLS Works", model_number: "R1", serial_number: serial, created_by: s.ids.tech,
      }).select().single();
      expect(res.error).toBeNull();
      expect(res.data?.serial_number).toBe(serial);
      await admin.from("machines").delete().eq("id", res.data!.id);
    });

    it("metadata visibility follows access: viewer sees only machines with a schematic shared to them", async () => {
      expect((await c.viewer.from("machines").select("id").eq("id", s.machines.press)).data?.length).toBe(1);
      expect((await c.viewer.from("machines").select("id").eq("id", s.machines.compressor)).data).toEqual([]);
      expect((await c.manager.from("machines").select("id").eq("org_id", s.orgId)).data?.length).toBeGreaterThanOrEqual(3);
    });

    it("a technician cannot edit another technician's machine", async () => {
      const upd = await c.tech2.from("machines").update({ name: "hijacked" }).eq("id", s.machines.press).select();
      expect(upd.data ?? []).toEqual([]);
    });
  });

  describe("group + individual grants", () => {
    it("admin/manager roles get implicit manage", async () => {
      expect(await level("admin", s.privateSchematicId)).toBe("manage");
      expect(await level("manager", s.privateSchematicId)).toBe("manage");
    });

    it("uploader gets manage; group member gets the group's edit level", async () => {
      expect(await level("tech", s.schematicId)).toBe("manage");
      expect(await level("tech2", s.schematicId)).toBe("edit");
    });

    it("a technician with no applicable grant cannot see a private schematic", async () => {
      expect(await level("tech2", s.privateSchematicId)).toBeNull();
      expect((await c.tech2.from("schematics").select("id").eq("id", s.privateSchematicId)).data).toEqual([]);
      expect((await c.tech2.from("annotations").select("id").eq("schematic_id", s.privateSchematicId)).data).toEqual([]);
    });

    it("only Manage can change grants", async () => {
      const row = { org_id: s.orgId, schematic_id: s.schematicId, user_id: s.ids.tech2, level: "manage" };
      const byEditor = await c.tech2.from("schematic_access_grants").insert(row);
      expect(byEditor.error).not.toBeNull();
      const byViewer = await c.viewer.from("schematic_access_grants").insert({ ...row, user_id: s.ids.viewer });
      expect(byViewer.error).not.toBeNull();
    });

    it("grants cannot target a user from another organization", async () => {
      const res = await admin.from("schematic_access_grants").insert({ org_id: s.orgId, schematic_id: s.privateSchematicId, user_id: s.ids.outsider, level: "view" });
      expect(res.error?.code).toBe("23503");
    });
  });

  describe("viewer is read-only", () => {
    it("can read but not create or modify annotations", async () => {
      expect(await level("viewer", s.schematicId)).toBe("view");
      expect((await c.viewer.from("annotations").select("id").eq("schematic_id", s.schematicId)).data?.length).toBeGreaterThan(0);
      const ins = await c.viewer.from("annotations").insert({
        org_id: s.orgId, schematic_id: s.schematicId, page_number: 1, type: "point", x: 0.5, y: 0.5, author_id: s.ids.viewer,
      });
      expect(ins.error).not.toBeNull();
      const { data: existing } = await admin.from("annotations").select("id, body").eq("schematic_id", s.schematicId).limit(1).single();
      const upd = await c.viewer.from("annotations").update({ body: "tampered" }).eq("id", existing!.id).select();
      expect(upd.data ?? []).toEqual([]);
      const { data: after } = await admin.from("annotations").select("body").eq("id", existing!.id).single();
      expect(after!.body).toBe(existing!.body);
    });

    it("stays capped at view even if granted manage", async () => {
      await admin.from("schematic_access_grants").upsert({ org_id: s.orgId, schematic_id: s.schematicId, user_id: s.ids.viewer, level: "manage" }, { onConflict: "schematic_id,user_id" });
      try {
        expect(await level("viewer", s.schematicId)).toBe("view");
      } finally {
        await admin.from("schematic_access_grants").update({ level: "view" }).eq("schematic_id", s.schematicId).eq("user_id", s.ids.viewer);
      }
    });

    it("cannot register machines or log maintenance", async () => {
      const m = await c.viewer.from("machines").insert({ org_id: s.orgId, name: "n", category: "c", manufacturer: "m", model_number: "m", serial_number: "viewer-try", created_by: s.ids.viewer });
      expect(m.error).not.toBeNull();
      const l = await c.viewer.from("maintenance_logs").insert({ org_id: s.orgId, machine_id: s.machines.press, body: "x", performed_by: s.ids.viewer });
      expect(l.error).not.toBeNull();
    });
  });

  describe("annotation persistence + retrieval", () => {
    it("stores normalized coordinates exactly and returns them to other users", async () => {
      const ins = await c.tech2.from("annotations").insert({
        org_id: s.orgId, schematic_id: s.schematicId, page_number: 2, type: "box", x: 0.125, y: 0.25, width: 0.5, height: 0.25,
        body: "integration-test box", status: "open", author_id: s.ids.tech2,
      }).select().single();
      expect(ins.error).toBeNull();
      created.push(ins.data!.id);

      const fetched = await c.viewer.from("annotations").select("*").eq("id", ins.data!.id).single();
      expect(fetched.data).toMatchObject({ page_number: 2, type: "box", x: 0.125, y: 0.25, width: 0.5, height: 0.25, author_id: s.ids.tech2 });
      expect(new Date(fetched.data!.created_at).getTime()).toBeGreaterThan(0);
    });

    it("rejects out-of-range coordinates at the database level", async () => {
      const bad = await c.tech2.from("annotations").insert({
        org_id: s.orgId, schematic_id: s.schematicId, page_number: 1, type: "point", x: 340, y: 120, author_id: s.ids.tech2,
      });
      expect(bad.error?.code).toBe("23514");
    });

    it("cannot forge another user as author", async () => {
      const forged = await c.tech2.from("annotations").insert({
        org_id: s.orgId, schematic_id: s.schematicId, page_number: 1, type: "point", x: 0.1, y: 0.1, author_id: s.ids.admin,
      });
      expect(forged.error).not.toBeNull();
    });
  });

  describe("PDF storage access", () => {
    const pathOf = async (id: string) => (await admin.from("schematics").select("storage_path").eq("id", id).single()).data!.storage_path as string;

    it("authorized user receives a short-lived signed URL that really serves the PDF", async () => {
      const p = await pathOf(s.schematicId);
      const { data, error } = await c.viewer.storage.from("schematics").createSignedUrl(p, 60);
      expect(error).toBeNull();
      const res = await fetch(data!.signedUrl);
      expect(res.status).toBe(200);
      expect(new TextDecoder().decode((await res.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    });

    it("denies signed URLs and downloads to a user from another organization", async () => {
      const p = await pathOf(s.schematicId);
      expect((await c.outsider.storage.from("schematics").createSignedUrl(p, 60)).error).not.toBeNull();
      expect((await c.outsider.storage.from("schematics").download(p)).error).not.toBeNull();
    });

    it("denies a same-org technician without a grant", async () => {
      const p = await pathOf(s.privateSchematicId);
      expect((await c.tech2.storage.from("schematics").createSignedUrl(p, 60)).error).not.toBeNull();
      expect((await c.tech2.storage.from("schematics").download(p)).error).not.toBeNull();
    });

    it("has no public URL: the bucket is private", async () => {
      const p = await pathOf(s.schematicId);
      const { data } = c.viewer.storage.from("schematics").getPublicUrl(p);
      const res = await fetch(data.publicUrl);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("viewers cannot upload or delete files", async () => {
      const bytes = new TextEncoder().encode("%PDF-1.4 fake");
      const up = await c.viewer.storage.from("schematics").upload(`${s.orgId}/${crypto.randomUUID()}.pdf`, bytes, { contentType: "application/pdf" });
      expect(up.error).not.toBeNull();
      const del = await c.viewer.storage.from("schematics").remove([await pathOf(s.schematicId)]);
      expect(del.data ?? []).toEqual([]);
    });
  });
});
