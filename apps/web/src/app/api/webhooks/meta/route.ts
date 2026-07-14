import { type NextRequest } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getMetaConfig } from "@guardora/config";
import { emitOpsEvent, metrics } from "@guardora/core";
import { Platform, recordWebhookEvent } from "@guardora/db";

/**
 * Route a Meta webhook `object` to the connector platform. `instagram` events flow
 * through the SAME unified connector as `page` events (V1.38). Unknown objects default
 * to facebook_page (the Meta ingestion table only holds Meta platforms here).
 */
function platformForObject(object: string | null): Platform {
  return object === "instagram" ? Platform.instagram_business : Platform.facebook_page;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Meta webhook verification (GET). Echoes hub.challenge only when hub.mode is
 * "subscribe" and hub.verify_token matches the configured token.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const mode = p.get("hub.mode");
  const token = p.get("hub.verify_token");
  const challenge = p.get("hub.challenge");

  const meta = getMetaConfig();
  if (
    mode === "subscribe" &&
    meta.webhookVerifyToken &&
    token === meta.webhookVerifyToken
  ) {
    return new Response(challenge ?? "", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }
  return new Response("Forbidden", { status: 403 });
}

/** Verify X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app secret). */
function verifySignature(
  rawBody: string,
  header: string | null,
  appSecret: string | undefined,
): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = header.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Receive Meta webhook events (POST). Stores the raw event for auditing with a
 * signatureValid flag. Takes NO automatic moderation action. Always ACKs 200 so
 * Meta does not retry indefinitely; invalid-signature events are stored but not
 * processed.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const meta = getMetaConfig();
  const sigHeader = req.headers.get("x-hub-signature-256");
  const signatureValid = verifySignature(raw, sigHeader, meta.appSecret);

  // V1.46/47 — observability: a forged/invalid signature is a security signal (stored but never
  // processed). Bounded ops event + metric; NO payload/signature/header/PII is emitted.
  metrics.inc("webhook_received_total", { platform: "facebook_page" });
  if (!signatureValid) {
    metrics.inc("webhook_invalid_signature_total");
    emitOpsEvent("webhook.signature_invalid", { operation: "webhook_ingest" });
  }

  let payload: unknown;
  let eventType: string | null = null;
  try {
    const parsed = JSON.parse(raw) as { object?: string };
    payload = parsed;
    eventType = parsed.object ?? null;
  } catch {
    payload = { unparsed: true };
  }

  // V1.38.1 — replay/dedup key: the signature over the raw body (identical redelivery →
  // identical key → the unique index rejects the replay). Fall back to a body hash when
  // unsigned, so identical unsigned replays still collapse to one row.
  const dedupeKey = sigHeader ?? `body:${createHash("sha256").update(raw).digest("hex")}`;

  // System ingestion into the GLOBAL webhook_events table (pre-tenant). The `object`
  // routes IG vs Page onto the SAME unified connector. The worker later resolves the
  // TRUSTED tenant per account (never from this payload) and processes under RLS. Only
  // signature-valid events are ever processed downstream.
  await recordWebhookEvent({
    platform: platformForObject(eventType),
    eventType,
    signatureValid,
    payload: payload as never,
    processed: false,
    dedupeKey,
  });

  return new Response("EVENT_RECEIVED", { status: 200 });
}
