import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, fromDbError, handler, notFound, parseBody } from "@/lib/api";
import { requireOrg } from "@/lib/auth";
import { annotationUpdateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

async function ready(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound("Annotation");
  return requireOrg();
}

/** PATCH — author (with Comment) or anyone with Edit. RLS update policy is the gate; 0 rows = denied or missing. */
export const PATCH = handler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const s = await ready(id);
  const patch = await parseBody(req, annotationUpdateSchema);
  if (Object.keys(patch).length === 0) throw new ApiError(422, "empty_patch", "Nothing to update.");
  const { data: existing } = await s.supabase.from("annotations").select("id").eq("id", id).maybeSingle();
  if (!existing) throw notFound("Annotation");
  const { data, error } = await s.supabase.from("annotations").update(patch).eq("id", id).select().maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw new ApiError(403, "forbidden", "You can only edit your own annotations unless you have Edit access.");
  return NextResponse.json({ data });
});

export const DELETE = handler<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const s = await ready(id);
  const { data: existing } = await s.supabase.from("annotations").select("id").eq("id", id).maybeSingle();
  if (!existing) throw notFound("Annotation");
  const { data, error } = await s.supabase.from("annotations").delete().eq("id", id).select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw new ApiError(403, "forbidden", "You can only delete your own annotations unless you have Manage access.");
  return new NextResponse(null, { status: 204 });
});
