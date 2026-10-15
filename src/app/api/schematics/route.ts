import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, check, fromDbError, forbidden, handler, notFound, parseQuery } from "@/lib/api";
import { audit, requireOrg } from "@/lib/auth";
import { canUploadSchematic } from "@/lib/permissions";
import { MAX_PDF_BYTES, schematicMetaSchema } from "@/lib/schemas";

const listQuery = z.object({ machine_id: z.string().uuid().optional() });

/** GET /api/schematics?machine_id= — only schematics the caller can view (RLS). */
export const GET = handler(async (req) => {
  const s = await requireOrg();
  const { machine_id } = parseQuery(req, listQuery);
  let q = s.supabase
    .from("schematics")
    .select("id, machine_id, title, document_number, revision, file_size, created_at, uploaded_by, uploader:profiles!schematics_uploaded_by_fkey(display_name), machine:machines(name)")
    .eq("org_id", s.orgId)
    .order("created_at", { ascending: false });
  if (machine_id) q = q.eq("machine_id", machine_id);
  return NextResponse.json({ data: check(await q) });
});

const hasPdfMagic = (bytes: Uint8Array) =>
  bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;

/**
 * POST /api/schematics (multipart/form-data: file, machine_id, title, document_number, revision)
 * Validates type (extension, MIME, %PDF- magic bytes) and size, then stores to the private bucket.
 * Upload formats are pluggable: add an entry to UPLOAD_HANDLERS for images / DXF later.
 */
const UPLOAD_HANDLERS: Record<string, { mime: string; ext: string; validate: (b: Uint8Array) => boolean }> = {
  pdf: { mime: "application/pdf", ext: "pdf", validate: hasPdfMagic },
};

export const POST = handler(async (req) => {
  const s = await requireOrg();
  if (!canUploadSchematic(s.role)) throw forbidden("Your role cannot upload schematics.");

  const form = await req.formData().catch(() => {
    throw new ApiError(400, "invalid_form", "Send multipart/form-data with a file field.");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "missing_file", "Attach a PDF in the 'file' field.");
  const meta = schematicMetaSchema.parse({
    machine_id: form.get("machine_id"),
    title: form.get("title"),
    document_number: form.get("document_number"),
    revision: form.get("revision"),
  });

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const handlerDef = UPLOAD_HANDLERS[ext];
  if (!handlerDef || file.type !== handlerDef.mime) {
    throw new ApiError(415, "unsupported_type", "Only PDF files are supported right now.");
  }
  if (file.size === 0) throw new ApiError(422, "empty_file", "The file is empty.");
  if (file.size > MAX_PDF_BYTES) throw new ApiError(413, "too_large", `Files must be ${MAX_PDF_BYTES / 1024 / 1024} MB or smaller.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!handlerDef.validate(bytes)) throw new ApiError(415, "corrupt_file", "That file does not look like a valid PDF.");

  // The organization comes from the machine row the caller is allowed to see — never from the client.
  const { data: machine, error: mErr } = await s.supabase
    .from("machines")
    .select("id, org_id")
    .eq("id", meta.machine_id)
    .eq("org_id", s.orgId)
    .maybeSingle();
  if (mErr) throw fromDbError(mErr);
  if (!machine) throw notFound("Machine");

  const id = crypto.randomUUID();
  const storage_path = `${machine.org_id}/${id}.${handlerDef.ext}`;

  // Insert metadata first (no RETURNING: the uploader's Manage grant is created by trigger after the statement).
  const ins = await s.supabase.from("schematics").insert({
    id,
    org_id: machine.org_id,
    machine_id: machine.id,
    title: meta.title,
    document_number: meta.document_number,
    revision: meta.revision,
    storage_path,
    file_size: file.size,
    mime_type: handlerDef.mime,
    uploaded_by: s.user.id,
  });
  if (ins.error) throw fromDbError(ins.error);

  const up = await s.supabase.storage.from("schematics").upload(storage_path, bytes, {
    contentType: handlerDef.mime,
    upsert: false,
  });
  if (up.error) {
    await s.supabase.from("schematics").delete().eq("id", id);
    throw new ApiError(502, "storage_error", "Could not store the file. Nothing was saved.");
  }

  const row = check(
    await s.supabase.from("schematics").select("id, machine_id, title, document_number, revision, file_size, created_at").eq("id", id).single(),
  );
  await audit(s, machine.org_id, "schematic.upload", "schematic", id, { size: file.size });
  return NextResponse.json({ data: row }, { status: 201 });
});
