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

/** Names for ids, used only for entries recorded before the log captured names at the time of the event. */
export interface AuditNames {
  users: Map<string, string>;
  groups: Map<string, string>;
  schematics: Map<string, string>;
}
export const noNames = (): AuditNames => ({ users: new Map(), groups: new Map(), schematics: new Map() });

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Who an access-related entry is about: the recorded name, else a live lookup, else "a deleted ...". */
function personOrGroup(m: Record<string, unknown>, names: AuditNames): { label: string; kind: "person" | "group" } {
  const groupId = str(m.group_id);
  if (groupId || m.grantee_kind === "group") {
    const label = str(m.grantee) ?? (groupId ? names.groups.get(groupId) : null) ?? "a deleted group";
    return { label, kind: "group" };
  }
  const userId = str(m.user_id);
  return { label: str(m.grantee) ?? (userId ? names.users.get(userId) : null) ?? "a deleted user", kind: "person" };
}
const memberOf = (m: Record<string, unknown>, names: AuditNames): string => {
  const id = str(m.user_id);
  return str(m.member) ?? (id ? names.users.get(id) : null) ?? "a deleted user";
};
const schematicOf = (m: Record<string, unknown>, names: AuditNames): string | null => {
  const id = str(m.schematic_id);
  return str(m.schematic) ?? (id ? (names.schematics.get(id) ?? "a deleted schematic") : null);
};

type Changes = Record<string, { from?: string; to?: string }>;

export function changesOf(e: Pick<AuditEvent, "metadata">): Changes {
  const c = e.metadata?.changes;
  return c && typeof c === "object" ? (c as Changes) : {};
}

/** One-line description of what was done, and the details of what changed. */
export function describeEvent(e: AuditEvent, names: AuditNames = noNames()): { title: string; detail: string } {
  const m = e.metadata ?? {};
  const verbWord = actionVerb(e.action);
  const changes = Object.entries(changesOf(e)).map(([key, ch]) => `${humanize(key)}: ${ch.from ?? "—"} → ${ch.to ?? "—"}`);

  // access changes say WHO gained or lost access and to WHAT
  if (e.entity_type === "grant" && ["created", "updated", "deleted"].includes(verbWord)) {
    const who = personOrGroup(m, names);
    const subject = who.kind === "group" ? `${who.label} (group)` : who.label;
    const level = str(m.level);
    const sch = schematicOf(m, names);
    const title =
      verbWord === "created" ? `Gave ${subject}${level ? ` ${cap(level)}` : ""} access`
      : verbWord === "deleted" ? `Took away ${level ? `${cap(level)} ` : ""}access from ${subject}`
      : `Changed access for ${subject}`;
    return { title, detail: [sch ? `on “${sch}”` : null, ...changes].filter(Boolean).join("; ") };
  }
  if (e.entity_type === "membership" && ["created", "updated", "deleted"].includes(verbWord)) {
    const who = memberOf(m, names);
    const role = str(m.role);
    const title =
      verbWord === "created" ? `Added ${who} to the organization${role ? ` as ${humanize(role)}` : ""}`
      : verbWord === "deleted" ? `Removed ${who} from the organization${role ? ` (was ${humanize(role)})` : ""}`
      : `Changed the role of ${who}`;
    return { title, detail: changes.join("; ") };
  }
  if (e.entity_type === "group_member" && ["created", "deleted"].includes(verbWord)) {
    const who = memberOf(m, names);
    const gid = str(m.group_id);
    const group = str(m.group) ?? (gid ? (names.groups.get(gid) ?? "a deleted group") : "a group");
    return { title: verbWord === "created" ? `Added ${who} to group “${group}”` : `Removed ${who} from group “${group}”`, detail: "" };
  }

  const noun = (ENTITY_LABELS[e.entity_type] ?? humanize(e.entity_type)).toLowerCase();
  const verb = VERBS[verbWord];
  const label = typeof m.label === "string" ? m.label : null;
  // events recorded before the trigger-based log used names like "machine.create"; show them plainly
  const title = verb ? `${verb} ${noun}${label ? ` “${label}”` : ""}` : `${humanize(e.action)}${label ? ` “${label}”` : ""}`;

  const parts: string[] = [...changes];
  if (!parts.length) {
    for (const key of ["role", "level", "severity", "status", "entry_type", "page_number"] as const) {
      if (m[key] !== undefined) parts.push(`${humanize(key)}: ${String(m[key])}`);
    }
  }
  return { title, detail: parts.join("; ") };
}

/** In-app page for the thing an event is about, when one still makes sense. */
export function eventLink(e: AuditEvent, names?: AuditNames): string | null {
  const m = e.metadata ?? {};
  // an access entry points at the drawing it was about, even after the grant itself is gone
  if (e.entity_type === "grant") {
    const sid = str(m.schematic_id);
    if (!sid) return null;
    if (names && !str(m.schematic) && !names.schematics.has(sid)) return null; // the schematic no longer exists
    return `/schematics/${sid}`;
  }
  if (actionVerb(e.action) === "deleted") return null;
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
  if (f.q) out = out.or(["action", "actor_label", "metadata->>label", "metadata->>grantee", "metadata->>member", "metadata->>schematic", "metadata->>group"].map((c) => `${c}.ilike.%${f.q}%`).join(","));
  return out;
}

// ───────────── CSV ─────────────

/** Escape one CSV cell, and neutralize spreadsheet formulas (=, +, -, @) so an exported log cannot run code when opened. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function auditToCsv(events: AuditEvent[], names: AuditNames = noNames()): string {
  const header = ["time_utc", "actor", "action", "entity_type", "entity_id", "description", "details", "metadata_json"];
  const lines = [header.join(",")];
  for (const e of events) {
    const d = describeEvent(e, names);
    lines.push(
      [e.created_at, e.actor_label ?? "", e.action, e.entity_type, e.entity_id ?? "", d.title, d.detail, JSON.stringify(e.metadata ?? {})]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
