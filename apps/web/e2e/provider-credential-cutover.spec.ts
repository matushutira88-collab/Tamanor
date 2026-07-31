import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * TEMPORARY owner-only provider-credential cutover route — authenticated platform-owner render smoke. Promotes the
 * shared fixture to platformRole=owner via the fail-closed E2E seam, opens /admin/provider-credential-cutover, and
 * proves the page renders the SAFE runtime-readiness + counts-only inventory (in the E2E runtime it is correctly
 * NOT ready — not Vercel production — so apply is disabled). Restores platformRole=none afterwards.
 */
async function setFixtureRole(baseURL: string, role: "owner" | "none") {
  const ctx = await pwRequest.newContext({ baseURL });
  const res = await ctx.post("/api/e2e/seed-platform-role", { data: { role } });
  await ctx.dispose();
  return res;
}

test.describe("provider credential cutover (owner-only)", () => {
  test.beforeAll(async ({ baseURL }) => {
    expect((await setFixtureRole(baseURL!, "owner")).status(), "E2E platform-role seam must be enabled").toBe(200);
  });
  test.afterAll(async ({ baseURL }) => { await setFixtureRole(baseURL!, "none"); });

  test("owner opens the cutover console; readiness + inventory render, no error boundary", async ({ page }) => {
    const resp = await page.goto("/admin/provider-credential-cutover", { waitUntil: "domcontentloaded" });
    expect(resp?.status() ?? 0, "not a server error").toBeLessThan(500);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText("This page hit a snag")).toHaveCount(0);
    // h1 landmark + the readiness/inventory surfaces render.
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.getByText(/runtime (ready|not ready)/i).first()).toBeVisible();
    await expect(page.getByText(/total Meta accounts/i).first()).toBeVisible();
    // A dry-run button exists; no token/key/ciphertext leaks into the HTML.
    await expect(page.getByRole("button", { name: /dry-run inventory/i })).toBeVisible();
    const html = await page.content();
    expect(html).not.toMatch(/aesgcm:v1:|wrappedDataKey|BEGIN [A-Z ]*KEY/);
  });

  test("non-owner cannot see the cutover console (non-revealing denial)", async ({ page, baseURL }) => {
    await setFixtureRole(baseURL!, "none");
    const resp = await page.goto("/admin/provider-credential-cutover", { waitUntil: "domcontentloaded" });
    expect(resp?.status() ?? 0).toBeLessThan(500);
    // Owner-only: a non-owner sees the safe denial, never the inventory/actions.
    await expect(page.getByRole("button", { name: /apply cutover/i })).toHaveCount(0);
    await expect(page.getByText(/total Meta accounts/i)).toHaveCount(0);
    await setFixtureRole(baseURL!, "owner"); // restore for afterAll symmetry
  });
});
