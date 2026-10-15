import Link from "next/link";
import { Empty, Page, PageHeader, fmtDate, one } from "@/components/ui-bits";
import { requireOrg } from "@/lib/auth";

export const metadata = { title: "Schematics" };

export default async function SchematicsPage() {
  const s = await requireOrg();
  const { data } = await s.supabase
    .from("schematics")
    .select("id, title, document_number, revision, file_size, created_at, machine:machines(id, name), uploader:profiles!schematics_uploaded_by_fkey(display_name)")
    .eq("org_id", s.orgId)
    .order("created_at", { ascending: false });

  return (
    <Page>
      <PageHeader title="Schematics" description="Documents shared with you. Upload new ones from a machine's page." />
      {data?.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-3">Title</th><th className="p-3">Doc #</th><th className="p-3">Rev</th><th className="p-3">Machine</th><th className="p-3">Uploaded by</th><th className="p-3">Uploaded</th></tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="p-3 font-medium"><Link className="hover:underline" href={`/schematics/${r.id}`}>{r.title}</Link></td>
                  <td className="p-3 font-mono text-xs">{r.document_number}</td>
                  <td className="p-3">{r.revision}</td>
                  <td className="p-3"><Link className="hover:underline" href={`/machines/${one(r.machine)?.id}`}>{one(r.machine)?.name}</Link></td>
                  <td className="p-3">{one(r.uploader)?.display_name}</td>
                  <td className="p-3">{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No schematics are shared with you yet.</Empty>
      )}
    </Page>
  );
}
