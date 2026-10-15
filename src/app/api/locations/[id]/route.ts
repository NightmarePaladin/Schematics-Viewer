import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, fromDbError, handler, notFound, parseBody } from "@/lib/api";
import { audit, requireOrg } from "@/lib/auth";
import { locationUpdateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

async function ready(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound("Location");
  return requireOrg();
}

/** PATCH — managers only (RLS). Renaming updates the name shown on every machine at that location. */
export const PATCH = handler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const s = await ready(id);
  const patch = await parseBody(req, locationUpdateSchema);
  const { data: existing } = await s.supabase.from("locations").select("id").eq("id", id).eq("org_id", s.orgId).maybeSingle();
  if (!existing) throw notFound("Location");
  const { data, error } = await s.supabase.from("locations").update(patch).eq("id", id).select().maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw new ApiError(403, "forbidden", "Only organization admins and maintenance managers can edit locations.");
  await audit(s, s.orgId, "location.update", "location", id, { fields: Object.keys(patch) });
  return NextResponse.json({ data });
});

/** DELETE — managers only. Machines at the location are kept and simply un-linked. */
export const DELETE = handler<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const s = await ready(id);
  const { data: existing } = await s.supabase.from("locations").select("id").eq("id", id).eq("org_id", s.orgId).maybeSingle();
  if (!existing) throw notFound("Location");
  const { data, error } = await s.supabase.from("locations").delete().eq("id", id).select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw new ApiError(403, "forbidden", "Only organization admins and maintenance managers can delete locations.");
  await audit(s, s.orgId, "location.delete", "location", id);
  return new NextResponse(null, { status: 204 });
});
