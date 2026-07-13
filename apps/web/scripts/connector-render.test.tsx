/**
 * V1.39B — RENDERED-component truth tests. Renders the real <ConnectorStatusBadge/>
 * (the component wired into the Accounts list + detail) to static HTML and asserts the
 * truthful output — not just the pure mapper. Instagram/GBP can never render live, a
 * sync-disabled account never renders healthy, unsupported gets no reconnect, and the
 * same account renders identically in list vs detail mode.
 *
 * Run: pnpm connector-render:test
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectorStatusBadge } from "../src/components/dashboard/connector-status-badge";
import type { ConnectorAccountLike } from "../src/lib/connector-display";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const render = (account: ConnectorAccountLike, liveSyncEnabled?: boolean, withDescription = false) =>
  renderToStaticMarkup(<ConnectorStatusBadge account={account} liveSyncEnabled={liveSyncEnabled} withDescription={withDescription} />);

const state = (html: string) => html.match(/data-connector-state="([^"]+)"/)?.[1];
const live = (html: string) => html.match(/data-whether-live="([^"]+)"/)?.[1];

function run() {
  // Instagram connected → verification pending, NEVER live/healthy.
  const ig = render({ platformKey: "instagram", status: "active", health: "healthy", connectionStatus: "connected" }, true, true);
  check("1) Instagram connected renders verification_pending, not live", state(ig) === "provider_verification_pending" && live(ig) === "false" && /not live/i.test(ig) && !/>Healthy</.test(ig));

  // Google Business connected → verification pending, not live.
  const gbp = render({ platformKey: "google_business", status: "active", health: "healthy", connectionStatus: "connected" }, false, true);
  check("2) Google Business connected renders verification_pending, not live", state(gbp) === "provider_verification_pending" && live(gbp) === "false");

  // Facebook connected + healthy + live sync → the ONLY live state.
  const fb = render({ platformKey: "facebook", status: "active", health: "healthy", connectionStatus: "connected" }, true);
  check("3) Facebook healthy renders Connected + whether-live=true", state(fb) === "healthy" && live(fb) === "true" && /Connected/.test(fb));

  // Facebook sync disabled (placeholder / live sync off) → NOT healthy/live.
  const fbOff = render({ platformKey: "facebook", status: "active", health: "healthy", mode: "placeholder" }, true);
  const fbOff2 = render({ platformKey: "facebook", status: "active", health: "healthy" }, false);
  check("4) Facebook sync-disabled renders sync_disabled, never healthy/live", state(fbOff) === "sync_disabled" && live(fbOff) === "false" && state(fbOff2) === "sync_disabled" && !/>Connected</.test(fbOff.replace("Connected · sync off", "")));

  // Token expired → Reconnect.
  const exp = render({ platformKey: "facebook", status: "active", tokenHealth: "expired" }, true);
  check("5) token expired renders Reconnect (danger)", state(exp) === "token_expired" && /Reconnect/.test(exp));

  // Permission missing → remediation.
  const perm = render({ platformKey: "facebook", status: "active", connectionStatus: "missing_permission" }, true, true);
  check("6) permission missing renders Permission needed + reconnect remediation", state(perm) === "permission_missing" && /Permission needed/.test(perm) && /grant/i.test(perm));

  // Rate limited → not a reconnect prompt.
  const rl = render({ platformKey: "facebook", status: "active", contentPermissionState: "rate_limited" }, true);
  check("7) rate limited renders Rate limited, not Reconnect", state(rl) === "rate_limited" && /Rate limited/.test(rl) && !/Reconnect/.test(rl));

  // Unsupported platform → no connect/reconnect.
  const yt = render({ platformKey: "youtube", status: "active", health: "healthy" }, true);
  check("8) YouTube renders Not supported, no reconnect", state(yt) === "unsupported" && /Not supported/.test(yt) && !/Reconnect/.test(yt));

  // List vs detail consistency — same account, same truth.
  const acct: ConnectorAccountLike = { platformKey: "instagram", status: "active", health: "healthy", connectionStatus: "connected" };
  check("9) list vs detail render the SAME connector state", state(render(acct, true, false)) === state(render(acct, true, true)));

  // No secret/raw content leaks into any rendered badge.
  const all = [ig, gbp, fb, fbOff, exp, perm, rl, yt].join(" ");
  check("10) no secret/raw provider content in rendered badges", !/postgres|prisma|bearer |token=|password|select \*/i.test(all));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — connector rendered-component truth (V1.39B)`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
