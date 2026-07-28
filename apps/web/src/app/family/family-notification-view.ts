/**
 * FAMILY NOTIFICATION CENTER V1 — pure presentation view model. Turns the SAFE service projection
 * (FamilyNotificationView) into a client-renderable card, deriving EVERYTHING from the Family catalogue + the
 * co-located i18n dict — never from raw DB fields. It NEVER surfaces an id (dedupeKey / tenant / recipient /
 * profile / incident / signal / delivery / invitation / consent / plan / outbox), raw metadata, a raw type/enum,
 * a raw reason code, or a metadata-derived href. An unknown/malformed row degrades to a safe localized fallback.
 */
import type { FamilyNotificationView } from "@guardora/db";
import {
  isFamilyNotificationType, familyNotificationSeverity, familyNotificationDismissible, familyNotificationCta,
  type FamilyNotificationSeverity,
} from "@guardora/core";
import type { FamilyNotifDict } from "./family-notifications-i18n";

/** The ONLY internal Family routes a CTA may point at (all already implemented list pages). A type whose
 *  catalogue route is not here (e.g. an unbuilt detail page) shows NO CTA — never a dead link, never an id. */
export const IMPLEMENTED_FAMILY_CTA_ROUTES: ReadonlySet<string> = new Set([
  "/family/signals", "/family/deliveries", "/family/invitations", "/family/authorizations",
]);

export interface FamilyNotificationCardVM {
  id: string;
  severity: FamilyNotificationSeverity; // info | attention | urgent — the tone source of truth
  severityLabel: string;
  iconKey: "info" | "attention" | "urgent";
  title: string;
  message: string;
  read: boolean;
  createdAtISO: string; // machine-readable for <time datetime>; the client formats the visible label
  dismissible: boolean; // catalogue-derived; the SERVER remains the dismissibility authority
  ctaHref: string | null; // allow-listed internal route, or null (hidden)
  unavailable: boolean;
}

/** Pure: FamilyNotificationView + dict → a client-safe card. Unknown/malformed → a generic safe fallback. */
export function familyNotificationCardVM(row: FamilyNotificationView, dict: FamilyNotifDict): FamilyNotificationCardVM {
  const fallback: FamilyNotificationCardVM = {
    id: row.id, severity: "info", severityLabel: dict.severity.info, iconKey: "info",
    title: dict.center.unavailable, message: "", read: row.read,
    createdAtISO: row.createdAt.toISOString(), dismissible: false, ctaHref: null, unavailable: true,
  };
  if (row.unavailable || !isFamilyNotificationType(row.type)) return fallback;

  const severity = familyNotificationSeverity(row.type); // info | attention | urgent (never row.severity)
  const cta = familyNotificationCta(row.type);
  return {
    id: row.id,
    severity,
    severityLabel: dict.severity[severity],
    iconKey: severity,
    title: dict.types[row.type].title,
    message: dict.types[row.type].body,
    read: row.read,
    createdAtISO: row.createdAt.toISOString(),
    dismissible: familyNotificationDismissible(row.type),
    ctaHref: IMPLEMENTED_FAMILY_CTA_ROUTES.has(cta) ? cta : null,
    unavailable: false,
  };
}

/** Bell/badge text for an unread count: 0 → hidden; 1..99 → exact; >=100 → "99+". */
export function familyUnreadBadge(count: number): { show: boolean; text: string } {
  const n = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  if (n === 0) return { show: false, text: "" };
  return { show: true, text: n >= 100 ? "99+" : String(n) };
}
