"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Start work / resolve (with required resolution note) for an issue. The server enforces who may do this. */
export function IssueActions({ issueId, status }: { issueId: string; status: string }) {
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
      <div className="flex flex-wrap gap-2">
        {status === "open" && <Button size="sm" variant="outline" onClick={() => patch({ status: "in_progress" })}>Start work</Button>}
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
