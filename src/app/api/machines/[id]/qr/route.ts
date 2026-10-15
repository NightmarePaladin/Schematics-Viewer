import { z } from "zod";
import { fromDbError, handler, notFound } from "@/lib/api";
import { requireOrg } from "@/lib/auth";
import { labelOrigin, machineUrl, qrPng, qrSvg } from "@/lib/qr";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/machines/:id/qr?format=svg|png&size=512 — the QR code that links to this machine's page.
 * Signed-in members who can see the machine only (RLS); the code itself contains just the page URL.
 */
export const GET = handler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw notFound("Machine");
  const s = await requireOrg();
  const { data, error } = await s.supabase.from("machines").select("id").eq("id", id).eq("org_id", s.orgId).maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw notFound("Machine");

  const url = new URL(req.url);
  const text = machineUrl(labelOrigin(url.origin), id);
  const headers = { "Cache-Control": "private, max-age=3600" };
  if (url.searchParams.get("format") === "png") {
    const png = await qrPng(text, Number(url.searchParams.get("size") ?? 512) || 512);
    return new Response(new Uint8Array(png), { headers: { ...headers, "Content-Type": "image/png", "Content-Disposition": `inline; filename="machine-${id}.png"` } });
  }
  return new Response(await qrSvg(text), { headers: { ...headers, "Content-Type": "image/svg+xml; charset=utf-8" } });
});
