"use client";

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Eye, EyeOff, Hand, Maximize2, MessageSquare, MousePointer2, MapPin, PanelRightClose,
  PanelRightOpen, RotateCw, Square, StickyNote, ZoomIn, ZoomOut, MoveHorizontal,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { fitScale, normalizeRotation, type Rotation } from "@/lib/coords";
import { levelAtLeast } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { AnnotationOverlay, type Tool } from "./annotation-overlay";
import { AnnotationPanel } from "./annotation-panel";
import { GrantsPanel } from "./grants-panel";
import { PdfCanvas } from "./pdf-canvas";
import { api, type Ann, type Draft, type ViewerProps } from "./types";

type Zoom = { mode: "width" } | { mode: "page" } | { mode: "custom"; value: number };

const TOOLS: { id: Tool; key: string; label: string; icon: React.ElementType; needs: "view" | "comment" }[] = [
  { id: "select", key: "V", label: "Select", icon: MousePointer2, needs: "view" },
  { id: "pan", key: "H", label: "Pan", icon: Hand, needs: "view" },
  { id: "point", key: "P", label: "Point marker", icon: MapPin, needs: "comment" },
  { id: "comment", key: "C", label: "Text comment", icon: MessageSquare, needs: "comment" },
  { id: "box", key: "B", label: "Issue box", icon: Square, needs: "comment" },
  { id: "callout", key: "Q", label: "Quote / callout", icon: StickyNote, needs: "comment" },
];

