import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Page, PageHeader, fmtDate } from "@/components/ui-bits";
import { requireOrgPage } from "@/lib/auth";

export const metadata = { title: "Settings" };

const ROLES = [
  ["Admin", "Full control of the organization: members, groups, every machine and schematic."],
  ["Maintenance Manager", "Manage machines, groups, issues and all schematics (implicit Manage permission)."],
  ["Technician", "Register machines, upload schematics, report issues and log work. Sees schematics shared with them."],
  ["Viewer", "Read-only. Sees schematics shared with them and cannot comment even if granted higher access."],
];

export default async function SettingsPage() {
  const s = await requireOrgPage();
  const { data: org } = await s.supabase.from("organizations").select("name, created_at").eq("id", s.orgId).single();
  const m = s.memberships.find((x) => x.org_id === s.orgId);
  return (
    <Page className="max-w-3xl">
      <PageHeader title="Settings" />
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Account</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>{s.user.email}</div>
            <div className="text-muted-foreground">Organization: {org?.name} (created {fmtDate(org?.created_at)})</div>
            <div className="text-muted-foreground">Your role: <span className="capitalize">{m?.role.replace("_", " ")}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Roles in this workspace</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              {ROLES.map(([r, d]) => (<div key={r}><dt className="font-medium">{r}</dt><dd className="text-muted-foreground">{d}</dd></div>))}
            </dl>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
