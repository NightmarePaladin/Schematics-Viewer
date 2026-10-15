import { describe, expect, it } from "vitest";
import { canCreateMachine, effectiveSchematicLevel, levelAtLeast, type GrantLike } from "@/lib/permissions";

const U = "user-1";
const G1 = "group-1";
const G2 = "group-2";

const grants: GrantLike[] = [
  { user_id: null, group_id: G1, level: "comment" },
  { user_id: U, group_id: null, level: "view" },
  { user_id: "someone-else", group_id: null, level: "manage" },
  { user_id: null, group_id: G2, level: "manage" },
];

describe("effective schematic permissions", () => {
  it("denies non-members of the organization (cross-org)", () => {
    expect(effectiveSchematicLevel({ userId: U, role: null, groupIds: [G1, G2], grants })).toBeNull();
  });

  it("gives admins and managers implicit manage", () => {
    expect(effectiveSchematicLevel({ userId: U, role: "admin", groupIds: [], grants: [] })).toBe("manage");
    expect(effectiveSchematicLevel({ userId: U, role: "maintenance_manager", groupIds: [], grants: [] })).toBe("manage");
  });

  it("returns nothing for a technician without applicable grants", () => {
    expect(effectiveSchematicLevel({ userId: "u3", role: "technician", groupIds: [], grants })).toBeNull();
  });

  it("combines individual and group grants taking the highest", () => {
    expect(effectiveSchematicLevel({ userId: U, role: "technician", groupIds: [G1], grants })).toBe("comment");
    expect(effectiveSchematicLevel({ userId: U, role: "technician", groupIds: [G1, G2], grants })).toBe("manage");
  });

  it("applies group grants for users in multiple groups", () => {
    expect(effectiveSchematicLevel({ userId: "u2", role: "technician", groupIds: [G2], grants })).toBe("manage");
  });

  it("caps the Viewer role at view even if a higher level is granted", () => {
    const level = effectiveSchematicLevel({ userId: U, role: "viewer", groupIds: [G2], grants });
    expect(level).toBe("view");
    expect(levelAtLeast(level, "comment")).toBe(false);
  });

  it("ranks levels", () => {
    expect(levelAtLeast("edit", "comment")).toBe(true);
    expect(levelAtLeast("view", "edit")).toBe(false);
    expect(levelAtLeast(null, "view")).toBe(false);
  });

  it("restricts machine creation by role", () => {
    expect(canCreateMachine("viewer")).toBe(false);
    expect(canCreateMachine("technician")).toBe(true);
    expect(canCreateMachine(null)).toBe(false);
  });
});
