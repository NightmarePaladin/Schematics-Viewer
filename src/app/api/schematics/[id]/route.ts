import { NextResponse } from "next/server";
import { z } from "zod";
import { check, fromDbError, handler, notFound, parseBody } from "@/lib/api";
import { audit, requireOrg, requireSchematicLevel } from "@/lib/auth";
import { schematicUpdateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

async function ready(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound("Schematic");
  return requireOrg();
}

export const GET = handler<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const s = await ready(id);
  const level = await requireSchematicLevel(s, id, "view");
  const row = check(
    await s.supabase
      .from("schematics")
      .select("*, machine:machines(id, name, manufacturer, model_number), uploader:profiles!schematics_uploaded_by_fkey(display_name)")
      .eq("id", id)
      .single(),
  );
  return NextResponse.json({ data: row, permission: level });
});

export const PATCH = handler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const s = await ready(id);
  await requireSchematicLevel(s, id, "edit");
  const patch = await parseBody(req, schematicUpdateSchema);
  const { data, error } = await s.supabase.from("schematics").update(patch).eq("id", id).select().single();
  if (error) throw fromDbError(error);
  await audit(s, s.orgId, "schematic.update", "schematic", id, { fields: Object.keys(patch) });
  return NextResponse.json({ data });
});

/** DELETE removes the file first (storage policy needs the row to authorize), then the row and its annotations. */
export const DELETE = handler<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const s = await ready(id);
  await requireSchematicLevel(s, id, "manage");
  const { data: row } = await s.supabase.from("schematics").select("storage_path").eq("id", id).single();
  if (row) await s.supabase.storage.from("schematics").remove([row.storage_path]);
  const del = await s.supabase.from("schematics").delete().eq("id", id);
  if (del.error) throw fromDbError(del.error);
  await audit(s, s.orgId, "schematic.delete", "schematic", id);
  return new NextResponse(null, { status: 204 });
});
