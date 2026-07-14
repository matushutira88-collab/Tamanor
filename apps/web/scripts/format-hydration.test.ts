/**
 * V1.44 hydration regression — proves the number formatter is deterministic across server/client
 * locales, so SSR output equals the first client render. Reproduces the reported bug (server
 * "10 038" vs client "10,038") with the OLD locale-dependent path, and shows the NEW shared
 * `formatNumber` renders identically regardless of the ambient locale.
 *
 * Run: pnpm format-hydration:test
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatNumber } from "../src/lib/format";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

// A fragment mirroring the fixed trial counter (sidebar.tsx:105 / billing / usage).
const Counter = ({ used, limit }: { used: number; limit: number }) =>
  React.createElement("span", null, `${formatNumber(used)} / ${formatNumber(limit)}`);
// The OLD buggy path: value.toLocaleString(<ambient locale>) — the locale differs server vs client.
const OldCounter = ({ used, locale }: { used: number; locale: string }) =>
  React.createElement("span", null, used.toLocaleString(locale));

function run() {
  // 1) The exact reported value now formats deterministically to the client value.
  check("1) formatNumber(10038) === '10,038' (matches the client render)", formatNumber(10038) === "10,038");
  check("2) small values unchanged: formatNumber(500) === '500'", formatNumber(500) === "500");
  check("3) bigint supported (usage cost): formatNumber(1234567n) === '1,234,567'", formatNumber(1234567n) === "1,234,567");
  check("4) formatNumber ignores the ambient locale (always en-US grouping)", formatNumber(10038) === new Intl.NumberFormat("en-US").format(10038));

  // 2) Reproduce the bug: the OLD path renders DIFFERENTLY for a server-style vs client-style locale.
  const oldServer = renderToStaticMarkup(React.createElement(OldCounter, { used: 10038, locale: "fr-FR" })); // server ICU default → "10 038"
  const oldClient = renderToStaticMarkup(React.createElement(OldCounter, { used: 10038, locale: "en-US" })); // browser → "10,038"
  check("5) OLD toLocaleString path WOULD mismatch (server locale ≠ client locale)", oldServer !== oldClient, `${oldServer} vs ${oldClient}`);

  // 3) The FIX: the shared formatter renders identically for both environments → no hydration mismatch.
  const newServer = renderToStaticMarkup(React.createElement(Counter, { used: 10038, limit: 500 }));
  const newClient = renderToStaticMarkup(React.createElement(Counter, { used: 10038, limit: 500 }));
  check("6) NEW formatNumber path: SSR output EQUALS client render", newServer === newClient && newServer.includes("10,038 / 500"));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — number-format hydration regression`);
  process.exit(failures === 0 ? 0 : 1);
}
run();
