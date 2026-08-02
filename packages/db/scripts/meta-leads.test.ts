/**
 * META LEAD ADS ingestion tests (local Postgres). Proves the full safe path with a DETERMINISTIC lead fetcher
 * (no real Meta HTTP): strict leadgen parse; allow-list normalization (no raw field_data, consent never inferred);
 * vault-credentialed fetch → BusinessContact insert; idempotent replay → duplicate; unmapped page → rejected;
 * missing credential → rejected; fetch failure → fetchFailure; and FAIL-CLOSED on a corrupt vault row (rejected,
 * never a legacy-token fetch). Tenant is always resolved from the trusted page id, never the payload.
 */
import { createHash } from "node:crypto";
process.env.PROVIDER_VAULT_KEK = createHash("sha256").update("meta-leads-test-kek").digest("base64");

import {
  systemDb, storeProviderCredential, revokeProviderCredential, ProviderCredentialPurpose,
} from "../src/index";
import {
  parseMetaLeadgenChanges, normalizeMetaLead, ingestMetaLeadgenChanges,
  type MetaGraphLead, type MetaLeadFetcher,
} from "../../sync/src/index";
import { BusinessProvider as PBusinessProvider } from "@prisma/client";

const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("✗ refusing to run against a non-local DB"); process.exit(1); }

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const rnd = () => Math.random().toString(36).slice(2, 10);

async function seed(pageExternalId: string) {
  const slug = `leads-${rnd()}`;
  const t = await systemDb.tenant.create({ data: { slug, name: slug, plan: "growth", workspaceKind: "business" } });
  const brand = await systemDb.brand.create({ data: { tenantId: t.id, name: "b" } });
  const acct = await systemDb.connectedAccount.create({ data: { tenantId: t.id, brandId: brand.id, platform: "facebook_page", externalId: pageExternalId, status: "active" } });
  return { tenantId: t.id, brandId: brand.id, accountId: acct.id, pageId: pageExternalId };
}

const leadgenBody = (pageId: string, leadgenId: string) => ({
  object: "page",
  entry: [{ id: pageId, time: 1, changes: [{ field: "leadgen", value: { leadgen_id: leadgenId, page_id: pageId, form_id: "form-9", ad_id: "ad-9", created_time: "2026-06-01T10:00:00Z" } }] }],
});

const graphLead = (leadgenId: string): MetaGraphLead => ({
  // No `form_name`: the Meta Lead node does not expose one, so it is neither requested nor normalized.
  id: leadgenId, created_time: "2026-06-01T10:00:00Z", ad_id: "ad-9", ad_name: "Spring Ad", form_id: "form-9",
  campaign_id: "camp-9", campaign_name: "Spring", field_data: [
    { name: "full_name", values: ["Jane Doe"] }, { name: "email", values: ["jane@lead.test"] },
    { name: "phone_number", values: ["+421900111222"] }, { name: "company_name", values: ["Acme"] },
    { name: "what_is_your_budget", values: ["SECRET ANSWER - must not be stored"] },
  ],
});
const fetcher = (lead: MetaGraphLead): MetaLeadFetcher => async () => lead;

