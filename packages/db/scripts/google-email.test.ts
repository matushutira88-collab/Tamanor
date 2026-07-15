/**
 * V1.51B — Google Workspace / Gmail API transactional email transport.
 * Pure unit test (fetch mocked; NO network, NO real Google credentials). Run via: pnpm google-email:test
 */
import {
  GoogleEmailTransport, createEmailTransport, resolveEmailConfig, type EmailConfig,
  setOpsSink, resetOpsSink, type OpsEvent,
} from "@guardora/core";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const CFG: EmailConfig = {
  provider: "google", from: "no-reply@tamanor.com", replyTo: "support@tamanor.com",
  google: { clientId: "cid", clientSecret: "csecret", refreshToken: "r_refresh_secret" },
};
const MSG = { to: "user@example.com", subject: "Verify your Tamanor email", html: "<b>Hi</b>", text: "Hi", template: "verification", locale: "en" };

// --- fetch mock -------------------------------------------------------------
type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown };
let tokenCalls = 0, sendCalls = 0, lastSendBody: any = null;
const realFetch = globalThis.fetch;
function installFetch(handler: Handler) {
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token")) tokenCalls++;
    if (url.includes("gmail.googleapis.com")) { sendCalls++; lastSendBody = JSON.parse(String(init.body)); }
    const r = handler(url, init);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status });
  }) as never;
}
function resetCounters() { tokenCalls = 0; sendCalls = 0; lastSendBody = null; }
const okToken: Handler = (url, init) => url.includes("token") ? { status: 200, body: { access_token: "ya29.fake", expires_in: 3600 } } : { status: 200, body: { id: "m1" } };

