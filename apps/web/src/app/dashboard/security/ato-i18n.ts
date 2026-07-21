import { type Locale } from "@/i18n/config";
import { SecurityDetectionKind, SecurityDetectionStatus, RiskLevel } from "@guardora/core";

/**
 * S2 — copy for the "Potential Account Takeover" section. Kind/status/severity labels are keyed by the
 * PERSISTED string values so a row maps to a label without a second lookup table. Detection-only, honest
 * wording: never a confirmed compromise, always "possible".
 */
export interface AtoCopy {
  title: string;
  subtitle: string;
  noDetections: string;
  noDetectionsHint: string;
  openCount: (n: number) => string;
  col: { type: string; severity: string; confidence: string; reason: string; status: string; when: string };
  detectOnly: string;
  kind: Record<string, string>;
  status: Record<string, string>;
  severity: Record<string, string>;
}

const K = SecurityDetectionKind;
const S = SecurityDetectionStatus;
const R = RiskLevel;

export const ATO_COPY: Record<Locale, AtoCopy> = {
  en: {
    title: "Potential Account Takeover",
    subtitle: "Deterministic signals of a possible account takeover — never a confirmed claim. Every detection is reviewed by a human before any action.",
    noDetections: "No detections",
    noDetectionsHint: "No possible-takeover signals for your workspace. This list fills only from deterministic, auditable signals — no AI, no geolocation.",
    openCount: (n) => (n === 1 ? "1 open detection" : `${n} open detections`),
    col: { type: "Type", severity: "Severity", confidence: "Confidence", reason: "Reason", status: "Status", when: "Detected" },
    detectOnly: "Detection & review only — Tamanor never acts on a platform by itself.",
    kind: {
      [K.NewDevice]: "Unknown device",
      [K.SessionAnomaly]: "Session anomaly",
      [K.PasswordChanged]: "Password changed",
      [K.PrivilegeEscalation]: "Privilege changed",
      [K.TokenRevoked]: "Token revoked",
      [K.TokenExpired]: "Token expired",
      [K.MultipleFailedActions]: "Multiple failed actions",
      [K.ManualFlag]: "Manual flag",
    },
    status: {
      [S.Open]: "New",
      [S.Acknowledged]: "Acknowledged",
      [S.Resolved]: "Resolved",
      [S.Dismissed]: "False positive",
      [S.Confirmed]: "Confirmed",
    },
    severity: { [R.Critical]: "Critical", [R.High]: "High", [R.Medium]: "Medium", [R.Low]: "Low", [R.None]: "Info" },
  },
  sk: {
    title: "Možné prevzatie účtu",
    subtitle: "Deterministické signály možného prevzatia účtu — nikdy nie potvrdené tvrdenie. Každú detekciu pred akoukoľvek akciou posúdi človek.",
    noDetections: "Žiadne detekcie",
    noDetectionsHint: "Žiadne signály možného prevzatia pre váš workspace. Tento zoznam sa napĺňa len z deterministických, auditovateľných signálov — bez AI, bez geolokácie.",
    openCount: (n) => (n === 1 ? "1 otvorená detekcia" : `${n} otvorených detekcií`),
    col: { type: "Typ", severity: "Závažnosť", confidence: "Istota", reason: "Dôvod", status: "Stav", when: "Zistené" },
    detectOnly: "Iba detekcia a posúdenie — Tamanor nikdy nekoná na platforme sám.",
    kind: {
      [K.NewDevice]: "Neznáme zariadenie",
      [K.SessionAnomaly]: "Anomália relácie",
      [K.PasswordChanged]: "Zmena hesla",
      [K.PrivilegeEscalation]: "Zmena oprávnení",
      [K.TokenRevoked]: "Token zrušený",
      [K.TokenExpired]: "Token vypršal",
      [K.MultipleFailedActions]: "Viacero zlyhaných akcií",
      [K.ManualFlag]: "Manuálne označenie",
    },
    status: {
      [S.Open]: "Nové",
      [S.Acknowledged]: "Potvrdené prijatie",
      [S.Resolved]: "Vyriešené",
      [S.Dismissed]: "Falošný poplach",
      [S.Confirmed]: "Potvrdené",
    },
    severity: { [R.Critical]: "Kritická", [R.High]: "Vysoká", [R.Medium]: "Stredná", [R.Low]: "Nízka", [R.None]: "Info" },
  },
  de: {
    title: "Mögliche Kontoübernahme",
    subtitle: "Deterministische Signale einer möglichen Kontoübernahme — nie eine bestätigte Behauptung. Jede Erkennung wird vor jeder Aktion von einem Menschen geprüft.",
    noDetections: "Keine Erkennungen",
    noDetectionsHint: "Keine Signale möglicher Übernahme für Ihren Workspace. Diese Liste füllt sich nur aus deterministischen, prüfbaren Signalen — keine KI, keine Geolokalisierung.",
    openCount: (n) => (n === 1 ? "1 offene Erkennung" : `${n} offene Erkennungen`),
    col: { type: "Typ", severity: "Schweregrad", confidence: "Konfidenz", reason: "Grund", status: "Status", when: "Erkannt" },
    detectOnly: "Nur Erkennung und Prüfung — Tamanor handelt nie selbst auf einer Plattform.",
    kind: {
      [K.NewDevice]: "Unbekanntes Gerät",
      [K.SessionAnomaly]: "Sitzungsanomalie",
      [K.PasswordChanged]: "Passwort geändert",
      [K.PrivilegeEscalation]: "Rechte geändert",
      [K.TokenRevoked]: "Token widerrufen",
      [K.TokenExpired]: "Token abgelaufen",
      [K.MultipleFailedActions]: "Mehrere fehlgeschlagene Aktionen",
      [K.ManualFlag]: "Manuelle Markierung",
    },
    status: {
      [S.Open]: "Neu",
      [S.Acknowledged]: "Bestätigt erhalten",
      [S.Resolved]: "Gelöst",
      [S.Dismissed]: "Fehlalarm",
      [S.Confirmed]: "Bestätigt",
    },
    severity: { [R.Critical]: "Kritisch", [R.High]: "Hoch", [R.Medium]: "Mittel", [R.Low]: "Niedrig", [R.None]: "Info" },
  },
};
