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
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Family notifications source invariants: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
