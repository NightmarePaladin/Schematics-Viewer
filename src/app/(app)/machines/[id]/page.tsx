import Link from "next/link";
import { notFound } from "next/navigation";
import { LogForm, IssueForm } from "@/components/maintenance-forms";
import { UploadForm } from "@/components/upload-form";
import { WeatherPanel } from "@/components/weather-panel";
import { linkButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, IssueStatusBadge, MachineStatusBadge, Page, PageHeader, SeverityBadge, fmtDate, one } from "@/components/ui-bits";
import { requireOrgPage } from "@/lib/auth";
import { effectiveCoords, firstOf, formatCoords } from "@/lib/location-utils";
import { ancestorsOf, childrenOf } from "@/lib/machine-tree";
import { causeIds, loadFaults, statusOf } from "@/lib/machines";
import { canCreateMachine, canManageMachines, canUploadSchematic, canWriteMaintenance } from "@/lib/permissions";
import { ISSUE_SELECT } from "@/lib/selects";
import { z } from "zod";

export const metadata = { title: "Machine" };

export default async function MachineDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const s = await requireOrgPage();
  const { data: m } = await s.supabase.from("machines").select("*, place:locations(id, name, latitude, longitude)").eq("id", id).eq("org_id", s.orgId).maybeSingle();
  if (!m) notFound();

  const [{ data: tree }, faults] = await Promise.all([
    s.supabase.from("machines").select("id, name, parent_id, is_critical, status, serial_number").eq("org_id", s.orgId).order("name"),
    loadFaults(s, s.orgId),
  ]);
  const inop = faults.inherited;
  const ownCritical = faults.critical.get(id) ?? 0;
  const trail = ancestorsOf(tree ?? [], id).reverse();
  const subs = childrenOf(tree ?? [], id);
  const causes = inop.get(id) ?? [];
  const causing = causeIds(inop);
  const takenDown = (tree ?? []).filter((n) => inop.get(n.id)?.some((x) => x.id === id));
  const [schematics, issues, logs] = await Promise.all([
    s.supabase
      .from("schematics")
      .select("id, title, document_number, revision, created_at, uploader:profiles!schematics_uploaded_by_fkey(display_name)")
      .eq("machine_id", id)
      .order("created_at", { ascending: false }),
    s.supabase.from("maintenance_issues").select(ISSUE_SELECT).eq("machine_id", id).order("created_at", { ascending: false }),
    s.supabase
      .from("maintenance_logs")
      .select("id, body, entry_type, performed_at, performer:profiles!maintenance_logs_performed_by_fkey(display_name)")
      .eq("machine_id", id)
      .order("performed_at", { ascending: false }),
  ]);

  const canEdit = canManageMachines(s.role) || (canCreateMachine(s.role) && m.created_by === s.user.id);
  const place = firstOf(m.place as { id: string; name: string; latitude: number | null; longitude: number | null } | null);
  const coords = effectiveCoords({ latitude: m.latitude, longitude: m.longitude, place });
  const meta: [string, string | null][] = [
    ["Category", m.category], ["Manufacturer", m.manufacturer], ["Model", m.model_number], ["Serial number", m.serial_number],
    ["Asset number", m.asset_number], ["Location", place?.name ?? m.location], ["Installed", m.installed_on ? fmtDate(m.installed_on) : null],
    ["Coordinates", coords.source === "none" ? null : `${formatCoords(coords)} (${coords.source === "location" ? `from location ${place?.name}` : "set on this machine"})`],
    ["Critical component", m.is_critical ? "Yes: a major issue here makes its parent inoperable" : "No"],
  ];

  return (
    <Page>
      {trail.length > 0 && (
        <nav aria-label="System hierarchy" className="mb-2 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          {trail.map((a) => (
            <span key={a.id} className="flex items-center gap-1"><Link className="hover:underline" href={`/machines/${a.id}`}>{a.name}</Link><span aria-hidden>/</span></span>
          ))}
          <span className="font-medium text-foreground">{m.name}</span>
        </nav>
      )}
      {ownCritical > 0 && (
        <div role="alert" data-testid="critical-banner" className="mb-4 rounded-lg border border-red-700/60 bg-red-700/10 p-3 text-sm">
          <p className="font-semibold text-red-700 dark:text-red-300">Critical fault: this machine has {ownCritical} unresolved critical issue{ownCritical === 1 ? "" : "s"}</p>
          <p className="text-muted-foreground">Its status shows as critical until {ownCritical === 1 ? "that issue is" : "those issues are"} resolved. See the Issues section below.</p>
        </div>
      )}
      {causes.length > 0 && (
        <div role="alert" data-testid="inoperable-banner" className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">
          <p className="font-semibold text-red-700 dark:text-red-300">Inoperable — inherited from a critical sub-machine</p>
          <p className="text-muted-foreground">
            {causes.map((c, i) => (
              <span key={c.id}>{i > 0 && ", "}{c.name ? <Link className="underline" href={`/machines/${c.id}`}>{c.name}</Link> : "a restricted sub-machine"}</span>
            ))}{" "}
            {causes.length === 1 ? "has" : "have"} an unresolved high or critical issue. This clears automatically when that issue is resolved.
          </p>
        </div>
      )}
      {causing.has(id) && (
        <div role="status" data-testid="causing-notice" className="mb-4 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="font-semibold text-amber-800 dark:text-amber-300">Critical component with an unresolved major issue</p>
          <p className="text-muted-foreground">
            Until it is resolved, {takenDown.length > 0 ? takenDown.map((n, i) => (<span key={n.id}>{i > 0 && ", "}<Link className="underline" href={`/machines/${n.id}`}>{n.name}</Link></span>)) : "its parent system"}{" "}
            {takenDown.length === 1 ? "is" : "are"} treated as inoperable.
          </p>
        </div>
      )}
      <PageHeader
        title={m.name}
        description={m.description ?? undefined}
        actions={
          <>
            <MachineStatusBadge status={statusOf(m.status, id, faults)} />
            <Link href={`/machines/${id}/label`} className={linkButton({ variant: "outline" })}>QR label</Link>
            {canEdit && <Link href={`/machines/${id}/edit`} className={linkButton({ variant: "outline" })}>Edit</Link>}
          </>
        }
      />
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {meta.map(([k, v]) => (
                <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium">{v || "—"}</dd></div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Weather context</CardTitle></CardHeader>
          <CardContent><WeatherPanel machineId={id} hasLocation={coords.source !== "none"} /></CardContent>
        </Card>
      </div>

      <Card className="mb-4" data-testid="sub-machines">
        <CardHeader><CardTitle>Sub-machines</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {subs.length ? (
            <ul className="divide-y rounded-lg border">
              {subs.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                  <span>
                    <Link href={`/machines/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{c.serial_number}</span>
                    {c.is_critical && <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:text-amber-300">critical</span>}
                  </span>
                  <span className="flex items-center gap-1">{causing.has(c.id) && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700 dark:text-red-300">major issue</span>}<MachineStatusBadge status={statusOf(c.status, c.id, faults)} /></span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No sub-machines. Link machines here to model a system and its parts.</Empty>
          )}
          {canCreateMachine(s.role) && <Link href={`/machines/new?parent=${id}`} className={linkButton({ variant: "outline", size: "sm" })}>Add sub-machine</Link>}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Schematics</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {schematics.data?.length ? (
              <ul className="divide-y rounded-lg border">
                {schematics.data.map((sc) => (
                  <li key={sc.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                    <div className="min-w-0">
                      <Link href={`/schematics/${sc.id}`} className="font-medium hover:underline">{sc.title}</Link>
                      <div className="text-xs text-muted-foreground">{sc.document_number} · Rev {sc.revision} · {one(sc.uploader)?.display_name} · {fmtDate(sc.created_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No schematics you can view for this machine.</Empty>
            )}
            {canUploadSchematic(s.role) && (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">Upload a schematic</summary>
                <div className="mt-3"><UploadForm machineId={id} /></div>
              </details>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Issues</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {issues.data?.length ? (
              <ul className="divide-y rounded-lg border">
                {issues.data.map((i) => (
                  <li key={i.id} className="p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{i.title}</span>
                      <span className="flex shrink-0 gap-1"><SeverityBadge severity={i.severity} /><IssueStatusBadge status={i.status} /></span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {one(i.reporter)?.display_name} · {fmtDate(i.created_at)}
                      {i.schematic_id && (<> · <Link className="underline" href={`/schematics/${i.schematic_id}${i.page_number ? `?page=${i.page_number}` : ""}`}>{one(i.schematic)?.title ?? "schematic"} p.{i.page_number}</Link></>)}
                    </div>
                    {i.resolution_note && <div className="mt-1 text-xs">Resolution: {i.resolution_note}</div>}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No issues reported.</Empty>
            )}
            {canWriteMaintenance(s.role) && <IssueForm machineId={id} />}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Maintenance history</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {canWriteMaintenance(s.role) && <LogForm machineId={id} />}
            {logs.data?.length ? (
              <ol className="space-y-2">
                {logs.data.map((l) => (
                  <li key={l.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                      <span className="capitalize">{l.entry_type} · {one(l.performer)?.display_name}</span>
                      <time dateTime={l.performed_at}>{fmtDate(l.performed_at, true)}</time>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{l.body}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>No maintenance history yet.</Empty>
            )}
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
