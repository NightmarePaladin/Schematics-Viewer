import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, check, handler, notFound } from "@/lib/api";
import { audit, requireOrg, requireSchematicLevel } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };
const SIGNED_URL_TTL_SECONDS = 60;

/**
 * GET /api/schematics/:id/file — returns a 60-second signed URL for the private PDF.
 * Authorization happens twice: here (schematic_level >= view) and again by the storage RLS policy
 * when the signed URL is created with the caller's own token. No public URL ever exists.
 */
export const GET = handler<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw notFound("Schematic");
  const s = await requireOrg();
  await requireSchematicLevel(s, id, "view");
  const row = check(await s.supabase.from("schematics").select("storage_path, org_id").eq("id", id).single());
  const { data, error } = await s.supabase.storage.from("schematics").createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) throw new ApiError(502, "storage_error", "Could not create a download link for this file.");
  await audit(s, row.org_id, "schematic.view_file", "schematic", id);
  return NextResponse.json(
    { url: data.signedUrl, expires_in: SIGNED_URL_TTL_SECONDS },
    { headers: { "Cache-Control": "no-store" } },
  );
});
