import { redirect } from "next/navigation";
import { MachineForm } from "@/components/machine-form";
import { Page, PageHeader } from "@/components/ui-bits";
import { requireOrg } from "@/lib/auth";
import { canCreateMachine } from "@/lib/permissions";

export const metadata = { title: "Register machine" };

export default async function NewMachinePage() {
  const s = await requireOrg();
  if (!canCreateMachine(s.role)) redirect("/machines");
  return (
    <Page className="max-w-3xl">
      <PageHeader title="Register machine" description="Required fields are marked with *." />
      <MachineForm />
    </Page>
  );
}
