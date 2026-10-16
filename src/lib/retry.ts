/**
 * Retry a read-only, idempotent call once after a short pause. For brief hiccups of a shared backend (a dropped connection,
 * a schema-cache reload, a timeout) where the second attempt almost always succeeds. NOT for writes.
 */
export async function retryOnce<T extends { error: unknown }>(
  fn: () => PromiseLike<T>,
  opts: { delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const first = await fn();
  if (!first.error) return first;
  await (opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))))(opts.delayMs ?? 250);
  const second = await fn();
  return second.error ? first : second; // report the original failure if the retry also fails
}
