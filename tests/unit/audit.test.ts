import { describe, expect, it } from "vitest";
import { actionVerb, applyAuditFilters, auditToCsv, csvCell, describeEvent, eventLink, sanitizeFilters, type AuditEvent } from "@/lib/audit";

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
    expect(describeEvent(ev({ action: "grant.deleted", entity_type: "grant" })).title).toBe("Deleted access grant");
    expect(describeEvent(ev({ action: "schematic.viewed", entity_type: "schematic", metadata: { label: "HPU" } })).title).toBe("Viewed schematic “HPU”");
    expect(describeEvent(ev({ action: "group_member.created", entity_type: "group_member" })).title).toBe("Created group member");
  });

  it("lists what changed, from → to", () => {
    const d = describeEvent(ev({ action: "issue.updated", entity_type: "issue", metadata: { label: "Leak", changes: { status: { from: "open", to: "resolved" }, resolution_note: { from: "null", to: "Fixed" } } } }));
    expect(d.detail).toBe("status: open → resolved; resolution note: null → Fixed");
  });

  it("falls back to useful context when there is no diff", () => {
    expect(describeEvent(ev({ action: "grant.created", entity_type: "grant", metadata: { level: "edit" } })).detail).toBe("level: edit");
    expect(describeEvent(ev({ action: "membership.created", entity_type: "membership", metadata: { role: "technician" } })).detail).toBe("role: technician");
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
    expect(eventLink(ev({ entity_type: "grant", action: "grant.created" }))).toBeNull();
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
      "or action.ilike.%leak%,actor_label.ilike.%leak%,metadata->>label.ilike.%leak%",
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
