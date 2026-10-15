import { NextResponse } from "next/server";
import { audit, requireOrg, requireRole } from "@/lib/auth";
import { check, fromDbError, handler, parseBody } from "@/lib/api";
import { memberAddSchema } from "@/lib/schemas";

export const GET = handler(async () => {
  const s = await requireOrg();
  const rows = check(
    await s.supabase
      .from("organization_memberships")
      .select("id, user_id, role, created_at, profile:profiles(display_name, email)")
      .eq("org_id", s.orgId)
      .order("created_at"),
  );
  return NextResponse.json({ data: rows });
});

/** POST /api/members — Admin adds an already-registered user to the organization (or changes their role). */
export const POST = handler(async (req) => {
  const s = await requireOrg();
  requireRole(s.role, ["admin"]);
  const body = await parseBody(req, memberAddSchema);
  const { data, error } = await s.supabase.rpc("add_member_by_email", {
    p_org: s.orgId,
    p_email: body.email,
    p_role: body.role,
  });
  if (error) {
    if (error.code === "P0002") return NextResponse.json({ error: { code: "user_not_found", message: error.message } }, { status: 404 });
    throw fromDbError(error);
  }
  await audit(s, s.orgId, "member.add", "membership", data as string, { role: body.role });
  return NextResponse.json({ id: data }, { status: 201 });
});
