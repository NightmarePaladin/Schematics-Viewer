"use client";

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import {
  ChevronLeft, ChevronRight, Eye, EyeOff, Hand, Maximize2, MessageSquare, MousePointer2, MapPin, PanelRightClose,
  PanelRightOpen, RotateCw, Square, StickyNote, ZoomIn, ZoomOut, MoveHorizontal,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const TOOLS: { id: Tool; label: string; icon: React.ElementType; needs: "view" | "comment" }[] = [
  { id: "select", label: "Select", icon: MousePointer2, needs: "view" },
  { id: "pan", label: "Pan", icon: Hand, needs: "view" },
  { id: "point", label: "Point marker", icon: MapPin, needs: "comment" },
  { id: "comment", label: "Text comment", icon: MessageSquare, needs: "comment" },
  { id: "box", label: "Issue box", icon: Square, needs: "comment" },
  { id: "callout", label: "Quote / callout", icon: StickyNote, needs: "comment" },
];

export function SchematicViewer(props: ViewerProps) {
  const { schematicId, level } = props;
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [pageNum, setPageNum] = useState(props.initialPage);
  const [numPages, setNumPages] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>({ mode: "width" });
  const [rotation, setRotation] = useState<Rotation>(0);
  const [tool, setTool] = useState<Tool>("select");
  const [showAnn, setShowAnn] = useState(true);
  const [sidebar, setSidebar] = useState(true);
  const [tab, setTab] = useState<"notes" | "access" | "info">("notes");
  const [annotations, setAnnotations] = useState<Ann[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [box, setBox] = useState({ width: 800, height: 600 });
  const scroller = useRef<HTMLDivElement>(null);
  const panning = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);

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
  }, [schematicId]);

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
    return Math.max(0.1, fitScale(baseSize, box, zoom.mode));
  }, [baseSize, zoom, box]);
  const shown = baseSize ? { width: baseSize.width * scale, height: baseSize.height * scale } : null;

  const step = (dir: 1 | -1) => setZoom({ mode: "custom", value: Math.min(8, Math.max(0.1, +(scale * (dir > 0 ? 1.25 : 0.8)).toFixed(3))) });
  const goto = (n: number) => { setSelectedId(null); setDraft(null); setPageNum(Math.min(Math.max(1, n), Math.max(1, numPages))); };
  const rotate = () => setRotation((r) => normalizeRotation(r + 90));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.key === "+" || e.key === "=") step(1);
      else if (e.key === "-") step(-1);
      else if (e.key === "PageDown" || e.key === "ArrowRight") goto(pageNum + 1);
      else if (e.key === "PageUp" || e.key === "ArrowLeft") goto(pageNum - 1);
      else if (e.key === "Escape") { setDraft(null); setSelectedId(null); setTool("select"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const pageAnns = annotations.filter((a) => a.page_number === pageNum);
  // Numbering uses position in the full list so it matches the sidebar.
  const numbered = pageAnns;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="schematic-viewer">
      <div className="flex flex-wrap items-center gap-1 border-b bg-background px-2 py-1.5" role="toolbar" aria-label="Viewer controls">
        <div className="mr-2 min-w-0 truncate text-sm font-medium">{props.title}</div>
        <Button size="icon-sm" variant="ghost" aria-label="Previous page" onClick={() => goto(pageNum - 1)} disabled={pageNum <= 1}><ChevronLeft /></Button>
        <span className="text-sm tabular-nums" data-testid="page-indicator">{pageNum} / {numPages || "–"}</span>
        <Button size="icon-sm" variant="ghost" aria-label="Next page" onClick={() => goto(pageNum + 1)} disabled={pageNum >= numPages}><ChevronRight /></Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => step(-1)}><ZoomOut /></Button>
        <span className="w-12 text-center text-sm tabular-nums" data-testid="zoom-level">{Math.round(scale * 100)}%</span>
        <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => step(1)}><ZoomIn /></Button>
        <Button size="icon-sm" variant={zoom.mode === "width" ? "secondary" : "ghost"} aria-label="Fit to width" onClick={() => setZoom({ mode: "width" })}><MoveHorizontal /></Button>
        <Button size="icon-sm" variant={zoom.mode === "page" ? "secondary" : "ghost"} aria-label="Fit to page" onClick={() => setZoom({ mode: "page" })}><Maximize2 /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="Rotate view 90 degrees" onClick={rotate}><RotateCw /></Button>
        <span className="mx-1 h-5 w-px bg-border" />
        {TOOLS.filter((t) => levelAtLeast(level, t.needs)).map((t) => (
          <Button
            key={t.id}
            size="icon-sm"
            variant={tool === t.id ? "default" : "ghost"}
            aria-label={t.label}
            aria-pressed={tool === t.id}
            title={t.label}
            data-testid={`tool-${t.id}`}
            onClick={() => { setTool(t.id); if (t.id !== "select" && t.id !== "pan") { setSelectedId(null); } }}
          >
            <t.icon />
          </Button>
        ))}
        {!canComment && <span className="ml-1 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">View only</span>}
        <span className="mx-1 h-5 w-px bg-border" />
        <Button size="icon-sm" variant="ghost" aria-label={showAnn ? "Hide annotations" : "Show annotations"} aria-pressed={showAnn} data-testid="toggle-annotations" onClick={() => setShowAnn((v) => !v)}>
          {showAnn ? <Eye /> : <EyeOff />}
        </Button>
        <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label={sidebar ? "Collapse annotations panel" : "Expand annotations panel"} onClick={() => setSidebar((v) => !v)}>
          {sidebar ? <PanelRightClose /> : <PanelRightOpen />}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          ref={scroller}
          data-testid="viewer-scroller"
          className={cn("min-w-0 flex-1 overflow-auto bg-muted/60 p-6", tool === "pan" && "cursor-grab")}
          onPointerDown={(e) => {
            if (tool !== "pan" || !scroller.current) return;
            panning.current = { x: e.clientX, y: e.clientY, sl: scroller.current.scrollLeft, st: scroller.current.scrollTop };
            scroller.current.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!panning.current || !scroller.current) return;
            scroller.current.scrollLeft = panning.current.sl - (e.clientX - panning.current.x);
            scroller.current.scrollTop = panning.current.st - (e.clientY - panning.current.y);
          }}
          onPointerUp={() => { panning.current = null; }}
        >
          {loadError ? (
            <div role="alert" className="mx-auto mt-10 max-w-md rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
              <p className="font-medium">Could not open this schematic</p>
              <p className="text-muted-foreground">{loadError}</p>
            </div>
          ) : !page || !shown ? (
            <p className="p-6 text-sm text-muted-foreground" aria-busy="true">Loading drawing…</p>
          ) : (
            <div className="relative mx-auto w-fit" style={{ width: shown.width, height: shown.height }} data-testid="page-frame" data-page={pageNum}>
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
                onSelect={(id) => { setSelectedId(id); setDraft(null); setSidebar(true); setTab("notes"); }}
                onDraft={(d) => { setDraft(d); setSelectedId(null); setSidebar(true); setTab("notes"); setTool("select"); }}
              />
            </div>
          )}
        </div>

        {sidebar && (
          <aside className="flex w-80 shrink-0 flex-col border-l bg-background max-md:absolute max-md:inset-y-14 max-md:right-0 max-md:z-30 max-md:shadow-xl" aria-label="Annotations sidebar" data-testid="annotation-sidebar">
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
    </div>
  );
}
