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

const stamp = Date.now();
const serial = `E2E-LOC-${stamp}`;
const nameLink = (page: Page, name: string) => page.locator("td:first-child a", { hasText: new RegExp(`^${name}$`) });

test("members see the shared list; a Technician can add but not edit or delete; a Viewer can only read", async ({ browser }) => {
  const tech = await (await browser.newContext()).newPage();
  await signIn(tech, "tech@schematichub.test");
  await tech.goto("/locations");
  const list = tech.getByTestId("location-list");
  await expect(list).toContainText("Yard North");
  await expect(list).toContainText("41.8781, -87.6298");
  await expect(list).toContainText("Plant 1 / Bay 3");
  await expect(list).toContainText("No coordinates");
  await expect(tech.getByRole("heading", { name: "Add a location" })).toBeVisible();
  await expect(tech.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  await expect(tech.getByRole("button", { name: /^Delete / })).toHaveCount(0);

  const viewer = await (await browser.newContext()).newPage();
  await signIn(viewer, "viewer@schematichub.test");
  await viewer.goto("/locations");
  await expect(viewer.getByTestId("location-list")).toContainText("Yard North");
  await expect(viewer.getByRole("heading", { name: "Add a location" })).toHaveCount(0);

  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, "admin@schematichub.test");
  await admin.goto("/locations");
  await expect(admin.getByRole("button", { name: "Edit Yard North" })).toBeVisible(); // positive control for the absence checks above
});

test("add a location using place lookup; lookup failures degrade to typing coordinates", async ({ page }) => {
  await signIn(page, "admin@schematichub.test");
  await page.goto("/locations");

  // failure first: clear message, manual entry still works
  await page.route("**/api/geocode**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, reason: "timeout", message: "Place lookup timed out. Try again." }) }),
  );
  const form = page.getByRole("form", { name: "Add location" });
  await form.getByLabel("Name").fill("E2E Depot");
  await form.getByTestId("geocode-lookup").click();
  await expect(form.getByRole("status")).toContainText("timed out");
  await page.unroute("**/api/geocode**");

  // success: pick a match, coordinates fill in
  await page.route("**/api/geocode**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, matches: [{ name: "Springfield", region: "Illinois", country: "United States", latitude: 39.8017, longitude: -89.6437, label: "Springfield, Illinois, United States" }] }),
    }),
  );
  await form.getByTestId("geocode-lookup").click();
  await page.getByRole("button", { name: /Springfield, Illinois/ }).click();
  await expect(form.getByLabel("Latitude")).toHaveValue("39.8017");
  await expect(form.getByLabel("Longitude")).toHaveValue("-89.6437");
  await form.getByLabel("Notes").fill("E2E test site");
  await form.getByRole("button", { name: "Add location" }).click();
  await expect(page.getByTestId("location-list")).toContainText("E2E Depot");
  await expect(page.getByTestId("location-list")).toContainText("39.8017, -89.6437");

  // validation: half a coordinate pair is rejected with a clear message
  await form.getByLabel("Name").fill("E2E Half Pair");
  await form.getByLabel("Latitude").fill("12");
  await form.getByRole("button", { name: "Add location" }).click();
  await expect(form.getByRole("alert")).toContainText(/both latitude and longitude/i);
  // duplicate names are rejected case-insensitively
  await form.getByLabel("Name").fill("e2e depot");
  await form.getByLabel("Latitude").fill("");
  await form.getByRole("button", { name: "Add location" }).click();
  await expect(form.getByRole("alert")).toBeVisible();
});

test("register a machine by picking the location from the dropdown; weather uses the location's coordinates", async ({ page }) => {
  await signIn(page, "admin@schematichub.test");
  await page.goto("/machines/new");

  const select = page.getByLabel("Location", { exact: true });
  await expect(select.locator("option", { hasText: "E2E Depot" })).toHaveCount(1);
  await expect(select.locator("option", { hasText: "Yard North" })).toHaveCount(1);
  const value = await select.locator("option", { hasText: "E2E Depot" }).getAttribute("value");
  await select.selectOption(value!);
  await expect(page.getByText(/Weather context will use E2E Depot/)).toBeVisible();

  await page.getByLabel(/Machine name/).fill("E2E Located Pump");
  await page.getByLabel(/Category/).fill("Pump");
  await page.getByLabel(/Manufacturer/).fill("E2E Works");
  await page.getByLabel(/Model number/).fill("LP-1");
  await page.getByLabel(/Serial number/).fill(serial);
  await page.getByRole("button", { name: "Register machine" }).click();

  await expect(page.getByRole("heading", { name: "E2E Located Pump" })).toBeVisible();
  await expect(page.getByText("E2E Depot").first()).toBeVisible();
  await expect(page.getByText(/from location E2E Depot/)).toBeVisible();
  // live Open-Meteo data, with no coordinates stored on the machine itself
  await expect(page.getByText(/°C/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/from Open-Meteo/)).toBeVisible();
  await page.screenshot({ path: "test-results/flow-location-weather.png" });
});

test("renaming a location updates its machines and search; deleting it keeps the machines", async ({ page }) => {
  await signIn(page, "admin@schematichub.test");
  await page.goto("/locations");
  await page.getByRole("button", { name: "Edit E2E Depot" }).click();
  const edit = page.getByRole("form", { name: "Edit E2E Depot" });
  await edit.getByLabel("Name").fill("E2E Depot Renamed");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("location-list")).toContainText("E2E Depot Renamed");
  await expect(page.getByTestId("location-list")).toContainText("1 machine");

  // machines list and location search follow the rename
  await page.goto("/machines");
  await page.getByLabel("Search machines").fill("Depot Renamed");
  await page.getByLabel("Search in").selectOption("location");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(nameLink(page, "E2E Located Pump")).toBeVisible();

  // delete the location: the machine survives, unlinked, and weather falls back
  await page.goto("/locations");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete E2E Depot Renamed" }).click();
  await expect(page.getByTestId("location-list")).not.toContainText("E2E Depot Renamed");
  await page.goto("/machines");
  await nameLink(page, "E2E Located Pump").click();
  await expect(page.getByRole("heading", { name: "E2E Located Pump" })).toBeVisible();
  await expect(page.getByText(/No coordinates on file/)).toBeVisible();
});
