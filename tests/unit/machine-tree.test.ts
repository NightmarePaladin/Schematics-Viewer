import { describe, expect, it } from "vitest";
import { ancestorsOf, childrenOf, descendantsOf, eligibleParents, wouldCreateCycle } from "@/lib/machine-tree";
import { applyMachineSearch, buildOrFilter, searchTerms } from "@/lib/machine-search";
import { machineCreateSchema, machineUpdateSchema } from "@/lib/schemas";

// plant -> line -> press -> hpu ; plant -> line -> conveyor
const all = [
  { id: "plant", parent_id: null },
  { id: "line", parent_id: "plant" },
  { id: "press", parent_id: "line" },
  { id: "hpu", parent_id: "press" },
  { id: "conveyor", parent_id: "line" },
  { id: "other", parent_id: null },
];

describe("machine hierarchy helpers", () => {
  it("lists ancestors from the parent up to the root", () => {
    expect(ancestorsOf(all, "hpu").map((n) => n.id)).toEqual(["press", "line", "plant"]);
    expect(ancestorsOf(all, "plant")).toEqual([]);
  });

  it("lists children and all descendants", () => {
    expect(childrenOf(all, "line").map((n) => n.id).sort()).toEqual(["conveyor", "press"]);
    expect(descendantsOf(all, "line").map((n) => n.id).sort()).toEqual(["conveyor", "hpu", "press"]);
    expect(descendantsOf(all, "other")).toEqual([]);
  });

  it("detects cycles", () => {
    expect(wouldCreateCycle(all, "press", "press")).toBe(true);
    expect(wouldCreateCycle(all, "line", "hpu")).toBe(true);
    expect(wouldCreateCycle(all, "hpu", "conveyor")).toBe(false);
    expect(wouldCreateCycle(all, "hpu", null)).toBe(false);
  });

  it("offers only valid parents", () => {
    expect(eligibleParents(all, "line").map((n) => n.id).sort()).toEqual(["other", "plant"]);
    expect(eligibleParents(all, null)).toHaveLength(6);
  });

  it("survives corrupt data with a loop or a parent the user cannot see", () => {
    const bad = [{ id: "a", parent_id: "b" }, { id: "b", parent_id: "a" }, { id: "c", parent_id: "hidden" }];
    expect(ancestorsOf(bad, "a").map((n) => n.id)).toEqual(["b"]);
    expect(ancestorsOf(bad, "c")).toEqual([]);
    expect(descendantsOf(bad, "a").map((n) => n.id)).toEqual(["b"]);
  });
});

describe("parent_id validation", () => {
  const base = { name: "n", category: "c", manufacturer: "m", model_number: "x", serial_number: "s" };
  it("accepts a uuid, null or empty string", () => {
    expect(machineCreateSchema.parse({ ...base, parent_id: "6f1b7c64-1d8a-4f5e-9d3c-0a1b2c3d4e5f" }).parent_id).toBeTruthy();
    expect(machineCreateSchema.parse({ ...base, parent_id: "" }).parent_id).toBeNull();
    expect(machineCreateSchema.parse(base).parent_id).toBeNull();
  });
  it("rejects a non-uuid", () => {
    expect(machineCreateSchema.safeParse({ ...base, parent_id: "not-an-id" }).success).toBe(false);
  });
  it("does not null the parent on a partial update that omits it", () => {
    const r = machineUpdateSchema.parse({ name: "x" });
    expect("parent_id" in r && r.parent_id !== undefined).toBe(false);
  });
});

describe("machine search helpers", () => {
  it("splits words and strips filter-breaking characters", () => {
    expect(searchTerms("  Air-Master,  (yard) 50% ")).toEqual(["Air-Master", "yard", "50"]);
    expect(searchTerms("")).toEqual([]);
    expect(searchTerms(undefined)).toEqual([]);
  });

  it("builds an OR filter across chosen columns", () => {
    expect(buildOrFilter("hp", ["name", "model_number"])).toBe("name.ilike.%hp%,model_number.ilike.%hp%");
  });

  it("ANDs words, ORs columns, and respects the chosen field", () => {
    const calls: string[] = [];
    const q = { or(f: string) { calls.push(f); return q; } };
    applyMachineSearch(q, "airmaster yard", "all");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("manufacturer.ilike.%airmaster%");
    expect(calls[1]).toContain("location.ilike.%yard%");
    calls.length = 0;
    applyMachineSearch(q, "yard", "location");
    expect(calls).toEqual(["location.ilike.%yard%"]);
    calls.length = 0;
    applyMachineSearch(q, "   ", "name");
    expect(calls).toEqual([]);
  });
});

