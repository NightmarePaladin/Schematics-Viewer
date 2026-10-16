import { expect, test, type Page } from "@playwright/test";
import dotenv from "dotenv";
import { cleanupE2eData } from "./cleanup";

dotenv.config({ path: ".env.local" });

const PASSWORD = process.env.SEED_PASSWORD ?? "Demo-Pass-123!";
const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
test.skip(!configured, "Supabase env vars not set — see TESTING.md");
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => { await cleanupE2eData(); }); // start clean: a leftover pin at the tap position would be selected instead of a new one
test.afterAll(async () => { await cleanupE2eData(); });

// a typical phone
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
}
const canvasReady = (page: Page) => expect(page.getByTestId("pdf-canvas")).toHaveAttribute("data-rendered", "true");
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function openDemoSchematic(page: Page) {
  await page.goto("/schematics");
  await page.getByRole("link", { name: /Hydraulic Power Unit \(demo\)/ }).click();
  await canvasReady(page);
}

test("viewer on a phone: the drawing fills the screen and the notes panel stays closed until asked", async ({ page }) => {
  await signIn(page, "tech@schematichub.test");
  await openDemoSchematic(page);

  // closed by default: the drawing is not covered
  await expect(page.getByTestId("annotation-sidebar")).toHaveCount(0);
  const canvas = (await page.getByTestId("pdf-canvas").boundingBox())!;
  expect(canvas.width).toBeGreaterThan(330); // fit to width on a 375px screen
  expect(canvas.x).toBeGreaterThanOrEqual(0);
  expect(await noSideScroll(page)).toBe(true);

  // every control is on screen with no sideways scrolling, including the annotation tools
  for (const name of ["tool-point", "tool-comment", "tool-box", "tool-callout", "tool-select", "tool-pan", "toggle-annotations"]) {
    await expect(page.getByTestId(name), name).toBeInViewport({ ratio: 1 });
  }
  for (const label of ["Zoom in", "Zoom out", "Fit to width", "Fit to page", "Rotate view 90 degrees", "Next page", "Previous page"]) {
    await expect(page.getByRole("button", { name: label }), label).toBeInViewport({ ratio: 1 });
  }
  const toolbarOverflow = await page.getByRole("toolbar", { name: "Viewer controls" }).evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(toolbarOverflow).toBe(false);

  // the annotations tab is docked at the bottom of the screen, full width and finger-sized
  const tab = page.getByTestId("annotations-tab");
  await expect(tab).toBeVisible();
  await expect(tab).toHaveAttribute("aria-expanded", "false");
  await expect(tab).toContainText("Annotations");
  // the badge shows how many notes there are (compared with the real count: people may have added annotations to the demo drawing)
  const schematicId = page.url().match(/schematics\/([0-9a-f-]{36})/)![1];
  const count = ((await (await page.request.get(`/api/annotations?schematic_id=${schematicId}`)).json()).data as unknown[]).length;
  expect(count).toBeGreaterThan(0);
  await expect(tab).toContainText(String(count));
  const tb = (await tab.boundingBox())!;
  expect(tb.height).toBeGreaterThanOrEqual(44);
  expect(tb.width).toBeGreaterThanOrEqual(360);
  expect(tb.y + tb.height).toBeGreaterThanOrEqual(812 - 2);
  // the desktop toggle is not shown on a phone
  await expect(page.getByRole("button", { name: "Collapse annotations panel" })).toBeHidden();
  // the drawing still gets nearly the whole screen: the tab sits below it, not over it
  const scrollerBox = (await page.getByTestId("viewer-scroller").boundingBox())!;
  expect(scrollerBox.y + scrollerBox.height).toBeLessThanOrEqual(tb.y + 1);
  await page.screenshot({ path: "test-results/mobile-viewer-closed.png" });

  // tapping the tab pulls up a bottom sheet, not a full-screen takeover
  await tab.tap();
  const sheet = page.getByTestId("annotation-sidebar");
  await expect(sheet).toBeVisible();
  await expect(tab).toBeHidden();
  const sb = (await sheet.boundingBox())!;
  expect(sb.height).toBeLessThanOrEqual(812 * 0.5);
  expect(sb.height).toBeGreaterThan(200);
  expect(sb.y + sb.height).toBeGreaterThanOrEqual(812 - 2); // docked to the bottom
  expect(sb.width).toBeLessThanOrEqual(376);
  const visibleDrawing = sb.y - scrollerBox.y;
  expect(visibleDrawing).toBeGreaterThan(220); // plenty of the drawing stays visible above it
  await page.screenshot({ path: "test-results/mobile-viewer-sheet.png" });

  // tapping the sheet's own header tucks it away again and the tab returns
  const close = page.getByRole("button", { name: "Close annotations panel" });
  await expect(close).toHaveAttribute("aria-expanded", "true");
  await close.tap();
  await expect(page.getByTestId("annotation-sidebar")).toHaveCount(0);
  await expect(tab).toBeVisible();
});

test("viewer on a phone: pin a note by tapping, with the new pin visible above the form", async ({ page }) => {
  await signIn(page, "tech@schematichub.test");
  await openDemoSchematic(page);

  await page.getByTestId("tool-point").tap();
  const c = (await page.getByTestId("pdf-canvas").boundingBox())!;
  await page.touchscreen.tap(c.x + c.width * 0.3, c.y + c.height * 0.35);

  const sheet = page.getByTestId("annotation-sidebar");
  await expect(sheet).toBeVisible();
  const marker = page.getByTestId("draft-marker");
  await expect(marker).toBeVisible();
  const mb = (await marker.boundingBox())!;
  const sb = (await sheet.boundingBox())!;
  expect(mb.y + mb.height).toBeLessThanOrEqual(sb.y + 1); // the pin is not hidden behind the sheet
  expect(mb.y).toBeGreaterThanOrEqual(0);

  await page.screenshot({ path: "test-results/mobile-viewer-draft.png" });
  await page.getByLabel("Annotation text").fill("E2E mobile note");
  await page.getByTestId("save-annotation").tap();
  await expect(page.getByTestId("annotation-thread")).toContainText("E2E mobile note");
  await page.getByRole("button", { name: "Close annotations panel" }).tap();
  await expect(page.getByTestId("annotation-sidebar")).toHaveCount(0);
  await expect(page.locator('[data-testid="annotation-marker"][aria-label*="E2E mobile note"]')).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
});

test("every page fits a phone screen without sideways scrolling, and the menu works", async ({ page }) => {
  await signIn(page, "admin@schematichub.test");

  // find a machine to open
  await page.goto("/machines");
  const pressHref = await page.locator("td:first-child a", { hasText: /^Hydraulic Press 7$/ }).getAttribute("href");
  const paths = ["/", "/machines", pressHref!, "/machines/new", "/machines/labels", "/schematics", "/maintenance", "/teams", "/settings", "/locations", "/audit"];
  const overflowing: string[] = [];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.locator("main#main")).toBeVisible();
    if (!(await noSideScroll(page))) overflowing.push(path);
  }
  expect(overflowing, `pages wider than the phone screen: ${overflowing.join(", ")}`).toEqual([]);

  // the hamburger menu opens a navigation drawer and links work
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).tap();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
  await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: "Machines" }).tap();
  await expect(page).toHaveURL(/\/machines$/);
  await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);
});
