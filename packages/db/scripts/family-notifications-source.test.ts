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

  console.log("\n6. child-safety modules never CREATE notifications directly (they only enqueue; the processor creates)");
  const csDir = join(REPO, "packages/db/src");
  const csFiles = readdirSync(csDir).filter((f) => /^child-safety-|^family-invitation/.test(f) && f.endsWith(".ts"));
  // Phase 3A wires the delivery→available ENQUEUE, but a child-safety module must never CALL a create-notification
  // entry point itself — the trusted processor does that. Match actual calls (with a paren), not comment mentions.
  const wired = csFiles.filter((f) => /createFamilyNotification\w*\(/.test(read(`packages/db/src/${f}`)));
  check("★ NO child-safety / invitation module CALLS a create-notification entry point (only the processor does)", wired.length === 0, `wired: ${wired.join(",")}`);

  console.log("\n7. no push / email / SMS / webhook implementation");
  check("★ Family notification repo contains no push/SMS/webhook/email delivery", !/sendEmail|sendSms|webhook|fcm|apns|pushNotification|twilio/i.test(repoSrc));

  console.log("\n8. Business notification files untouched (only additive shared reuse)");
  const bizRepo = read("packages/db/src/notification-repo.ts");
  check("★ generic notification-repo has no Family-specific logic injected", !/family_signal_available|resolveFamilyNotificationRecipients|FAMILY_NOTIFICATION/.test(bizRepo));

  console.log("\n9. Phase 2b-A internal authorization kernel — boundary invariants");
  const kernel = read("packages/db/src/internal/family-notification-authorization.ts");
  const visibility = read("packages/db/src/internal/family-incident-visibility.ts");
  // Strip comments before scanning for role-capability CODE shortcuts — a doc comment that merely NAMES what we
  // forbid (e.g. "manager/owner/reviewer role alone is never enough") must not trip the guard.
  const stripComments = (s: string) => s.replace(/\/\*[^]*?\*\//g, "").replace(/\/\/.*/g, "");
  const visibilityCode = stripComments(visibility);
  const dbIndex = read("packages/db/src/index.ts");
  check("★ barrel exports ONLY the high-level authorized service; resolver + visibility authority stay internal", /createAuthorizedFamilyNotification/.test(dbIndex) && !/export.*resolveFamilyNotificationRecipientsTx/.test(dbIndex) && !/family-incident-visibility/.test(dbIndex.replace(/\/\/.*/g, "")));
  // No PRODUCTION file (outside the kernel + its tests) imports the internal kernel path. index.ts is the barrel
  // itself — it re-exports ONLY the high-level authorized service (asserted separately above), so exclude it here.
  const allTs = [...readdirSync(join(REPO, "packages/db/src")).filter((f) => f.endsWith(".ts") && f !== "index.ts").map((f) => `packages/db/src/${f}`),
    ...readdirSync(join(REPO, "apps/web/src/app/family")).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx")).map((f) => `apps/web/src/app/family/${f}`)];
  const internalRe = /from\s+["'][^"']*internal\/family-(notification-authorization|incident-visibility)/;
  const importers = allTs.filter((p) => { try { return internalRe.test(read(p)); } catch { return false; } });
  check("★ no production/domain module imports the internal kernel or visibility authority", importers.length === 0, importers.join(","));
  check("★ low-level persistence primitive is marked @internal", /@internal[^]*createFamilyNotificationTx/.test(repoSrc));
  check("★ high-level authorized service resolves recipients via resolveFamilyNotificationRecipientsTx", /createAuthorizedFamilyNotificationTx[^]*resolveFamilyNotificationRecipientsTx/.test(kernel));
  check("★ kernel has NO 'all members' or tenant-wide recipient path", !/allMembers|everyMember|allTenantMembers|tenantWide/i.test(kernel) && !/allMembers|everyMember/i.test(visibility));
  check("★ kernel/visibility have NO email-based recipient lookup", !/where:\s*\{[^}]*email/i.test(kernel) && !/where:\s*\{[^}]*email/i.test(visibility));
  check("★ kernel composes canonical evaluators; visibility composes getEffectiveRecipientAuthorization", /getEffectiveRecipientAuthorization/.test(kernel) && /evaluateSafetySignalDeliveryEligibility/.test(kernel) && /getEffectiveRecipientAuthorization/.test(visibility));
  check("★ ALL 13 types supported (exhaustive never; no placeholder unsupported Family type)", /family_incident_created/.test(kernel) && /family_incident_escalated/.test(kernel) && /family_protection_plan_updated/.test(kernel) && /: never/.test(kernel));
  check("★ visibility reads owner-only incident/plan tables via systemDb (never a tamanor_app grant)", /systemDb\.childSafetyIncident/.test(visibility) && /systemDb\.childSafetyProtectionPlan/.test(visibility) && !/withTenant/.test(visibility));
  check("★ visibility uses NO reviewer/role-capability shortcut for Family visibility (linked-signal auth only)", !/canView|canManage|reviewer|ProtectionActor/i.test(visibilityCode));
  check("★ no live trigger wired (no child-safety module imports the kernel/visibility)", csFiles.every((f) => !internalRe.test(read(`packages/db/src/${f}`))));

  console.log("\n10. provisioning alignment — set-app-role-password CS revokes stay in sync with migrations");
  const prov = read("packages/db/scripts/set-app-role-password.ts");
  const provRevokeAll = new Set([...prov.matchAll(/"(child_safety_[a-z_]+)"/g)].map((m) => m[1]));
  const migRevokeAll = new Set([...readMigrationsFor(/REVOKE ALL PRIVILEGES ON TABLE "(child_safety_[a-z_]+)" FROM tamanor_app/g)]);
  const missing = [...migRevokeAll].filter((t) => !provRevokeAll.has(t));
  check("★ every migration REVOKE-ALL child_safety_* table is re-asserted by the provisioning script", missing.length === 0, `missing: ${missing.join(",")}`);
  check("★ provisioning re-asserts DELETE,TRUNCATE revokes on the soft-delete safety tables", /REVOKE DELETE, TRUNCATE/.test(prov) && /safety_signal_deliveries/.test(prov) && /safety_recipient_authorization_decisions/.test(prov));

  console.log("\n11. Phase 3B3 durable outbox — ELEVEN wired triggers + processor boundary invariants");
  const enqueueSrc = read("packages/db/src/internal/family-notification-outbox.ts");
  const procSrc = read("packages/db/src/internal/family-notification-outbox-processor.ts");
  const visibilitySrc = read("packages/db/src/internal/family-incident-visibility.ts");
  const deliverySrc = read("packages/db/src/child-safety-delivery.ts");
  const consentSrc = read("packages/db/src/child-safety-consent.ts");
  const recipAuthSrc = read("packages/db/src/child-safety-recipient-authorization.ts");
  const inviteSrc = read("packages/db/src/family-invitation.ts");
  const signalSrc = read("packages/db/src/child-safety-safety-signal.ts");
  const incidentSrc = read("packages/db/src/child-safety-incident.ts");
  const escalationSrc = read("packages/db/src/child-safety-escalation.ts");
  const planSrc = read("packages/db/src/child-safety-protection-plan.ts");
  const schema = read("packages/db/prisma/schema.prisma");
  const outboxMig = read("packages/db/prisma/migrations/20260826090000_family_notification_outbox/migration.sql");
  const provDelete = new Set([...prov.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));

  // Exactly the authorized canonical DOMAIN services wire the enqueue — no route/UI/middleware, no other module.
  const enqueueRe = /from\s+["'][^"']*internal\/family-notification-outbox["']/;
  const srcFiles = readdirSync(join(REPO, "packages/db/src")).filter((f) => f.endsWith(".ts")).map((f) => `packages/db/src/${f}`);
  const enqueueImporters = srcFiles.filter((p) => enqueueRe.test(read(p))).map((p) => p.split("/").pop()!).sort();
  const authorizedImporters = ["child-safety-consent.ts", "child-safety-delivery.ts", "child-safety-escalation.ts", "child-safety-incident.ts", "child-safety-protection-plan.ts", "child-safety-recipient-authorization.ts", "child-safety-safety-signal.ts", "family-invitation.ts"];
  check("★ EXACTLY the authorized canonical domain services wire the enqueue", JSON.stringify(enqueueImporters) === JSON.stringify(authorizedImporters), enqueueImporters.join(","));
  // Each trigger is owned by its canonical transition/service.
  check("★ delivery available/ack/decline enqueues live in the delivery transitions", /makeSafetySignalDeliveryAvailable[^]*enqueueFamilyNotificationOutboxEventTx/.test(deliverySrc) && /family_delivery_acknowledged/.test(deliverySrc) && /family_delivery_declined/.test(deliverySrc));
  check("★ invitation-accepted enqueue lives in acceptFamilyGuardianInvitation", /acceptFamilyGuardianInvitation[^]*enqueueFamilyNotificationOutboxEventTx/.test(inviteSrc) && /family_guardian_invitation_accepted/.test(inviteSrc));
  check("★ authority-changed enqueue lives in the consent/authority services (material helper)", /enqueueAuthorityChangedIfMaterialTx/.test(consentSrc) && /family_authority_changed/.test(enqueueSrc));
  check("★ recipient-authorization-changed enqueue lives in the decision services", /family_recipient_authorization_changed/.test(recipAuthSrc) && /enqueueFamilyNotificationOutboxEventTx/.test(recipAuthSrc));
  // Phase 3B2: the signal trigger is owned ONLY by the confirm-risk transition (never raw create/ingest); it is
  // mutually exclusive by severity (available XOR urgent from the SAME `urgent` boolean); incident creation is
  // owned by correlateAndLinkSignal; escalation by createOrReuseEscalation — each the sole canonical writer.
  // The SINGLE enqueue call must sit AFTER the confirmSafetySignalRisk declaration (which is defined after
  // createSafetySignal + the ingestion writer) → it is owned by the trusted confirm transition, never raw
  // create/ingest. Combined with the "exactly one enqueue" check below this pins it to confirm.
  check("★ signal enqueue lives ONLY in confirmSafetySignalRisk (trusted transition, never raw create/ingest)", (() => { const enq = signalSrc.indexOf("enqueueFamilyNotificationOutboxEventTx(db,"); const conf = signalSrc.indexOf("export function confirmSafetySignalRisk"); const create = signalSrc.indexOf("export async function createSafetySignal"); return enq > conf && conf > create && create > -1; })());
  check("★ signal is mutually exclusive by severity (available XOR urgent, one enqueue)", /urgent \? "family_urgent_signal" : "family_signal_available"/.test(signalSrc) && (signalSrc.match(/enqueueFamilyNotificationOutboxEventTx\(db,/g) ?? []).length === 1);
  check("★ incident-created enqueue lives in correlateAndLinkSignal, gated on createdIncident", /correlateAndLinkSignal/.test(incidentSrc) && /if \(createdIncident\)[^]*family_incident_created/.test(incidentSrc));
  check("★ incident-escalated enqueue lives in createOrReuseEscalation, gated on the NEW escalation", /family_incident_escalated/.test(escalationSrc) && /systemDb\.\$transaction[^]*enqueueFamilyNotificationOutboxEventOwnerTx/.test(escalationSrc));
  // Phase 3B3: the plan trigger is owned ONLY by the transitionPlan canonical status writer, gated on an explicit
  // Family-disclosable materiality helper (never a bare updatedAt); draft-creation does NOT enqueue; and the
  // enqueue-module allow-list matches the resolver/visibility allow-list exactly.
  check("★ plan-update enqueue lives in transitionPlan, gated by isMaterialFamilyProtectionPlanUpdate", /transitionPlan/.test(planSrc) && /if \(isMaterialFamilyProtectionPlanUpdate\([^]*?family_protection_plan_updated/.test(planSrc));
  // The SINGLE plan enqueue sits after the transitionPlan declaration (which is defined after
  // createDraftProtectionPlan) → owned by the status transition, never by draft creation.
  check("★ draft-creation (createDraftProtectionPlan) does NOT enqueue", (() => { const cd = planSrc.indexOf("export async function createDraftProtectionPlan"); const tp = planSrc.indexOf("async function transitionPlan"); const enq = planSrc.indexOf("enqueueFamilyNotificationOutboxEventOwnerTx(tx,"); const one = (planSrc.match(/enqueueFamilyNotificationOutboxEventOwnerTx\(tx,/g) ?? []).length === 1; return cd > -1 && cd < tp && tp < enq && one; })());
  check("★ plan materiality helper uses the explicit allow-list, never a bare updatedAt", /FAMILY_DISCLOSABLE_PLAN_STATES\.has\(after\.status\)/.test(enqueueSrc) && !/isMaterialFamilyProtectionPlanUpdate[^}]*updatedAt/.test(enqueueSrc));
  check("★ enqueue-module plan allow-list matches the resolver/visibility allow-list exactly", (enqueueSrc.match(/FAMILY_DISCLOSABLE_PLAN_STATES[^=]*=\s*new Set\((\[[^\]]*\])\)/)?.[1] ?? "x") === (visibilitySrc.match(/FAMILY_DISCLOSABLE_PLAN_STATES\s*=\s*new Set\((\[[^\]]*\])\)/)?.[1] ?? "y"));
  check("★ plan trigger passes NO plan actions/notes/content to the enqueue (only protectionPlanId)", (() => { const call = planSrc.match(/enqueueFamilyNotificationOutboxEventOwnerTx\(tx, \{[^]*?\}\)/)?.[0] ?? ""; return /protectionPlanId/.test(call) && !/action|note|title|content|reason(?!Code)|evidence|priority/i.test(call); })());
  check("★ plan updates are NOT a critical readiness type", /CRITICAL_OUTBOX_TYPES[^]*?=\s*new Set\(\[([^\]]*)\]\)/.test(enqueueSrc) && !new RegExp(`CRITICAL_OUTBOX_TYPES[^]*?=\\s*new Set\\(\\[([^\\]]*family_protection_plan_updated[^\\]]*)\\]`).test(enqueueSrc));
  // Exactly ELEVEN enqueueable types; the TWO deferred (expiry) types are NOT in the enqueue map.
  const wiredTypes = ["family_delivery_available", "family_delivery_acknowledged", "family_delivery_declined", "family_guardian_invitation_accepted", "family_authority_changed", "family_recipient_authorization_changed", "family_signal_available", "family_urgent_signal", "family_incident_created", "family_incident_escalated", "family_protection_plan_updated", "family_guardian_invitation_expiring", "family_consent_expiring"];
  const typeMapBlock = enqueueSrc.match(/OUTBOX_TYPE_SOURCE = \{[^]*?\} as const/)?.[0] ?? "";
  check("★ exactly THIRTEEN enqueueable types (the full catalogue is wired; no unsupported type remains)", wiredTypes.every((t) => typeMapBlock.includes(t)) && (typeMapBlock.match(/sourceType:/g) ?? []).length === 13 && wiredTypes.length === 13);

  console.log("\n12. Phase 3C — deterministic expiry evaluators + scheduler boundary invariants");
  const expirySrc = read("packages/db/src/internal/family-notification-expiry.ts");
  const expiryCode = stripComments(expirySrc);
  const schedulerSrc = read("packages/db/src/internal/family-notification-scheduler.ts");
  const cronAuthSrc = read("apps/web/src/lib/cron-auth.ts");
  const cronRouteSrc = read("apps/web/src/app/api/internal/cron/family-notifications/route.ts");
  const authSrc = read("packages/db/src/internal/family-notification-authorization.ts");
  const dbIndexCode = stripComments(dbIndex);
  // Evaluators enqueue the two expiry types via the bounded enqueue ONLY; never create a notification row.
  check("★ expiry evaluators enqueue via the bounded owner enqueue (both expiry types)", /family_guardian_invitation_expiring/.test(expiryCode) && /family_consent_expiring/.test(expiryCode) && /enqueueFamilyNotificationOutboxEventOwnerTx/.test(expiryCode) && !/createFamilyNotification|createAuthorizedFamilyNotification|\.notification\.create/.test(expiryCode));
  // Narrow projections: the evaluator CODE (comments stripped) never references token/email/message (invitation)
  // or notes/evidence/reason (consent); it selects only bounded routing fields.
  check("★ invitation evaluator reads NO token/email/message (narrow projection)", /familyGuardianInvitation\.findMany/.test(expiryCode) && /select: \{ id: true, tenantId: true, expiresAt: true \}/.test(expiryCode) && !/token|invitedEmail|\bmessage\b/i.test(expiryCode));
  check("★ consent evaluator reads NO notes/evidence/reason (narrow projection)", /consentRecord\.findMany/.test(expiryCode) && /select: \{ id: true, tenantId: true, validUntil: true \}/.test(expiryCode) && !/note|evidence|reasonCode|\bscope\b/i.test(expiryCode));
  check("★ evaluators do NOT mutate the source (no warningSentAt; no source .update)", !/warningSentAt/.test(expiryCode) && !/familyGuardianInvitation\.update|consentRecord\.update/.test(expiryCode));
  check("★ eventVersion is based on the canonical expiry instant, never a clock/random", /invitationExpiringEventVersion\(inv\.expiresAt\.getTime\(\)\)/.test(expiryCode) && /consentExpiringEventVersion\(c\.validUntil\.getTime\(\)\)/.test(expiryCode) && !/Date\.now\(\)|Math\.random/.test(expiryCode));
  check("★ warning windows are explicit constants (24h / 14d); no per-day reminder loop", /INVITATION_WARNING_WINDOW_MS = 24 \* 60 \* 60 \* 1000/.test(enqueueSrc) && /CONSENT_WARNING_WINDOW_MS = 14 \* 24 \* 60 \* 60 \* 1000/.test(enqueueSrc) && !/setInterval/.test(expiryCode));
  check("★ resolver has explicit stale-expiry validation (eventVersion-encoded expiry re-check)", /parseInvitationExpiringEventVersion/.test(authSrc) && /parseConsentExpiringEventVersion/.test(authSrc) && /source_state_invalid/.test(authSrc));
  // Scheduler: DB-backed lease; NO competing mechanism (no in-memory mutex / setInterval).
  check("★ scheduler uses a DB-backed lease (scheduler_leases; atomic acquire; owner-token release)", /scheduler_leases/.test(schedulerSrc) && /acquireSchedulerLease/.test(schedulerSrc) && /ON CONFLICT/.test(schedulerSrc) && !/setInterval|new Map\(\)|globalThis\./.test(stripComments(schedulerSrc)));
  check("★ NO competing scheduler mechanism added (no cron/setInterval in db/src)", !srcFiles.some((p) => /setInterval|node-cron|CronJob/i.test(stripComments(read(p)))));
  // Cron route: bearer secret required; query-string/session rejected; aggregate only; server-only; reuses runner.
  check("★ cron route requires the bearer secret (assertCronAuth) before any work", /assertCronAuth\(req\)/.test(cronRouteSrc) && cronRouteSrc.indexOf("assertCronAuth") < cronRouteSrc.indexOf("runFamilyNotificationScheduler"));
  check("★ cron auth is fail-closed + constant-time + never a query-string/session secret", /cron_secret_unset/.test(cronAuthSrc) && /charCodeAt/.test(cronAuthSrc) && !/searchParams|cookie/i.test(stripComments(cronAuthSrc)));
  check("★ cron route returns aggregate counts only (spreads the runner result) + no-store", /Response\.json\(\s*\{ ok: true, \.\.\.r \}/.test(cronRouteSrc) && /no-store/.test(cronRouteSrc));
  check("★ a user session cannot authorize the cron (no cookie/session auth in the route)", !/cookies\(\)|getServerSession|auth\(\)/.test(cronRouteSrc));
  check("★ processor still calls ONLY createAuthorizedFamilyNotification (never the internal resolver)", /createAuthorizedFamilyNotification/.test(procSrc) && !/resolveFamilyNotificationRecipientsTx|createFamilyNotificationTx/.test(procSrc));
  check("★ resolver stays internal; only the scheduler runner + health are the new barrel exports", !/resolveFamilyNotificationRecipientsTx/.test(dbIndexCode) && /runFamilyNotificationScheduler/.test(dbIndexCode));
  check("★ no identifiers logged by the runner/route (aggregate ops events only)", !/console\.(log|error)\(/.test(stripComments(schedulerSrc)) && !/emitOpsEvent\([^)]*(tenant|user|source|email|id)/i.test(cronRouteSrc));
  check("★ no NON-catalogue type is enqueued anywhere in src (all enqueued types are among the wired 13)", srcFiles.every((p) => { const s = read(p); if (!/enqueueFamilyNotificationOutboxEvent(Owner)?Tx/.test(s)) return true; return [...s.matchAll(/notificationType:\s*"(family_[a-z_]+)"/g)].every((m) => wiredTypes.includes(m[1]!)); }));
  // Owner-only incident boundary: the incident/escalation triggers use the SAME supplied owner tx (no escape to a
  // fresh systemDb transaction inside the enqueue), and no reviewer/manager/owner-role shortcut grants visibility.
  check("★ incident/escalation enqueue uses the supplied owner tx (no nested transaction escape)", /enqueueFamilyNotificationOutboxEventOwnerTx\(tx,/.test(incidentSrc) && /enqueueFamilyNotificationOutboxEventOwnerTx\(tx,/.test(escalationSrc) && !/enqueueFamilyNotificationOutboxEventOwnerTx\(await systemDb|systemDb\.\$transaction\([^)]*enqueueFamilyNotificationOutboxEventOwnerTx\(systemDb/.test(incidentSrc + escalationSrc));
  check("★ no signal/incident CONTENT is passed by trigger projections (only bounded ids)", (() => { const calls = [...signalSrc.matchAll(/enqueueFamilyNotificationOutboxEventTx\(db, \{[^]*?\}\)/g), ...incidentSrc.matchAll(/enqueueFamilyNotificationOutboxEventOwnerTx\(tx, \{[^]*?\}\)/g), ...escalationSrc.matchAll(/enqueueFamilyNotificationOutboxEventOwnerTx\(tx, \{[^]*?\}\)/g)].map((m) => m[0]).join(" "); return !/sourceReference|signalType|narrative|content|message|reviewer|reasonCode|escalationReason/i.test(calls); })());
  check("★ processor readiness is bounded (CRITICAL types + finite readiness attempts, no infinite loop)", /CRITICAL_OUTBOX_TYPES\.has/.test(procSrc) && /OUTBOX_READINESS_MAX_ATTEMPTS/.test(procSrc) && /authorization_pending/.test(procSrc));
  // Per-trigger privacy projections: the enqueue call-sites pass only bounded ids.
  check("★ invitation trigger passes NO email/token to the enqueue (only invitationId)", (() => { const call = inviteSrc.match(/enqueueFamilyNotificationOutboxEventTx\(tx, \{[^]*?\}\)/)?.[0] ?? ""; return /invitationId/.test(call) && !/token|email|invitedEmail|acceptedByUserId/i.test(call); })());
  check("★ authority materiality helper stores only a status/level comparison (no notes/evidence)", !/note|evidence|document|reviewer/i.test(stripComments(enqueueSrc.match(/enqueueAuthorityChangedIfMaterialTx[^]*?^}/m)?.[0] ?? enqueueSrc)));
  // occurredAt may be a bounded timestamp (e.g. the decision's evaluatedAt) — forbid only disclosure SCOPES and
  // the reason-code VALUE being passed into the outbox event, never a bounded timestamp field.
  check("★ recipient-auth trigger passes NO scope/reason to the enqueue (only decision id)", (() => { const calls = [...recipAuthSrc.matchAll(/enqueueFamilyNotificationOutboxEventTx\(db, \{[^]*?\}\)/g)].map((m) => m[0]).join(" "); return /authorizationDecisionId/.test(calls) && !/disclosureScope|scope:|reasonCode/i.test(calls); })());
  check("★ no Prisma middleware ($use) generates outbox events", !srcFiles.some((p) => /\$use\(/.test(read(p)) && /enqueueFamilyNotificationOutbox/.test(read(p))));

  // Route / UI code never enqueues, and the outbox stays off the browser boundary.
  const familyAppDir = join(REPO, "apps/web/src/app/family");
  const appFamilyFiles = existsSync(familyAppDir) ? readdirSync(familyAppDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx")).map((f) => `apps/web/src/app/family/${f}`) : [];
  check("★ no route/UI/family module enqueues or imports the outbox", !appFamilyFiles.some((p) => /family-notification-outbox|enqueueFamilyNotificationOutboxEventTx/.test(read(p))));
  check("★ outbox enqueue + processor are NOT barrel-exported", !/family-notification-outbox/.test(dbIndex.replace(/\/\/.*/g, "")));

  // Strict event shape: explicit columns only, NO recipient ids, NO arbitrary JSON payload.
  // Forbid a recipient IDENTITY field (recipientId / recipientUserId / recipientMembershipId). The count-only
  // reason code "no_recipients" is fine — it is a classification, never a recipient id.
  check("★ outbox input/schema carries NO recipient identity field", !/recipient[A-Za-z]*Id/i.test(stripComments(enqueueSrc)) && !/recipient[A-Za-z]*Id/i.test(schema.replace(/\/\/.*/g, "").match(/model FamilyNotificationOutboxEvent[^]*?@@map\("family_notification_outbox_events"\)/)?.[0] ?? ""));
  check("★ outbox model has NO Json/payload column (explicit bounded columns only)", /model FamilyNotificationOutboxEvent[^]*?@@map\("family_notification_outbox_events"\)/.test(schema) && !/model FamilyNotificationOutboxEvent[^]*?Json[^]*?@@map\("family_notification_outbox_events"\)/.test(schema));

  // Processor: goes ONLY through the public safe entry point; stores ONLY bounded codes; never hard-deletes.
  check("★ processor creates via createAuthorizedFamilyNotification only (never the internal resolver/primitive)", /createAuthorizedFamilyNotification/.test(procSrc) && !/resolveFamilyNotificationRecipientsTx|createFamilyNotificationTx/.test(procSrc));
  check("★ processor stores ONLY bounded error/reason codes (no raw exception/Prisma/SQL text)", /OUTBOX_ERROR_CODE\./.test(procSrc) && !/\.message/.test(procSrc) && !/error\.stack|err\.stack|e\.stack/.test(procSrc));
  check("★ no hard-delete of outbox events anywhere (enqueue + processor)", !/familyNotificationOutboxEvent\.delete(Many)?\(/.test(enqueueSrc) && !/familyNotificationOutboxEvent\.delete(Many)?\(/.test(procSrc));
  check("★ migration grants app role NO DELETE + REVOKEs DELETE/TRUNCATE on the outbox", /GRANT SELECT, INSERT, UPDATE ON "family_notification_outbox_events" TO tamanor_app/.test(outboxMig) && /REVOKE DELETE, TRUNCATE ON "family_notification_outbox_events" FROM tamanor_app/.test(outboxMig) && !/GRANT[^;]*DELETE[^;]*family_notification_outbox_events/.test(outboxMig));
  check("★ provisioning re-asserts the outbox no-DELETE hardening", provDelete.has("family_notification_outbox_events"));

  // No scheduler / no delivery channels / no bell added by Phase 3A.
  check("★ NO production scheduler/cron added (no setInterval/cron/schedule in the outbox code)", !/setInterval|node-cron|cron\(|schedule\(|CronJob/i.test(enqueueSrc + procSrc));
  check("★ NO push/email/SMS/webhook in the outbox code", !/sendEmail|sendSms|webhook|fcm|apns|pushNotification|twilio/i.test(enqueueSrc + procSrc));
  check("★ RLS enabled+forced with a tenant policy in the outbox migration", /ENABLE ROW LEVEL SECURITY/.test(outboxMig) && /FORCE ROW LEVEL SECURITY/.test(outboxMig) && /CREATE POLICY tenant_isolation/.test(outboxMig));

  console.log("\n13. Phase 4A — Family Notification Center V1 (web boundary invariants)");
  const NOTIF = "apps/web/src/app/family/(console)/notifications";
  const centerRoute = read(`${NOTIF}/page.tsx`);
  const centerActions = read(`${NOTIF}/actions.ts`);
  const centerClient = read(`${NOTIF}/notification-center.tsx`);
  const bellComp = read("apps/web/src/app/family/family-notification-bell.tsx");
  const centerLayout = read("apps/web/src/app/family/(console)/layout.tsx");
  const vmSrc = read("apps/web/src/app/family/family-notification-view.ts");
  const webUi = [centerRoute, centerActions, centerClient, bellComp, centerLayout, vmSrc, read("apps/web/src/app/family/family-notification-cursor.ts")].join("\n");
  // No second table / repo / resolver: the center reuses the shared Notification model + verified Family services.
  check("★ NO second notification table (only the shared Notification model / verified services)", !/model .*Notification.*Center|new_notification|@@map\("family_notifications"\)/.test(schema) && /listFamilyNotifications/.test(centerRoute));
  check("★ page uses listFamilyNotifications; bell uses familyUnreadNotificationCount", /listFamilyNotifications\(actor/.test(centerRoute) && /familyUnreadNotificationCount\(actor\)/.test(centerLayout));
  check("★ actions use ONLY the verified Family services (mark/mark-all/dismiss/open-load)", /markFamilyNotificationRead\(actor/.test(centerActions) && /markAllFamilyNotificationsRead\(actor/.test(centerActions) && /dismissFamilyNotification\(actor/.test(centerActions) && /loadFamilyNotificationTypeForOpen\(actor/.test(centerActions));
  check("★ web NEVER mutates the Notification table directly", !/\.notification\.(update|create|delete|updateMany|deleteMany)/.test(webUi));
  check("★ NO systemDb / internal resolver / outbox / scheduler / expiry imported into the Family UI", !/systemDb|resolveFamilyNotificationRecipientsTx|internal\/family-notification-(outbox|scheduler|expiry)/.test(webUi));
  check("★ NO raw metadata serialization or arbitrary metadata href in the UI", !/\.metadata\b|JSON\.stringify\([^)]*metadata/.test(webUi));
  check("★ dismissibility is SERVER-enforced (client only reads the catalogue-derived flag)", /DISMISSIBLE_FAMILY_TYPES_PN/.test(repoSrc) && /familyNotificationDismissible/.test(vmSrc));
  check("★ CTA is an allow-list of implemented Family list routes (no incident/plan detail route)", /IMPLEMENTED_FAMILY_CTA_ROUTES/.test(vmSrc) && !/\/family\/(incidents|protection-plans|plans)/.test(webUi));
  check("★ NO preferences / email / push / SMS / webhook / messenger / connected-account in the center", !/notification-preferences|sendEmail|pushNotification|sendSms|webhook|twilio|connectedAccount/i.test(webUi));
  check("★ NO WebSocket / SSE / polling in the center or bell", !/WebSocket|EventSource|setInterval|navigator\.serviceWorker/i.test(stripComments(webUi)));
  check("★ NO hard delete anywhere in the center (soft dismiss only)", !/\.delete\(|deleteMany/.test(webUi));
  check("★ safe loading + error boundaries (error boundary renders no raw error)", existsSync(join(REPO, `${NOTIF}/loading.tsx`)) && existsSync(join(REPO, `${NOTIF}/error.tsx`)) && !/error\.message|\.stack/.test(read(`${NOTIF}/error.tsx`)));
  check("★ bell is Family-scoped (mounted only in the Family console layout; no Business import)", /FamilyNotificationBell/.test(read("apps/web/src/app/family/family-shell.tsx")) && !/dashboard\//.test(bellComp));
  check("★ route reads ONLY view+cursor (no tenantId/userId/source id from the URL)", /normalizeFamilyNotificationView\(sp\.view\)/.test(centerRoute) && /decodeFamilyNotificationCursor\(sp\.cursor\)/.test(centerRoute) && !/sp\.(tenantId|userId|incidentId|signalId|profileId)/.test(centerRoute));
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