async function run() {
  // 1) MIME construction — From locked, To/Reply-To/Subject present, multipart + base64 bodies.
  const t = new GoogleEmailTransport(CFG);
  const mime = t.buildMime("user@example.com", MSG as never);
  check("MIME: From is LOCKED to the configured sender", mime.includes("From: no-reply@tamanor.com"));
  check("MIME: To header present", mime.includes("To: user@example.com"));
  check("MIME: Reply-To header present", mime.includes("Reply-To: support@tamanor.com"));
  check("MIME: Subject is RFC2047 UTF-8 encoded-word", /Subject: =\?UTF-8\?B\?/.test(mime));
  check("MIME: multipart/alternative with text + html parts", mime.includes("multipart/alternative") && mime.includes("text/plain; charset=UTF-8") && mime.includes("text/html; charset=UTF-8"));
  check("MIME: bodies are base64 (text 'Hi' → SGk=)", mime.includes(Buffer.from("Hi").toString("base64")));

  // 2) Header-injection prevention — a CR/LF-laced subject cannot break out to a new header.
  const injected = t.buildMime("user@example.com", { ...MSG, subject: "Hi\r\nBcc: evil@x.com" } as never);
  const headerBlock = injected.split("\r\n\r\n")[0];
  check("header injection: no Bcc smuggled via Subject", !/Bcc:/i.test(headerBlock));

  // 3) Send happy-path → 200 ok, base64url raw (no +,/,=), token minted once then cached.
  resetCounters(); installFetch(okToken);
  const r1 = await t.send(MSG as never);
  check("send: 200 → ok", r1.ok === true);
  check("send: raw is base64url (no +, /, = )", typeof lastSendBody?.raw === "string" && !/[+/=]/.test(lastSendBody.raw));
  const r1b = await t.send(MSG as never);
  check("send: access token is CACHED (token endpoint hit once for two sends)", r1b.ok === true && tokenCalls === 1, `tokenCalls=${tokenCalls}`);

  // 4) Refresh-token exchange failure → refresh_failed (no send attempted).
  resetCounters();
  const t2 = new GoogleEmailTransport(CFG);
  installFetch((url) => url.includes("token") ? { status: 400, body: { error: "invalid_grant" } } : { status: 200, body: {} });
  const r2 = await t2.send(MSG as never);
  check("refresh failure → refresh_failed, no send", r2.ok === false && r2.reason === "refresh_failed" && sendCalls === 0);

  // 5) Transient 5xx then success → retried and ok.
  resetCounters();
  const t3 = new GoogleEmailTransport(CFG);
  let n = 0;
  installFetch((url) => url.includes("token") ? { status: 200, body: { access_token: "ya29.x", expires_in: 3600 } } : (++n === 1 ? { status: 503 } : { status: 200, body: { id: "m" } }));
  const r3 = await t3.send(MSG as never);
  check("transient 5xx → retried then ok", r3.ok === true && sendCalls === 2, `sendCalls=${sendCalls}`);

  // 6) Permanent 400 → delivery_failed, NOT retried.
  resetCounters();
  const t4 = new GoogleEmailTransport(CFG);
  installFetch((url) => url.includes("token") ? { status: 200, body: { access_token: "ya29.x", expires_in: 3600 } } : { status: 400, body: { error: "bad" } });
  const r4 = await t4.send(MSG as never);
  check("permanent 4xx → delivery_failed, NOT retried", r4.ok === false && r4.reason === "delivery_failed" && sendCalls === 1, `sendCalls=${sendCalls}`);

  // 7) 429 → rate_limited.
  resetCounters();
  const t5 = new GoogleEmailTransport(CFG);
  installFetch((url) => url.includes("token") ? { status: 200, body: { access_token: "ya29.x", expires_in: 3600 } } : { status: 429 });
  const r5 = await t5.send(MSG as never);
  check("429 → rate_limited", r5.ok === false && r5.reason === "rate_limited");

  // 8) Invalid configuration (no google creds) → invalid_config, no network.
  resetCounters();
  const t6 = new GoogleEmailTransport({ provider: "google", from: "no-reply@tamanor.com" });
  installFetch(okToken);
  const r6 = await t6.send(MSG as never);
  check("no credentials → invalid_config (no network)", r6.ok === false && r6.reason === "invalid_config" && tokenCalls === 0 && sendCalls === 0);

  // 9) Header-injection / malformed recipient → invalid_recipient, no network.
  resetCounters(); installFetch(okToken);
  const r7 = await t.send({ ...MSG, to: "user@example.com\r\nBcc: evil@x.com" } as never);
  check("recipient with CR/LF → invalid_recipient (rejected, no network)", r7.ok === false && r7.reason === "invalid_recipient" && sendCalls === 0);

  // 10) No secret leakage — captured ops events carry no token/recipient/body/URL.
  const events: { event: OpsEvent; meta: Record<string, unknown> }[] = [];
  setOpsSink({ emit: (event, meta) => events.push({ event, meta }) });
  resetCounters(); installFetch(okToken);
  await t.send(MSG as never);
  installFetch((url) => url.includes("token") ? { status: 400 } : { status: 200 });
  await new GoogleEmailTransport(CFG).send(MSG as never);
  resetOpsSink();
  const blob = JSON.stringify(events);
  check("ops events emitted (succeeded + refresh_failed)", events.some((e) => e.event === "email.send_succeeded") && events.some((e) => e.event === "email.refresh_failed"));
  check("no recipient / token / body / refresh secret in ops events", !blob.includes("user@example.com") && !blob.includes("ya29") && !blob.includes("r_refresh_secret") && !blob.includes("<b>Hi</b>"));
  check("ops events carry ONLY safe labels (template/locale/environment/reason/result)", events.every((e) => Object.keys(e.meta).every((k) => ["template", "locale", "environment", "reason", "result"].includes(k))));

  // 11) Provider selection — createEmailTransport maps 'google' → GoogleEmailTransport; missing creds → null.
  check("createEmailTransport('google' + creds) → google", createEmailTransport(CFG).name === "google");
  check("createEmailTransport('google' no creds) → null (truthful)", createEmailTransport({ provider: "google", from: "no-reply@tamanor.com" }).name === "null");
  check("resolveEmailConfig maps GOOGLE_EMAIL_SENDER as the From", resolveEmailConfig({ EMAIL_PROVIDER: "google", GOOGLE_EMAIL_SENDER: "no-reply@tamanor.com", GOOGLE_EMAIL_CLIENT_ID: "a", GOOGLE_EMAIL_CLIENT_SECRET: "b", GOOGLE_EMAIL_REFRESH_TOKEN: "c" })?.from === "no-reply@tamanor.com");

  globalThis.fetch = realFetch;
  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — Google Workspace / Gmail API transport (V1.51B)`);
  if (failures > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
