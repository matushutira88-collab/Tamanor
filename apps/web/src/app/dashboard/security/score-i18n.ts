import type { Locale } from "@/i18n/config";

/**
 * Self-contained EN/SK/DE localization for the Security Score UI. Kept out of the
 * global dictionary (which the engine's stable issueCodes would otherwise bloat).
 * The pure engine emits machine-readable `issueCode` + `evidence`; this maps each
 * to a localized reason + recommendation, interpolating the evidence numbers.
 */
export type Evidence = Record<string, number | string | boolean>;
type Text = (ev: Evidence) => string;
type Issue = { reason: Text; recommendation: Text };

export type ScoreChrome = {
  scoreTitle: string;
  outOf: string;
  insufficient: string;
  insufficientHint: string;
  coverage: (m: number, t: number) => string;
  confidence: Record<"high" | "medium" | "low", string>;
  renormalized: string;
  weightLabel: string;
  breakdownTitle: string;
  recommendationsTitle: string;
  noRecommendations: string;
  recommendationLabel: string;
  reasonLabel: string;
  notAvailable: string;
  insufficientDim: string;
  saveSnapshot: string;
  savedNotice: string;
  level: Record<"strong" | "fair" | "weak", string>;
  critical: string;
  detectOnly: string;
};

export const DIMENSION_LABELS: Record<Locale, Record<string, { label: string; description: string }>> = {
  en: {
    access: { label: "Access Security", description: "Sign-in and account hygiene of your workspace members." },
    connector: { label: "Connector Security", description: "Health and tokens of your connected platform accounts." },
    coverage: { label: "Protection Coverage", description: "How completely your reputation protection is configured." },
    response: { label: "Response Readiness", description: "How quickly incidents, approvals and high-risk items are handled." },
    compliance: { label: "Account Health & Compliance", description: "Billing state, audit trail, retention and encryption." },
  },
  sk: {
    access: { label: "Bezpečnosť prístupu", description: "Prihlasovanie a hygiena účtov členov vášho workspace." },
    connector: { label: "Bezpečnosť konektorov", description: "Stav a tokeny vašich pripojených platformových účtov." },
    coverage: { label: "Pokrytie ochrany", description: "Ako úplne máte nakonfigurovanú ochranu reputácie." },
    response: { label: "Pripravenosť reagovať", description: "Ako rýchlo sa riešia incidenty, schvaľovania a rizikové položky." },
    compliance: { label: "Zdravie účtu a súlad", description: "Stav fakturácie, audit, retencia a šifrovanie." },
  },
  de: {
    access: { label: "Zugriffssicherheit", description: "Anmeldung und Kontohygiene Ihrer Workspace-Mitglieder." },
    connector: { label: "Konnektor-Sicherheit", description: "Zustand und Tokens Ihrer verbundenen Plattformkonten." },
    coverage: { label: "Schutzabdeckung", description: "Wie vollständig Ihr Reputationsschutz konfiguriert ist." },
    response: { label: "Reaktionsbereitschaft", description: "Wie schnell Vorfälle, Freigaben und Risiken bearbeitet werden." },
    compliance: { label: "Kontozustand & Compliance", description: "Abrechnungsstatus, Audit-Trail, Aufbewahrung und Verschlüsselung." },
  },
};

