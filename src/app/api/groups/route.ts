import { NextResponse } from "next/server";
import { check, forbidden, handler, parseBody } from "@/lib/api";
import { audit, requireOrg } from "@/lib/auth";
import { canManageMachines } from "@/lib/permissions";
import { groupCreateSchema } from "@/lib/schemas";

export const GET = handler(async () => {
  const s = await requireOrg();
  const rows = check(
    await s.supabase
      .from("groups")
      .select("id, name, description, created_at, members:group_memberships(user_id)")
      .eq("org_id", s.orgId)
      .order("name"),
  );
  return NextResponse.json({ data: rows });
});

export const POST = handler(async (req) => {
  const s = await requireOrg();
  if (!canManageMachines(s.role)) throw forbidden("Only admins and maintenance managers can create groups.");
  const input = await parseBody(req, groupCreateSchema);
  const row = check(await s.supabase.from("groups").insert({ ...input, org_id: s.orgId, created_by: s.user.id }).select().single());
  await audit(s, s.orgId, "group.create", "group", row.id);
  return NextResponse.json({ data: row }, { status: 201 });
});
