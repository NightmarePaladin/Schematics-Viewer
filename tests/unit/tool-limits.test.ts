import { describe, expect, it } from "vitest";
import { DEFAULT_MIN, LIMIT_KEYS, minRoleFor, normalizeLimits, toolAllowed } from "@/lib/tool-limits";

describe("tool limits", () => {
  it("defaults: technicians annotate, viewers can export, only managers share", () => {
    expect(toolAllowed("technician", "pen", {})).toBe(true);
    expect(toolAllowed("viewer", "pen", {})).toBe(false);
    expect(toolAllowed("viewer", "export", {})).toBe(true);
    expect(toolAllowed("technician", "share", {})).toBe(false);
    expect(toolAllowed("maintenance_manager", "share", {})).toBe(true);
    expect(toolAllowed("admin", "share", null)).toBe(true);
  });

  it("an override raises (or lowers) the floor for one key only", () => {
    const limits = { highlight: "maintenance_manager", share: "technician" } as const;
    expect(toolAllowed("technician", "highlight", limits)).toBe(false);
    expect(toolAllowed("maintenance_manager", "highlight", limits)).toBe(true);
    expect(toolAllowed("technician", "arrow", limits)).toBe(true);
    expect(toolAllowed("technician", "share", limits)).toBe(true);
  });

  it("non-members are always denied", () => {
    for (const k of LIMIT_KEYS) expect(toolAllowed(null, k, {})).toBe(false);
  });

  it("a bad stored value falls back to the default", () => {
    expect(minRoleFor("pen", { pen: "superuser" } as never)).toBe(DEFAULT_MIN.pen);
  });

  it("normalizeLimits keeps only valid keys and roles that differ from the default", () => {
    expect(
      normalizeLimits({ pen: "technician", highlight: "admin", export: "viewer", share: "technician", nope: "admin", box: "root", arrow: 3 }),
    ).toEqual({ highlight: "admin", share: "technician" });
  });
});
