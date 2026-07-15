import { test, expect, request as pwRequest, type Page } from "@playwright/test";

/**
 * V1.43 — SCALABILITY proof at 1,000 / 5,000 / 10,000 items. The inbox is keyset-paginated and
 * fully server-filtered/searched, so the browser only ever holds ONE page (≤ pageSize) regardless
 * of dataset size. Rows are isolated with a server search (`q=Scale item`) whose ILIKE matches only
 * the bulk fixture (never the small fixed fixture), and each row's text carries its ordinal — which
 * increases with createdAt — so descending (newest-first) order is checkable directly in the DOM:
 * contiguous, strictly descending, disjoint pages ⇒ deterministic order, no skips, no duplicates.
 *
 * Exhaustive full-coverage keyset determinism is proven separately over every row in the repo
 * integration test (packages/db/scripts/inbox-query.test.ts); here we prove the UI wiring holds at
 * scale without walking hundreds of pages.
 */
const PAGE_SIZE = 25;
const SIZES = [1000, 5000, 10000];
const isDesktop = (n: string) => n === "auth-desktop";
const SEARCH = encodeURIComponent("Scale item");
const BASE_URL = `http://localhost:${process.env.E2E_PORT ?? 3220}`;
const STORAGE = "e2e/.auth/state.json"; // the bootstrapped owner session (the seam route requires auth)

type SeedResult = { seeded: number; total: number; unread: number; needle: number };

/**
 * V1.51C — bulk seeding moved OUT of the timed test into `beforeAll`, so the ~thousands-of-rows
 * insert cost is no longer charged against the per-test assertion timeout (the former cause of the
 * 240s timeout at N=10000). The `beforeAll` has its own generous budget and runs only for the desktop
 * project (the only one that executes the scale test), so the fixture is seeded exactly once per size.
 * Seeding uses Node `fetch` against the same E2E seam route (no `page` fixture needed in beforeAll).
 */
async function seedBulk(count: number): Promise<SeedResult> {
  // Authenticated request context (owner storageState) — the E2E seed seam requires a session.
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL, storageState: STORAGE });
  try {
    const res = await ctx.post(`/api/e2e/seed-inbox-bulk?count=${count}`, { timeout: 150_000 });
    if (!res.ok()) throw new Error(`bulk seed HTTP ${res.status()}`);
    return (await res.json()) as SeedResult;
  } finally {
    await ctx.dispose();
  }
}
const cardCount = (page: Page) => page.locator("[data-inbox-item]").count();
const indices = (page: Page) => page.locator("[data-inbox-item]").evaluateAll((els) =>
  els.map((e) => { const m = /Scale item (\d+)/.exec(e.textContent || ""); return m ? Number(m[1]) : -1; }));
const itemIds = (page: Page) => page.locator("[data-inbox-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-inbox-item")));
const heap = (page: Page) => page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);
const strictlyDescending = (xs: number[]) => xs.every((v, i) => i === 0 || xs[i - 1]! > v);

async function clickPager(page: Page, testid: "page-next" | "page-prev") {
  await page.getByTestId(testid).click();
  await page.waitForLoadState("load");
  await expect(page.locator("[data-inbox-item]").first()).toBeVisible();
}