/** md breakpoint (768px). Desktop: side panel. Phone: bottom sheet, closed until asked for. */
const MD = "(min-width: 768px)";
const subscribeMd = (cb: () => void) => {
  const m = window.matchMedia(MD);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const getMd = () => window.matchMedia(MD).matches;

/** Icon button that is finger-sized (40px) on phones. */
function ToolButton(props: React.ComponentProps<typeof Button>) {
  return <Button size="icon-sm" {...props} className={cn("max-md:size-10", props.className)} />;
}

export function SchematicViewer(props: ViewerProps) {
  const { schematicId, level } = props;
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [pageNum, setPageNum] = useState(props.initialPage);
  const [numPages, setNumPages] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0); // bumped by "Try again"
  const [zoom, setZoom] = useState<Zoom>({ mode: "width" });
  const [rotation, setRotation] = useState<Rotation>(0);
  const [tool, setTool] = useState<Tool>("select");
  const [showAnn, setShowAnn] = useState(true);
  const [sidebar, setSidebar] = useState(true); // desktop side panel
  const [sheet, setSheet] = useState(false); // phone bottom sheet (closed by default so it never covers the drawing)
  const isDesktop = useSyncExternalStore(subscribeMd, getMd, () => true);
  const panelOpen = isDesktop ? sidebar : sheet;
  const openPanel = () => { setSidebar(true); setSheet(true); };
  const [tab, setTab] = useState<"notes" | "access" | "info">("notes");
  const [annotations, setAnnotations] = useState<Ann[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [box, setBox] = useState({ width: 800, height: 600 });
  const scroller = useRef<HTMLDivElement>(null);
  const panning = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  /** Where on screen (and where on the page, as fractions) a zoom should stay anchored. */
  const anchor = useRef<{ cx: number; cy: number; fx: number; fy: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const [spacePan, setSpacePan] = useState(false); // Space held: temporary pan, whatever tool is active
  const [pageDraft, setPageDraft] = useState<string | null>(null);

  const canComment = levelAtLeast(level, "comment");
  const canManage = levelAtLeast(level, "manage");

  // Load the PDF through a short-lived signed URL minted after a server-side permission check.
  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    (async () => {
      try {
        const { url } = await api<{ url: string }>(`/api/schematics/${schematicId}/file`);
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const loading = pdfjs.getDocument({ url });
        task = loading;
        const doc = await loading.promise;
        if (cancelled) return;
        setPdf(doc);
        setNumPages(doc.numPages);
        setPageNum((n) => Math.min(Math.max(1, n), doc.numPages));
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message || "Could not load the document.");
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [schematicId, attempt]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    pdf.getPage(pageNum).then((p) => !cancelled && setPage(p)).catch((e) => setLoadError(String(e)));
    return () => { cancelled = true; };
  }, [pdf, pageNum]);

  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("page", String(pageNum));
    window.history.replaceState(null, "", u);
  }, [pageNum]);

  const loadAnnotations = useCallback(async (focusId?: string) => {
    const r = await api<{ data: Ann[] }>(`/api/annotations?schematic_id=${schematicId}`);
    setAnnotations(r.data);
    setDraft(null);
    if (focusId) setSelectedId(focusId);
  }, [schematicId]);
  useEffect(() => { void loadAnnotations().catch((e) => setLoadError((e as Error).message)); }, [loadAnnotations]);

  // Track available space for fit modes.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setBox({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const baseSize = useMemo(() => {
    if (!page) return null;
    const vp = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
    return { width: vp.width, height: vp.height };
  }, [page, rotation]);

  const scale = useMemo(() => {
    if (!baseSize) return 1;
    if (zoom.mode === "custom") return zoom.value;
    return Math.max(0.1, fitScale(baseSize, box, zoom.mode, isDesktop ? 24 : 8));
  }, [baseSize, zoom, box, isDesktop]);
  const shown = baseSize ? { width: baseSize.width * scale, height: baseSize.height * scale } : null;

  /** Zoom to an absolute scale, keeping the page point under (clientX, clientY) fixed (defaults to the viewport centre). */
  const zoomTo = (next: number, clientX?: number, clientY?: number) => {
    const el = scroller.current;
    const fr = frame.current;
    if (el && fr) {
      const er = el.getBoundingClientRect();
      const r = fr.getBoundingClientRect();
      const cx = clientX ?? er.left + er.width / 2;
      const cy = clientY ?? er.top + er.height / 2;
      anchor.current = {
        cx, cy,
        fx: r.width ? Math.min(1, Math.max(0, (cx - r.left) / r.width)) : 0.5,
        fy: r.height ? Math.min(1, Math.max(0, (cy - r.top) / r.height)) : 0.5,
      };
    }
    setZoom({ mode: "custom", value: Math.min(8, Math.max(0.1, +next.toFixed(3))) });
  };
  const step = (dir: 1 | -1) => zoomTo(scale * (dir > 0 ? 1.25 : 0.8));
  const scaleRef = useRef(scale);
  useLayoutEffect(() => { scaleRef.current = scale; });

  // After the page resizes, scroll so the anchored point is still under the finger / cursor.
  useLayoutEffect(() => {
    const a = anchor.current;
    const el = scroller.current;
    const fr = frame.current;
    if (!a || !el || !fr) return;
    anchor.current = null;
    const r = fr.getBoundingClientRect();
    el.scrollLeft += r.left + a.fx * r.width - a.cx;
    el.scrollTop += r.top + a.fy * r.height - a.cy;
  }, [scale]);

  // Ctrl/⌘ + wheel (also how a trackpad pinch arrives) zooms at the cursor instead of zooming the whole browser page.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomTo(scaleRef.current * Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.0025)), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const goto = (n: number) => { setSelectedId(null); setDraft(null); setPageNum(Math.min(Math.max(1, n), Math.max(1, numPages))); };
  const rotate = () => setRotation((r) => normalizeRotation(r + 90));

  useEffect(() => {
    const typing = (t: HTMLElement) => ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable;
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target as HTMLElement) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === " ") { setSpacePan(true); e.preventDefault(); return; }
      const t = TOOLS.find((x) => x.key.toLowerCase() === k && levelAtLeast(level, x.needs));
      if (t) { setTool(t.id); if (t.id !== "select" && t.id !== "pan") setSelectedId(null); return; }
      if (k === "+" || k === "=") step(1);
      else if (k === "-") step(-1);
      else if (k === "w") setZoom({ mode: "width" });
      else if (k === "f") setZoom({ mode: "page" });
      else if (k === "r") rotate();
      else if (k === "a") setShowAnn((v) => !v);
      else if (k === "]" ) setSidebar((v) => !v);
      else if (k === "PageDown" || k === "ArrowRight") goto(pageNum + 1);
      else if (k === "PageUp" || k === "ArrowLeft") goto(pageNum - 1);
      else if (k === "Escape") { setDraft(null); setSelectedId(null); setTool("select"); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") { setSpacePan(false); panning.current = null; }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); };
  });

  // On a phone the sheet covers the lower part of the screen: bring a freshly placed pin into the visible upper area.
  useEffect(() => {
    if (!draft || isDesktop) return;
    const raf = requestAnimationFrame(() => {
      const el = scroller.current;
      const mk = el?.querySelector('[data-testid="draft-marker"]');
      if (!el || !mk) return;
      const er = el.getBoundingClientRect();
      const mr = mk.getBoundingClientRect();
      el.scrollTo({
        top: el.scrollTop + (mr.top - er.top) - er.height * 0.18,
        left: el.scrollLeft + (mr.left - er.left) - er.width / 2 + mr.width / 2,
        behavior: "auto",
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [draft, isDesktop]);

  const pageAnns = annotations.filter((a) => a.page_number === pageNum);
  // Numbering uses position in the full list so it matches the sidebar.
  const numbered = pageAnns;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="schematic-viewer">
      <div className="flex flex-wrap items-center gap-1 border-b bg-background px-2 py-1.5" role="toolbar" aria-label="Viewer controls">
        {/* row 1 on a phone: what you are looking at and where you are */}
        <div className="flex min-w-0 flex-1 items-center gap-1 md:flex-none">
          <div className="mr-1 min-w-0 truncate text-sm font-medium max-md:flex-1 md:mr-2 md:max-w-xs">{props.title}</div>
          <ToolButton variant="ghost" aria-label="Previous page" onClick={() => goto(pageNum - 1)} disabled={pageNum <= 1}><ChevronLeft /></ToolButton>
          <span className="flex items-center gap-1 text-sm tabular-nums" data-testid="page-indicator">
            <input
              aria-label="Go to page"
              inputMode="numeric"
              className="h-7 w-10 rounded border bg-transparent text-center text-sm tabular-nums"
              value={pageDraft ?? String(pageNum)}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setPageDraft(e.target.value.replace(/\D/g, ""))}
              onBlur={() => { if (pageDraft) goto(parseInt(pageDraft, 10)); setPageDraft(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); else if (e.key === "Escape") { setPageDraft(null); e.currentTarget.blur(); } }}
            />
            <span>/ {numPages || "–"}</span>
          </span>
          <ToolButton variant="ghost" aria-label="Next page" onClick={() => goto(pageNum + 1)} disabled={pageNum >= numPages}><ChevronRight /></ToolButton>
        </div>

        {/* row 2 on a phone: just the tools (zoom/fit/rotate float over the drawing; pinch also works); same row as the rest on desktop */}
        <div className="order-3 flex w-full items-center justify-between gap-1 md:order-none md:w-auto md:flex-1 md:flex-nowrap md:justify-start">
          <div className="hidden items-center gap-1 md:flex">
          <span className="mx-1 hidden h-5 w-px bg-border md:inline-block" />
          <ToolButton variant="ghost" aria-label="Zoom out" title="Zoom out (−)" onClick={() => step(-1)}><ZoomOut /></ToolButton>
          <span className="w-12 text-center text-sm tabular-nums max-md:hidden" data-testid="zoom-level">{Math.round(scale * 100)}%</span>
          <ToolButton variant="ghost" aria-label="Zoom in" title="Zoom in (+)" onClick={() => step(1)}><ZoomIn /></ToolButton>
          <ToolButton variant={zoom.mode === "width" ? "secondary" : "ghost"} aria-label="Fit to width" title="Fit to width (W)" onClick={() => setZoom({ mode: "width" })}><MoveHorizontal /></ToolButton>
          <ToolButton variant={zoom.mode === "page" ? "secondary" : "ghost"} aria-label="Fit to page" title="Fit to page (F)" onClick={() => setZoom({ mode: "page" })}><Maximize2 /></ToolButton>
          <ToolButton variant="ghost" aria-label="Rotate view 90 degrees" title="Rotate (R)" onClick={rotate}><RotateCw /></ToolButton>
          </div>
          <span className="mx-1 hidden h-5 w-px bg-border md:inline-block" />
          {TOOLS.filter((t) => levelAtLeast(level, t.needs)).map((t) => (
            <ToolButton
              key={t.id}
              variant={tool === t.id ? "default" : "ghost"}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              title={`${t.label} (${t.key})`}
              data-testid={`tool-${t.id}`}
              onClick={() => { setTool(t.id); if (t.id !== "select" && t.id !== "pan") { setSelectedId(null); } }}
            >
              <t.icon />
            </ToolButton>
          ))}
          {!canComment && <span className="ml-1 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">View only</span>}
          <span className="mx-1 hidden h-5 w-px bg-border md:inline-block" />
          <ToolButton variant="ghost" aria-label={showAnn ? "Hide annotations" : "Show annotations"} aria-pressed={showAnn} title="Show / hide annotations (A)" data-testid="toggle-annotations" onClick={() => setShowAnn((v) => !v)}>
            {showAnn ? <Eye /> : <EyeOff />}
          </ToolButton>
        </div>

        <ToolButton
          variant="ghost"
          className="shrink-0 max-md:hidden md:ml-auto"
          aria-label={sidebar ? "Collapse annotations panel" : "Expand annotations panel"}
          aria-expanded={sidebar}
          data-testid="toggle-panel"
          onClick={() => setSidebar((v) => !v)}
        >
          {sidebar ? <PanelRightClose /> : <PanelRightOpen />}
        </ToolButton>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* phones: zoom / fit / rotate float over the drawing, out of the toolbar */}
        <div className={cn("absolute bottom-3 right-3 z-30 flex flex-col gap-1 rounded-xl border bg-background/90 p-1 shadow-md backdrop-blur md:hidden", sheet && "hidden")}>
          <ToolButton variant="ghost" aria-label="Zoom in" onClick={() => step(1)}><ZoomIn /></ToolButton>
          <ToolButton variant="ghost" aria-label="Zoom out" onClick={() => step(-1)}><ZoomOut /></ToolButton>
          <ToolButton variant="ghost" aria-label={zoom.mode === "width" ? "Fit to page" : "Fit to width"} onClick={() => setZoom({ mode: zoom.mode === "width" ? "page" : "width" })}>{zoom.mode === "width" ? <Maximize2 /> : <MoveHorizontal />}</ToolButton>
          <ToolButton variant="ghost" aria-label="Rotate view 90 degrees" onClick={rotate}><RotateCw /></ToolButton>
        </div>
        <div
          ref={scroller}
          data-testid="viewer-scroller"
          className={cn("min-w-0 flex-1 overflow-auto bg-muted/60 p-2 md:p-6", (tool === "pan" || spacePan) && "cursor-grab", sheet && "max-md:pb-[50dvh]")}
          // pan-x/pan-y: the browser still scrolls with one finger, but leaves two-finger pinch to us (zooms the drawing, not the page)
          style={{ touchAction: tool === "pan" || spacePan ? "none" : "pan-x pan-y" }}
          onPointerDown={(e) => {
            const el = scroller.current;
            if (!el) return;
            if (e.pointerType === "touch") {
              pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              if (pointers.current.size === 2) {
                const [a, b] = [...pointers.current.values()];
                pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale };
                setDraft(null);
                return;
              }
            }
            // desktop: pan tool, Space + drag, or middle mouse button
            if (tool !== "pan" && !spacePan && e.button !== 1) return;
            e.preventDefault();
            panning.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
            el.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const el = scroller.current;
            if (!el) return;
            if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pinch.current && pointers.current.size >= 2) {
              const [a, b] = [...pointers.current.values()];
              const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
              zoomTo(pinch.current.scale * (d / pinch.current.dist), (a.x + b.x) / 2, (a.y + b.y) / 2);
              return;
            }
            if (!panning.current) return;
            el.scrollLeft = panning.current.sl - (e.clientX - panning.current.x);
            el.scrollTop = panning.current.st - (e.clientY - panning.current.y);
          }}
          onPointerUp={(e) => {
            pointers.current.delete(e.pointerId);
            if (pointers.current.size < 2) pinch.current = null;
            panning.current = null;
          }}
          onPointerCancel={(e) => {
            pointers.current.delete(e.pointerId);
            if (pointers.current.size < 2) pinch.current = null;
            panning.current = null;
          }}
        >
          {loadError ? (
            <div role="alert" className="mx-auto mt-10 max-w-md rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
              <p className="font-medium">Could not open this schematic</p>
              <p className="text-muted-foreground">{loadError}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                data-testid="retry-load"
                onClick={() => {
                  setLoadError(null);
                  setPdf(null);
                  setPage(null);
                  setAttempt((n) => n + 1);
                  void loadAnnotations().catch((e) => setLoadError((e as Error).message));
                }}
              >
                Try again
              </Button>
            </div>
          ) : !page || !shown ? (
            <p className="p-6 text-sm text-muted-foreground" aria-busy="true">Loading drawing…</p>
          ) : (
            <div ref={frame} className="relative mx-auto w-fit" style={{ width: shown.width, height: shown.height }} data-testid="page-frame" data-page={pageNum}>
              <PdfCanvas page={page} scale={scale} rotation={rotation} />
              <AnnotationOverlay
                width={shown.width}
                height={shown.height}
                rotation={rotation}
                pageNumber={pageNum}
                annotations={numbered}
                draft={draft}
                selectedId={selectedId}
                tool={tool}
                visible={showAnn}
                onSelect={(id) => { setSelectedId(id); setDraft(null); openPanel(); setTab("notes"); }}
                onDraft={(d) => { setDraft(d); setSelectedId(null); openPanel(); setTab("notes"); setTool("select"); }}
              />
            </div>
          )}
        </div>

        {!sidebar && (
          <button
            type="button"
            onClick={() => setSidebar(true)}
            data-testid="annotations-rail"
            aria-label="Expand annotations panel"
            aria-expanded={false}
            className="hidden w-9 shrink-0 flex-col items-center gap-2 border-l bg-background py-3 text-sm font-medium hover:bg-muted md:flex"
          >
            <ChevronLeft className="size-4" aria-hidden />
            <span className="[writing-mode:vertical-rl]">Annotations</span>
            <CountBadge n={annotations.length} />
          </button>
        )}
        {panelOpen && (
          <aside
            className={cn(
              "flex flex-col bg-background md:w-80 md:shrink-0 md:border-l",
              "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:h-[46dvh] max-md:rounded-t-2xl max-md:border-t max-md:shadow-2xl",
              !sheet && "max-md:hidden", // server-rendered HTML never flashes the sheet open on a phone
            )}
            aria-label="Annotations sidebar"
            data-testid="annotation-sidebar"
          >
            <button
              type="button"
              onClick={() => setSheet(false)}
              aria-label="Close annotations panel"
              aria-expanded
              className="flex shrink-0 flex-col items-stretch border-b px-4 pb-1 pt-1.5 text-left md:hidden"
            >
              <span aria-hidden className="mx-auto h-1 w-10 rounded-full bg-muted-foreground/30" />
              <span className="flex h-10 items-center justify-between text-sm font-semibold">
                <span className="flex items-center gap-2"><MessageSquare className="size-4" aria-hidden /> Annotations <CountBadge n={annotations.length} /></span>
                <ChevronDown className="size-5" aria-hidden />
              </span>
            </button>
            <div className="flex border-b text-sm" role="tablist">
              {([["notes", "Notes"], ...(canManage ? [["access", "Access"]] : []), ["info", "Details"]] as [typeof tab, string][]).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={cn("flex-1 border-b-2 px-3 py-2 font-medium", tab === id ? "border-primary" : "border-transparent text-muted-foreground")}>
                  {label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {tab === "notes" && (
                <AnnotationPanel
                  annotations={annotations}
                  selectedId={selectedId}
                  onSelect={(id) => {
                    const a = annotations.find((x) => x.id === id);
                    if (a && a.page_number !== pageNum) setPageNum(a.page_number);
                    setSelectedId(id);
                  }}
                  currentPage={pageNum}
                  level={level}
                  userId={props.userId}
                  machineId={props.machineId}
                  canReport={props.canReport}
                  draft={draft}
                  onCancelDraft={() => setDraft(null)}
                  onChanged={loadAnnotations}
                  schematicId={schematicId}
                />
              )}
              {tab === "access" && canManage && <GrantsPanel schematicId={schematicId} members={props.members} groups={props.groups} />}
              {tab === "info" && (
                <dl className="space-y-3 p-3 text-sm">
                  {([
                    ["Document number", props.meta.documentNumber], ["Revision", props.meta.revision], ["Machine", props.meta.machineName],
                    ["Uploaded by", props.meta.uploader], ["Uploaded", props.meta.uploadedAt], ["Your access", level],
                  ] as const).map(([k, v]) => (<div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium capitalize-first">{v}</dd></div>))}
                </dl>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* phones: a tab docked at the bottom; tap to pull the panel up */}
      {!sheet && (
        <button
          type="button"
          onClick={() => setSheet(true)}
          data-testid="annotations-tab"
          aria-expanded={false}
          aria-label="Open annotations panel"
          className="flex h-12 shrink-0 items-center justify-between rounded-t-2xl border-t bg-background px-4 text-sm font-semibold shadow-[0_-2px_8px_rgba(0,0,0,0.08)] md:hidden"
        >
          <span className="flex items-center gap-2"><MessageSquare className="size-4" aria-hidden /> Annotations <CountBadge n={annotations.length} /></span>
          <ChevronUp className="size-5" aria-hidden />
        </button>
      )}
    </div>
  );
}

function CountBadge({ n }: { n: number }) {
  if (n === 0) return null;
  return <span className="grid min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold leading-5 text-primary-foreground">{n}</span>;
}
