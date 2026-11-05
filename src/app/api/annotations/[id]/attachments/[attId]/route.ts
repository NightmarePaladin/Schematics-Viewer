import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, fromDbError, handler, notFound } from "@/lib/api";
import { requireOrg } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string; attId: string }> };

/** DELETE — the author, or anyone with Manage. RLS decides; 0 rows = denied. */
export const DELETE = handler<Ctx>(async (_req, ctx) => {
  const { id, attId } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(attId).success) throw notFound("Attachment");
  const s = await requireOrg();
  const { data: row } = await s.supabase.from("annotation_attachments").select("storage_path").eq("id", attId).eq("annotation_id", id).maybeSingle();
  if (!row) throw notFound("Attachment");
  const { data, error } = await s.supabase.from("annotation_attachments").delete().eq("id", attId).select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw new ApiError(403, "forbidden", "You can only remove your own attachments unless you have Manage access.");
  await s.supabase.storage.from("annotation-files").remove([row.storage_path as string]); // best effort (needs Manage)
  return new NextResponse(null, { status: 204 });
});
