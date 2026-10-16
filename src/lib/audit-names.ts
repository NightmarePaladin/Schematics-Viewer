import type { SupabaseClient } from "@supabase/supabase-js";
import { noNames, type AuditEvent, type AuditNames } from "./audit";

const TYPES = new Set(["grant", "membership", "group_member"]);
const id = (v: unknown) => (typeof v === "string" && v ? v : null);

/**
 * Names for the people, groups and schematics referenced by access-related entries that were recorded BEFORE the log started
 * snapshotting names. Newer entries carry their own names and need no lookup. Ids that no longer exist are simply absent
 * (the formatter then says "a deleted user / group / schematic"). Reads go through RLS as the signed-in admin.
 */
export async function loadAuditNames(supabase: SupabaseClient, events: AuditEvent[]): Promise<AuditNames> {
  const names = noNames();
  const users = new Set<string>();
  const groups = new Set<string>();
  const schematics = new Set<string>();
  for (const e of events) {
    if (!TYPES.has(e.entity_type)) continue;
    const m = e.metadata ?? {};
    if (!m.grantee && !m.member) {
      if (id(m.user_id)) users.add(id(m.user_id)!);
      if (id(m.group_id)) groups.add(id(m.group_id)!);
    }
    if (e.entity_type === "grant" && !m.schematic && id(m.schematic_id)) schematics.add(id(m.schematic_id)!);
    if (e.entity_type === "group_member" && !m.group && id(m.group_id)) groups.add(id(m.group_id)!);
  }
  const [u, g, s] = await Promise.all([
    users.size ? supabase.from("profiles").select("id, display_name, email").in("id", [...users]) : { data: [] },
    groups.size ? supabase.from("groups").select("id, name").in("id", [...groups]) : { data: [] },
    schematics.size ? supabase.from("schematics").select("id, title").in("id", [...schematics]) : { data: [] },
  ]);
  for (const r of (u.data ?? []) as { id: string; display_name: string; email: string }[]) names.users.set(r.id, `${r.display_name} (${r.email})`);
  for (const r of (g.data ?? []) as { id: string; name: string }[]) names.groups.set(r.id, r.name);
  for (const r of (s.data ?? []) as { id: string; title: string }[]) names.schematics.set(r.id, r.title);
  return names;
}