async function main() {
  // ---- parse: strict leadgen extraction --------------------------------------------------------------------
  const changes = parseMetaLeadgenChanges(leadgenBody("PAGE1", "lead-1"));
  check("parse: one leadgen change extracted with page/lead/form/ad ids", changes.length === 1 && changes[0]!.pageId === "PAGE1" && changes[0]!.leadgenId === "lead-1" && changes[0]!.formId === "form-9");
  check("parse: non-page object ignored", parseMetaLeadgenChanges({ object: "user", entry: [] }).length === 0);
  check("parse: non-leadgen change ignored", parseMetaLeadgenChanges({ object: "page", entry: [{ id: "P", changes: [{ field: "feed", value: {} }] }] }).length === 0);
  check("parse: change without leadgen_id ignored", parseMetaLeadgenChanges({ object: "page", entry: [{ id: "P", changes: [{ field: "leadgen", value: { form_id: "x" } }] }] }).length === 0);
  check("parse: garbage input → []", parseMetaLeadgenChanges(null).length === 0 && parseMetaLeadgenChanges("nope").length === 0);

  // ---- normalize: allow-list only, consent never inferred --------------------------------------------------
  const norm = normalizeMetaLead(graphLead("lead-1"), changes[0]!, null);
  check("normalize: full name/email/phone/company mapped from allow-list", norm.fullName === "Jane Doe" && norm.email === "jane@lead.test" && norm.phone === "+421900111222" && norm.company === "Acme");
  check("normalize: externalLeadId = leadgen_id (dedupe identity)", norm.externalLeadId === "lead-1");
  check("normalize: campaign/ad/form ids captured", norm.campaignId === "camp-9" && norm.adId === "ad-9" && norm.formId === "form-9");
  check("normalize: consent is NULL (never inferred)", norm.consentValue === null);
  check("normalize: arbitrary custom answer NOT present anywhere", !JSON.stringify(norm).includes("SECRET ANSWER"));
  check("normalize: no messageSummary field populated from custom answers", !norm.messageSummary);

  // ---- full ingest path: vault-credentialed fetch → contact ------------------------------------------------
  const A = await seed(`PG-${rnd()}`);
  await storeProviderCredential({ tenantId: A.tenantId, provider: PBusinessProvider.meta, purpose: ProviderCredentialPurpose.long_lived_token, connection: { connectedAccountId: A.accountId }, secret: "PAGE-TOKEN" });
  const r1 = await ingestMetaLeadgenChanges(parseMetaLeadgenChanges(leadgenBody(A.pageId, "lead-A1")), { fetchLead: fetcher(graphLead("lead-A1")) });
  check("ingest: accepted 1 lead", r1.ingested === 1 && r1.rejected === 0);
  const contact = await systemDb.businessContact.findFirst({ where: { tenantId: A.tenantId, externalLeadId: "lead-A1" } });
  check("ingest: BusinessContact created with normalized identity", !!contact && contact.email === "jane@lead.test" && contact.provider === "meta" && contact.sourcePlatform === "facebook");
  check("ingest: contact stores NO custom answer", !!contact && !JSON.stringify(contact).includes("SECRET ANSWER"));
  const ingestEvent = await systemDb.businessContactIngestionEvent.findFirst({ where: { tenantId: A.tenantId, providerEventId: "lead-A1" } });
  check("ingest: bounded ingestion event appended (payloadHash, no PII column)", !!ingestEvent && ingestEvent.result === "accepted" && !("email" in ingestEvent) && ingestEvent.signatureVerified === true);

  // ---- idempotent replay → duplicate (no 2nd contact) ------------------------------------------------------
  const r2 = await ingestMetaLeadgenChanges(parseMetaLeadgenChanges(leadgenBody(A.pageId, "lead-A1")), { fetchLead: fetcher(graphLead("lead-A1")) });
  check("ingest: replay → duplicate (no new contact)", r2.duplicates === 1 && r2.ingested === 0);
  check("ingest: still exactly ONE contact for that lead", (await systemDb.businessContact.count({ where: { tenantId: A.tenantId, externalLeadId: "lead-A1" } })) === 1);

  // ---- unmapped page → rejected (not this system's tenant) -------------------------------------------------
  const rUnmapped = await ingestMetaLeadgenChanges(parseMetaLeadgenChanges(leadgenBody("UNKNOWN-PAGE", "lead-x")), { fetchLead: fetcher(graphLead("lead-x")) });
  check("ingest: unmapped page → rejected, nothing stored", rUnmapped.rejected === 1 && rUnmapped.ingested === 0);

  // ---- missing credential → rejected -----------------------------------------------------------------------
  const B = await seed(`PG-${rnd()}`); // no vault credential stored
  const rNoCred = await ingestMetaLeadgenChanges(parseMetaLeadgenChanges(leadgenBody(B.pageId, "lead-B1")), { fetchLead: fetcher(graphLead("lead-B1")) });
  check("ingest: no credential → rejected (no fetch, no contact)", rNoCred.rejected === 1 && (await systemDb.businessContact.count({ where: { tenantId: B.tenantId } })) === 0);

  // ---- fetch failure → fetchFailure counter ----------------------------------------------------------------
  await storeProviderCredential({ tenantId: B.tenantId, provider: PBusinessProvider.meta, purpose: ProviderCredentialPurpose.long_lived_token, connection: { connectedAccountId: B.accountId }, secret: "PAGE-TOKEN-B" });
  const failFetch: MetaLeadFetcher = async () => { throw new Error("graph 500"); };
  const rFetchFail = await ingestMetaLeadgenChanges(parseMetaLeadgenChanges(leadgenBody(B.pageId, "lead-B2")), { fetchLead: failFetch });
  check("ingest: fetch failure → counted, no contact", rFetchFail.fetchFailures === 1 && (await systemDb.businessContact.count({ where: { tenantId: B.tenantId } })) === 0);

  // ---- FAIL-CLOSED: corrupt vault row → rejected, NEVER a legacy fetch --------------------------------------
  await systemDb.providerCredential.updateMany({ where: { tenantId: B.tenantId, connectedAccountId: B.accountId, revokedAt: null }, data: { authTag: Buffer.from("zzzzzzzzzzzzzzzz").toString("base64") } });
  let fetchCalled = false;
  const spyFetch: MetaLeadFetcher = async () => { fetchCalled = true; return graphLead("lead-B3"); };
  const rCorrupt = await ingestMetaLeadgenChanges(parseMetaLeadgenChanges(leadgenBody(B.pageId, "lead-B3")), { fetchLead: spyFetch });
  check("ingest: corrupt vault row → rejected (security failure)", rCorrupt.rejected === 1 && rCorrupt.ingested === 0);
  check("ingest: corrupt vault row → fetch NEVER attempted (no legacy fallback)", fetchCalled === false);
  const secEvent = await systemDb.businessContactIngestionEvent.findFirst({ where: { tenantId: B.tenantId, providerEventId: "lead-B3" } });
  check("ingest: security rejection recorded with a safe error code", secEvent?.result === "rejected" && secEvent?.errorCode === "vault_decrypt_failed");

  // ---- cleanup ---------------------------------------------------------------------------------------------
  await systemDb.tenant.deleteMany({ where: { id: { in: [A.tenantId, B.tenantId] } } });
}

main()
  .catch((e) => { console.error("✗ crashed:", (e as Error).stack ?? (e as Error).message); fail++; })
  .finally(async () => { await systemDb.$disconnect(); console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — meta lead ads ingestion: ${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1); });
