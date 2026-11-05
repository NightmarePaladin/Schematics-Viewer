import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const PASSWORD = process.env.SEED_PASSWORD ?? "Demo-Pass-123!";
const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
test.skip(!configured, "Supabase env vars not set — see TESTING.md");
test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email = "tech@schematichub.test") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
}
const root = (page: Page, attr: string) => page.evaluate((a) => document.documentElement.getAttribute(a), attr);
const canvasReady = (page: Page) => expect(page.getByTestId("pdf-canvas")).toHaveAttribute("data-rendered", "true");

async function openPanel(page: Page) {
  await page.getByTestId("open-a11y").click();
  await expect(page.getByTestId("a11y-panel")).toBeVisible();
}
async function openDemoDrawing(page: Page) {
  await page.goto("/schematics");
  await page.getByRole("link", { name: /Hydraulic Power Unit \(demo\)/ }).click();
  await canvasReady(page);
}

test.beforeEach(async ({ page }) => {
  // start every test from the defaults, but only once: later loads in the same test (reloads) must keep what was saved
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("__a11y_cleared")) {
        localStorage.removeItem("sh_a11y");
        sessionStorage.setItem("__a11y_cleared", "1");
      }
    } catch { /* ignore */ }
  });
});

test("colour-blind palette + symbols: applied at once, remembered after a reload, and used on the drawing", async ({ page }) => {
  await signIn(page);
  await openDemoDrawing(page);
  const marker = page.getByTestId("annotation-marker").first();
  await expect(marker).toBeVisible();
  // default: no symbols drawn
  await expect(page.getByTestId("status-glyph").first()).toBeHidden();

  await openPanel(page);
  await page.getByRole("radio", { name: /Red–green safe/ }).check();
  await expect.poll(() => root(page, "data-cvd")).toBe("rg");
  await expect.poll(() => root(page, "data-shapes")).toBe("on");
  // the preview swatches show the new palette with their symbols
  await expect(page.getByTestId("preview-open")).toHaveText("!");
  await expect(page.getByTestId("preview-resolved")).toHaveText("✓");
  expect(await page.getByTestId("preview-open").evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(213, 94, 0)");
  await page.keyboard.press("Escape");

  // markers use the palette (the seeded drawing has an open and a resolved note) and show their symbols
  const fills = await page.getByTestId("annotation-marker").evaluateAll((els) => els.map((e) => getComputedStyle(e.querySelector("circle[stroke], rect") ?? e).fill));
  expect(fills.join(" ")).not.toContain("rgb(220, 38, 38)"); // the default red is gone
  await expect(page.getByTestId("status-glyph").first()).toBeVisible();

  await page.reload();
  await canvasReady(page);
  expect(await root(page, "data-cvd")).toBe("rg");
  await expect(page.getByTestId("status-glyph").first()).toBeVisible();
});

test("text size, high contrast, reduced motion and strong focus change the page", async ({ page }) => {
  await signIn(page);
  await openPanel(page);
  await page.getByRole("radio", { name: /Large \(112%\)/ }).check();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("18px");
  await page.getByRole("radio", { name: /Largest/ }).check();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("20px");

  await page.getByLabel("High contrast").check();
  expect(await root(page, "data-contrast")).toBe("high");
  await page.getByLabel("Reduce motion").check();
  expect(await root(page, "data-motion")).toBe("reduce");
  await page.getByLabel("Strong keyboard focus outline").check();
  await page.getByLabel("Larger buttons and fields").check();
  expect(await root(page, "data-focus")).toBe("strong");
  expect(await root(page, "data-targets")).toBe("large");

  // larger targets really are at least 44px
  await page.keyboard.press("Escape");
  const h = await page.getByTestId("open-a11y").evaluate((e) => e.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(44);

  // the setting survives navigation and a reload, with no flash: the attribute is present as soon as the document exists
  await page.goto("/settings");
  expect(await root(page, "data-text")).toBe("xlarge");
  await page.reload();
  expect(await root(page, "data-contrast")).toBe("high");
});

test("quick setups and Reset all", async ({ page }) => {
  await signIn(page);
  await openPanel(page);
  await page.getByTestId("preset-low").click();
  expect(await root(page, "data-text")).toBe("large");
  expect(await root(page, "data-contrast")).toBe("high");
  expect(await root(page, "data-markers")).toBe("large");
  await page.getByTestId("preset-colour-blind").click();
  expect(await root(page, "data-cvd")).toBe("rg");
  await page.getByTestId("a11y-reset").click();
  for (const [attr, value] of [["data-cvd", "none"], ["data-text", "normal"], ["data-contrast", "normal"], ["data-shapes", "off"], ["data-markers", "normal"]]) {
    expect(await root(page, attr), attr).toBe(value);
  }
});

test("greyscale forces symbols on, and badges gain symbols", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await page.getByRole("radio", { name: /Greyscale/ }).check();
  expect(await root(page, "data-shapes")).toBe("on");
  await page.goto("/maintenance");
  const badge = page.locator('[data-status="open"]').first();
  if (await badge.count()) {
    const before = await badge.evaluate((e) => getComputedStyle(e, "::before").content);
    expect(before).toContain("!");
  }
});

test("keyboard: the first Tab stop is a 'Skip to main content' link that moves focus into the page", async ({ page }) => {
  await signIn(page);
  await page.goto("/machines");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("main");
});

test("the panel is usable by keyboard alone and every control has a name", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("open-a11y").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  const unnamed = await page.getByTestId("a11y-panel").evaluate((el) =>
    [...el.querySelectorAll("input, button, select")].filter((c) => {
      const i = c as HTMLInputElement;
      return !(i.labels?.length || c.getAttribute("aria-label") || c.textContent?.trim());
    }).length,
  );
  expect(unnamed).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

// ── automated audit with axe-core: no serious/critical problems on the main screens, in the default look and in each mode ──
const MODES: { name: string; prefs: Record<string, unknown> }[] = [
  { name: "default", prefs: {} },
  { name: "high contrast + large text", prefs: { contrast: "high", text: "large" } },
  { name: "colour-blind (red-green) with symbols", prefs: { cvd: "rg", shapes: true } },
  { name: "greyscale, large targets, readable font", prefs: { cvd: "gray", targets: "large", font: "readable", links: true } },
];

async function seriousViolations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target?.join(" ")}`);
}

for (const mode of MODES) {
  test(`axe audit [${mode.name}]: login, dashboard, machines, settings, maintenance, viewer`, async ({ page }) => {
    await page.addInitScript((p) => { try { localStorage.setItem("sh_a11y", JSON.stringify(p)); } catch { /* ignore */ } }, mode.prefs);
    const found: Record<string, string[]> = {};
    await page.goto("/login");
    found.login = await seriousViolations(page);
    await signIn(page);
    for (const [name, url] of [["dashboard", "/"], ["machines", "/machines"], ["settings", "/settings"], ["maintenance", "/maintenance"]] as const) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      found[name] = await seriousViolations(page);
    }
    await openDemoDrawing(page);
    found.viewer = await seriousViolations(page);
    const all = Object.entries(found).filter(([, v]) => v.length);
    expect(all, JSON.stringify(all, null, 1)).toEqual([]);
  });
}
