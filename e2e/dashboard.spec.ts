import { expect, test, type Page } from "@playwright/test";
import dotenv from "dotenv";
import { adminClient, USERS } from "../scripts/lib/seed-lib";
import { cleanupE2eData } from "./cleanup";

dotenv.config({ path: ".env.local" });

const PASSWORD = process.env.SEED_PASSWORD ?? "Demo-Pass-123!";
const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
test.skip(!configured, "Supabase env vars not set — see TESTING.md");
test.describe.configure({ mode: "serial" });

const ISSUES = 14;
const LOGS = 12;

test.beforeAll(async () => {
  await cleanupE2eData();
  const admin = adminClient();
  const { data: org } = await admin.from("organizations").select("id").eq("name", "Acme Industrial (demo)").single();
  const { data: tech } = await admin.from("profiles").select("id").ilike("email", USERS.tech.email).single();
  const { data: machine } = await admin.from("machines").select("id").eq("org_id", org!.id).ilike("name", "Hydraulic Press 7").single();
  const priorities = ["urgent", "high", "normal", "low"];
  for (let i = 1; i <= ISSUES; i++) {
    await admin.from("maintenance_issues").insert({
      org_id: org!.id, machine_id: machine!.id, title: `E2E dash issue ${i}`, severity: "low", status: i % 3 === 0 ? "in_progress" : "open",
      repair_priority: priorities[i % priorities.length], reporter_id: tech!.id,
    });
  }
  for (let i = 1; i <= LOGS; i++) {
    await admin.from("maintenance_logs").insert({ org_id: org!.id, machine_id: machine!.id, entry_type: "note", body: `E2E dash log ${i}`, performed_by: tech!.id });
  }
});
test.afterAll(async () => { await cleanupE2eData(); });

async function signIn(page: Page, email = "tech@schematichub.test") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // on a phone the sidebar is behind the menu button, so accept either
  await expect(page.getByRole("link", { name: "Dashboard" }).or(page.getByRole("button", { name: "Open navigation" }))).toBeVisible();
}

const card = (page: Page, testId: string) => page.getByTestId(testId).locator('[data-slot="card"]');
const look = (page: Page, testId: string) =>
  card(page, testId).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, shadow: cs.boxShadow, lift: cs.translate }; // Tailwind 4 lifts with the `translate` property
  });
/** rows the list is actually showing (the ones that did not fit are kept but invisible and inert) */
const visibleRows = (page: Page, list: "issues" | "logs") =>
  page.getByTestId(`dash-${list}-list`).evaluate((ul) => [...ul.children].filter((li) => !li.classList.contains("invisible")).length);
const totalOf = async (page: Page, list: "issues" | "logs") => Number((await page.getByTestId(`dash-${list}-open`).innerText()).match(/\((\d+)\)/)![1]);

test("stat cards: no arrows, a thin highlight on hover and keyboard focus, and they open their page", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  for (const id of ["stat-machines", "stat-schematics", "stat-open-issues", "stat-critical-open", "stat-machines-in-fault"]) {
    await expect(page.getByTestId(id)).toBeVisible();
    expect(await page.getByTestId(id).locator("svg").count(), `${id} has no arrow icon`).toBe(0);
  }

  const before = await look(page, "stat-schematics");
  await page.getByTestId("stat-schematics").hover();
  await expect.poll(async () => (await look(page, "stat-schematics")).shadow).not.toBe(before.shadow);
  const hovered = await look(page, "stat-schematics");
  expect(hovered.bg).not.toBe(before.bg);
  expect(hovered.lift).not.toBe(before.lift);
  // the outline is 1px, not the previous 2px
  expect(hovered.shadow).toContain("0px 0px 0px 1px");
  expect(hovered.shadow).not.toContain("0px 0px 0px 2px");
  expect((await look(page, "stat-machines")).shadow).toBe(before.shadow); // other cards are unaffected

  await page.mouse.move(0, 0);
  await page.getByTestId("stat-machines").focus();
  await page.keyboard.press("Tab");
  await expect.poll(async () => (await look(page, "stat-schematics")).shadow).toContain("0px 0px 0px 1px");

  await page.getByTestId("stat-schematics").click();
  await expect(page).toHaveURL(/\/schematics$/);
});

