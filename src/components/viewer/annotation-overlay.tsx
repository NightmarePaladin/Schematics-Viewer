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
import { colorFor, one, type Ann, type AnnType, type Draft, type Path } from "./types";

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
const MIN_STEP = 0.003; // pen: ignore points closer than this (fraction of the page)
const MAX_POINTS = 500;
const SIZED = new Set<AnnType>(["box", "callout", "highlight"]);

const dist = (a: NormPoint, b: NormPoint) => Math.hypot(a.x - b.x, a.y - b.y);

/** Thin a long stroke down to at most MAX_POINTS, keeping the last point. */
function decimate(pts: NormPoint[]): NormPoint[] {
  if (pts.length <= MAX_POINTS) return pts;
  const k = Math.ceil(pts.length / MAX_POINTS);
  const out = pts.filter((_, i) => i % k === 0);
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

/**
 * SVG overlay laid exactly over the canvas. Annotations are stored as normalized page fractions in the
 * UNROTATED frame; here they are converted to the displayed (rotated) frame and then to pixels for drawing.
 */
export function AnnotationOverlay({
  width, height, rotation, pageNumber, annotations, draft, selectedId, tool, visible, onSelect, onDraft,
}: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const start = useRef<NormPoint | null>(null);
  const stroke = useRef<NormPoint[]>([]);
  const [live, setLive] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [livePath, setLivePath] = useState<NormPoint[] | null>(null);
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
    stroke.current = [start.current];
    setLive(null);
    setLivePath(null);
  }
  function move(e: React.PointerEvent) {
    if (!creating || !start.current) return;
    const p = localNorm(e);
    if (SIZED.has(tool as AnnType)) setLive(rectFromCorners(start.current, p));
    else if (tool === "pen") {
      if (dist(stroke.current[stroke.current.length - 1], p) >= MIN_STEP) {
        stroke.current.push(p);
        setLivePath([...stroke.current]);
      }
    } else if (tool === "arrow") setLivePath([start.current, p]);
  }
  function up(e: React.PointerEvent) {
    if (!creating || !start.current) return;
    const s = start.current;
    start.current = null;
    const end = localNorm(e);
    setLive(null);
    setLivePath(null);
    if (SIZED.has(tool as AnnType)) {
      const r = rectFromCorners(s, end);
      if (r.width < MIN_BOX || r.height < MIN_BOX) return;
      const stored = rectDisplayedToStored(r, rotation);
      onDraft({ type: tool as AnnType, page_number: pageNumber, ...stored });
    } else if (tool === "pen" || tool === "arrow") {
      const pts = tool === "pen" ? decimate([...stroke.current, end]) : [s, end];
      const length = pts.reduce((n, p, i) => n + (i ? dist(p, pts[i - 1]) : 0), 0);
      if (pts.length < 2 || length < 0.01) return;
      const path: Path = pts.map((p) => {
        const q = displayedToStored(p, rotation);
        return [q.x, q.y];
      });
      onDraft({ type: tool, page_number: pageNumber, x: path[0][0], y: path[0][1], path });
    } else {
      const p = displayedToStored(end, rotation);
      onDraft({ type: tool as AnnType, page_number: pageNumber, x: p.x, y: p.y });
    }
    stroke.current = [];
  }

  const px = (n: NormPoint) => ({ x: n.x * width, y: n.y * height });
  const clickable = !creating;
  /** stored path -> displayed pixel points */
  const pathPx = (path: Path) => path.map(([x, y]) => px(storedToDisplayed({ x, y }, rotation)));
  const poly = (pts: { x: number; y: number }[]) => pts.map((q) => `${q.x},${q.y}`).join(" ");

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
          const linkBadge = (x: number, y: number) => (one(a.linked) ? <LinkBadge x={x} y={y} color={color} /> : null);

          if ((a.type === "pen" || a.type === "arrow") && a.path && a.path.length >= 2) {
            const pts = pathPx(a.path);
            const first = pts[0];
            const last = pts[pts.length - 1];
            const prev = pts[Math.max(0, pts.length - 2)];
            const ang = Math.atan2(last.y - prev.y, last.x - prev.x);
            const head = 12;
            return (
              <g key={a.id} {...common} data-cx={first.x} data-cy={first.y}>
                <polyline points={poly(pts)} fill="none" stroke="transparent" strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" /> {/* finger-sized hit area */}
                <polyline points={poly(pts)} fill="none" stroke={color} strokeWidth={sel ? 4 : 3} strokeLinecap="round" strokeLinejoin="round" />
                {a.type === "arrow" && (
                  <path d={`M${last.x} ${last.y} L${last.x - head * Math.cos(ang - 0.45)} ${last.y - head * Math.sin(ang - 0.45)} M${last.x} ${last.y} L${last.x - head * Math.cos(ang + 0.45)} ${last.y - head * Math.sin(ang + 0.45)}`} fill="none" stroke={color} strokeWidth={sel ? 4 : 3} strokeLinecap="round" />
                )}
                <circle cx={first.x} cy={first.y} r={9} fill={color} stroke="#fff" strokeWidth={1.5} />
                <text x={first.x} y={first.y + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">{idx + 1}</text>
                {linkBadge(first.x + 12, first.y - 12)}
              </g>
            );
          }
          if (SIZED.has(a.type) && a.width && a.height) {
            const r = rectStoredToDisplayed({ x: a.x, y: a.y, width: a.width, height: a.height }, rotation);
            const o = px(r);
            const hl = a.type === "highlight";
            return (
              <g key={a.id} {...common}>
                <rect x={o.x} y={o.y} width={r.width * width} height={r.height * height}
                  fill={hl ? "#facc15" : color} fillOpacity={hl ? 0.35 : a.type === "box" ? 0.14 : 0.08}
                  stroke={hl ? (sel ? "#a16207" : "none") : color} strokeWidth={sel ? 3 : 2}
                  strokeDasharray={a.type === "callout" ? "6 3" : undefined} />
                <circle cx={o.x} cy={o.y} r={10} fill={hl ? "#ca8a04" : color} />
                <text x={o.x} y={o.y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{idx + 1}</text>
                {linkBadge(o.x + 14, o.y)}
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
              {linkBadge(c.x + 12, c.y - 12)}
              {a.type === "comment" && <path d={`M${c.x - 4} ${c.y + 10} l4 6 l4 -6 z`} fill={color} />}
            </g>
          );
        })}

      {live && <rect x={live.x * width} y={live.y * height} width={live.width * (width)} height={live.height * height} fill="#d97706" fillOpacity={0.15} stroke="#d97706" strokeDasharray="4 3" strokeWidth={2} />}
      {livePath && livePath.length > 1 && (
        <polyline points={poly(livePath.map(px))} fill="none" stroke="#d97706" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={tool === "arrow" ? "5 3" : undefined} pointerEvents="none" />
      )}

      {draft && draft.page_number === pageNumber && (() => {
        if (draft.path) {
          const pts = pathPx(draft.path);
          return <polyline data-testid="draft-marker" points={poly(pts)} fill="none" stroke="#d97706" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 3" pointerEvents="none" />;
        }
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

/** Small "opens another drawing" arrow on a marker. */
function LinkBadge({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g data-testid="link-badge" pointerEvents="none">
      <circle cx={x} cy={y} r={8} fill="#fff" stroke={color} strokeWidth={1.5} />
      <path d={`M${x - 3} ${y + 3} L${x + 3} ${y - 3} M${x - 1} ${y - 3} H${x + 3} V${y + 1}`} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}
