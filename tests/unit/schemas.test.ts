import { describe, expect, it } from "vitest";
import { annotationCreateSchema, grantCreateSchema, machineCreateSchema, machineUpdateSchema } from "@/lib/schemas";

const validMachine = {
  name: "Boiler 3",
  category: "Boiler",
  manufacturer: "Acme",
  model_number: "B-100",
  serial_number: "SN-001",
};

describe("machine metadata validation", () => {
  it("accepts required fields and fills defaults", () => {
    const r = machineCreateSchema.parse(validMachine);
    expect(r.status).toBe("operational");
    expect(r.latitude).toBeNull();
  });

  it.each(["name", "category", "manufacturer", "model_number", "serial_number"])("requires %s", (field) => {
    const bad = { ...validMachine, [field]: "  " };
    expect(machineCreateSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects out-of-range or half-specified coordinates", () => {
    expect(machineCreateSchema.safeParse({ ...validMachine, latitude: 91, longitude: 0 }).success).toBe(false);
    expect(machineCreateSchema.safeParse({ ...validMachine, latitude: 10 }).success).toBe(false);
    expect(machineCreateSchema.safeParse({ ...validMachine, latitude: "40.7", longitude: "-74" }).success).toBe(true);
  });

  it("rejects bad status and date", () => {
    expect(machineCreateSchema.safeParse({ ...validMachine, status: "exploded" }).success).toBe(false);
    expect(machineCreateSchema.safeParse({ ...validMachine, installed_on: "12/01/2020" }).success).toBe(false);
  });

  it("requires lat/lon together on update", () => {
    expect(machineUpdateSchema.safeParse({ latitude: 10 }).success).toBe(false);
    expect(machineUpdateSchema.safeParse({ name: "x" }).success).toBe(true);
  });
});

describe("annotation payload validation", () => {
  const base = { schematic_id: "6f1b7c64-1d8a-4f5e-9d3c-0a1b2c3d4e5f", page_number: 1 };

  it("accepts a point with normalized coordinates", () => {
    expect(annotationCreateSchema.safeParse({ ...base, type: "point", x: 0.5, y: 0.25 }).success).toBe(true);
  });

  it("rejects pixel-like coordinates", () => {
    expect(annotationCreateSchema.safeParse({ ...base, type: "point", x: 340, y: 120 }).success).toBe(false);
  });

  it("requires size for boxes and keeps them inside the page", () => {
    expect(annotationCreateSchema.safeParse({ ...base, type: "box", x: 0.1, y: 0.1 }).success).toBe(false);
    expect(
      annotationCreateSchema.safeParse({ ...base, type: "box", x: 0.9, y: 0.1, width: 0.2, height: 0.1 }).success,
    ).toBe(false);
    expect(
      annotationCreateSchema.safeParse({ ...base, type: "box", x: 0.1, y: 0.1, width: 0.2, height: 0.1 }).success,
    ).toBe(true);
  });

  it("requires text for comments and callouts", () => {
    expect(annotationCreateSchema.safeParse({ ...base, type: "comment", x: 0.1, y: 0.1 }).success).toBe(false);
    expect(
      annotationCreateSchema.safeParse({ ...base, type: "comment", x: 0.1, y: 0.1, body: "Check relay" }).success,
    ).toBe(true);
  });
});

describe("grant validation", () => {
  it("needs exactly one grantee", () => {
    const id = "6f1b7c64-1d8a-4f5e-9d3c-0a1b2c3d4e5f";
    expect(grantCreateSchema.safeParse({ level: "view" }).success).toBe(false);
    expect(grantCreateSchema.safeParse({ level: "view", user_id: id, group_id: id }).success).toBe(false);
    expect(grantCreateSchema.safeParse({ level: "edit", group_id: id }).success).toBe(true);
  });
});
