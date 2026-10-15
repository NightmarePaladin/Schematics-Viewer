import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, check, forbidden, handler, notFound, parseBody, parseQuery } from "@/lib/api";
import { audit, requireOrg, requireSchematicLevel } from "@/lib/auth";
import { canWriteMaintenance } from "@/lib/permissions";
import { ISSUE_SELECT } from "@/lib/selects";
import { ISSUE_STATUSES, SEVERITIES, issueCreateSchema } from "@/lib/schemas";

const listQuery = z.object({
  machine_id: z.string().uuid().optional(),
  schematic_id: z.string().uuid().optional(),
  status: z.enum(ISSUE_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
});

export const GET = handler(async (req) => {
  const s = await requireOrg();
  const f = parseQuery(req, listQuery);
  let q = s.supabase.from("maintenance_issues").select(ISSUE_SELECT).eq("org_id", s.orgId).order("created_at", { ascending: false });
  if (f.machine_id) q = q.eq("machine_id", f.machine_id);
  if (f.schematic_id) q = q.eq("schematic_id", f.schematic_id);
  if (f.status) q = q.eq("status", f.status);
  if (f.severity) q = q.eq("severity", f.severity);
  return NextResponse.json({ data: check(await q) });
});

/** POST /api/issues — optionally linked to an annotation; schematic/page are derived from it, not trusted from the client. */
export const POST = handler(async (req) => {
  const s = await requireOrg();
  if (!canWriteMaintenance(s.role)) throw forbidden("Your role cannot report issues.");
  const input = await parseBody(req, issueCreateSchema);

  const { data: machine } = await s.supabase.from("machines").select("id, org_id").eq("id", input.machine_id).eq("org_id", s.orgId).maybeSingle();
  if (!machine) throw notFound("Machine");

  let schematic_id = input.schematic_id ?? null;
  let page_number = input.page_number ?? null;
  if (input.annotation_id) {
    const { data: ann } = await s.supabase
      .from("annotations")
      .select("id, schematic_id, page_number, schematics(machine_id)")
      .eq("id", input.annotation_id)
      .maybeSingle();
    if (!ann) throw notFound("Annotation");
    const sm = ann.schematics as unknown as { machine_id: string } | { machine_id: string }[] | null;
    const annMachine = Array.isArray(sm) ? sm[0]?.machine_id : sm?.machine_id;
    if (annMachine !== machine.id) throw new ApiError(422, "mismatch", "That annotation belongs to a different machine.");
    schematic_id = ann.schematic_id;
    page_number = ann.page_number;
  }
  if (schematic_id) await requireSchematicLevel(s, schematic_id, "comment");

  const row = check(
    await s.supabase
      .from("maintenance_issues")
      .insert({
        org_id: machine.org_id,
        machine_id: machine.id,
        schematic_id,
        annotation_id: input.annotation_id ?? null,
        page_number,
        title: input.title,
        description: input.description,
        severity: input.severity,
        assignee_id: input.assignee_id ?? null,
        reporter_id: s.user.id,
      })
      .select(ISSUE_SELECT)
      .single(),
  );
  await audit(s, machine.org_id, "issue.create", "issue", row.id, { severity: row.severity });
  return NextResponse.json({ data: row }, { status: 201 });
});
