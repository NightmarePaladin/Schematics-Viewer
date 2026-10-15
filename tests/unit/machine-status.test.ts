import { describe, expect, it } from "vitest";
import { deriveStatus, isFaultStatus, isStatusFilter, STATUS_FILTERS, statusLabel } from "@/lib/machine-status";

describe("effective machine status", () => {
  const none = { critical: false, inherited: false };

  it("keeps the stored status when there is no fault", () => {
    for (const s of ["operational", "degraded", "down", "maintenance"]) expect(deriveStatus(s, none)).toBe(s);
  });

  it("an unresolved critical issue on the machine itself makes it 'critical'", () => {
    expect(deriveStatus("operational", { critical: true, inherited: false })).toBe("critical");
    expect(deriveStatus("degraded", { critical: true, inherited: false })).toBe("critical");
  });

  it("an inherited fault makes it 'inoperable'", () => {
    expect(deriveStatus("operational", { critical: false, inherited: true })).toBe("inoperable");
  });

  it("own critical fault takes precedence over an inherited one", () => {
    expect(deriveStatus("operational", { critical: true, inherited: true })).toBe("critical");
  });

  it("a retired machine stays retired", () => {
    expect(deriveStatus("retired", { critical: true, inherited: true })).toBe("retired");
  });

  it("recognizes and labels derived statuses; the filter offers them", () => {
    expect(isFaultStatus("critical")).toBe(true);
    expect(isFaultStatus("inoperable")).toBe(true);
    expect(isFaultStatus("down")).toBe(false);
    expect(statusLabel("critical")).toBe("critical fault");
    expect(statusLabel("inoperable")).toBe("inoperable (inherited)");
    expect(statusLabel("in_progress")).toBe("in progress");
    expect(STATUS_FILTERS).toEqual(expect.arrayContaining(["operational", "down", "critical", "inoperable"]));
    expect(isStatusFilter("critical")).toBe(true);
    expect(isStatusFilter("nonsense")).toBe(false);
    expect(isStatusFilter(undefined)).toBe(false);
  });
});
