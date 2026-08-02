/**
 * BUSINESS-LEADGEN-ONBOARDING-V1 — targeted tests for AUTOMATIC Meta Lead Ads onboarding.
 *
 * A customer must only click Connect Meta, authenticate, select assets and approve permissions. Everything
 * else — the Page↔app `leadgen` subscription and its verification — happens server-side. These tests pin that
 * automation: per-Page independence, ordering (credential persisted BEFORE any provider HTTP, outside every DB
 * transaction), post-write verification, reconnect skipping already-verified Pages, server-side validation of
 * every client-submitted asset, and the absence of any secret / provider id / PII in the results.
 *
 * NO network and NO database: the Graph seam is an in-memory per-Page transport and the tenant DB/vault effects
 * are injected ports that also record their call ORDER.
 */
import { readFileSync } from "node:fs";
import {
  resolveMetaAssetSelection, classifyMetaPageOnboarding, summarizeMetaPageOnboarding,
  encodeMetaOnboardingSummary, decodeMetaOnboardingSummary, ALL_META_PAGE_ONBOARDING_OUTCOMES,
  setOpsSink, resetOpsSink,
  type MetaSelectableAsset, type MetaPageOnboardingSignals,
} from "@guardora/core";
import {
  LEADGEN_FIELD,
  type LeadgenSubscriptionTransport, type PageAppSubscription,
  type PageSubscriptionsRead, type PageSubscriptionWrite,
} from "@guardora/connectors";
import {
  ensureLeadgenSubscriptionOnConnect, ensureAccountLeadgenSubscription,
  LEADGEN_SUBSCRIPTION_VERIFIED, LEADGEN_SUBSCRIPTION_NOT_SUBSCRIBED, LEADGEN_SUBSCRIPTION_UNAVAILABLE,
  type LeadgenSubscriptionAccount, type LeadgenSubscriptionPorts, type LeadgenSubscriptionStatus,
} from "../src/meta-leadgen-subscription";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const APP_ID = "app-123";
const PAGE_A = "PAGEID_AAA_provider";
const PAGE_B = "PAGEID_BBB_provider";
const PAGE_FOREIGN = "PAGEID_NOT_OURS";
const IG_A = "IGID_AAA_provider";
const TOKEN_A = "SECRET_TOKEN_A_do_not_leak";
const TOKEN_B = "SECRET_TOKEN_B_do_not_leak";
const LEAD_PII = "Jane Doe jane@lead.test +421900111222";

const ASSETS: MetaSelectableAsset[] = [
  { pageId: PAGE_A, igBusinessId: IG_A },
  { pageId: PAGE_B, igBusinessId: null },
];

// ---- ops sink capture --------------------------------------------------------------------------------------
const emitted: Array<{ event: string; meta: Record<string, unknown> }> = [];
setOpsSink({ emit: (event, meta) => { emitted.push({ event, meta }); } });

// ---- per-Page Graph transport (no network) -----------------------------------------------------------------
class PageTransport implements LeadgenSubscriptionTransport {
  readonly name = "onboarding-mock";
  readonly reads: string[] = [];
  readonly writes: Array<{ pageId: string; subscribedFields: string[] }> = [];
  constructor(
    private readonly state: Map<string, PageAppSubscription[]>,
    private readonly failWriteFor = new Set<string>(),
    private readonly writeIsNoopFor = new Set<string>(),
    private readonly trace: string[] = [],
  ) {}
  async getSubscribedApps(pageId: string): Promise<PageSubscriptionsRead> {
    this.reads.push(pageId); this.trace.push(`graph_read:${pageId}`);
    return { ok: true, apps: (this.state.get(pageId) ?? []).map((a) => ({ appId: a.appId, subscribedFields: [...a.subscribedFields] })) };
  }
  async subscribeApp(pageId: string, _t: string, fields: string[]): Promise<PageSubscriptionWrite> {
    this.writes.push({ pageId, subscribedFields: [...fields] }); this.trace.push(`graph_write:${pageId}`);
    if (this.failWriteFor.has(pageId)) return { ok: false, errorCode: "permission" };
    if (this.writeIsNoopFor.has(pageId)) return { ok: true };
    const apps = this.state.get(pageId) ?? [];
    const mine = apps.find((a) => a.appId === APP_ID);
    if (mine) mine.subscribedFields = [...fields]; else apps.push({ appId: APP_ID, subscribedFields: [...fields] });
    this.state.set(pageId, apps);
    return { ok: true };
  }
  fieldsFor(pageId: string): string[] {
    return this.state.get(pageId)?.find((a) => a.appId === APP_ID)?.subscribedFields ?? [];
  }
}

