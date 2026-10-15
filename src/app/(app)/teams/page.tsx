import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, Page, PageHeader, one } from "@/components/ui-bits";
import { TeamsAdmin } from "@/components/teams-admin";
import { requireOrg } from "@/lib/auth";
import { canManageMachines } from "@/lib/permissions";

export const metadata = { title: "Teams" };

export default async function TeamsPage() {
  const s = await requireOrg();
  const [members, groups, memberships] = await Promise.all([
    s.supabase.from("organization_memberships").select("user_id, role, profile:profiles(display_name, email)").eq("org_id", s.orgId).order("created_at"),
    s.supabase.from("groups").select("id, name, description").eq("org_id", s.orgId).order("name"),
    s.supabase.from("group_memberships").select("group_id, user_id").eq("org_id", s.orgId),
  ]);
  const people = (members.data ?? []).map((m) => ({
    user_id: m.user_id as string,
    role: m.role as string,
    name: one(m.profile)?.display_name ?? "Unknown",
    email: one(m.profile)?.email ?? "",
  }));
  const byGroup = new Map<string, string[]>();
  for (const gm of memberships.data ?? []) byGroup.set(gm.group_id, [...(byGroup.get(gm.group_id) ?? []), gm.user_id]);

  return (
    <Page>
      <PageHeader title="Teams" description="Members, roles and groups. Groups can be granted access to schematics." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Members</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {people.map((p) => (
                <li key={p.user_id} className="flex items-center justify-between gap-2 p-3 text-sm">
                  <div><div className="font-medium">{p.name}</div><div className="text-xs text-muted-foreground">{p.email}</div></div>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs capitalize">{p.role.replace("_", " ")}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Groups</CardTitle></CardHeader>
          <CardContent>
            {groups.data?.length ? (
              <ul className="space-y-2">
                {groups.data.map((g) => (
                  <li key={g.id} className="rounded-lg border p-3 text-sm">
                    <div className="font-medium">{g.name}</div>
                    {g.description && <div className="text-xs text-muted-foreground">{g.description}</div>}
                    <div className="mt-1 text-xs">
                      {(byGroup.get(g.id) ?? []).map((uid) => people.find((p) => p.user_id === uid)?.name ?? "?").join(", ") || "No members"}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No groups yet.</Empty>
            )}
          </CardContent>
        </Card>
      </div>
      {canManageMachines(s.role) && (
        <TeamsAdmin
          isAdmin={s.role === "admin"}
          people={people.map((p) => ({ user_id: p.user_id, name: p.name }))}
          groups={(groups.data ?? []).map((g) => ({ id: g.id, name: g.name }))}
        />
      )}
    </Page>
  );
}
