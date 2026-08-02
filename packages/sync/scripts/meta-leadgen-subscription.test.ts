/**
 * BUSINESS-LEADGEN-SUBSCRIPTION-V1 — targeted tests for the Facebook Page ↔ app `leadgen` webhook subscription.
 *
 * NO network and NO database: the Graph seam is the injectable {@link MockLeadgenSubscriptionTransport} and the
 * tenant DB/vault side effects are injected ports. Nothing here can touch a real Meta API or production data.
 *
 * Covers: subscription READ (app absent / present without leadgen / present with leadgen); subscription WRITE
 * (existing fields preserved, `leadgen` added exactly once, verified by a post-write read, no secret in any
 * result/log); connect/reconnect (attempted only after the vault credential is verified, a failure leaves the
 * connection untouched, an Instagram account is NEVER targeted); and the repair action (authorized succeeds,
 * cross-tenant/unauthorized fails, repeated repair is idempotent).
 */
import { can, Permission, Role, setOpsSink, resetOpsSink } from "@guardora/core";
import {
  getPageAppSubscriptions, ensurePageLeadgenSubscription, mergeSubscribedFields,
  hasLeadgenSubscription, MockLeadgenSubscriptionTransport, LEADGEN_FIELD,
} from "@guardora/connectors";
import {
  ensureAccountLeadgenSubscription, ensureLeadgenSubscriptionOnConnect,
  LEADGEN_SUBSCRIPTION_VERIFIED, LEADGEN_SUBSCRIPTION_NOT_SUBSCRIBED, LEADGEN_SUBSCRIPTION_UNAVAILABLE,
  type LeadgenSubscriptionAccount, type LeadgenSubscriptionPorts, type LeadgenSubscriptionStatus,
} from "../src/meta-leadgen-subscription";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const APP_ID = "app-123";
const OTHER_APP = "app-999";
const PAGE_ID = "PAGE-abc";
const IG_ID = "IG-xyz";
const TOKEN = "SECRET_PAGE_TOKEN_do_not_leak";
const APP_SECRET = "SECRET_APP_SECRET_do_not_leak";

// ---- ops sink capture (proves nothing secret is ever emitted) --------------------------------------------
const emitted: string[] = [];
setOpsSink({ emit: (event, meta) => { emitted.push(`${event} ${JSON.stringify(meta)}`); } });

// ---- in-memory tenant/account ports (stand in for RLS DB + vault; NO database involved) ------------------
interface Store { accounts: LeadgenSubscriptionAccount[]; persisted: Array<{ id: string; status: LeadgenSubscriptionStatus }>; tokens: Record<string, string | null> }

function makePorts(store: Store): LeadgenSubscriptionPorts & { loads: number } {
  const ports = {
    loads: 0,
    async loadAccount(tenantId: string, accountId: string) {
      ports.loads++;
      // Models RLS: an account belonging to a DIFFERENT tenant simply does not resolve.
      return store.accounts.find((a) => a.id === accountId && a.tenantId === tenantId) ?? null;
    },
    async resolveToken(account: LeadgenSubscriptionAccount) {
      return store.tokens[account.id] ?? null;
    },
    async persist(account: LeadgenSubscriptionAccount, status: LeadgenSubscriptionStatus) {
      store.persisted.push({ id: account.id, status });
    },
  };
  return ports;
}

const account = (over: Partial<LeadgenSubscriptionAccount> = {}): LeadgenSubscriptionAccount => ({
  id: "acct-page", tenantId: "tenant-A", brandId: "brand-1", platform: "facebook_page", status: "active",
  externalId: PAGE_ID, pageId: PAGE_ID, longLivedToken: null, accessToken: null, ...over,
});

function freshStore(over: Partial<LeadgenSubscriptionAccount> = {}): Store {
  const acct = account(over);
  return { accounts: [acct], persisted: [], tokens: { [acct.id]: TOKEN } };
}

