/**
 * BUSINESS-LEADGEN-MULTIPAGE-V1 — targeted tests for PER-PAGE Meta Lead Ads readiness.
 *
 * Before: one "latest" Facebook Page decided the tenant-wide Lead Ads state, so a tenant with several Pages was
 * shown a status that was false for every Page but one. These tests pin the per-Page evaluation, the truthful
 * X-of-Y rollup, order-independence, and that a repair touches EXACTLY the submitted tenant-owned Facebook Page.
 *
 * NO network and NO database: the Graph seam is an in-memory per-Page transport and the tenant DB/vault effects
 * are injected ports.
 */
import {
  evaluateMetaLeadPageReadiness, summarizeMetaLeadReadiness, META_LEAD_STATE_PRECEDENCE,
  type MetaLeadTenantSignals, type MetaLeadPageSignals,
} from "@guardora/core";
import {
  LEADGEN_FIELD,
  type LeadgenSubscriptionTransport, type PageAppSubscription,
  type PageSubscriptionsRead, type PageSubscriptionWrite,
} from "@guardora/connectors";
import {
  ensureAccountLeadgenSubscription, ensureLeadgenSubscriptionOnConnect,
  LEADGEN_SUBSCRIPTION_VERIFIED, LEADGEN_SUBSCRIPTION_NOT_SUBSCRIBED,
  type LeadgenSubscriptionAccount, type LeadgenSubscriptionPorts, type LeadgenSubscriptionStatus,
} from "../src/meta-leadgen-subscription";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const APP_ID = "app-123";
const TOKEN_A = "SECRET_TOKEN_PAGE_A_do_not_leak";
const TOKEN_B = "SECRET_TOKEN_PAGE_B_do_not_leak";
const PAGE_A = "PAGEID_AAA_provider";
const PAGE_B = "PAGEID_BBB_provider";
const IG_ID = "IGID_provider";

const TENANT: MetaLeadTenantSignals = { metaConfigured: true, entitled: true, providerApproved: true };
const CHECKED = new Date("2026-08-02T11:25:43.000Z");

const pageSignals = (over: Partial<MetaLeadPageSignals> = {}): MetaLeadPageSignals => ({
  connectedAccountId: "acct-a", displayName: "Tamanor", connectionActive: true,
  credentialDecryptable: true, leadsPermissionGranted: true, pageSubscriptionVerified: true,
  subscriptionCheckedAt: CHECKED, ...over,
});

// ---- per-Page in-memory Graph transport (no network) -------------------------------------------------------
class MultiPageTransport implements LeadgenSubscriptionTransport {
  readonly name = "multi-page-mock";
  readonly reads: string[] = [];
  readonly writes: Array<{ pageId: string; subscribedFields: string[] }> = [];
  constructor(
    private readonly state: Map<string, PageAppSubscription[]>,
    private readonly failWriteFor = new Set<string>(),
  ) {}
  async getSubscribedApps(pageId: string): Promise<PageSubscriptionsRead> {
    this.reads.push(pageId);
    const apps = this.state.get(pageId) ?? [];
    return { ok: true, apps: apps.map((a) => ({ appId: a.appId, subscribedFields: [...a.subscribedFields] })) };
  }
  async subscribeApp(pageId: string, _token: string, subscribedFields: string[]): Promise<PageSubscriptionWrite> {
    this.writes.push({ pageId, subscribedFields: [...subscribedFields] });
    if (this.failWriteFor.has(pageId)) return { ok: false, errorCode: "permission" };
    const apps = this.state.get(pageId) ?? [];
    const mine = apps.find((a) => a.appId === APP_ID);
    if (mine) mine.subscribedFields = [...subscribedFields];
    else apps.push({ appId: APP_ID, subscribedFields: [...subscribedFields] });
    this.state.set(pageId, apps);
    return { ok: true };
  }
  fieldsFor(pageId: string): string[] {
    return this.state.get(pageId)?.find((a) => a.appId === APP_ID)?.subscribedFields ?? [];
  }
}

