/**
 * FAMILY NOTIFICATIONS V1 — Phase 2 static/source security invariants. Proves the persistence layer uses ONLY
 * the strict metadata builder, never null userId, never an "all members" or email-based resolver, has a
 * transaction-aware + transaction-safe-conflict API, no hard delete, and that NO live child-safety trigger,
 * UI route, or push/email/SMS/webhook was added in this phase. Run: pnpm family-notifications-source:test
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

const repoSrc = read("packages/db/src/family-notification-repo.ts");

function main() {
  console.log("\n1. persistence uses ONLY the strict Family metadata path");
  check("★ builds via buildFamilyNotificationMetadata + asserts via assertFamilyNotificationMetadata", /buildFamilyNotificationMetadata/.test(repoSrc) && /assertFamilyNotificationMetadata/.test(repoSrc));
  check("★ never uses the soft generic sanitizeNotificationMetadata for Family persistence", !/sanitizeNotificationMetadata/.test(repoSrc));

  console.log("\n2. recipient integrity");
  check("★ recipient userId is always non-null (rejects null/blank)", /userId: recipientUserId/.test(repoSrc) && /null_or_blank_recipient/.test(repoSrc));
  check("★ NO 'all members' resolver / shortcut", !/allTenantMembers|allMembers|everyMember|tenantWideFamily/i.test(repoSrc));
  // "email" may appear ONLY inside the FORBIDDEN_KEY privacy guard (which REJECTS email keys) — never as a
  // recipient lookup. Assert no email usage outside that guard, and no where:{email} / by-email resolution.
  const emailOutsideGuard = repoSrc.split("\n").filter((l) => /email/i.test(l) && !/FORBIDDEN_KEY|forbidden|reject|privacy/i.test(l) && !/^\s*(\*|\/\/)/.test(l));
  check("★ NO email-based recipient resolution (email only in the reject-list guard)", emailOutsideGuard.length === 0 && !/where:\s*\{[^}]*email/i.test(repoSrc), emailOutsideGuard.join(" | "));
  check("★ no raw role-only shortcut standing in for the child-safety chain (persistence takes RESOLVED ids)", /recipientUserIds/.test(repoSrc));

  console.log("\n3. transaction-aware + transaction-safe conflict handling");
  check("★ transaction-aware creation API createFamilyNotificationTx(tx, …)", /export async function createFamilyNotificationTx\(tx: TenantTx/.test(repoSrc));
  check("★ idempotency via createMany skipDuplicates (no caught P2002 inside an open tx)", /createMany\(\{ data: rows, skipDuplicates: true \}\)/.test(repoSrc) && !/P2002/.test(repoSrc));

  console.log("\n4. no hard delete");
  check("★ no .delete( / .deleteMany( on notifications in the Family repo (soft dismiss only)", !/notification\.delete(Many)?\(/.test(repoSrc) && /dismissedAt: now/.test(repoSrc));

  console.log("\n5. no UI route / GET mutation / bell added in Phase 2");
  check("★ /family/notifications route does NOT exist yet", !existsSync(join(REPO, "apps/web/src/app/family/notifications")));
  check("★ no e2e/UI/server-action wiring added for Family notifications this phase", !existsSync(join(REPO, "apps/web/src/app/family/notifications/actions.ts")));

  console.log("\n6. no live child-safety trigger integration yet");
  const csDir = join(REPO, "packages/db/src");
  const csFiles = readdirSync(csDir).filter((f) => /^child-safety-|^family-invitation/.test(f) && f.endsWith(".ts"));
  const wired = csFiles.filter((f) => /createFamilyNotification/.test(read(`packages/db/src/${f}`)));
  check("★ NO child-safety / invitation module calls createFamilyNotification yet (triggers are Phase 3)", wired.length === 0, `wired: ${wired.join(",")}`);

  console.log("\n7. no push / email / SMS / webhook implementation");
  check("★ Family notification repo contains no push/SMS/webhook/email delivery", !/sendEmail|sendSms|webhook|fcm|apns|pushNotification|twilio/i.test(repoSrc));

  console.log("\n8. Business notification files untouched (only additive shared reuse)");
  const bizRepo = read("packages/db/src/notification-repo.ts");
  check("★ generic notification-repo has no Family-specific logic injected", !/family_signal_available|resolveFamilyNotificationRecipients|FAMILY_NOTIFICATION/.test(bizRepo));

  console.log("\n9. Phase 2b-A internal authorization kernel — boundary invariants");
  const kernel = read("packages/db/src/internal/family-notification-authorization.ts");
  const dbIndex = read("packages/db/src/index.ts");
  check("★ internal kernel is NOT exported from the @guardora/db barrel", !/internal\/family-notification-authorization/.test(dbIndex));
  // No PRODUCTION file (outside the kernel + its tests) imports the internal kernel path.
  const allTs = [...readdirSync(join(REPO, "packages/db/src")).filter((f) => f.endsWith(".ts")).map((f) => `packages/db/src/${f}`),
    ...readdirSync(join(REPO, "apps/web/src/app/family")).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx")).map((f) => `apps/web/src/app/family/${f}`)];
  const importers = allTs.filter((p) => { try { return /from\s+["'][^"']*internal\/family-notification-authorization/.test(read(p)); } catch { return false; } });
  check("★ no production/domain module imports the internal kernel", importers.length === 0, importers.join(","));
  check("★ low-level persistence primitive is marked @internal", /@internal[^]*createFamilyNotificationTx/.test(repoSrc));
  check("★ high-level authorized service resolves recipients via resolveFamilyNotificationRecipientsTx", /createAuthorizedFamilyNotificationTx[^]*resolveFamilyNotificationRecipientsTx/.test(kernel));
  check("★ kernel has NO 'all members' or tenant-wide recipient path", !/allMembers|everyMember|allTenantMembers|tenantWide/i.test(kernel));
  check("★ kernel has NO email-based recipient lookup", !/where:\s*\{[^}]*email/i.test(kernel) && !/byEmail|matchEmail/i.test(kernel));
  check("★ kernel composes canonical evaluators (getEffectiveRecipientAuthorization / evaluateSafetySignalDeliveryEligibility)", /getEffectiveRecipientAuthorization/.test(kernel) && /evaluateSafetySignalDeliveryEligibility/.test(kernel));
  check("★ kernel supports ONLY the 3 Phase 2b-A types (others fail closed)", /unsupported_type/.test(kernel) && !/family_incident_created|family_guardian_invitation|family_authority_changed|family_protection_plan/.test(kernel));
  check("★ no live trigger wired (no child-safety module imports the kernel)", csFiles.every((f) => !/internal\/family-notification-authorization/.test(read(`packages/db/src/${f}`))));

  console.log("\n10. provisioning alignment — set-app-role-password CS revokes stay in sync with migrations");
  const prov = read("packages/db/scripts/set-app-role-password.ts");
  const provRevokeAll = new Set([...prov.matchAll(/"(child_safety_[a-z_]+)"/g)].map((m) => m[1]));
  const migRevokeAll = new Set([...readMigrationsFor(/REVOKE ALL PRIVILEGES ON TABLE "(child_safety_[a-z_]+)" FROM tamanor_app/g)]);
  const missing = [...migRevokeAll].filter((t) => !provRevokeAll.has(t));
  check("★ every migration REVOKE-ALL child_safety_* table is re-asserted by the provisioning script", missing.length === 0, `missing: ${missing.join(",")}`);
  check("★ provisioning re-asserts DELETE,TRUNCATE revokes on the soft-delete safety tables", /REVOKE DELETE, TRUNCATE/.test(prov) && /safety_signal_deliveries/.test(prov) && /safety_recipient_authorization_decisions/.test(prov));
}

function readMigrationsFor(re: RegExp): string[] {
  const dir = join(REPO, "packages/db/prisma/migrations");
  const out: string[] = [];
  for (const d of readdirSync(dir)) {
    const p = join(dir, d, "migration.sql");
    if (!existsSync(p)) continue;
    for (const m of readFileSync(p, "utf8").matchAll(re)) out.push(m[1]!);
  }
  return out;
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Family notifications source invariants: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
