"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const WIDTH = 112; // CSS px

function Thumb({ pdf, n, current, onGo }: { pdf: PDFDocumentProxy; n: number; current: boolean; onGo: (n: number) => void }) {
  const box = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [ratio, setRatio] = useState(1.3);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !canvas.current) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    (async () => {
      const page = await pdf.getPage(n);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const scale = WIDTH / base.width;
      const vp = page.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const c = canvas.current!;
      c.width = Math.floor(vp.width * dpr);
      c.height = Math.floor(vp.height * dpr);
      c.style.width = `${vp.width}px`;
      c.style.height = `${vp.height}px`;
      setRatio(vp.height / vp.width);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const t = page.render({ canvas: c, canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      task = t;
      await t.promise.catch(() => {});
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [visible, pdf, n]);

  useEffect(() => {
    if (current) box.current?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <button
      ref={box}
      type="button"
      onClick={() => onGo(n)}
      aria-label={`Go to page ${n}`}
      aria-current={current ? "page" : undefined}
      data-testid="page-thumb"
      className={cn("flex w-full flex-col items-center gap-1 rounded-md p-1.5 text-xs hover:bg-muted", current && "bg-muted ring-2 ring-primary")}
    >
      <span className="block overflow-hidden bg-white shadow-sm" style={{ width: WIDTH, height: WIDTH * ratio }}>
        <canvas ref={canvas} className="block" />
      </span>
      <span className="tabular-nums text-muted-foreground">{n}</span>
    </button>
  );
}

/** Page strip. Thumbnails render lazily as they scroll into view. */
export function Thumbnails({ pdf, numPages, current, onGo, className }: { pdf: PDFDocumentProxy; numPages: number; current: number; onGo: (n: number) => void; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1 overflow-y-auto p-2", className)} data-testid="thumbnails">
      {Array.from({ length: numPages }, (_, i) => (
        <Thumb key={i + 1} pdf={pdf} n={i + 1} current={current === i + 1} onGo={onGo} />
      ))}
    </div>
  );
}
