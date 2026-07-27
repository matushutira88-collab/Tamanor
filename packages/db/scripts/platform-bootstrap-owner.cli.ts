/**
 * Platform Admin V1 — bootstrap the initial PLATFORM_OWNER from TAMANOR_BOOTSTRAP_PLATFORM_OWNER_EMAIL.
 * Explicit, operator-invoked, idempotent. Reads the email ONLY from the env var (never hardcoded), requires
 * exactly one matching EXISTING user, and audits the assignment. Fails safely on no-env / no-user / ambiguous.
 * NEVER runs automatically at startup or via any HTTP route.
 *
 *   TAMANOR_BOOTSTRAP_PLATFORM_OWNER_EMAIL=info@tamanor.com pnpm platform:bootstrap-owner
 */
import { bootstrapPlatformOwnerFromEnv, systemDb } from "../src/index";

async function main() {
  const r = await bootstrapPlatformOwnerFromEnv();
  if (r.ok) console.log(`Bootstrap ok: userId=${r.userId} changed=${r.changed}`);
  else console.error(`Bootstrap not applied: ${r.reason}`);
  await systemDb.$disconnect();
  process.exit(r.ok ? 0 : 1);
}
main().catch(async (e) => { console.error("bootstrap failed:", (e as Error).message); await systemDb.$disconnect(); process.exit(1); });
