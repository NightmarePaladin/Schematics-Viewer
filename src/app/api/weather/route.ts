import { NextResponse } from "next/server";
import { z } from "zod";
import { fromDbError, handler, notFound, parseQuery } from "@/lib/api";
import { requireOrg } from "@/lib/auth";
import { effectiveCoords, firstOf } from "@/lib/location-utils";
import { getWeather } from "@/lib/weather";

const query = z.object({ machine_id: z.string().uuid() });

/**
 * GET /api/weather?machine_id=
 * Authorization first (the machine must be visible to the caller via RLS). Coordinates are the machine's own, or its location's. Then a real server-side
 * request to Open-Meteo with a 5 s timeout and a 10-minute in-memory cache.
 * Always answers 200 with { ok: false, reason } for expected degradations so the UI can show a fallback.
 */
export const GET = handler(async (req) => {
  const s = await requireOrg();
  const { machine_id } = parseQuery(req, query);
  const { data: machine, error } = await s.supabase
    .from("machines")
    .select("id, name, latitude, longitude, place:locations(latitude, longitude)")
    .eq("id", machine_id)
    .eq("org_id", s.orgId)
    .maybeSingle();
  if (error) throw fromDbError(error);
  if (!machine) throw notFound("Machine");
  const c = effectiveCoords({ latitude: machine.latitude, longitude: machine.longitude, place: firstOf(machine.place as unknown as { latitude: number | null; longitude: number | null } | { latitude: number | null; longitude: number | null }[] | null) });
  const result = await getWeather(c.latitude, c.longitude);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, max-age=60" } });
});
