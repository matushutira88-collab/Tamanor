/**
 * META LEAD ADS ingestion (server-only). The bridge between the EXISTING signature-verified Meta webhook ledger
 * (WebhookEvent) and the EXISTING business-contact store. Leadgen arrives as `object:"page"` with
 * `entry[].changes[].field === "leadgen"` + `changes[].value.leadgen_id`. This module:
 *   1) strictly parses the bounded leadgen envelope (no PII, no raw body retained);
 *   2) resolves the tenant-scoped facebook_page account from the TRUSTED page id (never the payload);
 *   3) fetches the lead detail via the official Meta Graph API using a VAULT credential (vault-first, fail-closed);
 *   4) normalizes an ALLOW-LIST of identity fields (never arbitrary form answers, never inferred consent);
 *   5) dedupes into BusinessContact + appends a bounded ingestion event (idempotent / replay-safe);
 *   6) emits only safe, low-cardinality ops events.
 *
 * Data minimization: only full name / email / phone / company + campaign/ad/form identifiers are stored. The raw
 * `field_data` answers, the raw Graph response, and the raw webhook body are NEVER persisted or logged.
 */
import { createHash } from "node:crypto";
import {
  ingestBusinessContact, recordBusinessIngestionEvent, resolveMetaAccessToken,
  findMetaLeadAccountsByPageIds, findBusinessConnectionForAccount, VaultDecryptError, VaultCredentialUnusableError,
  type BusinessContactInput,
} from "@guardora/db";
import { MetaGraphClient, MetaGraphError } from "@guardora/connectors";
import { emitOpsEvent, BusinessProvider, BusinessContactSource, BusinessIngestionResult } from "@guardora/core";

/** Max leadgen changes processed from a single webhook event (bounded fan-out). */
const MAX_LEADGEN_CHANGES = 200;
const str = (v: unknown, max = 512): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

/** A bounded leadgen change extracted from the trusted webhook body. */
export interface MetaLeadgenChange {
  pageId: string;
  leadgenId: string;
  formId: string | null;
  adId: string | null;
  createdTime: string | null;
}

/**
 * Strictly parse a Meta webhook body into leadgen changes. Only `object:"page"` bodies with
 * `changes[].field === "leadgen"` and a `leadgen_id` are returned; everything else is ignored. Bounded.
 */
export function parseMetaLeadgenChanges(payload: unknown): MetaLeadgenChange[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as { object?: unknown; entry?: unknown };
  if (body.object !== "page" || !Array.isArray(body.entry)) return [];
  const out: MetaLeadgenChange[] = [];
  for (const entry of body.entry) {
    if (out.length >= MAX_LEADGEN_CHANGES) break;
    const e = entry as { id?: unknown; changes?: unknown };
    const entryPageId = str(e.id, 64);
    if (!Array.isArray(e.changes)) continue;
    for (const change of e.changes) {
      if (out.length >= MAX_LEADGEN_CHANGES) break;
      const c = change as { field?: unknown; value?: unknown };
      if (c.field !== "leadgen" || !c.value || typeof c.value !== "object") continue;
      const v = c.value as Record<string, unknown>;
      const leadgenId = str(v.leadgen_id, 64);
      const pageId = str(v.page_id, 64) ?? entryPageId;
      if (!leadgenId || !pageId) continue;
      out.push({ pageId, leadgenId, formId: str(v.form_id, 64), adId: str(v.ad_id, 64), createdTime: str(v.created_time, 64) });
    }
  }
  return out;
}

/**
 * The allow-listed Graph lead detail shape (only fields we request/normalize).
 *
 * NOTE: `form_name` is deliberately ABSENT. The Meta Lead node exposes `form_id` but NOT `form_name`, so
 * requesting it made Graph reject the whole read with HTTP 400 / code 100 and no lead was ever fetched.
 */
export interface MetaGraphLead {
  id?: string;
  created_time?: string;
  ad_id?: string;
  ad_name?: string;
  form_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  field_data?: Array<{ name?: string; values?: string[] }>;
}

/** First value for an allow-listed field name (bounded). Never returns arbitrary/unknown-field content. */
function fieldValue(lead: MetaGraphLead, names: string[]): string | null {
  for (const fd of lead.field_data ?? []) {
    if (fd?.name && names.includes(fd.name.toLowerCase())) {
      const val = Array.isArray(fd.values) ? fd.values.find((x) => typeof x === "string" && x.length > 0) : null;
      if (val) return val.slice(0, 320);
    }
  }
  return null;
}

