import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, fromDbError, handler, notFound, parseBody } from "@/lib/api";
import { requireOrg } from "@/lib/auth";
import { assertParentVisible, loadFaults, statusOf } from "@/lib/machines";
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
  const m = await loadMachine(s, id);
  const faults = await loadFaults(s, s.orgId);
  return NextResponse.json({
    data: {
      ...m,
      effective_status: statusOf(m.status, id, faults),
      critical_issue_count: faults.critical.get(id) ?? 0,
      inoperable_because: faults.inherited.get(id) ?? [],
    },
  });
});

export const PATCH = handler<Ctx>(async (req, ctx) => {
  const s = await requireOrg();
  const { id } = await ctx.params;
  await loadMachine(s, id);
  const patch = await parseBody(req, machineUpdateSchema);
  if (patch.parent_id !== undefined) await assertParentVisible(s, s.orgId, patch.parent_id);
  // RLS update policy decides whether this caller may edit; 0 rows back means denied.
  const { data, error } = await s.supabase.from("machines").update(patch).eq("id", id).select().maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw new ApiError(403, "forbidden", "You do not have permission to edit this machine.");
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
  return new NextResponse(null, { status: 204 });
});

