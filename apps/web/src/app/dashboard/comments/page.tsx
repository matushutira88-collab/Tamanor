import Link from "next/link";
import {
  buildActorSignals, actorRiskScore, actorRiskLevel, sentimentBucket,
  type ActorComment, type ActorRiskLevel, type SentimentBucket, type AiDiagnostics,
} from "@guardora/ai";
import { getPlatformConnector, platformKeyFor, actorIdentityKey, PLATFORM_META, ALL_PLATFORMS, can, Permission, Role, providerCapabilities, connectorHealthStatus, type Platform, type ConnectorHealthState } from "@guardora/core";
import { InboxControls } from "./inbox-controls";
import { LabelSelector, LabelManager, type LabelLite } from "./label-editor";
import { AssigneeSelector, type MemberLite } from "./assignee-editor";
import { NotesSection, type NoteLite } from "./notes-section";
import { SelectionProvider, SelectCheckbox, SelectAllCheckbox, BulkActionBar } from "./inbox-selection";
import { PageHeader, Card, Badge, StatusDot } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import {
  withTenant, listInboxPage, inboxCounts, INBOX_PAGE_SIZE,
  type InboxItemRow, type InboxFilterInput, type InboxView,
} from "@guardora/db";
import { getRealModeFilter } from "@/server/data-mode";
import { getTL } from "@/i18n/server";
import type { Locale } from "@/i18n";
import { tEnum } from "@/i18n/labels";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

// V1.43 — date range is now an OPTIONAL narrowing filter over a fully paginated inbox (default:
// all-time). Pagination — not a fetch cap — bounds what the browser loads.
const RANGES = { all: null, today: 1, "7d": 7, "30d": 30 } as const;
type RangeKey = keyof typeof RANGES;
// V1.43 — the sentiment filter is a real server-side bucket predicate (positive/neutral/negative/
// risky). The old cross-table "hidden"/"pending" chips are gone: they are derived from other tables
// and cannot be keyset-paginated on reputation_items (see the release notes). Per-item hidden/pending
// state is still shown as a badge on each card.
const SENT_FILTERS = ["all", "positive", "neutral", "negative", "risky"] as const;
type FilterKey = (typeof SENT_FILTERS)[number];

const HIDE_REASONS = ["live_hide_executed", "already_hidden"];
const BUCKET_TONE: Record<SentimentBucket, "ok" | "neutral" | "warn" | "danger"> = { positive: "ok", neutral: "neutral", negative: "warn", risky: "danger" };

interface AuditLite { id: string; label: string; actor: string; at: string }

// V1.61 — ADMIN-ONLY per-comment classification breakdown. Never contains comment text, prompt, API key,
// or raw model output — structured verdicts + provider metadata only. Populated solely for admins/owners.
interface AdminDiag {
  callMode: string;
  gateReason: string | null;
  rules: { level: string; confidence: number; categories: string[] } | null;
  ai: { called: boolean; provider: string; status: string; errorCode: string | null; verdict: { level: string; confidence: number; categories: string[] } | null };
  merged: { level: string; confidence: number; categories: string[] } | null;
  // model + tokens + cost are JOINED from the finalized (succeeded) paid UsageEvent — never duplicated in
  // aiDiagnostics. `usageAvailable` is false when no such row exists (historical/cached/failed) → the panel
  // shows "Usage details unavailable" instead of a misleading "—".
  usageAvailable: boolean;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: number | null;
}

// Self-contained localized copy for the customer chip + the admin diagnostics panel (kept out of the large
// CommentsCopy map). The chip is customer-visible; the panel is admin-only.
const DIAG_COPY: Record<Locale, {
  chipBasic: string; chipAi: string; heading: string; rules: string; ai: string; merged: string;
  callMode: string; model: string; tokens: string; cost: string; gate: string; aiStatus: string; notCalled: string; error: string; none: string; usageUnavailable: string;
}> = {
  en: { chipBasic: "Basic protection", chipAi: "AI assisted", heading: "AI diagnostics (admin only)", rules: "Rules result", ai: "AI result", merged: "Merged result", callMode: "Call mode", model: "Model", tokens: "Tokens (in/out/total)", cost: "Cost", gate: "Gate", aiStatus: "AI status", notCalled: "not called", error: "Error", none: "—", usageUnavailable: "Usage details unavailable" },
  sk: { chipBasic: "Základná ochrana", chipAi: "S pomocou AI", heading: "AI diagnostika (len admin)", rules: "Výsledok pravidiel", ai: "Výsledok AI", merged: "Zlúčený výsledok", callMode: "Režim volania", model: "Model", tokens: "Tokeny (in/out/spolu)", cost: "Náklad", gate: "Brána", aiStatus: "AI stav", notCalled: "nevolané", error: "Chyba", none: "—", usageUnavailable: "Údaje o spotrebe nedostupné" },
  de: { chipBasic: "Basisschutz", chipAi: "KI-unterstützt", heading: "KI-Diagnose (nur Admin)", rules: "Regel-Ergebnis", ai: "KI-Ergebnis", merged: "Zusammengeführtes Ergebnis", callMode: "Aufrufmodus", model: "Modell", tokens: "Tokens (ein/aus/gesamt)", cost: "Kosten", gate: "Gate", aiStatus: "KI-Status", notCalled: "nicht aufgerufen", error: "Fehler", none: "—", usageUnavailable: "Nutzungsdetails nicht verfügbar" },
};
const microsToUsd = (m: number | null): string => (m === null ? "—" : `$${(m / 1_000_000).toFixed(6)}`);

// Merge the persisted per-comment breakdown (aiDiagnostics) with the finalized cost/model (UsageEvent) and
// the AI provider-call status/error (ProviderCall). Historical rows without aiDiagnostics degrade gracefully.
function buildDiag(
  r: InboxItemRow,
  usage: { modelKey: string | null; actualCostMicros: bigint | null; inputTokens: number | null; outputTokens: number | null } | undefined,
  aiCall: { provider: string; status: string; errorCode: string | null } | undefined,
): AdminDiag {
  const d = (r.aiDiagnostics ?? null) as AiDiagnostics | null;
  return {
    callMode: d?.callMode ?? "value_gated",
    // Gate reason: prefer the pipeline decision in aiDiagnostics; fall back to the metered processingReason
    // for historical rows written before aiDiagnostics existed.
    gateReason: d?.gate?.reason ?? r.processingReason ?? null,
    rules: d?.rules ?? null,
    ai: {
      called: d?.gate?.aiCalled ?? (aiCall ? aiCall.status !== "skipped" : false),
      provider: aiCall?.provider ?? (r.aiProvider as string) ?? "none",
      status: d?.ai.status ?? aiCall?.status ?? "skipped",
      errorCode: d?.ai.errorCode ?? aiCall?.errorCode ?? null,
      verdict: d?.ai.verdict ?? null,
    },
    merged: d?.merged ?? { level: r.riskLevel as string, confidence: (r.riskConfidence as number) ?? 0, categories: (r.riskCategories ?? []) as string[] },
    // model + tokens + cost are JOINED from the finalized paid UsageEvent — never duplicated in aiDiagnostics.
    usageAvailable: !!usage,
    model: usage?.modelKey ?? null,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    costMicros: usage?.actualCostMicros != null ? Number(usage.actualCostMicros) : null,
  };
}

