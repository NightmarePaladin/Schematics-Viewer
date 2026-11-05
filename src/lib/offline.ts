/**
 * Small on-device cache so a drawing you opened once still opens (and shows its notes) with a weak or no connection.
 * Uses the Cache API; every call is best-effort and silently does nothing where the API is unavailable.
 * Everything here is PRIVATE data on the device: it is wiped on sign-out (clearOffline) and capped to the last few drawings.
 */
const NAME = "schematichub-offline-v1";
const PAGES = "sh-pages"; // HTML cached by the service worker (public/sw.js)
const STATIC = "sh-static-v1";
const MAX_ENTRIES = 24; // PDFs + annotation lists, oldest dropped first

const keyOf = (k: string) => new Request(`${location.origin}/__offline/${k}`);

export const pdfKey = (schematicId: string, revisionId?: string | null) => `pdf/${schematicId}/${revisionId ?? "current"}`;
export const annKey = (schematicId: string) => `ann/${schematicId}`;

export async function offlinePut(key: string, body: Blob | string, contentType: string): Promise<void> {
  try {
    const cache = await caches.open(NAME);
    await cache.put(keyOf(key), new Response(body, { headers: { "Content-Type": contentType } }));
    const keys = await cache.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) await cache.delete(k);
  } catch {
    /* quota or unsupported: ignore */
  }
}

export async function offlineGet(key: string): Promise<Response | undefined> {
  try {
    return await (await caches.open(NAME)).match(keyOf(key));
  } catch {
    return undefined;
  }
}

export async function offlineHas(key: string): Promise<boolean> {
  return !!(await offlineGet(key));
}

/** Remove every cached drawing, note list and page (called on sign-out). */
export async function clearOffline(): Promise<void> {
  try {
    await Promise.all([NAME, PAGES, STATIC].map((n) => caches.delete(n)));
  } catch {
    /* ignore */
  }
}
