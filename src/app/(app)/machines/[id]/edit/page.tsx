import { notFound, redirect } from "next/navigation";
import { MachineForm } from "@/components/machine-form";
import { Page, PageHeader } from "@/components/ui-bits";
import { requireOrgPage } from "@/lib/auth";
import { eligibleParents } from "@/lib/machine-tree";
import { canManageMachines } from "@/lib/permissions";

export const metadata = { title: "Edit machine" };

export default async function EditMachinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireOrgPage();
  const { data: machine } = await s.supabase.from("machines").select("*").eq("id", id).eq("org_id", s.orgId).maybeSingle();
  if (!machine) notFound();
  if (!canManageMachines(s.role) && machine.created_by !== s.user.id) redirect(`/machines/${id}`);
  const { data: all } = await s.supabase.from("machines").select("id, name, serial_number, parent_id").eq("org_id", s.orgId).order("name");
  const parents = eligibleParents(all ?? [], id);
  const { data: locations } = await s.supabase.from("locations").select("id, name, latitude, longitude").eq("org_id", s.orgId).order("name");
  return (
    <Page className="max-w-3xl">
      <PageHeader title={`Edit ${machine.name}`} />
      <MachineForm machine={machine} parents={parents} locations={locations ?? []} />
    </Page>
  );
}
