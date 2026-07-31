/**
 * RELEASE PROVENANCE V1 — a pure, deterministic resolver that turns an explicit environment object into
 * sanitized, immutable release metadata. It NEVER reads `process.env` itself (the caller passes `env`), NEVER
 * trusts client-supplied values, NEVER returns a credential-bearing URL, and NEVER dumps the environment.
 *
 * Precedence (deterministic): Vercel Git integration → approved-CI (only when explicitly armed) → local → unknown.
 * `provenanceValid` is true ONLY when a trusted source yields a full 40-char lowercase commit SHA that satisfies
 * the (optional) repository + branch policy. All failures are reported as stable, non-secret error codes.
 *
 * This is the single source of truth for "what commit is running" — consumed by the production build gate
 * (fail-closed) and an authenticated internal release route (read-only).
 */

export type ReleaseSource = "vercel_git" | "approved_ci" | "local" | "unknown";
export type ReleaseEnvironment = "production" | "preview" | "development" | "unknown";

/** Stable, non-secret validation error codes (safe to surface / log). */
export type ProvenanceErrorCode =
  | "sha_missing"        // production/preview but no commit SHA available
  | "sha_malformed"      // a SHA was provided but is not exactly 40 lowercase hex chars
  | "ref_malformed"      // a ref was provided but contains disallowed characters
  | "repo_mismatch"      // resolved owner/slug does not match the required repository
  | "ref_not_allowed"    // resolved branch/ref is not in the allow-list
  | "ci_marker_without_sha" // approved-CI arming marker set but no valid SHA supplied
  | "untrusted_source"   // production provenance requested from a non-trusted source
  | "preview_deployment"; // a preview deployment (informational; not necessarily fatal)

export interface ReleaseRepository { owner: string; slug: string }

export interface ReleaseMetadata {
  environment: ReleaseEnvironment;
  /** Full 40-char lowercase commit SHA, or null. Never a short/abbreviated SHA. */
  commitSha: string | null;
  /** Sanitized branch/ref (e.g. "main" or "refs/heads/main"), or null. */
  commitRef: string | null;
  repository: ReleaseRepository | null;
  /** Opaque deployment identifier (provider-scoped), or null. */
  deploymentId: string | null;
  /** Deployment HOSTNAME only — never a scheme, path, port, query, or credentials. */
  deploymentHost: string | null;
  source: ReleaseSource;
  provenanceValid: boolean;
  errors: ProvenanceErrorCode[];
}

export interface ProvenancePolicy {
  /** Required repository owner (case-insensitive compare), e.g. "acme-org". */
  expectedOwner?: string;
  /** Required repository slug (case-insensitive compare), e.g. "Tamanor". */
  expectedSlug?: string;
  /** Allowed branch/refs; matched against both "main" and "refs/heads/main" forms. */
  allowedRefs?: string[];
}

/** Minimal env shape — a plain string map (a subset of process.env), passed in explicitly. */
export type ProvenanceEnv = Record<string, string | undefined>;

const FULL_SHA = /^[0-9a-f]{40}$/;
const REF_OK = /^[A-Za-z0-9._/-]{1,255}$/;
const HOST_OK = /^[a-z0-9.-]{1,253}$/i;
const ID_OK = /^[A-Za-z0-9._-]{1,128}$/;
const OWNER_SLUG_OK = /^[A-Za-z0-9._-]{1,100}$/;

/** Full 40-char lowercase hex SHA, or null. A provided-but-malformed value returns null (caller flags it). */
export function normalizeCommitSha(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return FULL_SHA.test(s) ? s : null;
}

/** Sanitized ref, or null if absent/malformed. */
export function normalizeRef(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return s.length > 0 && REF_OK.test(s) ? s : null;
}

/** Extract a bare hostname from a value that may be a hostname or a URL. Never returns scheme/path/creds. */
export function normalizeDeploymentHost(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (s.length === 0) return null;
  // Strip scheme + credentials + path/query/fragment + port without constructing a URL (avoids throwing).
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  s = s.replace(/^[^@/]*@/, ""); // credentials
  s = s.split("/")[0]!.split("?")[0]!.split("#")[0]!;
  s = s.split(":")[0]!; // port
  s = s.trim().toLowerCase();
  return HOST_OK.test(s) ? s : null;
}

function normalizeId(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return s.length > 0 && ID_OK.test(s) ? s : null;
}

function normalizeOwnerSlug(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return s.length > 0 && OWNER_SLUG_OK.test(s) ? s : null;
}

/** Deterministic environment classification from an explicit env object. */
export function classifyEnvironment(env: ProvenanceEnv): ReleaseEnvironment {
  const vercel = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  if (vercel === "production") return "production";
  if (vercel === "preview") return "preview";
  if (vercel === "development") return "development";
  const node = (env.NODE_ENV ?? "").trim().toLowerCase();
  if (node === "production") return "production";
  if (node === "test" || node === "development") return "development";
  return "unknown";
}

