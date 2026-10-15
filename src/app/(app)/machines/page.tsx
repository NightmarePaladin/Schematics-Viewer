import Link from "next/link";
import { Button, linkButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, MachineStatusBadge, Page, PageHeader, selectClass } from "@/components/ui-bits";
import { requireOrgPage } from "@/lib/auth";
import { applyMachineSearch, isSearchField, SEARCH_FIELD_LABELS, type SearchField } from "@/lib/machine-search";
import { causeIds, effectiveStatus, loadInoperable } from "@/lib/machines";
import { canCreateMachine } from "@/lib/permissions";
import { MACHINE_STATUSES } from "@/lib/schemas";

export const metadata = { title: "Machines" };

export default async function MachinesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; field?: string; status?: string; category?: string }>;
}) {
  const s = await requireOrgPage();
  const { q, field: rawField, status, category } = await searchParams;
  const field: SearchField = isSearchField(rawField) ? rawField : "all";

  let query = s.supabase.from("machines").select("*").eq("org_id", s.orgId).order("name");
  if (status && (MACHINE_STATUSES as readonly string[]).includes(status)) query = query.eq("status", status);
  if (category) query = query.eq("category", category);
  query = applyMachineSearch(query, q, field);
  const [{ data: machines }, { data: cats }, inop] = await Promise.all([
    query,
    s.supabase.from("machines").select("id, name, category").eq("org_id", s.orgId),
    loadInoperable(s, s.orgId),
  ]);
  const categories = [...new Set((cats ?? []).map((c) => c.category))].sort();
  const causes = causeIds(inop);
  const nameOf = new Map((cats ?? []).map((c) => [c.id, c.name]));

  return (
    <Page>
      <PageHeader
        title="Machines"
        description="Registered equipment you have access to."
        actions={<><Link href="/locations" className={linkButton({ variant: "outline" })}>Locations</Link>{canCreateMachine(s.role) ? <Link href="/machines/new" className={linkButton()}>Register machine</Link> : null}</>}
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_150px_160px_160px_auto]" role="search">
        <Input name="q" defaultValue={q} placeholder="Search by name, manufacturer, model, location…" aria-label="Search machines" />
        <select name="field" defaultValue={field} className={selectClass} aria-label="Search in">
          {(Object.keys(SEARCH_FIELD_LABELS) as SearchField[]).map((f) => <option key={f} value={f}>{f === "all" ? "Search: all fields" : `Search: ${SEARCH_FIELD_LABELS[f]}`}</option>)}
        </select>
        <select name="status" defaultValue={status ?? ""} className={selectClass} aria-label="Filter by status">
          <option value="">All statuses</option>
          {MACHINE_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
        <select name="category" defaultValue={category ?? ""} className={selectClass} aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {(q?.trim() || status || category) && (
        <p className="mb-3 text-sm text-muted-foreground" role="status">
          {machines?.length ?? 0} result{machines?.length === 1 ? "" : "s"}
          {q?.trim() ? <> for “{q.trim()}” in {SEARCH_FIELD_LABELS[field].toLowerCase()}</> : null}
          {" · "}<Link className="underline" href="/machines">Clear</Link>
        </p>
      )}

      {machines?.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Name</th><th className="p-3">Category</th><th className="p-3">Manufacturer / Model</th>
                <th className="p-3">Part of</th><th className="p-3">Serial</th><th className="p-3">Location</th><th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => (
                <tr key={m.id} className="border-t hover:bg-muted/30">
                  <td className="p-3 font-medium">
                    <Link href={`/machines/${m.id}`} className="hover:underline">{m.name}</Link>
                    {m.is_critical && <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:text-amber-300" title="Critical component: a major issue here takes its parent out of service">critical</span>}
                  </td>
                  <td className="p-3">{m.category}</td>
                  <td className="p-3">{m.manufacturer} <span className="text-muted-foreground">{m.model_number}</span></td>
                  <td className="p-3">{m.parent_id ? (nameOf.has(m.parent_id) ? <Link href={`/machines/${m.parent_id}`} className="hover:underline">{nameOf.get(m.parent_id)}</Link> : <span className="text-muted-foreground">restricted</span>) : "—"}</td>
                  <td className="p-3 font-mono text-xs">{m.serial_number}</td>
                  <td className="p-3">{m.location ?? "—"}</td>
                  <td className="p-3"><MachineStatusBadge status={effectiveStatus(m.status, inop.has(m.id))} />{causes.has(m.id) && <span className="ml-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700 dark:text-red-300" title="Unresolved high/critical issue on a critical component: its parent is inoperable">major issue</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No machines match. {canCreateMachine(s.role) ? "Register one to get started." : "Ask a manager for access."}</Empty>
      )}
    </Page>
  );
}
