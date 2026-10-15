import { NextResponse } from "next/server";
import { z } from "zod";
import { check, fromDbError, handler, notFound, parseBody } from "@/lib/api";
import { audit, requireOrg, requireSchematicLevel } from "@/lib/auth";
import { grantCreateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

async function ready(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound("Schematic");
  return requireOrg();
}

/** GET — list grants (Manage only). */
export const GET = handler<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const s = await ready(id);
  await requireSchematicLevel(s, id, "manage");
  const rows = check(
    await s.supabase
      .from("schematic_access_grants")
      .select("id, user_id, group_id, level, created_at, group:groups(name)")
      .eq("schematic_id", id)
      .order("created_at"),
  );
  return NextResponse.json({ data: rows });
});

/** POST — add or update a grant for a user or a group. Only Manage / admin roles may change grants. */
export const POST = handler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const s = await ready(id);
  await requireSchematicLevel(s, id, "manage");
  const body = await parseBody(req, grantCreateSchema);
  const { data: sch } = await s.supabase.from("schematics").select("org_id").eq("id", id).single();
  if (!sch) throw notFound("Schematic");

  // Upsert by (schematic, user) or (schematic, group). Composite FKs reject grantees from other organizations.
  const col = body.user_id ? "user_id" : "group_id";
  const grantee = (body.user_id ?? body.group_id) as string;
  const { data: existing } = await s.supabase
    .from("schematic_access_grants")
    .select("id")
    .eq("schematic_id", id)
    .eq(col, grantee)
    .maybeSingle();

  const res = existing
    ? await s.supabase.from("schematic_access_grants").update({ level: body.level }).eq("id", existing.id).select().single()
    : await s.supabase
        .from("schematic_access_grants")
        .insert({
          org_id: sch.org_id,
          schematic_id: id,
          user_id: body.user_id ?? null,
          group_id: body.group_id ?? null,
          level: body.level,
          granted_by: s.user.id,
        })
        .select()
        .single();
  if (res.error) throw fromDbError(res.error);
  await audit(s, sch.org_id, "grant.set", "schematic", id, { [col]: grantee, level: body.level });
  return NextResponse.json({ data: res.data }, { status: existing ? 200 : 201 });
});

const delQuery = z.object({ grant_id: z.string().uuid() });

/** DELETE ?grant_id= — revoke a grant. */
export const DELETE = handler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const s = await ready(id);
  await requireSchematicLevel(s, id, "manage");
  const { grant_id } = delQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { error } = await s.supabase.from("schematic_access_grants").delete().eq("id", grant_id).eq("schematic_id", id);
  if (error) throw fromDbError(error);
  await audit(s, s.orgId, "grant.revoke", "schematic", id, { grant_id });
  return new NextResponse(null, { status: 204 });
});
