"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { A11Y_KEY, applyPrefs, DEFAULT_PREFS, loadPrefs, parsePrefs, savePrefs, type A11yPrefs } from "@/lib/accessibility";

interface Ctx {
  prefs: A11yPrefs;
  /** Change one or more preferences; applied and saved immediately. */
  update: (patch: Partial<A11yPrefs>) => void;
  reset: () => void;
}

const A11yContext = createContext<Ctx>({ prefs: DEFAULT_PREFS, update: () => {}, reset: () => {} });
export const useA11y = () => useContext(A11yContext);

/** Holds the preferences, applies them to <html>, saves them, and keeps other open tabs in sync. */
export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  // First render matches the server (defaults); the real values load right after mount. The pre-paint script in <head>
  // has already applied them to <html>, so nothing flashes.
  const [prefs, setPrefs] = useState<A11yPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    setPrefs(loadPrefs());
    const onStorage = (e: StorageEvent) => {
      if (e.key !== A11Y_KEY) return;
      const next = parsePrefs(e.newValue ? safeJson(e.newValue) : null);
      setPrefs(next);
      applyPrefs(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const commit = useCallback((next: A11yPrefs) => {
    setPrefs(next);
    applyPrefs(next);
    savePrefs(next);
  }, []);
  const update = useCallback((patch: Partial<A11yPrefs>) => commit(parsePrefs({ ...loadPrefs(), ...patch })), [commit]);
  const reset = useCallback(() => commit(DEFAULT_PREFS), [commit]);
  const value = useMemo(() => ({ prefs, update, reset }), [prefs, update, reset]);
  return <A11yContext.Provider value={value}>{children}</A11yContext.Provider>;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
