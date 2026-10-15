"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { selectClass } from "@/components/ui-bits";
import { MACHINE_STATUSES } from "@/lib/schemas";

type Machine = Record<string, string | number | boolean | null>;
export interface ParentOption { id: string; name: string; serial_number: string }
type FieldErrors = Record<string, string>;

const FIELDS: { name: string; label: string; required?: boolean; type?: string; hint?: string }[] = [
  { name: "name", label: "Machine name", required: true },
  { name: "category", label: "Category / type", required: true, hint: "e.g. Compressor, Boiler, Pump" },
  { name: "manufacturer", label: "Manufacturer", required: true },
  { name: "model_number", label: "Model number", required: true },
  { name: "serial_number", label: "Serial number", required: true, hint: "Unique per manufacturer within your organization" },
  { name: "asset_number", label: "Asset number" },
  { name: "location", label: "Facility / location" },
  { name: "installed_on", label: "Installation date", type: "date" },
  { name: "latitude", label: "Latitude (outdoor equipment)", type: "number", hint: "Enables weather context" },
  { name: "longitude", label: "Longitude", type: "number" },
];

export function MachineForm({ machine, parents = [], defaultParentId = null }: { machine?: Machine; parents?: ParentOption[]; defaultParentId?: string | null }) {
  const [hasParent, setHasParent] = useState(Boolean(machine?.parent_id ?? defaultParentId));
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    const form = new FormData(e.currentTarget);
    const payload: Record<string, FormDataEntryValue> = {};
    for (const [k, v] of form.entries()) payload[k] = v;
    const requestBody = { ...payload, is_critical: form.get("is_critical") === "on" };
    const res = await fetch(machine ? `/api/machines/${machine.id}` : "/api/machines", {
      method: machine ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const details = body?.error?.details;
      if (Array.isArray(details)) {
        const fe: FieldErrors = {};
        for (const d of details) fe[d.path || "form"] = d.message;
        setErrors(fe);
      }
      setFormError(body?.error?.message ?? "Could not save the machine.");
      setBusy(false);
      return;
    }
    router.push(`/machines/${body.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.name} className="space-y-1.5">
            <Label htmlFor={f.name}>
              {f.label}
              {f.required && <span aria-hidden className="text-destructive"> *</span>}
            </Label>
            <Input
              id={f.name}
              name={f.name}
              type={f.type ?? "text"}
              step={f.type === "number" ? "any" : undefined}
              defaultValue={(machine?.[f.name] as string | number | null) ?? ""}
              required={f.required}
              aria-invalid={Boolean(errors[f.name])}
              aria-describedby={errors[f.name] ? `${f.name}-err` : undefined}
            />
            {errors[f.name] ? (
              <p id={`${f.name}-err`} className="text-xs text-destructive">{errors[f.name]}</p>
            ) : (
              f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>
            )}
          </div>
        ))}
        <div className="space-y-1.5">
          <Label htmlFor="status">Operational status</Label>
          <select id="status" name="status" defaultValue={(machine?.status as string) ?? "operational"} className={selectClass}>
            {MACHINE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">System hierarchy</legend>
        <div className="space-y-1.5">
          <Label htmlFor="parent_id">Part of (parent system or machine)</Label>
          <select
            id="parent_id"
            name="parent_id"
            defaultValue={(machine?.parent_id as string) ?? defaultParentId ?? ""}
            onChange={(e) => setHasParent(Boolean(e.target.value))}
            className={selectClass}
          >
            <option value="">None — top-level machine or system</option>
            {parents.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.serial_number})</option>)}
          </select>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="is_critical" defaultChecked={Boolean(machine?.is_critical)} disabled={!hasParent} className="mt-1" />
          <span>
            <span className="font-medium">Critical component</span>
            <span className="block text-xs text-muted-foreground">
              If this machine has an unresolved <strong>high or critical</strong> issue, its parent is treated as <strong>inoperable</strong> until the issue is resolved.
              {!hasParent && " Choose a parent first."}
            </span>
          </span>
        </label>
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={3} defaultValue={(machine?.description as string) ?? ""} />
      </div>
      {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : machine ? "Save changes" : "Register machine"}</Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
