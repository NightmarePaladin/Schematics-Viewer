"use client";

import type { PDFPageProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useRef } from "react";

/** Renders one PDF page to a canvas at the given CSS-pixel scale/rotation. Never mutates the PDF. */
export function PdfCanvas({
  page,
  scale,
  rotation,
  onRendered,
}: {
  page: PDFPageProxy;
  scale: number;
  rotation: number;
  onRendered?: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    let task: RenderTask | null = null;
    let cancelled = false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    task = page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    });
    task.promise
      .then(() => {
        if (!cancelled) {
          canvas.dataset.rendered = "true";
          onRendered?.();
        }
      })
      .catch((e: { name?: string }) => {
        if (e?.name !== "RenderingCancelledException") console.error(e);
      });
    canvas.dataset.rendered = "false";
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [page, scale, rotation, onRendered]);

  return <canvas ref={ref} data-testid="pdf-canvas" className="block bg-white shadow-md" aria-label="Schematic page" role="img" />;
}
