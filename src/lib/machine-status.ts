/**
 * Effective machine status. The stored `status` is what a person set; the effective status also reflects live faults:
 *   critical    - the machine itself has an unresolved issue of severity "critical"
 *   inoperable  - inherited: a critical sub-component of it has an unresolved high/critical issue (see inoperable_machines())
 * Both are derived on every read and never stored, so they clear the moment the issue is resolved.
 * Precedence: critical > inoperable > stored status. A retired machine stays retired.
 */
import { MACHINE_STATUSES } from "./schemas";

export interface FaultFlags {
  critical: boolean;
  inherited: boolean;
}

export const FAULT_STATUSES = ["critical", "inoperable"] as const;
/** What the status filter offers: the stored statuses plus the two derived ones. */
export const STATUS_FILTERS = [...MACHINE_STATUSES, ...FAULT_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export function deriveStatus(stored: string, f: FaultFlags): string {
  if (stored === "retired") return stored;
  if (f.critical) return "critical";
  if (f.inherited) return "inoperable";
  return stored;
}

export const isFaultStatus = (status: string): boolean => (FAULT_STATUSES as readonly string[]).includes(status);

export const isStatusFilter = (v: unknown): v is StatusFilter => typeof v === "string" && (STATUS_FILTERS as readonly string[]).includes(v);

/** Human label for a (possibly derived) status. */
export function statusLabel(status: string): string {
  if (status === "critical") return "critical fault";
  if (status === "inoperable") return "inoperable (inherited)";
  return status.replace("_", " ");
}
