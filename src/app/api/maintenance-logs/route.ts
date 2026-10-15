import { NextResponse } from "next/server";
import { z } from "zod";
import { check, forbidden, handler, notFound, parseBody, parseQuery } from "@/lib/api";
import { requireOrg } from "@/lib/auth";
import { canWriteMaintenance } from "@/lib/permissions";
import { logCreateSchema } from "@/lib/schemas";

const listQuery = z.object({ machine_id: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });

const SELECT = "*, performer:profiles!maintenance_logs_performed_by_fkey(display_name), machine:machines(name)";

export const GET = handler(async (req) => {
  const s = await requireOrg();
  const { machine_id, limit } = parseQuery(req, listQuery);
  let q = s.supabase.from("maintenance_logs").select(SELECT).eq("org_id", s.orgId).order("performed_at", { ascending: false }).limit(limit);
  if (machine_id) q = q.eq("machine_id", machine_id);
  return NextResponse.json({ data: check(await q) });
});

/** POST — logs are append-only (no update/delete policy exists) so machine history is preserved. */
export const POST = handler(async (req) => {
  const s = await requireOrg();
  if (!canWriteMaintenance(s.role)) throw forbidden("Your role cannot add maintenance log entries.");
  const input = await parseBody(req, logCreateSchema);
  const { data: machine } = await s.supabase.from("machines").select("id, org_id").eq("id", input.machine_id).eq("org_id", s.orgId).maybeSingle();
  if (!machine) throw notFound("Machine");
  const row = check(
    await s.supabase
      .from("maintenance_logs")
      .insert({
        org_id: machine.org_id,
        machine_id: machine.id,
        issue_id: input.issue_id ?? null,
        schematic_id: input.schematic_id ?? null,
        annotation_id: input.annotation_id ?? null,
        entry_type: input.entry_type,
        body: input.body,
        performed_at: input.performed_at ?? new Date().toISOString(),
        performed_by: s.user.id,
      })
      .select(SELECT)
      .single(),
  );
  return NextResponse.json({ data: row }, { status: 201 });
});
