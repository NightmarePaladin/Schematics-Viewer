/**
 * Accessibility / display preferences. Stored per device in localStorage and applied as data-* attributes and CSS variables on
 * <html>, so every style in globals.css (and every SVG marker that uses var(--status-*)) follows them with no re-render.
 * INIT_SCRIPT applies the same attributes before first paint so there is no flash of the default look.
 */

export const A11Y_KEY = "sh_a11y";

export const CVD = ["none", "rg", "by", "gray"] as const;
export const TEXT = ["normal", "large", "xlarge"] as const;
export const CONTRAST = ["normal", "high"] as const;
export const MOTION = ["system", "reduce"] as const;
export const FONT = ["default", "readable"] as const;
export const SIZE = ["normal", "large"] as const;

export interface A11yPrefs {
  /** colour palette for status colours: none = default, rg = red-green safe, by = blue-yellow safe, gray = no colour */
  cvd: (typeof CVD)[number];
  /** show a symbol (! … ✓) with every status colour so colour is never the only signal */
  shapes: boolean;
  text: (typeof TEXT)[number];
  contrast: (typeof CONTRAST)[number];
  motion: (typeof MOTION)[number];
  font: (typeof FONT)[number];
  /** bigger tap / click targets */
  targets: (typeof SIZE)[number];
  /** thicker, higher-contrast keyboard focus ring */
  focus: "normal" | "strong";
  /** always underline links */
  links: boolean;
  /** bigger annotation markers on the drawing */
  markers: (typeof SIZE)[number];
}

export const DEFAULT_PREFS: A11yPrefs = {
  cvd: "none", shapes: false, text: "normal", contrast: "normal", motion: "system", font: "default",
  targets: "normal", focus: "normal", links: false, markers: "normal",
};

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/** Accepts anything (corrupt storage, an older version) and returns a complete, valid set of preferences. */
export function parsePrefs(raw: unknown): A11yPrefs {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    cvd: pick(o.cvd, CVD, "none"),
    shapes: o.shapes === true,
    text: pick(o.text, TEXT, "normal"),
    contrast: pick(o.contrast, CONTRAST, "normal"),
    motion: pick(o.motion, MOTION, "system"),
    font: pick(o.font, FONT, "default"),
    targets: pick(o.targets, SIZE, "normal"),
    focus: pick(o.focus, ["normal", "strong"] as const, "normal"),
    links: o.links === true,
    markers: pick(o.markers, SIZE, "normal"),
  };
}

export type StatusKey = "open" | "in_progress" | "resolved" | "none";

/**
 * Status colours per palette. "rg" is the Okabe-Ito set (distinguishable with protan/deutan vision), "by" keeps the colours on the
 * red-green axis (tritan vision confuses blue/green and yellow/violet), "gray" is lightness only. The symbols (see `shapes`) carry
 * the meaning when colours are hard to tell apart, so none of these relies on colour alone.
 */
export const PALETTES: Record<A11yPrefs["cvd"], Record<StatusKey, string>> = {
  none: { open: "#dc2626", in_progress: "#0284c7", resolved: "#16a34a", none: "#d97706" },
  rg: { open: "#d55e00", in_progress: "#0072b2", resolved: "#009e73", none: "#cc79a7" },
  by: { open: "#d32f2f", in_progress: "#6d4c41", resolved: "#2e7d32", none: "#546e7a" },
  gray: { open: "#000000", in_progress: "#3d3d3d", resolved: "#6b6b6b", none: "#8a8a8a" },
};

/** Symbol shown with each status when `shapes` is on (also used as the badge prefix in CSS). */
export const STATUS_GLYPH: Record<StatusKey, string> = { open: "!", in_progress: "…", resolved: "✓", none: "" };

/** Symbols are always on for the greyscale palette (colour is gone), otherwise follow the preference. */
export const shapesOn = (p: A11yPrefs) => p.shapes || p.cvd === "gray";

/** The data-* attributes that globals.css keys off. */
export function attrsFor(p: A11yPrefs): Record<string, string> {
  return {
    "data-cvd": p.cvd, "data-shapes": shapesOn(p) ? "on" : "off", "data-text": p.text, "data-contrast": p.contrast, "data-motion": p.motion,
    "data-font": p.font, "data-targets": p.targets, "data-focus": p.focus, "data-links": p.links ? "on" : "off", "data-markers": p.markers,
  };
}

export function applyPrefs(p: A11yPrefs, el: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(attrsFor(p))) el.setAttribute(k, v);
  for (const [k, v] of Object.entries(PALETTES[p.cvd])) el.style.setProperty(`--status-${k.replace("_", "-")}`, v);
}

export function loadPrefs(): A11yPrefs {
  try {
    return parsePrefs(JSON.parse(localStorage.getItem(A11Y_KEY) ?? "null"));
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: A11yPrefs): void {
  try {
    localStorage.setItem(A11Y_KEY, JSON.stringify(p));
  } catch {
    /* private mode / storage blocked: the choice still applies for this visit */
  }
}

/** Colour for a status as a CSS value (follows the active palette). Falls back to the default palette if the variable is missing. */
export const statusVar = (status: string | null | undefined): string => {
  const k: StatusKey = status === "open" || status === "in_progress" || status === "resolved" ? status : "none";
  return `var(--status-${k.replace("_", "-")}, ${PALETTES.none[k]})`;
};

/**
 * Runs in <head> before first paint. Plain ES5, no imports: the same attributes and variables as applyPrefs (a unit test runs both
 * and compares). Any problem is swallowed: the default look is always a safe fallback.
 */
export const INIT_SCRIPT = `(function(){try{
var d=document.documentElement,P=${JSON.stringify(PALETTES)},o={};
try{o=JSON.parse(localStorage.getItem(${JSON.stringify(A11Y_KEY)})||"{}")||{}}catch(e){}
function pk(v,a,f){return a.indexOf(v)>-1?v:f}
var c=pk(o.cvd,${JSON.stringify(CVD)},"none");
var a={"data-cvd":c,"data-shapes":(o.shapes===true||c==="gray")?"on":"off","data-text":pk(o.text,${JSON.stringify(TEXT)},"normal"),
"data-contrast":pk(o.contrast,${JSON.stringify(CONTRAST)},"normal"),"data-motion":pk(o.motion,${JSON.stringify(MOTION)},"system"),
"data-font":pk(o.font,${JSON.stringify(FONT)},"default"),"data-targets":pk(o.targets,${JSON.stringify(SIZE)},"normal"),
"data-focus":pk(o.focus,["normal","strong"],"normal"),"data-links":o.links===true?"on":"off","data-markers":pk(o.markers,${JSON.stringify(SIZE)},"normal")};
for(var k in a)d.setAttribute(k,a[k]);
var p=P[c];for(var s in p)d.style.setProperty("--status-"+s.replace("_","-"),p[s]);
}catch(e){}})();`;