import { computeInoperable } from "@/lib/machine-tree";

describe("update schema does not overwrite omitted fields (regression)", () => {
  it("PATCH {name} yields only name — no status/is_critical/parent_id defaults", () => {
    expect(machineUpdateSchema.parse({ name: "x" })).toEqual({ name: "x" });
    expect(machineUpdateSchema.parse({})).toEqual({});
  });
  it("create still applies defaults", () => {
    const r = machineCreateSchema.parse({ name: "n", category: "c", manufacturer: "m", model_number: "x", serial_number: "s" });
    expect(r.status).toBe("operational");
    expect(r.is_critical).toBe(false);
    expect(r.parent_id).toBeNull();
  });
});

describe("critical components make their parent inoperable (derived, clears on resolution)", () => {
  // plant -> line(critical) -> press(critical) -> hpu(critical)   and   line -> conveyor (NOT critical)
  const m = [
    { id: "plant", parent_id: null, is_critical: false },
    { id: "line", parent_id: "plant", is_critical: true },
    { id: "press", parent_id: "line", is_critical: true },
    { id: "hpu", parent_id: "press", is_critical: true },
    { id: "conveyor", parent_id: "line", is_critical: false },
  ];
  const issue = (machine_id: string, severity = "high", status = "open") => ({ machine_id, severity, status });
  const keys = (r: Map<string, string[]>) => [...r.keys()].sort();

  it("a major issue on a critical child makes its parent inoperable", () => {
    expect(computeInoperable(m, [issue("hpu")]).get("press")).toEqual(["hpu"]);
  });

  it("continues upward through critical parents", () => {
    expect(keys(computeInoperable(m, [issue("hpu")]))).toEqual(["line", "plant", "press"]);
  });

  it("stops at a parent that is not critical", () => {
    const stop = m.map((n) => (n.id === "press" ? { ...n, is_critical: false } : n));
    expect(keys(computeInoperable(stop, [issue("hpu")]))).toEqual(["press"]);
  });

  it("ignores minor severities (low, medium) and non-critical children", () => {
    expect(computeInoperable(m, [issue("hpu", "low"), issue("hpu", "medium")]).size).toBe(0);
    expect(computeInoperable(m, [issue("conveyor", "critical")]).size).toBe(0);
  });

  it("high and critical both count, in_progress still counts, resolved clears it", () => {
    expect(computeInoperable(m, [issue("hpu", "critical")]).size).toBeGreaterThan(0);
    expect(computeInoperable(m, [issue("hpu", "high", "in_progress")]).size).toBeGreaterThan(0);
    expect(computeInoperable(m, [issue("hpu", "high", "resolved")]).size).toBe(0);
    expect(computeInoperable(m, []).size).toBe(0);
  });

  it("a critical machine with no parent affects nothing, and multiple sources are all reported", () => {
    expect(computeInoperable([{ id: "solo", parent_id: null, is_critical: true }], [issue("solo")]).size).toBe(0);
    const two = [
      { id: "sys", parent_id: null, is_critical: false },
      { id: "a", parent_id: "sys", is_critical: true },
      { id: "b", parent_id: "sys", is_critical: true },
    ];
    expect(computeInoperable(two, [issue("a"), issue("b", "critical")]).get("sys")?.sort()).toEqual(["a", "b"]);
  });

  it("is not fooled by corrupt loops", () => {
    const loop = [{ id: "x", parent_id: "y", is_critical: true }, { id: "y", parent_id: "x", is_critical: true }];
    expect(() => computeInoperable(loop, [issue("x")])).not.toThrow();
  });
});
