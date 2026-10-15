/**
 * Authorization model (mirrors the SQL functions in supabase/migrations).
 * The SQL functions are the source of truth for RLS; this module is used by
 * Route Handlers to return precise 403s and by unit tests.
 */

export const ORG_ROLES = ["admin", "maintenance_manager", "technician", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PERM_LEVELS = ["view", "comment", "edit", "manage"] as const;
export type PermLevel = (typeof PERM_LEVELS)[number];

const RANK: Record<PermLevel, number> = { view: 1, comment: 2, edit: 3, manage: 4 };

export const levelRank = (l: PermLevel | null | undefined): number => (l ? RANK[l] : 0);

export const levelAtLeast = (have: PermLevel | null | undefined, need: PermLevel): boolean =>
  levelRank(have) >= RANK[need];

export interface GrantLike {
  user_id: string | null;
  group_id: string | null;
  level: PermLevel;
}

export interface PermissionInput {
  userId: string;
  /** The user's role in the schematic's organization, or null if not a member. */
  role: OrgRole | null;
  /** Groups the user belongs to inside the schematic's organization. */
  groupIds: string[];
  /** Grants that exist on the schematic (already scoped to its organization). */
  grants: GrantLike[];
}

/**
 * Effective permission on a schematic.
 *  - Non-members of the organization get nothing (cross-org denial).
 *  - Admins and maintenance managers have implicit `manage`.
 *  - Everyone else gets the highest of their individual and group grants.
 *  - The Viewer role is capped at `view` even if a higher level was granted.
 */
export function effectiveSchematicLevel(input: PermissionInput): PermLevel | null {
  const { userId, role, groupIds, grants } = input;
  if (!role) return null;
  if (role === "admin" || role === "maintenance_manager") return "manage";

  let best: PermLevel | null = null;
  for (const g of grants) {
    const applies =
      (g.user_id !== null && g.user_id === userId) ||
      (g.group_id !== null && groupIds.includes(g.group_id));
    if (applies && levelRank(g.level) > levelRank(best)) best = g.level;
  }
  if (best && role === "viewer" && levelRank(best) > levelRank("view")) return "view";
  return best;
}

export const canManageOrg = (role: OrgRole | null): boolean => role === "admin";
export const canManageMachines = (role: OrgRole | null): boolean =>
  role === "admin" || role === "maintenance_manager";
export const canCreateMachine = (role: OrgRole | null): boolean =>
  role === "admin" || role === "maintenance_manager" || role === "technician";
export const canUploadSchematic = canCreateMachine;
export const canWriteMaintenance = canCreateMachine;