interface Row {
  id: string; text: string; author: string; authorKey: string | null; platformLabel: string; account: string;
  permalink: string | null; createdAt: Date; bucket: SentimentBucket; riskLevel: string; category: string | null;
  statusKey: string; hiddenPublic: boolean; pending: boolean; resolved: boolean; queueItemId: string | null;
  actorLevel: ActorRiskLevel | null; cantHide: boolean; isReview: boolean; rating: number | null; providerKey: string;
  isRead: boolean; archived: boolean; priority: string; workflowStatus: string; assigneeId: string | null; assigneeName: string | null;
  labels: LabelLite[]; noteCount: number; connectorHealth: ConnectorHealthState;
  processingStatus: string; processingTier: string | null; processingReason: string | null; lastProcessedAt: Date | null; classifierVersion: string | null;
  classificationMode: string; diag: AdminDiag | null;
}

// Honest connector-health tone (never a fake green). Only a truly healthy connector is "ok".
const HEALTH_TONE: Record<ConnectorHealthState, "ok" | "warn" | "danger" | "neutral"> = {
  healthy: "ok", verification_pending: "warn", rate_limited: "warn",
  permission_missing: "danger", disconnected: "danger", api_unavailable: "neutral", error: "danger",
};

// V1.44B — truthful per-item processing state. A limit/disabled/failed status NEVER implies
// fabricated analysis — it means the advanced tier did not run.
const PROCESSING_TONE: Record<string, "ok" | "neutral" | "warn" | "danger"> = {
  pending: "neutral", processed_rules: "neutral", processed_local: "neutral", processed_paid: "ok", cached: "neutral",
  basic_limit_reached: "warn", premium_limit_reached: "warn", paid_ai_disabled: "neutral", failed: "danger",
};
const PROCESSING_LIMIT_STATES = new Set(["basic_limit_reached", "premium_limit_reached", "paid_ai_disabled"]);

// ---- In-file localized copy for every human-visible string not already covered by the shared
// dictionary (t.*). Identifiers/proper nouns (Tamanor, platform names, AI/KI) are intentional. ----
interface CommentsCopy {
  audit: Record<string, string>;
  health: Record<ConnectorHealthState, string>;
  processing: Record<string, string>;
  priority: Record<string, string>;
  workflow: Record<string, string>;
  removedMember: string;
  systemActor: string;
  allTime: string;
  viewInbox: string;
  viewUnread: string;
  viewArchived: string;
  viewAssignedMe: string;
  viewUnassigned: string;
  anyPriority: string;
  anyStatus: string;
  anyRisk: string;
  allLabels: string;
  emptyUnread: string;
  emptyArchived: string;
  emptyAssignedMe: string;
  emptyUnassigned: string;
  onThisPage: (shown: number, total: number) => string;
  unreadTitle: string;
  notes: (n: number) => string;
  ratingOnly: string;
  tierLabel: (tier: string) => string;
  checkedPrefix: string;
  viewUsage: string;
  workflowHeading: string;
  labelsHeading: string;
  notesHeading: string;
  notesHeadingSub: string;
  activityHeading: string;
  noActivity: string;
  pageNewest: string;
  pagePrev: string;
  pageNext: string;
  showingOf: (shown: number, total: number) => string;
}

