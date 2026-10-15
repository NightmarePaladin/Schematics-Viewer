import { adminClient, hasSupabaseCreds } from "../scripts/lib/seed-lib";

/**
 * Removes rows (and storage files) that the E2E specs create, so repeated runs do not pile up on the demo data.
 * Uses the service-role key, so it only runs from the test runner. Safe to call when credentials are missing.
 */
export async function cleanupE2eData() {
  if (!hasSupabaseCreds()) return;
  const admin = adminClient();

  // issues + their auto-generated log entries
  const { data: issues } = await admin.from("maintenance_issues").select("id").ilike("title", "Coil overheating %");
  const issueIds = (issues ?? []).map((i) => i.id);
  if (issueIds.length) await admin.from("maintenance_logs").delete().in("issue_id", issueIds);
  await admin.from("maintenance_logs").delete().ilike("body", 'Issue "Coil overheating %');
  if (issueIds.length) await admin.from("maintenance_issues").delete().in("id", issueIds);

  // annotations created by viewer-flows / annotation-flow
  for (const pattern of ["Box %: coil overheating", "Callout %: verify 24 VDC", "E2E pinned note%"]) {
    await admin.from("annotations").delete().ilike("body", pattern);
  }

  // machines created by annotation-flow (+ their schematic files)
  const { data: machines } = await admin.from("machines").select("id").ilike("serial_number", "E2E-%");
  const machineIds = (machines ?? []).map((m) => m.id);
  if (machineIds.length) {
    const { data: schematics } = await admin.from("schematics").select("storage_path").in("machine_id", machineIds);
    const paths = (schematics ?? []).map((s) => s.storage_path);
    if (paths.length) await admin.storage.from("schematics").remove(paths);
    await admin.from("machines").delete().in("id", machineIds);
  }
}
