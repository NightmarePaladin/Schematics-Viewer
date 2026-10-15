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

async function search(page: Page, q: string, field: string) {
  await page.goto("/machines");
  await page.getByLabel("Search machines").fill(q);
  await page.getByLabel("Search in").selectOption(field);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=/);
}
/** The link in the NAME column (child rows also mention their parent's name in "Part of"). */
const nameLink = (page: Page, name: string) => page.locator("tbody tr td:first-child a", { hasText: new RegExp(`^${name}$`) });
const rowFor = (page: Page, name: string) =>
  page.locator("tbody tr").filter({ has: page.locator("td:first-child a", { hasText: new RegExp(`^${name}$`) }) });
const rowNames = (page: Page) => page.locator("tbody tr td:first-child a").allInnerTexts();

test("search machines by location, name, manufacturer or model (and all fields, multi-word)", async ({ page }) => {
  await signIn(page, "admin@schematichub.test");

  await search(page, "Yard", "location");
  expect(await rowNames(page)).toEqual(["Outdoor Compressor C2"]);

  await search(page, "cooling", "name");
  expect(await rowNames(page)).toEqual(["Cooling Tower CT-1"]);

  await search(page, "airmaster", "manufacturer");
  expect((await rowNames(page)).sort()).toEqual(["Cooling Tower CT-1", "Outdoor Compressor C2"]);

  await search(page, "HP-450", "model");
  expect(await rowNames(page)).toEqual(["Hydraulic Press 7"]);

  // searching a column that does not hold the text finds nothing (field scoping works)
  await search(page, "Forgeworks", "name");
  expect(await rowNames(page)).toEqual([]);
  await expect(page.getByText("No machines match")).toBeVisible();

  // all fields, partial and case-insensitive
  await search(page, "bay 3", "all");
  expect((await rowNames(page)).join("|")).toContain("Hydraulic Press 7");
  expect(await rowNames(page)).not.toContain("Outdoor Compressor C2");

  // every word must match somewhere
  await search(page, "airmaster yard", "all");
  expect(await rowNames(page)).toEqual(["Outdoor Compressor C2"]);
  await expect(page.getByRole("status")).toContainText("1 result");
  await page.screenshot({ path: "test-results/flow-search.png" });
});

test("a critical sub-machine with a major issue makes its parent inoperable; list, detail and dashboard agree", async ({ page }) => {
  await signIn(page, "admin@schematichub.test");

  await page.goto("/machines");
  await expect(page.getByRole("link", { name: "Register machine" })).toBeVisible(); // positive control: admins DO see it
  const pressRow = rowFor(page, "Hydraulic Press 7");
  await expect(pressRow).toContainText(/inoperable \(inherited\)/i);
  const hpuRow = rowFor(page, "Hydraulic Power Unit HPU-7");
  await expect(hpuRow).toContainText("critical");
  await expect(hpuRow).toContainText("Hydraulic Press 7"); // "Part of"
  await expect(rowFor(page, "Control Cabinet CC-7")).not.toContainText(/inoperable/i);

  await nameLink(page, "Hydraulic Press 7").click();
  const banner = page.getByTestId("inoperable-banner");
  await expect(banner).toContainText("Hydraulic Power Unit HPU-7");
  await expect(banner).toContainText("clears automatically");
  const subs = page.getByTestId("sub-machines");
  await expect(subs).toContainText("Hydraulic Power Unit HPU-7");
  await expect(subs).toContainText("Control Cabinet CC-7");
  await page.screenshot({ path: "test-results/flow-inoperable.png" });

  // the sub-machine shows the breadcrumb back to its system and is not itself inherited-inoperable
  await subs.getByRole("link", { name: "Hydraulic Power Unit HPU-7" }).click();
  await expect(page.getByRole("navigation", { name: "System hierarchy" })).toContainText("Hydraulic Press 7");
  await expect(page.getByTestId("inoperable-banner")).toHaveCount(0);
  await expect(page.getByTestId("causing-notice")).toContainText("Hydraulic Press 7"); // the cause says what it has taken down

  await page.goto("/");
  await expect(page.getByText("Inoperable machines")).toBeVisible();
});

test("create a sub-machine from its parent, mark it critical, raise a major issue, then resolve it", async ({ page }) => {
  await signIn(page, "admin@schematichub.test");
  const serial = `E2E-SUB-${Date.now()}`;

  await page.goto("/machines");
  await nameLink(page, "Cooling Tower CT-1").click();
  await page.getByRole("link", { name: "Add sub-machine" }).click();
  await expect(page.getByLabel(/Part of/)).toHaveValue(/.+/); // preselected parent

  // criticality only applies to a sub-machine: disabled without a parent
  await page.getByLabel(/Part of/).selectOption("");
  await expect(page.getByLabel(/Critical component/)).toBeDisabled();
  const parentSelect = page.getByLabel(/Part of/);
  const towerValue = await parentSelect.locator("option", { hasText: "Cooling Tower CT-1" }).getAttribute("value");
  await parentSelect.selectOption(towerValue!);
  await expect(page.getByLabel(/Critical component/)).toBeEnabled();

  await page.getByLabel(/Machine name/).fill("E2E Fan Motor");
  await page.getByLabel(/Category/).fill("Motor");
  await page.getByLabel(/Manufacturer/).fill("E2E Works");
  await page.getByLabel(/Model number/).fill("FM-1");
  await page.getByLabel(/Serial number/).fill(serial);
  await page.getByLabel(/Critical component/).check();
  await page.getByRole("button", { name: "Register machine" }).click();

  await expect(page.getByRole("heading", { name: "E2E Fan Motor" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "System hierarchy" })).toContainText("Cooling Tower CT-1");
  const motorUrl = page.url();

  // report a MAJOR issue on the critical sub-machine
  await page.getByLabel("Issue title").fill("E2E bearing seized");
  await page.getByLabel("Severity").selectOption("high");
  await page.getByRole("button", { name: "Report issue" }).click();
  await expect(page.getByText("E2E bearing seized")).toBeVisible();

  // parent is now inoperable and names the cause
  await page.goto("/machines");
  await nameLink(page, "Cooling Tower CT-1").click();
  await expect(page.getByTestId("inoperable-banner")).toContainText("E2E Fan Motor");

  // a MINOR issue would not do this; resolving the major one clears the state
  await page.goto("/maintenance");
  const item = page.getByRole("listitem").filter({ hasText: "E2E bearing seized" });
  await item.getByRole("button", { name: "Resolve…" }).click();
  await item.getByLabel("Resolution note").fill("Motor replaced");
  await item.getByRole("button", { name: "Mark resolved" }).click();
  await expect(page.getByText("Resolution: Motor replaced", { exact: true })).toBeVisible();

  await page.goto("/machines");
  await nameLink(page, "Cooling Tower CT-1").click();
  await expect(page.getByTestId("inoperable-banner")).toHaveCount(0);
  await page.goto(motorUrl);
  await expect(page.getByRole("heading", { name: "E2E Fan Motor" })).toBeVisible();
});

test("a read-only Viewer cannot see the add-sub-machine button", async ({ page }) => {
  await signIn(page, "viewer@schematichub.test");
  await page.goto("/machines");
  await nameLink(page, "Hydraulic Press 7").click();
  await expect(page.getByTestId("inoperable-banner")).toBeVisible(); // derived state is visible to everyone who can see the machine
  await expect(page.getByTestId("sub-machines")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add sub-machine" })).toHaveCount(0);
  await expect(page.getByText("Add sub-machine")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
});
