/**
 * DB safety guard (S0). Refuses to run destructive/local DB commands
 * (migrate / migrate deploy / seed / push) against a REMOTE database. Only
 * localhost, 127.0.0.1, ::1, and single-label Docker hostnames (no dots, e.g. a
 * compose service name like `postgres` / `tamanor-local-pg`) are allowed.
 *
 * A remote host (any FQDN such as *.pooler.supabase.com) requires a conscious,
 * explicit override: TAMANOR_ALLOW_REMOTE_DB=1. Fail-closed: an unparseable or
 * missing URL for a checked variable is treated as unsafe.
 *
 * Pure module (no import side effects). The executable check lives in
 * `assert-local-db.cli.ts`, which package.json chains before prisma/seed.
 */

export const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);
export const OVERRIDE_ENV = "TAMANOR_ALLOW_REMOTE_DB";

/**
 * INCIDENT-01 — the exact local development target. The host-only check above was not
 * enough: it accepts any localhost URL, including a different port or database, so a
 * tunnel or a stray port-forward to a remote instance would still pass. `assertLocalTarget`
 * pins all three parts.
 */
export const EXPECTED_LOCAL = { hosts: ["localhost", "127.0.0.1"], port: "5433", database: "tamanor_reconciled" } as const;

/** Host / port / database of a Postgres URL, sanitized — never the user or password. */
export function describeTarget(url: string | undefined | null): { host: string; port: string; database: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return {
      host: u.hostname.toLowerCase().replace(/^\[|\]$/g, ""),
      port: u.port || "5432",
      database: u.pathname.replace(/^\//, "").split("?")[0] ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * Strict preflight for local dev / test / seed / destructive DB scripts: the target must be
 * EXACTLY localhost (or 127.0.0.1) : 5433 / tamanor_reconciled. Fail-closed — an unset or
 * unparseable URL is unsafe. Returns a sanitized description for the caller to print.
 */
export function assertLocalTarget(env: Record<string, string | undefined> = process.env): { host: string; port: string; database: string } {
  const t = describeTarget(env.DATABASE_URL);
  if (t === null) throw new Error("DATABASE_URL is missing or unparseable — refusing to run.");
  const ok = (EXPECTED_LOCAL.hosts as readonly string[]).includes(t.host)
    && t.port === EXPECTED_LOCAL.port
    && t.database === EXPECTED_LOCAL.database;
  if (!ok) {
    throw new Error(
      `Refusing to run against a non-local database.\n` +
        `  target   : ${t.host}:${t.port}/${t.database}\n` +
        `  expected : ${EXPECTED_LOCAL.hosts.join(" | ")}:${EXPECTED_LOCAL.port}/${EXPECTED_LOCAL.database}`,
    );
  }
  return t;
}

/** The lowercased hostname of a Postgres URL, or null if it cannot be parsed. */
export function hostOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    // Strip IPv6 brackets that URL.hostname keeps (e.g. "[::1]" → "::1").
    return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

/**
 * A host is "local" when it is an explicit loopback/docker alias, OR a
 * single-label hostname (no dots) — which a Docker network service name always
 * is, while a remote FQDN or public IP is not.
 */
export function isLocalHost(host: string | null): boolean {
  if (host === null) return false; // fail-closed: unknown host is not local
  if (LOCAL_HOSTS.has(host)) return true;
  return !host.includes("."); // single-label → docker service name
}

export type DbGuardResult = {
  ok: boolean;
  offending: { name: string; host: string | null; raw: boolean }[];
  overridden: boolean;
};

/**
 * Evaluate the guard against an env map. Checks DATABASE_URL and (when set)
 * APP_DATABASE_URL. `raw` marks a variable that is set but unparseable.
 */
export function evaluateDbGuard(env: Record<string, string | undefined>): DbGuardResult {
  const overridden = env[OVERRIDE_ENV] === "1" || env[OVERRIDE_ENV] === "true";
  const offending: DbGuardResult["offending"] = [];
  for (const name of ["DATABASE_URL", "APP_DATABASE_URL"]) {
    const val = env[name];
    if (val === undefined || val === "") continue; // not set → not this guard's concern
    const host = hostOf(val);
    if (!isLocalHost(host)) offending.push({ name, host, raw: host === null });
  }
  return { ok: offending.length === 0 || overridden, offending, overridden };
}

/** Throws with a clear message when the guard fails. */
export function assertLocalDb(env: Record<string, string | undefined> = process.env): DbGuardResult {
  const res = evaluateDbGuard(env);
  if (res.ok) {
    if (res.overridden && res.offending.length > 0) {
      console.warn(
        `⚠️  ${OVERRIDE_ENV} set — proceeding against REMOTE DB: ` +
          res.offending.map((o) => `${o.name}@${o.host ?? "?"}`).join(", "),
      );
    }
    return res;
  }
  const list = res.offending.map((o) => `  - ${o.name} → ${o.raw ? "(unparseable URL)" : o.host}`).join("\n");
  throw new Error(
    `Refusing to run a DB command against a NON-LOCAL database:\n${list}\n` +
      `Only localhost / 127.0.0.1 / ::1 / host.docker.internal / single-label Docker hosts are allowed.\n` +
      `Point DATABASE_URL/APP_DATABASE_URL at your local Postgres (see docker-compose.local.yml),\n` +
      `or, to consciously target a remote DB, re-run with ${OVERRIDE_ENV}=1.`,
  );
}
