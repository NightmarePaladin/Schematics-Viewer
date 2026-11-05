import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, check, fromDbError, handler, notFound } from "@/lib/api";
import { requireOrg } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

const TYPES: Record<string, { kind: "photo" | "audio"; ext: string }> = {
  "image/jpeg": { kind: "photo", ext: "jpg" },
  "image/png": { kind: "photo", ext: "png" },
  "image/webp": { kind: "photo", ext: "webp" },
  "audio/webm": { kind: "audio", ext: "webm" },
  "audio/mp4": { kind: "audio", ext: "m4a" },
  "audio/ogg": { kind: "audio", ext: "ogg" },
  "audio/mpeg": { kind: "audio", ext: "mp3" },
  "audio/aac": { kind: "audio", ext: "aac" },
};
const MAX_BYTES = 4 * 1024 * 1024; // photos are downscaled in the browser; stays under the serverless body limit

/** GET — attachments of an annotation with short-lived signed URLs (RLS: View on the schematic). */
export const GET = handler<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw notFound("Annotation");
  const s = await requireOrg();
  const rows = check(
    await s.supabase.from("annotation_attachments").select("id, kind, content_type, storage_path, created_by, created_at").eq("annotation_id", id).order("created_at"),
  );
  const data = await Promise.all(
    rows.map(async (r) => {
      const { data: signed } = await s.supabase.storage.from("annotation-files").createSignedUrl(r.storage_path as string, 300);
      return { id: r.id, kind: r.kind, content_type: r.content_type, created_by: r.created_by, created_at: r.created_at, url: signed?.signedUrl ?? null };
    }),
  );
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
});

/** POST (multipart: file) — add a photo or voice note. Needs Comment on the schematic (storage + table RLS). */
export const POST = handler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw notFound("Annotation");
  const s = await requireOrg();
  const form = await req.formData().catch(() => {
    throw new ApiError(400, "invalid_form", "Send multipart/form-data with a file field.");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "missing_file", "Attach a file in the 'file' field.");
  const base = file.type.split(";")[0];
  const t = TYPES[base];
  if (!t) throw new ApiError(415, "unsupported_type", "Only photos (JPEG/PNG/WebP) and voice notes are supported.");
  if (file.size === 0 || file.size > MAX_BYTES) throw new ApiError(413, "too_large", "Attachments must be 4 MB or smaller.");
  const { data: ann } = await s.supabase.from("annotations").select("id, org_id").eq("id", id).maybeSingle();
  if (!ann) throw notFound("Annotation");
  const path = `${ann.org_id}/${id}/${crypto.randomUUID()}.${t.ext}`;
  const up = await s.supabase.storage.from("annotation-files").upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: base, upsert: false });
  if (up.error) throw new ApiError(403, "storage_error", "Could not store the file (you need Comment access).");
  const ins = await s.supabase
    .from("annotation_attachments")
    .insert({ org_id: ann.org_id, annotation_id: id, kind: t.kind, storage_path: path, content_type: base, file_size: file.size })
    .select("id")
    .single();
  if (ins.error) {
    await s.supabase.storage.from("annotation-files").remove([path]);
    throw fromDbError(ins.error);
  }
  return NextResponse.json({ data: ins.data }, { status: 201 });
});