// ---- in-memory tenant ports (stand in for RLS DB + vault) --------------------------------------------------
interface Store { accounts: LeadgenSubscriptionAccount[]; persisted: Array<{ id: string; status: LeadgenSubscriptionStatus }>; tokens: Record<string, string | null> }
function makePorts(store: Store): LeadgenSubscriptionPorts {
  return {
    async loadAccount(tenantId, accountId) {
      // Models RLS: an account belonging to a DIFFERENT tenant simply does not resolve.
      return store.accounts.find((a) => a.id === accountId && a.tenantId === tenantId) ?? null;
    },
    async resolveToken(account) { return store.tokens[account.id] ?? null; },
    async persist(account, status) { store.persisted.push({ id: account.id, status }); },
  };
}
const acct = (over: Partial<LeadgenSubscriptionAccount> = {}): LeadgenSubscriptionAccount => ({
  id: "acct-a", tenantId: "tenant-A", brandId: "brand-1", platform: "facebook_page", status: "active",
  externalId: PAGE_A, pageId: PAGE_A, longLivedToken: null, accessToken: null, ...over,
});
function twoPageStore(): Store {
  return {
    accounts: [
      acct({ id: "acct-a", externalId: PAGE_A, pageId: PAGE_A }),
      acct({ id: "acct-b", externalId: PAGE_B, pageId: PAGE_B }),
    ],
    persisted: [],
    tokens: { "acct-a": TOKEN_A, "acct-b": TOKEN_B },
  };
}

