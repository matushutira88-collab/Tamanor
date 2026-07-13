/**
 * V1.38.3 — IndexNow key file. Serves the IndexNow key from the INDEXNOW_KEY
 * environment variable at a fixed location, referenced as `keyLocation` in the
 * submission payload (protocol-compliant). Returns 404 until a key is configured,
 * so nothing fake is ever served.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const key = (process.env.INDEXNOW_KEY ?? "").trim();
  if (!key) {
    return new Response("IndexNow key not configured", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(`${key}\n`, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" },
  });
}
