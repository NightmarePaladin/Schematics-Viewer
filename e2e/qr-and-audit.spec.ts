import { expect, test, type Page } from "@playwright/test";
import dotenv from "dotenv";
import jsQR from "jsqr";
import { PNG } from "pngjs";
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

const decodePng = (buf: Buffer): string | null => {
  const img = PNG.sync.read(buf);
  return jsQR(new Uint8ClampedArray(img.data), img.width, img.height)?.data ?? null;
};
const stamp = Date.now();
let pressUrl = "";

test("QR labels: a sheet for every visible machine, and a single printable label", async ({ page }) => {
  await signIn(page, "admin@schematichub.test");
  await page.goto("/machines");
  await page.getByRole("link", { name: "QR labels", exact: true }).click();

  const sheet = page.getByTestId("label-sheet");
  await expect(sheet).toBeVisible();
  const labels = page.getByTestId("machine-label");
  expect(await labels.count()).toBeGreaterThanOrEqual(5); // sub-machines get labels too: they are the things you stick them on
  for (const url of await labels.evaluateAll((els) => els.map((e) => e.getAttribute("data-qr-url")))) {
    expect(url).toMatch(/\/machines\/[0-9a-f-]{36}$/);
  }
  await expect(page.getByRole("img", { name: "QR code linking to Hydraulic Press 7" })).toBeVisible();
  await expect(sheet).toContainText("Hydraulic Press 7");
  await expect(sheet).toContainText("S/N FW-10042");
  await page.screenshot({ path: "test-results/flow-qr-sheet.png" });

  // the single-machine label
  await page.goto("/machines");
  await page.locator("td:first-child a", { hasText: /^Hydraulic Press 7$/ }).click();
  await expect(page.getByRole("heading", { name: "Hydraulic Press 7" })).toBeVisible();
  await page.getByRole("link", { name: "QR label", exact: true }).click();
  await expect(page.getByRole("heading", { name: "QR label", exact: true })).toBeVisible();
  const label = page.getByTestId("machine-label");
  await expect(label).toContainText("Hydraulic Press 7");
  await expect(label).toContainText("Forgeworks HP-450");
  pressUrl = (await label.getAttribute("data-qr-url"))!;
  expect(pressUrl).toMatch(/\/machines\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("link", { name: "Download PNG" })).toBeVisible();
  await page.screenshot({ path: "test-results/flow-qr-label.png" });
});

test("the QR image really scans to the machine URL (PNG and SVG endpoints)", async ({ page }) => {
  await signIn(page, "admin@schematichub.test");
  const id = pressUrl.split("/").pop()!;

  const png = await page.request.get(`/api/machines/${id}/qr?format=png&size=600`);
  expect(png.status()).toBe(200);
  expect(png.headers()["content-type"]).toBe("image/png");
  expect(decodePng(await png.body())).toBe(pressUrl);

  const svg = await page.request.get(`/api/machines/${id}/qr`);
  expect(svg.headers()["content-type"]).toContain("image/svg+xml");
  expect(await svg.text()).toContain("<svg");
});

test("scanning while signed out sends you to sign in, then straight to the machine", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const path = new URL(pressUrl).pathname;

  await page.goto(pressUrl); // what a phone does after scanning
  await expect(page).toHaveURL(/\/login\?next=%2Fmachines%2F/);
  await page.getByLabel("Email").fill("tech@schematichub.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.getByRole("heading", { name: "Hydraulic Press 7" })).toBeVisible();
  await ctx.close();
});

test("the QR image endpoint is protected: signed-out 401, other organization 404, invalid id 404", async ({ browser, request }) => {
  const id = pressUrl.split("/").pop()!;
  expect((await request.get(`/api/machines/${id}/qr`)).status()).toBe(401);

  const ctx = await browser.newContext();
  const outsider = await ctx.newPage();
  await signIn(outsider, "outsider@othercorp.test");
  expect((await outsider.request.get(`/api/machines/${id}/qr?format=png`)).status()).toBe(404);
  expect((await outsider.request.get(`/api/machines/not-a-uuid/qr`)).status()).toBe(404);
  await ctx.close();
});

test("a Viewer only gets labels for machines they can see; printing hides the app chrome", async ({ page }) => {
  await signIn(page, "viewer@schematichub.test");
  await page.goto("/machines/labels");
  await expect(page.getByTestId("label-sheet")).toContainText("Hydraulic Press 7");
  await expect(page.getByTestId("label-sheet")).not.toContainText("Outdoor Compressor C2");

  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  await expect(page.getByTestId("print-button")).toBeHidden();
  await expect(page.getByTestId("machine-label").first()).toBeVisible();
  await page.emulateMedia({ media: "screen" });
});

