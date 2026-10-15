import { LocationsManager, type LocationRow } from "@/components/locations-manager";
import { Page, PageHeader } from "@/components/ui-bits";
import { requireOrgPage } from "@/lib/auth";
import { canCreateMachine, canManageMachines } from "@/lib/permissions";

export const metadata = { title: "Locations" };

export default async function LocationsPage() {
  const s = await requireOrgPage();
  const { data } = await s.supabase
    .from("locations")
    .select("id, name, description, latitude, longitude, machines(count)")
    .eq("org_id", s.orgId)
    .order("name");
  const rows: LocationRow[] = (data ?? []).map(({ machines, ...l }) => ({ ...l, machine_count: (machines as { count: number }[] | null)?.[0]?.count ?? 0 }));

  return (
    <Page className="max-w-3xl">
      <PageHeader
        title="Locations"
        description="Premade places machines can be assigned to from a dropdown. A location with coordinates gives its machines weather context automatically."
      />
      <LocationsManager locations={rows} canAdd={canCreateMachine(s.role)} canManage={canManageMachines(s.role)} />
    </Page>
  );
}
