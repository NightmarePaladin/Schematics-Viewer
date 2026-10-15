import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const PASSWORD = process.env.SEED_PASSWORD ?? "Demo-Pass-123!";
const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const PDF = path.join(process.cwd(), "samples", "demo-hydraulic-schematic.pdf");

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
}

async function waitForCanvas(page: Page) {
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute("data-rendered", "true");
}

test.describe.configure({ mode: "serial" });
test.skip(!configured, "Supabase env vars not set — see TESTING.md");

let schematicUrl = "";
const serial = `E2E-${Date.now()}`;
const CLICK = { fx: 0.3, fy: 0.4 };

test("1-7: sign in, create machine, upload PDF, annotate, reload, position persists", async ({ page }) => {
  // 1. sign in
  await signIn(page, "admin@schematichub.test");

  // 2. create a machine
  await page.goto("/machines/new");
  await page.getByLabel(/Machine name/).fill("E2E Test Pump");
  await page.getByLabel(/Category/).fill("Pump");
  await page.getByLabel(/Manufacturer/).fill("E2E Works");
  await page.getByLabel(/Model number/).fill("EP-1");
  await page.getByLabel(/Serial number/).fill(serial);
  await page.getByRole("button", { name: "Register machine" }).click();
  await expect(page.getByRole("heading", { name: "E2E Test Pump" })).toBeVisible();

  // 3. upload a sample PDF
  await page.getByText("Upload a schematic").click();
  await page.getByLabel("Title", { exact: true }).fill("E2E Hydraulic Sheet");
  await page.getByLabel("Document number").fill(`E2E-${Date.now()}`);
  await page.getByLabel("Revision").fill("A");
  await page.getByLabel(/file \(max/).setInputFiles(PDF);
  await page.getByRole("button", { name: "Upload schematic" }).click();

  // 4. open the schematic
  await expect(page).toHaveURL(/\/schematics\/[0-9a-f-]{36}/);
  schematicUrl = page.url();
  await waitForCanvas(page);
  await expect(page.getByTestId("page-indicator")).toContainText("1 / 2");

  // 5. create a pinned annotation
  await page.getByTestId("tool-point").click();
  const canvas = page.getByTestId("pdf-canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * CLICK.fx, box.y + box.height * CLICK.fy);
  await expect(page.getByTestId("draft-marker")).toBeVisible();
  await page.getByLabel("Annotation text").fill("E2E pinned note: check relay K1");
  await page.getByTestId("save-annotation").click();
  await expect(page.getByTestId("annotation-marker")).toHaveCount(1);

  const stored = page.getByTestId("annotation-marker").first();
  expect(Number(await stored.getAttribute("data-x"))).toBeCloseTo(CLICK.fx, 2);
  expect(Number(await stored.getAttribute("data-y"))).toBeCloseTo(CLICK.fy, 2);

  // 6. reload
  await page.reload();
  await waitForCanvas(page);

  // 7. position is still correct (normalized value AND rendered pixel location)
  const marker = page.getByTestId("annotation-marker").first();
  await expect(marker).toBeVisible();
  expect(Number(await marker.getAttribute("data-x"))).toBeCloseTo(CLICK.fx, 2);
  expect(Number(await marker.getAttribute("data-y"))).toBeCloseTo(CLICK.fy, 2);
  const cBox = (await page.getByTestId("pdf-canvas").boundingBox())!;
  const circle = (await marker.locator("circle").last().boundingBox())!;
  expect((circle.x + circle.width / 2 - cBox.x) / cBox.width).toBeCloseTo(CLICK.fx, 1);
  expect((circle.y + circle.height / 2 - cBox.y) / cBox.height).toBeCloseTo(CLICK.fy, 1);

  // Stays aligned after zooming (normalized coordinates, not pixels)
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await waitForCanvas(page);
  const cBox2 = (await page.getByTestId("pdf-canvas").boundingBox())!;
  const circle2 = (await page.getByTestId("annotation-marker").first().locator("circle").last().boundingBox())!;
  expect((circle2.x + circle2.width / 2 - cBox2.x) / cBox2.width).toBeCloseTo(CLICK.fx, 1);
});

test("8: restricted (Viewer) user sees only what was shared and cannot write", async ({ page }) => {
  await signIn(page, "viewer@schematichub.test");

  // The schematic created above is private: the viewer must not be able to open it.
  expect(schematicUrl, "previous test must have run").not.toBe("");
  const denied = await page.goto(schematicUrl);
  expect(denied?.status()).toBe(404);

  // The shared demo schematic opens read-only.
  await page.goto("/schematics");
  await page.getByRole("link", { name: /Hydraulic Power Unit \(demo\)/ }).click();
  await waitForCanvas(page);
  await expect(page.getByText("View only")).toBeVisible();
  await expect(page.getByTestId("tool-point")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Access" })).toHaveCount(0);

  // No "Register machine" button for a Viewer, and the API refuses direct writes.
  await page.goto("/machines");
  await expect(page.getByRole("link", { name: "Register machine" })).toHaveCount(0);
  const res = await page.request.post("/api/annotations", {
    data: { schematic_id: schematicUrl.split("/").pop()!.split("?")[0], page_number: 1, type: "point", x: 0.5, y: 0.5 },
  });
  expect([403, 404]).toContain(res.status());
  const machine = await page.request.post("/api/machines", {
    data: { name: "n", category: "c", manufacturer: "m", model_number: "m", serial_number: "s" },
  });
  expect(machine.status()).toBe(403);
});
