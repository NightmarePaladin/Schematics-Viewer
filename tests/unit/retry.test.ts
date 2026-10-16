import { describe, expect, it, vi } from "vitest";
import { retryOnce } from "@/lib/retry";

const noWait = { sleep: async () => undefined };

describe("retryOnce", () => {
  it("does not retry (or wait) when the first attempt succeeds", async () => {
    const fn = vi.fn().mockResolvedValue({ data: 1, error: null });
    const sleep = vi.fn();
    expect(await retryOnce(fn, { sleep })).toEqual({ data: 1, error: null });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries once after a pause and returns the successful retry", async () => {
    const fn = vi.fn().mockResolvedValueOnce({ data: null, error: { message: "blip" } }).mockResolvedValueOnce({ data: 2, error: null });
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(await retryOnce(fn, { sleep, delayMs: 123 })).toEqual({ data: 2, error: null });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(123);
  });

  it("gives up after one retry and reports the ORIGINAL error", async () => {
    const fn = vi.fn().mockResolvedValueOnce({ data: null, error: { message: "first" } }).mockResolvedValueOnce({ data: null, error: { message: "second" } });
    const r = await retryOnce(fn, noWait);
    expect(r.error).toEqual({ message: "first" });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("works with the thenable query builders Supabase returns", async () => {
    let calls = 0;
    const thenable = () => ({ then: (res: (v: { data: number; error: null | { message: string } }) => unknown) => res(++calls === 1 ? { data: 0, error: { message: "x" } } : { data: 7, error: null }) });
    const r = await retryOnce(() => thenable() as unknown as PromiseLike<{ data: number; error: { message: string } | null }>, noWait);
    expect(r.data).toBe(7);
  });
});
