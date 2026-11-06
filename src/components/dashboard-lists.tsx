"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, IssueStatusBadge, PriorityBadge, SeverityBadge, fmtDate } from "@/components/ui-bits";
import { cn } from "@/lib/utils";

export interface DashIssue {
  id: string;
  title: string;
  machine_id: string;
  machine_name: string | null;
  created_at: string;
  severity: string;
  status: string;
  repair_priority: string | null;
}
export interface DashLog {
  id: string;
  body: string;
  entry_type: string;
  performed_at: string;
  machine_id: string | null;
  machine_name: string | null;
  performer: string | null;
}

/** Phones and tablets show this many; desktop shows as many as fit the page. */
const SMALL_SCREEN_LIMIT = 6;
const DESKTOP = "(min-width: 1024px)";
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(DESKTOP);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/**
 * How many of the (already rendered) children of a fixed-height list fit inside it. All items stay in the DOM so they can be
 * measured; the ones that do not fit are hidden with `invisible` + `inert`, and the count updates when the window, the text size
 * or an item's own size changes.
 */
function useFit<T extends HTMLElement>(total: number) {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(total);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const limit = el.clientHeight;
    let n = 0;
    for (const child of Array.from(el.children)) {
      if (child.getBoundingClientRect().bottom - top <= limit + 1) n++;
      else break;
    }
    setVisible(Math.max(1, n));
  }, []);
  useLayoutEffect(measure, [measure, total]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [measure, total]);
  return { ref, visible };
}

function IssueRow({ i }: { i: DashIssue }) {
  return (
    <div className="flex items-start justify-between gap-2 text-sm" data-testid="dash-issue-row">
      <div className="min-w-0">
        <Link href={`/machines/${i.machine_id}`} className="font-medium hover:underline">{i.title}</Link>
        <div className="truncate text-xs text-muted-foreground">{i.machine_name} · {fmtDate(i.created_at)}</div>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1"><PriorityBadge priority={i.repair_priority} /><SeverityBadge severity={i.severity} /><IssueStatusBadge status={i.status} /></div>
    </div>
  );
}

function LogRow({ l }: { l: DashLog }) {
  return (
    <div className="text-sm" data-testid="dash-log-row">
      <div className="line-clamp-2">{l.body}</div>
      <div className="text-xs text-muted-foreground">
        {l.machine_id ? <Link className="hover:underline" href={`/machines/${l.machine_id}`}>{l.machine_name}</Link> : l.machine_name} · {l.performer} · {fmtDate(l.performed_at, true)}
      </div>
    </div>
  );
}

interface ListCardProps<T> {
  id: string;
  title: string;
  /** total rows in the database, which can be more than the rows loaded */
  total: number;
  items: T[];
  render: (item: T) => React.ReactNode;
  keyOf: (item: T) => string;
  empty: string;
  /** where the complete list lives */
  allHref: string;
}

function ListCard<T>({ id, title, total, items, render, keyOf, empty, allHref }: ListCardProps<T>) {
  const desktop = useSyncExternalStore(subscribe, () => window.matchMedia(DESKTOP).matches, () => true);
  const { ref, visible } = useFit<HTMLUListElement>(items.length);
  const [open, setOpen] = useState(false);
  const shown = desktop ? Math.min(visible, items.length) : Math.min(SMALL_SCREEN_LIMIT, items.length);
  const hiddenCount = Math.max(0, total - shown);

  return (
    <>
      <Card
        data-testid={`dash-${id}`}
        // mouse convenience: clicking empty parts of the card opens the full list; links inside still go to their page, and the
        // header and footer buttons below are the keyboard / screen-reader route
        onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) setOpen(true); }}
        className="cursor-pointer transition-all duration-150 hover:bg-primary/5 hover:ring-1 hover:ring-primary lg:min-h-0"
      >
        <CardHeader>
          <button type="button" onClick={() => setOpen(true)} data-testid={`dash-${id}-open`} aria-haspopup="dialog" className="flex w-full items-baseline justify-between gap-2 rounded text-left outline-none focus-visible:ring-1 focus-visible:ring-primary">
            <CardTitle>{title} <span className="ml-1 text-sm font-normal tabular-nums text-muted-foreground">({total})</span></CardTitle>
            <span className="text-xs font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-400">View all</span>
          </button>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-2">
          {items.length === 0 ? (
            <Empty>{empty}</Empty>
          ) : desktop ? (
            <ul ref={ref} className="min-h-0 flex-1 space-y-3 overflow-hidden" data-testid={`dash-${id}-list`}>
              {items.map((it, idx) => (
                <li key={keyOf(it)} className={cn(idx >= visible && "invisible")} inert={idx >= visible} aria-hidden={idx >= visible || undefined}>{render(it)}</li>
              ))}
            </ul>
          ) : (
            <ul className="space-y-3" data-testid={`dash-${id}-list`}>
              {items.slice(0, SMALL_SCREEN_LIMIT).map((it) => <li key={keyOf(it)}>{render(it)}</li>)}
            </ul>
          )}
          {items.length > 0 && (
            <button type="button" onClick={() => setOpen(true)} className="shrink-0 rounded text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary" data-testid={`dash-${id}-more`}>
              Showing {shown} of {total}{hiddenCount > 0 ? ` · ${hiddenCount} more, open the full list` : ""}
            </button>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" data-testid={`dash-${id}-dialog`}>
          <DialogHeader>
            <DialogTitle>{title} ({total})</DialogTitle>
            <DialogDescription>
              {items.length < total ? `The ${items.length} most recent. ` : ""}
              <Link href={allHref} className="underline">Open the full page</Link>
            </DialogDescription>
          </DialogHeader>
          {items.length === 0 ? (
            <Empty>{empty}</Empty>
          ) : (
            <ul className="divide-y" data-testid={`dash-${id}-full`}>
              {items.map((it) => <li key={keyOf(it)} className="py-3 first:pt-0">{render(it)}</li>)}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The two lists under the stat cards. On a desktop they fill the rest of the page; "View all" (or a click on the card) opens the full list. */
export function DashboardLists({ issues, issuesTotal, logs, logsTotal }: { issues: DashIssue[]; issuesTotal: number; logs: DashLog[]; logsTotal: number }) {
  return (
    <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
      <ListCard id="issues" title="Open issues" total={issuesTotal} items={issues} keyOf={(i) => i.id} render={(i) => <IssueRow i={i} />} empty="No open issues." allHref="/maintenance" />
      <ListCard id="logs" title="Recent maintenance activity" total={logsTotal} items={logs} keyOf={(l) => l.id} render={(l) => <LogRow l={l} />} empty="No log entries yet." allHref="/maintenance" />
    </div>
  );
}