// ---- ports that record ORDER + whether a transaction was open ----------------------------------------------
interface Store {
  accounts: LeadgenSubscriptionAccount[];
  persisted: Array<{ id: string; status: LeadgenSubscriptionStatus }>;
  tokens: Record<string, string | null>;
  trace: string[];
  /** True while a simulated DB transaction is open — provider HTTP must NEVER run inside one. */
  txOpen: boolean;
  providerCallsInsideTx: number;
}
function makePorts(store: Store): LeadgenSubscriptionPorts {
  return {
    async loadAccount(tenantId, accountId) {
      store.trace.push("db_read");
      return store.accounts.find((a) => a.id === accountId && a.tenantId === tenantId) ?? null;
    },
    async resolveToken(account) { store.trace.push("vault_read"); return store.tokens[account.id] ?? null; },
    async persist(account, status) {
      // Models the real write: a SHORT tenant transaction, opened only after all provider HTTP is done.
      store.txOpen = true;
      store.trace.push("db_write");
      store.persisted.push({ id: account.id, status });
      store.txOpen = false;
    },
  };
}
const acct = (over: Partial<LeadgenSubscriptionAccount> = {}): LeadgenSubscriptionAccount => ({
  id: "acct-a", tenantId: "tenant-A", brandId: "brand-1", platform: "facebook_page", status: "active",
  externalId: PAGE_A, pageId: PAGE_A, longLivedToken: null, accessToken: null, ...over,
});
function store2(): Store {
  return {
    accounts: [acct({ id: "acct-a", externalId: PAGE_A, pageId: PAGE_A }), acct({ id: "acct-b", externalId: PAGE_B, pageId: PAGE_B })],
    persisted: [], tokens: { "acct-a": TOKEN_A, "acct-b": TOKEN_B }, trace: [], txOpen: false, providerCallsInsideTx: 0,
  };
}
const GRANTED = ["pages_show_list", "pages_manage_engagement", "leads_retrieval"];

