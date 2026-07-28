import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * Platform Administration owner-entry — RENDER/UI proof (desktop). Promotes the shared fixture to platformRole
 * owner via the fail-closed E2E seam, opens /dashboard, and proves the card is genuinely VISIBLE (not just in
 * the DOM): non-zero bounding box, within the initial viewport (above the fold), and a working "/admin" CTA.
 *
 * The fixture is a FAMILY workspace, so /dashboard redirects to /family(/onboarding) — which is exactly why a
 * card living only on the business dashboard never rendered for such an owner. The owner entry is now mounted on
 * every workspace kind's landing route, so it appears wherever the redirect lands. Restores platformRole=none in
 * teardown. Owner-only server condition + independent /admin guard unchanged; this only toggles the fixture row.
 * workers=1 + fullyParallel:false make the promote/restore race-free.
 */
async function setFixtureRole(baseURL: string, role: "owner" | "none") {
  const ctx = await pwRequest.newContext({ baseURL });
  const res = await ctx.post("/api/e2e/seed-platform-role", { data: { role } });
  await ctx.dispose();
  return res;
}

test.describe("platform admin owner entry (desktop)", () => {
  test.beforeAll(async ({ baseURL }) => {
    const res = await setFixtureRole(baseURL!, "owner");
    expect(res.status(), "seam must be enabled + fixture promotable in E2E").toBe(200);
  });
  test.afterAll(async ({ baseURL }) => {
    await setFixtureRole(baseURL!, "none"); // restore baseline for the other auth specs
  });

  test("owner sees the Platform Administration card (visible, sized, /admin CTA) on their landing route", async ({ page }, testInfo) => {
    await page.goto("/dashboard"); // FAMILY fixture → redirects to /family(/onboarding)
    await expect(page).not.toHaveURL(/\/login/);

    // Dismiss the cookie consent so nothing overlays/inert-blocks the card.
    const reject = page.getByRole("button", { name: /reject non-essential|odmietnuť|ablehnen/i });
    if (await reject.count()) await reject.first().click().catch(() => {});

    const card = page.getByTestId("platform-admin-entry");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-platform-admin-visible", "true");

    // Genuinely rendered with size (not display:none / zero-height / clipped).
    const box = await card.boundingBox();
    expect(box, "card has a bounding box").not.toBeNull();
    expect(box!.width, "card width > 0").toBeGreaterThan(0);
    expect(box!.height, "card height > 0").toBeGreaterThan(0);

    // Above the fold: the card top is within the initial viewport.
    const viewport = page.viewportSize();
    expect(box!.y, "card top within the initial viewport (above the fold)").toBeLessThan(viewport!.height);

    // CTA links to /admin.
    const cta = page.getByTestId("platform-admin-cta");
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "/admin");

    // Screenshot proof of placement (attached to the report + saved as an artifact).
    const shot = await page.screenshot({ path: testInfo.outputPath("platform-admin-entry.png"), fullPage: false });
    await testInfo.attach("platform-admin-entry", { body: shot, contentType: "image/png" });
  });
});
