import { expect, test, type Page } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const PASSWORD = process.env.SEED_PASSWORD ?? "Demo-Pass-123!";
const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
test.skip(!configured, "Supabase env vars not set — see TESTING.md");

async function signIn(page: Page, email = "tech@schematichub.test") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
}

const card = (page: Page, testId: string) => page.getByTestId(testId).locator('[data-slot="card"]');
const look = (page: Page, testId: string) =>
  card(page, testId).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, shadow: cs.boxShadow, transform: cs.translate }; // Tailwind 4 lifts with the `translate` property
  });

test("dashboard stat cards light up on hover and on keyboard focus, and open their page", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  const cards = ["stat-machines", "stat-schematics", "stat-open-issues", "stat-critical-open", "stat-machines-in-fault"];
  for (const id of cards) await expect(page.getByTestId(id)).toBeVisible();

  // hover: background, ring/shadow and position all change (the old effect was a barely visible grey)
  const before = await look(page, "stat-schematics");
  await page.getByTestId("stat-schematics").hover();
  await expect.poll(async () => (await look(page, "stat-schematics")).shadow).not.toBe(before.shadow);
  const hovered = await look(page, "stat-schematics");
  expect(hovered.bg).not.toBe(before.bg);
  expect(hovered.transform).not.toBe(before.transform);
  // other cards stay as they were
  expect((await look(page, "stat-machines")).shadow).toBe(before.shadow);

  // keyboard focus gets the same highlight
  await page.mouse.move(0, 0);
  await page.getByTestId("stat-machines").focus();
  await page.keyboard.press("Tab"); // moves on to the next card, which is focused by keyboard
  await expect.poll(async () => (await look(page, "stat-schematics")).shadow).not.toBe(before.shadow);

  // clicking the Schematics card opens the schematics page
  await page.getByTestId("stat-schematics").click();
  await expect(page).toHaveURL(/\/schematics$/);
});
