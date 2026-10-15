/** Presentation + query helpers for the audit log (events themselves are written by database triggers). */

export interface AuditEvent {
  id: number;
  created_at: string;
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
}

export const ENTITY_LABELS: Record<string, string> = {
  machine: "Machine",
  location: "Location",
  schematic: "Schematic",
  grant: "Access grant",
  annotation: "Annotation",
  reply: "Reply",
  issue: "Issue",
  log: "Maintenance log",
  membership: "Member",
  group: "Group",
  group_member: "Group member",
  organization: "Organization",
};

export const ENTITY_TYPES = Object.keys(ENTITY_LABELS);

const VERBS: Record<string, string> = { created: "Created", updated: "Updated", deleted: "Deleted", viewed: "Viewed" };

const humanize = (s: string) => s.replace(/[._]/g, " ").trim();

/** The part after the last dot, e.g. "machine.updated" -> "updated". */
export const actionVerb = (action: string): string => action.split(".").pop() ?? action;

type Changes = Record<string, { from?: string; to?: string }>;

export function changesOf(e: Pick<AuditEvent, "metadata">): Changes {
  const c = e.metadata?.changes;
  return c && typeof c === "object" ? (c as Changes) : {};
}

/** One-line description of what was done, and the details of what changed. */
export function describeEvent(e: AuditEvent): { title: string; detail: string } {
  const noun = (ENTITY_LABELS[e.entity_type] ?? humanize(e.entity_type)).toLowerCase();
  const verb = VERBS[actionVerb(e.action)];
  const label = typeof e.metadata?.label === "string" ? e.metadata.label : null;
  // events recorded before the trigger-based log used names like "machine.create"; show them plainly
  const title = verb ? `${verb} ${noun}${label ? ` “${label}”` : ""}` : `${humanize(e.action)}${label ? ` “${label}”` : ""}`;

  const parts: string[] = [];
  for (const [key, ch] of Object.entries(changesOf(e))) parts.push(`${humanize(key)}: ${ch.from ?? "—"} → ${ch.to ?? "—"}`);
  if (!parts.length) {
    const m = e.metadata ?? {};
    for (const key of ["role", "level", "severity", "status", "entry_type", "page_number"] as const) {
      if (m[key] !== undefined) parts.push(`${humanize(key)}: ${String(m[key])}`);
    }
  }
  return { title, detail: parts.join("; ") };
}

/** In-app page for the thing an event is about, when one still makes sense. */
export function eventLink(e: AuditEvent): string | null {
  if (actionVerb(e.action) === "deleted") return null;
  const m = e.metadata ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  switch (e.entity_type) {
    case "machine":
      return e.entity_id ? `/machines/${e.entity_id}` : null;
    case "schematic":
      return e.entity_id ? `/schematics/${e.entity_id}` : null;
    case "annotation":
      return str(m.schematic_id) ? `/schematics/${m.schematic_id}${m.page_number ? `?page=${m.page_number}` : ""}` : null;
    case "issue":
    case "log":
      return str(m.machine_id) ? `/machines/${m.machine_id}` : null;
    case "location":
      return "/locations";
    default:
      return null;
  }
}

// ───────────── filtering (shared by the page and the CSV export) ─────────────

export interface AuditFilters {
  entity?: string;
  actor?: string;
  q?: string;
  /** YYYY-MM-DD, interpreted as UTC */
  from?: string;
  to?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sanitizeFilters(raw: Record<string, string | undefined>): AuditFilters {
  return {
    entity: raw.entity && ENTITY_TYPES.includes(raw.entity) ? raw.entity : undefined,
    actor: raw.actor && UUID.test(raw.actor) ? raw.actor : undefined,
    q: raw.q?.replace(/[%,()\\*_"']/g, " ").trim().slice(0, 100) || undefined,
    from: raw.from && DATE.test(raw.from) ? raw.from : undefined,
    to: raw.to && DATE.test(raw.to) ? raw.to : undefined,
  };
}

interface Filterable<Q> {
  eq(column: string, value: string): Q;
  gte(column: string, value: string): Q;
  lte(column: string, value: string): Q;
  or(filters: string): Q;
}

export function applyAuditFilters<Q extends Filterable<Q>>(query: Q, f: AuditFilters): Q {
  let out = query;
  if (f.entity) out = out.eq("entity_type", f.entity);
  if (f.actor) out = out.eq("actor_id", f.actor);
  if (f.from) out = out.gte("created_at", `${f.from}T00:00:00.000Z`);
  if (f.to) out = out.lte("created_at", `${f.to}T23:59:59.999Z`);
  if (f.q) out = out.or(["action", "actor_label", "metadata->>label"].map((c) => `${c}.ilike.%${f.q}%`).join(","));
  return out;
}

// ───────────── CSV ─────────────

/** Escape one CSV cell, and neutralize spreadsheet formulas (=, +, -, @) so an exported log cannot run code when opened. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function auditToCsv(events: AuditEvent[]): string {
  const header = ["time_utc", "actor", "action", "entity_type", "entity_id", "description", "details", "metadata_json"];
  const lines = [header.join(",")];
  for (const e of events) {
    const d = describeEvent(e);
    lines.push(
      [e.created_at, e.actor_label ?? "", e.action, e.entity_type, e.entity_id ?? "", d.title, d.detail, JSON.stringify(e.metadata ?? {})]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
