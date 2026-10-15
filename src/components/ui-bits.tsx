import { Badge } from "@/components/ui/badge";
import { statusLabel } from "@/lib/machine-status";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-6xl p-4 md:p-6", className)}>{children}</div>;
}

const MACHINE: Record<string, string> = {
  operational: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  degraded: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
  down: "bg-red-500/15 text-red-700 dark:text-red-300",
  maintenance: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  retired: "bg-muted text-muted-foreground",
  inoperable: "bg-red-600 text-white",
  critical: "bg-red-800 text-white",
};
const SEVERITY: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
  high: "bg-orange-500/20 text-orange-800 dark:text-orange-300",
  critical: "bg-red-500/20 text-red-700 dark:text-red-300",
};
const ISSUE: Record<string, string> = {
  open: "bg-red-500/15 text-red-700 dark:text-red-300",
  in_progress: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  resolved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

const label = (v: string) => v.replace("_", " ");

export const MachineStatusBadge = ({ status }: { status: string }) => (
  <Badge variant="secondary" className={cn("capitalize", MACHINE[status])}>{statusLabel(status)}</Badge>
);
export const SeverityBadge = ({ severity }: { severity: string }) => (
  <Badge variant="secondary" className={cn("capitalize", SEVERITY[severity])}>{severity}</Badge>
);
export const IssueStatusBadge = ({ status }: { status: string }) => (
  <Badge variant="secondary" className={cn("capitalize", ISSUE[status])}>{label(status)}</Badge>
);

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export function fmtDate(v: string | null | undefined, withTime = false) {
  if (!v) return "—";
  const d = new Date(v);
  return withTime
    ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/** Supabase embeds come back as object or single-item array depending on relationship; normalize. */
export function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}
