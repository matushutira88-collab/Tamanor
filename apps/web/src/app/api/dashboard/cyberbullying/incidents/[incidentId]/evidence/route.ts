import { NextResponse, type NextRequest } from "next/server";
import { getTenantEntitlements, uploadAndAttachIncidentEvidence, EvidenceUploadError, type EvidenceFileUpload } from "@guardora/db";
import { hasEntitlement, EVIDENCE_REQUEST_HARD_CAP_BYTES, EVIDENCE_MAX_FILES } from "@guardora/core";
import { getSession } from "@/server/auth";
import { canUploadEvidence } from "@/server/cyberbullying-evidence";
import { isSameOrigin } from "@/server/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * C7 — authenticated, same-origin, size-capped LOCAL evidence upload endpoint. A
 * dedicated route handler (not a Server Action) so the large-multipart-body
 * allowance stays scoped to this one endpoint. The heavy lifting — validation,
 * local storage, hashing, AV, evidence + custody + C3 link + audit, atomic
 * rollback with compensating cleanup — is in @guardora/db. This layer only
 * authenticates, enforces the request cap, parses files, and maps the safe result
 * to JSON. It never returns a path/hash/storageKey/stack.
 */

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ incidentId: string }> }): Promise<NextResponse> {
  // Hard request-size cap BEFORE reading the body.
  const len = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > EVIDENCE_REQUEST_HARD_CAP_BYTES) return json({ ok: false, error: "total_size" }, 413);

  // Same-origin only (CSRF): the browser form/fetch must originate from this app.
  if (!(await isSameOrigin())) return json({ ok: false, error: "denied" }, 403);

  // Session (non-redirecting) + verified email.
  const session = await getSession();
  if (!session || !session.emailVerified) return json({ ok: false, error: "denied" }, 401);

  // Entitlement (plan) — locked plans cannot upload.
  const ent = await getTenantEntitlements(session.tenantId);
  if (!hasEntitlement(ent, "cyberbullyingProtection")) return json({ ok: false, error: "locked" }, 403);

  // Permission (review). UI hides the CTA; this is the fail-closed backstop.
  if (!canUploadEvidence(session.role)) return json({ ok: false, error: "denied" }, 403);

  const { incidentId } = await ctx.params;

  // Parse multipart. Malformed body ⇒ safe generic error.
  let form: FormData;
  try { form = await req.formData(); } catch { return json({ ok: false, error: "malformed" }, 400); }

  const entries = form.getAll("file").filter((v): v is File => v instanceof File);
  if (entries.length === 0) return json({ ok: false, error: "malformed" }, 400);
  if (entries.length > EVIDENCE_MAX_FILES) return json({ ok: false, error: "too_many" }, 400);

  let files: EvidenceFileUpload[];
  try {
    files = await Promise.all(entries.map(async (f) => ({
      filename: f.name,
      declaredMime: f.type,
      bytes: new Uint8Array(await f.arrayBuffer()),
    })));
  } catch {
    return json({ ok: false, error: "malformed" }, 400);
  }

  const actor = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  try {
    const result = await uploadAndAttachIncidentEvidence(actor, incidentId, files);
    return json({ ok: true, created: result.created, duplicates: result.duplicates }, 200);
  } catch (e) {
    if (e instanceof EvidenceUploadError) {
      const f = e.failure;
      switch (f.code) {
        case "forbidden": return json({ ok: false, error: "denied" }, 403);
        case "not_found": return json({ ok: false, error: "not_found" }, 404);
        case "invalid_status": return json({ ok: false, error: "invalid_status" }, 409);
        case "batch": return json({ ok: false, error: f.batchError }, 400);
        case "validation": return json({ ok: false, error: "validation", fileErrors: f.fileErrors }, 422);
        case "scan": return json({ ok: false, error: "scan", fileErrors: f.fileErrors }, 422);
        default: return json({ ok: false, error: "error" }, 500); // storage / hash — never leak details
      }
    }
    return json({ ok: false, error: "error" }, 500);
  }
}
