import { redirect } from "next/navigation";
import { MachineForm } from "@/components/machine-form";
import { Page, PageHeader } from "@/components/ui-bits";
import { requireOrg } from "@/lib/auth";
import { canCreateMachine } from "@/lib/permissions";

export const metadata = { title: "Register machine" };

export default async function NewMachinePage({ searchParams }: { searchParams: Promise<{ parent?: string }> }) {
  const { parent } = await searchParams;
  const s = await requireOrg();
  if (!canCreateMachine(s.role)) redirect("/machines");
  const { data: parents } = await s.supabase.from("machines").select("id, name, serial_number").eq("org_id", s.orgId).order("name");
  return (
    <Page className="max-w-3xl">
      <PageHeader title="Register machine" description="Required fields are marked with *." />
      <MachineForm parents={parents ?? []} defaultParentId={parents?.some((p) => p.id === parent) ? parent : null} />
    </Page>
  );
}
