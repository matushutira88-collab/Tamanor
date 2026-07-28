/**
 * Align the production `tamanor_app` role password to APP_DATABASE_URL, then VERIFY a real `tamanor_app`
 * connection. Runs the ALTER as the OWNER (DATABASE_URL). NEVER prints a URL / password / connection string.
 * Performs NO migrations / db push / migrate resolve / migrate reset / bootstrap.
 *
 * The ALTER ROLE is built with Postgres `format('%I ... %L', role, password)` where the role and password are
 * passed as BIND PARAMETERS — %I safely quotes the identifier, %L safely quotes/escapes the literal, and the
 * password is never string-interpolated into SQL text or the shell.
 *
 * Env (never printed): DATABASE_URL, APP_DATABASE_URL, MIGRATE_ENVIRONMENT, ALIGN_TARGET_ROLE, ALIGN_CONFIRMATION,
 * PRODUCTION_DATABASE_HOST_FINGERPRINT (optional).
 */
import { PrismaClient } from "@prisma/client";
import { assertProductionTarget } from "./family-activation";
import { validateAlignInputs, evaluateAlignTargets, parseDbPassword, TARGET_ROLE } from "./production-app-role-align";
import { checkRlsRuntime } from "../src/tenant-db";
import { systemDb } from "../src/index";

async function main() {
  const env = process.env;

  // 1. Arming inputs + production owner-target guard + owner/app target evaluation (fail-closed; never prints URL).
  const inputs = validateAlignInputs({ environment: env.MIGRATE_ENVIRONMENT, targetRole: env.ALIGN_TARGET_ROLE, confirmation: env.ALIGN_CONFIRMATION });
  const ownerTarget = assertProductionTarget({ url: env.DATABASE_URL, environment: env.MIGRATE_ENVIRONMENT, expectedFingerprint: env.PRODUCTION_DATABASE_HOST_FINGERPRINT || null });
  const targets = evaluateAlignTargets({ ownerUrl: env.DATABASE_URL, appUrl: env.APP_DATABASE_URL, expectedFingerprint: env.PRODUCTION_DATABASE_HOST_FINGERPRINT || null });
  const armErrors = [...inputs.errors, ...ownerTarget.errors, ...targets.errors];
  if (armErrors.length) { console.error("✗ Refusing to align:\n" + armErrors.map((e) => `  - ${e}`).join("\n")); await systemDb.$disconnect(); process.exit(1); }
  console.log(`Target host fingerprint: ${targets.fingerprint ?? "n/a"} (URL never printed). owner role: ${targets.ownerRole}; app role: ${targets.appRole}.`);

  // 2. Parse the password (never logged) and ALTER ROLE via safe %I/%L bind parameters.
  const pw = parseDbPassword(env.APP_DATABASE_URL);
  if (!pw) { console.error("✗ Could not parse a password from APP_DATABASE_URL."); await systemDb.$disconnect(); process.exit(1); }
  const built = await systemDb.$queryRawUnsafe<Array<{ stmt: string }>>(
    `SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS stmt`,
    TARGET_ROLE, pw,
  );
  const stmt = built[0]?.stmt;
  if (!stmt) { console.error("✗ Failed to build the ALTER ROLE statement."); await systemDb.$disconnect(); process.exit(1); }
  await systemDb.$executeRawUnsafe(stmt);
  console.log(`✓ ALTER ROLE ${TARGET_ROLE} password aligned to APP_DATABASE_URL (statement + value never printed).`);

  // 3. Open a NEW Prisma client EXCLUSIVELY via APP_DATABASE_URL and verify a real tamanor_app connection.
  const appClient = new PrismaClient({ datasourceUrl: env.APP_DATABASE_URL, log: ["error"] });
  let currentUser: string | null = null;
  let selectOne: number | null = null;
  try {
    const who = await appClient.$queryRawUnsafe<Array<{ current_user: string }>>(`SELECT current_user`);
    currentUser = who[0]?.current_user ?? null;
    const one = await appClient.$queryRawUnsafe<Array<{ one: number }>>(`SELECT 1 AS one`);
    selectOne = Number(one[0]?.one ?? NaN);
  } catch (e) {
    // A P1000 (auth failed) lands here — report the CLASS without the URL/password.
    console.error(`✗ tamanor_app connection FAILED after align (${(e as Error)?.name ?? "unknown"}) — likely still an auth error (P1000).`);
    await appClient.$disconnect(); await systemDb.$disconnect(); process.exit(1);
  }

  // 4. RLS runtime health via the tamanor_app client (equivalent of assertRlsRuntime; structured, no secrets).
  const rls = await checkRlsRuntime(appClient);

  const currentUserMatches = currentUser === TARGET_ROLE;
  const selectOneOk = selectOne === 1;
  const rlsHealthy = rls.status === "healthy";
  const ok = currentUserMatches && selectOneOk && rlsHealthy;

  console.log(JSON.stringify({
    currentUser, currentUserMatches, selectOne, selectOneOk,
    rls: { status: rls.status, superuser: rls.superuser, bypassrls: rls.bypassrls, helperAvailable: rls.helperAvailable, criticalTableForced: rls.criticalTableForced },
  }, null, 2));

  await appClient.$disconnect();
  await systemDb.$disconnect();

  if (!ok) {
    console.error("✗ Post-align verification FAILED — tamanor_app connection or RLS runtime not healthy.");
    process.exit(1);
  }
  console.log("✓ tamanor_app connects (no P1000); current_user=tamanor_app; SELECT 1 ok; RLS runtime healthy.");
  process.exit(0);
}

main().catch(async (e) => { console.error("✗ Align failed:", (e as Error)?.name ?? "unknown"); try { await systemDb.$disconnect(); } catch { /* noop */ } process.exit(1); });
