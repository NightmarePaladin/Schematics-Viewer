/** Pure helpers for the machine parent/child hierarchy (system -> sub-system -> component). */

export interface TreeNode {
  id: string;
  parent_id: string | null;
}

/** Ancestors from the immediate parent up to the root. Stops on cycles or missing nodes (e.g. a parent the user cannot see). */
export function ancestorsOf<T extends TreeNode>(all: readonly T[], id: string): T[] {
  const byId = new Map(all.map((n) => [n.id, n]));
  const out: T[] = [];
  const seen = new Set<string>([id]);
  let cur = byId.get(id)?.parent_id ?? null;
  while (cur && !seen.has(cur)) {
    const node = byId.get(cur);
    if (!node) break;
    out.push(node);
    seen.add(cur);
    cur = node.parent_id;
  }
  return out;
}

export function childrenOf<T extends TreeNode>(all: readonly T[], id: string): T[] {
  return all.filter((n) => n.parent_id === id);
}

/** All descendants (children, grandchildren, ...). */
export function descendantsOf<T extends TreeNode>(all: readonly T[], id: string): T[] {
  const out: T[] = [];
  const seen = new Set<string>([id]);
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of all) {
      if (n.parent_id === cur && !seen.has(n.id)) {
        seen.add(n.id);
        out.push(n);
        queue.push(n.id);
      }
    }
  }
  return out;
}

/** Would making `parentId` the parent of `id` create a loop? (The database enforces this too.) */
export function wouldCreateCycle(all: readonly TreeNode[], id: string, parentId: string | null): boolean {
  if (!parentId) return false;
  if (parentId === id) return true;
  return descendantsOf(all, id).some((d) => d.id === parentId);
}

/** Machines that may be chosen as the parent of `id`: everything except itself and its own descendants. */
export function eligibleParents<T extends TreeNode>(all: readonly T[], id: string | null): T[] {
  if (!id) return [...all];
  const banned = new Set([id, ...descendantsOf(all, id).map((d) => d.id)]);
  return all.filter((n) => !banned.has(n.id));
}

export interface CriticalNode extends TreeNode {
  is_critical: boolean;
}
export interface IssueLike {
  machine_id: string;
  status: string;
  severity: string;
}

const MAJOR = new Set(["high", "critical"]);

/**
 * TypeScript mirror of the SQL function `inoperable_machines()` (the database is the source of truth; this documents
 * and unit-tests the rule). Returns affected machine id -> ids of the critical machines whose major issue caused it.
 *
 * Rule: a machine that is_critical and has an unresolved high/critical issue makes its PARENT inoperable. The state
 * continues upward only through parents that are themselves critical. Nothing is stored, so resolving the issue clears it.
 */
export function computeInoperable(machines: readonly CriticalNode[], issues: readonly IssueLike[]): Map<string, string[]> {
  const byId = new Map(machines.map((m) => [m.id, m]));
  const failing = new Set(issues.filter((i) => i.status !== "resolved" && MAJOR.has(i.severity)).map((i) => i.machine_id));
  const out = new Map<string, Set<string>>();
  for (const src of machines) {
    if (!src.is_critical || !src.parent_id || !failing.has(src.id)) continue;
    let cur: string | null = src.parent_id;
    const seen = new Set<string>([src.id]);
    while (cur && !seen.has(cur)) {
      const node = byId.get(cur);
      if (!node) break;
      if (!out.has(cur)) out.set(cur, new Set());
      out.get(cur)!.add(src.id);
      seen.add(cur);
      cur = node.is_critical ? node.parent_id : null;
    }
  }
  return new Map([...out].map(([k, v]) => [k, [...v]]));
}
