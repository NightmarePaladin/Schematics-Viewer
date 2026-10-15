import { expect, test, type Page } from "@playwright/test";
import dotenv from "dotenv";
import { adminClient, hasSupabaseCreds } from "../scripts/lib/seed-lib";

dotenv.config({ path: ".env.local" });

const PASSWORD = process.env.SEED_PASSWORD ?? "Demo-Pass-123!";
test.skip(!hasSupabaseCreds(), "Supabase env vars not set — see TESTING.md");
test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
}

test("a browser whose session is no longer valid ends on the login page, not in a redirect loop", async ({ page }) => {
  const admin = adminClient();
  const email = `ghost-${Date.now()}@schematichub.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: "Ghost" } });
  if (error) throw error;
  const id = data.user.id;

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/onboarding/);

    // The browser still holds a cryptographically valid token, but the account behind it is gone (same as a revoked session).
    await admin.auth.admin.deleteUser(id);

    for (const path of ["/", "/machines", "/login", "/onboarding"]) {
      const res = await page.goto(path); // a redirect loop makes goto throw net::ERR_TOO_MANY_REDIRECTS
      expect(res?.status(), path).toBeLessThan(400);
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    }
    // and it can sign in again as somebody else straight away
    await page.getByLabel("Email").fill("viewer@schematichub.test");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  } finally {
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
});

test("signing out on one device does not sign the same account out everywhere else", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage(); // e.g. the presenter's laptop
  const b = await (await browser.newContext()).newPage(); // e.g. a classmate using the same demo account
  await signIn(a, "tech2@schematichub.test");
  await signIn(b, "tech2@schematichub.test");

  await b.getByRole("button", { name: "Sign out" }).click();
  await expect(b).toHaveURL(/\/login/);

  await a.goto("/machines");
  await expect(a.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(a).toHaveURL(/\/machines/);
  await a.reload();
  await expect(a.getByRole("heading", { name: "Machines" })).toBeVisible();
});
