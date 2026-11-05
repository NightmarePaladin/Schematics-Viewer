import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, check, handler, parseBody } from "@/lib/api";
import { requireOrg } from "@/lib/auth";
import { ORG_ROLES } from "@/lib/permissions";
import { normalizeLimits } from "@/lib/tool-limits";

/** GET — this organization's stored overrides (any member; the viewer page uses them to hide tools). */
export const GET = handler(async () => {
  const s = await requireOrg();
  const row = check(await s.supabase.from("organizations").select("tool_limits").eq("id", s.orgId).single());
  return NextResponse.json({ data: row.tool_limits ?? {} });
});

const bodySchema = z.object({ limits: z.record(z.string(), z.enum(ORG_ROLES)) });

/** PUT — replace the overrides. Admins only (also enforced by the organizations update policy). */
export const PUT = handler(async (req) => {
  const s = await requireOrg();
  if (s.role !== "admin") throw new ApiError(403, "forbidden", "Only an organization admin can change tool permissions.");
  const { limits } = await parseBody(req, bodySchema);
  const clean = normalizeLimits(limits);
  const { data, error } = await s.supabase.from("organizations").update({ tool_limits: clean }).eq("id", s.orgId).select("tool_limits").maybeSingle();
  if (error) throw new ApiError(500, "db_error", "Could not save the permissions.");
  if (!data) throw new ApiError(403, "forbidden", "Only an organization admin can change tool permissions.");
  return NextResponse.json({ data: data.tool_limits });
});
