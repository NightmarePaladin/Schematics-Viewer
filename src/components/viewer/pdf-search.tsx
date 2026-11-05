"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { rectStoredToDisplayed, type Rotation } from "@/lib/coords";
import { cn } from "@/lib/utils";

/** A match rectangle as fractions of the page, in the stored (unrotated) frame. */
export interface Hit {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PageText {
  items: { str: string; x: number; y: number; w: number; h: number }[];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Full-text search over the PDF's text layer (works for PDFs with real text; scanned drawings have none). */
export function usePdfSearch(pdf: PDFDocumentProxy | null) {
  const cache = useRef(new Map<number, PageText>());
  const run = useRef(0);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    cache.current.clear();
    setHits([]);
    setActive(0);
  }, [pdf]);

  const pageText = useCallback(
    async (n: number): Promise<PageText> => {
      const hit = cache.current.get(n);
      if (hit) return hit;
      const { Util } = await import("pdfjs-dist");
      const page = await pdf!.getPage(n);
      const vp = page.getViewport({ scale: 1, rotation: page.rotate });
      const tc = await page.getTextContent();
      const items: PageText["items"] = [];
      for (const it of tc.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        const t = Util.transform(vp.transform, it.transform);
        const h = Math.hypot(t[2], t[3]);
        items.push({ str: it.str, x: t[4] / vp.width, y: (t[5] - h) / vp.height, w: (it.width * vp.scale) / vp.width, h: h / vp.height });
      }
      const out = { items };
      cache.current.set(n, out);
      return out;
    },
    [pdf],
  );

  const search = useCallback(
    async (q: string) => {
      setQuery(q);
      const needle = q.trim().toLowerCase();
      const id = ++run.current;
      if (!pdf || needle.length < 2) {
        setHits([]);
        setActive(0);
        setBusy(false);
        return;
      }
      setBusy(true);
      const found: Hit[] = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const { items } = await pageText(n);
        if (id !== run.current) return; // a newer search started
        for (const it of items) {
          const hay = it.str.toLowerCase();
          for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
            const x = it.x + (at / hay.length) * it.w;
            const w = (needle.length / hay.length) * it.w;
            found.push({ page: n, x: clamp01(x), y: clamp01(it.y), width: Math.min(w, 1 - clamp01(x)), height: Math.min(it.h, 1 - clamp01(it.y)) });
          }
        }
      }
      if (id !== run.current) return;
      setHits(found);
      setActive(0);
      setBusy(false);
    },
    [pdf, pageText],
  );

  const next = (dir: 1 | -1) => setActive((a) => (hits.length ? (a + dir + hits.length) % hits.length : 0));
  const close = () => {
    run.current++;
    setOpen(false);
    setQuery("");
    setHits([]);
    setBusy(false);
  };
  return { query, search, hits, active, setActive, next, busy, open, setOpen, close };
}

/** The search bar under the toolbar. */
export function SearchBar({ s }: { s: ReturnType<typeof usePdfSearch> }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const hit = s.hits[s.active];
  return (
    <div className="flex items-center gap-1 border-b bg-background px-2 py-1.5" role="search" data-testid="pdf-search">
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <input
        ref={input}
        aria-label="Search this drawing"
        value={s.query}
        onChange={(e) => void s.search(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); s.next(e.shiftKey ? -1 : 1); }
          else if (e.key === "Escape") s.close();
        }}
        placeholder="Search text in this drawing (part numbers, labels…)"
        className="h-8 min-w-0 flex-1 rounded border bg-transparent px-2 text-sm"
      />
      <span className="w-20 shrink-0 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">
        {s.busy ? "Searching…" : s.query.trim().length < 2 ? "" : s.hits.length ? `${s.active + 1} of ${s.hits.length}${hit ? ` · p.${hit.page}` : ""}` : "No matches"}
      </span>
      <button type="button" aria-label="Previous match" onClick={() => s.next(-1)} disabled={!s.hits.length} className="grid size-8 place-items-center rounded hover:bg-muted disabled:opacity-40"><ChevronUp className="size-4" /></button>
      <button type="button" aria-label="Next match" onClick={() => s.next(1)} disabled={!s.hits.length} className="grid size-8 place-items-center rounded hover:bg-muted disabled:opacity-40"><ChevronDown className="size-4" /></button>
      <button type="button" aria-label="Close search" onClick={s.close} className="grid size-8 place-items-center rounded hover:bg-muted"><X className="size-4" /></button>
    </div>
  );
}

/** Match highlights drawn over the page (current page only). */
export function SearchLayer({ hits, active, page, width, height, rotation }: { hits: Hit[]; active: number; page: number; width: number; height: number; rotation: Rotation }) {
  const mine = hits.map((h, i) => ({ h, i })).filter(({ h }) => h.page === page);
  if (!mine.length) return null;
  return (
    <svg className="pointer-events-none absolute left-0 top-0" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden data-testid="search-highlights">
      {mine.map(({ h, i }) => {
        const r = rectStoredToDisplayed(h, rotation);
        const pad = 2;
        return (
          <rect
            key={i}
            data-active={i === active ? "true" : undefined}
            x={r.x * width - pad}
            y={r.y * height - pad}
            width={r.width * width + pad * 2}
            height={r.height * height + pad * 2}
            rx={2}
            className={cn(i === active ? "fill-orange-500/40 stroke-orange-600" : "fill-yellow-300/50 stroke-yellow-500")}
            strokeWidth={i === active ? 2 : 1}
          />
        );
      })}
    </svg>
  );
}
