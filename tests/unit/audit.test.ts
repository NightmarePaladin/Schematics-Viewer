import { describe, expect, it } from "vitest";
import { actionVerb, applyAuditFilters, auditToCsv, csvCell, describeEvent, eventLink, noNames, sanitizeFilters, type AuditEvent } from "@/lib/audit";

const ev = (over: Partial<AuditEvent>): AuditEvent => ({
  id: 1,
  created_at: "2026-10-15T12:00:00+00:00",
  actor_id: "11111111-1111-4111-8111-111111111111",
  actor_label: "Ada Admin (admin@schematichub.test)",
  action: "machine.updated",
  entity_type: "machine",
  entity_id: "22222222-2222-4222-8222-222222222222",
  metadata: {},
  ...over,
});

describe("describing audit events", () => {
  it("names the action, the thing and its label", () => {
    expect(describeEvent(ev({ action: "machine.created", metadata: { label: "Press 7" } })).title).toBe("Created machine “Press 7”");
    expect(describeEvent(ev({ action: "schematic.viewed", entity_type: "schematic", metadata: { label: "HPU" } })).title).toBe("Viewed schematic “HPU”");
    expect(describeEvent(ev({ action: "reply.created", entity_type: "reply" })).title).toBe("Created reply");
  });

  it("lists what changed, from → to", () => {
    const d = describeEvent(ev({ action: "issue.updated", entity_type: "issue", metadata: { label: "Leak", changes: { status: { from: "open", to: "resolved" }, resolution_note: { from: "null", to: "Fixed" } } } }));
    expect(d.detail).toBe("status: open → resolved; resolution note: null → Fixed");
  });

  it("falls back to useful context when there is no diff", () => {
    expect(describeEvent(ev({ action: "issue.created", entity_type: "issue", metadata: { severity: "high", status: "open" } })).detail).toBe("severity: high; status: open");
    expect(describeEvent(ev({ action: "log.created", entity_type: "log", metadata: { entry_type: "repair" } })).detail).toBe("entry type: repair");
  });

  it("still reads events written by the older app-level logger", () => {
    const d = describeEvent(ev({ action: "machine.create", metadata: { serial_number: "X1" } }));
    expect(d.title).toBe("machine create");
    expect(actionVerb("machine.create")).toBe("create");
  });

  it("links to what still exists", () => {
    expect(eventLink(ev({}))).toBe("/machines/22222222-2222-4222-8222-222222222222");
    expect(eventLink(ev({ action: "machine.deleted" }))).toBeNull();
    expect(eventLink(ev({ entity_type: "schematic", action: "schematic.viewed" }))).toBe("/schematics/22222222-2222-4222-8222-222222222222");
    expect(eventLink(ev({ entity_type: "annotation", action: "annotation.created", metadata: { schematic_id: "s1", page_number: 3 } }))).toBe("/schematics/s1?page=3");
    expect(eventLink(ev({ entity_type: "issue", action: "issue.updated", metadata: { machine_id: "m1" } }))).toBe("/machines/m1");
    expect(eventLink(ev({ entity_type: "grant", action: "grant.created" }))).toBeNull(); // no schematic recorded
  });
});

describe("filters", () => {
  it("accepts only known types, real uuids and ISO dates, and strips filter syntax", () => {
    expect(sanitizeFilters({ entity: "machine", actor: "11111111-1111-4111-8111-111111111111", from: "2026-01-02", to: "2026-02-03", q: " a,b(c)% " })).toEqual({
      entity: "machine", actor: "11111111-1111-4111-8111-111111111111", from: "2026-01-02", to: "2026-02-03", q: "a b c",
    });
    expect(sanitizeFilters({ entity: "nope", actor: "x", from: "01/02/2026", to: "tomorrow", q: "" })).toEqual({ entity: undefined, actor: undefined, from: undefined, to: undefined, q: undefined });
  });

  it("builds the query from the filters", () => {
    const calls: string[] = [];
    const q = {
      eq: (c: string, v: string) => (calls.push(`eq ${c}=${v}`), q),
      gte: (c: string, v: string) => (calls.push(`gte ${c}=${v}`), q),
      lte: (c: string, v: string) => (calls.push(`lte ${c}=${v}`), q),
      or: (f: string) => (calls.push(`or ${f}`), q),
    };
    applyAuditFilters(q, { entity: "issue", from: "2026-01-01", to: "2026-01-31", q: "leak" });
    expect(calls).toEqual([
      "eq entity_type=issue",
      "gte created_at=2026-01-01T00:00:00.000Z",
      "lte created_at=2026-01-31T23:59:59.999Z",
      "or action.ilike.%leak%,actor_label.ilike.%leak%,metadata->>label.ilike.%leak%,metadata->>grantee.ilike.%leak%,metadata->>member.ilike.%leak%,metadata->>schematic.ilike.%leak%,metadata->>group.ilike.%leak%",
    ]);
    calls.length = 0;
    applyAuditFilters(q, {});
    expect(calls).toEqual([]);
  });
});

