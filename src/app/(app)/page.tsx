import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, IssueStatusBadge, Page, PageHeader, SeverityBadge, fmtDate, one } from "@/components/ui-bits";
import { requireOrgPage } from "@/lib/auth";
import { loadInoperable } from "@/lib/machines";
import { ISSUE_SELECT } from "@/lib/selects";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const s = await requireOrgPage();
  const count = async (table: string, f?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = s.supabase.from(table).select("id", { count: "exact", head: true }).eq("org_id", s.orgId);
    if (f) q = f(q);
    return (await q).count ?? 0;
  };
  const [machines, schematics, openIssues, critical, issues, logs, inop] = await Promise.all([
    count("machines"),
    count("schematics"),
    count("maintenance_issues", (q) => q.neq("status", "resolved")),
    count("maintenance_issues", (q) => q.neq("status", "resolved").eq("severity", "critical")),
    s.supabase.from("maintenance_issues").select(ISSUE_SELECT).eq("org_id", s.orgId).neq("status", "resolved").order("created_at", { ascending: false }).limit(6),
    s.supabase
      .from("maintenance_logs")
      .select("id, body, entry_type, performed_at, machine:machines(id, name), performer:profiles!maintenance_logs_performed_by_fkey(display_name)")
      .eq("org_id", s.orgId)
      .order("performed_at", { ascending: false })
      .limit(6),
    loadInoperable(s, s.orgId),
  ]);

  const stats = [
    { label: "Machines", value: machines, href: "/machines" },
    { label: "Schematics", value: schematics, href: "/schematics" },
    { label: "Open issues", value: openIssues, href: "/maintenance" },
    { label: "Critical open", value: critical, href: "/maintenance?severity=critical" },
    { label: "Inoperable machines", value: inop.size, href: "/machines" },
  ];

  return (
    <Page>
      <PageHeader title="Dashboard" description="What you can see across your organization." />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map((st) => (
          <Link key={st.label} href={st.href}>
            <Card className="transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">{st.label}</CardTitle>
              </CardHeader>
              <CardContent className="text-3xl font-semibold tabular-nums">{st.value}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Open issues</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {issues.data?.length ? (
              issues.data.map((i) => (
                <div key={i.id} className="flex items-start justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <Link href={`/machines/${i.machine_id}`} className="font-medium hover:underline">{i.title}</Link>
                    <div className="truncate text-xs text-muted-foreground">{one(i.machine)?.name} · {fmtDate(i.created_at)}</div>
                  </div>
                  <div className="flex shrink-0 gap-1"><SeverityBadge severity={i.severity} /><IssueStatusBadge status={i.status} /></div>
                </div>
              ))
            ) : (
              <Empty>No open issues.</Empty>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent maintenance activity</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {logs.data?.length ? (
              logs.data.map((l) => (
                <div key={l.id} className="text-sm">
                  <div className="line-clamp-2">{l.body}</div>
                  <div className="text-xs text-muted-foreground">
                    <Link className="hover:underline" href={`/machines/${one(l.machine)?.id}`}>{one(l.machine)?.name}</Link> · {one(l.performer)?.display_name} · {fmtDate(l.performed_at, true)}
                  </div>
                </div>
              ))
            ) : (
              <Empty>No log entries yet.</Empty>
            )}
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
