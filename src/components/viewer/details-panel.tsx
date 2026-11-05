"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type ViewerProps } from "./types";

/** "Details" tab: metadata, where this drawing is referenced from, and its revision history (with upload). */
export function DetailsPanel({ p }: { p: ViewerProps }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/schematics/${p.schematicId}/revisions`, { method: "POST", body: new FormData(e.currentTarget) });
      toast.success("New revision uploaded");
      // the open PDF is replaced, so reload (from an old revision, navigating to the current one does the same)
      if (p.viewRevision) router.push(`/schematics/${p.schematicId}`);
      else window.location.reload();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const rows = [
    ["Document number", p.meta.documentNumber], ["Revision", p.currentRevision], ["Machine", p.meta.machineName],
    ["Uploaded by", p.meta.uploader], ["Uploaded", p.meta.uploadedAt], ["Your access", p.level],
  ] as const;

  return (
    <div className="space-y-5 p-3 text-sm">
      <dl className="space-y-3">
        {rows.map(([k, v]) => (
          <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium capitalize-first">{v}</dd></div>
        ))}
      </dl>

      {p.referencedFrom.length > 0 && (
        <section aria-label="Referenced from">
          <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Referenced from</h3>
          <ul className="space-y-1" data-testid="referenced-from">
            {p.referencedFrom.map((r) => (
              <li key={r.annotationId}>
                <Link className="text-primary hover:underline" href={`/schematics/${r.schematicId}?page=${r.page}&focus=${r.annotationId}`}>{r.title}</Link>
                <span className="text-xs text-muted-foreground"> · page {r.page}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Revision history">
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Revisions</h3>
        <ul className="space-y-1" data-testid="revision-history">
          <li className="flex items-center gap-2">
            <Link className={p.viewRevision ? "text-primary hover:underline" : "font-medium"} href={`/schematics/${p.schematicId}`}>Rev {p.currentRevision}</Link>
            <span className="rounded bg-emerald-500/15 px-1.5 text-xs text-emerald-700 dark:text-emerald-400">current</span>
          </li>
          {p.revisions.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <Link className={p.viewRevision?.id === r.id ? "font-medium" : "text-primary hover:underline"} href={`/schematics/${p.schematicId}?revision=${r.id}`}>Rev {r.label}</Link>
              <span className="text-xs text-muted-foreground">replaced {r.at}</span>
            </li>
          ))}
        </ul>
      </section>

      {p.canRevise && (
        <form onSubmit={upload} className="space-y-2 rounded-lg border p-2" aria-label="Upload a new revision">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Upload a new revision</h3>
          <Input name="revision" required maxLength={20} placeholder="New revision label, e.g. C" aria-label="New revision label" />
          <input name="file" type="file" accept="application/pdf,.pdf" required aria-label="New revision PDF" className="block w-full text-xs" />
          <p className="text-xs text-muted-foreground">The current file is kept in the history. Notes placed on the old revision are flagged so people re-check their positions.</p>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <Button size="sm" type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload revision"}</Button>
        </form>
      )}
    </div>
  );
}
