import { NextResponse } from "next/server";
import { check, forbidden, handler, parseBody } from "@/lib/api";
import { audit, requireOrg } from "@/lib/auth";
import { canCreateMachine } from "@/lib/permissions";
import { locationCreateSchema } from "@/lib/schemas";

/** GET /api/locations — every member can read the organization's shared location list (used by the machine dropdown). */
export const GET = handler(async () => {
  const s = await requireOrg();
  const rows = check(
    await s.supabase
      .from("locations")
      .select("id, name, description, latitude, longitude, created_at, machines(count)")
      .eq("org_id", s.orgId)
      .order("name"),
  );
  return NextResponse.json({
    data: rows.map(({ machines, ...l }) => ({ ...l, machine_count: (machines as { count: number }[] | null)?.[0]?.count ?? 0 })),
  });
});

/** POST /api/locations — writers (admin, manager, technician) can add a location; coordinates are optional but must come as a pair. */
export const POST = handler(async (req) => {
  const s = await requireOrg();
  if (!canCreateMachine(s.role)) throw forbidden("Your role cannot add locations.");
  const input = await parseBody(req, locationCreateSchema);
  const row = check(await s.supabase.from("locations").insert({ ...input, org_id: s.orgId, created_by: s.user.id }).select().single());
  await audit(s, s.orgId, "location.create", "location", row.id, { name: row.name });
  return NextResponse.json({ data: row }, { status: 201 });
});
