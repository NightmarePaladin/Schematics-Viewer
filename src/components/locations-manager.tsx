"use client";

import { MapPin, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GeocodeMatch, GeocodeResult } from "@/lib/geocode";

export interface LocationRow {
  id: string;
  name: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  machine_count: number;
}

async function send(url: string, method: string, payload?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: payload ? JSON.stringify(payload) : undefined });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const d = body?.error?.details;
    throw new Error(Array.isArray(d) ? d.map((x: { path: string; message: string }) => `${x.path}: ${x.message}`).join("; ") : (body?.error?.message ?? "Request failed."));
  }
  return body;
}

/** Name + optional coordinates, with a place-name lookup (Open-Meteo geocoding) so nobody has to type latitude/longitude. */
function LocationForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: LocationRow;
  submitLabel: string;
  onSubmit: (v: { name: string; description: string; latitude: string; longitude: string }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [latitude, setLatitude] = useState(initial?.latitude?.toString() ?? "");
  const [longitude, setLongitude] = useState(initial?.longitude?.toString() ?? "");
  const [matches, setMatches] = useState<GeocodeMatch[] | null>(null);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookup() {
    setLooking(true);
    setLookupMsg(null);
    setMatches(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(name)}`);
      const body = (await res.json()) as GeocodeResult;
      if (!res.ok || !body.ok) setLookupMsg(body && "message" in body ? body.message : "Place lookup failed. You can type coordinates instead.");
      else if (body.matches.length === 0) setLookupMsg("No places found. Try a nearby city, or type the coordinates.");
      else setMatches(body.matches);
    } catch {
      setLookupMsg("Place lookup failed. You can type coordinates instead.");
    }
    setLooking(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name, description, latitude, longitude });
      if (!initial) { setName(""); setDescription(""); setLatitude(""); setLongitude(""); setMatches(null); }
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate aria-label={initial ? `Edit ${initial.name}` : "Add location"}>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1.5">
          <Label htmlFor={`loc-name-${initial?.id ?? "new"}`}>Name</Label>
          <Input id={`loc-name-${initial?.id ?? "new"}`} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="e.g. Plant 1 roof, Chicago depot" />
        </div>
        <div className="flex items-end">
          <Button type="button" variant="outline" onClick={lookup} disabled={looking || name.trim().length < 2} data-testid="geocode-lookup">
            <Search aria-hidden /> {looking ? "Looking up…" : "Look up coordinates"}
          </Button>
        </div>
      </div>
      {lookupMsg && <p role="status" className="text-sm text-muted-foreground">{lookupMsg}</p>}
      {matches && (
        <ul className="divide-y rounded-lg border text-sm" aria-label="Matching places">
          {matches.map((m) => (
            <li key={`${m.latitude},${m.longitude}`}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 p-2 text-left hover:bg-muted/50"
                onClick={() => { setLatitude(m.latitude.toFixed(4)); setLongitude(m.longitude.toFixed(4)); setMatches(null); setLookupMsg(`Using ${m.label}. Rename the location if you like.`); }}
              >
                <span>{m.label}</span>
                <span className="font-mono text-xs text-muted-foreground">{m.latitude.toFixed(3)}, {m.longitude.toFixed(3)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`loc-lat-${initial?.id ?? "new"}`}>Latitude</Label>
          <Input id={`loc-lat-${initial?.id ?? "new"}`} type="number" step="any" value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="optional" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`loc-lon-${initial?.id ?? "new"}`}>Longitude</Label>
          <Input id={`loc-lon-${initial?.id ?? "new"}`} type="number" step="any" value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="optional" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`loc-desc-${initial?.id ?? "new"}`}>Notes</Label>
        <Input id={`loc-desc-${initial?.id ?? "new"}`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="Address, access notes… (optional)" />
      </div>
      <p className="text-xs text-muted-foreground">Coordinates are optional. Locations with coordinates give their machines weather context automatically. West longitudes are negative (e.g. -87.63).</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !name.trim()}>{busy ? "Saving…" : submitLabel}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

export function LocationsManager({ locations, canAdd, canManage }: { locations: LocationRow[]; canAdd: boolean; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const payload = (v: { name: string; description: string; latitude: string; longitude: string }) => ({
    name: v.name,
    description: v.description,
    latitude: v.latitude,
    longitude: v.longitude,
  });

  async function remove(l: LocationRow) {
    const note = l.machine_count > 0 ? ` ${l.machine_count} machine(s) will keep their data but lose this location.` : "";
    if (!confirm(`Delete location "${l.name}"?${note}`)) return;
    try {
      await send(`/api/locations/${l.id}`, "DELETE");
      setMessage({ ok: true, text: `Deleted ${l.name}.` });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <div className="space-y-6">
      {message && <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-emerald-600" : "text-destructive"}`}>{message.text}</p>}

      {locations.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No locations yet. Add one below, then pick it from the Location dropdown when registering machines.</p>
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="location-list">
          {locations.map((l) => (
            <li key={l.id} className="p-3 text-sm">
              {editing === l.id ? (
                <LocationForm
                  initial={l}
                  submitLabel="Save changes"
                  onCancel={() => setEditing(null)}
                  onSubmit={async (v) => { await send(`/api/locations/${l.id}`, "PATCH", payload(v)); setEditing(null); router.refresh(); }}
                />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-medium"><MapPin className="size-4 text-muted-foreground" aria-hidden />{l.name}</div>
                    {l.description && <div className="text-xs text-muted-foreground">{l.description}</div>}
                    <div className="mt-1 text-xs text-muted-foreground">
                      {l.latitude != null ? <span className="font-mono">{l.latitude.toFixed(4)}, {l.longitude?.toFixed(4)}</span> : "No coordinates (indoor / unspecified)"}
                      {" · "}{l.machine_count} machine{l.machine_count === 1 ? "" : "s"}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setEditing(l.id)} aria-label={`Edit ${l.name}`}>Edit</Button>
                      <Button size="sm" variant="destructive" onClick={() => remove(l)} aria-label={`Delete ${l.name}`}>Delete</Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canAdd && (
        <section className="rounded-lg border p-4" aria-labelledby="add-location-title">
          <h2 id="add-location-title" className="mb-3 text-base font-semibold">Add a location</h2>
          <LocationForm
            submitLabel="Add location"
            onSubmit={async (v) => { await send("/api/locations", "POST", payload(v)); setMessage({ ok: true, text: `Added ${v.name}.` }); router.refresh(); }}
          />
        </section>
      )}
    </div>
  );
}
