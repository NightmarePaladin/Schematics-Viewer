import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, linkButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, Page, PageHeader, selectClass } from "@/components/ui-bits";
import { applyAuditFilters, describeEvent, ENTITY_LABELS, ENTITY_TYPES, eventLink, sanitizeFilters, type AuditEvent } from "@/lib/audit";
import { loadAuditNames } from "@/lib/audit-names";
import { requireOrgPage } from "@/lib/auth";

export const metadata = { title: "Audit log" };

const PAGE_SIZE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireOrgPage();
  if (s.role !== "admin") notFound(); // admins only; the database enforces this too (RLS)

  const raw = await searchParams;
  const filters = sanitizeFilters(raw);
  const page = Math.max(1, Number.parseInt(raw.page ?? "1", 10) || 1);

  const base = s.supabase
    .from("audit_events")
    .select("id, created_at, actor_id, actor_label, action, entity_type, entity_id, metadata", { count: "exact" })
    .eq("org_id", s.orgId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  const [{ data, count, error }, { data: actorRows }] = await Promise.all([
    applyAuditFilters(base, filters).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    s.supabase.from("audit_events").select("actor_id, actor_label").eq("org_id", s.orgId).not("actor_id", "is", null).limit(2000),
  ]);
  const events = (data ?? []) as AuditEvent[];
  const names = await loadAuditNames(s.supabase, events);
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const actors = new Map<string, string>();
  for (const a of actorRows ?? []) if (a.actor_id && !actors.has(a.actor_id)) actors.set(a.actor_id, a.actor_label ?? a.actor_id);

  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, ...over })) if (v !== undefined && v !== "") p.set(k, String(v));
    return p.toString();
  };
  const filtering = Boolean(filters.entity || filters.actor || filters.q || filters.from || filters.to);

  return (
    <Page className="max-w-7xl">
      <PageHeader
        title="Audit log"
        description="Every change made by a signed-in user, recorded by the database. Visible to organization admins only. Entries cannot be edited or deleted from the app; only the database owner can change them."
        actions={<a href={`/api/audit/export?${qs({})}`} className={linkButton({ variant: "outline" })}>Export CSV</a>}
      />

      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_150px_190px_140px_140px_auto]" role="search" aria-label="Filter audit log">
        <Input name="q" defaultValue={filters.q} placeholder="Search action, person or name…" aria-label="Search audit log" />
        <select name="entity" defaultValue={filters.entity ?? ""} className={selectClass} aria-label="Filter by type">
          <option value="">All types</option>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{ENTITY_LABELS[t]}</option>)}
        </select>
        <select name="actor" defaultValue={filters.actor ?? ""} className={selectClass} aria-label="Filter by person">
          <option value="">Everyone</option>
          {[...actors].map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <Input name="from" type="date" defaultValue={filters.from} aria-label="From date (UTC)" />
        <Input name="to" type="date" defaultValue={filters.to} aria-label="To date (UTC)" />
        <Button type="submit" variant="secondary">Filter</Button>
      </form>

      <p className="mb-3 text-sm text-muted-foreground" role="status">
        {total} event{total === 1 ? "" : "s"}{filtering ? " match" : " recorded"} · times shown in UTC
        {filtering && <> · <Link className="underline" href="/audit">Clear filters</Link></>}
      </p>

      {error ? (
        <p role="alert" className="text-sm text-destructive">Could not load the audit log.</p>
      ) : events.length === 0 ? (
        <Empty>No audit events yet. They appear here as people work.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm" data-testid="audit-table">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-3">When (UTC)</th><th className="p-3">Who</th><th className="p-3">What</th><th className="p-3">Details</th></tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const d = describeEvent(e, names);
                const href = eventLink(e, names);
                return (
                  <tr key={e.id} className="border-t align-top">
                    <td className="whitespace-nowrap p-3 font-mono text-xs"><time dateTime={e.created_at}>{e.created_at.replace("T", " ").slice(0, 19)}</time></td>
                    <td className="p-3">{e.actor_label ?? <span className="text-muted-foreground">system</span>}</td>
                    <td className="p-3">
                      {href ? <Link className="font-medium hover:underline" href={href}>{d.title}</Link> : <span className="font-medium">{d.title}</span>}
                      <div className="font-mono text-[11px] text-muted-foreground">{e.action}</div>
                    </td>
                    <td className="max-w-md p-3 text-muted-foreground">{d.detail || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Audit log pages">
          {page > 1 ? <Link className="underline" href={`/audit?${qs({ page: page - 1 })}`}>← Newer</Link> : <span />}
          <span className="text-muted-foreground">Page {page} of {pages}</span>
          {page < pages ? <Link className="underline" href={`/audit?${qs({ page: page + 1 })}`}>Older →</Link> : <span />}
        </nav>
      )}
    </Page>
  );
}
