/**
 * Seeding + test-fixture helpers. Uses the SERVICE-ROLE key, so this file must only ever run
 * from the command line / test runner — never from the web app.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

export const ENV = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  service: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  password: process.env.SEED_PASSWORD ?? "Demo-Pass-123!",
};

export const hasSupabaseCreds = () => Boolean(ENV.url && ENV.anon && ENV.service);

export function adminClient(): SupabaseClient {
  return createClient(ENV.url, ENV.service, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** A client that acts as a real signed-in user (anon key + that user's JWT), i.e. subject to RLS. */
export async function userClient(email: string): Promise<SupabaseClient> {
  const c = createClient(ENV.url, ENV.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: ENV.password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return c;
}

export const USERS = {
  admin: { email: "admin@schematichub.test", name: "Ada Admin" },
  manager: { email: "manager@schematichub.test", name: "Max Manager" },
  tech: { email: "tech@schematichub.test", name: "Tara Technician" },
  tech2: { email: "tech2@schematichub.test", name: "Theo Technician" },
  viewer: { email: "viewer@schematichub.test", name: "Vera Viewer" },
  outsider: { email: "outsider@othercorp.test", name: "Olga Outsider" },
} as const;
export type UserKey = keyof typeof USERS;

async function ensureUser(admin: SupabaseClient, email: string, name: string): Promise<string> {
  const { data: found } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (found) {
    await admin.auth.admin.updateUserById(found.id, { password: ENV.password, email_confirm: true });
    return found.id;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: ENV.password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error || !data.user) throw new Error(`Could not create ${email}: ${error?.message}`);
  return data.user.id;
}

export interface SeedResult {
  ids: Record<UserKey, string>;
  orgId: string;
  otherOrgId: string;
  groupId: string;
  machines: { press: string; compressor: string; tower: string };
  otherMachineId: string;
  schematicId: string;
  privateSchematicId: string;
}

async function ensureOrg(admin: SupabaseClient, name: string, createdBy: string): Promise<string> {
  const { data } = await admin.from("organizations").select("id").eq("name", name).maybeSingle();
  if (data) return data.id;
  const { data: org, error } = await admin.from("organizations").insert({ name, created_by: createdBy }).select("id").single();
  if (error) throw error;
  return org.id;
}

async function ensureMember(admin: SupabaseClient, orgId: string, userId: string, role: string) {
  const { error } = await admin.from("organization_memberships").upsert({ org_id: orgId, user_id: userId, role }, { onConflict: "org_id,user_id" });
  if (error) throw error;
}

async function ensureMachine(admin: SupabaseClient, row: Record<string, unknown>): Promise<string> {
  const { data: found } = await admin.from("machines").select("id").eq("org_id", row.org_id as string).ilike("manufacturer", row.manufacturer as string).ilike("serial_number", row.serial_number as string).maybeSingle();
  if (found) return found.id;
  const { data, error } = await admin.from("machines").insert(row).select("id").single();
  if (error) throw error;
  return data.id;
}

async function ensureSchematic(admin: SupabaseClient, orgId: string, machineId: string, uploadedBy: string, title: string, docNo: string, pdf: Buffer): Promise<string> {
  const { data: found } = await admin.from("schematics").select("id").eq("machine_id", machineId).eq("document_number", docNo).eq("revision", "A").maybeSingle();
  if (found) return found.id;
  const id = crypto.randomUUID();
  const storage_path = `${orgId}/${id}.pdf`;
  const up = await admin.storage.from("schematics").upload(storage_path, pdf, { contentType: "application/pdf" });
  if (up.error) throw up.error;
  const { error } = await admin.from("schematics").insert({
    id, org_id: orgId, machine_id: machineId, title, document_number: docNo, revision: "A",
    storage_path, file_size: pdf.length, uploaded_by: uploadedBy,
  });
  if (error) throw error;
  return id;
}

export async function seed(): Promise<SeedResult> {
  if (!hasSupabaseCreds()) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  const admin = adminClient();
  const ids = {} as Record<UserKey, string>;
  for (const k of Object.keys(USERS) as UserKey[]) ids[k] = await ensureUser(admin, USERS[k].email, USERS[k].name);

  const orgId = await ensureOrg(admin, "Acme Industrial (demo)", ids.admin);
  const otherOrgId = await ensureOrg(admin, "Other Corp (demo)", ids.outsider);
  await ensureMember(admin, orgId, ids.admin, "admin");
  await ensureMember(admin, orgId, ids.manager, "maintenance_manager");
  await ensureMember(admin, orgId, ids.tech, "technician");
  await ensureMember(admin, orgId, ids.tech2, "technician");
  await ensureMember(admin, orgId, ids.viewer, "viewer");
  await ensureMember(admin, otherOrgId, ids.outsider, "admin");

  const { data: g } = await admin.from("groups").select("id").eq("org_id", orgId).ilike("name", "Hydraulics Crew").maybeSingle();
  let groupId = g?.id as string | undefined;
  if (!groupId) {
    const { data, error } = await admin.from("groups").insert({ org_id: orgId, name: "Hydraulics Crew", description: "Maintains hydraulic power units", created_by: ids.admin }).select("id").single();
    if (error) throw error;
    groupId = data.id;
  }
  await admin.from("group_memberships").upsert({ group_id: groupId, user_id: ids.tech2, org_id: orgId }, { onConflict: "group_id,user_id" });

  const common = { org_id: orgId, created_by: ids.admin };
  const machines = {
    press: await ensureMachine(admin, { ...common, name: "Hydraulic Press 7", category: "Press", manufacturer: "Forgeworks", model_number: "HP-450", serial_number: "FW-10042", asset_number: "A-0007", location: "Plant 1 / Bay 3", status: "operational", description: "450-ton indoor forming press." }),
    compressor: await ensureMachine(admin, { ...common, name: "Outdoor Compressor C2", category: "Compressor", manufacturer: "AirMaster", model_number: "AM-220", serial_number: "AM-77310", location: "Yard North", latitude: 41.8781, longitude: -87.6298, installed_on: "2021-05-14", status: "degraded", description: "Rooftop screw compressor exposed to weather." }),
    tower: await ensureMachine(admin, { ...common, name: "Cooling Tower CT-1", category: "Cooling", manufacturer: "AirMaster", model_number: "CT-900", serial_number: "CT-00031", location: "Plant 1 roof", latitude: 41.8827, longitude: -87.6233, status: "operational" }),
  };
  const otherMachineId = await ensureMachine(admin, { org_id: otherOrgId, created_by: ids.outsider, name: "Other Corp Boiler", category: "Boiler", manufacturer: "AirMaster", model_number: "B-1", serial_number: "AM-77310", status: "operational" });

  const pdf = await readFile(path.join(process.cwd(), "samples", "demo-hydraulic-schematic.pdf"));
  const schematicId = await ensureSchematic(admin, orgId, machines.press, ids.tech, "Hydraulic Power Unit (demo)", "DEMO-1042", pdf);
  const privateSchematicId = await ensureSchematic(admin, orgId, machines.compressor, ids.admin, "Compressor control wiring (private)", "DEMO-2201", pdf);

  // Access: group can edit, viewer can view (and is capped at view even if granted more)
  const grants: { col: "user_id" | "group_id"; val: string; level: string }[] = [
    { col: "group_id", val: groupId!, level: "edit" },
    { col: "user_id", val: ids.viewer, level: "view" },
  ];
  for (const g of grants) {
    const { data: ex } = await admin.from("schematic_access_grants").select("id").eq("schematic_id", schematicId).eq(g.col, g.val).maybeSingle();
    if (!ex) await admin.from("schematic_access_grants").insert({ org_id: orgId, schematic_id: schematicId, [g.col]: g.val, level: g.level, granted_by: ids.admin });
  }

  // Sample annotation + issue + logs (only once)
  const { count } = await admin.from("annotations").select("id", { count: "exact", head: true }).eq("schematic_id", schematicId);
  if (!count) {
    const { data: ann } = await admin.from("annotations").insert({
      org_id: orgId, schematic_id: schematicId, page_number: 1, type: "box", x: 0.42, y: 0.15, width: 0.17, height: 0.12,
      body: "Relief valve chattering above 190 bar", status: "open", author_id: ids.tech,
    }).select("id").single();
    if (ann) {
      await admin.from("annotation_replies").insert({ org_id: orgId, annotation_id: ann.id, body: "Checked spring preload; looks low.", author_id: ids.tech2 });
      await admin.from("maintenance_issues").insert({
        org_id: orgId, machine_id: machines.press, schematic_id: schematicId, annotation_id: ann.id, page_number: 1,
        title: "Relief valve V1 chatter", description: "Audible chatter above 190 bar.", severity: "high", reporter_id: ids.tech, assignee_id: ids.tech2,
      });
    }
    await admin.from("maintenance_logs").insert([
      { org_id: orgId, machine_id: machines.press, entry_type: "inspection", body: "Quarterly inspection complete. Oil level nominal.", performed_by: ids.tech },
      { org_id: orgId, machine_id: machines.compressor, entry_type: "repair", body: "Replaced intake filter after dust ingress.", performed_by: ids.manager },
    ]);
  }

  return { ids, orgId, otherOrgId, groupId: groupId!, machines, otherMachineId, schematicId, privateSchematicId };
}