const COPY: Record<Locale, CommentsCopy> = {
  en: {
    audit: {
      "inbox.mark_read": "Marked read", "inbox.mark_unread": "Marked unread",
      "inbox.archive": "Archived in Tamanor", "inbox.unarchive": "Unarchived",
      "inbox.set_priority": "Priority changed", "inbox.set_workflow_status": "Status changed",
      "inbox.assign": "Assigned", "inbox.unassign": "Unassigned",
      "inbox.label_assign": "Label added", "inbox.label_remove": "Label removed",
      "inbox.note_add": "Note added",
    },
    health: {
      healthy: "Connector healthy", verification_pending: "Verification pending", rate_limited: "Rate limited",
      permission_missing: "Permission missing", disconnected: "Disconnected", api_unavailable: "Not available", error: "Connector error",
    },
    processing: {
      pending: "Awaiting analysis",
      processed_rules: "Checked with basic protection",
      processed_local: "Checked with local AI",
      processed_paid: "Checked with advanced AI",
      cached: "Reused previous analysis",
      basic_limit_reached: "Monthly basic AI limit reached",
      premium_limit_reached: "Advanced AI limit reached",
      paid_ai_disabled: "Advanced AI is currently disabled",
      failed: "Analysis could not be completed",
    },
    priority: { low: "low", normal: "normal", high: "high", urgent: "urgent" },
    workflow: { new: "new", in_review: "in review", action_required: "action required", resolved: "resolved" },
    removedMember: "Removed member",
    systemActor: "System",
    allTime: "All time",
    viewInbox: "Inbox",
    viewUnread: "Unread",
    viewArchived: "Archived",
    viewAssignedMe: "Assigned to me",
    viewUnassigned: "Unassigned",
    anyPriority: "Any priority",
    anyStatus: "Any status",
    anyRisk: "Any risk",
    allLabels: "All labels",
    emptyUnread: "No unread items.",
    emptyArchived: "Nothing archived.",
    emptyAssignedMe: "Nothing assigned to you.",
    emptyUnassigned: "No unassigned items.",
    onThisPage: (shown, total) => `${shown} on this page · ${total} total`,
    unreadTitle: "Unread",
    notes: (n) => `${n} note${n === 1 ? "" : "s"}`,
    ratingOnly: "Rating only — no written review.",
    tierLabel: (tier) => `${tier} tier`,
    checkedPrefix: "checked",
    viewUsage: "View usage & limits →",
    workflowHeading: "Workflow",
    labelsHeading: "Labels",
    notesHeading: "Notes",
    notesHeadingSub: "· internal, never sent to the platform",
    activityHeading: "Activity",
    noActivity: "No activity yet.",
    pageNewest: "⇤ Newest",
    pagePrev: "← Previous",
    pageNext: "Next →",
    showingOf: (shown, total) => (shown ? `Showing ${shown} of ${total}` : `0 of ${total}`),
  },
  sk: {
    audit: {
      "inbox.mark_read": "Označené ako prečítané", "inbox.mark_unread": "Označené ako neprečítané",
      "inbox.archive": "Archivované v Tamanor", "inbox.unarchive": "Vrátené z archívu",
      "inbox.set_priority": "Zmenená priorita", "inbox.set_workflow_status": "Zmenený stav",
      "inbox.assign": "Priradené", "inbox.unassign": "Zrušené priradenie",
      "inbox.label_assign": "Pridaný štítok", "inbox.label_remove": "Odstránený štítok",
      "inbox.note_add": "Pridaná poznámka",
    },
    health: {
      healthy: "Konektor v poriadku", verification_pending: "Čaká sa na overenie", rate_limited: "Obmedzený počet požiadaviek",
      permission_missing: "Chýba oprávnenie", disconnected: "Odpojené", api_unavailable: "Nedostupné", error: "Chyba konektora",
    },
    processing: {
      pending: "Čaká na analýzu",
      processed_rules: "Skontrolované základnou ochranou",
      processed_local: "Skontrolované lokálnou AI",
      processed_paid: "Skontrolované pokročilou AI",
      cached: "Použitá predchádzajúca analýza",
      basic_limit_reached: "Mesačný limit základnej AI dosiahnutý",
      premium_limit_reached: "Limit pokročilej AI dosiahnutý",
      paid_ai_disabled: "Pokročilá AI je momentálne vypnutá",
      failed: "Analýzu sa nepodarilo dokončiť",
    },
    priority: { low: "nízka", normal: "normálna", high: "vysoká", urgent: "urgentná" },
    workflow: { new: "nové", in_review: "v riešení", action_required: "vyžaduje akciu", resolved: "vyriešené" },
    removedMember: "Odstránený člen",
    systemActor: "Systém",
    allTime: "Celé obdobie",
    viewInbox: "Doručené",
    viewUnread: "Neprečítané",
    viewArchived: "Archivované",
    viewAssignedMe: "Priradené mne",
    viewUnassigned: "Nepriradené",
    anyPriority: "Ľubovoľná priorita",
    anyStatus: "Ľubovoľný stav",
    anyRisk: "Ľubovoľné riziko",
    allLabels: "Všetky štítky",
    emptyUnread: "Žiadne neprečítané položky.",
    emptyArchived: "Nič nie je archivované.",
    emptyAssignedMe: "Vám nie je nič priradené.",
    emptyUnassigned: "Žiadne nepriradené položky.",
    onThisPage: (shown, total) => `${shown} na tejto stránke · ${total} celkovo`,
    unreadTitle: "Neprečítané",
    notes: (n) => `${n} ${n === 1 ? "poznámka" : n >= 2 && n <= 4 ? "poznámky" : "poznámok"}`,
    ratingOnly: "Iba hodnotenie — bez písomnej recenzie.",
    tierLabel: (tier) => `úroveň ${tier}`,
    checkedPrefix: "skontrolované",
    viewUsage: "Zobraziť spotrebu a limity →",
    workflowHeading: "Pracovný postup",
    labelsHeading: "Štítky",
    notesHeading: "Poznámky",
    notesHeadingSub: "· interné, nikdy sa neodosielajú na platformu",
    activityHeading: "Aktivita",
    noActivity: "Zatiaľ žiadna aktivita.",
    pageNewest: "⇤ Najnovšie",
    pagePrev: "← Predchádzajúce",
    pageNext: "Ďalšie →",
    showingOf: (shown, total) => (shown ? `Zobrazuje sa ${shown} z ${total}` : `0 z ${total}`),
  },
  de: {
    audit: {
      "inbox.mark_read": "Als gelesen markiert", "inbox.mark_unread": "Als ungelesen markiert",
      "inbox.archive": "In Tamanor archiviert", "inbox.unarchive": "Aus Archiv geholt",
      "inbox.set_priority": "Priorität geändert", "inbox.set_workflow_status": "Status geändert",
      "inbox.assign": "Zugewiesen", "inbox.unassign": "Zuweisung aufgehoben",
      "inbox.label_assign": "Label hinzugefügt", "inbox.label_remove": "Label entfernt",
      "inbox.note_add": "Notiz hinzugefügt",
    },
    health: {
      healthy: "Konnektor in Ordnung", verification_pending: "Verifizierung ausstehend", rate_limited: "Ratenbegrenzung aktiv",
      permission_missing: "Berechtigung fehlt", disconnected: "Getrennt", api_unavailable: "Nicht verfügbar", error: "Konnektor-Fehler",
    },
    processing: {
      pending: "Warten auf Analyse",
      processed_rules: "Mit Basisschutz geprüft",
      processed_local: "Mit lokaler KI geprüft",
      processed_paid: "Mit erweiterter KI geprüft",
      cached: "Vorherige Analyse wiederverwendet",
      basic_limit_reached: "Monatliches Basis-KI-Limit erreicht",
      premium_limit_reached: "Limit der erweiterten KI erreicht",
      paid_ai_disabled: "Erweiterte KI ist derzeit deaktiviert",
      failed: "Analyse konnte nicht abgeschlossen werden",
    },
    priority: { low: "niedrig", normal: "normal", high: "hoch", urgent: "dringend" },
    workflow: { new: "neu", in_review: "in Prüfung", action_required: "Aktion erforderlich", resolved: "gelöst" },
    removedMember: "Entferntes Mitglied",
    systemActor: "System",
    allTime: "Gesamter Zeitraum",
    viewInbox: "Posteingang",
    viewUnread: "Ungelesen",
    viewArchived: "Archiviert",
    viewAssignedMe: "Mir zugewiesen",
    viewUnassigned: "Nicht zugewiesen",
    anyPriority: "Beliebige Priorität",
    anyStatus: "Beliebiger Status",
    anyRisk: "Beliebiges Risiko",
    allLabels: "Alle Labels",
    emptyUnread: "Keine ungelesenen Einträge.",
    emptyArchived: "Nichts archiviert.",
    emptyAssignedMe: "Ihnen ist nichts zugewiesen.",
    emptyUnassigned: "Keine nicht zugewiesenen Einträge.",
    onThisPage: (shown, total) => `${shown} auf dieser Seite · ${total} insgesamt`,
    unreadTitle: "Ungelesen",
    notes: (n) => `${n} ${n === 1 ? "Notiz" : "Notizen"}`,
    ratingOnly: "Nur Sternebewertung — keine schriftliche Bewertung.",
    tierLabel: (tier) => `Stufe ${tier}`,
    checkedPrefix: "geprüft",
    viewUsage: "Nutzung & Limits anzeigen →",
    workflowHeading: "Workflow",
    labelsHeading: "Labels",
    notesHeading: "Notizen",
    notesHeadingSub: "· intern, wird nie an die Plattform gesendet",
    activityHeading: "Aktivität",
    noActivity: "Noch keine Aktivität.",
    pageNewest: "⇤ Neueste",
    pagePrev: "← Zurück",
    pageNext: "Weiter →",
    showingOf: (shown, total) => (shown ? `${shown} von ${total} angezeigt` : `0 von ${total}`),
  },
};

