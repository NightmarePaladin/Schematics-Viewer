"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { selectClass } from "@/components/ui-bits";
import { LOG_TYPES, SEVERITIES } from "@/lib/schemas";

async function post(url: string, payload: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const d = body?.error?.details;
    throw new Error(Array.isArray(d) ? d.map((x: { path: string; message: string }) => `${x.path}: ${x.message}`).join("; ") : (body?.error?.message ?? "Request failed."));
  }
  return body;
}

export function LogForm({ machineId }: { machineId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    setBusy(true);
    setError(null);
    try {
      await post("/api/maintenance-logs", { machine_id: machineId, entry_type: f.get("entry_type"), body: f.get("body") });
      formEl.reset();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }
  return (
    <form onSubmit={onSubmit} className="space-y-2" aria-label="Add maintenance log entry">
      <div className="flex gap-2">
        <select name="entry_type" className={`${selectClass} w-36`} aria-label="Entry type" defaultValue="note">
          {LOG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <Input name="body" required maxLength={4000} placeholder="What was done or observed?" aria-label="Log entry" />
        <Button type="submit" disabled={busy}>Add</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

export function IssueForm({ machineId }: { machineId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    setBusy(true);
    setError(null);
    try {
      await post("/api/issues", {
        machine_id: machineId,
        title: f.get("title"),
        description: f.get("description"),
        severity: f.get("severity"),
      });
      formEl.reset();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }
  return (
    <form onSubmit={onSubmit} className="space-y-2" aria-label="Report issue">
      <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
        <div className="space-y-1"><Label htmlFor="issue-title" className="sr-only">Issue title</Label><Input id="issue-title" name="title" required maxLength={160} placeholder="Issue title" /></div>
        <select name="severity" className={selectClass} aria-label="Severity" defaultValue="medium">
          {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <Textarea name="description" rows={2} placeholder="Describe the problem" aria-label="Issue description" />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy}>Report issue</Button>
    </form>
  );
}