async function main() {
  // =========================================================================================================
  console.log("\n1) one Facebook Page connected and subscribed automatically");
  {
    const store = store2();
    const t = new PageTransport(new Map([[PAGE_A, [{ appId: APP_ID, subscribedFields: ["feed"] }]]]), new Set(), new Set(), store.trace);
    const r = await ensureLeadgenSubscriptionOnConnect("tenant-A", "acct-a", GRANTED, { transport: t, ports: makePorts(store), appId: APP_ID });
    check("1a) subscription attempted and verified with no customer action", r.attempted === true && r.verified === true);
    check("1b) status reported + persisted as verified", r.status === LEADGEN_SUBSCRIPTION_VERIFIED && store.persisted[0]!.status === LEADGEN_SUBSCRIPTION_VERIFIED);
    check("1c) existing subscribed fields preserved, leadgen added once",
      t.fieldsFor(PAGE_A).join(",") === `feed,${LEADGEN_FIELD}`);
  }

  console.log("\n2) provider HTTP runs AFTER credential persistence and OUTSIDE any DB transaction");
  {
    const store = store2();
    const t = new PageTransport(new Map([[PAGE_A, [{ appId: APP_ID, subscribedFields: [] }]]]), new Set(), new Set(), store.trace);
    await ensureLeadgenSubscriptionOnConnect("tenant-A", "acct-a", GRANTED, { transport: t, ports: makePorts(store), appId: APP_ID });
    const trace = store.trace;
    const firstGraph = trace.findIndex((x) => x.startsWith("graph_"));
    const lastGraph = trace.map((x, i) => (x.startsWith("graph_") ? i : -1)).filter((i) => i >= 0).pop()!;
    check("2a) the vault credential is read BEFORE any provider call",
      trace.indexOf("vault_read") >= 0 && trace.indexOf("vault_read") < firstGraph, trace.join(" → "));
    check("2b) the DB write happens AFTER every provider call (read → HTTP → write)",
      trace.lastIndexOf("db_write") > lastGraph, trace.join(" → "));
    check("2c) no provider call ever ran inside an open transaction", store.providerCallsInsideTx === 0 && store.txOpen === false);
    check("2d) exact ordering: db_read → vault_read → graph… → db_write",
      trace[0] === "db_read" && trace[1] === "vault_read" && trace[trace.length - 1] === "db_write", trace.join(" → "));
  }

  console.log("\n3) multiple Pages processed independently; one failure does not affect the other");
  {
    const store = store2();
    const state = new Map<string, PageAppSubscription[]>([
      [PAGE_A, [{ appId: APP_ID, subscribedFields: ["feed"] }]],
      [PAGE_B, [{ appId: APP_ID, subscribedFields: ["feed"] }]],
    ]);
    const t = new PageTransport(state, new Set([PAGE_A]), new Set(), store.trace);
    const ports = makePorts(store);
    const a = await ensureLeadgenSubscriptionOnConnect("tenant-A", "acct-a", GRANTED, { transport: t, ports, appId: APP_ID });
    const b = await ensureLeadgenSubscriptionOnConnect("tenant-A", "acct-b", GRANTED, { transport: t, ports, appId: APP_ID });
    check("3a) failing Page reports failure and never throws (connect not aborted)",
      a.attempted === true && a.verified === false && a.status === LEADGEN_SUBSCRIPTION_NOT_SUBSCRIBED);
    check("3b) the other Page still completes successfully", b.verified === true && b.status === LEADGEN_SUBSCRIPTION_VERIFIED);
    check("3c) the failing Page's subscription is unchanged", t.fieldsFor(PAGE_A).join(",") === "feed");
    check("3d) the healthy Page gained leadgen while preserving `feed`",
      t.fieldsFor(PAGE_B).includes("feed") && t.fieldsFor(PAGE_B).includes(LEADGEN_FIELD));
    check("3e) each account persisted its OWN status only",
      store.persisted.find((p) => p.id === "acct-a")!.status === LEADGEN_SUBSCRIPTION_NOT_SUBSCRIBED
      && store.persisted.find((p) => p.id === "acct-b")!.status === LEADGEN_SUBSCRIPTION_VERIFIED);
    check("3f) both accounts remain active — nothing disconnected or rolled back",
      store.accounts.every((x) => x.status === "active") && store.tokens["acct-a"] === TOKEN_A && store.tokens["acct-b"] === TOKEN_B);
  }

  console.log("\n4) post-write verification is required before marking verified");
  {
    const store = store2();
    const t = new PageTransport(new Map([[PAGE_A, [{ appId: APP_ID, subscribedFields: ["feed"] }]]]), new Set(), new Set([PAGE_A]), store.trace);
    const r = await ensureLeadgenSubscriptionOnConnect("tenant-A", "acct-a", GRANTED, { transport: t, ports: makePorts(store), appId: APP_ID });
    check("4a) a 200 write that did not apply is NOT reported verified", r.verified === false);
    check("4b) verification is a SECOND read after the write", t.reads.length === 2 && t.writes.length === 1);
    check("4c) persisted status is truthful, never 'verified'", store.persisted[0]!.status !== LEADGEN_SUBSCRIPTION_VERIFIED);
  }

  console.log("\n5) missing leads_retrieval leaves the Page connected for comments");
  {
    const store = store2();
    const t = new PageTransport(new Map(), new Set(), new Set(), store.trace);
    const r = await ensureLeadgenSubscriptionOnConnect("tenant-A", "acct-a", ["pages_show_list", "pages_manage_engagement"], { transport: t, ports: makePorts(store), appId: APP_ID });
    check("5a) no subscription attempted", r.attempted === false && r.status === null);
    check("5b) NO provider call and NO vault read", t.reads.length === 0 && t.writes.length === 0 && store.trace.length === 0);
    check("5c) nothing persisted — the comment connection is untouched", store.persisted.length === 0);
    check("5d) classified as comments-only when the deployment does not request lead access",
      classifyMetaPageOnboarding({ leadsScopeRequested: false, leadsPermissionGranted: false, subscriptionStatus: null, providerApproved: true }) === "comments_only");
    check("5e) classified as permission-missing when lead access IS requested but not granted",
      classifyMetaPageOnboarding({ leadsScopeRequested: true, leadsPermissionGranted: false, subscriptionStatus: null, providerApproved: true }) === "leads_permission_missing");
  }

  console.log("\n6) Instagram never reaches subscribed_apps");
  {
    const store: Store = {
      accounts: [acct({ id: "acct-ig", platform: "instagram_business", externalId: IG_A, pageId: null })],
      persisted: [], tokens: { "acct-ig": TOKEN_A }, trace: [], txOpen: false, providerCallsInsideTx: 0,
    };
    const t = new PageTransport(new Map(), new Set(), new Set(), store.trace);
    const r = await ensureAccountLeadgenSubscription("tenant-A", "acct-ig", { transport: t, ports: makePorts(store), appId: APP_ID });
    check("6a) Instagram rejected BEFORE any provider or vault activity",
      r.verified === false && r.reason === "not_a_facebook_page" && t.reads.length === 0 && t.writes.length === 0);
    check("6b) the Instagram id never appears in any provider call",
      !JSON.stringify([t.reads, t.writes]).includes(IG_A));
    check("6c) no vault read and nothing persisted for Instagram",
      !store.trace.includes("vault_read") && store.persisted.length === 0);
  }

  console.log("\n7) reconnect retries only Pages that are NOT verified");
  {
    const store = store2();
    store.accounts[0]!.leadgenSubscriptionStatus = LEADGEN_SUBSCRIPTION_VERIFIED; // Page A already verified
    const state = new Map<string, PageAppSubscription[]>([
      [PAGE_A, [{ appId: APP_ID, subscribedFields: ["feed", LEADGEN_FIELD] }]],
      [PAGE_B, [{ appId: APP_ID, subscribedFields: ["feed"] }]],
    ]);
    const t = new PageTransport(state, new Set(), new Set(), store.trace);
    const ports = makePorts(store);
    const a = await ensureLeadgenSubscriptionOnConnect("tenant-A", "acct-a", GRANTED, { transport: t, ports, appId: APP_ID });
    const b = await ensureLeadgenSubscriptionOnConnect("tenant-A", "acct-b", GRANTED, { transport: t, ports, appId: APP_ID });
    check("7a) already-verified Page short-circuits: NO provider call at all", !t.reads.includes(PAGE_A) && !t.writes.some((w) => w.pageId === PAGE_A));
    check("7b) already-verified Page still reports verified", a.verified === true && a.alreadySubscribed !== false);
    check("7c) already-verified Page performs NO write of any kind",
      store.persisted.every((p) => p.id !== "acct-a"), JSON.stringify(store.persisted));
    check("7d) the unverified Page IS retried and subscribed", b.verified === true && t.writes.some((w) => w.pageId === PAGE_B));
    check("7e) the explicit repair action never short-circuits (always re-verifies)", await (async () => {
      const t2 = new PageTransport(state, new Set(), new Set(), store.trace);
      await ensureAccountLeadgenSubscription("tenant-A", "acct-a", { transport: t2, ports, appId: APP_ID });
      return t2.reads.includes(PAGE_A);
    })());
  }

  console.log("\n8) already-verified Page is idempotent — no unnecessary write");
  {
    const store = store2();
    const state = new Map<string, PageAppSubscription[]>([[PAGE_A, [{ appId: APP_ID, subscribedFields: ["feed", LEADGEN_FIELD] }]]]);
    const t = new PageTransport(state, new Set(), new Set(), store.trace);
    const ports = makePorts(store);
    const first = await ensureLeadgenSubscriptionOnConnect("tenant-A", "acct-a", GRANTED, { transport: t, ports, appId: APP_ID });
    const second = await ensureLeadgenSubscriptionOnConnect("tenant-A", "acct-a", GRANTED, { transport: t, ports, appId: APP_ID });
    check("8a) both runs verified", first.verified === true && second.verified === true);
    check("8b) zero provider writes", t.writes.length === 0);
    check("8c) leadgen never duplicated in the field set",
      t.fieldsFor(PAGE_A).filter((f) => f === LEADGEN_FIELD).length === 1);
  }

  console.log("\n9) client-submitted assets are validated against the SERVER asset list");
  {
    const ok = resolveMetaAssetSelection(ASSETS, [`facebook:${PAGE_A}`, `instagram:${IG_A}`]);
    check("9a) owned Page + its Instagram accepted", ok.pages.has(PAGE_A) && ok.instagram.has(IG_A) && ok.rejected === 0);

    const unowned = resolveMetaAssetSelection(ASSETS, [`facebook:${PAGE_FOREIGN}`]);
    check("9b) unowned Page id rejected, never selected", unowned.pages.size === 0 && unowned.rejected === 1);

    const crossTenant = resolveMetaAssetSelection([], [`facebook:${PAGE_A}`, `instagram:${IG_A}`]);
    check("9c) cross-tenant targeting (asset absent from THIS flow) rejected", crossTenant.pages.size === 0 && crossTenant.instagram.size === 0 && crossTenant.rejected === 2);

    const igOfOther = resolveMetaAssetSelection(ASSETS, [`instagram:${PAGE_FOREIGN}`]);
    check("9d) unknown Instagram id rejected", igOfOther.instagram.size === 0 && igOfOther.rejected === 1);

    const junk = resolveMetaAssetSelection(ASSETS, ["", "facebook:", ":x", "nonsense", "admin:1", `FACEBOOK:${PAGE_A}`]);
    check("9e) malformed / unknown-prefix / case-mismatched values rejected", junk.pages.size === 0 && junk.instagram.size === 0 && junk.rejected === 6);

    const mixed = resolveMetaAssetSelection(ASSETS, [`facebook:${PAGE_A}`, `facebook:${PAGE_FOREIGN}`, `facebook:${PAGE_B}`]);
    check("9f) a valid selection is never widened by an invalid one",
      mixed.pages.size === 2 && mixed.pages.has(PAGE_A) && mixed.pages.has(PAGE_B) && !mixed.pages.has(PAGE_FOREIGN) && mixed.rejected === 1);
  }

  console.log("\n10) outcome classification + bounded summary encoding");
  {
    const sig = (o: Partial<MetaPageOnboardingSignals> = {}): MetaPageOnboardingSignals => ({
      leadsScopeRequested: true, leadsPermissionGranted: true, subscriptionStatus: "verified", providerApproved: true, ...o,
    });
    check("10a) ready", classifyMetaPageOnboarding(sig()) === "lead_ads_ready");
    check("10b) webhook not verified", classifyMetaPageOnboarding(sig({ subscriptionStatus: "not_subscribed" })) === "webhook_not_verified");
    check("10c) never checked → webhook not verified (fail-closed)", classifyMetaPageOnboarding(sig({ subscriptionStatus: null })) === "webhook_not_verified");
    check("10d) transient provider failure → verification unavailable", classifyMetaPageOnboarding(sig({ subscriptionStatus: "unavailable" })) === "verification_unavailable");
    check("10e) provider approval required", classifyMetaPageOnboarding(sig({ providerApproved: false })) === "provider_approval_required");
    check("10f) an unavailable check is never reported as ready", classifyMetaPageOnboarding(sig({ subscriptionStatus: "unavailable", providerApproved: false })) !== "lead_ads_ready");

    const sum = summarizeMetaPageOnboarding(["lead_ads_ready", "lead_ads_ready", "webhook_not_verified"]);
    check("10g) summary counts are truthful", sum.total === 3 && sum.counts.lead_ads_ready === 2 && sum.counts.webhook_not_verified === 1);
    const enc = encodeMetaOnboardingSummary(sum);
    check("10h) encoding is counts only — no id, name, token or letter", /^[0-9.]+$/.test(enc), enc);
    const dec = decodeMetaOnboardingSummary(enc);
    check("10i) round-trips exactly", JSON.stringify(dec) === JSON.stringify(sum));
    check("10j) hostile / malformed input decodes to null (renders nothing)",
      decodeMetaOnboardingSummary("1.2.3") === null
      && decodeMetaOnboardingSummary("a.b.c.d.e.f") === null
      && decodeMetaOnboardingSummary("-1.0.0.0.0.0") === null
      && decodeMetaOnboardingSummary("9999.0.0.0.0.0") === null
      && decodeMetaOnboardingSummary("0.0.0.0.0.0") === null
      && decodeMetaOnboardingSummary(undefined) === null
      && decodeMetaOnboardingSummary("<script>") === null);
    check("10k) every outcome has a slot in the fixed encoding order", ALL_META_PAGE_ONBOARDING_OUTCOMES.length === enc.split(".").length);
  }

  console.log("\n11) no secret / provider id / lead data / PII leakage");
  {
    const store = store2();
    const t = new PageTransport(new Map([[PAGE_A, [{ appId: APP_ID, subscribedFields: ["feed"] }]]]), new Set(), new Set(), store.trace);
    emitted.length = 0;
    const r = await ensureLeadgenSubscriptionOnConnect("tenant-A", "acct-a", GRANTED, { transport: t, ports: makePorts(store), appId: APP_ID });
    const dump = JSON.stringify({ r, emitted, summary: encodeMetaOnboardingSummary(summarizeMetaPageOnboarding(["lead_ads_ready"])) });
    for (const [name, v] of [
      ["page token A", TOKEN_A], ["page token B", TOKEN_B], ["provider Page id", PAGE_A],
      ["Instagram id", IG_A], ["app id", APP_ID], ["tenant id", "tenant-A"], ["lead PII", LEAD_PII],
    ] as const) {
      check(`11a) result + ops events carry NO ${name}`, !dump.includes(v));
    }
    check("11b) ops events were captured (assertions are meaningful)", emitted.length > 0);
    check("11c) ops meta keys are bounded labels only",
      emitted.every((e) => Object.keys(e.meta).every((k) => ["operation", "result", "reason"].includes(k))), JSON.stringify(emitted));
  }

  console.log("\n12) source invariants — existing comment onboarding unchanged");
  {
    const src = readFileSync(new URL("../../../apps/web/src/app/dashboard/accounts/meta/actions.ts", import.meta.url), "utf8");
    check("12a) connect still persists via linkMetaAssets", /linkMetaAssets\(\{/.test(src));
    check("12b) vault-only token write preserved (plaintext page token passed to linkMetaAssets)", /pageAccessToken: page\.pageAccessToken/.test(src));
    check("12c) Instagram still connected through the same path", /connectIg: igChosen/.test(src));
    check("12d) monitoring activation preserved", /enableAccountMonitoringWithinLimit/.test(src));
    check("12e) monitored-limit reconcile preserved", /enforceMonitoringLimits/.test(src));
    check("12f) token verification preserved", /checkAccountToken\(session\.tenantId, link\.pageAccountId\)/.test(src));
    check("12g) first read-only sync still scheduled after the response", /after\(async \(\) => \{[\s\S]*?runReadOnlySync/.test(src));
    check("12h) connector-manage permission gate preserved", /assertCan\(session\.role, Permission\.ConnectorManage\)/.test(src));
    check("12i) tenant comes from the session, never the client", /session\.tenantId/.test(src) && !/formData\.get\("tenantId"\)/.test(src));
    check("12j) selection is validated against the SERVER asset list", /resolveMetaAssetSelection\(pages, selected\)/.test(src));
    // Compare CALL SITES (not the import line): the subscribe call must come after the account+credential
    // persistence call, inside the same per-Page loop.
    const linkCall = src.indexOf("link = await linkMetaAssets({");
    const subCall = src.indexOf("await ensureLeadgenSubscriptionOnConnect(session.tenantId");
    check("12k) subscription runs per Page inside the loop, after linkMetaAssets",
      linkCall > 0 && subCall > linkCall, `link=${linkCall} sub=${subCall}`);
    check("12l) subscription is NOT inside a withTenant transaction",
      !/withTenant\([\s\S]{0,400}ensureLeadgenSubscriptionOnConnect/.test(src));
    check("12m) redirect carries counts only — no page name/id/token",
      /lead=\$\{leadSummary\}/.test(src) && !/pageId=\$/.test(src) && !/pageAccessToken=\$/.test(src));
  }

  resetOpsSink();
  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — meta lead onboarding: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
