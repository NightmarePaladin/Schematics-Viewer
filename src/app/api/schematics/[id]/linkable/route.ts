import { NextResponse } from "next/server";
import { z } from "zod";
import { check, handler, notFound } from "@/lib/api";
import { requireOrg, requireSchematicLevel } from "@/lib/auth";
import { descendantsOf } from "@/lib/machine-tree";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/schematics/:id/linkable — schematics an annotation on this drawing may link to: those of machines that are
 * descendants of this schematic's machine. Row-level security hides any the caller cannot view.
 */
export const GET = handler<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw notFound("Schematic");
  const s = await requireOrg();
  await requireSchematicLevel(s, id, "view");
  const { data: sc } = await s.supabase.from("schematics").select("machine_id").eq("id", id).maybeSingle();
  if (!sc) throw notFound("Schematic");
  const machines = check(await s.supabase.from("machines").select("id, name, parent_id"));
  const sub = descendantsOf(machines, sc.machine_id);
  if (sub.length === 0) return NextResponse.json({ data: [] });
  const names = new Map(sub.map((m) => [m.id, m.name as string]));
  const rows = check(
    await s.supabase.from("schematics").select("id, title, machine_id").in("machine_id", sub.map((m) => m.id)).order("title"),
  );
  return NextResponse.json({
    data: rows.map((r) => ({ id: r.id as string, title: r.title as string, machine_name: names.get(r.machine_id as string) ?? "" })),
  });
});
