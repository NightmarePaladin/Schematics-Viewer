import { NextResponse } from "next/server";
import { check, handler, parseBody } from "@/lib/api";
import { ORG_COOKIE, requireSession } from "@/lib/auth";
import { orgCreateSchema } from "@/lib/schemas";

/** POST /api/organizations — create an organization; caller becomes its Admin (via SQL function). */
export const POST = handler(async (req) => {
  const s = await requireSession();
  const { name } = await parseBody(req, orgCreateSchema);
  const orgId = check(await s.supabase.rpc("create_organization", { p_name: name })) as string;
  const res = NextResponse.json({ id: orgId, name }, { status: 201 });
  res.cookies.set(ORG_COOKIE, orgId, { path: "/", httpOnly: true, sameSite: "lax" });
  return res;
});

/** PUT /api/organizations — switch active organization (validated against memberships). */
export const PUT = handler(async (req) => {
  const s = await requireSession();
  const body = (await req.json().catch(() => ({}))) as { org_id?: string };
  const m = s.memberships.find((x) => x.org_id === body.org_id);
  if (!m) return NextResponse.json({ error: { code: "forbidden", message: "Not a member of that organization." } }, { status: 403 });
  const res = NextResponse.json({ id: m.org_id });
  res.cookies.set(ORG_COOKIE, m.org_id, { path: "/", httpOnly: true, sameSite: "lax" });
  return res;
});
