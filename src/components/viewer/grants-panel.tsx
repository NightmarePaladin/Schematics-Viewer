"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { selectClass } from "@/components/ui-bits";
import { PERM_LEVELS } from "@/lib/permissions";
import { api } from "./types";

interface Grant {
  id: string;
  user_id: string | null;
  group_id: string | null;
  level: string;
  group: { name: string } | { name: string }[] | null;
}

/** Access grants UI. The API only responds to users with Manage on the schematic (or admin roles). */
export function GrantsPanel({
  schematicId,
  members,
  groups,
}: {
  schematicId: string;
  members: { user_id: string; name: string }[];
  groups: { id: string; name: string }[];
}) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"user" | "group">("group");
  const [grantee, setGrantee] = useState("");
  const [level, setLevel] = useState("view");

  const load = useCallback(async () => {
    try {
      setGrants((await api<{ data: Grant[] }>(`/api/schematics/${schematicId}/grants`)).data);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [schematicId]);
  useEffect(() => { void load(); }, [load]);

  const nameOf = (g: Grant) => {
    if (g.user_id) return members.find((m) => m.user_id === g.user_id)?.name ?? "User";
    const grp = Array.isArray(g.group) ? g.group[0] : g.group;
    return `Group: ${grp?.name ?? g.group_id}`;
  };

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/api/schematics/${schematicId}/grants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "user" ? { user_id: grantee, level } : { group_id: grantee, level }),
      });
      toast.success("Access updated");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function revoke(id: string) {
    try {
      await api(`/api/schematics/${schematicId}/grants?grant_id=${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const options = kind === "user" ? members.map((m) => ({ id: m.user_id, name: m.name })) : groups;

  return (
    <div className="space-y-4 p-3 text-sm" data-testid="grants-panel">
      <p className="text-xs text-muted-foreground">
        Schematics are private by default. Grant View, Comment, Edit or Manage to individuals or groups. Viewer-role members never exceed View.
      </p>
      <ul className="divide-y rounded-lg border">
        {grants.map((g) => (
          <li key={g.id} className="flex items-center justify-between gap-2 p-2">
            <span className="min-w-0 truncate">{nameOf(g)}</span>
            <span className="flex items-center gap-2">
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs capitalize">{g.level}</span>
              <Button size="xs" variant="ghost" onClick={() => revoke(g.id)} aria-label={`Revoke ${nameOf(g)}`}>Revoke</Button>
            </span>
          </li>
        ))}
        {grants.length === 0 && <li className="p-3 text-muted-foreground">No grants.</li>}
      </ul>
      <form onSubmit={add} className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <select value={kind} onChange={(e) => { setKind(e.target.value as "user" | "group"); setGrantee(""); }} className={selectClass} aria-label="Grant to">
            <option value="group">A group</option><option value="user">A person</option>
          </select>
          <select value={level} onChange={(e) => setLevel(e.target.value)} className={selectClass} aria-label="Permission level">
            {PERM_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <select value={grantee} onChange={(e) => setGrantee(e.target.value)} required className={selectClass} aria-label="Grantee">
          <option value="" disabled>Choose {kind === "user" ? "person" : "group"}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <Button type="submit" size="sm">Save grant</Button>
      </form>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
