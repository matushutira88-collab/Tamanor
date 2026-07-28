/**
 * FAMILY NOTIFICATION CENTER V1 — PURE catalogue tests (no DB). Proves type→severity, safe CTA routes (no ids),
 * deterministic per-recipient dedupe keys, expiry-window math, 99+ badge formatting, BOUNDED fail-closed
 * metadata (no PII/free-text), the recipient-rule per type (never "all members"), dismissible flags, and that an
 * unknown type fails closed. Run: pnpm family-notifications:test
 */
import {
  FAMILY_NOTIFICATION_TYPES, FAMILY_NOTIFICATION_CATALOGUE, isFamilyNotificationType, familyNotificationSpec,
  familyNotificationSeverity, familyToDbSeverity, familyNotificationCta, familyNotificationDismissible,
  familyRecipientRule, familyNotificationDedupeKey, familyExpiryWindow, familyDaysUntil, FAMILY_EXPIRY_WINDOWS_DAYS,
  buildFamilyNotificationMetadata, FAMILY_NOTIFICATION_METADATA_KEYS, formatUnreadBadge,
} from "../src/index";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const NOW = new Date("2026-06-15T12:00:00.000Z");

function main() {
  console.log("\n1. catalogue completeness + severity");
  check("★ exactly 13 bounded types, all in the catalogue", FAMILY_NOTIFICATION_TYPES.length === 13 && FAMILY_NOTIFICATION_TYPES.every((t) => FAMILY_NOTIFICATION_CATALOGUE[t]?.type === t));
  check("★ urgent for urgent-signal/incident; attention/info for the rest", familyNotificationSeverity("family_urgent_signal") === "urgent" && familyNotificationSeverity("family_incident_created") === "urgent" && familyNotificationSeverity("family_delivery_acknowledged") === "info" && familyNotificationSeverity("family_signal_available") === "attention");
  check("★ Family severity → DB severity (urgent=critical, attention=warning, info=info)", familyToDbSeverity("urgent") === "critical" && familyToDbSeverity("attention") === "warning" && familyToDbSeverity("info") === "info");

  console.log("\n2. safe CTA routes — base Family pages only, NEVER an entity id / query param");
  const routes = FAMILY_NOTIFICATION_TYPES.map(familyNotificationCta);
  check("★ every CTA is a bounded /family/* route with no id or query", routes.every((r) => /^\/family(\/[a-z]+)?$/.test(r)));
  check("★ delivery→/deliveries, invitation→/invitations, authority/consent→/authorizations, signal→/signals", familyNotificationCta("family_delivery_available") === "/family/deliveries" && familyNotificationCta("family_guardian_invitation_accepted") === "/family/invitations" && familyNotificationCta("family_authority_changed") === "/family/authorizations" && familyNotificationCta("family_signal_available") === "/family/signals");

  console.log("\n3. recipient rule per type — never 'all tenant members'");
  check("★ signals/incidents require the full child-safety authorization chain", familyRecipientRule("family_urgent_signal") === "cs_authorized_recipient" && familyRecipientRule("family_incident_created") === "cs_authorized_recipient");
  check("★ delivery_available requires the delivery recipient ONLY", familyRecipientRule("family_delivery_available") === "delivery_recipient");
  check("★ invitation accepted → inviter + admins; authority change → affected guardian + managers", familyRecipientRule("family_guardian_invitation_accepted") === "inviter_plus_admins" && familyRecipientRule("family_authority_changed") === "affected_guardian_plus_managers");
  check("★ protection-plan update → protection_plan_viewer only", familyRecipientRule("family_protection_plan_updated") === "protection_plan_viewer");
  check("★ NO rule is a plain 'all members' rule", !Object.values(FAMILY_NOTIFICATION_CATALOGUE).some((s) => String(s.recipientRule).includes("all")));

  console.log("\n4. dismissible flags — urgent safety stays visible");
  check("★ urgent signal / incidents / delivery_available are NOT dismissible", !familyNotificationDismissible("family_urgent_signal") && !familyNotificationDismissible("family_incident_created") && !familyNotificationDismissible("family_incident_escalated") && !familyNotificationDismissible("family_delivery_available"));
  check("★ info/attention lifecycle events ARE dismissible", familyNotificationDismissible("family_delivery_acknowledged") && familyNotificationDismissible("family_guardian_invitation_accepted") && familyNotificationDismissible("family_authority_changed"));

  console.log("\n5. deterministic, per-recipient dedupe keys");
  const k1 = familyNotificationDedupeKey({ type: "family_delivery_available", recipientUserId: "u1", entityType: "delivery", entityId: "d1", version: "v1" });
  check("★ deterministic (same inputs → same key)", k1 === familyNotificationDedupeKey({ type: "family_delivery_available", recipientUserId: "u1", entityType: "delivery", entityId: "d1", version: "v1" }));
  check("★ different recipient → different key (each authorized recipient gets one)", k1 !== familyNotificationDedupeKey({ type: "family_delivery_available", recipientUserId: "u2", entityType: "delivery", entityId: "d1", version: "v1" }));
  check("★ different version → different key (a new lifecycle event is a new notification)", k1 !== familyNotificationDedupeKey({ type: "family_delivery_available", recipientUserId: "u1", entityType: "delivery", entityId: "d1", version: "v2" }));
  check("★ same event retry (no version change) → same key (idempotent)", familyNotificationDedupeKey({ type: "family_urgent_signal", recipientUserId: "u1", entityType: "signal", entityId: "s1" }) === familyNotificationDedupeKey({ type: "family_urgent_signal", recipientUserId: "u1", entityType: "signal", entityId: "s1" }));

  console.log("\n6. expiry windows (7d / 1d), injected now");
  check("★ windows are [7, 1]", FAMILY_EXPIRY_WINDOWS_DAYS.join(",") === "7,1");
  check("★ 8d→null, 7d→7, 5d→7, 1d→1, 0d→null, expired→null", familyExpiryWindow(8) === null && familyExpiryWindow(7) === 7 && familyExpiryWindow(5) === 7 && familyExpiryWindow(1) === 1 && familyExpiryWindow(0) === null && familyExpiryWindow(-3) === null);
  check("★ familyDaysUntil computes whole days (injected now); null when no expiry", familyDaysUntil(new Date(NOW.getTime() + 3 * 86_400_000), NOW) === 3 && familyDaysUntil(null, NOW) === null && familyDaysUntil(new Date(NOW.getTime() - 1000), NOW) === 0);

  console.log("\n7. 99+ badge formatting");
  check("★ 0→'', 1→'1', 99→'99', 100→'99+', 5000→'99+'", formatUnreadBadge(0) === "" && formatUnreadBadge(1) === "1" && formatUnreadBadge(99) === "99" && formatUnreadBadge(100) === "99+" && formatUnreadBadge(5000) === "99+");

  console.log("\n8. BOUNDED, privacy-preserving metadata (fail-closed, no PII/free-text)");
  const meta = buildFamilyNotificationMetadata({ type: "family_delivery_available", entityId: "dlv_abc123", profileId: "prof_x1", createdAt: NOW, safeReasonCode: "recipient_ready" });
  check("★ emits ONLY allow-listed keys", Object.keys(meta).every((k) => (FAMILY_NOTIFICATION_METADATA_KEYS as string[]).includes(k)));
  check("★ carries the bounded fields (type/severity/entity/route/ids/reason)", meta.notificationType === "family_delivery_available" && meta.entityType === "delivery" && meta.safeRoute === "/family/deliveries" && meta.entityId === "dlv_abc123" && meta.profileId === "prof_x1" && meta.safeReasonCode === "recipient_ready");
  check("★ rejects a non-id entityId (fails closed)", (() => { try { buildFamilyNotificationMetadata({ type: "family_signal_available", entityId: "a name with spaces" }); return false; } catch { return true; } })());
  check("★ rejects a free-text reason code (fails closed)", (() => { try { buildFamilyNotificationMetadata({ type: "family_signal_available", entityId: "sig_1", safeReasonCode: "child said something bad" }); return false; } catch { return true; } })());
  check("★ no raw content/name/email/token/note keys are even possible in the shape", !(FAMILY_NOTIFICATION_METADATA_KEYS as string[]).some((k) => /message|comment|content|name|email|token|note|dob|age|birth|narrative|reviewer|evidence/i.test(k)));

  console.log("\n9. unknown type fails closed");
  check("★ isFamilyNotificationType rejects unknown/empty/non-string", !isFamilyNotificationType("family_made_up") && !isFamilyNotificationType("") && !isFamilyNotificationType(null) && !isFamilyNotificationType(42));
  check("★ familyNotificationSpec throws on unknown type", (() => { try { familyNotificationSpec("nope"); return false; } catch { return true; } })());
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Family notifications catalogue: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
