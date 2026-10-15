import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, IssueStatusBadge, Page, PageHeader, SeverityBadge, fmtDate, one, selectClass } from "@/components/ui-bits";
import { IssueActions } from "@/components/issue-actions";
import { requireOrgPage } from "@/lib/auth";
import { ISSUE_STATUSES, SEVERITIES } from "@/lib/schemas";
import { ISSUE_SELECT } from "@/lib/selects";

export const metadata = { title: "Maintenance Logs" };

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ status?: string; severity?: string }> }) {
  const s = await requireOrgPage();
  const { status, severity } = await searchParams;
  let iq = s.supabase.from("maintenance_issues").select(ISSUE_SELECT).eq("org_id", s.orgId).order("created_at", { ascending: false });
  if (status && (ISSUE_STATUSES as readonly string[]).includes(status)) iq = iq.eq("status", status);
  if (severity && (SEVERITIES as readonly string[]).includes(severity)) iq = iq.eq("severity", severity);

  const [issues, logs] = await Promise.all([
    iq,
    s.supabase
      .from("maintenance_logs")
      .select("id, body, entry_type, performed_at, machine:machines(id, name), performer:profiles!maintenance_logs_performed_by_fkey(display_name)")
      .eq("org_id", s.orgId)
      .order("performed_at", { ascending: false })
      .limit(100),
  ]);

  return (
    <Page>
      <PageHeader title="Maintenance Logs" description="Issues and the append-only log of work performed." />
      <Card className="mb-4">
        <CardHeader><CardTitle>Issues</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <form className="flex flex-wrap gap-2" role="search">
            <select name="status" defaultValue={status ?? ""} className={`${selectClass} w-44`} aria-label="Status">
              <option value="">All statuses</option>{ISSUE_STATUSES.map((v) => <option key={v} value={v}>{v.replace("_", " ")}</option>)}
            </select>
            <select name="severity" defaultValue={severity ?? ""} className={`${selectClass} w-44`} aria-label="Severity">
              <option value="">All severities</option>{SEVERITIES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <Button type="submit" variant="secondary">Filter</Button>
          </form>
          {issues.data?.length ? (
            <ul className="divide-y rounded-lg border">
              {issues.data.map((i) => (
                <li key={i.id} className="space-y-1 p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <span className="font-medium">{i.title}</span>{" "}
                      <Link className="text-xs text-muted-foreground underline" href={`/machines/${i.machine_id}`}>{one(i.machine)?.name}</Link>
                    </div>
                    <span className="flex gap-1"><SeverityBadge severity={i.severity} /><IssueStatusBadge status={i.status} /></span>
                  </div>
                  {i.description && <p className="text-muted-foreground">{i.description}</p>}
                  <div className="text-xs text-muted-foreground">
                    Reported by {one(i.reporter)?.display_name} · {fmtDate(i.created_at)}
                    {one(i.assignee) && <> · Assigned to {one(i.assignee)?.display_name}</>}
                    {i.schematic_id && <> · <Link className="underline" href={`/schematics/${i.schematic_id}?page=${i.page_number ?? 1}`}>{one(i.schematic)?.title} p.{i.page_number}</Link></>}
                  </div>
                  {i.resolution_note && <p className="text-xs">Resolution: {i.resolution_note}</p>}
                  {i.status !== "resolved" && <IssueActions issueId={i.id} status={i.status} />}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No issues match.</Empty>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Log entries</CardTitle></CardHeader>
        <CardContent>
          {logs.data?.length ? (
            <ol className="space-y-2">
              {logs.data.map((l) => (
                <li key={l.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                    <span className="capitalize">{l.entry_type} · <Link className="underline" href={`/machines/${one(l.machine)?.id}`}>{one(l.machine)?.name}</Link> · {one(l.performer)?.display_name}</span>
                    <time dateTime={l.performed_at}>{fmtDate(l.performed_at, true)}</time>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{l.body}</p>
                </li>
              ))}
            </ol>
          ) : (
            <Empty>No log entries.</Empty>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
