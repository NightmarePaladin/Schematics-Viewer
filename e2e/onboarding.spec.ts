import { expect, test } from "@playwright/test";
import dotenv from "dotenv";
import { adminClient, hasSupabaseCreds } from "../scripts/lib/seed-lib";

dotenv.config({ path: ".env.local" });

const PASSWORD = process.env.SEED_PASSWORD ?? "Demo-Pass-123!";
test.skip(!hasSupabaseCreds(), "Supabase env vars not set — see TESTING.md");

const email = `newbie-${Date.now()}@schematichub.test`;
let userId = "";

test.beforeAll(async () => {
  const { data, error } = await adminClient().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: "New Person" } });
  if (error) throw error;
  userId = data.user.id;
});

test.afterAll(async () => {
  const admin = adminClient();
  await admin.from("organizations").delete().eq("created_by", userId); // cascades memberships, groups, machines…
  await admin.auth.admin.deleteUser(userId);
});

test("a brand-new user with no organization is sent to onboarding from every page (no error page), then gets a working workspace", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/onboarding/);

  for (const path of ["/", "/machines", "/schematics", "/maintenance", "/teams", "/settings"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByRole("heading", { name: "Create your organization" })).toBeVisible();
  }

  // API refuses with a clear JSON error rather than leaking anything
  const res = await page.request.get("/api/machines");
  expect(res.status()).toBe(403);
  expect((await res.json()).error.code).toBe("no_organization");

  await page.getByLabel("Organization name").fill("Brand New Org");
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Brand New Org").first()).toBeVisible();

  // the creator is the organization's Admin (can reach Teams management)
  await page.goto("/teams");
  await expect(page.getByText("Add or update a member")).toBeVisible();
});