function refAllowed(ref: string | null, allowed: string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true; // no policy → not enforced
  if (!ref) return false;
  const bare = ref.replace(/^refs\/heads\//, "");
  return allowed.some((a) => {
    const ab = a.replace(/^refs\/heads\//, "");
    return a === ref || ab === bare;
  });
}

/**
 * Resolve sanitized, immutable release metadata from an explicit env object under a deterministic precedence.
 * Trusted sources are `vercel_git` and `approved_ci` (the latter only when explicitly armed AND carrying a valid
 * full SHA). Client values are never consulted. Returns a frozen object.
 */
export function resolveReleaseMetadata(env: ProvenanceEnv, policy: ProvenancePolicy = {}): ReleaseMetadata {
  const environment = classifyEnvironment(env);
  const errors: ProvenanceErrorCode[] = [];

  // ---- Source detection (deterministic precedence) --------------------------------------------------------
  const hasVercelGit = typeof env.VERCEL_GIT_COMMIT_SHA === "string" && env.VERCEL_GIT_COMMIT_SHA.trim().length > 0;
  const ciArmed = (env.APPROVED_CI_RELEASE ?? "").trim().toLowerCase() === "true";

  let source: ReleaseSource;
  let rawSha: string | undefined;
  let rawRef: string | undefined;
  let owner: string | null = null;
  let slug: string | null = null;
  let deploymentId: string | null = null;
  let deploymentHost: string | null = null;

  if (hasVercelGit) {
    source = "vercel_git";
    rawSha = env.VERCEL_GIT_COMMIT_SHA;
    rawRef = env.VERCEL_GIT_COMMIT_REF;
    owner = normalizeOwnerSlug(env.VERCEL_GIT_REPO_OWNER);
    slug = normalizeOwnerSlug(env.VERCEL_GIT_REPO_SLUG);
    deploymentId = normalizeId(env.VERCEL_DEPLOYMENT_ID);
    deploymentHost = normalizeDeploymentHost(env.VERCEL_URL);
  } else if (ciArmed) {
    source = "approved_ci";
    rawSha = env.APPROVED_CI_COMMIT_SHA;
    rawRef = env.APPROVED_CI_COMMIT_REF;
    owner = normalizeOwnerSlug(env.APPROVED_CI_REPO_OWNER);
    slug = normalizeOwnerSlug(env.APPROVED_CI_REPO_SLUG);
    deploymentId = normalizeId(env.APPROVED_CI_RUN_ID);
    deploymentHost = normalizeDeploymentHost(env.APPROVED_CI_DEPLOYMENT_HOST);
  } else if (environment === "development" || environment === "unknown") {
    source = "local";
    rawSha = env.VERCEL_GIT_COMMIT_SHA; // typically absent locally
    rawRef = env.VERCEL_GIT_COMMIT_REF;
  } else {
    source = "unknown";
  }

  // ---- SHA / ref normalization + error codes ---------------------------------------------------------------
  const commitSha = normalizeCommitSha(rawSha);
  if (typeof rawSha === "string" && rawSha.trim().length > 0 && commitSha === null) errors.push("sha_malformed");

  const rawRefTrimmed = typeof rawRef === "string" ? rawRef.trim() : "";
  const commitRef = normalizeRef(rawRef);
  if (rawRefTrimmed.length > 0 && commitRef === null) errors.push("ref_malformed");

  if (source === "approved_ci" && commitSha === null && !errors.includes("sha_malformed")) {
    errors.push("ci_marker_without_sha");
  }

  const repository: ReleaseRepository | null = owner && slug ? { owner, slug } : null;

  // ---- Policy checks (only when a SHA exists from a trusted source) -----------------------------------------
  const trusted = source === "vercel_git" || source === "approved_ci";
  const needsSha = environment === "production" || environment === "preview";

  if (needsSha && commitSha === null && !errors.includes("sha_malformed") && !errors.includes("ci_marker_without_sha")) {
    errors.push("sha_missing");
  }
  if (needsSha && !trusted) errors.push("untrusted_source");
  if (environment === "preview") errors.push("preview_deployment");

  if (trusted && commitSha) {
    if (policy.expectedOwner || policy.expectedSlug) {
      // Check the normalized owner/slug locals directly (repository is null unless BOTH are present).
      const ownerOk = !policy.expectedOwner || (owner !== null && owner.toLowerCase() === policy.expectedOwner.toLowerCase());
      const slugOk = !policy.expectedSlug || (slug !== null && slug.toLowerCase() === policy.expectedSlug.toLowerCase());
      if (!ownerOk || !slugOk) errors.push("repo_mismatch");
    }
    if (!refAllowed(commitRef, policy.allowedRefs)) errors.push("ref_not_allowed");
  }

  // ---- provenanceValid: trusted source + valid full SHA + no BLOCKING policy error --------------------------
  const blocking = new Set<ProvenanceErrorCode>([
    "sha_missing", "sha_malformed", "ref_malformed", "repo_mismatch", "ref_not_allowed",
    "ci_marker_without_sha", "untrusted_source",
  ]);
  const provenanceValid = trusted && commitSha !== null && !errors.some((e) => blocking.has(e));

  return Object.freeze({
    environment,
    commitSha,
    commitRef,
    repository,
    deploymentId,
    deploymentHost,
    source,
    provenanceValid,
    errors,
  });
}
