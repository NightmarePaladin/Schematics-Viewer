import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, check, handler, notFound } from "@/lib/api";
import { requireOrg, requireSchematicLevel } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };
const SIGNED_URL_TTL_SECONDS = 60;

/**
 * GET /api/schematics/:id/file — returns a 60-second signed URL for the private PDF.
 * Authorization happens twice: here (schematic_level >= view) and again by the storage RLS policy
 * when the signed URL is created with the caller's own token. No public URL ever exists.
 */
export const GET = handler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw notFound("Schematic");
  const s = await requireOrg();
  await requireSchematicLevel(s, id, "view");
  // ?revision=<id> serves a superseded revision (RLS: needs View on this schematic)
  const revId = new URL(req.url).searchParams.get("revision");
  let row: { storage_path: string };
  if (revId && z.string().uuid().safeParse(revId).success) {
    const r = await s.supabase.from("schematic_revisions").select("storage_path").eq("id", revId).eq("schematic_id", id).maybeSingle();
    if (!r.data) throw notFound("Revision");
    row = r.data;
  } else {
    row = check(await s.supabase.from("schematics").select("storage_path").eq("id", id).single());
  }
  const { data, error } = await s.supabase.storage.from("schematics").createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) throw new ApiError(502, "storage_error", "Could not create a download link for this file.");
  await s.supabase.rpc("log_schematic_view", { p_schematic: id }); // append-only audit entry (best effort)
  return NextResponse.json(
    { url: data.signedUrl, expires_in: SIGNED_URL_TTL_SECONDS },
    { headers: { "Cache-Control": "no-store" } },
  );
});
