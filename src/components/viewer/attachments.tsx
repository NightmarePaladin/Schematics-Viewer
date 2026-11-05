"use client";

import { Camera, Mic, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "./types";

interface Attachment {
  id: string;
  kind: "photo" | "audio";
  content_type: string;
  created_by: string;
  url: string | null;
}

const MAX_EDGE = 1600;
const MAX_SECONDS = 60;

/** Downscale a camera photo in the browser (phone photos are several MB) to a JPEG that fits the upload limit. */
async function shrinkPhoto(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not process the photo."))), "image/jpeg", 0.82));
}

const pickAudioType = () =>
  ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";

/** Photos and voice notes on one annotation. `refreshKey` changes when someone else adds or removes one (realtime). */
export function Attachments({ annotationId, canAdd, userId, canManage, refreshKey, onChanged }: {
  annotationId: string; canAdd: boolean; userId: string; canManage: boolean; refreshKey: number; onChanged: () => void;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<number | null>(null); // seconds elapsed
  const rec = useRef<{ mr: MediaRecorder; chunks: Blob[]; timer: number; stream: MediaStream } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ data: Attachment[] }>(`/api/annotations/${annotationId}/attachments`)).data);
    } catch {
      /* offline or no access: leave as is */
    }
  }, [annotationId]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => () => { // stop the microphone if the panel closes mid-recording
    if (rec.current) { window.clearInterval(rec.current.timer); rec.current.stream.getTracks().forEach((t) => t.stop()); }
  }, []);

  async function upload(blob: Blob, name: string) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", new File([blob], name, { type: blob.type }));
      await api(`/api/annotations/${annotationId}/attachments`, { method: "POST", body: fd });
      await load();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      await upload(await shrinkPhoto(f), "photo.jpg");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = pickAudioType();
      const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      mr.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        window.clearInterval(rec.current?.timer);
        rec.current = null;
        setRecording(null);
        const blob = new Blob(chunks, { type: (mr.mimeType || type || "audio/webm").split(";")[0] });
        if (blob.size) void upload(blob, "voice-note");
      };
      const started = Date.now();
      const timer = window.setInterval(() => {
        const s = Math.floor((Date.now() - started) / 1000);
        setRecording(s);
        if (s >= MAX_SECONDS && mr.state === "recording") mr.stop();
      }, 250);
      rec.current = { mr, chunks, timer, stream };
      mr.start();
      setRecording(0);
    } catch {
      toast.error("Could not use the microphone. Check the browser's permission for this site.");
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this attachment?")) return;
    try {
      await api(`/api/annotations/${annotationId}/attachments/${id}`, { method: "DELETE" });
      await load();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const canRecord = typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  if (!items.length && !canAdd) return null;
  return (
    <div className="space-y-2" data-testid="attachments">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">Photos &amp; voice notes ({items.length})</h3>
      <ul className="space-y-2">
        {items.map((a) => (
          <li key={a.id} className="flex items-start gap-2">
            {a.url && a.kind === "photo" && (
              <a href={a.url} target="_blank" rel="noreferrer" className="block">
                {/* signed URL, short-lived: a plain img avoids the image optimizer */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.url} alt="Attached photo" className="max-h-40 rounded-md border" loading="lazy" />
              </a>
            )}
            {a.url && a.kind === "audio" && <audio src={a.url} controls preload="none" className="h-10 w-full max-w-64" aria-label="Voice note" />}
            {!a.url && <span className="text-xs text-muted-foreground">Unavailable</span>}
            {(a.created_by === userId || canManage) && (
              <button type="button" aria-label="Remove attachment" onClick={() => remove(a.id)} className="ml-auto grid size-8 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted">
                <Trash2 className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canAdd && (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileInput} type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhoto} aria-label="Take or choose a photo" data-testid="photo-input" />
          <Button type="button" size="sm" variant="outline" disabled={busy || recording !== null} onClick={() => fileInput.current?.click()}>
            <Camera /> Add photo
          </Button>
          {canRecord && (recording === null ? (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={startRecording}><Mic /> Voice note</Button>
          ) : (
            <Button type="button" size="sm" variant="destructive" onClick={() => rec.current?.mr.stop()}>
              <Square /> Stop · {recording}s
            </Button>
          ))}
          {busy && <span className="text-xs text-muted-foreground">Uploading…</span>}
        </div>
      )}
    </div>
  );
}
