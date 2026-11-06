import { expect, test, type Page } from "@playwright/test";
import dotenv from "dotenv";
import { cleanupE2eData } from "./cleanup";

dotenv.config({ path: ".env.local" });

const PASSWORD = process.env.SEED_PASSWORD ?? "Demo-Pass-123!";
const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
test.skip(!configured, "Supabase env vars not set — see TESTING.md");
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => { await cleanupE2eData(); });
test.afterAll(async () => { await cleanupE2eData(); });

const stamp = Date.now();
const title = `E2E prio ${stamp}`;

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
}

test("report an issue with a priority of repair and a status, then change both", async ({ page }) => {
  await signIn(page, "tech@schematichub.test");
  await page.goto("/machines");
  await page.getByRole("link", { name: "Hydraulic Press 7" }).first().click();

  // the report form offers priority (default Normal) and status (default Open)
  const form = page.getByRole("form", { name: "Report issue" });
  await expect(form.getByLabel("Priority of repair")).toHaveValue("normal");
  await expect(form.getByLabel("Status")).toHaveValue("open");
  await form.getByLabel("Issue title").fill(title);
  await form.getByLabel("Priority of repair").selectOption("urgent");
  await form.getByLabel("Status").selectOption("in_progress");
  await form.getByRole("button", { name: "Report issue" }).click();

  const row = page.locator("li", { hasText: title });
  await expect(row).toContainText("Urgent priority");
  await expect(row).toContainText(/in progress/i); // shown capitalised by CSS

  // the maintenance page can filter by priority, lists the issue, and lets you change both fields
  await page.goto("/maintenance?priority=urgent");
  const issue = page.getByTestId("issue-row").filter({ hasText: title });
  await expect(issue).toContainText("Urgent priority");
  await page.goto("/maintenance?priority=low");
  await expect(page.getByTestId("issue-row").filter({ hasText: title })).toHaveCount(0);

  await page.goto("/maintenance");
  const item = page.getByTestId("issue-row").filter({ hasText: title });
  await item.getByLabel("Priority of repair").selectOption("low");
  await expect(item.locator('[data-priority="low"]')).toBeVisible(); // the badge (the words also appear in the dropdowns)
  await item.getByLabel("Status").selectOption("open");
  await expect(item.locator('[data-status="open"]')).toBeVisible();
  await expect(item.locator('[data-status="in_progress"]')).toHaveCount(0);

  // both changes are recorded in the maintenance log
  await expect(page.getByText(`Issue "${title}" repair priority changed from urgent to low.`)).toBeVisible();
  await expect(page.getByText(`Issue "${title}" changed from in_progress to open.`)).toBeVisible();
});

test("a viewer cannot change an issue's priority", async ({ page }) => {
  await signIn(page, "viewer@schematichub.test");
  await page.goto("/maintenance");
  const item = page.getByTestId("issue-row").filter({ hasText: title });
  await expect(item).toBeVisible();
  const select = item.getByLabel("Priority of repair");
  if (await select.count()) {
    await select.selectOption("urgent");
    await expect(page.getByRole("alert")).toBeVisible(); // the server refuses
  }
  await page.reload();
  await expect(page.getByTestId("issue-row").filter({ hasText: title })).toContainText("Low priority");
});
