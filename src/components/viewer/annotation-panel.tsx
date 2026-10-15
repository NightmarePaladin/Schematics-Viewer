"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { IssueStatusBadge, SeverityBadge, fmtDate, selectClass } from "@/components/ui-bits";
import { levelAtLeast, type PermLevel } from "@/lib/permissions";
import { ISSUE_STATUSES, SEVERITIES } from "@/lib/schemas";
import { api, colorFor, one, type Ann, type Draft, type Reply } from "./types";

const TYPE_LABEL = { point: "Point marker", comment: "Comment", box: "Issue box", callout: "Callout" } as const;

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
}

export function AnnotationPanel(p: Props) {
  const [onlyPage, setOnlyPage] = useState(true);
  const selected = p.annotations.find((a) => a.id === p.selectedId) ?? null;
  const list = p.annotations.map((a, i) => ({ a, n: i + 1 })).filter(({ a }) => !onlyPage || a.page_number === p.currentPage);

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
      <ul className="flex-1 divide-y overflow-auto" data-testid="annotation-list">
        {list.length === 0 && (
          <li className="p-4 text-sm text-muted-foreground">
            {levelAtLeast(p.level, "comment") ? "Choose a tool above, then click the drawing to add a marker, comment or box." : "No annotations on this page."}
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
  useEffect(() => { void load(); }, [load]);

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
          <select id="thread-status" value={ann.status ?? ""} disabled={!canEdit} onChange={(e) => setStatus(e.target.value)} className={`${selectClass} w-40`}>
            <option value="">None</option>
            {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
          {canDelete && <Button size="sm" variant="destructive" className="ml-auto" onClick={remove}>Delete</Button>}
        </div>

        {issue ? (
          <div className="rounded-lg border bg-muted/40 p-2 text-xs">
            <div className="mb-1 font-medium">Linked maintenance issue</div>
            <div>{issue.title}</div>
            <div className="mt-1 flex gap-1"><SeverityBadge severity={issue.severity} /><IssueStatusBadge status={issue.status} /></div>
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
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machine_id: machineId, annotation_id: ann.id, title, description: ann.body, severity }),
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
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <Button size="sm" type="submit">Create issue</Button>
    </form>
  );
}
