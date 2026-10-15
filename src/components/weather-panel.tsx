"use client";

import { CloudOff, Droplets, MapPinOff, Thermometer, Wind } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { WeatherResult } from "@/lib/weather";

export function WeatherPanel({ machineId, hasLocation }: { machineId: string; hasLocation: boolean }) {
  const [data, setData] = useState<WeatherResult | null>(null);
  const [loading, setLoading] = useState(hasLocation);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/weather?machine_id=${machineId}`);
      setData(res.ok ? ((await res.json()) as WeatherResult) : { ok: false, reason: "upstream_error", message: "Weather request failed." });
    } catch {
      setData({ ok: false, reason: "upstream_error", message: "Could not reach the server." });
    } finally {
      setLoading(false);
    }
  }, [machineId]);

  useEffect(() => {
    if (hasLocation) void load();
  }, [hasLocation, load]);

  if (!hasLocation) {
    return (
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <MapPinOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        No coordinates on file. Weather context is optional and is only shown for outdoor equipment with a latitude and longitude.
      </p>
    );
  }
  if (loading && !data) return <p className="text-sm text-muted-foreground" aria-busy="true">Loading current conditions…</p>;
  if (!data || !data.ok) {
    return (
      <div className="space-y-2" role="status">
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          {data?.message ?? "Weather unavailable."}
        </p>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>Retry</Button>
      </div>
    );
  }
  return (
    <div>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div><dt className="flex items-center gap-1 text-xs text-muted-foreground"><Thermometer className="size-3.5" aria-hidden />Temperature</dt><dd className="text-xl font-semibold tabular-nums">{data.temperatureC.toFixed(1)} °C</dd></div>
        <div><dt className="flex items-center gap-1 text-xs text-muted-foreground"><Droplets className="size-3.5" aria-hidden />Humidity</dt><dd className="text-xl font-semibold tabular-nums">{Math.round(data.humidityPct)}%</dd></div>
        <div><dt className="flex items-center gap-1 text-xs text-muted-foreground"><Wind className="size-3.5" aria-hidden />Wind</dt><dd className="text-xl font-semibold tabular-nums">{data.windSpeedKmh.toFixed(1)} km/h</dd></div>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        Retrieved {new Date(data.fetchedAt).toLocaleTimeString()} from Open-Meteo{data.cached ? " (cached)" : ""}.
      </p>
    </div>
  );
}