export default async function CommentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { t, locale } = await getTL();
  const c = COPY[locale];
  const processingCopy = (s: string) => c.processing[s] ?? c.processing.pending ?? "";
  const session = await requireSession();
  const sp = await searchParams;
  const realMode = await getRealModeFilter(session.tenantId);
  const canAct = can(session.role, Permission.InboxAct); // viewers see no mutation controls
  const isAdmin = session.role === Role.Owner || session.role === Role.Admin; // gates the AI diagnostics panel
  const dc = DIAG_COPY[locale];
  const rel = { justNow: t.cc.relJustNow, minAgo: t.cc.relMinAgo, today: t.cc.relToday };

  // ---- Parse + validate every filter from the URL (all applied server-side) ----
  const range: RangeKey = (["all", "today", "7d", "30d"] as const).includes(sp.range as never) ? (sp.range as RangeKey) : "all";
  const filter: FilterKey = (SENT_FILTERS as readonly string[]).includes(sp.filter ?? "") ? (sp.filter as FilterKey) : "all";
  const providerKey = sp.provider ?? "all";
  const typeFilter: "all" | "comment" | "review" = sp.type === "comment" || sp.type === "review" ? sp.type : "all";
  const q = (sp.q ?? "").trim();
  const view: InboxView = (["unread", "archived", "assigned_me", "unassigned"] as const).includes(sp.view as never) ? (sp.view as InboxView) : "default";
  const wf = (["new", "in_review", "action_required", "resolved"] as const).includes(sp.status as never) ? (sp.status as InboxFilterInput["workflowStatus"]) : undefined;
  const prio = (["low", "normal", "high", "urgent"] as const).includes(sp.priority as never) ? (sp.priority as InboxFilterInput["priority"]) : undefined;
  const riskLevel = (["none", "low", "medium", "high", "critical"] as const).includes(sp.risk as never) ? (sp.risk as InboxFilterInput["riskLevel"]) : undefined;
  const labelFilter = (sp.label ?? "").trim() || undefined;
  const assigneeFilter = (sp.assignee ?? "").trim() || undefined;
  const cursor = sp.cursor || null;
  const dir: "next" | "prev" = sp.dir === "prev" ? "prev" : "next";

  const now = new Date();
  let since: Date | undefined;
  if (range !== "all") {
    const days = RANGES[range] as number;
    const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
    const rangeStart = new Date(dayStart); rangeStart.setUTCDate(rangeStart.getUTCDate() - (days - 1));
    since = rangeStart;
  }
  const platformIn = providerKey !== "all"
    ? (ALL_PLATFORMS.filter((p) => platformKeyFor(p) === providerKey) as InboxFilterInput["platformIn"])
    : undefined;

  const filters: InboxFilterInput = {
    view, selfUserId: session.userId, platformIn,
    type: typeFilter === "all" ? undefined : typeFilter,
    sentiment: filter === "all" ? undefined : (filter as SentimentBucket),
    workflowStatus: wf, priority: prio, riskLevel, labelId: labelFilter, assigneeId: assigneeFilter,
    since, q, brandWhere: realMode.brandWhere,
  };

  // ---- One keyset page + server counts (both fully in SQL). No fetch cap; no in-memory filtering. ----
  const [page, counts] = await Promise.all([
    listInboxPage(session.tenantId, filters, { cursor, dir, pageSize: INBOX_PAGE_SIZE }),
    inboxCounts(session.tenantId, { brandWhere: realMode.brandWhere, since }),
  ]);
  const pageRows: InboxItemRow[] = page.rows;
  const pageIds = pageRows.map((r) => r.id);
  const pageExternalIds = pageRows.map((r) => r.contentItem.externalId).filter(Boolean) as string[];

  const baseWhere = { tenantId: session.tenantId, ...realMode.brandWhere };
  // ---- Per-PAGE enrichment only (bounded by the current page's ids — never the whole dataset) ----
  const [executions, queueItems, accountCount, members, allLabels, noteRows, auditRows, usageRows, aiCallRows] = await withTenant(session.tenantId, (db) => Promise.all([
    pageExternalIds.length
      ? db.platformActionExecution.findMany({ where: { ...baseWhere, status: "executed", reason: { in: [...HIDE_REASONS, "comment_deleted", "facebook_can_hide_false"] }, externalCommentId: { in: pageExternalIds } }, select: { externalCommentId: true, reason: true } })
      : Promise.resolve([] as { externalCommentId: string | null; reason: string | null }[]),
    pageIds.length ? db.actionQueueItem.findMany({ where: { ...baseWhere, itemId: { in: pageIds } }, select: { id: true, itemId: true, queueState: true } }) : Promise.resolve([] as { id: string; itemId: string; queueState: string }[]),
    db.connectedAccount.count({ where: baseWhere }),
    db.membership.findMany({ where: { tenantId: session.tenantId }, select: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } }),
    db.inboxLabel.findMany({ where: { tenantId: session.tenantId }, select: { id: true, name: true, colorKey: true }, orderBy: { normalizedName: "asc" } }),
    pageIds.length ? db.inboxNote.findMany({ where: { reputationItemId: { in: pageIds }, deletedAt: null }, orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, name: true, email: true } } } }) : Promise.resolve([] as never[]),
    pageIds.length ? db.auditLog.findMany({ where: { targetType: "reputation_item", targetId: { in: pageIds }, event: { startsWith: "inbox." } }, orderBy: { createdAt: "desc" }, take: 400, include: { actor: { select: { name: true, email: true } } } }) : Promise.resolve([] as never[]),
    // V1.61 — admin-only diagnostics joins: finalized paid cost/model (UsageEvent) + the AI provider call
    // status/error (ProviderCall). Page-bounded, tenant-scoped, and fetched ONLY for admins/owners.
    isAdmin && pageIds.length ? db.usageEvent.findMany({ where: { reputationItemId: { in: pageIds }, processingTier: "paid", status: "succeeded" }, select: { reputationItemId: true, modelKey: true, actualCostMicros: true, inputTokens: true, outputTokens: true, status: true }, orderBy: { createdAt: "desc" } }) : Promise.resolve([] as { reputationItemId: string | null; modelKey: string | null; actualCostMicros: bigint | null; inputTokens: number | null; outputTokens: number | null; status: string }[]),
    isAdmin && pageIds.length ? db.providerCall.findMany({ where: { itemId: { in: pageIds }, type: "ai_risk" }, select: { itemId: true, provider: true, status: true, errorCode: true }, orderBy: { createdAt: "desc" } }) : Promise.resolve([] as { itemId: string | null; provider: string; status: string; errorCode: string | null }[]),
  ]));

  const memberList: MemberLite[] = members.map((m) => m.user);

  // External-comment-id → terminal state (deleted > hidden > can_hide_false). Page-bounded.
  const execState = new Map<string, "deleted" | "hidden" | "cannot_hide">();
  for (const e of executions) {
    if (!e.externalCommentId) continue;
    const prev = execState.get(e.externalCommentId);
    const next = e.reason === "comment_deleted" ? "deleted" : HIDE_REASONS.includes(e.reason ?? "") ? "hidden" : "cannot_hide";
    if (prev === "deleted" || (prev === "hidden" && next === "cannot_hide")) continue;
    execState.set(e.externalCommentId, next);
  }
  const queueByItem = new Map(queueItems.map((qi) => [qi.itemId, qi]));

  // Admin diagnostics lookups (first row wins = most recent). Empty for non-admins.
  const usageByItem = new Map<string, { modelKey: string | null; actualCostMicros: bigint | null; inputTokens: number | null; outputTokens: number | null }>();
  for (const u of usageRows) { if (u.reputationItemId && !usageByItem.has(u.reputationItemId)) usageByItem.set(u.reputationItemId, u); }
  const aiCallByItem = new Map<string, { provider: string; status: string; errorCode: string | null }>();
  for (const a of aiCallRows) { if (a.itemId && !aiCallByItem.has(a.itemId)) aiCallByItem.set(a.itemId, a); }

  // Per-author risk (medium+), computed over THIS PAGE's rows only (bounded; the full cross-item
  // actor picture lives on /dashboard/actor-risk).
  const authorComments = new Map<string, ActorComment[]>();
  for (const r of pageRows) {
    const ci = r.contentItem;
    const key = actorIdentityKey(platformKeyFor(ci.platform), ci.authorExternalId, ci.authorDisplayName);
    if (!key) continue;
    (authorComments.get(key) ?? authorComments.set(key, []).get(key)!).push({ categories: r.riskCategories ?? [], riskLevel: r.riskLevel as string, sentiment: r.sentiment as string, postId: ci.externalParentId ?? null, text: ci.text, hidden: ci.externalId ? execState.get(ci.externalId) === "hidden" : false });
  }
  const authorLevel = new Map<string, ActorRiskLevel>();
  for (const [key, comments] of authorComments) {
    const level = actorRiskLevel(actorRiskScore(buildActorSignals(comments)));
    if (level !== "low") authorLevel.set(key, level);
  }

  // Build display rows from the current page (presentation transform only — no filtering here).
  const rows: Row[] = pageRows.map((r) => {
    const ci = r.contentItem;
    const cats = r.riskCategories ?? [];
    const bucket = sentimentBucket({ categories: cats, sentiment: r.sentiment as string, riskLevel: r.riskLevel as string });
    const st = ci.externalId ? execState.get(ci.externalId) : undefined;
    const qi = queueByItem.get(r.id);
    const hiddenPublic = st === "hidden";
    const resolved = st === "deleted";
    const pending = qi?.queueState === "approval_required";
    const hiddenKey = ({ hiddenFromPublic: "st_hidden", flagged: "st_flagged", manualReview: "st_manualReview" } as const)[getPlatformConnector(platformKeyFor(ci.platform)).hiddenStateKey()];
    const statusKey = resolved ? "st_deleted"
      : hiddenPublic ? hiddenKey
      : st === "cannot_hide" ? "st_canHideFalse"
      : pending ? "st_pending"
      : qi?.queueState === "monitor" ? "st_monitored"
      : qi?.queueState === "no_action" ? "st_noAction"
      : cats.includes("normal_criticism") ? "st_kept"
      : "st_captured";
    const key = actorIdentityKey(platformKeyFor(ci.platform), ci.authorExternalId, ci.authorDisplayName);
    const pk = platformKeyFor(ci.platform);
    const caps = getPlatformConnector(platformKeyFor(ci.platform)).capabilities;
    const acc = ci.connectedAccount;
    const connectorHealth = connectorHealthStatus({
      platform: pk, supported: providerCapabilities(pk).canReadContent,
      status: acc?.status, health: acc?.health, lastError: acc?.lastError,
      reviewPlatform: ci.kind === "review", verifiedLocationCount: 0,
    });
    return {
      id: r.id, text: ci.text, author: ci.authorDisplayName ?? t.comments.unknownAuthor, authorKey: key,
      platformLabel: PLATFORM_META[ci.platform as Platform]?.label ?? ci.platform, account: ci.connectedAccount?.externalName ?? "—", permalink: ci.permalink,
      createdAt: r.createdAt, bucket, riskLevel: r.riskLevel as string, category: cats[0] ?? null,
      statusKey, hiddenPublic, pending, resolved, queueItemId: qi?.id ?? null, actorLevel: key ? authorLevel.get(key) ?? null : null,
      cantHide: bucket === "risky" && !caps.canHideComment && !hiddenPublic && !resolved,
      isReview: ci.kind === "review",
      rating: ci.rating ?? null,
      providerKey: platformKeyFor(ci.platform),
      isRead: r.isRead,
      archived: r.archivedAt !== null,
      priority: r.priority as string,
      workflowStatus: r.inboxWorkflowStatus as string,
      assigneeId: r.assignedToUserId ?? null,
      assigneeName: r.assignedTo ? (r.assignedTo.name ?? r.assignedTo.email) : null,
      labels: r.inboxLabels.map((l) => l.label),
      noteCount: r._count.inboxNotes,
      connectorHealth,
      processingStatus: (r.processingStatus as string) ?? "pending",
      processingTier: (r.processingTier as string | null) ?? null,
      processingReason: r.processingReason ?? null,
      lastProcessedAt: r.lastProcessedAt ?? null,
      classifierVersion: r.classifierVersion ?? null,
      classificationMode: (r.classificationMode as string) ?? "rules_only",
      diag: isAdmin ? buildDiag(r, usageByItem.get(r.id), aiCallByItem.get(r.id)) : null,
    };
  });

  // Everything that filtered in memory before is now in SQL — the page IS the shown set.
  const shown = rows;
  const shownIds = shown.map((r) => r.id);

  // Metric cards from SERVER counts (correct regardless of pagination).
  const mAll = counts.total;
  const mPositive = counts.sentiment.positive + counts.sentiment.neutral;
  const mNegative = counts.sentiment.negative;
  const mRisky = counts.sentiment.risky;
  const avgRating = counts.avgRating !== null ? counts.avgRating.toFixed(1) : null;
  const hasReviews = counts.reviews > 0;
  // Providers actually present (from server counts, not the current page).
  const providersPresent = [...new Set(Object.keys(counts.byPlatform).map((pl) => platformKeyFor(pl as Platform)))];

  // Batch notes + audit for the SHOWN page items (already page-bounded above).
  const notesByItem = new Map<string, NoteLite[]>();
  for (const n of noteRows as Array<{ id: string; body: string; reputationItemId: string; authorUserId: string | null; createdAt: Date; author: { name: string | null; email: string } | null }>) {
    const list = notesByItem.get(n.reputationItemId) ?? notesByItem.set(n.reputationItemId, []).get(n.reputationItemId)!;
    list.push({ id: n.id, body: n.body, authorName: n.author?.name ?? n.author?.email ?? c.removedMember, authorId: n.authorUserId ?? null, createdAtLabel: relativeTime(n.createdAt, rel, now) });
  }
  const auditByItem = new Map<string, AuditLite[]>();
  for (const a of auditRows as Array<{ id: string; targetId: string | null; event: string; createdAt: Date; actor: { name: string | null; email: string } | null }>) {
    if (!a.targetId) continue;
    const list = auditByItem.get(a.targetId) ?? auditByItem.set(a.targetId, []).get(a.targetId)!;
    if (list.length >= 15) continue;
    list.push({ id: a.id, label: c.audit[a.event] ?? a.event.replace(/^inbox\./, "").replace(/_/g, " "), actor: a.actor?.name ?? a.actor?.email ?? c.systemActor, at: relativeTime(a.createdAt, rel, now) });
  }

  // Generic, reload-safe URL builder. `current` DELIBERATELY excludes cursor/dir, so changing any
  // filter resets pagination to page 1; prev/next set cursor/dir explicitly.
  const current: Record<string, string> = {};
  if (range !== "all") current.range = range;
  if (filter !== "all") current.filter = filter;
  if (providerKey !== "all") current.provider = providerKey;
  if (typeFilter !== "all") current.type = typeFilter;
  if (q) current.q = q;
  if (view !== "default") current.view = view;
  if (wf) current.status = wf;
  if (prio) current.priority = prio;
  if (riskLevel) current.risk = riskLevel;
  if (labelFilter) current.label = labelFilter;
  if (assigneeFilter) current.assignee = assigneeFilter;
  const params = (over: Record<string, string | undefined>) => {
    const merged = { ...current };
    for (const [k, v] of Object.entries(over)) { if (v === undefined || v === "") delete merged[k]; else merged[k] = v; }
    const p = new URLSearchParams(merged);
    const s = p.toString();
    return `/dashboard/comments${s ? `?${s}` : ""}`;
  };
  const chipCls = (active: boolean) => `rounded-md border px-3 py-1.5 text-xs font-medium ${active ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"}`;
  const cnt = (n: number | undefined) => (n ? ` (${n})` : "");
  const FILTER_LABEL: Record<FilterKey, string> = { all: t.comments.fAll, positive: t.comments.fPositive, neutral: t.comments.fNeutral, negative: t.comments.fNegative, risky: t.comments.fRisky };
  const onFirstPage = !cursor;

  return (
    <>
      <PageHeader eyebrow={t.comments.eyebrow} title={t.comments.title} description={t.comments.subtitle} />
      <p className="-mt-2 mb-4 text-xs text-[var(--color-muted)]">{t.comments.secondary}</p>

      {accountCount === 0 ? (
        <Card className="p-6">
          <p className="text-sm font-medium">{t.comments.emptyNoAccount}</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t.comments.emptyNoAccountBody}</p>
          <Link href="/dashboard/accounts" className="mt-3 inline-block rounded-md bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-fg)]">{t.comments.account} →</Link>
        </Card>
      ) : counts.total === 0 && counts.archived === 0 && view === "default" && !wf && !prio && !riskLevel && !labelFilter && !assigneeFilter && !q && providerKey === "all" && filter === "all" ? (
        <Card className="p-6">
          <p className="text-sm font-medium">{t.comments.emptyNoComments}</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t.comments.emptyNoCommentsBody}</p>
        </Card>
      ) : (
        <>
          {/* Date range */}
          <div className="mb-4 flex flex-wrap gap-1.5">
            <Link scroll={false} href={params({ range: "" })} className={chipCls(range === "all")} data-testid="range-all">{c.allTime}</Link>
            <Link scroll={false} href={params({ range: "today" })} className={chipCls(range === "today")}>{t.comments.rangeToday}</Link>
            <Link scroll={false} href={params({ range: "7d" })} className={chipCls(range === "7d")}>{t.comments.range7d}</Link>
            <Link scroll={false} href={params({ range: "30d" })} className={chipCls(range === "30d")}>{t.comments.range30d}</Link>
          </div>

          {/* Metric cards (server counts) */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.comments.mAll}</p><p className="mt-1 text-2xl font-bold" data-testid="metric-total">{mAll}</p></Card>
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.comments.mPositive}</p><p className="mt-1 text-2xl font-bold">{mPositive}</p></Card>
            <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.comments.mNegative}</p><p className="mt-1 text-2xl font-bold">{mNegative}</p></Card>
            {hasReviews ? (
              <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.comments.mReviews}</p><p className="mt-1 text-2xl font-bold">{counts.reviews}</p><p className="text-[11px] text-[var(--color-muted)]">{t.comments.avgRating}: {avgRating} ★</p></Card>
            ) : (
              <Card className="p-4"><p className="text-xs text-[var(--color-muted)]">{t.comments.mRiskyHidden}</p><p className="mt-1 text-2xl font-bold">{mRisky}</p></Card>
            )}
          </div>

          {providersPresent.length > 1 ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Link scroll={false} href={params({ provider: "" })} className={chipCls(providerKey === "all")}>{t.comments.allProviders}</Link>
              {providersPresent.map((pk) => {
                const plat = ALL_PLATFORMS.find((p) => platformKeyFor(p) === pk);
                const n = Object.entries(counts.byPlatform).filter(([pl]) => platformKeyFor(pl as Platform) === pk).reduce((s, [, v]) => s + v, 0);
                return <Link scroll={false} key={pk} href={params({ provider: pk })} className={chipCls(providerKey === pk)}>{(plat ? PLATFORM_META[plat].label : pk) + cnt(n)}</Link>;
              })}
            </div>
          ) : null}

          {hasReviews ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Link scroll={false} href={params({ type: "" })} className={chipCls(typeFilter === "all")}>{t.comments.typeAll}</Link>
              <Link scroll={false} href={params({ type: "comment" })} className={chipCls(typeFilter === "comment")}>{t.comments.typeComments}</Link>
              <Link scroll={false} href={params({ type: "review" })} className={chipCls(typeFilter === "review")}>{t.comments.typeReviews}</Link>
            </div>
          ) : null}

          {/* Search (server-side) */}
          <form className="mt-4 flex gap-2" action="/dashboard/comments">
            {Object.entries(current).filter(([k]) => k !== "q").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input name="q" defaultValue={q} placeholder={t.comments.searchPlaceholder} className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]" data-testid="inbox-search" />
            {q ? <Link scroll={false} href={params({ q: "" })} className="shrink-0 rounded-md border border-[var(--color-border)] px-3 py-2 text-xs font-medium hover:border-[var(--color-border-strong)]">{t.comments.searchClear}</Link> : null}
          </form>

          {/* Sentiment filter chips (server-side bucket predicate) */}
          <div className="mt-3 mb-3 flex flex-wrap gap-1.5">
            {SENT_FILTERS.map((f) => (<Link scroll={false} key={f} href={params({ filter: f })} className={chipCls(filter === f)}>{FILTER_LABEL[f]}</Link>))}
          </div>

          {/* Persisted inbox views (reload-safe; full navigation) with server counts. */}
          <div className="mb-2 flex flex-wrap gap-1.5" data-testid="inbox-views">
            <Link scroll={false} href={params({ view: "" })} className={chipCls(view === "default")} data-testid="view-default">{c.viewInbox}{cnt(counts.total)}</Link>
            <Link scroll={false} href={params({ view: "unread" })} className={chipCls(view === "unread")} data-testid="view-unread">{c.viewUnread}{cnt(counts.unread)}</Link>
            <Link scroll={false} href={params({ view: "archived" })} className={chipCls(view === "archived")} data-testid="view-archived">{c.viewArchived}{cnt(counts.archived)}</Link>
            <Link scroll={false} href={params({ view: "assigned_me" })} className={chipCls(view === "assigned_me")} data-testid="view-assigned">{c.viewAssignedMe}</Link>
            <Link scroll={false} href={params({ view: "unassigned" })} className={chipCls(view === "unassigned")} data-testid="view-unassigned">{c.viewUnassigned}{cnt(counts.unassigned)}</Link>
          </div>

          {/* Priority / workflow / risk filters (reload-safe) with server counts. */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="inbox-facets">
            <Link scroll={false} href={params({ priority: "" })} className={chipCls(!prio)}>{c.anyPriority}</Link>
            {(["low", "normal", "high", "urgent"] as const).map((p) => <Link scroll={false} key={p} href={params({ priority: p })} className={chipCls(prio === p)} data-testid={`prio-${p}`}>{(c.priority[p] ?? p) + cnt(counts.byPriority[p])}</Link>)}
            <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
            <Link scroll={false} href={params({ status: "" })} className={chipCls(!wf)}>{c.anyStatus}</Link>
            {(["new", "in_review", "action_required", "resolved"] as const).map((s) => <Link scroll={false} key={s} href={params({ status: s })} className={chipCls(wf === s)} data-testid={`wf-${s}`}>{(c.workflow[s] ?? s.replace(/_/g, " ")) + cnt(counts.byWorkflow[s])}</Link>)}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="risk-filter">
            <Link scroll={false} href={params({ risk: "" })} className={chipCls(!riskLevel)}>{c.anyRisk}</Link>
            {(["low", "medium", "high", "critical"] as const).map((rk) => <Link scroll={false} key={rk} href={params({ risk: rk })} className={chipCls(riskLevel === rk)} data-testid={`risk-${rk}`}>{tEnum(t, "risk", rk)}</Link>)}
          </div>
          {allLabels.length ? (
            <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="label-filter">
              <Link scroll={false} href={params({ label: "" })} className={chipCls(!labelFilter)}>{c.allLabels}</Link>
              {allLabels.map((l) => <Link scroll={false} key={l.id} href={params({ label: l.id })} className={chipCls(labelFilter === l.id)} data-testid={`label-filter-${l.id}`}><Badge tone={l.colorKey}>{l.name}{cnt(counts.byLabel[l.id])}</Badge></Link>)}
            </div>
          ) : null}

          {/* Tenant label management (create/rename/delete), rendered once. */}
          <LabelManager allLabels={allLabels} canAct={canAct} />

          {shown.length === 0 ? (
            <Card className="p-6 text-sm text-[var(--color-muted)]" data-testid="inbox-empty">{
              q ? t.comments.emptySearch
              : view === "unread" ? c.emptyUnread
              : view === "archived" ? c.emptyArchived
              : view === "assigned_me" ? c.emptyAssignedMe
              : view === "unassigned" ? c.emptyUnassigned
              : t.comments.emptyFilter
            }</Card>
          ) : (
            <SelectionProvider>
              {canAct ? (
                <div className="mb-2 flex items-center gap-2">
                  <SelectAllCheckbox ids={shownIds} />
                  <span className="text-xs text-[var(--color-muted)]">{c.onThisPage(shown.length, counts.total)}</span>
                </div>
              ) : null}
              <div className="space-y-3">
                {shown.map((r) => {
                  const notes = notesByItem.get(r.id) ?? [];
                  const audit = auditByItem.get(r.id) ?? [];
                  return (
                    <div key={r.id} data-inbox-item={r.id} data-read={r.isRead ? "true" : "false"} data-archived={r.archived ? "true" : "false"} data-priority={r.priority} data-status={r.workflowStatus} data-notecount={r.noteCount} data-assignee={r.assigneeId ?? ""} data-connector-health={r.connectorHealth} data-processing={r.processingStatus} className="flex items-start gap-2">
                      {/* Bulk checkbox lives OUTSIDE the <summary> (an interactive control nested in a
                          summary is an a11y anti-pattern and would toggle the disclosure). */}
                      {canAct ? <div className="pt-4"><SelectCheckbox id={r.id} /></div> : null}
                      <Card className="p-0 flex-1 min-w-0">
                        <details className="group">
                          <summary className="flex cursor-pointer flex-col gap-2 p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              {!r.isRead ? <span data-testid="unread-dot" className="inline-block h-2 w-2 rounded-full bg-[var(--color-brand)]" title={c.unreadTitle} /> : null}
                              {r.isReview ? <Badge tone="brand">{t.gbp.reviewType}</Badge> : null}
                              {r.isReview && r.rating ? <span className="text-xs font-semibold text-[var(--color-warn)]">{"★".repeat(Math.max(0, Math.min(5, r.rating)))}{"☆".repeat(Math.max(0, 5 - r.rating))}</span> : null}
                              <Badge tone={BUCKET_TONE[r.bucket]}>{t.rep[`bucket_${r.bucket}` as "bucket_positive"]}</Badge>
                              {r.priority !== "normal" ? <Badge tone={r.priority === "urgent" ? "danger" : r.priority === "high" ? "warn" : "neutral"}>{c.priority[r.priority] ?? r.priority}</Badge> : null}
                              <Badge tone="neutral">{c.workflow[r.workflowStatus] ?? r.workflowStatus.replace(/_/g, " ")}</Badge>
                              <span data-testid="processing-badge" data-status={r.processingStatus}><Badge tone={PROCESSING_TONE[r.processingStatus] ?? "neutral"}>{processingCopy(r.processingStatus)}</Badge></span>
                              {/* Customer-visible classification chip: Basic protection (rules) / AI assisted. */}
                              <span data-testid="classification-chip" data-mode={r.classificationMode}><Badge tone={r.classificationMode === "ai_assisted" ? "brand" : "neutral"}>{r.classificationMode === "ai_assisted" ? dc.chipAi : dc.chipBasic}</Badge></span>
                              {r.archived ? <Badge tone="neutral">{c.viewArchived}</Badge> : null}
                              {r.assigneeName ? <Badge tone="neutral">@{r.assigneeName}</Badge> : null}
                              {r.labels.map((l) => <Badge key={l.id} tone={l.colorKey}>{l.name}</Badge>)}
                              {r.noteCount > 0 ? <Badge tone="neutral">{c.notes(r.noteCount)}</Badge> : null}
                              {r.category ? <Badge tone="neutral">{tEnum(t, "autoProtectCategory", r.category)}</Badge> : null}
                              {r.hiddenPublic ? <Badge tone="warn">{t.comments.hiddenPublic}</Badge> : null}
                              {r.pending ? <Badge tone="neutral">{t.comments.pendingDecision}</Badge> : null}
                              {r.actorLevel ? <Link href="/dashboard/actor-risk"><Badge tone={r.actorLevel === "medium" ? "warn" : "danger"}>{t.actor.badgePrefix}: {t.actor[`level_${r.actorLevel}` as "level_medium"]}</Badge></Link> : null}
                            </div>
                            {/* Rating-only reviews carry no text — never fabricate one. */}
                            {r.text ? <p className="text-sm">{r.text}</p> : r.isReview ? <p className="text-sm italic text-[var(--color-muted)]" data-testid="rating-only">{c.ratingOnly}</p> : null}
                            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--color-muted)]">
                              <span>{r.author} · {r.platformLabel} · {r.account} · {relativeTime(r.createdAt, rel, now)} · {t.comments[r.statusKey as "st_captured"]}</span>
                              <span data-testid="connector-health" data-health={r.connectorHealth}><StatusDot tone={HEALTH_TONE[r.connectorHealth]}>{c.health[r.connectorHealth]}</StatusDot></span>
                            </p>
                          </summary>

                          <div className="border-t border-[var(--color-border)] p-4 text-sm">
                            {r.text ? <p className="mb-3 whitespace-pre-wrap">{r.text}</p> : null}
                            <dl className="space-y-1.5 text-xs">
                              <Row2 label={t.comments.author}>{r.author}</Row2>
                              <Row2 label={t.comments.platform}>{r.platformLabel}</Row2>
                              <Row2 label={t.comments.account}>{r.account}</Row2>
                              <Row2 label={t.comments.sentiment}>{t.rep[`bucket_${r.bucket}` as "bucket_positive"]}</Row2>
                              <Row2 label={t.comments.risk}>{tEnum(t, "risk", r.riskLevel)}{r.category ? ` · ${tEnum(t, "autoProtectCategory", r.category)}` : ""}</Row2>
                              <Row2 label={t.comments.status}>{t.comments[r.statusKey as "st_captured"]}</Row2>
                              {r.permalink ? <Row2 label={t.comments.post}><a href={r.permalink} target="_blank" rel="noopener noreferrer" className="text-[var(--color-brand)] hover:underline">{t.comments.post} →</a></Row2> : null}
                            </dl>
                            {r.hiddenPublic ? <p className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-xs text-[var(--color-muted)]">{t.common.hiddenFromPublicHelp}</p> : null}
                            {r.cantHide ? <p className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-xs text-[var(--color-muted)]">{t.comments.cantHideNote}</p> : null}

                            {/* V1.44B — truthful processing state. Limit/disabled states link to usage; never a fake error. */}
                            <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-xs" data-testid="processing-detail" data-status={r.processingStatus}>
                              <span className="font-medium">{processingCopy(r.processingStatus)}</span>
                              {r.processingTier ? <span className="text-[var(--color-muted)]"> · {c.tierLabel(r.processingTier)}</span> : null}
                              {r.lastProcessedAt ? <span className="text-[var(--color-muted)]"> · {c.checkedPrefix} {relativeTime(r.lastProcessedAt, rel, now)}</span> : null}
                              {r.classifierVersion ? <span className="text-[var(--color-muted)]"> · {r.classifierVersion}</span> : null}
                              {PROCESSING_LIMIT_STATES.has(r.processingStatus) ? (
                                <div className="mt-1"><Link href="/dashboard/usage" className="text-[var(--color-brand)] hover:underline" data-testid="processing-usage-link">{c.viewUsage}</Link></div>
                              ) : null}
                            </div>

                            {/* V1.61 — ADMIN-ONLY AI diagnostics: rules vs AI vs merged verdict, how the AI
                                was invoked, gate reason. Model + cost are JOINED from UsageEvent (not stored
                                in aiDiagnostics). No key/prompt/raw response. */}
                            {isAdmin && r.diag ? (
                              <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-xs" data-testid="ai-diagnostics">
                                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                                  <span className="font-semibold uppercase tracking-wide text-[var(--color-muted)]">{dc.heading}</span>
                                  <Badge tone="neutral">{dc.callMode}: {r.diag.callMode}</Badge>
                                  <Badge tone={r.diag.ai.called ? "brand" : "neutral"}>{dc.aiStatus}: {r.diag.ai.called ? r.diag.ai.status : dc.notCalled}</Badge>
                                </div>
                                <dl className="space-y-1">
                                  {r.diag.rules ? <Row2 label={dc.rules}>{tEnum(t, "risk", r.diag.rules.level)} · {r.diag.rules.confidence.toFixed(2)}{r.diag.rules.categories.length ? ` · ${r.diag.rules.categories.join(", ")}` : ""}</Row2> : null}
                                  <Row2 label={dc.ai}>{r.diag.ai.verdict ? `${tEnum(t, "risk", r.diag.ai.verdict.level)} · ${r.diag.ai.verdict.confidence.toFixed(2)}${r.diag.ai.verdict.categories.length ? ` · ${r.diag.ai.verdict.categories.join(", ")}` : ""}` : dc.notCalled}{r.diag.ai.errorCode ? ` · ${dc.error}: ${r.diag.ai.errorCode}` : ""}</Row2>
                                  {r.diag.merged ? <Row2 label={dc.merged}>{tEnum(t, "risk", r.diag.merged.level)} · {r.diag.merged.confidence.toFixed(2)}{r.diag.merged.categories.length ? ` · ${r.diag.merged.categories.join(", ")}` : ""}</Row2> : null}
                                  <Row2 label={dc.gate}>{r.diag.gateReason ?? dc.none}</Row2>
                                  {r.diag.usageAvailable ? (
                                    <>
                                      <Row2 label={dc.model}>{r.diag.model ?? dc.none}</Row2>
                                      <Row2 label={dc.tokens}>{r.diag.inputTokens ?? "—"} / {r.diag.outputTokens ?? "—"} / {r.diag.inputTokens != null && r.diag.outputTokens != null ? r.diag.inputTokens + r.diag.outputTokens : "—"}</Row2>
                                      <Row2 label={dc.cost}>{microsToUsd(r.diag.costMicros)}</Row2>
                                    </>
                                  ) : (
                                    <Row2 label={dc.model}>{dc.usageUnavailable}</Row2>
                                  )}
                                </dl>
                              </div>
                            ) : null}

                            {/* Internal workflow controls. Archive is a Tamanor-side action, NOT a
                                provider hide; "resolved" never implies provider moderation. */}
                            <div className="mt-4 grid gap-4 md:grid-cols-2">
                              <section>
                                <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">{c.workflowHeading}</h4>
                                <InboxControls id={r.id} isRead={r.isRead} archived={r.archived} priority={r.priority} workflowStatus={r.workflowStatus} canAct={canAct} />
                                <div className="mt-2"><AssigneeSelector itemId={r.id} assigneeId={r.assigneeId} members={memberList} selfId={session.userId} canAct={canAct} /></div>
                              </section>
                              <section>
                                <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">{c.labelsHeading}</h4>
                                <LabelSelector itemId={r.id} labels={r.labels} allLabels={allLabels} canAct={canAct} />
                              </section>
                            </div>

                            <section className="mt-4">
                              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">{c.notesHeading} <span className="font-normal normal-case text-[var(--color-muted)]">{c.notesHeadingSub}</span></h4>
                              <NotesSection itemId={r.id} notes={notes} selfId={session.userId} canAct={canAct} />
                            </section>

                            {/* Audit timeline (internal actions; body never shown). */}
                            <section className="mt-4">
                              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">{c.activityHeading}</h4>
                              <ul className="flex flex-col gap-1 text-xs" data-testid="audit-timeline">
                                {audit.length ? audit.map((a) => (
                                  <li key={a.id} className="flex flex-wrap items-center gap-2 text-[var(--color-muted)]">
                                    <span className="font-medium text-[var(--color-fg)]">{a.label}</span>
                                    <span>· {a.actor} · {a.at}</span>
                                  </li>
                                )) : <li className="text-[var(--color-muted)]">{c.noActivity}</li>}
                              </ul>
                            </section>

                            <div className="mt-4 flex flex-wrap gap-2">
                              {r.queueItemId ? <Link href={`/dashboard/action-queue/${r.queueItemId}`} className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium hover:border-[var(--color-border-strong)]">{t.comments.openInQueue}</Link> : null}
                              {r.actorLevel ? <Link href="/dashboard/actor-risk" className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium hover:border-[var(--color-border-strong)]">{t.comments.openActor}</Link> : null}
                              <Link href="/dashboard/reputation" className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium hover:border-[var(--color-border-strong)]">{t.comments.openReputation}</Link>
                            </div>
                          </div>
                        </details>
                      </Card>
                    </div>
                  );
                })}
              </div>
              {canAct ? <BulkActionBar members={memberList} allLabels={allLabels} /> : null}
            </SelectionProvider>
          )}

          {/* V1.43 — keyset pager. Plain <a> (full navigation); cursor + dir live in the URL, so a
              refresh reloads the SAME page. Changing any filter above drops cursor → back to page 1. */}
          <nav className="mt-4 flex items-center justify-between gap-2" data-testid="inbox-pager">
            <div className="flex gap-1.5">
              {!onFirstPage ? <Link scroll={false} href={params({ cursor: "", dir: "" })} className={chipCls(false)} data-testid="page-newest">{c.pageNewest}</Link> : null}
              {page.hasPrev ? <Link scroll={false} href={params({ cursor: page.prevCursor ?? undefined, dir: "prev" })} className={chipCls(false)} data-testid="page-prev">{c.pagePrev}</Link> : <span className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium opacity-40">{c.pagePrev}</span>}
            </div>
            <span className="text-xs text-[var(--color-muted)]" data-testid="page-info">{c.showingOf(shown.length, counts.total)}</span>
            <div>
              {page.hasNext ? <Link scroll={false} href={params({ cursor: page.nextCursor ?? undefined, dir: "next" })} className={chipCls(false)} data-testid="page-next">{c.pageNext}</Link> : <span className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium opacity-40">{c.pageNext}</span>}
            </div>
          </nav>

          <p className="mt-5 text-xs text-[var(--color-muted)]">{t.comments.trustNote}</p>
        </>
      )}
    </>
  );
}

function Row2({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[var(--color-border)] py-1 last:border-0">
      <span className="text-[var(--color-muted)]">{label}</span><span className="text-right font-medium">{children}</span>
    </div>
  );
}
