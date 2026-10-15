import type { PermLevel } from "@/lib/permissions";

export type AnnType = "point" | "comment" | "box" | "callout";
export type IssueStatus = "open" | "in_progress" | "resolved";

export interface Ann {
  id: string;
  page_number: number;
  type: AnnType;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  body: string;
  status: IssueStatus | null;
  author_id: string;
  created_at: string;
  author: { display_name: string } | { display_name: string }[] | null;
  replies: { count: number }[] | null;
  issue: { id: string; status: string; severity: string; title: string }[] | { id: string; status: string; severity: string; title: string } | null;
}

export interface Reply {
  id: string;
  body: string;
  is_resolution_note: boolean;
  created_at: string;
  author_id: string;
  author: { display_name: string } | { display_name: string }[] | null;
}

export interface Draft {
  type: AnnType;
  page_number: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface ViewerProps {
  schematicId: string;
  machineId: string;
  title: string;
  meta: { documentNumber: string; revision: string; machineName: string; uploader: string; uploadedAt: string };
  level: PermLevel;
  userId: string;
  initialPage: number;
  canReport: boolean;
  members: { user_id: string; name: string }[];
  groups: { id: string; name: string }[];
}

export const STATUS_COLOR: Record<string, string> = {
  open: "#dc2626",
  in_progress: "#0284c7",
  resolved: "#16a34a",
  none: "#d97706",
};

export const colorFor = (status: string | null) => STATUS_COLOR[status ?? "none"];

export function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const d = body?.error?.details;
    throw new Error(Array.isArray(d) ? d.map((x: { path: string; message: string }) => `${x.path}: ${x.message}`).join("; ") : (body?.error?.message ?? `Request failed (${res.status})`));
  }
  return body as T;
}