describe("CSV export", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(null)).toBe("");
  });

  it("neutralizes spreadsheet formulas", () => {
    for (const bad of ["=1+1", "+SUM(A1)", "-2", "@cmd", "\tTAB"]) expect(csvCell(bad).startsWith("'")).toBe(true);
    expect(csvCell("-")).toBe("'-");
    expect(csvCell("normal text")).toBe("normal text");
  });

  it("writes a header and one row per event", () => {
    const csv = auditToCsv([ev({ action: "issue.updated", entity_type: "issue", metadata: { label: "=HYPERLINK()", changes: { status: { from: "open", to: "resolved" } } } })]);
    const [head, row] = csv.trim().split("\r\n");
    expect(head).toBe("time_utc,actor,action,entity_type,entity_id,description,details,metadata_json");
    expect(row).toContain("Ada Admin (admin@schematichub.test)");
    expect(row).toContain("issue.updated");
    expect(row).toContain("status: open → resolved");
    expect(row).not.toMatch(/,=HYPERLINK/);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("access changes say who lost or gained access, and to what", () => {
  const grant = (action: string, m: Record<string, unknown>) => ev({ action, entity_type: "grant", metadata: m });
  const SID = "33333333-3333-4333-8333-333333333333";

  it("a removed grant names the person, the level and the schematic (recorded at the time)", () => {
    const d = describeEvent(grant("grant.deleted", { level: "view", grantee: "Vera Viewer (viewer@schematichub.test)", grantee_kind: "person", schematic: "Compressor wiring", schematic_id: SID }));
    expect(d.title).toBe("Took away View access from Vera Viewer (viewer@schematichub.test)");
    expect(d.detail).toBe("on “Compressor wiring”");
  });

  it("marks groups as groups", () => {
    const d = describeEvent(grant("grant.deleted", { level: "edit", grantee: "Hydraulics Crew", grantee_kind: "group", schematic: "HPU" }));
    expect(d.title).toBe("Took away Edit access from Hydraulics Crew (group)");
  });

  it("describes grants being given and changed", () => {
    expect(describeEvent(grant("grant.created", { level: "comment", grantee: "Max", grantee_kind: "person", schematic: "S" })).title).toBe("Gave Max Comment access");
    const upd = describeEvent(grant("grant.updated", { level: "edit", grantee: "Max", grantee_kind: "person", schematic: "S", changes: { level: { from: "view", to: "edit" } } }));
    expect(upd.title).toBe("Changed access for Max");
    expect(upd.detail).toBe("on “S”; level: view → edit");
  });

  it("older entries without recorded names are resolved from ids, or say the thing was deleted", () => {
    const names = noNames();
    names.groups.set("g1", "Hydraulics Crew");
    names.users.set("u1", "Vera Viewer (viewer@schematichub.test)");
    names.schematics.set(SID, "Compressor wiring");
    const oldGroup = grant("grant.deleted", { level: "view", group_id: "g1", schematic_id: SID });
    expect(describeEvent(oldGroup, names)).toEqual({ title: "Took away View access from Hydraulics Crew (group)", detail: "on “Compressor wiring”" });
    expect(describeEvent(grant("grant.deleted", { level: "view", user_id: "u1", schematic_id: SID }), names).title).toBe("Took away View access from Vera Viewer (viewer@schematichub.test)");
    const gone = describeEvent(grant("grant.deleted", { level: "view", user_id: "ghost", schematic_id: "gone" }), names);
    expect(gone.title).toBe("Took away View access from a deleted user");
    expect(gone.detail).toBe("on “a deleted schematic”");
    expect(describeEvent(grant("grant.deleted", { level: "view", group_id: "ghost" }), names).title).toBe("Took away View access from a deleted group (group)");
  });

  it("a grant entry links to its schematic, unless that schematic no longer exists", () => {
    const e = grant("grant.deleted", { level: "view", user_id: "u1", schematic_id: SID });
    expect(eventLink(e)).toBe(`/schematics/${SID}`);
    const names = noNames();
    expect(eventLink(e, names)).toBeNull();
    names.schematics.set(SID, "S");
    expect(eventLink(e, names)).toBe(`/schematics/${SID}`);
    expect(eventLink(grant("grant.deleted", { level: "view", schematic: "S", schematic_id: SID }), noNames())).toBe(`/schematics/${SID}`);
  });

  it("member and group-member changes name the person", () => {
    const m = (action: string, entity: string, meta: Record<string, unknown>) => describeEvent(ev({ action, entity_type: entity, metadata: meta }));
    expect(m("membership.created", "membership", { member: "Tara (tech@x)", role: "technician" }).title).toBe("Added Tara (tech@x) to the organization as technician");
    expect(m("membership.deleted", "membership", { member: "Tara (tech@x)", role: "technician" }).title).toBe("Removed Tara (tech@x) from the organization (was technician)");
    const role = m("membership.updated", "membership", { member: "Tara (tech@x)", role: "viewer", changes: { role: { from: "technician", to: "viewer" } } });
    expect(role.title).toBe("Changed the role of Tara (tech@x)");
    expect(role.detail).toBe("role: technician → viewer");
    expect(m("group_member.deleted", "group_member", { member: "Theo (t2@x)", group: "Night shift" }).title).toBe("Removed Theo (t2@x) from group “Night shift”");
    expect(m("group_member.created", "group_member", { member: "Theo (t2@x)", group: "Night shift" }).title).toBe("Added Theo (t2@x) to group “Night shift”");
  });

  it("the CSV uses the same readable wording", () => {
    const csv = auditToCsv([grant("grant.deleted", { level: "view", grantee: "Vera", grantee_kind: "person", schematic: "S" })]);
    expect(csv).toContain("Took away View access from Vera");
  });
});