/** Normalize a fetched Graph lead → BusinessContactInput. ALLOW-LIST only; consent is NEVER inferred. */
export function normalizeMetaLead(lead: MetaGraphLead, change: MetaLeadgenChange, connectionId: string | null): BusinessContactInput {
  const first = fieldValue(lead, ["first_name"]);
  const last = fieldValue(lead, ["last_name"]);
  const fullName = fieldValue(lead, ["full_name"]) ?? ([first, last].filter(Boolean).join(" ").trim() || null);
  const received = change.createdTime ?? lead.created_time;
  const receivedAt = received ? new Date(received) : new Date();
  return {
    provider: BusinessProvider.Meta,
    sourcePlatform: BusinessContactSource.Facebook,
    connectionId,
    externalLeadId: change.leadgenId, // stable → the dedupe/idempotency identity
    fullName,
    email: fieldValue(lead, ["email"]),
    phone: fieldValue(lead, ["phone_number", "phone"]),
    company: fieldValue(lead, ["company_name", "company"]),
    // NO free-form message: arbitrary custom-question answers are intentionally NOT stored (data minimization).
    campaignId: str(lead.campaign_id, 200),
    campaignName: str(lead.campaign_name, 200),
    adId: str(lead.ad_id, 200) ?? change.adId,
    adName: str(lead.ad_name, 200),
    // formId stays fully ingested (Graph value first, then the trusted webhook change).
    formId: str(lead.form_id, 200) ?? change.formId,
    // The Meta Lead node exposes no form NAME, and the leadgen webhook change carries none either — so there is
    // no trusted source for it on this path. Stored as null rather than guessed or back-filled from an id.
    formName: null,
    receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
    // Consent captured ONLY if a real, explicit signal exists — Meta lead forms don't expose one here, so null.
    consentValue: null,
  };
}

/** Injectable lead fetcher (real = Meta Graph GET; tests inject a deterministic lead — no real HTTP). */
export type MetaLeadFetcher = (leadgenId: string, token: string) => Promise<MetaGraphLead>;

/**
 * The EXACT `fields` allow-list requested from `GET /{leadgen_id}`. Every entry must be a field the Meta Lead
 * node actually supports — Graph rejects the ENTIRE read with HTTP 400 / code 100 if any one of them is not,
 * so an unsupported entry silently costs every lead. `form_name` is intentionally excluded: the Lead node
 * exposes `form_id` only.
 */
export const META_LEAD_DETAIL_FIELDS: readonly string[] = [
  "id", "created_time", "field_data", "ad_id", "ad_name", "form_id", "campaign_id", "campaign_name",
];

export const graphLeadFetcher: MetaLeadFetcher = (leadgenId, token) =>
  new MetaGraphClient(token).get<MetaGraphLead>(leadgenId, {
    fields: META_LEAD_DETAIL_FIELDS.join(","),
  });

export interface MetaLeadgenIngestResult { ingested: number; duplicates: number; rejected: number; fetchFailures: number }

// ---- Lead-fetch failure classification (observability only) ------------------------------------------------
/**
 * The SAFE, classified shape of a failed lead-detail fetch. Every field here is provider-supplied failure
 * METADATA that is already carried on the typed {@link MetaGraphError} — nothing is derived from the request,
 * the response body, or the lead itself.
 *
 * DELIBERATELY ABSENT (never classified, never emitted): the error message, Meta's `message` text, the raw
 * response body, the access token, the app secret, the appsecret proof, the `leadgen_id`, and any tenant /
 * account / Page identifier or form/PII value.
 */
export interface MetaLeadFetchClassification {
  /** Stable failure kind from the typed Graph error; `unknown` for any non-Graph/untyped error. */
  reason: string;
  /** HTTP status Meta responded with, when the typed error carries one. */
  status?: number;
  /** Meta Graph error code (e.g. 100 = unsupported get request / object not visible to this token). */
  code?: number;
  /** Meta Graph error subcode. */
  subcode?: number;
  /** Whether the failure is transport-transient and therefore safe to retry. */
  transient?: boolean;
  /**
   * Meta support trace id. Token-free provider metadata; permitted by the SAME existing logging policy the
   * Meta OAuth callback diagnostics already apply to `fbtraceId`. Omitted when Meta did not supply one.
   */
  fbtraceId?: string;
}

/**
 * Classify a caught lead-fetch error into safe, low-detail fields. A typed {@link MetaGraphError} yields its
 * already-safe classification; ANY other error (including a plain `Error` whose message could contain
 * arbitrary text) collapses to `{ reason: "unknown" }` — the message is never read.
 */
export function classifyMetaLeadFetchError(err: unknown): MetaLeadFetchClassification {
  if (!(err instanceof MetaGraphError)) return { reason: "unknown" };
  const d = err.detail;
  return {
    reason: d.kind,
    status: d.status,
    // Only include the provider codes Meta actually supplied.
    ...(typeof d.code === "number" ? { code: d.code } : {}),
    ...(typeof d.subcode === "number" ? { subcode: d.subcode } : {}),
    transient: d.retryable,
    ...(d.fbtraceId ? { fbtraceId: d.fbtraceId } : {}),
  };
}

