import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardLists, type DashIssue, type DashLog } from "@/components/dashboard-lists";
import { Page, PageHeader, one } from "@/components/ui-bits";
import { requireOrgPage } from "@/lib/auth";
import { faultIds, loadFaults } from "@/lib/machines";
import { ISSUE_SELECT } from "@/lib/selects";

export const metadata = { title: "Dashboard" };

/** How many rows of each list are sent to the browser; the page shows as many as fit, and "View all" opens up to this many. */
const LOADED = 100;

export default async function Dashboard() {
  const s = await requireOrgPage();
  const count = async (table: string, f?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = s.supabase.from(table).select("id", { count: "exact", head: true }).eq("org_id", s.orgId);
    if (f) q = f(q);
    return (await q).count ?? 0;
  };
  const [machines, schematics, openIssues, critical, issues, logCount, logs, inop] = await Promise.all([
    count("machines"),
    count("schematics"),
    count("maintenance_issues", (q) => q.neq("status", "resolved")),
    count("maintenance_issues", (q) => q.neq("status", "resolved").eq("severity", "critical")),
    // most urgent repair first, then newest
    s.supabase.from("maintenance_issues").select(ISSUE_SELECT).eq("org_id", s.orgId).neq("status", "resolved")
      .order("repair_priority", { ascending: false }).order("created_at", { ascending: false }).limit(LOADED),
    count("maintenance_logs"),
    s.supabase
      .from("maintenance_logs")
      .select("id, body, entry_type, performed_at, machine:machines(id, name), performer:profiles!maintenance_logs_performed_by_fkey(display_name)")
      .eq("org_id", s.orgId)
      .order("performed_at", { ascending: false })
      .limit(LOADED),
    loadFaults(s, s.orgId),
  ]);

  const stats = [
    { label: "Machines", value: machines, href: "/machines" },
    { label: "Schematics", value: schematics, href: "/schematics" },
    { label: "Open issues", value: openIssues, href: "/maintenance" },
    { label: "Critical open", value: critical, href: "/maintenance?severity=critical" },
    { label: "Machines in fault", value: faultIds(inop).size, href: "/machines?status=critical" },
  ];

  const issueRows: DashIssue[] = (issues.data ?? []).map((i) => ({
    id: i.id, title: i.title, machine_id: i.machine_id, machine_name: one(i.machine)?.name ?? null, created_at: i.created_at,
    severity: i.severity, status: i.status, repair_priority: i.repair_priority ?? "normal",
  }));
  const logRows: DashLog[] = (logs.data ?? []).map((l) => ({
    id: l.id, body: l.body, entry_type: l.entry_type, performed_at: l.performed_at,
    machine_id: one(l.machine)?.id ?? null, machine_name: one(l.machine)?.name ?? null, performer: one(l.performer)?.display_name ?? null,
  }));

  return (
    // On a desktop the page is exactly one screen tall: the stat cards on top, the two lists filling the rest.
    <Page className="lg:flex lg:h-full lg:min-h-0 lg:flex-col">
      <PageHeader title="Dashboard" description="What you can see across your organization." />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:shrink-0 lg:grid-cols-5">
        {stats.map((st) => (
          // The whole card is the link: it lifts and lights up on hover or keyboard focus (thin ring).
          <Link
            key={st.label}
            href={st.href}
            data-testid={`stat-${st.label.toLowerCase().replace(/\s+/g, "-")}`}
            className="group block rounded-xl outline-none"
          >
            <Card className="h-full cursor-pointer transition-all duration-150 group-hover:-translate-y-0.5 group-hover:bg-primary/15 group-hover:shadow-md group-hover:ring-1 group-hover:ring-primary group-focus-visible:-translate-y-0.5 group-focus-visible:bg-primary/15 group-focus-visible:ring-1 group-focus-visible:ring-primary">
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground">{st.label}</CardTitle>
              </CardHeader>
              <CardContent className="text-3xl font-semibold tabular-nums">{st.value}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <DashboardLists issues={issueRows} issuesTotal={openIssues} logs={logRows} logsTotal={logCount} />
    </Page>
  );
}
