/**
 * BUSINESS — Connected Platforms & Contacts V1 — DB/repository + adapter tests (local Postgres, RLS-enforced).
 * Proves: tenant isolation (RLS), idempotent dedupe, per-tenant isolation of the same external id, status
 * transition validity, safe handling of missing PII, consent-never-inferred, no raw-payload persistence, and the
 * deterministic adapter's signature/oversize/schema handling + end-to-end idempotent ingestion.
 */
import { PrismaClient } from "@prisma/client";
import {
  systemDb, ingestBusinessContact, listBusinessContacts, getBusinessContact, setBusinessContactStatus,
  assignBusinessContact, listBusinessConnections, upsertBusinessConnection, disconnectBusinessConnection,
  recordBusinessIngestionEvent, TEST_LEAD_ADAPTER, signTestLeadBody, MAX_LEAD_BODY_BYTES,
  type BusinessContactInput,
} from "../src/index";
import {
  BusinessProvider, BusinessContactSource, BusinessContactStatus, BusinessConnectionStatus,
  BusinessConnectionCapability, BusinessIngestionResult,
} from "@guardora/core";

const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error("✗ refusing to run against a non-local DB"); process.exit(1); }

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const rnd = () => Math.random().toString(36).slice(2, 10);
async function seedTenant(): Promise<{ tenantId: string; ownerUserId: string; otherUserId: string }> {
  const slug = `biz-${rnd()}`;
  const t = await systemDb.tenant.create({ data: { slug, name: slug, plan: "growth", workspaceKind: "business" } });
  const owner = await systemDb.user.create({ data: { email: `owner-${rnd()}@example.test`, passwordHash: "x", emailVerifiedAt: new Date() } });
  const other = await systemDb.user.create({ data: { email: `other-${rnd()}@example.test`, passwordHash: "x", emailVerifiedAt: new Date() } });
  await systemDb.membership.create({ data: { userId: owner.id, tenantId: t.id, role: "owner" } });
  await systemDb.membership.create({ data: { userId: other.id, tenantId: t.id, role: "admin" } });
  return { tenantId: t.id, ownerUserId: owner.id, otherUserId: other.id };
}

const fixture = (over: Partial<Record<string, unknown>> = {}) => JSON.stringify({
  leadId: "lead-123", fullName: "Jane Doe", email: "jane@lead.test", phone: "+421 900 111 222",
  company: "Acme", message: "Interested in a demo", campaignName: "Spring", formName: "Contact", receivedAt: "2026-05-01T10:00:00Z",
  ...over,
});
const SECRET = "test-secret-abc";

async function ingestFixture(tenantId: string, rawBody: string, sig: string): Promise<{ result: BusinessIngestionResult; contactId: string | null } | { rejected: string }> {
  const verified = TEST_LEAD_ADAPTER.verifySignature({ rawBody, headers: { "x-tamanor-test-signature": sig }, secret: SECRET });
  if (!verified) { await recordBusinessIngestionEvent(tenantId, { provider: BusinessProvider.Meta, payloadHash: "h", signatureVerified: false, result: BusinessIngestionResult.InvalidSignature, receivedAt: new Date() }); return { rejected: "invalid_signature" }; }
  const parsed = TEST_LEAD_ADAPTER.parse(rawBody);
  if (!parsed.ok) { await recordBusinessIngestionEvent(tenantId, { provider: BusinessProvider.Meta, payloadHash: "h", signatureVerified: true, result: parsed.reason, receivedAt: new Date() }); return { rejected: parsed.reason }; }
  const out = await ingestBusinessContact(tenantId, parsed.value.contact, { providerEventId: parsed.value.providerEventId, payloadHash: "hash-abc", signatureVerified: true });
  return { result: out.result, contactId: out.contactId };
}

