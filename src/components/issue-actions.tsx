"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { selectClass } from "@/components/ui-bits";
import { PRIORITY_LABEL, REPAIR_PRIORITIES, STATUS_LABEL, WORKING_STATUSES } from "@/lib/priority";
import { cn } from "@/lib/utils";

/**
 * Change an issue's status (Open / In progress) and priority of repair, or resolve it (with a required note).
 * The server enforces who may do this; every change is also written to the maintenance log.
 */
export function IssueActions({ issueId, status, priority }: { issueId: string; status: string; priority?: string | null }) {
  const router = useRouter();
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function patch(payload: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/issues/${issueId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      return setError(b?.error?.message ?? "Update failed.");
    }
    setResolving(false);
    router.refresh();
  }

  return (
    <div className="space-y-2 pt-1">
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-0.5 text-xs text-muted-foreground">
          Status
          <select className={cn(selectClass, "w-36")} value={status} onChange={(e) => patch({ status: e.target.value })} data-testid={`issue-status-${issueId}`}>
            {WORKING_STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
          </select>
        </label>
        <label className="space-y-0.5 text-xs text-muted-foreground">
          Priority of repair
          <select className={cn(selectClass, "w-36")} value={priority ?? "normal"} onChange={(e) => patch({ repair_priority: e.target.value })} data-testid={`issue-priority-${issueId}`}>
            {REPAIR_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </label>
        {!resolving && <Button size="sm" variant="outline" onClick={() => setResolving(true)}>Resolve…</Button>}
      </div>
      {resolving && (
        <div className="flex gap-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Resolution note (required)" aria-label="Resolution note" />
          <Button size="sm" disabled={!note.trim()} onClick={() => patch({ status: "resolved", resolution_note: note })}>Mark resolved</Button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
