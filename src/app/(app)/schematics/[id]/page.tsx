import { notFound } from "next/navigation";
import { z } from "zod";
import { SchematicViewer } from "@/components/viewer/schematic-viewer";
import { fmtDate, one } from "@/components/ui-bits";
import { requireOrg } from "@/lib/auth";
import { canWriteMaintenance, levelAtLeast, type PermLevel } from "@/lib/permissions";

export const metadata = { title: "Schematic viewer" };

export default async function ViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const { page } = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const s = await requireOrg();

  // Server-side authorization: no level => the schematic does not exist for this user.
  const { data: levelData } = await s.supabase.rpc("schematic_level", { p_schematic: id });
  const level = levelData as PermLevel | null;
  if (!level) notFound();

  const { data: sc } = await s.supabase
    .from("schematics")
    .select("id, title, document_number, revision, created_at, machine_id, machine:machines(name), uploader:profiles!schematics_uploaded_by_fkey(display_name)")
    .eq("id", id)
    .eq("org_id", s.orgId)
    .maybeSingle();
  if (!sc) notFound();

  const canManage = levelAtLeast(level, "manage");
  const [members, groups] = canManage
    ? await Promise.all([
        s.supabase.from("organization_memberships").select("user_id, profile:profiles(display_name)").eq("org_id", s.orgId),
        s.supabase.from("groups").select("id, name").eq("org_id", s.orgId).order("name"),
      ])
    : [{ data: [] }, { data: [] }];

  return (
    <div className="h-full">
      <SchematicViewer
        schematicId={id}
        machineId={sc.machine_id}
        title={sc.title}
        level={level}
        userId={s.user.id}
        initialPage={Math.max(1, Number.parseInt(page ?? "1", 10) || 1)}
        canReport={canWriteMaintenance(s.role) && levelAtLeast(level, "comment")}
        meta={{
          documentNumber: sc.document_number,
          revision: sc.revision,
          machineName: one(sc.machine)?.name ?? "",
          uploader: one(sc.uploader)?.display_name ?? "",
          uploadedAt: fmtDate(sc.created_at, true),
        }}
        members={(members.data ?? []).map((m) => ({ user_id: m.user_id as string, name: one(m.profile as { display_name: string } | { display_name: string }[] | null)?.display_name ?? "Unknown" }))}
        groups={(groups.data ?? []).map((g) => ({ id: g.id as string, name: g.name as string }))}
      />
    </div>
  );
}