test("audit log: admins see who did what, with changes, filters and a CSV export", async ({ page }) => {
  await signIn(page, "admin@schematichub.test");
  const name = `E2E Audit Loc ${stamp}`;
  const renamed = `E2E Audit Renamed ${stamp}`;

  // do some work through the real API (as the signed-in admin)
  const created = await page.request.post("/api/locations", { data: { name } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).data.id as string;
  expect((await page.request.patch(`/api/locations/${id}`, { data: { name: renamed } })).status()).toBe(200);
  expect((await page.request.delete(`/api/locations/${id}`)).status()).toBe(204);

  await page.goto(`/audit?entity=location&q=${encodeURIComponent(String(stamp))}`);
  const table = page.getByTestId("audit-table");
  await expect(table).toContainText(`Created location “${name}”`);
  await expect(table).toContainText(`Updated location “${renamed}”`);
  await expect(table).toContainText(`Deleted location “${renamed}”`);
  await expect(table).toContainText(`name: ${name} → ${renamed}`);
  await expect(table).toContainText("Ada Admin (admin@schematichub.test)");
  await expect(table).toContainText("location.updated");
  await expect(page.getByRole("status")).toContainText("3 events match");
  await page.screenshot({ path: "test-results/flow-audit.png" });

  // filters narrow the result
  await page.goto(`/audit?entity=machine&q=${encodeURIComponent(String(stamp))}`);
  await expect(page.getByText("No audit events yet")).toBeVisible();
  await page.goto("/audit");
  await expect(page.getByLabel("Filter by person").locator("option", { hasText: "Ada Admin" })).toHaveCount(1);

  // CSV export (same filters)
  const csv = await page.request.get(`/api/audit/export?entity=location&q=${stamp}`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(csv.headers()["content-disposition"]).toContain("attachment");
  const body = await csv.text();
  expect(body.split("\r\n")[0]).toBe("time_utc,actor,action,entity_type,entity_id,description,details,metadata_json");
  expect(body).toContain("location.created");
  expect(body).toContain("location.deleted");
  expect(body).toContain(renamed);
});

test("audit log shows WHO had access taken away, and from what", async ({ page }) => {
  await signIn(page, "admin@schematichub.test");

  // find the private schematic, a person and a group to work with (through the real API)
  const schematics = (await (await page.request.get("/api/schematics")).json()).data as { id: string; title: string }[];
  const target = schematics.find((s) => s.title === "Compressor control wiring (private)")!;
  const members = (await (await page.request.get("/api/members")).json()).data as { user_id: string; profile: { email: string } | { email: string }[] }[];
  const vera = members.find((m) => [m.profile].flat()[0]?.email === "viewer@schematichub.test")!;
  const groups = (await (await page.request.get("/api/groups")).json()).data as { id: string; name: string }[];
  const crew = groups.find((g) => g.name === "Hydraulics Crew")!;

  // give access to a person and to a group, then take both away
  for (const body of [{ user_id: vera.user_id, level: "comment" }, { group_id: crew.id, level: "edit" }]) {
    const made = await page.request.post(`/api/schematics/${target.id}/grants`, { data: body });
    expect(made.status()).toBe(201);
    const grantId = (await made.json()).data.id as string;
    expect((await page.request.delete(`/api/schematics/${target.id}/grants?grant_id=${grantId}`)).status()).toBe(204);
  }

  await page.goto("/audit?entity=grant");
  const table = page.getByTestId("audit-table");
  // the person
  const person = table.getByRole("row").filter({ hasText: "Took away Comment access from Vera Viewer (viewer@schematichub.test)" }).first();
  await expect(person).toContainText("on “Compressor control wiring (private)”");
  await expect(person).toContainText("Ada Admin (admin@schematichub.test)"); // who did it
  // the group
  const group = table.getByRole("row").filter({ hasText: "Took away Edit access from Hydraulics Crew (group)" }).first();
  await expect(group).toContainText("on “Compressor control wiring (private)”");
  // and the grants are described when given, too
  await expect(table.getByText("Gave Vera Viewer (viewer@schematichub.test) Comment access").first()).toBeVisible();
  // the entry leads to the drawing it was about
  await expect(person.getByRole("link", { name: /Took away Comment access/ })).toHaveAttribute("href", `/schematics/${target.id}`);

  // no entry on the page still uses the old uninformative wording, including entries recorded before names were captured
  await expect(page.getByText("Deleted access grant")).toHaveCount(0);
  await expect(page.getByText("Created access grant")).toHaveCount(0);

  // searchable by the person's or group's name
  await page.goto("/audit?entity=grant&q=Hydraulics");
  await expect(page.getByTestId("audit-table")).toContainText("Hydraulics Crew (group)");
  await expect(page.getByTestId("audit-table")).not.toContainText("Vera Viewer");
  await page.screenshot({ path: "test-results/flow-audit-access.png" });

  // CSV says the same thing
  const csv = await (await page.request.get("/api/audit/export?entity=grant&q=Vera")).text();
  expect(csv).toContain("Took away Comment access from Vera Viewer (viewer@schematichub.test)");
});

test("audit log is admin-only: managers, technicians and viewers cannot see or export it", async ({ browser }) => {
  for (const email of ["manager@schematichub.test", "tech@schematichub.test", "viewer@schematichub.test"]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signIn(page, email);
    const res = await page.goto("/audit");
    expect(res?.status(), email).toBe(404);
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Audit log" })).toHaveCount(0);
    const exp = await page.request.get("/api/audit/export");
    expect(exp.status(), email).toBe(403);
    await ctx.close();
  }

  // positive control: the admin has the sidebar entry and the page
  const ctx = await browser.newContext();
  const admin = await ctx.newPage();
  await signIn(admin, "admin@schematichub.test");
  await expect(admin.getByRole("link", { name: "Audit log" })).toBeVisible();
  await admin.getByRole("link", { name: "Audit log" }).click();
  await expect(admin.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await expect(admin.getByText(/cannot be edited or deleted from the app/)).toBeVisible();
  // there is no way to change an entry through the app
  for (const method of ["patch", "put", "delete"] as const) {
    expect((await admin.request[method]("/api/audit/export", { data: {} })).status()).toBe(405);
  }
  await ctx.close();
});