async function main() {
  process.env.META_APP_SECRET = APP_SECRET;

  // =========================================================================================================
  // 1) SUBSCRIPTION READ
  // =========================================================================================================
  console.log("\n1) subscription read");
  {
    // 1a) this app absent from the Page entirely — the exact production symptom
    //     ("Selected page has no app associated with it").
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID, apps: [{ appId: OTHER_APP, subscribedFields: ["feed", LEADGEN_FIELD] }] });
    const r = await getPageAppSubscriptions({ pageId: PAGE_ID, pageAccessToken: TOKEN, appId: APP_ID }, { transport: t });
    check("1a) app absent → appSubscribed=false, leadgenSubscribed=false",
      r.ok && r.appSubscribed === false && r.leadgenSubscribed === false && r.subscribedFields.length === 0);
    check("1a) another app's leadgen subscription is NOT mistaken for ours", r.ok && r.leadgenSubscribed === false);
  }
  {
    // 1b) app present but WITHOUT leadgen — the actual state of the reported Page.
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID, apps: [{ appId: APP_ID, subscribedFields: ["feed", "mention"] }] });
    const r = await getPageAppSubscriptions({ pageId: PAGE_ID, pageAccessToken: TOKEN, appId: APP_ID }, { transport: t });
    check("1b) app present without leadgen → appSubscribed=true, leadgenSubscribed=false",
      r.ok && r.appSubscribed === true && r.leadgenSubscribed === false && r.subscribedFields.join(",") === "feed,mention");
  }
  {
    // 1c) app present WITH leadgen.
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID, apps: [{ appId: APP_ID, subscribedFields: ["feed", LEADGEN_FIELD] }] });
    const r = await getPageAppSubscriptions({ pageId: PAGE_ID, pageAccessToken: TOKEN, appId: APP_ID }, { transport: t });
    check("1c) app present with leadgen → leadgenSubscribed=true", r.ok && r.appSubscribed === true && r.leadgenSubscribed === true);
    check("1c) read performs NO write", t.writes.length === 0);
  }
  {
    // 1d) a provider failure is a classified, secret-free code — never a raw body.
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID, failRead: "token_expired" });
    const r = await getPageAppSubscriptions({ pageId: PAGE_ID, pageAccessToken: TOKEN, appId: APP_ID }, { transport: t });
    check("1d) read failure → ok:false with a classified code", !r.ok && r.errorCode === "token_expired");
  }

  // =========================================================================================================
  // 2) SUBSCRIPTION WRITE
  // =========================================================================================================
  console.log("\n2) subscription write");
  check("2) merge preserves existing fields and appends leadgen once",
    mergeSubscribedFields(["feed", "mention"]).join(",") === `feed,mention,${LEADGEN_FIELD}`);
  check("2) merge is idempotent when leadgen is already present",
    mergeSubscribedFields(["feed", LEADGEN_FIELD]).join(",") === `feed,${LEADGEN_FIELD}`);
  check("2) merge collapses duplicates without dropping anything",
    mergeSubscribedFields(["feed", "feed", "mention"]).join(",") === `feed,mention,${LEADGEN_FIELD}`);
  {
    // 2a) existing fields preserved + leadgen added exactly once + verified by a post-write READ.
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID, apps: [{ appId: APP_ID, subscribedFields: ["feed", "mention"] }] });
    const r = await ensurePageLeadgenSubscription({ pageId: PAGE_ID, pageAccessToken: TOKEN, appId: APP_ID }, { transport: t });
    check("2a) verified after POST", r.verified === true && r.wrote === true && r.alreadySubscribed === false);
    check("2a) POSTed the MERGED set — existing fields preserved",
      t.writes.length === 1 && t.writes[0]!.subscribedFields.includes("feed") && t.writes[0]!.subscribedFields.includes("mention"), JSON.stringify(t.writes));
    check("2a) leadgen added exactly ONCE",
      t.writes[0]!.subscribedFields.filter((f) => f === LEADGEN_FIELD).length === 1);
    check("2a) verification is a SECOND read (read → write → read)", t.reads.length === 2 && t.writes.length === 1);
    check("2a) targeted the Page id", t.writes[0]!.pageId === PAGE_ID);
  }
  {
    // 2b) already subscribed → fully idempotent: no write at all.
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID, apps: [{ appId: APP_ID, subscribedFields: ["feed", LEADGEN_FIELD] }] });
    const r = await ensurePageLeadgenSubscription({ pageId: PAGE_ID, pageAccessToken: TOKEN, appId: APP_ID }, { transport: t });
    check("2b) already subscribed → verified with NO write", r.verified === true && r.alreadySubscribed === true && r.wrote === false && t.writes.length === 0);
  }
  {
    // 2c) a 200 POST is NEVER trusted — only the verification read may set verified.
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID, apps: [{ appId: APP_ID, subscribedFields: ["feed"] }], writeIsNoop: true });
    const r = await ensurePageLeadgenSubscription({ pageId: PAGE_ID, pageAccessToken: TOKEN, appId: APP_ID }, { transport: t });
    check("2c) POST 200 that did not apply → verified=false (success never assumed)", r.verified === false && r.wrote === true);
  }
  {
    // 2d) app absent entirely → subscribing creates it with leadgen, then verifies.
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID, apps: [{ appId: OTHER_APP, subscribedFields: ["feed"] }] });
    const r = await ensurePageLeadgenSubscription({ pageId: PAGE_ID, pageAccessToken: TOKEN, appId: APP_ID }, { transport: t });
    check("2d) app absent → subscribed with leadgen and verified", r.verified === true && t.writes[0]!.subscribedFields.join(",") === LEADGEN_FIELD);
  }
  {
    // 2e) a write failure never reports success.
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID, apps: [{ appId: APP_ID, subscribedFields: ["feed"] }], failWrite: "permission" });
    const r = await ensurePageLeadgenSubscription({ pageId: PAGE_ID, pageAccessToken: TOKEN, appId: APP_ID }, { transport: t });
    check("2e) write failure → verified=false with a classified code", r.verified === false && r.errorCode === "permission");
    check("2e) failure result carries NO token / app secret / proof",
      !JSON.stringify(r).includes(TOKEN) && !JSON.stringify(r).includes(APP_SECRET) && !JSON.stringify(r).includes("appsecret"));
  }

  // =========================================================================================================
  // 3) CONNECT / RECONNECT
  // =========================================================================================================
  console.log("\n3) connect / reconnect");
  {
    // 3a) attempted after the vault credential resolves; the PAGE account is what gets subscribed.
    const store = freshStore();
    const ports = makePorts(store);
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID, apps: [{ appId: APP_ID, subscribedFields: ["feed"] }] });
    const r = await ensureLeadgenSubscriptionOnConnect("tenant-A", "acct-page", ["pages_show_list", "leads_retrieval"], { transport: t, ports, appId: APP_ID });
    check("3a) leads_retrieval granted → subscription attempted and verified", r.attempted === true && r.verified === true);
    check("3a) status persisted as verified", store.persisted.at(-1)?.status === LEADGEN_SUBSCRIPTION_VERIFIED);
    check("3a) subscribed the PAGE id", t.writes.length === 1 && t.writes[0]!.pageId === PAGE_ID);
  }
  {
    // 3b) without leads_retrieval nothing is attempted at all (no provider call).
    const store = freshStore();
    const ports = makePorts(store);
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID });
    const r = await ensureLeadgenSubscriptionOnConnect("tenant-A", "acct-page", ["pages_show_list"], { transport: t, ports, appId: APP_ID });
    check("3b) permission not granted → not attempted, no provider call", r.attempted === false && t.reads.length === 0 && t.writes.length === 0);
  }
  {
    // 3c) no usable credential → attempted but never verified; NOTHING about the connection is mutated.
    const store = freshStore();
    store.tokens["acct-page"] = null;
    const ports = makePorts(store);
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID });
    const r = await ensureLeadgenSubscriptionOnConnect("tenant-A", "acct-page", ["leads_retrieval"], { transport: t, ports, appId: APP_ID });
    check("3c) no credential → not verified and no provider call", r.attempted === true && r.verified === false && t.reads.length === 0);
    check("3c) connection/monitoring state untouched (no status persisted)", store.persisted.length === 0);
  }
  {
    // 3d) a provider failure does NOT break the connection — it only records the truthful status.
    const store = freshStore();
    const ports = makePorts(store);
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID, failRead: "network" });
    const r = await ensureLeadgenSubscriptionOnConnect("tenant-A", "acct-page", ["leads_retrieval"], { transport: t, ports, appId: APP_ID });
    check("3d) provider failure → not verified, connection untouched", r.attempted === true && r.verified === false);
    check("3d) unknown state recorded as `unavailable` (never assumed OK)", store.persisted.at(-1)?.status === LEADGEN_SUBSCRIPTION_UNAVAILABLE);
    check("3d) the account row itself is unchanged apart from the subscription status",
      store.accounts[0]!.status === "active" && store.accounts[0]!.platform === "facebook_page");
  }
  {
    // 3e) an INSTAGRAM account is NEVER subscribed — the hard guard.
    const store: Store = {
      accounts: [account({ id: "acct-ig", platform: "instagram_business", externalId: IG_ID, pageId: null })],
      persisted: [], tokens: { "acct-ig": TOKEN },
    };
    const ports = makePorts(store);
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID });
    const r = await ensureAccountLeadgenSubscription("tenant-A", "acct-ig", { transport: t, ports, appId: APP_ID });
    check("3e) instagram account → rejected before any provider call", r.verified === false && r.reason === "not_a_facebook_page");
    check("3e) the Instagram id NEVER reached subscribed_apps",
      t.reads.length === 0 && t.writes.length === 0 && !JSON.stringify(t.writes).includes(IG_ID));
    check("3e) nothing persisted for a non-Page account", store.persisted.length === 0);
  }

  // =========================================================================================================
  // 4) REPAIR ACTION
  // =========================================================================================================
  console.log("\n4) repair action");
  // 4a) authorization is the existing connector-management permission.
  check("4a) manager roles hold ConnectorManage", can(Role.Owner, Permission.ConnectorManage) && can(Role.Admin, Permission.ConnectorManage));
  check("4a) non-manager roles do NOT hold ConnectorManage",
    !can(Role.Analyst, Permission.ConnectorManage) && !can(Role.Viewer, Permission.ConnectorManage));
  {
    // 4b) an authorized manager repairs an existing connected Page in place (no reconnect).
    const store = freshStore({ pageId: PAGE_ID });
    const ports = makePorts(store);
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID, apps: [{ appId: APP_ID, subscribedFields: ["feed"] }] });
    const r = await ensureAccountLeadgenSubscription("tenant-A", "acct-page", { transport: t, ports, appId: APP_ID });
    check("4b) repair succeeds and verifies", r.verified === true && r.status === LEADGEN_SUBSCRIPTION_VERIFIED && r.wrote === true);
    check("4b) existing `feed` subscription preserved by the repair", t.writes[0]!.subscribedFields.includes("feed"));
  }
  {
    // 4c) cross-tenant: the SAME account id requested under another tenant does not resolve (RLS scoping).
    const store = freshStore();
    const ports = makePorts(store);
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID });
    const r = await ensureAccountLeadgenSubscription("tenant-B", "acct-page", { transport: t, ports, appId: APP_ID });
    check("4c) cross-tenant repair → account_not_found, no provider call", r.verified === false && r.reason === "account_not_found" && t.reads.length === 0);
    check("4c) cross-tenant repair persists nothing", store.persisted.length === 0);
  }
  {
    // 4d) an inactive account is never repaired.
    const store = freshStore({ status: "disconnected" });
    const ports = makePorts(store);
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID });
    const r = await ensureAccountLeadgenSubscription("tenant-A", "acct-page", { transport: t, ports, appId: APP_ID });
    check("4d) inactive account → account_inactive, no provider call", r.verified === false && r.reason === "account_inactive" && t.reads.length === 0);
  }
  {
    // 4e) repeated repair is idempotent — the second run performs NO write.
    const store = freshStore();
    const ports = makePorts(store);
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID, apps: [{ appId: APP_ID, subscribedFields: ["feed"] }] });
    const first = await ensureAccountLeadgenSubscription("tenant-A", "acct-page", { transport: t, ports, appId: APP_ID });
    const second = await ensureAccountLeadgenSubscription("tenant-A", "acct-page", { transport: t, ports, appId: APP_ID });
    check("4e) both runs verified", first.verified === true && second.verified === true);
    check("4e) second run wrote nothing (idempotent)", second.wrote === false && second.alreadySubscribed === true && t.writes.length === 1);
    check("4e) field set never accumulated a duplicate leadgen",
      t.writes[0]!.subscribedFields.filter((f) => f === LEADGEN_FIELD).length === 1);
  }
  {
    // 4f) a missing META_APP_ID is reported truthfully instead of guessing.
    const store = freshStore();
    const ports = makePorts(store);
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID });
    const r = await ensureAccountLeadgenSubscription("tenant-A", "acct-page", { transport: t, ports, appId: "" });
    check("4f) no app id configured → app_not_configured, no provider call", r.verified === false && r.reason === "app_not_configured" && t.reads.length === 0);
  }

  // =========================================================================================================
  // 5) NO SECRET LEAKS
  // =========================================================================================================
  console.log("\n5) secret hygiene");
  const opsDump = emitted.join("\n");
  check("5) ops events carry NO token / app secret / proof / page id",
    !opsDump.includes(TOKEN) && !opsDump.includes(APP_SECRET) && !opsDump.includes("appsecret_proof") && !opsDump.includes(PAGE_ID), opsDump);
  check("5) ops events were actually emitted (the assertion above is meaningful)", emitted.length > 0);
  {
    const t = new MockLeadgenSubscriptionTransport({ appId: APP_ID, failWrite: "token_expired", apps: [{ appId: APP_ID, subscribedFields: ["feed"] }] });
    const store = freshStore();
    const ports = makePorts(store);
    const r = await ensureAccountLeadgenSubscription("tenant-A", "acct-page", { transport: t, ports, appId: APP_ID });
    const dump = JSON.stringify(r);
    check("5) failure result carries NO token / secret / proof / tenant / account / page id",
      !dump.includes(TOKEN) && !dump.includes(APP_SECRET) && !dump.includes("tenant-A") && !dump.includes("acct-page") && !dump.includes(PAGE_ID), dump);
    check("5) a non-transient failure is recorded as not_subscribed (truthful, not 'verified')",
      store.persisted.at(-1)?.status === LEADGEN_SUBSCRIPTION_NOT_SUBSCRIBED);
  }
  check("5) hasLeadgenSubscription is app-scoped", !hasLeadgenSubscription([{ appId: OTHER_APP, subscribedFields: [LEADGEN_FIELD] }], APP_ID));

  resetOpsSink();
  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — meta leadgen page subscription: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
