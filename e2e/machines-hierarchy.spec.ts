import { expect, test, type Page } from "@playwright/test";
import dotenv from "dotenv";
import { adminClient, hasSupabaseCreds, seed, type SeedResult } from "../scripts/lib/seed-lib";
import { cleanupE2eData } from "./cleanup";

dotenv.config({ path: ".env.local" });

const PASSWORD = process.env.SEED_PASSWORD ?? "Demo-Pass-123!";
const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
test.skip(!configured, "Supabase env vars not set — see TESTING.md");
test.describe.configure({ mode: "serial" });

// Self-contained fixtures (the demo data may have been changed by whoever is using the app):
//   E2E System A  ->  E2E Hydraulic Unit (CRITICAL component, open HIGH issue)  and  E2E Control Box (not critical)
const SYSTEM = "E2E System A";
const UNIT = "E2E Hydraulic Unit";
const BOX = "E2E Control Box";
const stamp = Date.now();

test.beforeAll(async () => {
  if (!hasSupabaseCreds()) return;
  const s: SeedResult = await seed();
  const admin = adminClient();
  const base = { org_id: s.orgId, category: "E2E", manufacturer: "E2E Works", model_number: "X", created_by: s.ids.admin };
  const mk = async (name: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await admin.from("machines").insert({ ...base, name, serial_number: `E2E-FIX-${name.replace(/\W+/g, "")}-${stamp}`, ...extra }).select("id").single();
    if (error) throw error;
    return data.id as string;
  };
  const system = await mk(SYSTEM);
  const unit = await mk(UNIT, { parent_id: system, is_critical: true });
  await mk(BOX, { parent_id: system, is_critical: false });
  const { error } = await admin.from("maintenance_issues").insert({
    org_id: s.orgId, machine_id: unit, title: "E2E pump bearing failure", description: "fixture", severity: "high", reporter_id: s.ids.tech,
  });
  if (error) throw error;
});
test.afterAll(async () => { await cleanupE2eData(); });

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
}

/** The link in the NAME column (child rows also mention their parent's name in "Part of"). */
const nameLink = (page: Page, name: string) => page.locator("tbody tr td:first-child a", { hasText: new RegExp(`^${name}$`) });
const rowFor = (page: Page, name: string) =>
  page.locator("tbody tr").filter({ has: page.locator("td:first-child a", { hasText: new RegExp(`^${name}$`) }) });

async function search(page: Page, q: string, field: string) {
  await page.goto("/machines");
  await page.getByLabel("Search machines").fill(q);
  await page.getByLabel("Search in").selectOption(field);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=/);
}
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

test("sub-machines stay hidden until you expand their main component or search for them", async ({ page }) => {
  await signIn(page, "admin@schematichub.test");
  await page.goto("/machines");
  await expect(page.getByLabel("Search machines")).toHaveValue("");

  // top level only
  await expect(rowFor(page, SYSTEM)).toBeVisible();
  await expect(rowFor(page, UNIT)).toHaveCount(0);
  await expect(rowFor(page, BOX)).toHaveCount(0);
  await expect(rowFor(page, "Control Cabinet CC-7")).toHaveCount(0);
  await expect(rowFor(page, "Hydraulic Press 7")).toBeVisible();

  // the collapsed parent says what is inside, and warns about faults it contains
  const system = rowFor(page, SYSTEM);
  await expect(system.getByTestId("hidden-count")).toContainText("2 sub-machines");
  await expect(system.getByTestId("hidden-count")).toContainText("fault inside");
  await expect(system).toContainText(/inoperable \(inherited\)/i);

  // expand -> children appear (indented), collapse -> hidden again
  const toggle = page.getByRole("button", { name: `Expand sub-machines of ${SYSTEM}` });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.getByRole("button", { name: `Collapse sub-machines of ${SYSTEM}` })).toHaveAttribute("aria-expanded", "true");
  await expect(rowFor(page, UNIT)).toBeVisible();
  await expect(rowFor(page, BOX)).toBeVisible();
  await expect(rowFor(page, UNIT)).toHaveAttribute("data-depth", "1");
  await expect(rowFor(page, UNIT)).toContainText("critical");
  await expect(rowFor(page, UNIT)).toContainText("major issue");
  await expect(rowFor(page, BOX)).not.toContainText(/inoperable/i);
  await page.screenshot({ path: "test-results/flow-tree-expanded.png" });
  await page.getByRole("button", { name: `Collapse sub-machines of ${SYSTEM}` }).click();
  await expect(rowFor(page, UNIT)).toHaveCount(0);

  // expand all / collapse all
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(rowFor(page, UNIT)).toBeVisible();
  await expect(rowFor(page, "Control Cabinet CC-7")).toBeVisible();
  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(rowFor(page, UNIT)).toHaveCount(0);

  // searching shows sub-machines directly, with a "Part of" link
  await search(page, "Hydraulic Unit", "name");
  await expect(rowFor(page, UNIT)).toBeVisible();
  await expect(rowFor(page, UNIT)).toContainText(SYSTEM);
  await expect(page.getByRole("button", { name: /Expand sub-machines/ })).toHaveCount(0);

  // the status filter understands the derived statuses
  await page.goto("/machines?status=inoperable");
  await expect(rowFor(page, SYSTEM)).toBeVisible();
  await expect(rowFor(page, UNIT)).toHaveCount(0); // the unit itself is not inoperable, it is the cause
  await page.goto("/machines?status=critical");
  await expect(rowFor(page, SYSTEM)).toHaveCount(0); // nobody has a critical-severity issue in the fixture
});

