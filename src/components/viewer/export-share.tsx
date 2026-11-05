"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { Copy, Download, Link2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { selectClass } from "@/components/ui-bits";
import { buildExport } from "@/lib/export-pdf";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { Ann } from "./types";
import { cn } from "@/lib/utils";

interface Share {
  id: string;
  storage_path: string;
  label: string;
  include_notes: boolean;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

const DAY = 86400;
const EXPIRY = [["1 day", DAY], ["7 days", 7 * DAY], ["30 days", 30 * DAY]] as const;
const BUCKET = "schematic-shares";
/** Wall clock for event handlers (kept out of component bodies: the purity lint rule only sees direct Date.now calls). */
const nowMs = () => Date.now();

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "drawing";
const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pdf: PDFDocumentProxy | null;
  annotations: Ann[];
  title: string;
  revision: string;
  schematicId: string;
  orgId: string;
  userName: string;
  canExport: boolean;
  canShare: boolean;
}

/** One dialog for both: download a PDF with the notes drawn on, or create an expiring link to a snapshot of it. */
export function ExportShareDialog(p: Props) {
  const [withNotes, setWithNotes] = useState(true);
  const [summary, setSummary] = useState(true);
  const [busy, setBusy] = useState<null | "export" | "share">(null);
  const [expiry, setExpiry] = useState<number>(7 * DAY);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const hasNotes = p.annotations.length > 0;

  const build = useCallback(async () => {
    if (!p.pdf) throw new Error("The drawing is still loading.");
    const bytes = await p.pdf.getData();
    return buildExport({
      pdfBytes: bytes, annotations: p.annotations, title: p.title, revision: p.revision, exportedBy: p.userName,
      includeAnnotations: withNotes && hasNotes, summaryPage: summary && withNotes && hasNotes,
    });
  }, [p.pdf, p.annotations, p.title, p.revision, p.userName, withNotes, summary, hasNotes]);

  const loadShares = useCallback(async () => {
    try {
      const { data } = await createBrowserSupabase().from("schematic_shares").select("id, storage_path, label, include_notes, expires_at, revoked_at, created_at")
        .eq("schematic_id", p.schematicId).order("created_at", { ascending: false }).limit(20);
      setShares((data ?? []) as Share[]);
    } catch { /* not configured / offline */ }
  }, [p.schematicId]);
  useEffect(() => { if (p.open && p.canShare) void loadShares(); }, [p.open, p.canShare, loadShares]);

  async function download() {
    setBusy("export");
    try {
      const out = await build();
      const url = URL.createObjectURL(new Blob([out as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug(p.title)}-rev${slug(p.revision)}${withNotes && hasNotes ? "-annotated" : ""}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast.success("PDF exported");
    } catch (e) {
      toast.error((e as Error).message || "Could not export the PDF.");
    }
    setBusy(null);
  }

  async function createShare() {
    setBusy("share");
    setFresh(null);
    try {
      const sb = createBrowserSupabase();
      const out = await build();
      const path = `${p.orgId}/${p.schematicId}/${crypto.randomUUID()}.pdf`;
      const up = await sb.storage.from(BUCKET).upload(path, out as BlobPart as Blob, { contentType: "application/pdf", upsert: false });
      if (up.error) throw new Error("Could not store the shared copy (is sharing allowed for your role?).");
      const ins = await sb.from("schematic_shares").insert({
        org_id: p.orgId, schematic_id: p.schematicId, storage_path: path, label: label.trim(), include_notes: withNotes && hasNotes,
        expires_at: new Date(nowMs() + expiry * 1000).toISOString(),
      });
      if (ins.error) {
        await sb.storage.from(BUCKET).remove([path]);
        throw new Error("Sharing is not allowed for your role in this organization.");
      }
      const signed = await sb.storage.from(BUCKET).createSignedUrl(path, expiry);
      if (signed.error || !signed.data) throw new Error("Could not create the link.");
      setFresh(signed.data.signedUrl);
      setLabel("");
      await loadShares();
      await copy(signed.data.signedUrl);
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(null);
  }

  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); toast.success("Link copied"); } catch { toast.message("Select the link and copy it"); }
  }

  async function recopy(s: Share) {
    const left = Math.floor((new Date(s.expires_at).getTime() - nowMs()) / 1000);
    if (left <= 0) return;
    const r = await createBrowserSupabase().storage.from(BUCKET).createSignedUrl(s.storage_path, left);
    if (r.data) { setFresh(r.data.signedUrl); await copy(r.data.signedUrl); } else toast.error("Could not create the link.");
  }

  async function revoke(s: Share) {
    if (!confirm("Revoke this link? Anyone who has it will lose access immediately.")) return;
    const sb = createBrowserSupabase();
    await sb.storage.from(BUCKET).remove([s.storage_path]); // deleting the file is what kills the link
    const r = await sb.from("schematic_shares").update({ revoked_at: new Date().toISOString() }).eq("id", s.id);
    if (r.error) toast.error("Could not revoke the link.");
    else { toast.success("Link revoked"); setFresh(null); await loadShares(); }
  }

  const state = (s: Share) => (s.revoked_at ? "revoked" : new Date(s.expires_at) <= new Date() ? "expired" : "active");

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" data-testid="export-share-dialog">
        <DialogHeader>
          <DialogTitle>Export or share</DialogTitle>
          <DialogDescription>{p.title} · revision {p.revision}</DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-1.5 text-sm">
          <legend className="sr-only">What to include</legend>
          <label className="flex items-center gap-2"><input type="checkbox" checked={withNotes && hasNotes} disabled={!hasNotes} onChange={(e) => setWithNotes(e.target.checked)} data-testid="opt-notes" /> Draw the notes on the drawing {!hasNotes && <span className="text-muted-foreground">(no notes)</span>}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={summary && withNotes && hasNotes} disabled={!withNotes || !hasNotes} onChange={(e) => setSummary(e.target.checked)} data-testid="opt-summary" /> Add a numbered notes list at the end</label>
        </fieldset>

        {p.canExport && (
          <Button onClick={download} disabled={busy !== null || !p.pdf} data-testid="export-download"><Download /> {busy === "export" ? "Preparing…" : "Download PDF"}</Button>
        )}

        {p.canShare && (
          <section className="space-y-2 border-t pt-3" aria-label="Share link">
            <h3 className="text-sm font-semibold">Share a link</h3>
            <p className="text-xs text-muted-foreground">
              Creates a snapshot of this drawing as it looks now. Anyone with the link can open it without an account until it expires or you revoke it. Later changes are not included.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <label htmlFor="share-label" className="mb-1 block text-xs text-muted-foreground">Label (optional)</label>
                <Input id="share-label" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. For the vendor" />
              </div>
              <div>
                <label htmlFor="share-expiry" className="mb-1 block text-xs text-muted-foreground">Expires after</label>
                <select id="share-expiry" value={expiry} onChange={(e) => setExpiry(Number(e.target.value))} className={cn(selectClass, "w-28")}>
                  {EXPIRY.map(([t, s]) => <option key={s} value={s}>{t}</option>)}
                </select>
              </div>
              <Button onClick={createShare} disabled={busy !== null || !p.pdf} data-testid="create-share"><Link2 /> {busy === "share" ? "Creating…" : "Create link"}</Button>
            </div>
            {fresh && (
              <div className="flex items-center gap-2" data-testid="share-url">
                <Input readOnly value={fresh} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
                <Button variant="outline" size="icon" aria-label="Copy link" onClick={() => copy(fresh)}><Copy /></Button>
              </div>
            )}
            {shares.length > 0 && (
              <ul className="divide-y rounded-lg border text-sm" data-testid="share-list">
                {shares.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{s.label || "Untitled link"}</div>
                      <div className="text-xs text-muted-foreground">
                        {state(s) === "active" ? `Expires ${fmt(s.expires_at)}` : state(s) === "revoked" ? `Revoked ${fmt(s.revoked_at!)}` : `Expired ${fmt(s.expires_at)}`}
                        {s.include_notes ? " · with notes" : ""}
                      </div>
                    </div>
                    {state(s) === "active" && (
                      <>
                        <Button size="icon" variant="ghost" aria-label="Copy link" onClick={() => recopy(s)}><Copy /></Button>
                        <Button size="icon" variant="ghost" aria-label="Revoke link" onClick={() => revoke(s)}><Trash2 /></Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