for (const N of SIZES) {
  test.describe(`inbox scalability @ ${N}`, () => {
    let seed: SeedResult;

    // Seed ONCE (desktop-only) before the timed test, with its own budget — not charged to the test.
    // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring form here.
    test.beforeAll(async ({}, workerInfo) => {
      if (!isDesktop(workerInfo.project.name)) return;
      test.setTimeout(180_000); // hook budget for bulk seeding, separate from the per-test timeout
      seed = await seedBulk(N);
    });

    test(`keyset pagination, search, filters and memory hold at ${N} items`, async ({ page }, info) => {
      test.skip(!isDesktop(info.project.name), "scale suite runs once, on desktop");
      test.setTimeout(120_000); // assertions only — seeding happened in beforeAll

      // Suppress the cookie-notice banner (fixed at the bottom, it otherwise intercepts the pager
      // clicks). It is a localStorage-remembered acknowledgement — pre-set the key on every document.
      await page.addInitScript(() => window.localStorage.setItem("tamanor_cookie_notice", "1"));

      expect(seed.seeded).toBe(N);

      // Isolate the bulk fixture via server-side search; newest-first ⇒ ordinals descending.
      const url = `/dashboard/comments?q=${SEARCH}`;
      await page.goto(url);
      await expect(page.locator("[data-inbox-item]").first()).toBeVisible();

      // (1) Browser holds ONLY the active page — never thousands of rows.
      expect(await cardCount(page)).toBeLessThanOrEqual(PAGE_SIZE);
      // (2) Server counts are correct at scale (pagination-independent).
      await expect(page.getByTestId("metric-total")).toHaveText(String(seed.total));

      // (3) Deterministic order + no skip + no dup across a sampled window of pages.
      const p1 = await indices(page);
      const p1ids = await itemIds(page);
      expect(p1.length).toBe(PAGE_SIZE);
      expect(strictlyDescending(p1), `page1 not strictly descending: ${p1.join(",")}`).toBeTruthy();

      await clickPager(page, "page-next");
      expect(await cardCount(page)).toBeLessThanOrEqual(PAGE_SIZE);
      const p2 = await indices(page);
      const p2ids = await itemIds(page);
      expect(strictlyDescending(p2)).toBeTruthy();
      // Contiguous boundary: page2's newest ordinal is exactly one below page1's oldest (no gap/overlap).
      expect(Math.max(...p2)).toBe(Math.min(...p1) - 1);

      await clickPager(page, "page-next");
      const p3 = await indices(page);
      const p3ids = await itemIds(page);
      expect(strictlyDescending(p3)).toBeTruthy();
      expect(Math.max(...p3)).toBe(Math.min(...p2) - 1);

      // No duplicate row id across the three sampled pages.
      const all = [...p1ids, ...p2ids, ...p3ids];
      expect(new Set(all).size).toBe(all.length);

      // (4) Previous navigation is deterministic — page3 → prev reconstructs page2 exactly.
      await clickPager(page, "page-prev");
      expect(await itemIds(page)).toEqual(p2ids);

      // (5) Search persists across a full reload (URL state), same first page.
      await page.goto(url);
      await expect(page.locator("[data-inbox-item]").first()).toBeVisible();
      await expect(page).toHaveURL(/q=Scale/);
      expect(await itemIds(page)).toEqual(p1ids);

      // (6) A filter persists across reload and constrains results server-side (unread ⊂ all).
      await page.goto(`/dashboard/comments?q=${SEARCH}&view=unread`);
      await expect(page.locator("[data-inbox-item]").first()).toBeVisible();
      const unreadFirst = await itemIds(page);
      expect(await cardCount(page)).toBeLessThanOrEqual(PAGE_SIZE);
      await expect(page.locator('[data-inbox-item][data-read="true"]')).toHaveCount(0); // only unread shown
      await page.reload();
      await expect(page).toHaveURL(/view=unread/);
      expect(await itemIds(page)).toEqual(unreadFirst);

      // (7) Memory stays flat while paging (only one page in the DOM at a time).
      await page.goto(url);
      await expect(page.locator("[data-inbox-item]").first()).toBeVisible();
      const h0 = await heap(page);
      for (let i = 0; i < 5; i++) { await clickPager(page, "page-next"); expect(await cardCount(page)).toBeLessThanOrEqual(PAGE_SIZE); }
      const h1 = await heap(page);
      const domNodes = await page.evaluate(() => document.getElementsByTagName("*").length);
      expect(domNodes, `DOM nodes grew unexpectedly: ${domNodes}`).toBeLessThan(8000);
      if (h0 > 0 && h1 > 0) {
        expect(h1, `heap grew from ${h0} to ${h1} while paging (should stay flat)`).toBeLessThan(h0 * 2.5 + 20_000_000);
      }
      console.log(`  scale@${N}: total=${seed.total} unread=${seed.unread} needle=${seed.needle} heap ${Math.round(h0 / 1e6)}→${Math.round(h1 / 1e6)}MB dom=${domNodes}`);
    });
  });
}