test("status reflects a critical fault or an inherited one; detail page, list and dashboard agree", async ({ page }) => {
  await signIn(page, "admin@schematichub.test");
  await page.goto("/machines");
  await expect(page.getByRole("link", { name: "Register machine" })).toBeVisible(); // positive control: admins DO see it

  await nameLink(page, SYSTEM).click();
  const banner = page.getByTestId("inoperable-banner");
  await expect(banner).toContainText(UNIT);
  await expect(banner).toContainText("clears automatically");
  await expect(page.getByText(/inoperable \(inherited\)/i).first()).toBeVisible();
  const subs = page.getByTestId("sub-machines");
  await expect(subs).toContainText(UNIT);
  await expect(subs).toContainText(BOX);

  // the cause: HIGH issue on a critical component => not "critical fault" itself, but it names what it took down
  await subs.getByRole("link", { name: UNIT }).click();
  await expect(page.getByRole("navigation", { name: "System hierarchy" })).toContainText(SYSTEM);
  await expect(page.getByTestId("inoperable-banner")).toHaveCount(0);
  await expect(page.getByTestId("critical-banner")).toHaveCount(0);
  await expect(page.getByTestId("causing-notice")).toContainText(SYSTEM);

  await page.goto("/");
  await expect(page.getByText("Machines in fault")).toBeVisible();
});

test("create a sub-machine, raise a CRITICAL issue: it shows 'critical fault' and its parent turns inoperable; resolving clears both", async ({ page }) => {
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
  await expect(page.getByTestId("critical-banner")).toHaveCount(0);
  const motorUrl = page.url();

  // a CRITICAL issue on the critical sub-machine
  await page.getByLabel("Issue title").fill("E2E bearing seized");
  await page.getByLabel("Severity").selectOption("critical");
  await page.getByRole("button", { name: "Report issue" }).click();
  await expect(page.getByText("E2E bearing seized")).toBeVisible();

  // the machine itself now reads "critical fault"
  await page.goto(motorUrl);
  await expect(page.getByTestId("critical-banner")).toContainText("1 unresolved critical issue");
  await expect(page.getByText("critical fault").first()).toBeVisible();
  await search(page, "Fan Motor", "name");
  await expect(rowFor(page, "E2E Fan Motor")).toContainText("critical fault");
  await page.goto("/machines?status=critical");
  await expect(rowFor(page, "E2E Fan Motor")).toBeVisible(); // filterable by the derived status

  // and its parent is inoperable, naming the cause
  await page.goto("/machines");
  await nameLink(page, "Cooling Tower CT-1").click();
  await expect(page.getByTestId("inoperable-banner")).toContainText("E2E Fan Motor");
  await page.screenshot({ path: "test-results/flow-inoperable.png" });

  // resolving the issue clears both states
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
  await expect(page.getByTestId("critical-banner")).toHaveCount(0);
});

test("a read-only Viewer cannot see the add-sub-machine button, and top-level machines are shown collapsed", async ({ page }) => {
  await signIn(page, "viewer@schematichub.test");
  await page.goto("/machines");
  await expect(rowFor(page, "Hydraulic Press 7")).toBeVisible();
  await nameLink(page, "Hydraulic Press 7").click();
  await expect(page.getByTestId("sub-machines")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add sub-machine" })).toHaveCount(0);
  await expect(page.getByText("Add sub-machine")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
});
