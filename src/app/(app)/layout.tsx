import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.orgId || !s.role) redirect("/onboarding");
  const { data: profile } = await s.supabase.from("profiles").select("display_name").eq("id", s.user.id).maybeSingle();
  return (
    <AppShell
      user={{ name: profile?.display_name ?? s.user.email ?? "User", email: s.user.email ?? "" }}
      role={s.role}
      orgId={s.orgId}
      orgs={s.memberships.map((m) => ({ org_id: m.org_id, org_name: m.org_name }))}
    >
      {children}
    </AppShell>
  );
}
