import { NextResponse } from "next/server";
import { z } from "zod";
import { check, forbidden, handler, parseBody, parseQuery } from "@/lib/api";
import { audit, requireOrg } from "@/lib/auth";
import { canCreateMachine } from "@/lib/permissions";
import { MACHINE_STATUSES, machineCreateSchema } from "@/lib/schemas";

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(MACHINE_STATUSES).optional(),
  category: z.string().trim().max(80).optional(),
});

/** GET /api/machines?q=&status=&category= — RLS limits results to machines the caller may view. */
export const GET = handler(async (req) => {
  const s = await requireOrg();
  const { q, status, category } = parseQuery(req, listQuery);
  let query = s.supabase.from("machines").select("*").eq("org_id", s.orgId).order("name");
  if (status) query = query.eq("status", status);
  if (category) query = query.eq("category", category);
  if (q) {
    const term = q.replace(/[%,()]/g, " ");
    query = query.or(
      ["name", "manufacturer", "model_number", "serial_number", "asset_number", "location"]
        .map((c) => `${c}.ilike.%${term}%`)
        .join(","),
    );
  }
  return NextResponse.json({ data: check(await query) });
});

/** POST /api/machines — org id comes from the verified session, never from the request body. */
export const POST = handler(async (req) => {
  const s = await requireOrg();
  if (!canCreateMachine(s.role)) throw forbidden("Your role cannot register machines.");
  const input = await parseBody(req, machineCreateSchema);
  const row = check(
    await s.supabase
      .from("machines")
      .insert({ ...input, org_id: s.orgId, created_by: s.user.id })
      .select()
      .single(),
  );
  await audit(s, s.orgId, "machine.create", "machine", row.id, { serial_number: row.serial_number });
  return NextResponse.json({ data: row }, { status: 201 });
});
