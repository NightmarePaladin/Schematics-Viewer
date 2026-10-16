"use client";

import { useRef, useState } from "react";
import {
  displayedToStored,
  pixelsToNorm,
  rectDisplayedToStored,
  rectFromCorners,
  rectStoredToDisplayed,
  storedToDisplayed,
  type NormPoint,
  type Rotation,
} from "@/lib/coords";
import { colorFor, type Ann, type AnnType, type Draft } from "./types";

export type Tool = "select" | "pan" | AnnType;

interface Props {
  width: number;
  height: number;
  rotation: Rotation;
  pageNumber: number;
  annotations: Ann[];
  draft: Draft | null;
  selectedId: string | null;
  tool: Tool;
  visible: boolean;
  onSelect: (id: string) => void;
  onDraft: (d: Draft) => void;
}

const MIN_BOX = 0.008;

/**
 * SVG overlay laid exactly over the canvas. Annotations are stored as normalized page fractions in the
 * UNROTATED frame; here they are converted to the displayed (rotated) frame and then to pixels for drawing.
 */
export function AnnotationOverlay({
  width, height, rotation, pageNumber, annotations, draft, selectedId, tool, visible, onSelect, onDraft,
}: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const start = useRef<NormPoint | null>(null);
  const [live, setLive] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const creating = tool !== "select" && tool !== "pan";

  const localNorm = (e: React.PointerEvent): NormPoint => {
    const r = ref.current!.getBoundingClientRect();
    return pixelsToNorm({ x: e.clientX - r.left, y: e.clientY - r.top }, { width: r.width, height: r.height });
  };

  function down(e: React.PointerEvent) {
    if (!creating) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    start.current = localNorm(e);
    setLive(null);
  }
  function move(e: React.PointerEvent) {
    if (!creating || !start.current || (tool !== "box" && tool !== "callout")) return;
    setLive(rectFromCorners(start.current, localNorm(e)));
  }
  function up(e: React.PointerEvent) {
    if (!creating || !start.current) return;
    const s = start.current;
    start.current = null;
    const end = localNorm(e);
    setLive(null);
    if (tool === "box" || tool === "callout") {
      const r = rectFromCorners(s, end);
      if (r.width < MIN_BOX || r.height < MIN_BOX) return;
      const stored = rectDisplayedToStored(r, rotation);
      onDraft({ type: tool, page_number: pageNumber, ...stored });
    } else {
      const p = displayedToStored(end, rotation);
      onDraft({ type: tool, page_number: pageNumber, x: p.x, y: p.y });
    }
  }

  const px = (n: NormPoint) => ({ x: n.x * width, y: n.y * height });
  const clickable = !creating;

  return (
    <svg
      ref={ref}
      data-testid="annotation-overlay"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="absolute left-0 top-0"
      style={{ touchAction: creating ? "none" : "auto", cursor: creating ? "crosshair" : "default", pointerEvents: visible || creating ? "auto" : "none" }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      role="group"
      aria-label="Annotations"
    >
      {visible &&
        annotations.map((a, idx) => {
          const color = colorFor(a.status);
          const sel = a.id === selectedId;
          const common = {
            "data-testid": "annotation-marker",
            "data-annotation-id": a.id,
            "data-x": a.x,
            "data-y": a.y,
            role: "button" as const,
            tabIndex: 0,
            "aria-label": `${a.type} annotation ${idx + 1}: ${a.body || "no text"}`,
            style: { cursor: "pointer", pointerEvents: clickable ? ("auto" as const) : ("none" as const) },
            onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSelect(a.id); },
            onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(a.id); } },
          };
          if ((a.type === "box" || a.type === "callout") && a.width && a.height) {
            const r = rectStoredToDisplayed({ x: a.x, y: a.y, width: a.width, height: a.height }, rotation);
            const o = px(r);
            return (
              <g key={a.id} {...common}>
                <rect x={o.x} y={o.y} width={r.width * width} height={r.height * height}
                  fill={color} fillOpacity={a.type === "box" ? 0.14 : 0.08} stroke={color} strokeWidth={sel ? 3 : 2}
                  strokeDasharray={a.type === "callout" ? "6 3" : undefined} />
                <circle cx={o.x} cy={o.y} r={10} fill={color} />
                <text x={o.x} y={o.y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{idx + 1}</text>
              </g>
            );
          }
          const c = px(storedToDisplayed({ x: a.x, y: a.y }, rotation));
          return (
            <g key={a.id} {...common} data-cx={c.x} data-cy={c.y}>
              <circle cx={c.x} cy={c.y} r={22} fill="transparent" /> {/* finger-sized tap target */}
              {sel && <circle cx={c.x} cy={c.y} r={16} fill="none" stroke={color} strokeWidth={2} />}
              <circle cx={c.x} cy={c.y} r={11} fill={color} stroke="#fff" strokeWidth={2} />
              <text x={c.x} y={c.y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{idx + 1}</text>
              {a.type === "comment" && <path d={`M${c.x - 4} ${c.y + 10} l4 6 l4 -6 z`} fill={color} />}
            </g>
          );
        })}

      {live && <rect x={live.x * width} y={live.y * height} width={live.width * (width)} height={live.height * height} fill="#d97706" fillOpacity={0.15} stroke="#d97706" strokeDasharray="4 3" strokeWidth={2} />}

      {draft && draft.page_number === pageNumber && (() => {
        if (draft.width && draft.height) {
          const r = rectStoredToDisplayed({ x: draft.x, y: draft.y, width: draft.width, height: draft.height }, rotation);
          return <rect data-testid="draft-marker" x={r.x * width} y={r.y * height} width={r.width * width} height={r.height * height} fill="#d97706" fillOpacity={0.2} stroke="#d97706" strokeDasharray="5 3" strokeWidth={2} pointerEvents="none" />;
        }
        const c = px(storedToDisplayed({ x: draft.x, y: draft.y }, rotation));
        return <circle data-testid="draft-marker" cx={c.x} cy={c.y} r={11} fill="#d97706" fillOpacity={0.4} stroke="#d97706" strokeDasharray="3 2" strokeWidth={2} pointerEvents="none" />;
      })()}
    </svg>
  );
}
