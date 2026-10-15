"use client";

import {
  ClipboardList,
  Cog,
  FileText,
  LayoutDashboard,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Users,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/machines", label: "Machines", icon: Wrench },
  { href: "/schematics", label: "Schematics", icon: FileText },
  { href: "/maintenance", label: "Maintenance Logs", icon: ClipboardList },
  { href: "/teams", label: "Teams", icon: Users },
  { href: "/settings", label: "Settings", icon: Cog },
];

interface Props {
  children: React.ReactNode;
  user: { name: string; email: string };
  role: string;
  orgId: string;
  orgs: { org_id: string; org_name: string }[];
}

export function AppShell({ children, user, role, orgId, orgs }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      setCollapsed(localStorage.getItem("sh_sidebar") === "1");
    } catch {}
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);

  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem("sh_sidebar", c ? "0" : "1");
      } catch {}
      return !c;
    });
  }

  async function switchOrg(id: string) {
    await fetch("/api/organizations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ org_id: id }),
    });
    router.push("/");
    router.refresh();
  }

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const sidebar = (
    <nav aria-label="Primary" className="flex h-full flex-col">
      <div className={cn("flex h-14 items-center gap-2 border-b px-3", collapsed && "md:justify-center")}>
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary font-bold text-primary-foreground">S</span>
        <span className={cn("font-semibold tracking-wide", collapsed && "md:hidden")}>SchematicHub</span>
      </div>
      <ul className="flex-1 space-y-1 p-2">
        {NAV.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              title={label}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                isActive(href) && "bg-muted text-foreground",
                collapsed && "md:justify-center md:px-0",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className={cn(collapsed && "md:sr-only")}>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="border-t p-2">
        <div className={cn("px-2 py-1 text-xs text-muted-foreground", collapsed && "md:hidden")}>
          <div className="truncate font-medium text-foreground">{user.name}</div>
          <div className="truncate">{user.email}</div>
          <div className="mt-0.5 capitalize">{role.replace("_", " ")}</div>
        </div>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="ghost" size="sm" className="mt-1 w-full justify-start">
            <span className={cn(collapsed && "md:sr-only")}>Sign out</span>
            {collapsed && <span className="hidden md:inline">⏻</span>}
          </Button>
        </form>
      </div>
    </nav>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className={cn(
          "hidden shrink-0 border-r bg-sidebar text-sidebar-foreground transition-[width] md:block",
          collapsed ? "w-16" : "w-60",
        )}
      >
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-black/50" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-64 border-r bg-sidebar text-sidebar-foreground">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
            <Menu />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={toggle}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {orgs.length > 1 ? (
              <select
                aria-label="Organization"
                value={orgId}
                onChange={(e) => switchOrg(e.target.value)}
                className="h-8 rounded-lg border bg-background px-2 text-sm"
              >
                {orgs.map((o) => (
                  <option key={o.org_id} value={o.org_id}>
                    {o.org_name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-sm text-muted-foreground">{orgs[0]?.org_name}</span>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle dark mode"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            >
              {mounted && resolvedTheme === "dark" ? <Sun /> : <Moon />}
            </Button>
          </div>
        </header>
        <main id="main" className="min-h-0 flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
