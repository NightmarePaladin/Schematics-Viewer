"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

interface Note {
  id: string;
  message: string;
  href: string;
  read_at: string | null;
  created_at: string;
}

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

/** Header bell: replies to your notes and issues raised on / assigned to you. Updates live. */
export function NotificationBell({ userId }: { userId: string }) {
  const [items, setItems] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const unread = items.filter((n) => !n.read_at).length;

  const load = useCallback(async () => {
    try {
      const sb = createBrowserSupabase();
      const { data } = await sb.from("notifications").select("id, message, href, read_at, created_at").order("created_at", { ascending: false }).limit(30);
      if (data) setItems(data as Note[]);
    } catch {
      /* not configured or offline */
    }
  }, []);

  useEffect(() => {
    void load();
    let sb: ReturnType<typeof createBrowserSupabase>;
    try { sb = createBrowserSupabase(); } catch { return; }
    const ch = sb
      .channel(`notifications-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => void load())
      .subscribe();
    return () => { void sb.removeChannel(ch); };
  }, [load, userId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  async function markRead(ids: string[]) {
    if (!ids.length) return;
    setItems((cur) => cur.map((n) => (ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n)));
    try { await createBrowserSupabase().from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids); } catch { /* retried on next load */ }
  }

  return (
    <div ref={box} className="relative">
      <Button variant="ghost" size="icon" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open} data-testid="notification-bell" onClick={() => setOpen((v) => !v)}>
        <Bell />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-white" data-testid="notification-count">{unread > 9 ? "9+" : unread}</span>
        )}
      </Button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border bg-background shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
            <span className="font-medium">Notifications</span>
            {unread > 0 && <button type="button" className="text-xs text-primary hover:underline" onClick={() => markRead(items.filter((n) => !n.read_at).map((n) => n.id))}>Mark all read</button>}
          </div>
          <ul className="max-h-96 divide-y overflow-auto" data-testid="notification-list">
            {items.length === 0 && <li className="p-4 text-sm text-muted-foreground">Nothing yet. You will be told when someone replies to your notes or an issue is assigned to you.</li>}
            {items.map((n) => (
              <li key={n.id}>
                <Link href={n.href} onClick={() => { void markRead([n.id]); setOpen(false); }} className={cn("block px-3 py-2 text-sm hover:bg-muted/60", !n.read_at && "bg-primary/5")}>
                  <span className={cn(!n.read_at && "font-medium")}>{n.message}</span>
                  <span className="block text-xs text-muted-foreground">{ago(n.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