export const FACTOR_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    email_verification: "Email verification", session_hygiene: "Session hygiene", privilege_distribution: "Privilege distribution", password_age: "Password age", mfa_coverage: "Multi-factor authentication", breach_exposure: "Breach exposure",
    token_health: "Token health", connection_health: "Connection health", account_status: "Account status", monitoring_enabled: "Monitoring enabled", permission_drift: "Permission drift",
    reputation_protection: "Reputation protection", incident_response: "Incident response", approval_backlog: "Approval backlog", high_risk_triage: "High-risk triage",
    billing_access_health: "Billing & access", audit_coverage: "Audit trail", data_retention: "Data retention", token_encryption: "Token encryption",
  },
  sk: {
    email_verification: "Overenie e-mailu", session_hygiene: "Hygiena relácií", privilege_distribution: "Rozdelenie oprávnení", password_age: "Vek hesiel", mfa_coverage: "Viacfaktorové overenie", breach_exposure: "Únik údajov",
    token_health: "Stav tokenov", connection_health: "Stav pripojenia", account_status: "Stav účtov", monitoring_enabled: "Monitorovanie", permission_drift: "Zmena oprávnení",
    reputation_protection: "Ochrana reputácie", incident_response: "Reakcia na incidenty", approval_backlog: "Nevybavené schvaľovania", high_risk_triage: "Triáž rizikových položiek",
    billing_access_health: "Fakturácia a prístup", audit_coverage: "Audit", data_retention: "Retencia údajov", token_encryption: "Šifrovanie tokenov",
  },
  de: {
    email_verification: "E-Mail-Verifizierung", session_hygiene: "Sitzungshygiene", privilege_distribution: "Rechteverteilung", password_age: "Passwortalter", mfa_coverage: "Mehr-Faktor-Authentifizierung", breach_exposure: "Datenleck-Exposition",
    token_health: "Token-Zustand", connection_health: "Verbindungszustand", account_status: "Kontostatus", monitoring_enabled: "Überwachung", permission_drift: "Berechtigungsdrift",
    reputation_protection: "Reputationsschutz", incident_response: "Vorfallreaktion", approval_backlog: "Freigabe-Rückstand", high_risk_triage: "Hochrisiko-Triage",
    billing_access_health: "Abrechnung & Zugriff", audit_coverage: "Audit-Trail", data_retention: "Datenaufbewahrung", token_encryption: "Token-Verschlüsselung",
  },
};

