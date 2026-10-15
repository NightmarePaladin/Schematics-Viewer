import { expect, test, type Page } from "@playwright/test";
import dotenv from "dotenv";
import { cleanupE2eData } from "./cleanup";

dotenv.config({ path: ".env.local" });

const PASSWORD = process.env.SEED_PASSWORD ?? "Demo-Pass-123!";
const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
test.skip(!configured, "Supabase env vars not set — see TESTING.md");
test.describe.configure({ mode: "serial" });
test.afterAll(async () => { await cleanupE2eData(); });

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
}
const canvasReady = (page: Page) => expect(page.getByTestId("pdf-canvas")).toHaveAttribute("data-rendered", "true");

async function openSchematic(page: Page, title: RegExp) {
  await page.goto("/schematics");
  await page.getByRole("link", { name: title }).click();
  await canvasReady(page);
}

const stamp = Date.now();

test("draw an issue box and a callout, reply in the thread, create + resolve an issue", async ({ page }) => {
  await signIn(page, "tech@schematichub.test");
  await openSchematic(page, /Hydraulic Power Unit \(demo\)/);
  const before = await page.getByTestId("annotation-marker").count();

  // Issue box by dragging
  await page.getByTestId("tool-box").click();
  let b = (await page.getByTestId("pdf-canvas").boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.1, b.y + b.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.75, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("draft-marker")).toBeVisible();
  await page.getByLabel("Annotation text").fill(`Box ${stamp}: coil overheating`);
  await page.getByLabel("Status label").selectOption("open");
  await page.getByTestId("save-annotation").click();
  await expect(page.getByTestId("annotation-marker")).toHaveCount(before + 1);

  // Callout
  await page.getByTestId("tool-callout").click();
  b = (await page.getByTestId("pdf-canvas").boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.7, { steps: 5 });
  await page.mouse.up();
  await page.getByLabel("Annotation text").fill(`Callout ${stamp}: verify 24 VDC`);
  await page.getByTestId("save-annotation").click();
  await expect(page.getByTestId("annotation-marker")).toHaveCount(before + 2);
  await page.screenshot({ path: "test-results/flow-annotations.png" });

  // Open thread, reply
  await page.getByTestId("annotation-marker").nth(before).click();
  await expect(page.getByTestId("annotation-thread")).toContainText(`Box ${stamp}`);
  await page.getByLabel("Reply", { exact: true }).fill("Replaced coil, monitoring.");
  await page.getByRole("button", { name: "Reply" }).click();
  await expect(page.getByTestId("annotation-thread")).toContainText("Replaced coil, monitoring.");

  // Create maintenance issue from the annotation
  await page.getByRole("button", { name: "Create maintenance issue" }).click();
  await page.getByLabel("Issue title").fill(`Coil overheating ${stamp}`);
  await page.getByLabel("Severity").selectOption("critical");
  await page.getByRole("button", { name: "Create issue" }).click();
  await expect(page.getByText("Linked maintenance issue")).toBeVisible();
  await page.screenshot({ path: "test-results/flow-thread.png" });

  // Resolve it from the maintenance page (needs a note)
  await page.goto("/maintenance");
  const item = page.getByRole("listitem").filter({ hasText: `Coil overheating ${stamp}` });
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Resolve…" }).click();
  await expect(item.getByRole("button", { name: "Mark resolved" })).toBeDisabled();
  await item.getByLabel("Resolution note").fill("Coil replaced, temps normal.");
  await item.getByRole("button", { name: "Mark resolved" }).click();
  await expect(page.getByText("Resolution: Coil replaced, temps normal.", { exact: true })).toBeVisible();

  // Resolution note and a log entry were recorded
  await expect(page.getByText(/changed from open to resolved/).first()).toBeVisible();
});

test("manager grants a group access in the Access tab; group member then opens the private schematic", async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signIn(admin, "admin@schematichub.test");
  await openSchematic(admin, /Compressor control wiring \(private\)/);
  await admin.getByRole("tab", { name: "Access" }).click();
  await admin.getByLabel("Grant to").selectOption("group");
  await admin.getByLabel("Permission level").selectOption("view");
  await admin.getByLabel("Grantee").selectOption({ label: "Hydraulics Crew" });
  await admin.getByRole("button", { name: "Save grant" }).click();
  await expect(admin.getByTestId("grants-panel")).toContainText("Group: Hydraulics Crew");
  const url = admin.url();

  const techCtx = await browser.newContext();
  const tech = await techCtx.newPage();
  await signIn(tech, "tech2@schematichub.test");
  const ok = await tech.goto(url);
  expect(ok?.status()).toBe(200);
  await canvasReady(tech);
  await expect(tech.getByText("View only")).toBeVisible();

  // Revoke and confirm access is gone again
  await admin.getByRole("button", { name: /Revoke Group: Hydraulics Crew/ }).click();
  await expect(admin.getByRole("button", { name: /Revoke Group: Hydraulics Crew/ })).toHaveCount(0);
  const gone = await tech.goto(url);
  expect(gone?.status()).toBe(404);
  await adminCtx.close();
  await techCtx.close();
});

