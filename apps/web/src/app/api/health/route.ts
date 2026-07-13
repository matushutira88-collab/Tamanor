/**
 * V1.39 — liveness probe. Confirms the process is up. No DB dependency, no secrets.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "healthy", service: "web" }, { status: 200 });
}