export const ISSUE_TEXT: Record<Locale, Record<string, Issue>> = {
  en: {
    unverified_members: { reason: (e) => `${e.unverified} of ${e.total} members haven't verified their email.`, recommendation: () => "Ask them to verify their email to secure sign-in." },
    stale_sessions: { reason: (e) => `${e.stale} of ${e.active} active sessions haven't been used in 30+ days.`, recommendation: () => "Revoke stale sessions from Settings → Security." },
    over_privileged: { reason: (e) => `${e.admins} of ${e.total} members have owner/admin rights.`, recommendation: () => "Apply least privilege — downgrade members who don't need admin." },
    old_passwords: { reason: (e) => `${e.old} of ${e.passwordUsers} passwords are older than 365 days.`, recommendation: () => "Ask affected members to rotate their password." },
    token_problems: { reason: (e) => `${e.problem} account(s) have expired/invalid tokens${e.expiringSoon ? `, ${e.expiringSoon} expiring soon` : ""}.`, recommendation: () => "Reconnect the affected accounts to refresh tokens." },
    unhealthy_connections: { reason: (e) => `${e.unhealthy} of ${e.total} connections are unhealthy.`, recommendation: () => "Reconnect or repair the affected accounts." },
    inactive_accounts: { reason: (e) => `${e.inactive} of ${e.total} accounts are not active.`, recommendation: () => "Finish connecting or reconnect inactive accounts." },
    monitoring_off: { reason: (e) => `${e.off} of ${e.total} accounts have monitoring turned off.`, recommendation: () => "Enable monitoring so new content is analysed." },
    low_protection_coverage: { reason: (e) => `Reputation protection coverage is ${e.protectionScore}/100.`, recommendation: () => "Configure Auto-Protect policies and rules for your brands." },
    stale_incidents: { reason: (e) => `${e.aged} of ${e.open} open incidents are older than 72 hours.`, recommendation: () => "Triage and resolve stale incidents." },
    stale_approvals: { reason: (e) => `${e.aged} of ${e.pending} approvals have waited over 48 hours.`, recommendation: () => "Clear the approval queue." },
    aged_high_risk: { reason: (e) => `${e.aged} of ${e.highRisk} high/critical items are unresolved for 48h+.`, recommendation: () => "Review and action high-risk items." },
    access_restricted: { reason: () => "Workspace access is restricted or suspended.", recommendation: () => "Restore billing to regain full access." },
    no_retention_policy: { reason: () => "No data-retention window is configured.", recommendation: () => "Set a retention policy for your plan." },
    encryption_plaintext_deployed: { reason: (e) => `OAuth tokens are stored as PLAINTEXT in a real ${e.environment} deployment (TOKEN_ENCRYPTION_MODE=${e.mode}).`, recommendation: () => "Set TOKEN_ENCRYPTION_MODE=aes-gcm (with TOKEN_ENCRYPTION_KEY) or kms immediately." },
    encryption_local_dev: { reason: (e) => `Encryption at rest applies to deployments; this is a local/dev environment (mode: ${e.mode}).`, recommendation: () => "No action needed locally." },
    encryption_unknown: { reason: () => "Token-encryption state could not be determined for this environment.", recommendation: () => "Verify TOKEN_ENCRYPTION_MODE and the deployment environment." },
    // unavailable / insufficient explanations
    mfa_not_available: { reason: () => "Multi-factor authentication isn't available yet.", recommendation: () => "Tracked for a future release." },
    breach_data_not_available: { reason: () => "Breach-exposure data isn't collected yet.", recommendation: () => "Tracked for a future release." },
    permission_baseline_not_available: { reason: () => "No permission baseline recorded yet to detect drift.", recommendation: () => "Available once history accrues." },
    encryption_dev_only: { reason: () => "Encryption at rest is verified only in production (dev uses plaintext by design).", recommendation: () => "No action needed locally." },
    no_password_users: { reason: () => "All members sign in with OAuth — no passwords to age.", recommendation: () => "No action needed." },
    no_members: { reason: () => "No workspace members to assess yet.", recommendation: () => "Invite members." },
    no_sessions: { reason: () => "No active sessions to assess.", recommendation: () => "Sign in to generate session data." },
    no_connected_accounts: { reason: () => "No platform accounts connected yet.", recommendation: () => "Connect an account to measure connector security." },
    no_monitored_accounts: { reason: () => "No monitored accounts to measure protection coverage.", recommendation: () => "Connect and monitor an account." },
    no_activity: { reason: () => "No incidents, approvals or items yet to judge responsiveness.", recommendation: () => "Response readiness appears once there is activity." },
    no_audit_activity: { reason: () => "No recent audit activity to confirm the trail.", recommendation: () => "The audit trail fills as you use the workspace." },
  },
  sk: {
    unverified_members: { reason: (e) => `${e.unverified} z ${e.total} členov nemá overený e-mail.`, recommendation: () => "Požiadajte ich o overenie e-mailu pre bezpečné prihlásenie." },
    stale_sessions: { reason: (e) => `${e.stale} z ${e.active} aktívnych relácií sa nepoužilo 30+ dní.`, recommendation: () => "Zrušte staré relácie v Nastavenia → Bezpečnosť." },
    over_privileged: { reason: (e) => `${e.admins} z ${e.total} členov má práva vlastníka/admina.`, recommendation: () => "Uplatnite najnižšie oprávnenia — znížte práva tým, čo admina nepotrebujú." },
    old_passwords: { reason: (e) => `${e.old} z ${e.passwordUsers} hesiel je staršie ako 365 dní.`, recommendation: () => "Požiadajte dotknutých členov o zmenu hesla." },
    token_problems: { reason: (e) => `${e.problem} účet(ov) má expirované/neplatné tokeny${e.expiringSoon ? `, ${e.expiringSoon} čoskoro vyprší` : ""}.`, recommendation: () => "Znovu pripojte dotknuté účty a obnovte tokeny." },
    unhealthy_connections: { reason: (e) => `${e.unhealthy} z ${e.total} pripojení nie je v poriadku.`, recommendation: () => "Znovu pripojte alebo opravte dotknuté účty." },
    inactive_accounts: { reason: (e) => `${e.inactive} z ${e.total} účtov nie je aktívnych.`, recommendation: () => "Dokončite pripojenie alebo znovu pripojte neaktívne účty." },
    monitoring_off: { reason: (e) => `${e.off} z ${e.total} účtov má vypnuté monitorovanie.`, recommendation: () => "Zapnite monitorovanie, aby sa analyzoval nový obsah." },
    low_protection_coverage: { reason: (e) => `Pokrytie ochrany reputácie je ${e.protectionScore}/100.`, recommendation: () => "Nakonfigurujte Auto-Protect politiky a pravidlá pre značky." },
    stale_incidents: { reason: (e) => `${e.aged} z ${e.open} otvorených incidentov je starších ako 72 hodín.`, recommendation: () => "Vyriešte staré incidenty." },
    stale_approvals: { reason: (e) => `${e.aged} z ${e.pending} schvaľovaní čaká viac ako 48 hodín.`, recommendation: () => "Vyprázdnite frontu schvaľovaní." },
    aged_high_risk: { reason: (e) => `${e.aged} z ${e.highRisk} vysoko/kriticky rizikových položiek je nevyriešených 48h+.`, recommendation: () => "Skontrolujte a vyriešte rizikové položky." },
    access_restricted: { reason: () => "Prístup k workspace je obmedzený alebo pozastavený.", recommendation: () => "Obnovte fakturáciu pre plný prístup." },
    no_retention_policy: { reason: () => "Nie je nastavené okno retencie údajov.", recommendation: () => "Nastavte retenčnú politiku pre váš plán." },
    encryption_plaintext_deployed: { reason: (e) => `OAuth tokeny sú uložené v PLAINTEXTE v reálnom ${e.environment} nasadení (TOKEN_ENCRYPTION_MODE=${e.mode}).`, recommendation: () => "Okamžite nastavte TOKEN_ENCRYPTION_MODE=aes-gcm (s TOKEN_ENCRYPTION_KEY) alebo kms." },
    encryption_local_dev: { reason: (e) => `Šifrovanie v pokoji sa týka nasadení; toto je lokálne/dev prostredie (režim: ${e.mode}).`, recommendation: () => "Lokálne nie je potrebná akcia." },
    encryption_unknown: { reason: () => "Stav šifrovania tokenov sa pre toto prostredie nepodarilo určiť.", recommendation: () => "Overte TOKEN_ENCRYPTION_MODE a prostredie nasadenia." },
    mfa_not_available: { reason: () => "Viacfaktorové overenie zatiaľ nie je dostupné.", recommendation: () => "Plánované do budúcej verzie." },
    breach_data_not_available: { reason: () => "Údaje o úniku sa zatiaľ nezbierajú.", recommendation: () => "Plánované do budúcej verzie." },
    permission_baseline_not_available: { reason: () => "Zatiaľ nie je zaznamenaná základňa oprávnení na detekciu zmien.", recommendation: () => "Dostupné, keď pribudne história." },
    encryption_dev_only: { reason: () => "Šifrovanie v pokoji sa overuje len v produkcii (dev používa plaintext zámerne).", recommendation: () => "Lokálne nie je potrebná akcia." },
    no_password_users: { reason: () => "Všetci členovia sa prihlasujú cez OAuth — žiadne heslá.", recommendation: () => "Netreba akciu." },
    no_members: { reason: () => "Zatiaľ žiadni členovia na vyhodnotenie.", recommendation: () => "Pozvite členov." },
    no_sessions: { reason: () => "Žiadne aktívne relácie na vyhodnotenie.", recommendation: () => "Prihláste sa pre údaje o reláciách." },
    no_connected_accounts: { reason: () => "Zatiaľ nie sú pripojené žiadne platformové účty.", recommendation: () => "Pripojte účet na meranie bezpečnosti konektorov." },
    no_monitored_accounts: { reason: () => "Žiadne monitorované účty na meranie pokrytia ochrany.", recommendation: () => "Pripojte a monitorujte účet." },
    no_activity: { reason: () => "Zatiaľ žiadne incidenty, schvaľovania ani položky na posúdenie reakcie.", recommendation: () => "Pripravenosť sa objaví, keď bude aktivita." },
    no_audit_activity: { reason: () => "Žiadna nedávna audit aktivita na potvrdenie záznamu.", recommendation: () => "Audit sa napĺňa používaním workspace." },
  },
  de: {
    unverified_members: { reason: (e) => `${e.unverified} von ${e.total} Mitgliedern haben ihre E-Mail nicht verifiziert.`, recommendation: () => "Bitten Sie sie, ihre E-Mail zu verifizieren." },
    stale_sessions: { reason: (e) => `${e.stale} von ${e.active} aktiven Sitzungen wurden seit 30+ Tagen nicht genutzt.`, recommendation: () => "Widerrufen Sie alte Sitzungen unter Einstellungen → Sicherheit." },
    over_privileged: { reason: (e) => `${e.admins} von ${e.total} Mitgliedern haben Eigentümer-/Admin-Rechte.`, recommendation: () => "Least Privilege anwenden — nicht benötigte Admin-Rechte entziehen." },
    old_passwords: { reason: (e) => `${e.old} von ${e.passwordUsers} Passwörtern sind älter als 365 Tage.`, recommendation: () => "Betroffene Mitglieder sollten ihr Passwort ändern." },
    token_problems: { reason: (e) => `${e.problem} Konto(s) haben abgelaufene/ungültige Tokens${e.expiringSoon ? `, ${e.expiringSoon} laufen bald ab` : ""}.`, recommendation: () => "Verbinden Sie die betroffenen Konten neu." },
    unhealthy_connections: { reason: (e) => `${e.unhealthy} von ${e.total} Verbindungen sind fehlerhaft.`, recommendation: () => "Betroffene Konten neu verbinden oder reparieren." },
    inactive_accounts: { reason: (e) => `${e.inactive} von ${e.total} Konten sind nicht aktiv.`, recommendation: () => "Verbindung abschließen oder inaktive Konten neu verbinden." },
    monitoring_off: { reason: (e) => `${e.off} von ${e.total} Konten haben die Überwachung deaktiviert.`, recommendation: () => "Überwachung aktivieren, damit neue Inhalte analysiert werden." },
    low_protection_coverage: { reason: (e) => `Die Reputationsschutz-Abdeckung beträgt ${e.protectionScore}/100.`, recommendation: () => "Auto-Protect-Richtlinien und Regeln konfigurieren." },
    stale_incidents: { reason: (e) => `${e.aged} von ${e.open} offenen Vorfällen sind älter als 72 Stunden.`, recommendation: () => "Alte Vorfälle bearbeiten und lösen." },
    stale_approvals: { reason: (e) => `${e.aged} von ${e.pending} Freigaben warten seit über 48 Stunden.`, recommendation: () => "Freigabe-Warteschlange leeren." },
    aged_high_risk: { reason: (e) => `${e.aged} von ${e.highRisk} hohen/kritischen Elementen sind seit 48h+ ungelöst.`, recommendation: () => "Hochrisiko-Elemente prüfen und bearbeiten." },
    access_restricted: { reason: () => "Der Workspace-Zugriff ist eingeschränkt oder gesperrt.", recommendation: () => "Abrechnung wiederherstellen für vollen Zugriff." },
    no_retention_policy: { reason: () => "Kein Datenaufbewahrungsfenster konfiguriert.", recommendation: () => "Aufbewahrungsrichtlinie für Ihren Tarif festlegen." },
    encryption_plaintext_deployed: { reason: (e) => `OAuth-Tokens werden im KLARTEXT in einer echten ${e.environment}-Bereitstellung gespeichert (TOKEN_ENCRYPTION_MODE=${e.mode}).`, recommendation: () => "Sofort TOKEN_ENCRYPTION_MODE=aes-gcm (mit TOKEN_ENCRYPTION_KEY) oder kms setzen." },
    encryption_local_dev: { reason: (e) => `Verschlüsselung im Ruhezustand betrifft Bereitstellungen; dies ist eine lokale/Dev-Umgebung (Modus: ${e.mode}).`, recommendation: () => "Lokal keine Aktion nötig." },
    encryption_unknown: { reason: () => "Der Token-Verschlüsselungsstatus konnte für diese Umgebung nicht ermittelt werden.", recommendation: () => "TOKEN_ENCRYPTION_MODE und die Bereitstellungsumgebung prüfen." },
    mfa_not_available: { reason: () => "Mehr-Faktor-Authentifizierung ist noch nicht verfügbar.", recommendation: () => "Für ein künftiges Release vorgesehen." },
    breach_data_not_available: { reason: () => "Datenleck-Daten werden noch nicht erfasst.", recommendation: () => "Für ein künftiges Release vorgesehen." },
    permission_baseline_not_available: { reason: () => "Noch keine Berechtigungs-Baseline zur Drift-Erkennung.", recommendation: () => "Verfügbar, sobald Historie vorliegt." },
    encryption_dev_only: { reason: () => "Verschlüsselung im Ruhezustand wird nur in der Produktion geprüft (Dev nutzt bewusst Klartext).", recommendation: () => "Lokal keine Aktion nötig." },
    no_password_users: { reason: () => "Alle Mitglieder melden sich per OAuth an — keine Passwörter.", recommendation: () => "Keine Aktion nötig." },
    no_members: { reason: () => "Noch keine Workspace-Mitglieder zu bewerten.", recommendation: () => "Mitglieder einladen." },
    no_sessions: { reason: () => "Keine aktiven Sitzungen zu bewerten.", recommendation: () => "Anmelden, um Sitzungsdaten zu erzeugen." },
    no_connected_accounts: { reason: () => "Noch keine Plattformkonten verbunden.", recommendation: () => "Ein Konto verbinden, um Konnektor-Sicherheit zu messen." },
    no_monitored_accounts: { reason: () => "Keine überwachten Konten zur Messung der Schutzabdeckung.", recommendation: () => "Ein Konto verbinden und überwachen." },
    no_activity: { reason: () => "Noch keine Vorfälle, Freigaben oder Elemente zur Bewertung der Reaktion.", recommendation: () => "Reaktionsbereitschaft erscheint bei Aktivität." },
    no_audit_activity: { reason: () => "Keine aktuelle Audit-Aktivität zur Bestätigung des Trails.", recommendation: () => "Der Audit-Trail füllt sich mit der Nutzung." },
  },
};