test("desktop: the lists fill the page with as many rows as fit, most urgent repair first", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await signIn(page);
  await page.goto("/");
  await expect(page.getByTestId("dash-issues-list")).toBeVisible();

  const total = await totalOf(page, "issues");
  expect(total).toBeGreaterThanOrEqual(ISSUES);
  const tall = await visibleRows(page, "issues");
  expect(tall).toBeGreaterThan(0);
  expect(tall).toBeLessThan(total); // there are more than fit, so it is limited
  await expect(page.getByTestId("dash-issues-more")).toContainText(`Showing ${tall} of ${total}`);

  // one screen: the page itself does not scroll
  const scrolls = await page.evaluate(() => { const m = document.querySelector("main")!; return m.scrollHeight > m.clientHeight + 1; });
  expect(scrolls).toBe(false);

  // most urgent first
  await expect(page.getByTestId("dash-issues-list").getByTestId("dash-issue-row").first()).toContainText("Urgent priority");

  // a shorter window shows fewer rows; a taller one shows more
  await page.setViewportSize({ width: 1280, height: 620 });
  await expect.poll(() => visibleRows(page, "issues")).toBeLessThan(tall);
  const short = await visibleRows(page, "issues");
  await page.setViewportSize({ width: 1280, height: 1100 });
  await expect.poll(() => visibleRows(page, "issues")).toBeGreaterThan(short);

  // rows that do not fit are hidden from keyboard and screen readers
  const hiddenInert = await page.getByTestId("dash-issues-list").evaluate((ul) => [...ul.children].filter((li) => li.classList.contains("invisible")).every((li) => li.hasAttribute("inert")));
  expect(hiddenInert).toBe(true);
});

test("desktop: View all (button or a click on the card) opens a window with the full list", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await signIn(page);
  await page.goto("/");
  const total = await totalOf(page, "issues");

  await page.getByTestId("dash-issues-open").click();
  const dlg = page.getByTestId("dash-issues-dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId("dash-issues-full").locator("li")).toHaveCount(Math.min(total, 100));
  await expect(dlg).toContainText(`Open issues (${total})`);
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();

  // clicking empty space on the maintenance card opens its full list too
  const box = (await page.getByTestId("dash-logs").boundingBox())!;
  await page.mouse.click(box.x + box.width - 12, box.y + box.height - 6);
  const logs = page.getByTestId("dash-logs-dialog");
  await expect(logs).toBeVisible();
  expect(await logs.getByTestId("dash-logs-full").locator("li").count()).toBeGreaterThanOrEqual(LOGS);
  await expect(logs.getByText(/E2E dash log \d+/).first()).toBeVisible();
  await page.keyboard.press("Escape");

  // a link inside a row still goes to its page instead of opening the window
  await page.getByTestId("dash-issues-list").getByTestId("dash-issue-row").first().getByRole("link").click();
  await expect(page).toHaveURL(/\/machines\/[0-9a-f-]{36}/);
});

test("phone: six rows per list, no sideways scroll, and View all still opens the full list", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  await page.goto("/");
  await expect(page.getByTestId("dash-issues-list")).toBeVisible();
  expect(await page.getByTestId("dash-issues-list").getByTestId("dash-issue-row").count()).toBeLessThanOrEqual(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByTestId("dash-issues-open").click();
  await expect(page.getByTestId("dash-issues-full").locator("li").first()).toBeVisible();
});

test("sidebar: Settings expands to show its sections, and a section jumps to its card", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await signIn(page);
  await page.goto("/");
  const settings = page.getByTestId("nav-settings");
  const sub = page.getByTestId("settings-subnav");
  await expect(settings).toHaveAttribute("aria-expanded", "false");
  await expect(sub).toBeHidden();

  await settings.click(); // from another page: expands and opens the Settings page
  await expect(page).toHaveURL(/\/settings/);
  await expect(settings).toHaveAttribute("aria-expanded", "true");
  for (const name of ["Account", "Display and accessibility", "Tool permissions", "Roles"]) await expect(sub.getByRole("link", { name })).toBeVisible();

  await sub.getByRole("link", { name: "Tool permissions" }).click();
  await expect(page).toHaveURL(/\/settings#tool-permissions$/);
  await expect(sub.getByRole("link", { name: "Tool permissions" })).toHaveAttribute("aria-current", "location");
  await expect(page.locator("#tool-permissions")).toBeInViewport();

  await settings.click(); // pressing again collapses it
  await expect(settings).toHaveAttribute("aria-expanded", "false");
  await expect(sub).toBeHidden();
});
