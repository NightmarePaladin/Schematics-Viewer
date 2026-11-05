import { notFound } from "next/navigation";
import { z } from "zod";
import { SchematicViewer } from "@/components/viewer/schematic-viewer";
import { fmtDate, one } from "@/components/ui-bits";
import { requireOrgPage } from "@/lib/auth";
import { ancestorsOf } from "@/lib/machine-tree";
import { canWriteMaintenance, levelAtLeast, type PermLevel } from "@/lib/permissions";

export const metadata = { title: "Schematic viewer" };

export default async function ViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; focus?: string; from?: string; revision?: string }>;
}) {
  const { id } = await params;
  const { page, focus, from, revision } = await searchParams;
  const uuid = (v?: string) => (v && z.string().uuid().safeParse(v).success ? v : null);
  if (!z.string().uuid().safeParse(id).success) notFound();
  const s = await requireOrgPage();

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

  // Hierarchy trail (System › Sub-system › this machine); each ancestor links to its first drawing the caller can see.
  const { data: tree } = await s.supabase.from("machines").select("id, name, parent_id").eq("org_id", s.orgId);
  const ancestors = ancestorsOf(tree ?? [], sc.machine_id).reverse();
  const { data: ancestorDrawings } = ancestors.length
    ? await s.supabase.from("schematics").select("id, machine_id").in("machine_id", ancestors.map((a) => a.id)).order("created_at")
    : { data: [] as { id: string; machine_id: string }[] };
  const firstDrawing = new Map<string, string>();
  for (const d of ancestorDrawings ?? []) if (!firstDrawing.has(d.machine_id)) firstDrawing.set(d.machine_id, d.id);
  const crumbs = ancestors.map((a) => ({ label: a.name as string, href: firstDrawing.has(a.id) ? `/schematics/${firstDrawing.get(a.id)}` : `/machines/${a.id}` }));
  const fromId = uuid(from);
  const backTo = fromId && fromId !== id
    ? await s.supabase.from("schematics").select("id, title").eq("id", fromId).maybeSingle().then((r) => r.data)
    : null;

  // Where this drawing is referenced from (links placed on parent drawings), and its revision history.
  const [{ data: refs }, { data: revs }] = await Promise.all([
    s.supabase.from("annotations").select("id, page_number, schematic_id").eq("linked_schematic_id", id),
    s.supabase.from("schematic_revisions").select("id, revision, superseded_at").eq("schematic_id", id).order("superseded_at", { ascending: false }),
  ]);
  const refSchematics = refs?.length
    ? (await s.supabase.from("schematics").select("id, title").in("id", [...new Set(refs.map((r) => r.schematic_id as string))])).data ?? []
    : [];
  const referencedFrom = (refs ?? []).map((r) => ({
    annotationId: r.id as string,
    schematicId: r.schematic_id as string,
    page: r.page_number as number,
    title: refSchematics.find((x) => x.id === r.schematic_id)?.title ?? "Schematic",
  }));
  const revId = uuid(revision);
  const viewRevision = revId ? (revs ?? []).find((r) => r.id === revId) ?? null : null;

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
        focusId={uuid(focus)}
        crumbs={[...crumbs, { label: one(sc.machine)?.name ?? "This machine", href: null }]}
        backTo={backTo ? { id: backTo.id as string, title: backTo.title as string } : null}
        referencedFrom={referencedFrom}
        currentRevision={sc.revision}
        revisions={(revs ?? []).map((r) => ({ id: r.id as string, label: r.revision as string, at: fmtDate(r.superseded_at as string, true) }))}
        viewRevision={viewRevision ? { id: viewRevision.id as string, label: viewRevision.revision as string } : null}
        canRevise={levelAtLeast(level, "edit")}
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
