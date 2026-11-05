/**
 * Per-organization limits on which ROLE may use each annotation tool, export, and create share links.
 * Stored as organizations.tool_limits = { "<key>": "<minimum role>" } (only overrides; anything absent uses the default).
 * Mirrors the SQL function tool_allowed() (the database is the enforcement point for annotation tools and share links;
 * "export" is a convenience control: anyone who can view a drawing can already download the original PDF).
 */
import type { OrgRole } from "./permissions";

export const LIMIT_KEYS = ["point", "comment", "box", "callout", "pen", "arrow", "highlight", "export", "share"] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type ToolLimits = Partial<Record<LimitKey, OrgRole>>;

export const LIMIT_LABEL: Record<LimitKey, string> = {
  point: "Point marker",
  comment: "Text comment",
  box: "Issue box",
  callout: "Quote / callout",
  pen: "Pen",
  arrow: "Arrow",
  highlight: "Highlighter",
  export: "Export PDF (with notes)",
  share: "Create share links",
};

/** Lowest role that may use each key when the organization has not changed it. */
export const DEFAULT_MIN: Record<LimitKey, OrgRole> = {
  point: "technician",
  comment: "technician",
  box: "technician",
  callout: "technician",
  pen: "technician",
  arrow: "technician",
  highlight: "technician",
  export: "viewer",
  share: "maintenance_manager",
};

const RANK: Record<OrgRole, number> = { viewer: 1, technician: 2, maintenance_manager: 3, admin: 4 };
export const roleRank = (r: OrgRole | null | undefined): number => (r ? RANK[r] : 0);

export const isLimitKey = (k: string): k is LimitKey => (LIMIT_KEYS as readonly string[]).includes(k);

/** The role floor for `key`, honouring the organization's override when it is a valid role. */
export function minRoleFor(key: LimitKey, limits: ToolLimits | null | undefined): OrgRole {
  const v = limits?.[key];
  return v && v in RANK ? v : DEFAULT_MIN[key];
}

export function toolAllowed(role: OrgRole | null | undefined, key: LimitKey, limits: ToolLimits | null | undefined): boolean {
  return roleRank(role) >= roleRank(minRoleFor(key, limits));
}

/** Keep only well-formed overrides that actually differ from the default (what gets stored). */
export function normalizeLimits(input: Record<string, unknown>): ToolLimits {
  const out: ToolLimits = {};
  for (const [k, v] of Object.entries(input)) {
    if (!isLimitKey(k) || typeof v !== "string" || !(v in RANK)) continue;
    if (v !== DEFAULT_MIN[k]) out[k] = v as OrgRole;
  }
  return out;
}
