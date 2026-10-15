import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, fromDbError, handler, notFound, parseBody } from "@/lib/api";
import { audit, requireOrg } from "@/lib/auth";
import { ISSUE_SELECT } from "@/lib/selects";
import { issueUpdateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

async function ready(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound("Issue");
  return requireOrg();
}

export const GET = handler<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const s = await ready(id);
  const { data, error } = await s.supabase.from("maintenance_issues").select(ISSUE_SELECT).eq("id", id).maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw notFound("Issue");
  return NextResponse.json({ data });
});

/**
 * PATCH — status, severity, assignment and resolution notes. Allowed for managers, the reporter and the assignee (RLS).
 * Resolving writes an append-only maintenance log entry so history is preserved.
 */
export const PATCH = handler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const s = await ready(id);
  const patch = await parseBody(req, issueUpdateSchema);
  const { data: before } = await s.supabase.from("maintenance_issues").select("*").eq("id", id).maybeSingle();
  if (!before) throw notFound("Issue");
  if (patch.status === "resolved" && !(patch.resolution_note ?? before.resolution_note)) {
    throw new ApiError(422, "resolution_note_required", "Add a resolution note before marking an issue resolved.");
  }
  const { data, error } = await s.supabase.from("maintenance_issues").update(patch).eq("id", id).select(ISSUE_SELECT).maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw new ApiError(403, "forbidden", "Only the reporter, the assignee or a manager can update this issue.");

  if (patch.status && patch.status !== before.status) {
    await s.supabase.from("maintenance_logs").insert({
      org_id: before.org_id,
      machine_id: before.machine_id,
      issue_id: id,
      schematic_id: before.schematic_id,
      annotation_id: before.annotation_id,
      entry_type: "note",
      body: `Issue "${before.title}" changed from ${before.status} to ${patch.status}.${patch.resolution_note ? ` Resolution: ${patch.resolution_note}` : ""}`,
      performed_by: s.user.id,
    });
    if (patch.status === "resolved" && before.annotation_id && patch.resolution_note) {
      await s.supabase.from("annotation_replies").insert({
        org_id: before.org_id,
        annotation_id: before.annotation_id,
        body: patch.resolution_note,
        is_resolution_note: true,
        author_id: s.user.id,
      });
    }
  }
  await audit(s, before.org_id, "issue.update", "issue", id, { fields: Object.keys(patch) });
  return NextResponse.json({ data });
});