async function main() {
  // =========================================================================================================
  console.log("\n1) two Facebook Pages: one verified, one missing its subscription");
  {
    const pages = [
      pageSignals({ connectedAccountId: "acct-a", displayName: "Tamanor", pageSubscriptionVerified: true }),
      pageSignals({ connectedAccountId: "acct-b", displayName: "Konfigurátor", pageSubscriptionVerified: false, subscriptionCheckedAt: null }),
    ];
    const s = summarizeMetaLeadReadiness(TENANT, pages);
    check("1a) the verified Page is ready", s.pages[0]!.state === "available" && s.pages[0]!.ready === true);
    check("1b) the unverified Page names its own missing precondition",
      s.pages[1]!.state === "webhook_subscription_missing" && s.pages[1]!.ready === false);
    check("1c) one Page's readiness does NOT leak onto the other",
      s.pages[0]!.ready !== s.pages[1]!.ready);
    check("1d) truthful rollup: 1 of 2 ready", s.readyCount === 1 && s.totalCount === 2);
    check("1e) headline never over-claims (not `available` while a Page is unready)",
      s.overall === "webhook_subscription_missing");
    check("1f) each record carries its own last-verification time",
      s.pages[0]!.subscriptionCheckedAt === CHECKED && s.pages[1]!.subscriptionCheckedAt === null);
    check("1g) display name preserved per Page",
      s.pages[0]!.displayName === "Tamanor" && s.pages[1]!.displayName === "Konfigurátor");
  }

  console.log("\n2) account ordering does not affect results");
  {
    const a = pageSignals({ connectedAccountId: "acct-a", pageSubscriptionVerified: true });
    const b = pageSignals({ connectedAccountId: "acct-b", pageSubscriptionVerified: false });
    const c = pageSignals({ connectedAccountId: "acct-c", credentialDecryptable: false });
    const forward = summarizeMetaLeadReadiness(TENANT, [a, b, c]);
    const reverse = summarizeMetaLeadReadiness(TENANT, [c, b, a]);
    check("2a) rollup counts identical under reversal",
      forward.readyCount === reverse.readyCount && forward.totalCount === reverse.totalCount);
    check("2b) headline identical under reversal (chosen by precedence, not position)",
      forward.overall === reverse.overall && forward.overall === "credential_unavailable");
    // Compare the id→state mapping itself, sorted, so array/key ORDER cannot mask or fake a difference.
    const byId = (s: typeof forward) =>
      s.pages.map((p) => `${p.connectedAccountId}=${p.state}`).sort().join("|");
    check("2c) every per-Page state identical under reversal", byId(forward) === byId(reverse), byId(reverse));
    check("2c') the mapping is the expected one",
      byId(forward) === "acct-a=available|acct-b=webhook_subscription_missing|acct-c=credential_unavailable", byId(forward));
    check("2d) the LATEST account can no longer decide the tenant state",
      forward.pages.find((p) => p.connectedAccountId === "acct-a")!.ready === true && forward.overall !== "available");
  }

  console.log("\n3) fail-closed precedence preserved per Page");
  {
    const base = pageSignals();
    check("3a) meta not configured wins", evaluateMetaLeadPageReadiness({ ...TENANT, metaConfigured: false }, base).state === "config_missing");
    check("3b) not entitled", evaluateMetaLeadPageReadiness({ ...TENANT, entitled: false }, base).state === "entitlement_locked");
    check("3c) connection inactive", evaluateMetaLeadPageReadiness(TENANT, pageSignals({ connectionActive: false })).state === "connection_inactive");
    check("3d) credential unavailable", evaluateMetaLeadPageReadiness(TENANT, pageSignals({ credentialDecryptable: false })).state === "credential_unavailable");
    check("3e) leads_retrieval missing", evaluateMetaLeadPageReadiness(TENANT, pageSignals({ leadsPermissionGranted: false })).state === "permission_missing");
    check("3f) subscription not verified", evaluateMetaLeadPageReadiness(TENANT, pageSignals({ pageSubscriptionVerified: false })).state === "webhook_subscription_missing");
    check("3g) provider approval missing", evaluateMetaLeadPageReadiness({ ...TENANT, providerApproved: false }, base).state === "awaiting_provider_approval");
    check("3h) all preconditions → ready", evaluateMetaLeadPageReadiness(TENANT, base).state === "available");
    check("3i) an earlier gap still hides a later one",
      evaluateMetaLeadPageReadiness(TENANT, pageSignals({ credentialDecryptable: false, leadsPermissionGranted: false, pageSubscriptionVerified: false })).state === "credential_unavailable");
    check("3j) no active Page at all → no_linked_account", summarizeMetaLeadReadiness(TENANT, []).overall === "no_linked_account");
    check("3k) zero Pages reports 0 of 0", summarizeMetaLeadReadiness(TENANT, []).readyCount === 0 && summarizeMetaLeadReadiness(TENANT, []).totalCount === 0);
    check("3l) precedence list covers every state exactly once", new Set(META_LEAD_STATE_PRECEDENCE).size === META_LEAD_STATE_PRECEDENCE.length);
  }

  console.log("\n4) aggregate X of Y is truthful");
  {
    const ready = (id: string) => pageSignals({ connectedAccountId: id, pageSubscriptionVerified: true });
    const unready = (id: string) => pageSignals({ connectedAccountId: id, pageSubscriptionVerified: false });
    check("4a) 0 of 3", summarizeMetaLeadReadiness(TENANT, [unready("1"), unready("2"), unready("3")]).readyCount === 0);
    check("4b) 2 of 3", summarizeMetaLeadReadiness(TENANT, [ready("1"), unready("2"), ready("3")]).readyCount === 2);
    check("4c) 3 of 3 → headline available", (() => {
      const s = summarizeMetaLeadReadiness(TENANT, [ready("1"), ready("2"), ready("3")]);
      return s.readyCount === 3 && s.totalCount === 3 && s.overall === "available";
    })());
    check("4d) readyCount never exceeds totalCount", (() => {
      const s = summarizeMetaLeadReadiness(TENANT, [ready("1"), unready("2")]);
      return s.readyCount <= s.totalCount;
    })());
  }

  // =========================================================================================================
  console.log("\n5) repair targets EXACTLY the submitted tenant-owned Facebook Page");
  {
    const store = twoPageStore();
    const state = new Map<string, PageAppSubscription[]>([
      [PAGE_A, [{ appId: APP_ID, subscribedFields: ["feed"] }]],
      [PAGE_B, [{ appId: APP_ID, subscribedFields: ["feed", LEADGEN_FIELD] }]],
    ]);
    const t = new MultiPageTransport(state);
    const r = await ensureAccountLeadgenSubscription("tenant-A", "acct-a", { transport: t, ports: makePorts(store), appId: APP_ID });
    check("5a) the submitted Page is repaired and verified", r.verified === true && r.status === LEADGEN_SUBSCRIPTION_VERIFIED);
    check("5b) ONLY the submitted Page was written", t.writes.length === 1 && t.writes[0]!.pageId === PAGE_A);
    check("5c) the other Page was never read or written", !t.reads.includes(PAGE_B) && !t.writes.some((w) => w.pageId === PAGE_B));
    check("5d) the other Page's subscribed fields are untouched", t.fieldsFor(PAGE_B).join(",") === `feed,${LEADGEN_FIELD}`);
    check("5e) status persisted for the submitted account ONLY",
      store.persisted.length === 1 && store.persisted[0]!.id === "acct-a");
    check("5f) existing fields on the repaired Page preserved", t.fieldsFor(PAGE_A).includes("feed") && t.fieldsFor(PAGE_A).includes(LEADGEN_FIELD));
  }

  console.log("\n6) rejected targets — no provider call, nothing persisted");
  {
    // cross-tenant
    const store = twoPageStore();
    const t = new MultiPageTransport(new Map());
    const r = await ensureAccountLeadgenSubscription("tenant-B", "acct-a", { transport: t, ports: makePorts(store), appId: APP_ID });
    check("6a) cross-tenant account id → rejected BEFORE any provider call",
      r.verified === false && r.reason === "account_not_found" && t.reads.length === 0 && t.writes.length === 0);
    check("6b) cross-tenant attempt persists nothing", store.persisted.length === 0);
  }
  {
    // instagram
    const store: Store = {
      accounts: [acct({ id: "acct-ig", platform: "instagram_business", externalId: IG_ID, pageId: null })],
      persisted: [], tokens: { "acct-ig": TOKEN_A },
    };
    const t = new MultiPageTransport(new Map());
    const r = await ensureAccountLeadgenSubscription("tenant-A", "acct-ig", { transport: t, ports: makePorts(store), appId: APP_ID });
    check("6c) Instagram account → rejected BEFORE any provider call",
      r.verified === false && r.reason === "not_a_facebook_page" && t.reads.length === 0 && t.writes.length === 0);
    check("6d) the Instagram id NEVER reached subscribed_apps",
      !JSON.stringify(t.reads).includes(IG_ID) && !JSON.stringify(t.writes).includes(IG_ID));
    check("6e) nothing persisted for a non-Page account", store.persisted.length === 0);
  }
  {
    // inactive page
    const store = twoPageStore();
    store.accounts[0]!.status = "disconnected";
    const t = new MultiPageTransport(new Map());
    const r = await ensureAccountLeadgenSubscription("tenant-A", "acct-a", { transport: t, ports: makePorts(store), appId: APP_ID });
    check("6f) inactive Page → rejected BEFORE any provider call",
      r.verified === false && r.reason === "account_inactive" && t.reads.length === 0 && t.writes.length === 0);
    check("6g) inactive Page persists nothing", store.persisted.length === 0);
  }

  console.log("\n7) one Page failing does not alter another Page");
  {
    const store = twoPageStore();
    const state = new Map<string, PageAppSubscription[]>([
      [PAGE_A, [{ appId: APP_ID, subscribedFields: ["feed"] }]],
      [PAGE_B, [{ appId: APP_ID, subscribedFields: ["feed"] }]],
    ]);
    const t = new MultiPageTransport(state, new Set([PAGE_A])); // Page A's write always fails
    const ports = makePorts(store);
    const a = await ensureAccountLeadgenSubscription("tenant-A", "acct-a", { transport: t, ports, appId: APP_ID });
    const b = await ensureAccountLeadgenSubscription("tenant-A", "acct-b", { transport: t, ports, appId: APP_ID });
    check("7a) the failing Page reports failure truthfully",
      a.verified === false && a.status === LEADGEN_SUBSCRIPTION_NOT_SUBSCRIBED);
    check("7b) the other Page still succeeds", b.verified === true && b.status === LEADGEN_SUBSCRIPTION_VERIFIED);
    check("7c) the failing Page's subscription is unchanged (no partial write applied)",
      t.fieldsFor(PAGE_A).join(",") === "feed");
    check("7d) the healthy Page gained leadgen while preserving `feed`",
      t.fieldsFor(PAGE_B).includes("feed") && t.fieldsFor(PAGE_B).includes(LEADGEN_FIELD));
    check("7e) each account persisted its OWN status",
      store.persisted.find((p) => p.id === "acct-a")!.status === LEADGEN_SUBSCRIPTION_NOT_SUBSCRIBED
      && store.persisted.find((p) => p.id === "acct-b")!.status === LEADGEN_SUBSCRIPTION_VERIFIED);
  }

  console.log("\n8) already-verified Page is idempotent");
  {
    const store = twoPageStore();
    const state = new Map<string, PageAppSubscription[]>([[PAGE_A, [{ appId: APP_ID, subscribedFields: ["feed", LEADGEN_FIELD] }]]]);
    const t = new MultiPageTransport(state);
    const ports = makePorts(store);
    const first = await ensureAccountLeadgenSubscription("tenant-A", "acct-a", { transport: t, ports, appId: APP_ID });
    const second = await ensureAccountLeadgenSubscription("tenant-A", "acct-a", { transport: t, ports, appId: APP_ID });
    check("8a) both runs verified", first.verified === true && second.verified === true);
    check("8b) NO provider write on either run", t.writes.length === 0 && first.wrote === false && second.wrote === false);
    check("8c) reported as already subscribed", first.alreadySubscribed === true && second.alreadySubscribed === true);
    check("8d) field set never accumulated a duplicate leadgen",
      t.fieldsFor(PAGE_A).filter((f) => f === LEADGEN_FIELD).length === 1);
  }

  console.log("\n9) reconnect verifies each selected Page independently");
  {
    const store = twoPageStore();
    const state = new Map<string, PageAppSubscription[]>([
      [PAGE_A, [{ appId: APP_ID, subscribedFields: ["feed"] }]],
      [PAGE_B, [{ appId: APP_ID, subscribedFields: ["feed"] }]],
    ]);
    const t = new MultiPageTransport(state, new Set([PAGE_A]));
    const ports = makePorts(store);
    const a = await ensureLeadgenSubscriptionOnConnect("tenant-A", "acct-a", ["leads_retrieval"], { transport: t, ports, appId: APP_ID });
    const b = await ensureLeadgenSubscriptionOnConnect("tenant-A", "acct-b", ["leads_retrieval"], { transport: t, ports, appId: APP_ID });
    check("9a) a failing Page never throws (connect is not broken)", a.attempted === true && a.verified === false);
    check("9b) the other Page still verifies", b.attempted === true && b.verified === true);
    check("9c) both accounts still present and active (no disconnect/damage)",
      store.accounts.every((x) => x.status === "active") && store.accounts.length === 2);
    check("9d) stored credentials untouched", store.tokens["acct-a"] === TOKEN_A && store.tokens["acct-b"] === TOKEN_B);
    const skipped = await ensureLeadgenSubscriptionOnConnect("tenant-A", "acct-b", ["pages_show_list"], { transport: t, ports, appId: APP_ID });
    check("9e) without leads_retrieval nothing is attempted", skipped.attempted === false);
  }

  console.log("\n10) no secret / token / provider identifier leakage");
  {
    const s = summarizeMetaLeadReadiness(TENANT, [
      pageSignals({ connectedAccountId: "acct-a", displayName: "Tamanor" }),
      pageSignals({ connectedAccountId: "acct-b", displayName: "Konfigurátor", pageSubscriptionVerified: false }),
    ]);
    const dump = JSON.stringify(s);
    for (const [name, value] of [
      ["page A token", TOKEN_A], ["page B token", TOKEN_B],
      ["provider Page id A", PAGE_A], ["provider Page id B", PAGE_B], ["Instagram id", IG_ID],
    ] as const) {
      check(`10a) readiness carries NO ${name}`, !dump.includes(value));
    }
    const keys = new Set(s.pages.flatMap((p) => Object.keys(p)));
    check("10b) readiness record exposes only the safe field set",
      [...keys].sort().join(",") === "connectedAccountId,credentialAvailable,displayName,leadsPermissionGranted,ready,state,subscriptionCheckedAt,subscriptionVerified",
      [...keys].sort().join(","));
    check("10c) no pageId / externalId / token / secret key present",
      !/"(pageId|externalId|accessToken|longLivedToken|token|secret|proof)"/.test(dump));
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — meta lead multi-page readiness: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
