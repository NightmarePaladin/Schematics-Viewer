"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { selectClass } from "@/components/ui-bits";
import { ORG_ROLES, type OrgRole } from "@/lib/permissions";
import { DEFAULT_MIN, LIMIT_KEYS, LIMIT_LABEL, minRoleFor, type LimitKey, type ToolLimits } from "@/lib/tool-limits";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<OrgRole, string> = { viewer: "Viewer and up", technician: "Technician and up", maintenance_manager: "Maintenance manager and up", admin: "Admins only" };
// Viewers can never annotate (their access is capped at View), so they are not offered for annotation tools or sharing.
const OFFER = (key: LimitKey): OrgRole[] => (key === "export" ? [...ORG_ROLES].reverse() : [...ORG_ROLES].reverse().filter((r) => r !== "viewer"));

/** Settings card: which role may use each annotation tool, export, and create share links. Admins edit; everyone else reads. */
export function ToolLimitsCard({ initial, canEdit }: { initial: ToolLimits; canEdit: boolean }) {
  const [values, setValues] = useState<Record<LimitKey, OrgRole>>(() => Object.fromEntries(LIMIT_KEYS.map((k) => [k, minRoleFor(k, initial)])) as Record<LimitKey, OrgRole>);
  const [busy, setBusy] = useState(false);
  const dirty = LIMIT_KEYS.some((k) => values[k] !== minRoleFor(k, initial));

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/organizations/tool-limits", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limits: values }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not save.");
      toast.success("Tool permissions saved");
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="space-y-3" data-testid="tool-limits">
      <p className="text-sm text-muted-foreground">
        Choose the lowest role that may use each tool. This stacks on top of a person&apos;s access to the drawing: someone still needs Comment
        access to annotate. Annotation tools and share links are enforced by the database; <em>Export</em> is a convenience control (anyone who can
        view a drawing can already download the original file).
      </p>
      <ul className="divide-y rounded-lg border">
        {LIMIT_KEYS.map((k) => (
          <li key={k} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <label htmlFor={`limit-${k}`} className="min-w-0 flex-1">
              {LIMIT_LABEL[k]}
              {values[k] !== DEFAULT_MIN[k] && <span className="ml-2 rounded bg-amber-500/20 px-1.5 text-xs">changed</span>}
            </label>
            <select id={`limit-${k}`} disabled={!canEdit || busy} value={values[k]} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value as OrgRole }))} className={cn(selectClass, "w-56 max-w-[55%] shrink-0")}>
              {OFFER(k).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </li>
        ))}
      </ul>
      {canEdit ? (
        <div className="flex gap-2">
          <Button onClick={save} disabled={!dirty || busy} data-testid="save-tool-limits">{busy ? "Saving…" : "Save permissions"}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => setValues(Object.fromEntries(LIMIT_KEYS.map((k) => [k, DEFAULT_MIN[k]])) as Record<LimitKey, OrgRole>)}>Reset to defaults</Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Only an organization admin can change these.</p>
      )}
    </div>
  );
}
