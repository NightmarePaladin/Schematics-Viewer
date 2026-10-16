import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError, forbidden, unauthorized } from "./api";
import { levelAtLeast, type OrgRole, type PermLevel } from "./permissions";
import { retryOnce } from "./retry";
import { createClient } from "./supabase/server";

export const ORG_COOKIE = "sh_org";

export interface Membership {
  org_id: string;
  role: OrgRole;
  org_name: string;
}

export interface SessionContext {
  supabase: SupabaseClient;
  user: User;
  memberships: Membership[];
  /** Active organization — always one the user is a verified member of. */
  orgId: string | null;
  role: OrgRole | null;
}

/**
 * Resolve the authenticated user and active organization.
 * The organization is NEVER taken from client input directly: a client-supplied id
 * (cookie or request) is only honoured if it matches one of the user's own memberships.
 */
export async function getSession(requestedOrg?: string | null): Promise<SessionContext | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;

  const { data: rows, error } = await supabase
    .from("organization_memberships")
    .select("org_id, role, organizations(name)")
    .eq("user_id", data.user.id);
  if (error) throw new ApiError(500, "db_error", "Could not load organization memberships.");

  const memberships: Membership[] = (rows ?? []).map((r) => {
    const org = r.organizations as unknown as { name: string } | { name: string }[] | null;
    return {
      org_id: r.org_id,
      role: r.role as OrgRole,
      org_name: (Array.isArray(org) ? org[0]?.name : org?.name) ?? "Organization",
    };
  });

  const cookieOrg = (await cookies()).get(ORG_COOKIE)?.value;
  const wanted = requestedOrg ?? cookieOrg;
  const active = memberships.find((m) => m.org_id === wanted) ?? memberships[0] ?? null;

  return { supabase, user: data.user, memberships, orgId: active?.org_id ?? null, role: active?.role ?? null };
}

export async function requireSession(): Promise<SessionContext> {
  const s = await getSession();
  if (!s) throw unauthorized();
  return s;
}

/** Require membership of an active organization. */
export async function requireOrg(): Promise<SessionContext & { orgId: string; role: OrgRole }> {
  const s = await requireSession();
  if (!s.orgId || !s.role) throw new ApiError(403, "no_organization", "Create or join an organization first.");
  return s as SessionContext & { orgId: string; role: OrgRole };
}

/**
 * Same as requireOrg() but for PAGES: signed-out users go to /login and users with no organization go to /onboarding
 * (instead of throwing a 403 that renders as an error page). API route handlers keep using requireOrg().
 */
export async function requireOrgPage(): Promise<SessionContext & { orgId: string; role: OrgRole }> {
  const s = await getSession();
  if (!s) redirect("/auth/expired");
  if (!s.orgId || !s.role) redirect("/onboarding");
  return s as SessionContext & { orgId: string; role: OrgRole };
}

export function requireRole(role: OrgRole, allowed: readonly OrgRole[]) {
  if (!allowed.includes(role)) throw forbidden(`This action requires one of: ${allowed.join(", ")}.`);
}

/**
 * Server-side check of the caller's effective level on a schematic (calls the same SQL
 * function RLS uses). Returns the level, or throws 404 when the caller cannot see it at all
 * (so existence is not leaked) / 403 when visible but insufficient.
 */
export async function requireSchematicLevel(
  s: SessionContext,
  schematicId: string,
  min: PermLevel,
): Promise<PermLevel> {
  const { data, error } = await retryOnce(() => s.supabase.rpc("schematic_level", { p_schematic: schematicId }));
  if (error) {
    console.error("[schematic_level]", error.code ?? "", error.message ?? "");
    throw new ApiError(500, "db_error", "Could not evaluate permissions.");
  }
  const level = data as PermLevel | null;
  if (!level) throw new ApiError(404, "not_found", "Schematic not found.");
  if (!levelAtLeast(level, min)) throw forbidden(`This action requires "${min}" access to the schematic.`);
  return level;
}
