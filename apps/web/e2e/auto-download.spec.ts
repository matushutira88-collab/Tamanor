import { test, expect, type Download } from "@playwright/test";

/**
 * AUTO-DOWNLOAD REGRESSION GATE. The public landing page (and its core assets) must NEVER cause the browser to
 * download a file on load, register a service worker, or serve an attachment/executable for a public asset.
 * This is the runtime counterpart to the static file-response inventory + the source-level audit. Runs
 * unauthenticated (desktop + mobile projects), and can also run against a live deployment via E2E_BASE_URL.
 */

async function assertNoDownloadOnLoad(pageUrl: string, test_: typeof test) {
  test_("no browser download is triggered by loading the page", async ({ page }) => {
    const downloads: Download[] = [];
    page.on("download", (d) => downloads.push(d));
    await page.goto(pageUrl, { waitUntil: "networkidle" });
    // Give any deferred/afterInteractive script a moment to (mis)behave.
    await page.waitForTimeout(1500);
    expect(downloads, downloads.map((d) => d.suggestedFilename()).join(", ")).toHaveLength(0);
  });
}

test.describe("landing page — no auto-download", () => {
  assertNoDownloadOnLoad("/", test);

  test("no service worker is registered", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const swState = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return { supported: false, regs: 0, controller: false };
      const regs = await navigator.serviceWorker.getRegistrations();
      return { supported: true, regs: regs.length, controller: !!navigator.serviceWorker.controller };
    });
    expect(swState.regs).toBe(0);
    expect(swState.controller).toBe(false);
  });

  test("no anchor with a download attribute and no meta-refresh on the landing page", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(await page.locator("a[download]").count()).toBe(0);
    expect(await page.locator('meta[http-equiv="refresh" i]').count()).toBe(0);
    expect(await page.locator("iframe").count()).toBe(0);
  });

  test("core public assets have correct MIME and are never served as attachments", async ({ request }) => {
    const cases: { path: string; type: RegExp }[] = [
      { path: "/", type: /text\/html/ },
      { path: "/manifest.webmanifest", type: /application\/manifest\+json|application\/json/ },
      { path: "/robots.txt", type: /text\/plain/ },
      { path: "/sitemap.xml", type: /(application|text)\/xml/ },
      { path: "/favicon.ico", type: /image\/(x-icon|vnd\.microsoft\.icon)/ },
    ];
    for (const c of cases) {
      const res = await request.get(c.path);
      expect(res.status(), c.path).toBeLessThan(400);
      const ct = res.headers()["content-type"] ?? "";
      const cd = res.headers()["content-disposition"] ?? "";
      expect(ct, `${c.path} content-type=${ct}`).toMatch(c.type);
      expect(cd.toLowerCase(), `${c.path} content-disposition=${cd}`).not.toContain("attachment");
    }
  });

  test("service worker paths are not served (404)", async ({ request }) => {
    for (const p of ["/sw.js", "/service-worker.js"]) {
      const res = await request.get(p);
      expect(res.status(), p).toBe(404);
    }
  });

  test("interacting with the consent banner (if present) does not trigger a download", async ({ page }) => {
    const downloads: Download[] = [];
    page.on("download", (d) => downloads.push(d));
    await page.goto("/", { waitUntil: "networkidle" });
    // Best-effort: click an accept/reject control if a consent banner exists; never fail if it doesn't.
    for (const rx of [/accept/i, /reject/i, /agree/i, /decline/i]) {
      const btn = page.getByRole("button", { name: rx }).first();
      if (await btn.count().catch(() => 0)) { await btn.click({ trial: false }).catch(() => {}); break; }
    }
    await page.waitForTimeout(1000);
    expect(downloads).toHaveLength(0);
  });
});
