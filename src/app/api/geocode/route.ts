import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, parseQuery } from "@/lib/api";
import { requireOrg } from "@/lib/auth";
import { geocodePlace } from "@/lib/geocode";

const query = z.object({ q: z.string().trim().min(1).max(120) });

/**
 * GET /api/geocode?q=Chicago — looks a place name up on the Open-Meteo Geocoding API so a location's coordinates
 * can be filled in without typing numbers. Signed-in organization members only (it is a server-side proxy to a third party).
 * Failures come back as 200 { ok: false, reason, message } so the form can show a fallback and let the user type coordinates.
 */
export const GET = handler(async (req) => {
  await requireOrg();
  const { q } = parseQuery(req, query);
  return NextResponse.json(await geocodePlace(q), { headers: { "Cache-Control": "private, max-age=300" } });
});
