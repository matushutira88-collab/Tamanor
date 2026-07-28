/**
 * Safety helpers for the standalone `production-app-role-align` workflow. It aligns the Postgres `tamanor_app`
 * role password to the password embedded in the production APP_DATABASE_URL (executed as the OWNER), then a CLI
 * verifies a real `tamanor_app` connection. Pure functions here are unit-tested; the CLIs add the DB I/O.
 *
 * NEVER prints a URL, password, or connection string. Performs NO migrations / db push / migrate resolve /
 * migrate reset / bootstrap — only a single `ALTER ROLE ... PASSWORD` (safe %I/%L escaping, password via bind
 * parameter) plus read-only verification.
 */
import { databaseHostFingerprint, ACCEPTED_ENVIRONMENT } from "./family-activation";

export { ACCEPTED_ENVIRONMENT };

/** The exact confirmation phrase that arms this workflow. */
export const ALIGN_CONFIRMATION_PHRASE = "ALIGN_PRODUCTION_APP_ROLE";
/** The ONLY role this workflow will ever touch. */
export const TARGET_ROLE = "tamanor_app";

/** Parse the ROLE (username) from a postgres URL, percent-decoded. Returns null if absent/unparseable. */
export function parseDbRole(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!u.username) return null;
    try { return decodeURIComponent(u.username); } catch { return u.username; }
  } catch { return null; }
}

/** Parse the PASSWORD from a postgres URL, percent-decoded. Callers MUST NEVER log the result. */
export function parseDbPassword(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!u.password) return null;
    try { return decodeURIComponent(u.password); } catch { return u.password; }
  } catch { return null; }
}

export type AlignInputs = { environment?: string; targetRole?: string; confirmation?: string };
/** Validate the three arming inputs. Only environment=production, target_role=tamanor_app, exact phrase pass. */
export function validateAlignInputs(input: AlignInputs): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (input.environment !== ACCEPTED_ENVIRONMENT) errors.push(`environment must be "${ACCEPTED_ENVIRONMENT}"`);
  if (input.targetRole !== TARGET_ROLE) errors.push(`target_role must be "${TARGET_ROLE}" (the only permitted role)`);
  if (input.confirmation !== ALIGN_CONFIRMATION_PHRASE) errors.push("confirmation must exactly equal the required phrase");
  return { ok: errors.length === 0, errors };
}

/**
 * Fail-closed evaluation of the owner + app targets BEFORE any ALTER ROLE. Both URLs are mandatory; the app URL
 * must be the `tamanor_app` role and the owner URL a DIFFERENT role; both must resolve to the SAME production
 * host (and match `expectedFingerprint` when supplied); the app URL must carry a parseable password. Returns only
 * NON-sensitive facts (role names, host fingerprint) — never a URL or password.
 */
export function evaluateAlignTargets(input: { ownerUrl?: string; appUrl?: string; expectedFingerprint?: string | null }): { ok: boolean; errors: string[]; fingerprint: string | null; ownerRole: string | null; appRole: string | null } {
  const errors: string[] = [];
  const ownerRole = parseDbRole(input.ownerUrl);
  const appRole = parseDbRole(input.appUrl);
  const ownerFp = databaseHostFingerprint(input.ownerUrl);
  const appFp = databaseHostFingerprint(input.appUrl);

  if (!input.ownerUrl) errors.push("DATABASE_URL (owner) is missing");
  if (!input.appUrl) errors.push("APP_DATABASE_URL is missing");
  if (input.ownerUrl && !ownerRole) errors.push("could not parse a role from DATABASE_URL");
  if (input.appUrl && !appRole) errors.push("could not parse a role from APP_DATABASE_URL");

  if (appRole && appRole !== TARGET_ROLE) errors.push(`APP_DATABASE_URL role must be "${TARGET_ROLE}" (it is the RLS-enforcing runtime role)`);
  if (ownerRole && appRole && ownerRole === appRole) errors.push("DATABASE_URL and APP_DATABASE_URL point to the SAME role — APP_DATABASE_URL must be the non-owner tamanor_app role");

  if (input.ownerUrl && input.appUrl) {
    if (!ownerFp || !appFp) errors.push("could not fingerprint one of the database hosts");
    else if (ownerFp !== appFp) errors.push("DATABASE_URL and APP_DATABASE_URL point to DIFFERENT hosts — refusing (must be the same production host/project)");
  }
  if (input.expectedFingerprint) {
    if (appFp && appFp !== input.expectedFingerprint) errors.push("APP_DATABASE_URL host fingerprint does not match the expected production fingerprint");
    if (ownerFp && ownerFp !== input.expectedFingerprint) errors.push("DATABASE_URL host fingerprint does not match the expected production fingerprint");
  }
  if (input.appUrl && !parseDbPassword(input.appUrl)) errors.push("APP_DATABASE_URL has no parseable password to align the role to");

  return { ok: errors.length === 0, errors, fingerprint: appFp ?? ownerFp, ownerRole, appRole };
}
