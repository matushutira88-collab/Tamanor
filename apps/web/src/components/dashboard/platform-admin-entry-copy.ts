import type { PlatformAdminEntryCopy } from "./platform-admin-entry";

/**
 * Localized copy for the owner-only Platform Administration entry card. Kept in one place so every landing route
 * (business dashboard, family console, family onboarding) renders the identical card.
 */
export const PLATFORM_ADMIN_ENTRY_COPY: Record<"en" | "sk" | "de", PlatformAdminEntryCopy> = {
  en: { title: "Platform Administration", description: "Manage the entire Tamanor platform — administrators, privacy analytics, security incidents and the audit trail.", cta: "Open admin console", mTenants: "Active tenants", mUsers: "Active users", mIncidents: "Unresolved incidents", mAudit: "Recent audit events" },
  sk: { title: "Správa platformy", description: "Spravujte celú platformu Tamanor — administrátorov, súkromnú analytiku, bezpečnostné incidenty a záznam auditu.", cta: "Otvoriť admin konzolu", mTenants: "Aktívne tenanty", mUsers: "Aktívni používatelia", mIncidents: "Nevyriešené incidenty", mAudit: "Nedávne audit udalosti" },
  de: { title: "Plattform-Administration", description: "Verwalten Sie die gesamte Tamanor-Plattform — Administratoren, Datenschutz-Analytics, Sicherheitsvorfälle und das Audit-Protokoll.", cta: "Admin-Konsole öffnen", mTenants: "Aktive Mandanten", mUsers: "Aktive Nutzer", mIncidents: "Ungelöste Vorfälle", mAudit: "Letzte Audit-Ereignisse" },
};
