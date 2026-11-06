import { describe, expect, it } from "vitest";
import { A11Y_KEY, applyPrefs, attrsFor, DEFAULT_PREFS, INIT_SCRIPT, PALETTES, parsePrefs, shapesOn, statusVar, type A11yPrefs } from "@/lib/accessibility";

/** A minimal stand-in for <html> that records attributes and style variables. */
function fakeEl() {
  const attrs: Record<string, string> = {};
  const vars: Record<string, string> = {};
  return {
    attrs, vars,
    el: { setAttribute: (k: string, v: string) => { attrs[k] = v; }, style: { setProperty: (k: string, v: string) => { vars[k] = v; } } },
  };
}

describe("parsePrefs", () => {
  it("returns defaults for missing, corrupt or wrong-typed input", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("junk")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ cvd: "purple", text: 5, shapes: "yes", contrast: {} })).toEqual(DEFAULT_PREFS);
  });

  it("keeps valid values and fills in the rest", () => {
    expect(parsePrefs({ cvd: "rg", text: "large", shapes: true, links: true })).toEqual({ ...DEFAULT_PREFS, cvd: "rg", text: "large", shapes: true, links: true });
  });
});

describe("palettes and symbols", () => {
  it("every palette defines all four statuses with distinct, valid colours", () => {
    for (const [name, pal] of Object.entries(PALETTES)) {
      const vals = Object.values(pal);
      expect(vals).toHaveLength(4);
      expect(new Set(vals).size, name).toBe(4);
      for (const v of vals) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("the colour-blind palettes avoid the default red/green pair", () => {
    expect(PALETTES.rg.open).not.toBe(PALETTES.none.open);
    expect(PALETTES.rg.resolved).not.toBe(PALETTES.none.resolved);
  });

  it("greyscale always turns the symbols on", () => {
    expect(shapesOn({ ...DEFAULT_PREFS, cvd: "gray" })).toBe(true);
    expect(shapesOn({ ...DEFAULT_PREFS, cvd: "rg" })).toBe(false);
    expect(shapesOn({ ...DEFAULT_PREFS, cvd: "rg", shapes: true })).toBe(true);
  });

  it("statusVar uses the CSS variable with the default colour as a fallback", () => {
    expect(statusVar("open")).toBe("var(--status-open, #dc2626)");
    expect(statusVar("in_progress")).toBe("var(--status-in-progress, #0284c7)");
    expect(statusVar(null)).toBe("var(--status-none, #d97706)");
    expect(statusVar("weird")).toBe("var(--status-none, #d97706)");
  });
});

describe("applying preferences", () => {
  const prefs: A11yPrefs = { cvd: "by", shapes: true, text: "xlarge", contrast: "high", motion: "reduce", font: "readable", targets: "large", focus: "strong", links: true, markers: "large" };

  it("applyPrefs sets every attribute and the status variables", () => {
    const f = fakeEl();
    applyPrefs(prefs, f.el as unknown as HTMLElement);
    expect(f.attrs).toEqual(attrsFor(prefs));
    expect(f.attrs["data-cvd"]).toBe("by");
    expect(f.vars["--status-in-progress"]).toBe(PALETTES.by.in_progress);
  });

  it("the pre-paint script produces exactly the same result as applyPrefs", () => {
    for (const p of [DEFAULT_PREFS, prefs, { ...DEFAULT_PREFS, cvd: "gray" as const }, { ...DEFAULT_PREFS, cvd: "rg" as const, shapes: true }]) {
      const a = fakeEl();
      applyPrefs(p, a.el as unknown as HTMLElement);
      const b = fakeEl();
      new Function("document", "localStorage", INIT_SCRIPT)({ documentElement: b.el }, { getItem: (k: string) => (k === A11Y_KEY ? JSON.stringify(p) : null) });
      expect(b.attrs).toEqual(a.attrs);
      expect(b.vars).toEqual(a.vars);
    }
  });

  it("the script survives missing or broken storage and falls back to the default look", () => {
    const expected = fakeEl();
    applyPrefs(DEFAULT_PREFS, expected.el as unknown as HTMLElement);
    for (const store of [{ getItem: () => null }, { getItem: () => "{not json" }, { getItem: () => { throw new Error("blocked"); } }]) {
      const b = fakeEl();
      new Function("document", "localStorage", INIT_SCRIPT)({ documentElement: b.el }, store);
      expect(b.attrs).toEqual(expected.attrs);
    }
  });
});
