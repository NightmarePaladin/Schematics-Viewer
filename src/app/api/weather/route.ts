import { NextResponse } from "next/server";
import { z } from "zod";
import { fromDbError, handler, notFound, parseQuery } from "@/lib/api";
import { requireOrg } from "@/lib/auth";
import { getWeather } from "@/lib/weather";

const query = z.object({ machine_id: z.string().uuid() });

/**
 * GET /api/weather?machine_id=
 * Authorization first (the machine must be visible to the caller via RLS), then a real server-side
 * request to Open-Meteo with a 5 s timeout and a 10-minute in-memory cache.
 * Always answers 200 with { ok: false, reason } for expected degradations so the UI can show a fallback.
 */
export const GET = handler(async (req) => {
  const s = await requireOrg();
  const { machine_id } = parseQuery(req, query);
  const { data: machine, error } = await s.supabase
    .from("machines")
    .select("id, name, latitude, longitude")
    .eq("id", machine_id)
    .eq("org_id", s.orgId)
    .maybeSingle();
  if (error) throw fromDbError(error);
  if (!machine) throw notFound("Machine");
  const result = await getWeather(machine.latitude, machine.longitude);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, max-age=60" } });
});
