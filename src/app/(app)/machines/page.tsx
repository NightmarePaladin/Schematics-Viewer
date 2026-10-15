import Link from "next/link";
import { Button, linkButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MachineTable, type MachineRow } from "@/components/machine-table";
import { Empty, Page, PageHeader, selectClass } from "@/components/ui-bits";
import { requireOrgPage } from "@/lib/auth";
import { applyMachineSearch, isSearchField, SEARCH_FIELD_LABELS, type SearchField } from "@/lib/machine-search";
import { isStatusFilter, STATUS_FILTERS, statusLabel } from "@/lib/machine-status";
import { causeIds, loadFaults, statusOf } from "@/lib/machines";
import { canCreateMachine } from "@/lib/permissions";

export const metadata = { title: "Machines" };

export default async function MachinesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; field?: string; status?: string; category?: string }>;
}) {
  const s = await requireOrgPage();
  const { q, field: rawField, status: rawStatus, category } = await searchParams;
  const field: SearchField = isSearchField(rawField) ? rawField : "all";
  const status = isStatusFilter(rawStatus) ? rawStatus : "";
  const filtering = Boolean(q?.trim() || status || category);

  let query = s.supabase.from("machines").select("*").eq("org_id", s.orgId).order("name");
  if (category) query = query.eq("category", category);
  query = applyMachineSearch(query, q, field);
  const [{ data: machines }, { data: all }, faults] = await Promise.all([
    query,
    s.supabase.from("machines").select("id, name, category").eq("org_id", s.orgId),
    loadFaults(s, s.orgId),
  ]);
  const categories = [...new Set((all ?? []).map((c) => c.category))].sort();
  const nameOf = new Map((all ?? []).map((c) => [c.id, c.name]));
  const causes = causeIds(faults.inherited);

  // The status filter works on the EFFECTIVE status (so "critical" and "inoperable" can be filtered too)
  const rows: MachineRow[] = (machines ?? [])
    .map((m) => ({
      id: m.id,
      name: m.name,
      category: m.category,
      manufacturer: m.manufacturer,
      model_number: m.model_number,
      serial_number: m.serial_number,
      location: m.location,
      parent_id: m.parent_id,
      parent_name: m.parent_id ? (nameOf.get(m.parent_id) ?? null) : null,
      is_critical: m.is_critical,
      status: statusOf(m.status, m.id, faults),
      major_issue: causes.has(m.id),
    }))
    .filter((r) => !status || r.status === status);

  return (
    <Page>
      <PageHeader
        title="Machines"
        description={filtering ? "Search results include sub-machines." : "Top-level machines and systems. Expand a machine to see its sub-machines."}
        actions={<><Link href="/locations" className={linkButton({ variant: "outline" })}>Locations</Link>{canCreateMachine(s.role) ? <Link href="/machines/new" className={linkButton()}>Register machine</Link> : null}</>}
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_150px_160px_160px_auto]" role="search">
        <Input name="q" defaultValue={q} placeholder="Search by name, manufacturer, model, location…" aria-label="Search machines" />
        <select name="field" defaultValue={field} className={selectClass} aria-label="Search in">
          {(Object.keys(SEARCH_FIELD_LABELS) as SearchField[]).map((f) => <option key={f} value={f}>{f === "all" ? "Search: all fields" : `Search: ${SEARCH_FIELD_LABELS[f]}`}</option>)}
        </select>
        <select name="status" defaultValue={status} className={selectClass} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUS_FILTERS.map((st) => <option key={st} value={st}>{statusLabel(st)}</option>)}
        </select>
        <select name="category" defaultValue={category ?? ""} className={selectClass} aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {filtering && (
        <p className="mb-3 text-sm text-muted-foreground" role="status">
          {rows.length} result{rows.length === 1 ? "" : "s"}
          {q?.trim() ? <> for “{q.trim()}” in {SEARCH_FIELD_LABELS[field].toLowerCase()}</> : null}
          {status ? <> · status: {statusLabel(status)}</> : null}
          {" · "}<Link className="underline" href="/machines">Clear</Link>
        </p>
      )}

      {rows.length ? (
        <MachineTable rows={rows} mode={filtering ? "flat" : "tree"} />
      ) : (
        <Empty>No machines match. {canCreateMachine(s.role) ? "Register one to get started." : "Ask a manager for access."}</Empty>
      )}
    </Page>
  );
}
