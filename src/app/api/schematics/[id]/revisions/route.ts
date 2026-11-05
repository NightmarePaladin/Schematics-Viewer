import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, check, fromDbError, handler, notFound } from "@/lib/api";
import { requireOrg, requireSchematicLevel } from "@/lib/auth";
import { MAX_PDF_BYTES } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

/** GET — superseded revisions of this schematic, newest first (the current one lives on the schematic itself). */
export const GET = handler<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw notFound("Schematic");
  const s = await requireOrg();
  await requireSchematicLevel(s, id, "view");
  const rows = check(
    await s.supabase
      .from("schematic_revisions")
      .select("id, revision, superseded_at, file_size")
      .eq("schematic_id", id)
      .order("superseded_at", { ascending: false }),
  );
  return NextResponse.json({ data: rows });
});

const hasPdfMagic = (b: Uint8Array) => b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;

/**
 * POST (multipart: file, revision) — upload a new revision. The file is stored first, then revise_schematic() archives the
 * old one and switches the schematic over (needs Edit). Old files stay in storage so earlier revisions can still be viewed.
 */
export const POST = handler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw notFound("Schematic");
  const s = await requireOrg();
  await requireSchematicLevel(s, id, "edit");
  const form = await req.formData().catch(() => {
    throw new ApiError(400, "invalid_form", "Send multipart/form-data with a file field.");
  });
  const file = form.get("file");
  const revision = z.string().trim().min(1).max(20).parse(form.get("revision"));
  if (!(file instanceof File) || file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
    throw new ApiError(415, "unsupported_type", "Only PDF files are supported right now.");
  }
  if (file.size === 0 || file.size > MAX_PDF_BYTES) throw new ApiError(413, "too_large", `Files must be 1 byte to ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasPdfMagic(bytes)) throw new ApiError(415, "corrupt_file", "That file does not look like a valid PDF.");

  const { data: sc } = await s.supabase.from("schematics").select("org_id, revision").eq("id", id).maybeSingle();
  if (!sc) throw notFound("Schematic");
  if (sc.revision === revision) throw new ApiError(422, "same_revision", `This schematic is already at revision "${revision}".`);

  const path = `${sc.org_id}/${id}--${crypto.randomUUID()}.pdf`;
  const up = await s.supabase.storage.from("schematics").upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (up.error) throw new ApiError(502, "storage_error", "Could not store the file. Nothing was changed.");
  const { error } = await s.supabase.rpc("revise_schematic", { p_schematic: id, p_revision: revision, p_path: path, p_size: file.size });
  if (error) {
    await s.supabase.storage.from("schematics").remove([path]); // best effort
    throw fromDbError(error);
  }
  return NextResponse.json({ data: { id, revision } }, { status: 201 });
});
