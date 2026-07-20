/**
 * Tests for the local-DB safety guard. Pure — no DB, no network.
 * Run: pnpm --filter @guardora/db assert-local-db:test
 */
import { hostOf, isLocalHost, evaluateDbGuard, assertLocalDb, OVERRIDE_ENV } from "./assert-local-db";

let pass = 0,
  fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};

const LOCAL = "postgresql://postgres:postgres@localhost:5433/tamanor?schema=public";
const IP = "postgresql://postgres:postgres@127.0.0.1:5433/tamanor";
const V6 = "postgresql://postgres:postgres@[::1]:5432/tamanor";
const DOCKER = "postgresql://postgres:postgres@postgres:5432/tamanor"; // compose service name
const DOCKER2 = "postgresql://u:p@tamanor-local-pg:5432/tamanor";
const HOSTDOCKER = "postgresql://u:p@host.docker.internal:5432/tamanor";
const REMOTE = "postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
const REMOTE_IP = "postgresql://u:p@10.20.30.40:5432/db";

// hostOf
check("hostOf parses localhost", hostOf(LOCAL) === "localhost");
check("hostOf strips ipv6 brackets", hostOf(V6) === "::1");
check("hostOf remote fqdn", hostOf(REMOTE) === "aws-0-eu-central-1.pooler.supabase.com");
check("hostOf null on garbage", hostOf("not a url") === null);
check("hostOf null on undefined", hostOf(undefined) === null);

// isLocalHost
check("localhost is local", isLocalHost("localhost"));
check("127.0.0.1 is local", isLocalHost("127.0.0.1"));
check("::1 is local", isLocalHost("::1"));
check("host.docker.internal is local", isLocalHost("host.docker.internal"));
check("single-label docker name is local", isLocalHost("postgres"));
check("tamanor-local-pg is local", isLocalHost("tamanor-local-pg"));
check("supabase fqdn is NOT local", !isLocalHost("aws-0-eu-central-1.pooler.supabase.com"));
check("public IP (has dots) is NOT local", !isLocalHost("10.20.30.40"));
check("null host is NOT local (fail-closed)", !isLocalHost(null));

// evaluateDbGuard — local combos pass
for (const [name, url] of [["localhost", LOCAL], ["ip", IP], ["ipv6", V6], ["docker svc", DOCKER], ["docker name", DOCKER2], ["host.docker.internal", HOSTDOCKER]] as const) {
  check(`guard allows ${name}`, evaluateDbGuard({ DATABASE_URL: url }).ok);
}

// remote blocked
check("guard blocks remote DATABASE_URL", !evaluateDbGuard({ DATABASE_URL: REMOTE }).ok);
check("guard blocks remote IP", !evaluateDbGuard({ DATABASE_URL: REMOTE_IP }).ok);
check("guard blocks remote APP_DATABASE_URL even if DATABASE_URL local", !evaluateDbGuard({ DATABASE_URL: LOCAL, APP_DATABASE_URL: REMOTE }).ok);
check("offending names reported", evaluateDbGuard({ DATABASE_URL: REMOTE, APP_DATABASE_URL: REMOTE }).offending.length === 2);

// explicit override
const overridden = evaluateDbGuard({ DATABASE_URL: REMOTE, [OVERRIDE_ENV]: "1" });
check("override=1 allows remote", overridden.ok && overridden.overridden && overridden.offending.length === 1);
check("override=true allows remote", evaluateDbGuard({ DATABASE_URL: REMOTE, [OVERRIDE_ENV]: "true" }).ok);
check("override=0 does NOT allow remote", !evaluateDbGuard({ DATABASE_URL: REMOTE, [OVERRIDE_ENV]: "0" }).ok);

// empty/unset env → nothing to guard (prisma will error on its own)
check("no DB vars → ok (nothing to guard)", evaluateDbGuard({}).ok);
check("empty string DB var → ok (nothing to guard)", evaluateDbGuard({ DATABASE_URL: "" }).ok);

// assertLocalDb throws / doesn't throw
let threw = false;
try {
  assertLocalDb({ DATABASE_URL: REMOTE });
} catch {
  threw = true;
}
check("assertLocalDb throws on remote", threw);
let threw2 = false;
try {
  assertLocalDb({ DATABASE_URL: LOCAL });
} catch {
  threw2 = true;
}
check("assertLocalDb does not throw on local", !threw2);

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — local-DB safety guard: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
