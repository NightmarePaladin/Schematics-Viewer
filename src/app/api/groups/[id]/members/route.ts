import { NextResponse } from "next/server";
import { z } from "zod";
import { fromDbError, forbidden, handler, notFound, parseBody } from "@/lib/api";
import { requireOrg } from "@/lib/auth";
import { canManageMachines } from "@/lib/permissions";
import { groupMemberSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

async function ready(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound("Group");
  const s = await requireOrg();
  if (!canManageMachines(s.role)) throw forbidden("Only admins and maintenance managers can manage group membership.");
  const { data } = await s.supabase.from("groups").select("id, org_id").eq("id", id).eq("org_id", s.orgId).maybeSingle();
  if (!data) throw notFound("Group");
  return { s, group: data };
}

/** POST — add a user to a group. The composite FK guarantees the user is a member of the group's organization. */
export const POST = handler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const { s, group } = await ready(id);
  const { user_id } = await parseBody(req, groupMemberSchema);
  const { error } = await s.supabase.from("group_memberships").insert({ group_id: id, user_id, org_id: group.org_id });
  if (error) throw fromDbError(error);
  return NextResponse.json({ ok: true }, { status: 201 });
});

export const DELETE = handler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const { s } = await ready(id);
  const { user_id } = groupMemberSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { error } = await s.supabase.from("group_memberships").delete().eq("group_id", id).eq("user_id", user_id);
  if (error) throw fromDbError(error);
  return new NextResponse(null, { status: 204 });
});
