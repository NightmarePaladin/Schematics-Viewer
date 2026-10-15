import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, fromDbError, handler, notFound, parseBody } from "@/lib/api";
import { audit, requireOrg } from "@/lib/auth";
import { machineUpdateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();

async function loadMachine(s: Awaited<ReturnType<typeof requireOrg>>, id: string) {
  if (!idSchema.safeParse(id).success) throw notFound("Machine");
  const { data, error } = await s.supabase.from("machines").select("*").eq("id", id).eq("org_id", s.orgId).maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw notFound("Machine");
  return data;
}

export const GET = handler<Ctx>(async (_req, ctx) => {
  const s = await requireOrg();
  const { id } = await ctx.params;
  return NextResponse.json({ data: await loadMachine(s, id) });
});

export const PATCH = handler<Ctx>(async (req, ctx) => {
  const s = await requireOrg();
  const { id } = await ctx.params;
  await loadMachine(s, id);
  const patch = await parseBody(req, machineUpdateSchema);
  // RLS update policy decides whether this caller may edit; 0 rows back means denied.
  const { data, error } = await s.supabase.from("machines").update(patch).eq("id", id).select().maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw new ApiError(403, "forbidden", "You do not have permission to edit this machine.");
  await audit(s, s.orgId, "machine.update", "machine", id, { fields: Object.keys(patch) });
  return NextResponse.json({ data });
});

export const DELETE = handler<Ctx>(async (_req, ctx) => {
  const s = await requireOrg();
  const { id } = await ctx.params;
  await loadMachine(s, id);
  const { data, error } = await s.supabase.from("machines").delete().eq("id", id).select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw new ApiError(403, "forbidden", "Only organization admins and maintenance managers can delete machines.");
  // Storage objects of its schematics are cleaned up by the schematic delete route; remaining files are orphaned-safe (private).
  await audit(s, s.orgId, "machine.delete", "machine", id);
  return new NextResponse(null, { status: 204 });
});