test("weather panel shows live Open-Meteo data for an outdoor machine and a fallback for an indoor one", async ({ page }) => {
  await signIn(page, "admin@schematichub.test");
  await page.goto("/machines");
  await page.getByRole("link", { name: "Outdoor Compressor C2" }).click();
  await expect(page.getByText(/°C/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Humidity/)).toBeVisible();
  await expect(page.getByText(/km\/h/)).toBeVisible();
  await expect(page.getByText(/from Open-Meteo/)).toBeVisible();
  await page.screenshot({ path: "test-results/flow-weather.png" });

  await page.goto("/machines");
  await page.getByRole("link", { name: "Hydraulic Press 7" }).click();
  await expect(page.getByText(/No coordinates on file/)).toBeVisible();
});

test("weather API failure shows a retryable fallback", async ({ page }) => {
  await signIn(page, "admin@schematichub.test");
  await page.route("**/api/weather**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, reason: "timeout", message: "Weather service timed out. Try again shortly." }) }),
  );
  await page.goto("/machines");
  await page.getByRole("link", { name: "Outdoor Compressor C2" }).click();
  await expect(page.getByText("Weather service timed out")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("rotating the view keeps annotations on the same drawing features", async ({ page }) => {
  await signIn(page, "tech@schematichub.test");
  await openSchematic(page, /Hydraulic Power Unit \(demo\)/);
  const seeded = page.locator('[data-testid="annotation-marker"][data-x="0.42"]').first();
  await expect(seeded).toBeVisible();

  const rel = async () => {
    const c = (await page.getByTestId("pdf-canvas").boundingBox())!;
    const r = (await seeded.locator("rect").boundingBox())!;
    return { x: (r.x - c.x) / c.width, y: (r.y - c.y) / c.height, w: r.width / c.width, h: r.height / c.height };
  };
  const r0 = await rel();
  expect(r0.x).toBeCloseTo(0.42, 1);
  expect(r0.y).toBeCloseTo(0.15, 1);

  await page.getByRole("button", { name: "Rotate view 90 degrees" }).click();
  await canvasReady(page);
  const r90 = await rel();
  // stored (x,y,w,h) -> displayed after 90deg CW: x' = 1 - (y + h), y' = x, w' = h, h' = w
  expect(r90.x).toBeCloseTo(1 - (0.15 + 0.12), 1);
  expect(r90.y).toBeCloseTo(0.42, 1);
  expect(r90.w).toBeCloseTo(0.12, 1);
  expect(r90.h).toBeCloseTo(0.17, 1);
  await page.screenshot({ path: "test-results/flow-rotated.png" });

  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Rotate view 90 degrees" }).click();
  await canvasReady(page);
  const r360 = await rel();
  expect(r360.x).toBeCloseTo(r0.x, 1);
  expect(r360.y).toBeCloseTo(r0.y, 1);
});

test("viewer controls: page navigation, fit modes, annotation toggle, sidebar collapse", async ({ page }) => {
  await signIn(page, "viewer@schematichub.test");
  await openSchematic(page, /Hydraulic Power Unit \(demo\)/);
  await expect(page.getByTestId("page-indicator")).toContainText("1 / 2");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByTestId("page-indicator")).toContainText("2 / 2");
  await expect(page.getByTestId("annotation-marker")).toHaveCount(0);
  await page.getByRole("button", { name: "Previous page" }).click();
  await canvasReady(page);

  await page.getByRole("button", { name: "Fit to page" }).click();
  const fitPage = (await page.getByTestId("pdf-canvas").boundingBox())!;
  const area = (await page.getByTestId("viewer-scroller").boundingBox())!;
  expect(fitPage.height).toBeLessThanOrEqual(area.height);
  await page.getByRole("button", { name: "Fit to width" }).click();
  const fitWidth = (await page.getByTestId("pdf-canvas").boundingBox())!;
  expect(fitWidth.width).toBeLessThanOrEqual(area.width);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByTestId("zoom-level")).not.toHaveText("100%");

  const markers = page.getByTestId("annotation-marker");
  await expect(markers.first()).toBeVisible();
  await page.getByTestId("toggle-annotations").click();
  await expect(markers).toHaveCount(0);
  await page.getByTestId("toggle-annotations").click();
  await expect(markers.first()).toBeVisible();

  await page.getByRole("button", { name: "Collapse annotations panel" }).click();
  await expect(page.getByTestId("annotation-sidebar")).toHaveCount(0);
  await page.screenshot({ path: "test-results/flow-viewer-readonly.png" });
});