/**
 * Emit the EXISTING `business.meta_lead_fetch_failed` ops event, now carrying the safe classification above so a
 * production failure is diagnosable without a code change. Observability only — it changes no control flow.
 */
export function emitMetaLeadFetchFailed(err: unknown): void {
  emitOpsEvent("business.meta_lead_fetch_failed", { operation: "meta_leadgen", ...classifyMetaLeadFetchError(err) });
}

/**
 * Ingest all leadgen changes carried by ONE trusted webhook event. Resolves each change's page account from the
 * TRUSTED page id, fetches the lead via the vault credential, normalizes, and idempotently ingests. A per-lead
 * failure never aborts the batch. A `VaultDecryptError` (corrupt vault row) is a SECURITY failure — that lead is
 * rejected and NEVER fetched with a legacy token.
 */
export async function ingestMetaLeadgenChanges(changes: MetaLeadgenChange[], opts?: { fetchLead?: MetaLeadFetcher }): Promise<MetaLeadgenIngestResult> {
  const res: MetaLeadgenIngestResult = { ingested: 0, duplicates: 0, rejected: 0, fetchFailures: 0 };
  if (changes.length === 0) return res;
  const fetchLead = opts?.fetchLead ?? graphLeadFetcher;

  // Resolve the trusted page accounts once (tenant from the matched active account, never the payload).
  const pageIds = [...new Set(changes.map((c) => c.pageId))];
  const accounts = await findMetaLeadAccountsByPageIds(pageIds);
  const byPage = new Map(accounts.map((a) => [a.externalId, a]));

  for (const change of changes) {
    const account = byPage.get(change.pageId);
    if (!account) { res.rejected++; continue; } // unmapped page → not this system's tenant; ignore safely.
    const payloadHash = createHash("sha256").update(`meta:leadgen:${change.leadgenId}`).digest("hex");
    try {
      // Vault-first token (fail-closed on a corrupt vault row — never a legacy fallback there).
      const resolved = await resolveMetaAccessToken(account);
      if (!resolved) {
        await recordBusinessIngestionEvent(account.tenantId, { provider: BusinessProvider.Meta, providerEventId: change.leadgenId, payloadHash, signatureVerified: true, result: BusinessIngestionResult.Rejected, errorCode: "no_credential", receivedAt: new Date() });
        emitOpsEvent("business.meta_lead_rejected", { operation: "meta_leadgen", reason: "no_credential" });
        res.rejected++;
        continue;
      }
      let lead: MetaGraphLead;
      try {
        lead = await fetchLead(change.leadgenId, resolved.token);
      } catch (fetchErr) {
        // FAIL-CLOSED, UNCHANGED: the lead is still rejected with the same `fetch_failed` code, the batch still
        // continues, and nothing about the contact is persisted. The ONLY change is observability — the ops
        // event now carries the typed Graph error's safe classification instead of discarding it entirely.
        await recordBusinessIngestionEvent(account.tenantId, { provider: BusinessProvider.Meta, providerEventId: change.leadgenId, payloadHash, signatureVerified: true, result: BusinessIngestionResult.Rejected, errorCode: "fetch_failed", receivedAt: new Date() });
        emitMetaLeadFetchFailed(fetchErr);
        res.fetchFailures++;
        continue;
      }
      const connection = await findBusinessConnectionForAccount(account.tenantId, account.id);
      const contact = normalizeMetaLead(lead, change, connection?.id ?? null);
      const outcome = await ingestBusinessContact(account.tenantId, contact, { providerEventId: change.leadgenId, payloadHash, signatureVerified: true });
      if (outcome.result === BusinessIngestionResult.Accepted) { res.ingested++; emitOpsEvent("business.meta_lead_ingested", { operation: "meta_leadgen", result: "accepted" }); }
      else { res.duplicates++; emitOpsEvent("business.meta_lead_duplicate", { operation: "meta_leadgen", result: "duplicate" }); }
    } catch (e) {
      // A corrupt/revoked/expired vault row → reject this lead safely (never plaintext, never a legacy fetch).
      const errorCode = e instanceof VaultDecryptError ? "vault_decrypt_failed"
        : e instanceof VaultCredentialUnusableError ? `vault_${e.reason}` : "error";
      await recordBusinessIngestionEvent(account.tenantId, { provider: BusinessProvider.Meta, providerEventId: change.leadgenId, payloadHash, signatureVerified: true, result: BusinessIngestionResult.Rejected, errorCode, receivedAt: new Date() });
      emitOpsEvent("business.meta_lead_rejected", { operation: "meta_leadgen", reason: errorCode });
      res.rejected++;
    }
  }
  return res;
}
