"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { selectClass } from "@/components/ui-bits";
import { ORG_ROLES } from "@/lib/permissions";

async function send(url: string, payload: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) {
    const b = await res.json().catch(() => null);
    const d = b?.error?.details;
    throw new Error(Array.isArray(d) ? d.map((x: { message: string }) => x.message).join("; ") : (b?.error?.message ?? "Request failed."));
  }
}

export function TeamsAdmin({
  isAdmin,
  people,
  groups,
}: {
  isAdmin: boolean;
  people: { user_id: string; name: string }[];
  groups: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(fn: () => Promise<void>, ok: string, form?: HTMLFormElement) {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      form?.reset();
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>Manage</CardTitle></CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-3">
        {isAdmin && (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              void run(() => send("/api/members", { email: f.get("email"), role: f.get("role") }), "Member saved.", form);
            }}
          >
            <h3 className="text-sm font-medium">Add or update a member</h3>
            <Input name="email" type="email" required placeholder="registered user's email" aria-label="Member email" />
            <select name="role" className={selectClass} defaultValue="technician" aria-label="Role">
              {ORG_ROLES.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
            </select>
            <Button type="submit" size="sm">Save member</Button>
            <p className="text-xs text-muted-foreground">The person must have signed up first.</p>
          </form>
        )}
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            void run(() => send("/api/groups", { name: f.get("name"), description: f.get("description") }), "Group created.", form);
          }}
        >
          <h3 className="text-sm font-medium">Create group</h3>
          <Input name="name" required placeholder="e.g. Night shift" aria-label="Group name" />
          <Input name="description" placeholder="Description (optional)" aria-label="Group description" />
          <Button type="submit" size="sm">Create group</Button>
        </form>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            void run(() => send(`/api/groups/${f.get("group")}/members`, { user_id: f.get("user") }), "Added to group.", form);
          }}
        >
          <h3 className="text-sm font-medium">Add member to group</h3>
          <select name="group" required className={selectClass} aria-label="Group" defaultValue="">
            <option value="" disabled>Choose group</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select name="user" required className={selectClass} aria-label="Person" defaultValue="">
            <option value="" disabled>Choose person</option>
            {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
          </select>
          <Button type="submit" size="sm">Add to group</Button>
        </form>
      </CardContent>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`px-4 pb-4 text-sm ${msg.ok ? "text-emerald-600" : "text-destructive"}`}>{msg.text}</p>}
    </Card>
  );
}
