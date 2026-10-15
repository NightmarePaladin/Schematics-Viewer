import { NextResponse } from "next/server";
import { z } from "zod";
import { check, handler, notFound, parseBody } from "@/lib/api";
import { requireOrg, requireSchematicLevel } from "@/lib/auth";
import { replyCreateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

async function loadAnnotation(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound("Annotation");
  const s = await requireOrg();
  const { data } = await s.supabase.from("annotations").select("id, org_id, schematic_id").eq("id", id).maybeSingle();
  if (!data) throw notFound("Annotation");
  return { s, a: data };
}

export const GET = handler<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { s } = await loadAnnotation(id);
  const rows = check(
    await s.supabase
      .from("annotation_replies")
      .select("*, author:profiles!annotation_replies_author_id_fkey(display_name)")
      .eq("annotation_id", id)
      .order("created_at"),
  );
  return NextResponse.json({ data: rows });
});

export const POST = handler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const { s, a } = await loadAnnotation(id);
  await requireSchematicLevel(s, a.schematic_id, "comment");
  const body = await parseBody(req, replyCreateSchema);
  const row = check(
    await s.supabase
      .from("annotation_replies")
      .insert({ org_id: a.org_id, annotation_id: id, body: body.body, is_resolution_note: body.is_resolution_note, author_id: s.user.id })
      .select("*, author:profiles!annotation_replies_author_id_fkey(display_name)")
      .single(),
  );
  return NextResponse.json({ data: row }, { status: 201 });
});
