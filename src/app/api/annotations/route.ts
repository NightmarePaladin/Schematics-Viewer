import { NextResponse } from "next/server";
import { z } from "zod";
import { check, forbidden, handler, notFound, parseBody, parseQuery } from "@/lib/api";
import { requireOrg, requireSchematicLevel } from "@/lib/auth";
import { roundNorm } from "@/lib/coords";
import { annotationCreateSchema } from "@/lib/schemas";
import { LIMIT_LABEL, toolAllowed, type ToolLimits } from "@/lib/tool-limits";

const listQuery = z.object({
  schematic_id: z.string().uuid(),
  page: z.coerce.number().int().min(1).optional(),
});

const SELECT = "*, author:profiles!annotations_author_id_fkey(display_name), replies:annotation_replies(count), issue:maintenance_issues(id, status, severity, title), linked:schematics!annotations_linked_schematic_fkey(id, title, machine:machines(name)), attachments:annotation_attachments(count)";

/** GET /api/annotations?schematic_id=&page= — requires View on the parent schematic (also enforced by RLS). */
export const GET = handler(async (req) => {
  const s = await requireOrg();
  const { schematic_id, page } = parseQuery(req, listQuery);
  await requireSchematicLevel(s, schematic_id, "view");
  let q = s.supabase.from("annotations").select(SELECT).eq("schematic_id", schematic_id).order("created_at");
  if (page) q = q.eq("page_number", page);
  return NextResponse.json({ data: check(await q) });
});

/** POST /api/annotations — requires Comment. Coordinates are normalized page fractions, validated by Zod + DB checks. */
export const POST = handler(async (req) => {
  const s = await requireOrg();
  const input = await parseBody(req, annotationCreateSchema);
  await requireSchematicLevel(s, input.schematic_id, "comment");
  const { data: org } = await s.supabase.from("organizations").select("tool_limits").eq("id", s.orgId).maybeSingle();
  if (!toolAllowed(s.role, input.type, (org?.tool_limits ?? {}) as ToolLimits)) {
    throw forbidden(`Your role cannot use the ${LIMIT_LABEL[input.type].toLowerCase()} tool in this organization.`);
  }
  const { data: sch } = await s.supabase.from("schematics").select("org_id").eq("id", input.schematic_id).maybeSingle();
  if (!sch) throw notFound("Schematic");
  const row = check(
    await s.supabase
      .from("annotations")
      .insert({
        org_id: sch.org_id,
        schematic_id: input.schematic_id,
        page_number: input.page_number,
        type: input.type,
        x: roundNorm(input.x),
        y: roundNorm(input.y),
        width: input.width == null ? null : roundNorm(input.width),
        height: input.height == null ? null : roundNorm(input.height),
        body: input.body,
        status: input.status ?? null,
        linked_schematic_id: input.linked_schematic_id ?? null,
        linked_page: input.linked_schematic_id ? (input.linked_page ?? null) : null,
        linked_annotation_id: input.linked_schematic_id ? (input.linked_annotation_id ?? null) : null,
        path: input.path ? input.path.map(([px, py]) => [roundNorm(px), roundNorm(py)]) : null,
        author_id: s.user.id,
      })
      .select(SELECT)
      .single(),
  );
  return NextResponse.json({ data: row }, { status: 201 });
});