async function main() {
  const A = await seedTenant();
  const B = await seedTenant();

  // ---- adapter: valid signed fixture accepted --------------------------------------------------------------
  const body = fixture();
  const sig = signTestLeadBody(body, SECRET);
  const r1 = await ingestFixture(A.tenantId, body, sig);
  check("adapter: valid signed fixture → accepted", "result" in r1 && r1.result === BusinessIngestionResult.Accepted, JSON.stringify(r1));
  const contactId = "result" in r1 ? r1.contactId! : "";

  // ---- idempotency: duplicate signed fixture → duplicate, no 2nd contact -----------------------------------
  const r2 = await ingestFixture(A.tenantId, body, sig);
  check("adapter: duplicate fixture → duplicate", "result" in r2 && r2.result === BusinessIngestionResult.Duplicate);
  const aCount = await systemDb.businessContact.count({ where: { tenantId: A.tenantId } });
  check("idempotency: duplicate did NOT create a 2nd contact", aCount === 1, `count=${aCount}`);

  // ---- same external id in a DIFFERENT tenant is isolated (both create their own) --------------------------
  const rB = await ingestFixture(B.tenantId, body, sig);
  check("cross-tenant: same external id creates a separate contact in tenant B", "result" in rB && rB.result === BusinessIngestionResult.Accepted);
  check("cross-tenant: tenant B has its own 1 contact", (await systemDb.businessContact.count({ where: { tenantId: B.tenantId } })) === 1);

  // ---- RLS: tenant A cannot read/update tenant B's contact -------------------------------------------------
  const bContactId = (await systemDb.businessContact.findFirstOrThrow({ where: { tenantId: B.tenantId } })).id;
  check("RLS: tenant A cannot READ tenant B contact", (await getBusinessContact(A.tenantId, bContactId)) === null);
  const upd = await setBusinessContactStatus(A.tenantId, bContactId, BusinessContactStatus.Handled);
  check("RLS: tenant A cannot UPDATE tenant B contact status", upd.ok === false && upd.reason === "not_found");
  const aList = await listBusinessContacts(A.tenantId, {});
  check("RLS: tenant A list shows only its own contact", aList.items.length === 1 && aList.items[0]!.id === contactId);

  // ---- status transitions ----------------------------------------------------------------------------------
  check("transition: new → contacted allowed", (await setBusinessContactStatus(A.tenantId, contactId, BusinessContactStatus.Contacted)).ok === true);
  check("transition: same status idempotent ok", (await setBusinessContactStatus(A.tenantId, contactId, BusinessContactStatus.Contacted)).ok === true);
  const bad = await setBusinessContactStatus(A.tenantId, contactId, "banana" as BusinessContactStatus);
  check("transition: invalid status value rejected", bad.ok === false);

  // ---- assignment (only a member of this tenant; cross-tenant/unknown rejected) ----------------------------
  check("assign: to own member ok", (await assignBusinessContact(A.tenantId, contactId, A.otherUserId)).ok === true);
  const crossAssign = await assignBusinessContact(A.tenantId, contactId, B.ownerUserId);
  check("assign: to a non-member (tenant B user) rejected", crossAssign.ok === false);
  check("assign: unassign (null) ok", (await assignBusinessContact(A.tenantId, contactId, null)).ok === true);

  // ---- missing PII + consent never inferred ----------------------------------------------------------------
  const minimalBody = JSON.stringify({ leadId: "min-1", receivedAt: "2026-05-02T00:00:00Z" });
  const rMin = await ingestFixture(A.tenantId, minimalBody, signTestLeadBody(minimalBody, SECRET));
  const minId = "result" in rMin ? rMin.contactId! : "";
  const minRow = await systemDb.businessContact.findFirstOrThrow({ where: { id: minId } });
  check("missing PII: email/phone/name are null (not empty strings)", minRow.email === null && minRow.phone === null && minRow.fullName === null);
  check("consent: absent consent stays null (never inferred as granted)", minRow.consentValue === null);
  // consent supplied → stored as given
  const consentBody = fixture({ leadId: "c-1", consent: true, consentVersion: "v2" });
  await ingestFixture(A.tenantId, consentBody, signTestLeadBody(consentBody, SECRET));
  const cRow = await systemDb.businessContact.findFirstOrThrow({ where: { tenantId: A.tenantId, externalLeadId: "c-1" } });
  check("consent: supplied consent stored as given", cRow.consentValue === true && cRow.consentVersion === "v2");

  // ---- raw payload NOT persisted (structural: ingestion event has payloadHash, no body/PII columns) --------
  const ev = await systemDb.businessContactIngestionEvent.findFirst({ where: { tenantId: A.tenantId, result: "accepted" } });
  check("no raw payload: ingestion event stores payloadHash + result only (no payload/email columns)",
    !!ev && !("payload" in ev) && !("email" in ev) && typeof ev.payloadHash === "string");

  // ---- adapter negative paths ------------------------------------------------------------------------------
  check("adapter: MISSING signature rejected", TEST_LEAD_ADAPTER.verifySignature({ rawBody: body, headers: {}, secret: SECRET }) === false);
  check("adapter: WRONG signature rejected", TEST_LEAD_ADAPTER.verifySignature({ rawBody: body, headers: { "x-tamanor-test-signature": "sha256=deadbeef" }, secret: SECRET }) === false);
  check("adapter: tampered body fails verification", TEST_LEAD_ADAPTER.verifySignature({ rawBody: body + " ", headers: { "x-tamanor-test-signature": sig }, secret: SECRET }) === false);
  const oversized = JSON.stringify({ leadId: "big", message: "x".repeat(MAX_LEAD_BODY_BYTES + 10) });
  check("adapter: oversized payload rejected", TEST_LEAD_ADAPTER.parse(oversized).ok === false);
  check("adapter: invalid JSON rejected", TEST_LEAD_ADAPTER.parse("{not json").ok === false);
  check("adapter: empty-identity payload rejected (no id/fingerprint/email)", TEST_LEAD_ADAPTER.parse(JSON.stringify({ fullName: "x", receivedAt: "2026-05-01T00:00:00Z" })).ok === false);

  // ---- connections: RLS + lifecycle ------------------------------------------------------------------------
  await upsertBusinessConnection(A.tenantId, { provider: BusinessProvider.Meta, status: BusinessConnectionStatus.Pending, capabilities: [BusinessConnectionCapability.LeadIngestion] });
  check("connection: tenant A sees its 1 connection", (await listBusinessConnections(A.tenantId)).length === 1);
  check("connection: tenant B does NOT see tenant A's connection (RLS)", (await listBusinessConnections(B.tenantId)).length === 0);
  check("connection: disconnect sets disconnected", (await disconnectBusinessConnection(A.tenantId, BusinessProvider.Meta)) === true);
  const aConn = (await listBusinessConnections(A.tenantId))[0]!;
  check("connection: status is now disconnected", aConn.status === BusinessConnectionStatus.Disconnected);
  // no token/secret fields ever exposed by the repo row shape
  check("connection: row exposes NO token/secret field", !("accessToken" in aConn) && !("refreshToken" in aConn) && !("secret" in aConn));

  // ---- cleanup (cascade) -----------------------------------------------------------------------------------
  await systemDb.tenant.deleteMany({ where: { id: { in: [A.tenantId, B.tenantId] } } });
  await systemDb.user.deleteMany({ where: { id: { in: [A.ownerUserId, A.otherUserId, B.ownerUserId, B.otherUserId] } } });
}

main()
  .catch((e) => { console.error("✗ test crashed:", (e as Error).message); fail++; })
  .finally(async () => {
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — business contacts & platforms (V1): ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
