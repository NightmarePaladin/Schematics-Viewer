import "server-only";
import type { SessionContext } from "./auth";
import { ApiError, fromDbError } from "./api";

export interface InoperableSource {
  id: string;
  /** null when the caller may not view the failing machine (existence of the state is still shown). */
  name: string | null;
}

/**
 * Machines taken out of service because a critical sub-machine has an unresolved major issue (high/critical).
 * Computed live by the SQL function `inoperable_machines()`, so it clears itself when the issue is resolved.
 */
export async function loadInoperable(s: Pick<SessionContext, "supabase">, orgId: string): Promise<Map<string, InoperableSource[]>> {
  const { data, error } = await s.supabase.rpc("inoperable_machines", { p_org: orgId });
  if (error) throw fromDbError(error);
  const map = new Map<string, InoperableSource[]>();
  for (const r of (data ?? []) as { machine_id: string; source_id: string; source_name: string | null }[]) {
    const list = map.get(r.machine_id) ?? [];
    list.push({ id: r.source_id, name: r.source_name });
    map.set(r.machine_id, list);
  }
  return map;
}

/** Ids of critical machines whose unresolved major issue is currently taking a parent out of service. */
export function causeIds(inop: Map<string, InoperableSource[]>): Set<string> {
  const out = new Set<string>();
  for (const sources of inop.values()) for (const s of sources) out.add(s.id);
  return out;
}

export const effectiveStatus = (stored: string, inherited: boolean) => (inherited ? "inoperable" : stored);

/** The parent must be a machine the caller can see in the same organization (the DB also enforces same-org + no cycles). */
export async function assertParentVisible(s: Pick<SessionContext, "supabase">, orgId: string, parentId: string | null | undefined) {
  if (!parentId) return;
  const { data, error } = await s.supabase.from("machines").select("id").eq("id", parentId).eq("org_id", orgId).maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw new ApiError(422, "invalid_parent", "The parent machine does not exist or you cannot access it.");
}