export const CHROME: Record<Locale, ScoreChrome> = {
  en: {
    scoreTitle: "Security Score", outOf: "/ 100", insufficient: "Insufficient data", insufficientHint: "Connect accounts and invite members so more dimensions can be measured.",
    coverage: (m, t) => `Based on ${m} of ${t} dimensions`, confidence: { high: "High confidence", medium: "Medium confidence", low: "Low confidence" },
    renormalized: "Weights renormalized over measured dimensions.", weightLabel: "weight", breakdownTitle: "Dimension breakdown", recommendationsTitle: "Reasons & recommendations",
    noRecommendations: "No deductions — every measured factor is at full score.", recommendationLabel: "Recommendation", reasonLabel: "Reason", notAvailable: "Not available", insufficientDim: "Insufficient data",
    saveSnapshot: "Recompute & save snapshot", savedNotice: "Snapshot saved.", level: { strong: "Strong", fair: "Fair", weak: "Weak" }, critical: "Critical", detectOnly: "Deterministic and explainable — no AI, no fabricated data.",
  },
  sk: {
    scoreTitle: "Bezpečnostné skóre", outOf: "/ 100", insufficient: "Nedostatok údajov", insufficientHint: "Pripojte účty a pozvite členov, aby sa dalo zmerať viac dimenzií.",
    coverage: (m, t) => `Na základe ${m} z ${t} dimenzií`, confidence: { high: "Vysoká istota", medium: "Stredná istota", low: "Nízka istota" },
    renormalized: "Váhy prepočítané cez zmerané dimenzie.", weightLabel: "váha", breakdownTitle: "Rozpis dimenzií", recommendationsTitle: "Dôvody a odporúčania",
    noRecommendations: "Žiadne odpočty — každý zmeraný faktor má plné skóre.", recommendationLabel: "Odporúčanie", reasonLabel: "Dôvod", notAvailable: "Nedostupné", insufficientDim: "Nedostatok údajov",
    saveSnapshot: "Prepočítať a uložiť snapshot", savedNotice: "Snapshot uložený.", level: { strong: "Silné", fair: "Priemerné", weak: "Slabé" }, critical: "Kritické", detectOnly: "Deterministické a vysvetliteľné — bez AI, bez vymyslených údajov.",
  },
  de: {
    scoreTitle: "Security Score", outOf: "/ 100", insufficient: "Unzureichende Daten", insufficientHint: "Verbinden Sie Konten und laden Sie Mitglieder ein, damit mehr Dimensionen messbar sind.",
    coverage: (m, t) => `Basierend auf ${m} von ${t} Dimensionen`, confidence: { high: "Hohe Konfidenz", medium: "Mittlere Konfidenz", low: "Geringe Konfidenz" },
    renormalized: "Gewichte auf gemessene Dimensionen normalisiert.", weightLabel: "Gewicht", breakdownTitle: "Dimensions-Aufschlüsselung", recommendationsTitle: "Gründe & Empfehlungen",
    noRecommendations: "Keine Abzüge — jeder gemessene Faktor hat volle Punktzahl.", recommendationLabel: "Empfehlung", reasonLabel: "Grund", notAvailable: "Nicht verfügbar", insufficientDim: "Unzureichende Daten",
    saveSnapshot: "Neu berechnen & Snapshot speichern", savedNotice: "Snapshot gespeichert.", level: { strong: "Stark", fair: "Mittel", weak: "Schwach" }, critical: "Kritisch", detectOnly: "Deterministisch und erklärbar — keine KI, keine erfundenen Daten.",
  },
};
