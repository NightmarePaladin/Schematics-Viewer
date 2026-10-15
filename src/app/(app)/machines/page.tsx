import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, MachineStatusBadge, Page, PageHeader, selectClass } from "@/components/ui-bits";
import { requireOrg } from "@/lib/auth";
import { canCreateMachine } from "@/lib/permissions";
import { MACHINE_STATUSES } from "@/lib/schemas";

export const metadata = { title: "Machines" };

export default async function MachinesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; category?: string }>;
}) {
  const s = await requireOrg();
  const { q, status, category } = await searchParams;

  let query = s.supabase.from("machines").select("*").eq("org_id", s.orgId).order("name");
  if (status && (MACHINE_STATUSES as readonly string[]).includes(status)) query = query.eq("status", status);
  if (category) query = query.eq("category", category);
  if (q?.trim()) {
    const term = q.replace(/[%,()]/g, " ").trim();
    query = query.or(
      ["name", "manufacturer", "model_number", "serial_number", "asset_number", "location"].map((c) => `${c}.ilike.%${term}%`).join(","),
    );
  }
  const [{ data: machines }, { data: cats }] = await Promise.all([
    query,
    s.supabase.from("machines").select("category").eq("org_id", s.orgId),
  ]);
  const categories = [...new Set((cats ?? []).map((c) => c.category))].sort();

  return (
    <Page>
      <PageHeader
        title="Machines"
        description="Registered equipment you have access to."
        actions={canCreateMachine(s.role) ? <Button nativeButton={false} render={<Link href="/machines/new" />}>Register machine</Button> : undefined}
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px_180px_auto]" role="search">
        <Input name="q" defaultValue={q} placeholder="Search name, manufacturer, model, serial…" aria-label="Search machines" />
        <select name="status" defaultValue={status ?? ""} className={selectClass} aria-label="Filter by status">
          <option value="">All statuses</option>
          {MACHINE_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
        <select name="category" defaultValue={category ?? ""} className={selectClass} aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>

      {machines?.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Name</th><th className="p-3">Category</th><th className="p-3">Manufacturer / Model</th>
                <th className="p-3">Serial</th><th className="p-3">Location</th><th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => (
                <tr key={m.id} className="border-t hover:bg-muted/30">
                  <td className="p-3 font-medium"><Link href={`/machines/${m.id}`} className="hover:underline">{m.name}</Link></td>
                  <td className="p-3">{m.category}</td>
                  <td className="p-3">{m.manufacturer} <span className="text-muted-foreground">{m.model_number}</span></td>
                  <td className="p-3 font-mono text-xs">{m.serial_number}</td>
                  <td className="p-3">{m.location ?? "—"}</td>
                  <td className="p-3"><MachineStatusBadge status={m.status} /></td>
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
