/**
 * META LEAD DETAIL FIELD ALLOW-LIST — targeted regression tests for the confirmed production failure.
 *
 * `GET /{leadgen_id}` was requesting `form_name`, which the Meta Lead node does not expose. Graph rejects the
 * ENTIRE read with HTTP 400 / code 100 when any requested field is unsupported, so every lead failed to fetch
 * and no BusinessContact was ever inserted.
 *
 * These tests assert the EXACT field allow-list actually sent on the wire (fetch is mocked — no network, no
 * database, no Meta call), that `form_name` is excluded, that `formId` ingestion is preserved, that `formName`
 * is stored as null rather than guessed, and that the existing data-minimization / dedupe / no-secret-leak
 * behaviour of normalization is unchanged.
 */
import {
  META_LEAD_DETAIL_FIELDS, graphLeadFetcher, normalizeMetaLead, parseMetaLeadgenChanges,
  type MetaGraphLead,
} from "../src/meta-leads";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const TOKEN = "SECRET_PAGE_TOKEN_do_not_leak";
const LEADGEN_ID = "lead-1";

// ---- fetch mock: capture the outgoing URL, return a minimal valid lead ------------------------------------
let capturedUrl = "";
const originalFetch = globalThis.fetch;
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  capturedUrl = String(url);
  return {
    ok: true, status: 200, headers: new Headers(),
    json: async () => ({ id: LEADGEN_ID, form_id: "form-9" } as MetaGraphLead),
    text: async () => "{}",
  } as unknown as Response;
};

async function main() {
  console.log("\n1) the exact requested field allow-list");
  {
    await graphLeadFetcher(LEADGEN_ID, TOKEN);
    const fields = new URL(capturedUrl).searchParams.get("fields") ?? "";
    const requested = fields.split(",").filter(Boolean);

    check("1a) form_name is NOT requested (the HTTP 400 / code 100 cause)", !requested.includes("form_name"), fields);
    check("1b) exact allow-list sent on the wire",
      requested.join(",") === "id,created_time,field_data,ad_id,ad_name,form_id,campaign_id,campaign_name", fields);
    check("1c) the wire value matches the exported constant",
      requested.join(",") === META_LEAD_DETAIL_FIELDS.join(","));
    check("1d) form_id IS still requested (formId ingestion preserved)", requested.includes("form_id"));
    check("1e) field_data still requested (identity fields depend on it)", requested.includes("field_data"));
    check("1f) no duplicate or empty entries", new Set(requested).size === requested.length && requested.every((f) => f.trim() === f && f.length > 0));
    check("1g) constant carries no form_name", !META_LEAD_DETAIL_FIELDS.includes("form_name"));
  }

  console.log("\n2) exactly ONE Graph request is made");
  {
    let calls = 0;
    (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
      calls++; capturedUrl = String(url);
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ id: LEADGEN_ID }), text: async () => "{}" } as unknown as Response;
    };
    await graphLeadFetcher(LEADGEN_ID, TOKEN);
    check("2a) one fetch per lead — no second/lookup request added", calls === 1, `calls=${calls}`);
  }

  console.log("\n3) normalization: formId preserved, formName null");
  {
    const change = parseMetaLeadgenChanges({
      object: "page",
      entry: [{ id: "PAGE1", changes: [{ field: "leadgen", value: { leadgen_id: LEADGEN_ID, page_id: "PAGE1", form_id: "form-w", ad_id: "ad-w", created_time: "2026-06-01T10:00:00Z" } }] }],
    })[0]!;

    const lead: MetaGraphLead = {
      id: LEADGEN_ID, created_time: "2026-06-01T10:00:00Z", ad_id: "ad-9", ad_name: "Spring Ad",
      form_id: "form-9", campaign_id: "camp-9", campaign_name: "Spring",
      field_data: [
        { name: "full_name", values: ["Jane Doe"] }, { name: "email", values: ["jane@lead.test"] },
        { name: "what_is_your_budget", values: ["SECRET ANSWER - must not be stored"] },
      ],
    };
    const n = normalizeMetaLead(lead, change, null);
    check("3a) formId taken from the Graph lead", n.formId === "form-9");
    check("3b) formName is null (no trusted source — never guessed)", n.formName === null);
    check("3c) formName is NOT back-filled from the form id", n.formName !== "form-9" && n.formName !== "form-w");

    // Graph omitted form_id → fall back to the TRUSTED webhook change (unchanged behaviour).
    const n2 = normalizeMetaLead({ ...lead, form_id: undefined }, change, null);
    check("3d) formId falls back to the trusted webhook change", n2.formId === "form-w");
    check("3e) formName stays null on the fallback path too", n2.formName === null);
  }

  console.log("\n4) preserved: minimization, dedupe identity, consent, no leaks");
  {
    const change = parseMetaLeadgenChanges({
      object: "page",
      entry: [{ id: "PAGE1", changes: [{ field: "leadgen", value: { leadgen_id: LEADGEN_ID, page_id: "PAGE1" } }] }],
    })[0]!;
    const lead: MetaGraphLead = {
      id: LEADGEN_ID, campaign_id: "camp-9", campaign_name: "Spring",
      field_data: [
        { name: "full_name", values: ["Jane Doe"] }, { name: "email", values: ["jane@lead.test"] },
        { name: "phone_number", values: ["+421900111222"] }, { name: "company_name", values: ["Acme"] },
        { name: "what_is_your_budget", values: ["SECRET ANSWER - must not be stored"] },
      ],
    };
    const n = normalizeMetaLead(lead, change, null);
    check("4a) allow-listed identity fields still mapped",
      n.fullName === "Jane Doe" && n.email === "jane@lead.test" && n.phone === "+421900111222" && n.company === "Acme");
    check("4b) dedupe identity is still the leadgen id", n.externalLeadId === LEADGEN_ID);
    check("4c) consent still NEVER inferred", n.consentValue === null);
    check("4d) arbitrary custom answers still NOT stored", !JSON.stringify(n).includes("SECRET ANSWER"));
    check("4e) no free-form message summary populated", !n.messageSummary);
    check("4f) normalized output carries no token", !JSON.stringify(n).includes(TOKEN));
  }

  (globalThis as unknown as { fetch: unknown }).fetch = originalFetch;
  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — meta lead detail fields: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
