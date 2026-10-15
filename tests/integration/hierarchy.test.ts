import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasSupabaseCreds, seed, userClient, USERS, type SeedResult } from "../../scripts/lib/seed-lib";

/** Machine hierarchy + critical-component inheritance against the real database. */
describe.skipIf(!hasSupabaseCreds())("machine hierarchy and critical components (real Supabase)", () => {
  let s: SeedResult;
  let admin: SupabaseClient;
  let tech: SupabaseClient;
  let viewer: SupabaseClient;
  let outsider: SupabaseClient;
  let manager: SupabaseClient;
  let adminUser: SupabaseClient; // a real org member (the service-role client is not a member, so the function returns nothing for it)
  const tempMachines: string[] = [];
  const tempIssues: string[] = [];

  const affected = async (client: SupabaseClient, org = s.orgId) => {
    const { data, error } = await client.rpc("inoperable_machines", { p_org: org });
    expect(error).toBeNull();
    return (data ?? []) as { machine_id: string; source_id: string; source_name: string | null }[];
  };
  const ids = (rows: { machine_id: string }[]) => rows.map((r) => r.machine_id).sort();

  const newMachine = async (name: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await admin
      .from("machines")
      .insert({ org_id: s.orgId, name, category: "Test", manufacturer: "Hier Works", model_number: "H", serial_number: `H-${name}-${Date.now()}`, created_by: s.ids.admin, ...extra })
      .select("id")
      .single();
    expect(error).toBeNull();
    tempMachines.push(data!.id);
    return data!.id as string;
  };
  const newIssue = async (machine: string, severity: string, status = "open") => {
    const { data, error } = await admin
      .from("maintenance_issues")
      .insert({ org_id: s.orgId, machine_id: machine, title: `hier-test ${severity}`, severity, status, reporter_id: s.ids.tech })
      .select("id")
      .single();
    expect(error).toBeNull();
    tempIssues.push(data!.id);
    return data!.id as string;
  };

  beforeAll(async () => {
    s = await seed();
    admin = adminClient();
    tech = await userClient(USERS.tech.email);
    viewer = await userClient(USERS.viewer.email);
    outsider = await userClient(USERS.outsider.email);
    manager = await userClient(USERS.manager.email);
    adminUser = await userClient(USERS.admin.email);
  });

  afterAll(async () => {
    if (tempIssues.length) await admin.from("maintenance_issues").delete().in("id", tempIssues);
    // children first so the hierarchy trigger/FKs never get in the way
    for (const id of [...tempMachines].reverse()) await admin.from("machines").delete().eq("id", id);
  });

  describe("seeded demo: critical HPU with an open high issue takes the press out of service", () => {
    it("the press is inoperable because of the HPU; the non-critical cabinet is unaffected", async () => {
      const rows = await affected(manager);
      const press = rows.filter((r) => r.machine_id === s.machines.press);
      expect(press.map((r) => r.source_id)).toEqual([s.machines.hpu]);
      expect(press[0].source_name).toBe("Hydraulic Power Unit HPU-7");
      expect(ids(rows)).not.toContain(s.machines.cabinet);
      expect(ids(rows)).not.toContain(s.machines.hpu);
    });

    it("users who cannot see the failing sub-machine still see the parent as inoperable, but not the sub-machine's name", async () => {
      for (const who of [tech, viewer]) {
        const press = (await affected(who)).find((r) => r.machine_id === s.machines.press);
        expect(press).toBeDefined();
        expect(press!.source_id).toBe(s.machines.hpu);
        expect(press!.source_name).toBeNull();
      }
    });

    it("another organization sees nothing", async () => {
      expect(await affected(outsider, s.orgId)).toEqual([]);
    });
  });

  describe("derived state clears and returns with the issue", () => {
    it("resolving the issue clears the inherited state; reopening restores it; minor severity does not trigger it", async () => {
      const { data: issue } = await admin.from("maintenance_issues").select("id, status, severity, resolution_note").eq("machine_id", s.machines.hpu).eq("title", "Pump P1 bearing failure").single();
      try {
        await admin.from("maintenance_issues").update({ status: "resolved", resolution_note: "Bearing replaced" }).eq("id", issue!.id);
        expect(ids(await affected(manager))).not.toContain(s.machines.press);

        await admin.from("maintenance_issues").update({ status: "in_progress", resolution_note: null }).eq("id", issue!.id);
        expect(ids(await affected(manager))).toContain(s.machines.press);

        await admin.from("maintenance_issues").update({ severity: "medium" }).eq("id", issue!.id);
        expect(ids(await affected(manager))).not.toContain(s.machines.press);

        await admin.from("maintenance_issues").update({ severity: "critical" }).eq("id", issue!.id);
        expect(ids(await affected(manager))).toContain(s.machines.press);
      } finally {
        await admin.from("maintenance_issues").update({ status: issue!.status, severity: issue!.severity, resolution_note: issue!.resolution_note }).eq("id", issue!.id);
      }
      expect(ids(await affected(manager))).toContain(s.machines.press);
    });

    it("a major issue on a NON-critical child does not affect the parent", async () => {
      const issue = await newIssue(s.machines.cabinet, "critical");
      expect(ids(await affected(manager))).toEqual([s.machines.press]); // only the seeded HPU cause
      await admin.from("maintenance_issues").delete().eq("id", issue);
    });
  });

  describe("propagation through a chain", () => {
    it("passes upward through critical parents and stops at a non-critical one", async () => {
      const top = await newMachine("chain-top");
      const mid = await newMachine("chain-mid", { parent_id: top, is_critical: true });
      const leaf = await newMachine("chain-leaf", { parent_id: mid, is_critical: true });
      const issue = await newIssue(leaf, "high");

      let rows = await affected(adminUser);
      expect(rows.filter((r) => r.source_id === leaf).map((r) => r.machine_id).sort()).toEqual([mid, top].sort());

      await admin.from("machines").update({ is_critical: false }).eq("id", mid);
      rows = await affected(adminUser);
      expect(rows.filter((r) => r.source_id === leaf).map((r) => r.machine_id)).toEqual([mid]);

      await admin.from("maintenance_issues").update({ status: "resolved", resolution_note: "ok" }).eq("id", issue);
      rows = await affected(adminUser);
      expect(rows.filter((r) => r.source_id === leaf)).toEqual([]);
    });
  });

  describe("hierarchy integrity", () => {
    it("rejects loops (A under B under A) and self-parenting", async () => {
      const a = await newMachine("loop-a");
      const b = await newMachine("loop-b", { parent_id: a });
      const loop = await admin.from("machines").update({ parent_id: b }).eq("id", a);
      expect(loop.error?.code).toBe("P0001");
      const self = await admin.from("machines").update({ parent_id: a }).eq("id", a);
      expect(self.error).not.toBeNull(); // rejected (as a loop by the trigger, and by the CHECK constraint behind it)
    });

    it("rejects a parent from another organization", async () => {
      const cross = await admin.from("machines").update({ parent_id: s.machines.press }).eq("id", s.otherMachineId);
      expect(cross.error?.code).toBe("23503");
    });

    it("deleting a parent un-links its children instead of deleting them", async () => {
      const parent = await newMachine("del-parent");
      const child = await newMachine("del-child", { parent_id: parent });
      expect((await admin.from("machines").delete().eq("id", parent)).error).toBeNull();
      const { data } = await admin.from("machines").select("id, parent_id").eq("id", child).single();
      expect(data?.parent_id).toBeNull();
    });

    it("limits the depth of the hierarchy", async () => {
      let prev = await newMachine("deep-0");
      let failure: string | undefined;
      for (let i = 1; i <= 12; i++) {
        const { data, error } = await admin
          .from("machines")
          .insert({ org_id: s.orgId, name: `deep-${i}`, category: "T", manufacturer: "Hier Works", model_number: "H", serial_number: `D-${i}-${Date.now()}`, created_by: s.ids.admin, parent_id: prev })
          .select("id")
          .single();
        if (error) { failure = error.code; break; }
        tempMachines.push(data.id);
        prev = data.id;
      }
      expect(failure).toBe("P0001");
    });
  });

  describe("partial updates keep stored values", () => {
    it("is_critical and parent_id survive an update that only changes the name", async () => {
      const { data: before } = await admin.from("machines").select("parent_id, is_critical, status").eq("id", s.machines.hpu).single();
      await admin.from("machines").update({ description: "touched by test" }).eq("id", s.machines.hpu);
      const { data: after } = await admin.from("machines").select("parent_id, is_critical, status").eq("id", s.machines.hpu).single();
      expect(after).toEqual(before);
      await admin.from("machines").update({ description: null }).eq("id", s.machines.hpu);
    });
  });
});
