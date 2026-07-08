import { type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getMetaConfig } from "@guardora/config";
import { Platform } from "@guardora/db";
import { prisma } from "@/server/db";

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
  const signatureValid = verifySignature(
    raw,
    req.headers.get("x-hub-signature-256"),
    meta.appSecret,
  );

  let payload: unknown;
  let eventType: string | null = null;
  try {
    const parsed = JSON.parse(raw) as { object?: string };
    payload = parsed;
    eventType = parsed.object ?? null;
  } catch {
    payload = { unparsed: true };
  }

  await prisma.webhookEvent.create({
    data: {
      platform: Platform.facebook_page,
      eventType,
      signatureValid,
      payload: payload as never,
      processed: false,
    },
  });

  return new Response("EVENT_RECEIVED", { status: 200 });
}
