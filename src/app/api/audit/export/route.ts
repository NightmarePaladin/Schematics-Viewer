import { forbidden, handler } from "@/lib/api";
import { applyAuditFilters, auditToCsv, sanitizeFilters, type AuditEvent } from "@/lib/audit";
import { requireOrg } from "@/lib/auth";

const MAX_ROWS = 5000;

/** GET /api/audit/export?entity=&actor=&q=&from=&to= — CSV of the (filtered) audit log. Organization admins only. */
export const GET = handler(async (req) => {
  const s = await requireOrg();
  if (s.role !== "admin") throw forbidden("Only organization admins can export the audit log.");
  const filters = sanitizeFilters(Object.fromEntries(new URL(req.url).searchParams));
  const base = s.supabase
    .from("audit_events")
    .select("id, created_at, actor_id, actor_label, action, entity_type, entity_id, metadata")
    .eq("org_id", s.orgId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MAX_ROWS);
  const { data, error } = await applyAuditFilters(base, filters);
  if (error) throw new Error(error.message);
  const csv = auditToCsv((data ?? []) as AuditEvent[]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
