"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Upload form. File types are described by ACCEPTED so images / DXF can be added later
 * by extending this list and the server-side UPLOAD_HANDLERS map in /api/schematics.
 */
const ACCEPTED = [{ ext: ".pdf", mime: "application/pdf", label: "PDF" }];
const MAX_MB = 25;

export function UploadForm({ machineId }: { machineId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a PDF file.");
    if (file.size > MAX_MB * 1024 * 1024) return setError(`File is larger than ${MAX_MB} MB.`);
    form.set("machine_id", machineId);
    setBusy(true);
    const res = await fetch("/api/schematics", { method: "POST", body: form });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      const d = body?.error?.details;
      return setError(Array.isArray(d) ? d.map((x: { path: string; message: string }) => `${x.path}: ${x.message}`).join("; ") : (body?.error?.message ?? "Upload failed."));
    }
    formEl.reset();
    router.push(`/schematics/${body.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2" noValidate>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required maxLength={160} placeholder="Main hydraulic circuit" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="document_number">Document number</Label>
        <Input id="document_number" name="document_number" required maxLength={80} placeholder="DWG-1042" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="revision">Revision</Label>
        <Input id="revision" name="revision" required maxLength={20} placeholder="A" />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="file">{ACCEPTED.map((a) => a.label).join(" / ")} file (max {MAX_MB} MB)</Label>
        <Input id="file" name="file" type="file" accept={ACCEPTED.map((a) => `${a.ext},${a.mime}`).join(",")} required />
        <p className="text-xs text-muted-foreground">Uploads are private by default. You get Manage access; share it from the viewer.</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload schematic"}</Button>
      </div>
    </form>
  );
}
