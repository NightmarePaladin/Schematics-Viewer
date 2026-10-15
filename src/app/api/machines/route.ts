import { NextResponse } from "next/server";
import { z } from "zod";
import { check, forbidden, handler, parseBody, parseQuery } from "@/lib/api";
import { audit, requireOrg } from "@/lib/auth";
import { effectiveCoords, firstOf } from "@/lib/location-utils";
import { assertParentVisible, effectiveStatus, loadInoperable } from "@/lib/machines";
import { canCreateMachine } from "@/lib/permissions";
import { applyMachineSearch, SEARCH_FIELDS } from "@/lib/machine-search";
import { MACHINE_STATUSES, machineCreateSchema } from "@/lib/schemas";

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  field: z.enum(Object.keys(SEARCH_FIELDS) as [keyof typeof SEARCH_FIELDS, ...(keyof typeof SEARCH_FIELDS)[]]).default("all"),
  status: z.enum(MACHINE_STATUSES).optional(),
  category: z.string().trim().max(80).optional(),
});

/** GET /api/machines?q=&field=all|name|manufacturer|model|location&status=&category= — RLS limits results to machines the caller may view. */
export const GET = handler(async (req) => {
  const s = await requireOrg();
  const { q, field, status, category } = parseQuery(req, listQuery);
  let query = s.supabase.from("machines").select("*, place:locations(id, name, latitude, longitude)").eq("org_id", s.orgId).order("name");
  if (status) query = query.eq("status", status);
  if (category) query = query.eq("category", category);
  query = applyMachineSearch(query, q, field);
  const rows = check(await query);
  const inop = await loadInoperable(s, s.orgId);
  return NextResponse.json({
    data: rows.map(({ place, ...m }) => ({
      ...m,
      location_record: firstOf(place as { id: string; name: string; latitude: number | null; longitude: number | null } | null),
      effective_coordinates: effectiveCoords({ latitude: m.latitude, longitude: m.longitude, place: firstOf(place as { latitude: number | null; longitude: number | null } | null) }),
      effective_status: effectiveStatus(m.status, inop.has(m.id)),
      inoperable_because: inop.get(m.id) ?? [],
    })),
  });
});

/** POST /api/machines — org id comes from the verified session, never from the request body. */
export const POST = handler(async (req) => {
  const s = await requireOrg();
  if (!canCreateMachine(s.role)) throw forbidden("Your role cannot register machines.");
  const input = await parseBody(req, machineCreateSchema);
  await assertParentVisible(s, s.orgId, input.parent_id);
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
