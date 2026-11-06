"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { IssueStatusBadge, PriorityBadge, SeverityBadge, fmtDate, selectClass } from "@/components/ui-bits";
import { PRIORITY_LABEL, REPAIR_PRIORITIES, STATUS_LABEL, WORKING_STATUSES } from "@/lib/priority";
import { levelAtLeast, type PermLevel } from "@/lib/permissions";
import { ISSUE_STATUSES, SEVERITIES } from "@/lib/schemas";
import { Attachments } from "./attachments";
import { api, colorFor, linkHref, one, type Ann, type Draft, type Reply } from "./types";
import { cn } from "@/lib/utils";

interface LinkOption { id: string; title: string; machine_name: string }

/** Drawings of this machine's sub-parts that an annotation may link to (empty when the machine has none). */
function useLinkable(schematicId: string) {
  const [opts, setOpts] = useState<LinkOption[]>([]);
  useEffect(() => {
    let off = false;
    api<{ data: LinkOption[] }>(`/api/schematics/${schematicId}/linkable`).then((r) => { if (!off) setOpts(r.data); }).catch(() => {});
    return () => { off = true; };
  }, [schematicId]);
  return opts;
}

export interface LinkValue { s: string; a: string; p: string }
const NO_LINK: LinkValue = { s: "", a: "", p: "" };

