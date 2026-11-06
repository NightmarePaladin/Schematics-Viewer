/** Priority of repair for maintenance issues (migration 20261106000001). Not the same as severity: severity is how bad the fault is. */
export const REPAIR_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type RepairPriority = (typeof REPAIR_PRIORITIES)[number];

export const PRIORITY_LABEL: Record<RepairPriority, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };

const RANK: Record<RepairPriority, number> = { low: 1, normal: 2, high: 3, urgent: 4 };
export const priorityRank = (p: string | null | undefined): number => RANK[(p as RepairPriority) ?? "normal"] ?? RANK.normal;

/** Statuses an issue can be created with or moved between by hand (resolving needs a note, so it has its own step). */
export const WORKING_STATUSES = ["open", "in_progress"] as const;
export const STATUS_LABEL: Record<string, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved" };

/** Most urgent first, then newest first (matches the database ordering used by the dashboard and the issue list). */
export function byPriorityThenNewest<T extends { repair_priority?: string | null; created_at: string }>(a: T, b: T): number {
  return priorityRank(b.repair_priority) - priorityRank(a.repair_priority) || b.created_at.localeCompare(a.created_at);
}
