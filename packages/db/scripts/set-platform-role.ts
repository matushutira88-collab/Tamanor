/**
 * V1.45A — OPERATIONAL bootstrap: assign or remove a GLOBAL platform role by exact email.
 *
 * This is the ONLY sanctioned way to grant platform access. It is invoked explicitly by an operator
 * with DB access; it is NEVER run automatically at startup and is NOT reachable via any HTTP route or
 * tenant UI. Idempotent. Supports removal (`--role none`). Prints only userId + email (operator-
 * supplied) + previous→current role — never a session token, password, or lead PII.
 *
 *   pnpm platform-role:set --email <email> --role <none|staff|admin> [--confirm]
 *
 * Without --confirm it is a dry run (no mutation).
 */
import { PlatformRole, setPlatformRoleByEmail, systemDb } from "../src/index";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Mask an email for output — email is PII. Keeps first char + domain: `a****@example.com`. */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "****";
  return `${email[0]}****${email.slice(at)}`;
}

async function main() {
  const email = arg("email");
  const roleRaw = arg("role");
  const confirm = process.argv.includes("--confirm");

  if (!email || !roleRaw) {
    console.error("Usage: pnpm platform-role:set --email <email> --role <none|staff|admin> [--confirm]");
    process.exit(2);
  }
  const validRoles = Object.values(PlatformRole) as string[];
  if (!validRoles.includes(roleRaw)) {
    console.error(`Invalid role "${roleRaw}". Valid roles: ${validRoles.join(", ")}`);
    process.exit(2);
  }
  const role = roleRaw as PlatformRole;

  // Email is PII — it is masked in ALL output. Successful changes report the resolved userId.
  if (!confirm) {
    console.log(`[dry-run] Would set platform role of ${maskEmail(email)} to "${role}". Re-run with --confirm to apply.`);
    await systemDb.$disconnect();
    process.exit(0);
  }

  const res = await setPlatformRoleByEmail(email, role);
  if (!res.ok) {
    console.error(`User not found for ${maskEmail(email)}. No change made.`);
    await systemDb.$disconnect();
    process.exit(1);
  }
  const noop = res.previous === res.current ? " (no change — idempotent)" : "";
  console.log(`Platform role updated: userId=${res.userId} email=${maskEmail(email)} "${res.previous}" -> "${res.current}"${noop}.`);
  await systemDb.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("Failed:", (e as Error).message);
  await systemDb.$disconnect();
  process.exit(1);
});
