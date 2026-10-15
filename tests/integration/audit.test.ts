import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasSupabaseCreds, seed, userClient, USERS, type SeedResult } from "../../scripts/lib/seed-lib";

/** The audit log against the real database: automatic recording, admin-only reads, and append-only protection. */
describe.skipIf(!hasSupabaseCreds())("audit log (real Supabase)", () => {
  let s: SeedResult;
  let service: SupabaseClient;
  const c = {} as Record<keyof typeof USERS, SupabaseClient>;
  const stamp = Date.now();
  const cleanup: (() => PromiseLike<unknown>)[] = [];

  const eventsFor = async (client: SupabaseClient, entityId: string) => {
    const { data, error } = await client
      .from("audit_events")
      .select("id, action, entity_type, entity_id, actor_id, actor_label, metadata, created_at")
      .eq("entity_id", entityId)
      .order("id");
    expect(error).toBeNull();
    return data ?? [];
  };

  beforeAll(async () => {
    s = await seed();
    service = adminClient();
    for (const k of Object.keys(USERS) as (keyof typeof USERS)[]) c[k] = await userClient(USERS[k].email);
  });
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
  });

  describe("automatic recording of user actions", () => {
    it("records create / update / delete of an annotation with who, what and the change", async () => {
      const ins = await c.tech.from("annotations").insert({
        org_id: s.orgId, schematic_id: s.schematicId, page_number: 2, type: "comment", x: 0.2, y: 0.3, body: `audit-test ${stamp}`, author_id: s.ids.tech,
      }).select("id").single();
      expect(ins.error).toBeNull();
      const id = ins.data!.id;

      await c.tech.from("annotations").update({ body: `audit-test edited ${stamp}` }).eq("id", id);
      await c.tech.from("annotations").delete().eq("id", id);

      const ev = await eventsFor(c.admin, id);
      expect(ev.map((e) => e.action)).toEqual(["annotation.created", "annotation.updated", "annotation.deleted"]);
      expect(ev[0]).toMatchObject({ entity_type: "annotation", actor_id: s.ids.tech });
      expect(ev[0].actor_label).toContain("Tara Technician");
      expect(ev[0].actor_label).toContain("tech@schematichub.test");
      expect(ev[0].metadata).toMatchObject({ schematic_id: s.schematicId, page_number: 2, label: `audit-test ${stamp}` });
      expect(ev[1].metadata.changes.body).toEqual({ from: `audit-test ${stamp}`, to: `audit-test edited ${stamp}` });
      expect(new Date(ev[0].created_at).getTime()).toBeGreaterThan(Date.now() - 120_000);
    });

    it("records a status change on an issue (the 'job' being resolved) and the maintenance log entry", async () => {
      const { data: m } = await service.from("machines").insert({ org_id: s.orgId, name: `audit-machine-${stamp}`, category: "T", manufacturer: "Audit Works", model_number: "A", serial_number: `AUD-${stamp}`, created_by: s.ids.tech }).select("id").single();
      cleanup.push(() => service.from("machines").delete().eq("id", m!.id));

      const issue = await c.tech.from("maintenance_issues").insert({ org_id: s.orgId, machine_id: m!.id, title: `audit issue ${stamp}`, severity: "high", reporter_id: s.ids.tech }).select("id").single();
      expect(issue.error).toBeNull();
      const res = await c.manager.from("maintenance_issues").update({ status: "resolved", resolution_note: "Replaced part" }).eq("id", issue.data!.id).select();
      expect(res.error).toBeNull();
      const log = await c.tech.from("maintenance_logs").insert({ org_id: s.orgId, machine_id: m!.id, body: `replaced part ${stamp}`, entry_type: "repair", performed_by: s.ids.tech }).select("id").single();
      expect(log.error).toBeNull();

      const ev = await eventsFor(c.admin, issue.data!.id);
      expect(ev.map((e) => e.action)).toEqual(["issue.created", "issue.updated"]);
      expect(ev[1].metadata.changes.status).toEqual({ from: "open", to: "resolved" });
      expect(ev[1].actor_label).toContain("Max Manager");
      expect(ev[0].metadata).toMatchObject({ machine_id: m!.id, severity: "high" });

      const logEv = await eventsFor(c.admin, log.data!.id);
      expect(logEv.map((e) => e.action)).toEqual(["log.created"]);
      expect(logEv[0].metadata).toMatchObject({ machine_id: m!.id, entry_type: "repair" });
    });

    it("records grants, machine edits and location changes", async () => {
      const grant = await c.admin.from("schematic_access_grants").insert({ org_id: s.orgId, schematic_id: s.privateSchematicId, user_id: s.ids.viewer, level: "view", granted_by: s.ids.admin }).select("id").single();
      expect(grant.error).toBeNull();
      await c.admin.from("schematic_access_grants").delete().eq("id", grant.data!.id);
      const gEv = await eventsFor(c.admin, grant.data!.id);
      expect(gEv.map((e) => e.action)).toEqual(["grant.created", "grant.deleted"]);
      expect(gEv[0].metadata).toMatchObject({ level: "view", user_id: s.ids.viewer, schematic_id: s.privateSchematicId });

      const loc = await c.manager.from("locations").insert({ org_id: s.orgId, name: `Audit Loc ${stamp}`, created_by: s.ids.manager }).select("id").single();
      await c.manager.from("locations").update({ name: `Audit Loc Renamed ${stamp}` }).eq("id", loc.data!.id);
      await c.manager.from("locations").delete().eq("id", loc.data!.id);
      const lEv = await eventsFor(c.admin, loc.data!.id);
      expect(lEv.map((e) => e.action)).toEqual(["location.created", "location.updated", "location.deleted"]);
      expect(lEv[1].metadata.changes.name.to).toBe(`Audit Loc Renamed ${stamp}`);
    });

    it("an update that changes nothing meaningful is not logged", async () => {
      const { data: m } = await service.from("machines").insert({ org_id: s.orgId, name: `noop-${stamp}`, category: "T", manufacturer: "Audit Works", model_number: "A", serial_number: `NOOP-${stamp}`, created_by: s.ids.admin }).select("id").single();
      cleanup.push(() => service.from("machines").delete().eq("id", m!.id));
      await c.manager.from("machines").update({ name: `noop-${stamp}` }).eq("id", m!.id); // same value
      expect(await eventsFor(c.admin, m!.id)).toEqual([]); // service-role insert (no user) + no-op update => nothing
    });

    it("changes made with no signed-in user (service role, scripts) are not attributed and not logged", async () => {
      const { data: m } = await service.from("machines").insert({ org_id: s.orgId, name: `system-${stamp}`, category: "T", manufacturer: "Audit Works", model_number: "A", serial_number: `SYS-${stamp}`, created_by: s.ids.admin }).select("id").single();
      await service.from("machines").update({ name: `system-renamed-${stamp}` }).eq("id", m!.id);
      await service.from("machines").delete().eq("id", m!.id);
      expect(await eventsFor(c.admin, m!.id)).toEqual([]);
    });

    it("records who viewed a schematic file, only for people who may view it", async () => {
      const before = (await eventsFor(c.admin, s.schematicId)).filter((e) => e.action === "schematic.viewed").length;
      expect((await c.tech.rpc("log_schematic_view", { p_schematic: s.schematicId })).error).toBeNull();
      expect((await c.outsider.rpc("log_schematic_view", { p_schematic: s.schematicId })).error).toBeNull(); // silently ignored
      expect((await c.tech2.rpc("log_schematic_view", { p_schematic: s.privateSchematicId })).error).toBeNull(); // no access => ignored
      const after = (await eventsFor(c.admin, s.schematicId)).filter((e) => e.action === "schematic.viewed");
      expect(after.length).toBe(before + 1);
      expect(after.at(-1)!.actor_label).toContain("Tara Technician");
      expect((await eventsFor(c.admin, s.privateSchematicId)).some((e) => e.action === "schematic.viewed" && e.actor_id === s.ids.tech2)).toBe(false);
    });
  });

  describe("who can read it", () => {
    it("organization admins can read their organization's log", async () => {
      const { data, error } = await c.admin.from("audit_events").select("id").eq("org_id", s.orgId).limit(5);
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    });

    it("managers, technicians and viewers see nothing", async () => {
      for (const who of ["manager", "tech", "tech2", "viewer"] as const) {
        const { data, error } = await c[who].from("audit_events").select("id").eq("org_id", s.orgId).limit(5);
        expect(error).toBeNull();
        expect(data).toEqual([]);
      }
    });

    it("another organization's admin cannot read ours (and sees only their own)", async () => {
      expect((await c.outsider.from("audit_events").select("id").eq("org_id", s.orgId)).data).toEqual([]);
      const own = await c.outsider.from("audit_events").select("org_id").limit(50);
      expect(new Set((own.data ?? []).map((r) => r.org_id))).toEqual(new Set([s.otherOrgId].filter((o) => (own.data ?? []).some((r) => r.org_id === o))));
    });
  });

  describe("append-only: nobody but the database owner can change it", () => {
    let eventId = 0;
    beforeAll(async () => {
      const { data } = await c.admin.from("audit_events").select("id").eq("org_id", s.orgId).order("id", { ascending: false }).limit(1).single();
      eventId = data!.id;
    });

    it("an admin cannot insert, edit or delete events (so cannot forge or erase history)", async () => {
      const ins = await c.admin.from("audit_events").insert({ org_id: s.orgId, action: "machine.deleted", entity_type: "machine", actor_id: s.ids.admin });
      expect(ins.error).not.toBeNull();
      const upd = await c.admin.from("audit_events").update({ action: "tampered" }).eq("id", eventId).select();
      expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
      const del = await c.admin.from("audit_events").delete().eq("id", eventId).select();
      expect(del.error !== null || (del.data ?? []).length === 0).toBe(true);
    });

    it("no other role can either", async () => {
      for (const who of ["manager", "tech", "viewer", "outsider"] as const) {
        expect((await c[who].from("audit_events").insert({ org_id: s.orgId, action: "x", entity_type: "machine" })).error).not.toBeNull();
        const upd = await c[who].from("audit_events").update({ action: "tampered" }).eq("id", eventId).select();
        expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
      }
    });

    it("even the service-role key cannot rewrite, delete or truncate history", async () => {
      const upd = await service.from("audit_events").update({ action: "tampered" }).eq("id", eventId);
      expect(upd.error?.code).toBe("42501");
      const del = await service.from("audit_events").delete().eq("id", eventId);
      expect(del.error?.code).toBe("42501");
      const ins = await service.from("audit_events").insert({ org_id: s.orgId, action: "x", entity_type: "machine" });
      expect(ins.error?.code).toBe("42501");
      const { data } = await service.from("audit_events").select("action").eq("id", eventId).single();
      expect(data!.action).not.toBe("tampered");
    });
  });
});
