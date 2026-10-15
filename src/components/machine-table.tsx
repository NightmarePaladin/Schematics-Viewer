"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { MachineStatusBadge } from "@/components/ui-bits";
import { isFaultStatus } from "@/lib/machine-status";
import { cn } from "@/lib/utils";

export interface MachineRow {
  id: string;
  name: string;
  category: string;
  manufacturer: string;
  model_number: string;
  serial_number: string;
  location: string | null;
  parent_id: string | null;
  /** Name of the parent machine (shown in search results, where sub-parts appear on their own). */
  parent_name: string | null;
  is_critical: boolean;
  /** Effective status: stored status unless a live fault (critical / inherited) overrides it. */
  status: string;
  /** Has an unresolved high/critical issue while marked as a critical component (is taking its parent out of service). */
  major_issue: boolean;
}

/**
 * Machines list.
 *  - "tree": top-level machines only; sub-parts stay hidden until you expand their main component.
 *  - "flat": search / filter results, where sub-parts appear on their own with a "Part of" link.
 */
export function MachineTable({ rows, mode }: { rows: MachineRow[]; mode: "tree" | "flat" }) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const { roots, kids, faultBelow, countBelow } = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const kids = new Map<string, MachineRow[]>();
    const roots: MachineRow[] = [];
    for (const r of rows) {
      // a machine whose parent the viewer cannot see is shown as a top-level machine
      if (r.parent_id && byId.has(r.parent_id)) kids.set(r.parent_id, [...(kids.get(r.parent_id) ?? []), r]);
      else roots.push(r);
    }
    const faultBelow = new Map<string, boolean>();
    const countBelow = new Map<string, number>();
    const walk = (id: string, seen: Set<string>): { fault: boolean; n: number } => {
      if (seen.has(id)) return { fault: false, n: 0 };
      seen.add(id);
      let fault = false;
      let n = 0;
      for (const c of kids.get(id) ?? []) {
        const sub = walk(c.id, seen);
        n += 1 + sub.n;
        fault = fault || isFaultStatus(c.status) || c.major_issue || sub.fault;
      }
      faultBelow.set(id, fault);
      countBelow.set(id, n);
      return { fault, n };
    };
    for (const r of roots) walk(r.id, new Set());
    return { roots, kids, faultBelow, countBelow };
  }, [rows]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const expandable = rows.filter((r) => (kids.get(r.id)?.length ?? 0) > 0).map((r) => r.id);

  const cells = (m: MachineRow, depth: number) => (
    <>
      <td className="p-3 font-medium">
        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 22 }}>
          {mode === "tree" && ((kids.get(m.id)?.length ?? 0) > 0 ? (
            <button
              type="button"
              onClick={() => toggle(m.id)}
              aria-expanded={open.has(m.id)}
              aria-label={`${open.has(m.id) ? "Collapse" : "Expand"} sub-machines of ${m.name}`}
              className="grid size-6 shrink-0 place-items-center rounded hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              {open.has(m.id) ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
            </button>
          ) : (
            <span className="inline-block size-6 shrink-0" aria-hidden />
          ))}
          <Link href={`/machines/${m.id}`} className="hover:underline">{m.name}</Link>
          {m.is_critical && (
            <span className="ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:text-amber-300" title="Critical component: a major issue here takes its parent out of service">critical</span>
          )}
          {mode === "tree" && (kids.get(m.id)?.length ?? 0) > 0 && !open.has(m.id) && (
            <span className="ml-1 text-xs font-normal text-muted-foreground" data-testid="hidden-count">
              {countBelow.get(m.id)} sub-machine{countBelow.get(m.id) === 1 ? "" : "s"}
              {faultBelow.get(m.id) && <span className="ml-1 whitespace-nowrap rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700 dark:text-red-300">fault inside</span>}
            </span>
          )}
        </div>
      </td>
      <td className="p-3">{m.category}</td>
      <td className="p-3">{m.manufacturer} <span className="text-muted-foreground">{m.model_number}</span></td>
      {mode === "flat" && (
        <td className="p-3">
          {m.parent_id ? (m.parent_name ? <Link href={`/machines/${m.parent_id}`} className="hover:underline">{m.parent_name}</Link> : <span className="text-muted-foreground">restricted</span>) : "—"}
        </td>
      )}
      <td className="p-3 font-mono text-xs">{m.serial_number}</td>
      <td className="p-3">{m.location ?? "—"}</td>
      <td className="p-3">
        <MachineStatusBadge status={m.status} />
        {m.major_issue && (
          <span className="ml-1 whitespace-nowrap rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700 dark:text-red-300" title="Unresolved high/critical issue on a critical component: its parent is inoperable">major issue</span>
        )}
      </td>
    </>
  );

  const renderTree = (m: MachineRow, depth: number, trail: Set<string>): React.ReactNode => {
    if (trail.has(m.id)) return null;
    const nextTrail = new Set(trail).add(m.id);
    return (
      <Fragment key={m.id}>
        <tr className={cn("border-t hover:bg-muted/30", depth > 0 && "bg-muted/20")} data-depth={depth}>{cells(m, depth)}</tr>
        {open.has(m.id) && (kids.get(m.id) ?? []).map((c) => renderTree(c, depth + 1, nextTrail))}
      </Fragment>
    );
  };

  return (
    <div className="space-y-2">
      {mode === "tree" && expandable.length > 0 && (
        <div className="flex gap-2 text-xs">
          <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(new Set(expandable))}>Expand all</Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(new Set())}>Collapse all</Button>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3">Name</th><th className="p-3">Category</th><th className="p-3">Manufacturer / Model</th>
              {mode === "flat" && <th className="p-3">Part of</th>}
              <th className="p-3">Serial</th><th className="p-3">Location</th><th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {mode === "tree"
              ? roots.map((m) => renderTree(m, 0, new Set()))
              : rows.map((m) => <tr key={m.id} className="border-t hover:bg-muted/30">{cells(m, 0)}</tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
