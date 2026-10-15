import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { MachineLabel } from "@/components/machine-label";
import { PrintButton } from "@/components/print-button";
import { Page, PageHeader } from "@/components/ui-bits";
import { linkButton } from "@/components/ui/button";
import { requireOrgPage } from "@/lib/auth";
import { labelOrigin, machineUrl } from "@/lib/qr";
import { getOrigin } from "@/lib/site";

export const metadata = { title: "QR label" };

export default async function MachineLabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const s = await requireOrgPage();
  const { data: m } = await s.supabase
    .from("machines")
    .select("id, name, manufacturer, model_number, serial_number, asset_number, location")
    .eq("id", id)
    .eq("org_id", s.orgId)
    .maybeSingle();
  if (!m) notFound();
  const origin = labelOrigin(await getOrigin());

  return (
    <Page className="max-w-3xl">
      <div className="print:hidden">
        <PageHeader
          title="QR label"
          description="Print and stick this on the machine. Scanning it opens this machine's page (people still have to sign in)."
          actions={
            <>
              <Link href={`/machines/${id}`} className={linkButton({ variant: "outline" })}>Back to machine</Link>
              <a href={`/api/machines/${id}/qr?format=png&size=1024`} download={`${m.serial_number}-qr.png`} className={linkButton({ variant: "outline" })}>Download PNG</a>
              <PrintButton label="Print label" />
            </>
          }
        />
      </div>
      <MachineLabel machine={{ ...m, url: machineUrl(origin, id) }} />
    </Page>
  );
}