/** Choose a sub-machine drawing and, optionally, a page or a specific pin on it to open on. */
function LinkField({ id, value, onChange, opts, disabled, label }: { id: string; value: LinkValue; onChange: (v: LinkValue) => void; opts: LinkOption[]; disabled?: boolean; label?: string }) {
  const [pins, setPins] = useState<Ann[]>([]);
  useEffect(() => {
    if (!value.s) return;
    let off = false;
    api<{ data: Ann[] }>(`/api/annotations?schematic_id=${value.s}`).then((r) => { if (!off) setPins(r.data); }).catch(() => { if (!off) setPins([]); });
    return () => { off = true; };
  }, [value.s]);
  const shown = value.s ? pins : [];
  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs text-muted-foreground" htmlFor={id}>{label ?? "Links to schematic"}</label>
        <select id={id} value={value.s} disabled={disabled} onChange={(e) => onChange(e.target.value ? { s: e.target.value, a: "", p: "" } : NO_LINK)} className={selectClass}>
          <option value="">No link</option>
          {opts.map((o) => <option key={o.id} value={o.id}>{o.title} — {o.machine_name}</option>)}
        </select>
      </div>
      {value.s && (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor={`${id}-spot`}>Opens on</label>
            <select id={`${id}-spot`} value={value.a} disabled={disabled} className={selectClass}
              onChange={(e) => { const pin = shown.find((x) => x.id === e.target.value); onChange({ s: value.s, a: e.target.value, p: pin ? String(pin.page_number) : value.p }); }}>
              <option value="">A page (no specific spot)</option>
              {shown.map((x, i) => <option key={x.id} value={x.id}>#{i + 1} · p.{x.page_number} · {(x.body || TYPE_LABEL[x.type]).slice(0, 40)}</option>)}
            </select>
          </div>
          {!value.a && (
            <div className="w-20 shrink-0">
              <label className="mb-1 block text-xs text-muted-foreground" htmlFor={`${id}-page`}>Page</label>
              <input id={`${id}-page`} inputMode="numeric" disabled={disabled} placeholder="1" value={value.p}
                onChange={(e) => onChange({ ...value, p: e.target.value.replace(/[^0-9]/g, "").slice(0, 4) })} className={selectClass} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const linkPatch = (v: LinkValue) => ({
  linked_schematic_id: v.s || null,
  linked_annotation_id: v.s && v.a ? v.a : null,
  linked_page: v.s && (v.a || v.p) ? Number(v.p) || null : null,
});

const TYPE_LABEL = { point: "Point marker", comment: "Comment", box: "Issue box", callout: "Callout", pen: "Pen stroke", arrow: "Arrow", highlight: "Highlight" } as const;

interface Props {
  annotations: Ann[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  currentPage: number;
  level: PermLevel;
  userId: string;
  machineId: string;
  canReport: boolean;
  draft: Draft | null;
  onCancelDraft: () => void;
  onChanged: (focusId?: string) => Promise<void> | void;
  schematicId: string;
  currentRevision: string;
  /** bumped by realtime events so open threads reload */
  liveTick: number;
  /** viewing a superseded revision: read-only */
  readOnly?: boolean;
}

export function AnnotationPanel(p: Props) {
  const [onlyPage, setOnlyPage] = useState(true);
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fType, setFType] = useState("");
  const [mine, setMine] = useState(false);
  const selected = p.annotations.find((a) => a.id === p.selectedId) ?? null;
  const needle = q.trim().toLowerCase();
  const filtering = !!(needle || fStatus || fType || mine);
  const list = p.annotations
    .map((a, i) => ({ a, n: i + 1 }))
    .filter(({ a }) => !onlyPage || a.page_number === p.currentPage)
    .filter(({ a }) => !fStatus || (fStatus === "none" ? !a.status : a.status === fStatus))
    .filter(({ a }) => !fType || a.type === fType)
    .filter(({ a }) => !mine || a.author_id === p.userId)
    .filter(({ a }) => !needle || `${a.body} ${one(a.author)?.display_name ?? ""} ${TYPE_LABEL[a.type]}`.toLowerCase().includes(needle));

  if (p.draft) return <DraftForm {...p} draft={p.draft} />;
  if (selected) return <Thread {...p} ann={selected} number={p.annotations.indexOf(selected) + 1} />;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
        <span className="font-medium">{list.length} annotation{list.length === 1 ? "" : "s"}</span>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={onlyPage} onChange={(e) => setOnlyPage(e.target.checked)} /> This page only
        </label>
      </div>
      <div className="space-y-1.5 border-b px-3 py-2" data-testid="annotation-filters">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes…" aria-label="Search notes" className="h-8" />
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filter by status" className={cn(selectClass, "h-8 w-auto flex-1")}>
            <option value="">Any status</option>
            <option value="none">No status</option>
            {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
          <select value={fType} onChange={(e) => setFType(e.target.value)} aria-label="Filter by type" className={cn(selectClass, "h-8 w-auto flex-1")}>
            <option value="">Any type</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine</label>
          {filtering && <button type="button" className="text-xs text-primary hover:underline" onClick={() => { setQ(""); setFStatus(""); setFType(""); setMine(false); }}>Clear</button>}
        </div>
      </div>
      <ul className="flex-1 divide-y overflow-auto" data-testid="annotation-list">
        {list.length === 0 && (
          <li className="p-4 text-sm text-muted-foreground">
            {filtering ? "No notes match these filters." : levelAtLeast(p.level, "comment") && !p.readOnly ? "Choose a tool above, then click the drawing to add a marker, comment or box." : "No annotations on this page."}
          </li>
        )}
        {list.map(({ a, n }) => (
          <li key={a.id}>
            <button className="flex w-full items-start gap-2 p-3 text-left text-sm hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => p.onSelect(a.id)}>
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: colorFor(a.status) }}>{n}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{a.body || TYPE_LABEL[a.type]}</span>
                <span className="block text-xs text-muted-foreground">
                  p.{a.page_number} · {one(a.author)?.display_name} · {a.replies?.[0]?.count ?? 0} repl{(a.replies?.[0]?.count ?? 0) === 1 ? "y" : "ies"}
                  {(a.attachments?.[0]?.count ?? 0) > 0 && ` · ${a.attachments![0].count} attached`}
                  {a.link_broken_at && <span className="ml-1 rounded bg-destructive/15 px-1 text-destructive" title={a.link_broken_note ?? "The linked part was removed"}>link broken</span>}
                  {a.schematic_revision && a.schematic_revision !== p.currentRevision && <span className="ml-1 rounded bg-amber-500/20 px-1 text-amber-700 dark:text-amber-400" title="Placed on an earlier revision: check its position">rev {a.schematic_revision}</span>}
                </span>
              </span>
              {a.status && <IssueStatusBadge status={a.status} />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DraftForm({ draft, schematicId, onCancelDraft, onChanged }: Props & { draft: Draft }) {
  const needsText = draft.type === "comment" || draft.type === "callout";
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<string>("");
  const [link, setLink] = useState<LinkValue>(NO_LINK);
  const linkable = useLinkable(schematicId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ data: Ann }>("/api/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schematic_id: schematicId,
          page_number: draft.page_number,
          type: draft.type,
          x: draft.x,
          y: draft.y,
          ...(draft.width ? { width: draft.width, height: draft.height } : {}),
          body,
          status: status || null,
          ...(link.s ? linkPatch(link) : {}),
          ...(draft.path ? { path: draft.path } : {}),
        }),
      });
      toast.success("Annotation saved");
      await onChanged(res.data.id);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={save} className="space-y-3 p-3" aria-label="New annotation">
      <h2 className="text-sm font-semibold">New {TYPE_LABEL[draft.type].toLowerCase()} · page {draft.page_number}</h2>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        required={needsText}
        autoFocus
        maxLength={4000}
        placeholder={needsText ? "Write your note…" : "Optional note"}
        aria-label="Annotation text"
      />
      <div>
        <label className="mb-1 block text-xs text-muted-foreground" htmlFor="ann-status">Status label</label>
        <select id="ann-status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
          <option value="">None</option>
          {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </div>
      {linkable.length > 0 && <LinkField id="ann-link" value={link} onChange={setLink} opts={linkable} />}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy} data-testid="save-annotation">{busy ? "Saving…" : "Save annotation"}</Button>
        <Button type="button" variant="ghost" onClick={onCancelDraft}>Cancel</Button>
      </div>
    </form>
  );
}

function Thread(p: Props & { ann: Ann; number: number }) {
  const { ann } = p;
  const [replies, setReplies] = useState<Reply[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showIssue, setShowIssue] = useState(false);
  const issue = one(ann.issue);
  const linked = one(ann.linked);
  const broken = !!ann.link_broken_at;
  const linkable = useLinkable(p.schematicId);
  const router = useRouter();
  const isAuthor = ann.author_id === p.userId;
  const canEdit = levelAtLeast(p.level, "edit") || (isAuthor && levelAtLeast(p.level, "comment"));
  const canDelete = levelAtLeast(p.level, "manage") || (isAuthor && levelAtLeast(p.level, "comment"));

  const load = useCallback(async () => {
    try {
      const r = await api<{ data: Reply[] }>(`/api/annotations/${ann.id}/replies`);
      setReplies(r.data);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [ann.id]);
  useEffect(() => { void load(); }, [load, p.liveTick]);

  async function reply(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/api/annotations/${ann.id}/replies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: text }) });
      setText("");
      await load();
      await p.onChanged(ann.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function setStatus(status: string) {
    setError(null);
    try {
      await api(`/api/annotations/${ann.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: status || null }) });
      await p.onChanged(ann.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function setLink(v: LinkValue) {
    setError(null);
    try {
      await api(`/api/annotations/${ann.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(linkPatch(v)) });
      await p.onChanged(ann.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function removeLink() {
    if (!confirm("Remove this link permanently? The note about the removed part will be discarded too.")) return;
    await setLink(NO_LINK);
    toast.success("Link removed");
  }
  async function remove() {
    if (!confirm("Delete this annotation and its replies?")) return;
    try {
      await api(`/api/annotations/${ann.id}`, { method: "DELETE" });
      p.onSelect(null);
      await p.onChanged();
      toast.success("Annotation deleted");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="flex h-full flex-col" data-testid="annotation-thread">
      <div className="flex items-center gap-2 border-b p-2">
        <Button size="sm" variant="ghost" onClick={() => p.onSelect(null)}>← All</Button>
        <span className="ml-auto text-xs text-muted-foreground">#{p.number} · {TYPE_LABEL[ann.type]} · p.{ann.page_number}</span>
      </div>
      <div className="flex-1 space-y-3 overflow-auto p-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">{one(ann.author)?.display_name} · {fmtDate(ann.created_at, true)}</div>
          <p className="mt-1 whitespace-pre-wrap">{ann.body || <em className="text-muted-foreground">No text</em>}</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="thread-status" className="text-xs text-muted-foreground">Status</label>
          <select id="thread-status" value={ann.status ?? ""} disabled={!canEdit} onChange={(e) => setStatus(e.target.value)} className={cn(selectClass, "w-40")}>
            <option value="">None</option>
            {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
          {canDelete && <Button size="sm" variant="destructive" className="ml-auto" onClick={remove}>Delete</Button>}
        </div>

        {broken && (
          <div role="alert" data-testid="broken-link" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs">
            <div className="font-medium">Link no longer valid</div>
            <p>{ann.link_broken_note}</p>
            {canEdit && !p.readOnly ? (
              <>
                <p>Choose another part below to replace it, or remove the link.</p>
                <Button size="sm" variant="destructive" data-testid="remove-link" onClick={removeLink}>Remove link permanently</Button>
              </>
            ) : (
              <p>Ask someone with edit access to replace or remove it.</p>
            )}
          </div>
        )}
        {linked && !broken && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2 text-xs" data-testid="linked-schematic">
            <div className="min-w-0 flex-1">
              <div className="font-medium">Linked schematic</div>
              <div className="truncate">{linked.title}{one(linked.machine)?.name ? ` · ${one(linked.machine)!.name}` : ""}</div>
            </div>
            <Button size="sm" onClick={() => router.push(linkHref(ann, p.schematicId)!)}>Open</Button>
          </div>
        )}
        {canEdit && !p.readOnly && (linkable.length > 0 || ann.linked_schematic_id) && (
          <LinkField
            id="thread-link"
            label={broken ? "Replace with another part" : undefined}
            value={broken ? NO_LINK : { s: ann.linked_schematic_id ?? "", a: ann.linked_annotation_id ?? "", p: ann.linked_page ? String(ann.linked_page) : "" }}
            onChange={setLink}
            opts={linkable}
          />
        )}
        {ann.schematic_revision && ann.schematic_revision !== p.currentRevision && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs" data-testid="stale-note">
            Placed on revision {ann.schematic_revision}; this drawing is now revision {p.currentRevision}. Check that the marker still points at the right part.
          </p>
        )}
        <Attachments annotationId={ann.id} canAdd={levelAtLeast(p.level, "comment") && !p.readOnly} userId={p.userId} canManage={levelAtLeast(p.level, "manage")} refreshKey={p.liveTick} onChanged={() => p.onChanged(ann.id)} />

        {issue ? (
          <div className="rounded-lg border bg-muted/40 p-2 text-xs">
            <div className="mb-1 font-medium">Linked maintenance issue</div>
            <div>{issue.title}</div>
            <div className="mt-1 flex flex-wrap gap-1"><PriorityBadge priority={(issue as { repair_priority?: string }).repair_priority} /><SeverityBadge severity={issue.severity} /><IssueStatusBadge status={issue.status} /></div>
          </div>
        ) : p.canReport ? (
          showIssue ? (
            <IssueFromAnnotation ann={ann} machineId={p.machineId} onDone={async () => { setShowIssue(false); await p.onChanged(ann.id); }} />
          ) : (
            <Button size="sm" variant="outline" onClick={() => setShowIssue(true)}>Create maintenance issue</Button>
          )
        ) : null}

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Thread ({replies.length})</h3>
          <ul className="space-y-2">
            {replies.map((r) => (
              <li key={r.id} className={`rounded-lg border p-2 ${r.is_resolution_note ? "border-emerald-500/50 bg-emerald-500/10" : ""}`}>
                <div className="text-xs text-muted-foreground">{one(r.author)?.display_name} · {fmtDate(r.created_at, true)}{r.is_resolution_note && " · Resolution note"}</div>
                <p className="mt-0.5 whitespace-pre-wrap">{r.body}</p>
              </li>
            ))}
          </ul>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      {levelAtLeast(p.level, "comment") ? (
        <form onSubmit={reply} className="flex gap-2 border-t p-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} required placeholder="Reply…" aria-label="Reply" maxLength={4000} />
          <Button type="submit">Reply</Button>
        </form>
      ) : (
        <p className="border-t p-3 text-xs text-muted-foreground">You have view-only access to this schematic.</p>
      )}
    </div>
  );
}

function IssueFromAnnotation({ ann, machineId, onDone }: { ann: Ann; machineId: string; onDone: () => Promise<void> }) {
  const [title, setTitle] = useState(ann.body.slice(0, 80));
  const [severity, setSeverity] = useState("medium");
  const [priority, setPriority] = useState("normal");
  const [workStatus, setWorkStatus] = useState("open");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machine_id: machineId, annotation_id: ann.id, title, description: ann.body, severity, repair_priority: priority, status: workStatus }),
      });
      toast.success("Issue created");
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border p-2">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Issue title" aria-label="Issue title" />
      <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={selectClass} aria-label="Severity">
        {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className={selectClass} aria-label="Priority of repair">
          {REPAIR_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]} priority</option>)}
        </select>
        <select value={workStatus} onChange={(e) => setWorkStatus(e.target.value)} className={selectClass} aria-label="Status">
          {WORKING_STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
        </select>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <Button size="sm" type="submit">Create issue</Button>
    </form>
  );
}
