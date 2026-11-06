"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { selectClass } from "@/components/ui-bits";
import { PRIORITY_LABEL, REPAIR_PRIORITIES, type RepairPriority } from "@/lib/priority";
import { cn } from "@/lib/utils";

const TONE: Record<RepairPriority, string> = {
  low: "text-muted-foreground",
  normal: "",
  // `!` wins over the global rule that gives every <select> a plain background (needed for readable native menus)
  high: "border-orange-500 bg-orange-500/20! font-medium text-orange-900! dark:text-orange-200!",
  urgent: "border-red-600 bg-red-600! font-semibold text-white!",
};

/**
 * Change an open job's priority of repair right where the list of jobs is shown (the machine page). The server decides who may
 * (the reporter, the assignee or a manager); a refusal is shown and the old value comes back. Every change is logged.
 */
export function IssuePrioritySelect({ issueId, priority }: { issueId: string; priority: string | null | undefined }) {
  const router = useRouter();
  const current = (priority ?? "normal") as RepairPriority;
  const [value, setValue] = useState<RepairPriority>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: RepairPriority) {
    const previous = value;
    setValue(next);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/issues/${issueId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repair_priority: next }) });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error?.message ?? "Could not change the priority.");
      }
      router.refresh(); // the list re-sorts, most urgent first
    } catch (e) {
      setValue(previous);
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <select
        aria-label="Priority of repair"
        title="Priority of repair"
        data-testid={`issue-priority-${issueId}`}
        data-priority={value}
        value={value}
        disabled={busy}
        onChange={(e) => change(e.target.value as RepairPriority)}
        className={cn(selectClass, "h-7 w-auto rounded-full py-0 pr-1 text-xs", TONE[value])}
      >
        {[...REPAIR_PRIORITIES].reverse().map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]} priority</option>)}
      </select>
      {error && <span role="alert" className="max-w-48 text-right text-xs text-destructive">{error}</span>}
    </span>
  );
}
