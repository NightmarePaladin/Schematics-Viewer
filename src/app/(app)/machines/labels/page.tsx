import Link from "next/link";
import { MachineLabel } from "@/components/machine-label";
import { PrintButton } from "@/components/print-button";
import { Empty, Page, PageHeader } from "@/components/ui-bits";
import { linkButton } from "@/components/ui/button";
import { requireOrgPage } from "@/lib/auth";
import { labelOrigin, machineUrl } from "@/lib/qr";
import { getOrigin } from "@/lib/site";

export const metadata = { title: "QR labels" };

/** A print sheet with one QR label for every machine the signed-in user can see. */
export default async function LabelsPage() {
  const s = await requireOrgPage();
  const { data } = await s.supabase
    .from("machines")
    .select("id, name, manufacturer, model_number, serial_number, asset_number, location")
    .eq("org_id", s.orgId)
    .order("name");
  const origin = labelOrigin(await getOrigin());
  const machines = data ?? [];

  return (
    <Page>
      <div className="print:hidden">
        <PageHeader
          title="QR labels"
          description={`${machines.length} label${machines.length === 1 ? "" : "s"} for the machines you can see. Use Print, then cut along the borders.`}
          actions={
            <>
              <Link href="/machines" className={linkButton({ variant: "outline" })}>Back to machines</Link>
              {machines.length > 0 && <PrintButton label="Print all labels" />}
            </>
          }
        />
      </div>
      {machines.length === 0 ? (
        <Empty>No machines to label yet.</Empty>
      ) : (
        <div className="flex flex-wrap gap-3" data-testid="label-sheet">
          {machines.map((m) => (
            <MachineLabel key={m.id} machine={{ ...m, url: machineUrl(origin, m.id) }} />
          ))}
        </div>
      )}
    </Page>
  );
}
