/** Shared machine search used by the Machines page and GET /api/machines. */

export const SEARCH_FIELDS = {
  all: ["name", "manufacturer", "model_number", "location", "serial_number", "asset_number"],
  name: ["name"],
  manufacturer: ["manufacturer"],
  model: ["model_number"],
  location: ["location"],
} as const;

export type SearchField = keyof typeof SEARCH_FIELDS;

export const SEARCH_FIELD_LABELS: Record<SearchField, string> = {
  all: "All fields",
  name: "Name",
  manufacturer: "Manufacturer",
  model: "Model",
  location: "Location",
};

export const isSearchField = (v: unknown): v is SearchField =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(SEARCH_FIELDS, v);

/** Split into words; strip characters that would break PostgREST filter syntax or act as LIKE wildcards. */
export function searchTerms(q: string | undefined | null): string[] {
  return (q ?? "")
    .replace(/[%,()\\*_"']/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
}

/** `name.ilike.%x%,manufacturer.ilike.%x%` for one term over the chosen columns. */
export function buildOrFilter(term: string, columns: readonly string[]): string {
  return columns.map((c) => `${c}.ilike.%${term}%`).join(",");
}

/**
 * Every word must match at least one of the chosen columns (case-insensitive, partial).
 * "airmaster yard" finds AirMaster machines located in the yard.
 */
export function applyMachineSearch<Q extends { or(filter: string): Q }>(query: Q, q?: string | null, field: SearchField = "all"): Q {
  const columns = SEARCH_FIELDS[field];
  let out = query;
  for (const term of searchTerms(q)) out = out.or(buildOrFilter(term, columns));
  return out;
}
