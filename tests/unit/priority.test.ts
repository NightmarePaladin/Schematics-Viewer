import { describe, expect, it } from "vitest";
import { issueCreateSchema, issueUpdateSchema } from "@/lib/schemas";
import { byPriorityThenNewest, priorityRank, REPAIR_PRIORITIES } from "@/lib/priority";

const machine = "6f1c2b9e-3b4a-4c7e-9d51-0a8f2e7c1b33";

describe("repair priority", () => {
  it("ranks urgent above high above normal above low, and unknown values as normal", () => {
    expect([...REPAIR_PRIORITIES].map(priorityRank)).toEqual([1, 2, 3, 4]);
    expect(priorityRank(undefined)).toBe(priorityRank("normal"));
    expect(priorityRank("whatever")).toBe(priorityRank("normal"));
  });

  it("sorts most urgent first, then newest first", () => {
    const rows = [
      { id: "a", repair_priority: "normal", created_at: "2026-11-01T10:00:00Z" },
      { id: "b", repair_priority: "urgent", created_at: "2026-10-01T10:00:00Z" },
      { id: "c", repair_priority: "normal", created_at: "2026-11-02T10:00:00Z" },
      { id: "d", repair_priority: "high", created_at: "2026-11-03T10:00:00Z" },
    ];
    expect(rows.sort(byPriorityThenNewest).map((r) => r.id)).toEqual(["b", "d", "c", "a"]);
  });
});

describe("issue schemas carry priority and a working status", () => {
  it("creation defaults to normal priority and open status", () => {
    const r = issueCreateSchema.parse({ machine_id: machine, title: "Leak" });
    expect(r.repair_priority).toBe("normal");
    expect(r.status).toBe("open");
  });

  it("accepts an explicit priority and an in-progress start, but not an invalid priority or a resolved start", () => {
    expect(issueCreateSchema.safeParse({ machine_id: machine, title: "Leak", repair_priority: "urgent", status: "in_progress" }).success).toBe(true);
    expect(issueCreateSchema.safeParse({ machine_id: machine, title: "Leak", repair_priority: "asap" }).success).toBe(false);
    expect(issueCreateSchema.safeParse({ machine_id: machine, title: "Leak", status: "resolved" }).success).toBe(false);
  });

  it("an update can change just the priority (no default silently overwrites it)", () => {
    expect(issueUpdateSchema.parse({ repair_priority: "high" })).toEqual({ repair_priority: "high" });
    expect(issueUpdateSchema.parse({})).toEqual({});
    expect(issueUpdateSchema.safeParse({ repair_priority: "low", status: "in_progress" }).success).toBe(true);
  });
});
