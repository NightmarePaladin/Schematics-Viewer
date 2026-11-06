"use client";

import { Button } from "@/components/ui/button";
import { useA11y } from "@/components/accessibility-provider";
import { PALETTES, STATUS_GLYPH, shapesOn, type A11yPrefs, type StatusKey } from "@/lib/accessibility";

const CVD_OPTIONS: { value: A11yPrefs["cvd"]; label: string; hint: string }[] = [
  { value: "none", label: "Default colours", hint: "Red, blue, green and amber." },
  { value: "rg", label: "Red–green safe", hint: "For protanopia / deuteranopia (the most common kinds). Orange, blue, teal and pink." },
  { value: "by", label: "Blue–yellow safe", hint: "For tritanopia. Keeps to reds, browns and greens." },
  { value: "gray", label: "Greyscale", hint: "Status colours become shades of grey, always with symbols." },
];

const PRESETS: { label: string; hint: string; patch: Partial<A11yPrefs> }[] = [
  { label: "Colour-blind friendly", hint: "Red–green safe colours with symbols", patch: { cvd: "rg", shapes: true } },
  { label: "Low vision", hint: "Larger text, high contrast, strong focus, bigger controls and markers", patch: { text: "large", contrast: "high", focus: "strong", targets: "large", markers: "large", links: true } },
  { label: "Calm & readable", hint: "Reduced motion, readable font, underlined links", patch: { motion: "reduce", font: "readable", links: true } },
];

function Radio<T extends string>({ name, value, current, label, hint, onPick }: { name: string; value: T; current: T; label: string; hint?: string; onPick: (v: T) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-muted/60">
      <input type="radio" name={name} value={value} checked={current === value} onChange={() => onPick(value)} className="mt-1 size-4" />
      <span className="text-sm"><span className="font-medium">{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
    </label>
  );
}

function Check({ id, checked, label, hint, onChange }: { id: string; checked: boolean; label: string; hint?: string; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-muted/60">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-4" />
      <span className="text-sm"><span className="font-medium">{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
    </label>
  );
}

const SWATCHES: { key: StatusKey; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "resolved", label: "Resolved" },
  { key: "none", label: "No status" },
];

/** Live preview: the four status colours exactly as they appear on markers, with their symbols when those are on. */
function Preview({ prefs }: { prefs: A11yPrefs }) {
  const symbols = shapesOn(prefs);
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Preview of status colours" data-testid="a11y-preview">
      {SWATCHES.map(({ key, label }) => (
        <li key={key} className="flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs">
          <span aria-hidden className="grid size-5 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: PALETTES[prefs.cvd][key] }} data-testid={`preview-${key}`}>
            {symbols ? STATUS_GLYPH[key] : ""}
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
}

/** All display and accessibility options. Used in the header dialog and on the Settings page. */
export function AccessibilityPanel() {
  const { prefs, update, reset } = useA11y();
  return (
    <div className="space-y-5" data-testid="a11y-panel">
      <section aria-label="Quick setups" className="space-y-2">
        <h2 className="text-sm font-semibold">Quick setups</h2>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button key={p.label} type="button" size="sm" variant="outline" title={p.hint} onClick={() => update(p.patch)} data-testid={`preset-${p.label.split(" ")[0].toLowerCase()}`}>{p.label}</Button>
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={reset} data-testid="a11y-reset">Reset all</Button>
        </div>
      </section>

      <fieldset className="space-y-1">
        <legend className="mb-1 text-sm font-semibold">Colours for status (open, in progress, resolved)</legend>
        {CVD_OPTIONS.map((o) => (
          <Radio key={o.value} name="a11y-cvd" value={o.value} current={prefs.cvd} label={o.label} hint={o.hint} onPick={(cvd) => update({ cvd, ...(cvd === "rg" || cvd === "by" ? { shapes: true } : {}) })} />
        ))}
        <Check id="a11y-shapes" checked={shapesOn(prefs)} label="Show a symbol with every status colour" hint="! open · … in progress · ✓ resolved, on markers and badges. Always on in greyscale." onChange={(shapes) => update({ shapes })} />
        <div className="pt-1"><Preview prefs={prefs} /></div>
      </fieldset>

      <fieldset className="space-y-1">
        <legend className="mb-1 text-sm font-semibold">Text size</legend>
        <div className="flex flex-wrap gap-x-4">
          <Radio name="a11y-text" value="normal" current={prefs.text} label="Normal" onPick={(text) => update({ text })} />
          <Radio name="a11y-text" value="large" current={prefs.text} label="Large (112%)" onPick={(text) => update({ text })} />
          <Radio name="a11y-text" value="xlarge" current={prefs.text} label="Largest (125%)" onPick={(text) => update({ text })} />
        </div>
      </fieldset>

      <fieldset className="space-y-0.5">
        <legend className="mb-1 text-sm font-semibold">Seeing and reading</legend>
        <Check id="a11y-contrast" checked={prefs.contrast === "high"} label="High contrast" hint="Darker text and stronger borders and lines." onChange={(v) => update({ contrast: v ? "high" : "normal" })} />
        <Check id="a11y-font" checked={prefs.font === "readable"} label="Readable font and spacing" hint="A wider, clearer typeface with extra letter, word and line spacing." onChange={(v) => update({ font: v ? "readable" : "default" })} />
        <Check id="a11y-links" checked={prefs.links} label="Underline links" onChange={(links) => update({ links })} />
        <Check id="a11y-markers" checked={prefs.markers === "large"} label="Larger markers on drawings" onChange={(v) => update({ markers: v ? "large" : "normal" })} />
      </fieldset>

      <fieldset className="space-y-0.5">
        <legend className="mb-1 text-sm font-semibold">Using the controls</legend>
        <Check id="a11y-targets" checked={prefs.targets === "large"} label="Larger buttons and fields" hint="At least 44 px, easier to hit with a finger or a shaky hand." onChange={(v) => update({ targets: v ? "large" : "normal" })} />
        <Check id="a11y-focus" checked={prefs.focus === "strong"} label="Strong keyboard focus outline" hint="A thick outline that is easy to follow when tabbing." onChange={(v) => update({ focus: v ? "strong" : "normal" })} />
        <Check id="a11y-motion" checked={prefs.motion === "reduce"} label="Reduce motion" hint="Turns off animations and transitions. Without this, your device's setting is followed." onChange={(v) => update({ motion: v ? "reduce" : "system" })} />
      </fieldset>

      <p className="text-xs text-muted-foreground">These settings are saved on this device and browser. Exports use the colour palette you pick here.</p>
    </div>
  );
}

