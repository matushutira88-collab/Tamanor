import { test, expect } from "@playwright/test";

/**
 * V1.67 — the landing must FIT every phone viewport, not merely hide the overflow.
 *
 * The regression this guards against was invisible to a naive check: the page wrapper carries
 * `overflow: hidden`, so `scrollWidth === innerWidth` already held while content was being CLIPPED off
 * the right edge. These tests therefore assert BOTH: no horizontal scroll AND that the sections named in
 * the bug report actually sit inside the viewport rectangle.
 *
 * Root cause was `grid-template-columns: 1fr` (i.e. `minmax(auto, 1fr)`) on the stacked mobile layout —
 * the `auto` floor let a column keep the min-content width of its widest child (a hard 420px radar).
 */

const VIEWPORTS = [
  { name: "iPhone SE", width: 320, height: 568 },
  { name: "Android S", width: 360, height: 800 },
  { name: "iPhone X", width: 375, height: 812 },
  { name: "iPhone 14", width: 390, height: 844 },
  { name: "iPhone 15 Pro Max", width: 430, height: 932 },
] as const;

const LOCALES = [
  { code: "en", path: "/" },
  { code: "sk", path: "/sk" },
  { code: "de", path: "/de" },
] as const;

/** Every element that pokes outside the viewport, ignoring the intentionally-wide ticker marquee. */
async function overflowingElements(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const out: { cls: string; text: string; width: number; overRight: number; overLeft: number }[] = [];
    const seen = new Set<Element>();
    document.querySelectorAll(".tmr-v2 *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (el.closest(".tmr-anim-tkr")) return; // ticker is a marquee inside its own clipped track
      // The radar's rotating sweep is a CIRCLE (border-radius:50%) painted inside its parent. Rotating a
      // square element inflates its AXIS-ALIGNED bounding box by up to sqrt(2), so getBoundingClientRect
      // reports phantom overflow that depends on the animation angle at measurement time — the painted
      // pixels never leave the circle. Measuring it would make this suite flaky, not stricter.
      if (el.closest(".tmr-anim-spin")) return;
      const overRight = Math.round(r.right - vw);
      const overLeft = Math.round(-r.left);
      if (overRight <= 1 && overLeft <= 1) return;
      // Report only the outermost offender of each chain so the failure names the real culprit.
      let p = el.parentElement;
      while (p) { if (seen.has(p)) return; p = p.parentElement; }
      seen.add(el);
      out.push({
        cls: (el.className?.toString?.() ?? "").slice(0, 60),
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 50),
        width: Math.round(r.width), overRight, overLeft,
      });
    });
    return out;
  });
}

for (const vp of VIEWPORTS) {
  for (const loc of LOCALES) {
    test(`landing has no horizontal overflow at ${vp.width}px (${loc.code})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(loc.path);
      await page.locator(".tmr-v2").first().waitFor();

      // 1) No horizontal scroll.
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth, `${vp.name} ${loc.code}: document scrolls horizontally`).toBe(innerWidth);

      // 2) And nothing is merely clipped: no element sits outside the viewport rectangle.
      const offenders = await overflowingElements(page);
      expect(offenders, `${vp.name} ${loc.code}: elements outside the viewport → ${JSON.stringify(offenders)}`).toEqual([]);
    });
  }
}

test.describe("landing sections named in the V1.67 bug report", () => {
  for (const vp of [VIEWPORTS[0], VIEWPORTS[3]] as const) {
    test(`risk heading, radar, coverage cards and status badges all fit at ${vp.width}px`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      await page.locator(".tmr-v2").first().waitFor();

      const report = await page.evaluate(() => {
        const vw = window.innerWidth;
        const fits = (el: Element | null | undefined) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return r.left >= -1 && r.right <= vw + 1;
        };
        const legend = document.querySelector(".tmr-blip-legend");
        const radar = legend?.previousElementSibling ?? null;
        const cardGrids = [...document.querySelectorAll(".tmr-cards")];
        const cards = cardGrids.flatMap((g) => [...g.children]);
        // Each status badge must stay inside its own card, not just inside the viewport.
        const badgesInside = cards.every((card) => {
          const badge = card.querySelector("span:nth-of-type(2)");
          if (!badge) return true;
          const b = badge.getBoundingClientRect(), c = card.getBoundingClientRect();
          return b.left >= c.left - 1 && b.right <= c.right + 1;
        });
        return {
          headingsFit: [...document.querySelectorAll(".tmr-v2 h2")].every((h) => fits(h)),
          radarFits: fits(radar),
          radarSquare: radar ? Math.abs(radar.getBoundingClientRect().width - radar.getBoundingClientRect().height) <= 2 : null,
          legendShown: legend ? getComputedStyle(legend).display !== "none" : false,
          legendActorCount: legend ? legend.querySelectorAll("li").length : 0,
          cardsFit: cards.every((c) => fits(c)),
          cardGridSingleColumn: cardGrids.every((g) => getComputedStyle(g).gridTemplateColumns.split(" ").length === 1),
          badgesInside,
        };
      });

      expect(report.headingsFit, "a section heading overflows").toBe(true);
      expect(report.radarFits, "the actor-risk radar overflows").toBe(true);
      expect(report.radarSquare, "the radar lost its 1:1 aspect ratio").toBe(true);
      // The in-radar labels are replaced by a legend on phones — the actors must still all be listed.
      expect(report.legendShown, "the mobile radar legend is missing").toBe(true);
      expect(report.legendActorCount, "the legend dropped actors").toBe(4);
      expect(report.cardsFit, "a coverage/pricing card overflows").toBe(true);
      expect(report.cardGridSingleColumn, "card grids should be single-column on phones").toBe(true);
      expect(report.badgesInside, "a status badge escaped its card").toBe(true);
    });
  }
});
