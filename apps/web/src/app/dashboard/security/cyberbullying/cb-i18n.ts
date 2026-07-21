import type { Locale } from "@/i18n/config";

/**
 * C4 — EN/SK/DE copy for the Cyberbullying dashboard, inbox, and read-only detail.
 * Compile-enforced (Record<Locale, CbCopy>) so no locale is missing a key. Honest
 * wording: incident · detected signal · under review · alleged actor · confirmed
 * after review. Never: guilty / perpetrator / confirmed attacker.
 */
export interface CbCopy {
  moduleName: string;
  moduleDesc: string;
  available: string;
  openIncidents: (n: number) => string;
  openDashboard: string;
  overviewTitle: string;
  overviewSubtitle: string;
  inboxTitle: string;
  inboxSubtitle: string;
  detailTitle: string;
  backToInbox: string;
  system: string;
  reason: string;
  detectOnly: string;
  allegedNote: string;
  timeframe: Record<"7" | "30" | "90", string>;
  kpi: Record<"open" | "underReview" | "actionRequired" | "resolved" | "withoutEvidence" | "createdInWindow" | "linkedDetections" | "avgOpenAge", string>;
  status: Record<string, string>;
  reportSource: Record<string, string>;
  participantRole: Record<string, string>;
  timelineEvent: Record<string, string>;
  evidenceMeta: Record<"type" | "source" | "captureMethod" | "capturedAt" | "mimeType" | "sizeBytes" | "integrity" | "scan" | "retention" | "legalHold", string>;
  col: Record<"id" | "subject" | "status" | "category" | "source" | "allegedActor" | "detections" | "evidence" | "created" | "updated", string>;
  filter: Record<"status" | "source" | "subject" | "evidence" | "detections" | "timeframe" | "search" | "all" | "hasEvidence" | "noEvidence" | "hasDetections" | "manualOnly" | "reset" | "sort", string>;
  sort: Record<"newest" | "oldest" | "recentlyUpdated" | "statusPriority", string>;
  section: Record<"overview" | "subject" | "summary" | "allegedActor" | "participants" | "detections" | "evidence" | "timeline", string>;
  empty: { noIncidentsTitle: string; noIncidentsBody: string; filterTitle: string; filterBody: string; noDetections: string; noEvidence: string; noTimeline: string };
  error: { title: string; body: string; notFound: string };
  pageOf: (p: number, total: number) => string;
  prev: string;
  next: string;
  // C5 — operations (metrics, actions, assignment, notes).
  ops: { title: string; subtitle: string } & Record<"assignedToMe" | "waitingReview" | "awaitingAction" | "avgReviewTime", string>;
  actionsPanel: { title: string; none: string; changeStatus: string; reason: string; reasonRequired: string; reasonOptional: string; submit: string };
  act: Record<"under_review" | "acknowledged" | "confirmed" | "action_required" | "resolved" | "dismissed" | "archived" | "reopen", string>;
  assign: { title: string; unassigned: string; assignedTo: string; you: string; claim: string; reassign: string; unassign: string; historyTitle: string; historyEmpty: string; by: string; actionLabel: Record<"assigned" | "reassigned" | "unassigned", string> };
  notes: { title: string; subtitle: string; empty: string; you: string; placeholder: string; add: string; confidential: string };
  banner: { ok: string } & Record<"forbidden" | "not_found" | "transition" | "assignment" | "error", string>;
  // C6 — manual report flow.
  report: {
    cta: string; title: string; subtitle: string;
    steps: { subject: string; details: string; review: string };
    subjectStep: { label: string; helper: string; emptyTitle: string; emptyBody: string; type: string; choose: string };
    fields: { reportSource: string; category: string; summary: string; summaryHelper: string; actorLabel: string; actorLabelHelper: string; actorRef: string; actorRefHelper: string; optional: string };
    reviewStep: { title: string; notConfirmed: string; humanReview: string; allegedNeutral: string };
    buttons: { next: string; back: string; cancel: string; submit: string; submitting: string };
    success: { title: string; body: string; incident: string; status: string; pending: string; openDetail: string; backToInbox: string; newReport: string };
    errors: Record<"required" | "too_short" | "too_long" | "invalid" | "denied" | "locked" | "error", string>;
    category: Record<"harassment" | "threats" | "impersonation" | "doxxing" | "exclusion" | "other", string>;
  };
  // C7 — secure evidence upload.
  evUpload: {
    addCta: string; title: string; subtitle: string;
    dropTitle: string; dropHint: string; browse: string; selected: string; remove: string; noFiles: string;
    allowed: string; perFile: string; maxFiles: string;
    contentNotice: string; scanNotice: string;
    submit: string; submitting: string; cancel: string;
    successTitle: string; successBody: string; backToIncident: string;
    lockedTitle: string; deniedTitle: string; notFoundTitle: string; closedTitle: string; closedBody: string;
    scanLabel: Record<"pending_scan" | "clean" | "infected" | "scan_failed", string>;
    integrityLabel: Record<"unverified" | "verified" | "failed", string>;
    errors: Record<"type" | "size" | "empty" | "too_many" | "total_size" | "mismatch" | "filename" | "malformed" | "denied" | "locked" | "not_found" | "invalid_status" | "scan" | "error", string>;
  };
  // C8 — detection triage.
  det: {
    cta: string; queueTitle: string; queueSubtitle: string;
    col: Record<"id" | "time" | "source" | "kind" | "severity" | "target" | "status", string>;
    status: Record<"new" | "under_review" | "false_positive" | "linked_to_incident" | "ignored", string>;
    severity: Record<"low" | "medium" | "high" | "critical", string>;
    filter: Record<"status" | "severity" | "kind" | "subject" | "search" | "all" | "reset" | "sort", string>;
    sort: Record<"newest" | "oldest" | "severity" | "status", string>;
    op: Record<"start_review" | "ignore" | "false_positive" | "reopen" | "create_incident", string>;
    bulk: { selected: string; apply: string; startReview: string; ignore: string; falsePositive: string; none: string };
    detailTitle: string; back: string; linked: string; linkedTo: string; viewIncident: string;
    section: Record<"overview" | "timeline" | "createIncident" | "actions", string>;
    meta: Record<"detectedAt" | "source" | "kind" | "severity" | "subject" | "occurrences" | "reasonCode" | "confidence" | "status", string>;
    timelineEvent: Record<"detection_review_started" | "detection_ignored" | "detection_false_positive" | "detection_linked" | "detection_reopened", string>;
    create: { subject: string; choose: string; summary: string; summaryHint: string; submit: string; note: string; noSubjects: string };
    empty: { title: string; body: string; noTimeline: string };
    banner: { ok: string } & Record<"forbidden" | "not_found" | "already_linked" | "invalid_transition" | "subject" | "summary" | "error" | "applied", string>;
  };
  // C9 — case management.
  case: {
    title: string; readOnly: string;
    protection: { title: string; riskLevel: string; status: string; objective: string; notes: string; save: string; noRisk: string };
    risk: Record<"low" | "medium" | "high" | "critical", string>;
    protStatus: Record<"not_started" | "monitoring" | "active" | "resolved", string>;
    followUp: { title: string; next: string; last: string; notes: string; save: string };
    milestones: { title: string; mark: string; unmark: string; label: Record<"initial_review" | "evidence_collected" | "victim_contacted" | "protection_active" | "resolved", string> };
    tasks: { title: string; add: string; titleLabel: string; descLabel: string; assignee: string; due: string; create: string; empty: string; start: string; complete: string; cancel: string; reopen: string };
    taskStatus: Record<"todo" | "in_progress" | "done" | "cancelled", string>;
    banner: { ok: string } & Record<"forbidden" | "not_found" | "invalid_transition" | "validation" | "error", string>;
  };
  // C10 — notifications, SLA & escalation.
  notif: {
    bell: string; center: string; subtitle: string; unread: string; all: string; markRead: string; markAllRead: string; dismiss: string; open: string; empty: string; unreadCountLabel: string;
    severity: Record<"info" | "attention" | "urgent", string>;
    type: Record<"incident_assigned" | "incident_reassigned" | "incident_unassigned" | "case_task_assigned" | "task_due_soon" | "task_overdue" | "follow_up_due_soon" | "follow_up_overdue" | "critical_risk_set" | "incident_escalated" | "escalation_resolved" | "incident_reopened" | "evidence_scan_pending_long", string>;
    banner: { read: string; dismissed: string; allRead: string };
  };
  sla: {
    title: string; overviewTitle: string; overviewSubtitle: string;
    card: Record<"firstReviewOverdue" | "criticalOverdue" | "taskOverdue" | "followUpOverdue" | "activeEscalations", string>;
    state: Record<"not_applicable" | "on_track" | "due_soon" | "overdue" | "satisfied", string>;
    firstReview: string; criticalRisk: string; tasks: string; followUp: string; nextDeadline: string; oldestOverdue: string; none: string;
  };
  esc: {
    title: string; add: string; severity: string; reason: string; target: string; targetNone: string; note: string; noteRequired: string; submit: string; resolve: string; cancel: string;
    active: string; none: string; escalatedBy: string; escalatedAt: string; status: string;
    severityLabel: Record<"attention" | "urgent", string>;
    reasonLabel: Record<"sla_breach" | "critical_risk" | "no_reviewer_response" | "repeated_incident" | "safety_concern" | "other", string>;
    statusLabel: Record<"active" | "resolved" | "cancelled", string>;
    banner: { ok: string } & Record<"forbidden" | "not_found" | "invalid_transition" | "invalid_recipient" | "invalid_reason" | "missing_note" | "duplicate" | "error", string>;
  };
  // C11 — compliance reporting.
  comp: {
    section: string; subtitle: string; create: string; latest: string; empty: string; view: string; back: string; readOnly: string;
    reportType: Record<"cyberbullying_case_summary" | "cyberbullying_evidence_package", string>;
    version: string; generatedAt: string; generatedBy: string; schemaVersion: string; hash: string; previousHash: string; redaction: string; status: string;
    redactionState: Record<"unredacted_internal" | "redaction_required" | "redacted", string>;
    verification: Record<"verified" | "invalid" | "unsupported_schema" | "chain_incomplete", string>;
    sections: Record<"metadata" | "incident" | "protectedSubject" | "assignments" | "detections" | "evidence" | "custody" | "chronology" | "caseManagement" | "sla" | "integrity" | "omissions", string>;
    omission: Record<string, string>;
    invalidWarning: string; noData: string;
    banner: { ok: string } & Record<"forbidden" | "not_found" | "unsupported_type" | "duplicate_version" | "source_too_large" | "locked" | "error", string>;
  };
  // C12 — redaction, four-eyes approval & export preparation.
  red: {
    section: string; subtitle: string; createDraft: string; workspace: string; back: string; fourEyesNote: string;
    draftStatus: Record<"draft" | "submitted" | "approved" | "rejected" | "superseded" | "cancelled", string>;
    addRule: string; removeRule: string; preview: string; submit: string; cancel: string; approve: string; reject: string; fieldPath: string; action: string; reason: string; note: string; marker: string; rules: string; noRules: string;
    actionLabel: Record<"remove" | "replace_with_label" | "mask_identifier" | "keep", string>;
    reasonLabel: Record<string, string>;
    rejectReason: Record<string, string>;
    previewTitle: string; diff: Record<"removed" | "replaced" | "masked" | "kept" | "unresolved", string>;
    exportSection: string; requestAuth: string; purpose: string; recipient: string; recipientLabel: string; expires: string; approveAuth: string; rejectAuth: string; cancelAuth: string; prepareManifest: string;
    authStatus: Record<string, string>; purposeLabel: Record<string, string>; recipientLabelMap: Record<string, string>;
    drafts: string; authorizations: string; manifests: string; manifest: string; packageVersion: string; verification: string; noItems: string;
    banner: { ok: string } & Record<"forbidden" | "not_found" | "invalid_status" | "invalid_field" | "invalid_action" | "invalid_reason" | "missing_note" | "self_approval" | "unresolved_sensitive" | "source_stale" | "report_not_redacted" | "authorization_invalid" | "expired" | "duplicate" | "error", string>;
  };
}

const STATUS_EN = { open: "Open", under_review: "Under review", acknowledged: "Acknowledged", confirmed: "Confirmed after review", action_required: "Action required", resolved: "Resolved", dismissed: "Dismissed", archived: "Archived" };
const STATUS_SK = { open: "Otvorené", under_review: "V posudzovaní", acknowledged: "Prevzaté", confirmed: "Potvrdené po review", action_required: "Vyžaduje akciu", resolved: "Vyriešené", dismissed: "Zamietnuté", archived: "Archivované" };
const STATUS_DE = { open: "Offen", under_review: "In Prüfung", acknowledged: "Bestätigt erhalten", confirmed: "Nach Prüfung bestätigt", action_required: "Maßnahme erforderlich", resolved: "Gelöst", dismissed: "Abgewiesen", archived: "Archiviert" };
const SOURCE_EN = { manual_report: "Manual report", detection: "From detections" };
const SOURCE_SK = { manual_report: "Manuálny report", detection: "Z detekcií" };
const SOURCE_DE = { manual_report: "Manuelle Meldung", detection: "Aus Erkennungen" };
const ROLE_EN = { protected_subject: "Protected subject", reporter: "Reporter", alleged_actor: "Alleged actor", reviewer: "Reviewer", trusted_contact: "Trusted contact" };
const ROLE_SK = { protected_subject: "Chránená osoba", reporter: "Nahlasovateľ", alleged_actor: "Údajný aktér", reviewer: "Posudzovateľ", trusted_contact: "Dôveryhodný kontakt" };
const ROLE_DE = { protected_subject: "Geschützte Person", reporter: "Melder", alleged_actor: "Mutmaßlicher Akteur", reviewer: "Prüfer", trusted_contact: "Vertrauensperson" };
const TL_EN = { created: "Incident created", review_started: "Review started", acknowledged: "Acknowledged", confirmed: "Confirmed after review", dismissed: "Dismissed", action_required: "Action required", resolved: "Resolved", archived: "Archived", reopened: "Reopened", detection_linked: "Detection linked", evidence_linked: "Evidence linked", participant_added: "Participant added", participant_removed: "Participant removed", reviewer_assigned: "Reviewer assigned", reviewer_reassigned: "Reviewer reassigned", reviewer_unassigned: "Reviewer unassigned", note_added: "Reviewer note added", protection_plan_updated: "Protection plan updated", task_created: "Task created", task_updated: "Task updated", task_completed: "Task completed", follow_up_updated: "Follow-up updated", milestone_changed: "Milestone changed", sla_due_soon_detected: "SLA due soon", sla_overdue_detected: "SLA overdue", escalation_created: "Escalation created", escalation_resolved: "Escalation resolved", escalation_cancelled: "Escalation cancelled", escalation_target_changed: "Escalation target changed", compliance_report_created: "Compliance report created", compliance_redaction_draft_created: "Redaction draft created", compliance_redaction_submitted: "Redaction submitted", compliance_redaction_rejected: "Redaction rejected", compliance_redaction_approved: "Redaction approved", compliance_redacted_snapshot_created: "Redacted snapshot created", compliance_export_authorization_requested: "Export authorization requested", compliance_export_authorization_approved: "Export authorization approved", compliance_export_authorization_rejected: "Export authorization rejected", compliance_export_authorization_cancelled: "Export authorization cancelled", compliance_export_package_prepared: "Export package prepared" };
const TL_SK = { created: "Incident vytvorený", review_started: "Posudzovanie začaté", acknowledged: "Prevzaté", confirmed: "Potvrdené po review", dismissed: "Zamietnuté", action_required: "Vyžaduje akciu", resolved: "Vyriešené", archived: "Archivované", reopened: "Znovu otvorené", detection_linked: "Pripojená detekcia", evidence_linked: "Pripojený dôkaz", participant_added: "Pridaný účastník", participant_removed: "Odobraný účastník", reviewer_assigned: "Priradený posudzovateľ", reviewer_reassigned: "Zmenený posudzovateľ", reviewer_unassigned: "Odobraný posudzovateľ", note_added: "Pridaná poznámka", protection_plan_updated: "Ochranný plán aktualizovaný", task_created: "Úloha vytvorená", task_updated: "Úloha aktualizovaná", task_completed: "Úloha dokončená", follow_up_updated: "Následné kroky aktualizované", milestone_changed: "Míľnik zmenený", sla_due_soon_detected: "SLA sa blíži k termínu", sla_overdue_detected: "SLA po termíne", escalation_created: "Eskalácia vytvorená", escalation_resolved: "Eskalácia vyriešená", escalation_cancelled: "Eskalácia zrušená", escalation_target_changed: "Cieľ eskalácie zmenený", compliance_report_created: "Compliance report vytvorený", compliance_redaction_draft_created: "Redakčný draft vytvorený", compliance_redaction_submitted: "Redakcia odoslaná", compliance_redaction_rejected: "Redakcia zamietnutá", compliance_redaction_approved: "Redakcia schválená", compliance_redacted_snapshot_created: "Redigovaný snapshot vytvorený", compliance_export_authorization_requested: "Autorizácia exportu požiadaná", compliance_export_authorization_approved: "Autorizácia exportu schválená", compliance_export_authorization_rejected: "Autorizácia exportu zamietnutá", compliance_export_authorization_cancelled: "Autorizácia exportu zrušená", compliance_export_package_prepared: "Export balík pripravený" };
const TL_DE = { created: "Vorfall erstellt", review_started: "Prüfung gestartet", acknowledged: "Bestätigt erhalten", confirmed: "Nach Prüfung bestätigt", dismissed: "Abgewiesen", action_required: "Maßnahme erforderlich", resolved: "Gelöst", archived: "Archiviert", reopened: "Wiedereröffnet", detection_linked: "Erkennung verknüpft", evidence_linked: "Nachweis verknüpft", participant_added: "Teilnehmer hinzugefügt", participant_removed: "Teilnehmer entfernt", reviewer_assigned: "Prüfer zugewiesen", reviewer_reassigned: "Prüfer neu zugewiesen", reviewer_unassigned: "Prüfer entfernt", note_added: "Prüfernotiz hinzugefügt", protection_plan_updated: "Schutzplan aktualisiert", task_created: "Aufgabe erstellt", task_updated: "Aufgabe aktualisiert", task_completed: "Aufgabe abgeschlossen", follow_up_updated: "Nachverfolgung aktualisiert", milestone_changed: "Meilenstein geändert", sla_due_soon_detected: "SLA bald fällig", sla_overdue_detected: "SLA überfällig", escalation_created: "Eskalation erstellt", escalation_resolved: "Eskalation gelöst", escalation_cancelled: "Eskalation abgebrochen", escalation_target_changed: "Eskalationsziel geändert", compliance_report_created: "Compliance-Bericht erstellt", compliance_redaction_draft_created: "Schwärzungsentwurf erstellt", compliance_redaction_submitted: "Schwärzung eingereicht", compliance_redaction_rejected: "Schwärzung abgelehnt", compliance_redaction_approved: "Schwärzung genehmigt", compliance_redacted_snapshot_created: "Geschwärzte Momentaufnahme erstellt", compliance_export_authorization_requested: "Export-Autorisierung angefordert", compliance_export_authorization_approved: "Export-Autorisierung genehmigt", compliance_export_authorization_rejected: "Export-Autorisierung abgelehnt", compliance_export_authorization_cancelled: "Export-Autorisierung abgebrochen", compliance_export_package_prepared: "Exportpaket vorbereitet" };

export const CB_COPY: Record<Locale, CbCopy> = {
  en: {
    moduleName: "Cyberbullying Protection", moduleDesc: "Victim-centric incident review — detected signals and manual reports, kept separate from brand moderation.", available: "Available",
    openIncidents: (n) => (n === 1 ? "1 open incident" : `${n} open incidents`), openDashboard: "Open dashboard",
    overviewTitle: "Cyberbullying Protection", overviewSubtitle: "Reviewed cyberbullying incidents at a glance. Detection & review only — no automatic action.",
    inboxTitle: "Incident inbox", inboxSubtitle: "Reviewed cases. A signal is not a confirmed incident; an actor is alleged until human review.",
    detailTitle: "Incident", backToInbox: "Back to inbox", system: "System", reason: "Reason", detectOnly: "Detection & review only — Tamanor never acts on a platform by itself.", allegedNote: "Alleged — not a confirmed attacker without human review.",
    timeframe: { "7": "7d", "30": "30d", "90": "90d" },
    kpi: { open: "Open incidents", underReview: "Under review", actionRequired: "Action required", resolved: "Resolved", withoutEvidence: "Without linked evidence", createdInWindow: "Created in period", linkedDetections: "Linked detections", avgOpenAge: "Avg open age (h)" },
    status: STATUS_EN, reportSource: SOURCE_EN, participantRole: ROLE_EN, timelineEvent: TL_EN,
    evidenceMeta: { type: "Type", source: "Source", captureMethod: "Capture", capturedAt: "Captured", mimeType: "MIME", sizeBytes: "Size", integrity: "Integrity", scan: "Scan", retention: "Retention until", legalHold: "Legal hold" },
    col: { id: "Incident", subject: "Protected subject", status: "Status", category: "Category", source: "Source", allegedActor: "Alleged actor", detections: "Detections", evidence: "Evidence", created: "Created", updated: "Updated" },
    filter: { status: "Status", source: "Source", subject: "Subject", evidence: "Evidence", detections: "Detections", timeframe: "Created", search: "Search", all: "All", hasEvidence: "Has evidence", noEvidence: "No evidence", hasDetections: "Has detections", manualOnly: "Manual only", reset: "Reset filters", sort: "Sort" },
    sort: { newest: "Newest", oldest: "Oldest", recentlyUpdated: "Recently updated", statusPriority: "By status" },
    section: { overview: "Overview", subject: "Protected subject", summary: "Summary", allegedActor: "Alleged actor", participants: "Participants", detections: "Linked detections", evidence: "Linked evidence", timeline: "Timeline" },
    empty: { noIncidentsTitle: "No incidents yet", noIncidentsBody: "There are no reviewed cyberbullying incidents in your workspace yet.", filterTitle: "No matching incidents", filterBody: "No incidents match these filters.", noDetections: "No linked detections — this may have been opened by a manual report.", noEvidence: "No linked evidence.", noTimeline: "No activity beyond creation yet." },
    error: { title: "Something went wrong", body: "This section could not be loaded. Please try again.", notFound: "Incident not found or you don't have access to it." },
    pageOf: (p, total) => `Page ${p} · ${total} total`, prev: "Previous", next: "Next",
    ops: { title: "Review workload", subtitle: "Your operational queue — server-computed, subject-scoped.", assignedToMe: "Assigned to me", waitingReview: "Waiting review", awaitingAction: "Awaiting action", avgReviewTime: "Avg review time (h)" },
    actionsPanel: { title: "Review actions", none: "You have read-only access to this incident.", changeStatus: "Change status", reason: "Reason", reasonRequired: "Reason (required)", reasonOptional: "Reason (optional)", submit: "Apply" },
    act: { under_review: "Start review", acknowledged: "Acknowledge", confirmed: "Confirm", action_required: "Mark action required", resolved: "Resolve", dismissed: "Dismiss", archived: "Archive", reopen: "Reopen" },
    assign: { title: "Assignment", unassigned: "Unassigned", assignedTo: "Assigned to", you: "you", claim: "Assign to me", reassign: "Reassign to me", unassign: "Unassign", historyTitle: "Assignment history", historyEmpty: "No assignment activity yet.", by: "by", actionLabel: { assigned: "Assigned", reassigned: "Reassigned", unassigned: "Unassigned" } },
    notes: { title: "Reviewer notes", subtitle: "Internal & confidential — never shown to the protected subject. Append-only.", empty: "No reviewer notes yet.", you: "you", placeholder: "Add an internal note (not evidence)…", add: "Add note", confidential: "Confidential" },
    banner: { ok: "Done.", forbidden: "You don't have permission for that action.", not_found: "Incident not found or out of scope.", transition: "That status change isn't allowed from the current state.", assignment: "That assignment change isn't allowed.", error: "The action could not be completed." },
    report: {
      cta: "Report incident", title: "Report a cyberbullying incident", subtitle: "File a manual report for an existing protected subject. It opens an incident for human review — no automatic action is taken.",
      steps: { subject: "Protected subject", details: "Incident details", review: "Review & submit" },
      subjectStep: { label: "Protected subject", helper: "Choose the person this report is about. Only subjects you may report for are shown.", emptyTitle: "No protected subjects available", emptyBody: "There are no protected subjects you can report for yet. A protected subject must be created first before a report can be filed.", type: "Type", choose: "Select a subject…" },
      fields: { reportSource: "Report source", category: "Category", summary: "What happened", summaryHelper: "Confidential summary for reviewers. Don't paste passwords or unrelated personal data.", actorLabel: "Alleged actor label", actorLabelHelper: "Optional. A neutral label for the reported person or account — not a verdict.", actorRef: "Alleged actor reference", actorRefHelper: "Optional. A handle, profile link or account reference.", optional: "optional" },
      reviewStep: { title: "Review before submitting", notConfirmed: "This incident is not confirmed. Submitting sends it for human review.", humanReview: "The details below will be reviewed by an authorized person.", allegedNeutral: "The alleged actor is only a reported person or account — never a confirmed attacker." },
      buttons: { next: "Continue", back: "Back", cancel: "Cancel", submit: "Submit report", submitting: "Submitting…" },
      success: { title: "Report received", body: "The incident has been created and is waiting for review.", incident: "Incident", status: "Status", pending: "Waiting for review", openDetail: "Open incident", backToInbox: "Back to inbox", newReport: "File another report" },
      errors: { required: "This field is required.", too_short: "This is too short.", too_long: "This is too long.", invalid: "This value isn't valid.", denied: "You don't have permission to file a report.", locked: "This feature isn't included in your plan.", error: "The report could not be submitted. Please try again." },
      category: { harassment: "Harassment", threats: "Threats", impersonation: "Impersonation", doxxing: "Doxxing", exclusion: "Exclusion", other: "Other" },
    },
    evUpload: {
      addCta: "Add evidence", title: "Add evidence", subtitle: "Upload local files as evidence for this incident. Files are stored securely and scanned; their content is not viewable in this release.",
      dropTitle: "Drop files here or browse", dropHint: "Images (JPEG/PNG/WebP), PDF, or plain text.", browse: "Choose files", selected: "Selected files", remove: "Remove", noFiles: "No files selected yet.",
      allowed: "Allowed: JPEG, PNG, WebP, PDF, plain text.", perFile: "Max 10 MB per image, 15 MB per PDF/text.", maxFiles: "Up to 5 files per upload.",
      contentNotice: "Evidence content is not displayed in this release — only safe metadata is shown.", scanNotice: "Each file is scanned. Until a scan completes it shows as “security scan pending”.",
      submit: "Upload evidence", submitting: "Uploading…", cancel: "Cancel",
      successTitle: "Evidence attached", successBody: "The files were stored and linked to this incident.", backToIncident: "Back to incident",
      lockedTitle: "Not included in your plan", deniedTitle: "You don't have access", notFoundTitle: "Incident not found", closedTitle: "This incident is closed", closedBody: "Evidence can't be added to a resolved, dismissed or archived incident.",
      scanLabel: { pending_scan: "Security scan pending", clean: "Scanned — no threats", infected: "Blocked — threat detected", scan_failed: "Scan failed" },
      integrityLabel: { unverified: "Unverified", verified: "Verified", failed: "Integrity failed" },
      errors: { type: "File type not allowed.", size: "File is too large.", empty: "File is empty.", too_many: "Too many files (max 5).", total_size: "The upload is too large.", mismatch: "File content doesn't match its type.", filename: "File name isn't allowed.", malformed: "The upload was malformed.", denied: "You don't have permission to add evidence.", locked: "This feature isn't included in your plan.", not_found: "Incident not found.", invalid_status: "Evidence can't be added to this incident's current status.", scan: "A file was blocked by the security scan.", error: "The upload could not be completed. Please try again." },
    },
    det: {
      cta: "Detection queue", queueTitle: "Detection queue", queueSubtitle: "Existing security signals prepared for human triage. Nothing is decided automatically — a reviewer ignores, marks false positive, or opens an incident.",
      col: { id: "Detection", time: "Detected", source: "Source", kind: "Category", severity: "Severity", target: "Target", status: "Status" },
      status: { new: "New", under_review: "Under review", false_positive: "False positive", linked_to_incident: "Linked to incident", ignored: "Ignored" },
      severity: { low: "Low", medium: "Medium", high: "High", critical: "Critical" },
      filter: { status: "Status", severity: "Severity", kind: "Category", subject: "Subject type", search: "Search", all: "All", reset: "Reset", sort: "Sort" },
      sort: { newest: "Newest", oldest: "Oldest", severity: "Severity", status: "Status" },
      op: { start_review: "Start review", ignore: "Ignore", false_positive: "Mark false positive", reopen: "Reopen", create_incident: "Create incident" },
      bulk: { selected: "selected", apply: "Apply", startReview: "Start review", ignore: "Ignore", falsePositive: "Mark false positive", none: "Select detections to act on them in bulk." },
      detailTitle: "Detection", back: "Back to queue", linked: "Linked to incident", linkedTo: "Linked incident", viewIncident: "Open incident",
      section: { overview: "Signal", timeline: "Triage history", createIncident: "Create incident", actions: "Triage actions" },
      meta: { detectedAt: "Detected", source: "Source", kind: "Category", severity: "Severity", subject: "Target", occurrences: "Occurrences", reasonCode: "Reason code", confidence: "Confidence", status: "Status" },
      timelineEvent: { detection_review_started: "Review started", detection_ignored: "Ignored", detection_false_positive: "Marked false positive", detection_linked: "Incident created & linked", detection_reopened: "Reopened" },
      create: { subject: "Protected subject", choose: "Select a subject…", summary: "What happened", summaryHint: "Confidential summary for reviewers. Opens an incident for human review — no automatic action.", submit: "Create incident", note: "The detection will be linked to the new incident. It is not a confirmed incident until reviewed.", noSubjects: "No protected subjects are available. A protected subject must be created first." },
      empty: { title: "No detections", body: "There are no security detections to triage in your workspace.", noTimeline: "No triage activity yet." },
      banner: { ok: "Done.", forbidden: "You don't have permission for that action.", not_found: "Detection not found or out of scope.", already_linked: "This detection is already linked to an incident.", invalid_transition: "That action isn't allowed from the current status.", subject: "Choose a protected subject.", summary: "Add a summary (10–4000 characters).", error: "The action could not be completed.", applied: "Bulk action applied." },
    },
    case: {
      title: "Case management", readOnly: "You have read-only access to this case.",
      protection: { title: "Protection plan", riskLevel: "Manual risk level", status: "Protection status", objective: "Protection objective", notes: "Notes", save: "Save plan", noRisk: "Not set" },
      risk: { low: "Low", medium: "Medium", high: "High", critical: "Critical" },
      protStatus: { not_started: "Not started", monitoring: "Monitoring", active: "Active", resolved: "Resolved" },
      followUp: { title: "Follow-up", next: "Next review date", last: "Last review date", notes: "Follow-up notes", save: "Save follow-up" },
      milestones: { title: "Milestones", mark: "Mark done", unmark: "Undo", label: { initial_review: "Initial review", evidence_collected: "Evidence collected", victim_contacted: "Victim contacted", protection_active: "Protection active", resolved: "Resolved" } },
      tasks: { title: "Tasks", add: "Add task", titleLabel: "Title", descLabel: "Description", assignee: "Assignee", due: "Due date", create: "Create task", empty: "No tasks yet.", start: "Start", complete: "Complete", cancel: "Cancel", reopen: "Reopen" },
      taskStatus: { todo: "To do", in_progress: "In progress", done: "Done", cancelled: "Cancelled" },
      banner: { ok: "Saved.", forbidden: "You don't have permission for that action.", not_found: "Not found or out of scope.", invalid_transition: "That change isn't allowed from the current status.", validation: "Please check the fields and try again.", error: "The action could not be completed." },
    },
    notif: {
      bell: "Notifications", center: "Notifications", subtitle: "Internal alerts about incidents you can act on. Opening one re-checks your access.", unread: "Unread", all: "All", markRead: "Mark read", markAllRead: "Mark all read", dismiss: "Dismiss", open: "Open", empty: "No notifications.", unreadCountLabel: "unread notifications",
      severity: { info: "Info", attention: "Attention", urgent: "Urgent" },
      type: { incident_assigned: "Incident assigned to you", incident_reassigned: "Incident reassigned to you", incident_unassigned: "You were unassigned", case_task_assigned: "Task assigned to you", task_due_soon: "Task due soon", task_overdue: "Task overdue", follow_up_due_soon: "Follow-up due soon", follow_up_overdue: "Follow-up overdue", critical_risk_set: "Critical risk set", incident_escalated: "Incident escalated", escalation_resolved: "Escalation resolved", incident_reopened: "Incident reopened", evidence_scan_pending_long: "Evidence scan pending" },
      banner: { read: "Marked as read.", dismissed: "Dismissed.", allRead: "All marked as read." },
    },
    sla: {
      title: "SLA & escalation", overviewTitle: "SLA overview", overviewSubtitle: "Time-based status derived from your incidents — nothing is decided automatically.",
      card: { firstReviewOverdue: "Overdue for first review", criticalOverdue: "Critical risk overdue", taskOverdue: "Tasks overdue", followUpOverdue: "Follow-ups overdue", activeEscalations: "Active escalations" },
      state: { not_applicable: "Not applicable", on_track: "On track", due_soon: "Due soon", overdue: "Overdue", satisfied: "Satisfied" },
      firstReview: "First review", criticalRisk: "Critical-risk response", tasks: "Tasks", followUp: "Follow-up", nextDeadline: "Next deadline", oldestOverdue: "Oldest overdue", none: "—",
    },
    esc: {
      title: "Escalation", add: "Add escalation", severity: "Severity", reason: "Reason", target: "Target reviewer", targetNone: "No specific target", note: "Confidential note", noteRequired: "Confidential note (required)", submit: "Escalate", resolve: "Resolve", cancel: "Cancel escalation",
      active: "Active escalation", none: "No active escalation.", escalatedBy: "Escalated by", escalatedAt: "Escalated at", status: "Status",
      severityLabel: { attention: "Attention", urgent: "Urgent" },
      reasonLabel: { sla_breach: "SLA breach", critical_risk: "Critical risk", no_reviewer_response: "No reviewer response", repeated_incident: "Repeated incident", safety_concern: "Safety concern", other: "Other" },
      statusLabel: { active: "Active", resolved: "Resolved", cancelled: "Cancelled" },
      banner: { ok: "Done.", forbidden: "You don't have permission for that action.", not_found: "Not found or out of scope.", invalid_transition: "That change isn't allowed.", invalid_recipient: "That recipient can't receive this.", invalid_reason: "Invalid severity or reason.", missing_note: "A confidential note is required for “Other”.", duplicate: "There is already an active escalation.", error: "The action could not be completed." },
    },
    comp: {
      section: "Compliance reports", subtitle: "Immutable, hashed snapshots of this case at a point in time. Internal only — no download or export.", create: "Create report", latest: "Latest", empty: "No reports yet.", view: "View", back: "Back to incident", readOnly: "This report is read-only and immutable.",
      reportType: { cyberbullying_case_summary: "Case summary", cyberbullying_evidence_package: "Evidence package" },
      version: "Version", generatedAt: "Generated at", generatedBy: "Generated by", schemaVersion: "Schema", hash: "Snapshot hash", previousHash: "Previous hash", redaction: "Redaction", status: "Status",
      redactionState: { unredacted_internal: "Unredacted (internal)", redaction_required: "Redaction required", redacted: "Redacted" },
      verification: { verified: "Verified", invalid: "Invalid", unsupported_schema: "Unsupported schema", chain_incomplete: "Chain incomplete" },
      sections: { metadata: "Report metadata", incident: "Incident", protectedSubject: "Protected subject", assignments: "Assignments", detections: "Detections", evidence: "Evidence inventory", custody: "Chain of custody", chronology: "Chronology", caseManagement: "Case management", sla: "SLA & escalation", integrity: "Integrity", omissions: "Omissions" },
      omission: { INCIDENT_SUMMARY_EXCLUDED: "Incident summary excluded", PROTECTION_NOTES_EXCLUDED: "Protection notes excluded", PROTECTION_OBJECTIVE_EXCLUDED: "Protection objective excluded", FOLLOW_UP_NOTES_EXCLUDED: "Follow-up notes excluded", TASK_DESCRIPTION_EXCLUDED: "Task descriptions excluded", CONFIDENTIAL_ESCALATION_NOTE_EXCLUDED: "Confidential escalation note excluded", ORIGINAL_FILENAME_EXCLUDED: "Original filenames excluded", RAW_DETECTION_EVIDENCE_EXCLUDED: "Raw detection evidence excluded", EVIDENCE_CONTENT_EXCLUDED: "Evidence content excluded", PERSONAL_CONTACT_DATA_EXCLUDED: "Personal contact data excluded", CHRONOLOGY_TRUNCATED: "Chronology truncated", EVIDENCE_INVENTORY_TRUNCATED: "Evidence inventory truncated", UNSUPPORTED_FIELD: "Unsupported field" },
      invalidWarning: "This report failed verification. It is preserved unchanged; export is disabled.", noData: "—",
      banner: { ok: "Report created.", forbidden: "You don't have permission to create a report.", not_found: "Incident not found or out of scope.", unsupported_type: "Unsupported report type.", duplicate_version: "A version conflict occurred. Please try again.", source_too_large: "The case is too large to snapshot.", locked: "This feature isn't included in your plan.", error: "The report could not be created." },
    },
    red: {
      section: "Redaction & export", subtitle: "Prepare a redacted copy and an internal export package — a separate author approves, and no file is produced here.", createDraft: "Create redaction draft", workspace: "Redaction workspace", back: "Back to report", fourEyesNote: "The author of a draft cannot approve it — a second authorized person must approve (four-eyes).",
      draftStatus: { draft: "Draft", submitted: "Submitted", approved: "Approved", rejected: "Rejected", superseded: "Superseded", cancelled: "Cancelled" },
      addRule: "Add rule", removeRule: "Remove", preview: "Preview", submit: "Submit for approval", cancel: "Cancel", approve: "Approve", reject: "Reject", fieldPath: "Field", action: "Action", reason: "Reason", note: "Confidential note", marker: "Marker", rules: "Redaction rules", noRules: "No rules yet.",
      actionLabel: { remove: "Remove", replace_with_label: "Replace with label", mask_identifier: "Mask identifier", keep: "Keep (explicit)" },
      reasonLabel: { PERSONAL_DATA: "Personal data", MINOR_PROTECTION: "Minor protection", CONTACT_DATA: "Contact data", LOCATION_DATA: "Location data", CONFIDENTIAL_NOTE: "Confidential note", ALLEGED_ACTOR_DATA: "Alleged actor data", INTERNAL_SECURITY_DATA: "Internal security data", LEGAL_RESTRICTION: "Legal restriction", DATA_MINIMIZATION: "Data minimization", OUT_OF_SCOPE: "Out of scope", OTHER: "Other" },
      rejectReason: { INCOMPLETE_REDACTION: "Incomplete redaction", EXCESSIVE_REDACTION: "Excessive redaction", WRONG_RECIPIENT_SCOPE: "Wrong recipient scope", REQUIRED_FIELD_REMOVED: "Required field removed", SENSITIVE_FIELD_UNRESOLVED: "Sensitive field unresolved", INCORRECT_REASON: "Incorrect reason", SOURCE_REPORT_OUTDATED: "Source report outdated", OTHER: "Other" },
      previewTitle: "Preview (not saved)", diff: { removed: "Removed", replaced: "Replaced", masked: "Masked", kept: "Kept sensitive", unresolved: "Unresolved sensitive" },
      exportSection: "Export authorization", requestAuth: "Request authorization", purpose: "Purpose", recipient: "Recipient type", recipientLabel: "Recipient label", expires: "Expires", approveAuth: "Approve", rejectAuth: "Reject", cancelAuth: "Cancel", prepareManifest: "Prepare package",
      authStatus: { requested: "Requested", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled", expired: "Expired", consumed: "Consumed" },
      purposeLabel: { INTERNAL_CASE_REVIEW: "Internal case review", LEGAL_REVIEW: "Legal review", LAW_ENFORCEMENT_REQUEST: "Law-enforcement request", SCHOOL_SAFETY_REVIEW: "School safety review", GUARDIAN_REQUEST: "Guardian request", PLATFORM_REPORTING: "Platform reporting", REGULATORY_REQUEST: "Regulatory request", OTHER: "Other" },
      recipientLabelMap: { INTERNAL_AUTHORIZED_USER: "Internal authorized user", LEGAL_COUNSEL: "Legal counsel", LAW_ENFORCEMENT: "Law enforcement", SCHOOL_AUTHORITY: "School authority", GUARDIAN: "Guardian", PLATFORM_TRUST_SAFETY: "Platform Trust & Safety", REGULATOR: "Regulator", OTHER: "Other" },
      drafts: "Redaction drafts", authorizations: "Export authorizations", manifests: "Package manifests", manifest: "Package manifest", packageVersion: "Package", verification: "Verification", noItems: "None yet.",
      banner: { ok: "Done.", forbidden: "You don't have permission for that action.", not_found: "Not found or out of scope.", invalid_status: "That isn't allowed in the current status.", invalid_field: "That field can't be redacted.", invalid_action: "That action isn't allowed for this field.", invalid_reason: "Invalid reason.", missing_note: "A confidential note is required for “Other”.", self_approval: "You can't approve your own draft or request (four-eyes).", unresolved_sensitive: "Resolve all highly-sensitive fields first.", source_stale: "The source report can't be verified.", report_not_redacted: "The report must be redacted first.", authorization_invalid: "The authorization is not valid.", expired: "The authorization has expired.", duplicate: "Already exists.", error: "The action could not be completed." },
    },
  },
  sk: {
    moduleName: "Ochrana pred kyberšikanou", moduleDesc: "Posudzovanie incidentov zameraných na obeť — detegované signály a manuálne reporty, oddelené od brand moderácie.", available: "Dostupné",
    openIncidents: (n) => (n === 1 ? "1 otvorený incident" : `${n} otvorených incidentov`), openDashboard: "Otvoriť dashboard",
    overviewTitle: "Ochrana pred kyberšikanou", overviewSubtitle: "Preskúmané incidenty kyberšikany na jednom mieste. Iba detekcia a review — žiadna automatická akcia.",
    inboxTitle: "Inbox incidentov", inboxSubtitle: "Preskúmané prípady. Signál nie je potvrdený incident; aktér je údajný do ľudského review.",
    detailTitle: "Incident", backToInbox: "Späť do inboxu", system: "Systém", reason: "Dôvod", detectOnly: "Iba detekcia a review — Tamanor nikdy nekoná na platforme sám.", allegedNote: "Údajný — nie potvrdený útočník bez ľudského review.",
    timeframe: { "7": "7d", "30": "30d", "90": "90d" },
    kpi: { open: "Otvorené incidenty", underReview: "V posudzovaní", actionRequired: "Vyžaduje akciu", resolved: "Vyriešené", withoutEvidence: "Bez pripojených dôkazov", createdInWindow: "Vytvorené v období", linkedDetections: "Pripojené detekcie", avgOpenAge: "Priem. vek otvorených (h)" },
    status: STATUS_SK, reportSource: SOURCE_SK, participantRole: ROLE_SK, timelineEvent: TL_SK,
    evidenceMeta: { type: "Typ", source: "Zdroj", captureMethod: "Zachytenie", capturedAt: "Zachytené", mimeType: "MIME", sizeBytes: "Veľkosť", integrity: "Integrita", scan: "Sken", retention: "Retencia do", legalHold: "Legal hold" },
    col: { id: "Incident", subject: "Chránená osoba", status: "Stav", category: "Kategória", source: "Zdroj", allegedActor: "Údajný aktér", detections: "Detekcie", evidence: "Dôkazy", created: "Vytvorené", updated: "Aktualizované" },
    filter: { status: "Stav", source: "Zdroj", subject: "Osoba", evidence: "Dôkazy", detections: "Detekcie", timeframe: "Vytvorené", search: "Hľadať", all: "Všetko", hasEvidence: "S dôkazmi", noEvidence: "Bez dôkazov", hasDetections: "S detekciami", manualOnly: "Iba manuálne", reset: "Zrušiť filtre", sort: "Zoradiť" },
    sort: { newest: "Najnovšie", oldest: "Najstaršie", recentlyUpdated: "Nedávno upravené", statusPriority: "Podľa stavu" },
    section: { overview: "Prehľad", subject: "Chránená osoba", summary: "Zhrnutie", allegedActor: "Údajný aktér", participants: "Účastníci", detections: "Pripojené detekcie", evidence: "Pripojené dôkazy", timeline: "Časová os" },
    empty: { noIncidentsTitle: "Zatiaľ žiadne incidenty", noIncidentsBody: "Vo vašom workspace zatiaľ nie sú žiadne preskúmané incidenty kyberšikany.", filterTitle: "Žiadne zodpovedajúce incidenty", filterBody: "Žiadne incidenty nezodpovedajú týmto filtrom.", noDetections: "Žiadne pripojené detekcie — mohol vzniknúť manuálnym reportom.", noEvidence: "Žiadne pripojené dôkazy.", noTimeline: "Zatiaľ žiadna aktivita nad rámec vytvorenia." },
    error: { title: "Niečo sa pokazilo", body: "Túto sekciu sa nepodarilo načítať. Skúste to znova.", notFound: "Incident sa nenašiel alebo k nemu nemáte prístup." },
    pageOf: (p, total) => `Strana ${p} · celkom ${total}`, prev: "Predchádzajúce", next: "Ďalšie",
    ops: { title: "Vyťaženie review", subtitle: "Vaša operačná fronta — počítané na serveri, v rozsahu vašich osôb.", assignedToMe: "Priradené mne", waitingReview: "Čaká na review", awaitingAction: "Čaká na akciu", avgReviewTime: "Priem. čas review (h)" },
    actionsPanel: { title: "Akcie review", none: "K tomuto incidentu máte iba čitateľský prístup.", changeStatus: "Zmeniť stav", reason: "Dôvod", reasonRequired: "Dôvod (povinný)", reasonOptional: "Dôvod (voliteľný)", submit: "Použiť" },
    act: { under_review: "Začať review", acknowledged: "Prevziať", confirmed: "Potvrdiť", action_required: "Označiť akciu potrebnú", resolved: "Vyriešiť", dismissed: "Zamietnuť", archived: "Archivovať", reopen: "Znovu otvoriť" },
    assign: { title: "Priradenie", unassigned: "Nepriradené", assignedTo: "Priradené", you: "vy", claim: "Priradiť mne", reassign: "Prepísať na mňa", unassign: "Zrušiť priradenie", historyTitle: "História priradení", historyEmpty: "Zatiaľ žiadna aktivita priradení.", by: "vykonal", actionLabel: { assigned: "Priradené", reassigned: "Prepísané", unassigned: "Zrušené" } },
    notes: { title: "Poznámky posudzovateľa", subtitle: "Interné a dôverné — nikdy sa nezobrazia chránenej osobe. Len pridávanie.", empty: "Zatiaľ žiadne poznámky.", you: "vy", placeholder: "Pridať internú poznámku (nie dôkaz)…", add: "Pridať poznámku", confidential: "Dôverné" },
    banner: { ok: "Hotovo.", forbidden: "Na túto akciu nemáte oprávnenie.", not_found: "Incident sa nenašiel alebo je mimo rozsahu.", transition: "Táto zmena stavu nie je z aktuálneho stavu povolená.", assignment: "Táto zmena priradenia nie je povolená.", error: "Akciu sa nepodarilo dokončiť." },
    report: {
      cta: "Nahlásiť incident", title: "Nahlásiť incident kyberšikany", subtitle: "Podajte manuálne hlásenie pre existujúcu chránenú osobu. Otvorí sa incident na ľudské preskúmanie — nevykoná sa žiadna automatická akcia.",
      steps: { subject: "Chránená osoba", details: "Údaje incidentu", review: "Kontrola a odoslanie" },
      subjectStep: { label: "Chránená osoba", helper: "Vyberte osobu, ktorej sa hlásenie týka. Zobrazujú sa iba osoby, ktoré môžete nahlásiť.", emptyTitle: "Žiadne dostupné chránené osoby", emptyBody: "Zatiaľ nie sú žiadne chránené osoby, ktoré môžete nahlásiť. Najprv musí byť vytvorená chránená osoba, až potom je možné podať hlásenie.", type: "Typ", choose: "Vyberte osobu…" },
      fields: { reportSource: "Zdroj hlásenia", category: "Kategória", summary: "Čo sa stalo", summaryHelper: "Dôverné zhrnutie pre posudzovateľov. Nevkladajte heslá ani nesúvisiace osobné údaje.", actorLabel: "Označenie údajného aktéra", actorLabelHelper: "Voliteľné. Neutrálne označenie nahlásenej osoby alebo účtu — nie je to verdikt.", actorRef: "Odkaz na údajného aktéra", actorRefHelper: "Voliteľné. Prezývka, odkaz na profil alebo referencia účtu.", optional: "voliteľné" },
      reviewStep: { title: "Skontrolujte pred odoslaním", notConfirmed: "Tento incident nie je potvrdený. Odoslaním ho posielate na ľudské preskúmanie.", humanReview: "Nižšie uvedené údaje preskúma oprávnená osoba.", allegedNeutral: "Údajný aktér je iba nahlásená osoba alebo účet — nikdy nie potvrdený útočník." },
      buttons: { next: "Pokračovať", back: "Späť", cancel: "Zrušiť", submit: "Odoslať hlásenie", submitting: "Odosiela sa…" },
      success: { title: "Hlásenie prijaté", body: "Incident bol vytvorený a čaká na preskúmanie.", incident: "Incident", status: "Stav", pending: "Čaká na preskúmanie", openDetail: "Otvoriť incident", backToInbox: "Späť do inboxu", newReport: "Podať ďalšie hlásenie" },
      errors: { required: "Toto pole je povinné.", too_short: "Toto je príliš krátke.", too_long: "Toto je príliš dlhé.", invalid: "Táto hodnota nie je platná.", denied: "Nemáte oprávnenie podať hlásenie.", locked: "Táto funkcia nie je súčasťou vášho plánu.", error: "Hlásenie sa nepodarilo odoslať. Skúste to znova." },
      category: { harassment: "Obťažovanie", threats: "Vyhrážky", impersonation: "Zneužitie identity", doxxing: "Doxxing", exclusion: "Vylučovanie", other: "Iné" },
    },
    evUpload: {
      addCta: "Pridať dôkaz", title: "Pridať dôkaz", subtitle: "Nahrajte lokálne súbory ako dôkaz k tomuto incidentu. Súbory sa bezpečne uložia a skenujú; ich obsah nie je v tomto vydaní zobraziteľný.",
      dropTitle: "Presuňte súbory sem alebo prehľadávajte", dropHint: "Obrázky (JPEG/PNG/WebP), PDF alebo obyčajný text.", browse: "Vybrať súbory", selected: "Vybrané súbory", remove: "Odstrániť", noFiles: "Zatiaľ nie sú vybrané žiadne súbory.",
      allowed: "Povolené: JPEG, PNG, WebP, PDF, obyčajný text.", perFile: "Max. 10 MB na obrázok, 15 MB na PDF/text.", maxFiles: "Najviac 5 súborov na jedno nahranie.",
      contentNotice: "Obsah dôkazu sa v tomto vydaní nezobrazuje — zobrazujú sa iba bezpečné metadata.", scanNotice: "Každý súbor sa skenuje. Kým sken neprebehne, zobrazuje sa „bezpečnostný sken prebieha“.",
      submit: "Nahrať dôkaz", submitting: "Nahráva sa…", cancel: "Zrušiť",
      successTitle: "Dôkaz pripojený", successBody: "Súbory boli uložené a pripojené k tomuto incidentu.", backToIncident: "Späť na incident",
      lockedTitle: "Nie je súčasťou vášho plánu", deniedTitle: "Nemáte prístup", notFoundTitle: "Incident sa nenašiel", closedTitle: "Tento incident je uzavretý", closedBody: "K vyriešenému, zamietnutému ani archivovanému incidentu nie je možné pridať dôkaz.",
      scanLabel: { pending_scan: "Bezpečnostný sken prebieha", clean: "Preskenované — bez hrozieb", infected: "Zablokované — zistená hrozba", scan_failed: "Sken zlyhal" },
      integrityLabel: { unverified: "Neoverené", verified: "Overené", failed: "Integrita zlyhala" },
      errors: { type: "Typ súboru nie je povolený.", size: "Súbor je príliš veľký.", empty: "Súbor je prázdny.", too_many: "Príliš veľa súborov (max. 5).", total_size: "Nahrávanie je príliš veľké.", mismatch: "Obsah súboru nezodpovedá jeho typu.", filename: "Názov súboru nie je povolený.", malformed: "Nahrávanie bolo poškodené.", denied: "Nemáte oprávnenie pridať dôkaz.", locked: "Táto funkcia nie je súčasťou vášho plánu.", not_found: "Incident sa nenašiel.", invalid_status: "K aktuálnemu stavu incidentu nie je možné pridať dôkaz.", scan: "Súbor bol zablokovaný bezpečnostným skenom.", error: "Nahrávanie sa nepodarilo dokončiť. Skúste to znova." },
    },
    det: {
      cta: "Fronta detekcií", queueTitle: "Fronta detekcií", queueSubtitle: "Existujúce bezpečnostné signály pripravené na ľudské posúdenie. Nič sa nerozhoduje automaticky — posudzovateľ ignoruje, označí ako false positive alebo otvorí incident.",
      col: { id: "Detekcia", time: "Detegované", source: "Zdroj", kind: "Kategória", severity: "Závažnosť", target: "Cieľ", status: "Stav" },
      status: { new: "Nové", under_review: "V posudzovaní", false_positive: "False positive", linked_to_incident: "Pripojené k incidentu", ignored: "Ignorované" },
      severity: { low: "Nízka", medium: "Stredná", high: "Vysoká", critical: "Kritická" },
      filter: { status: "Stav", severity: "Závažnosť", kind: "Kategória", subject: "Typ cieľa", search: "Hľadať", all: "Všetko", reset: "Zrušiť", sort: "Zoradiť" },
      sort: { newest: "Najnovšie", oldest: "Najstaršie", severity: "Závažnosť", status: "Stav" },
      op: { start_review: "Začať review", ignore: "Ignorovať", false_positive: "Označiť false positive", reopen: "Znovu otvoriť", create_incident: "Vytvoriť incident" },
      bulk: { selected: "vybraných", apply: "Použiť", startReview: "Začať review", ignore: "Ignorovať", falsePositive: "Označiť false positive", none: "Vyberte detekcie pre hromadnú akciu." },
      detailTitle: "Detekcia", back: "Späť do fronty", linked: "Pripojené k incidentu", linkedTo: "Pripojený incident", viewIncident: "Otvoriť incident",
      section: { overview: "Signál", timeline: "História posudzovania", createIncident: "Vytvoriť incident", actions: "Akcie posudzovania" },
      meta: { detectedAt: "Detegované", source: "Zdroj", kind: "Kategória", severity: "Závažnosť", subject: "Cieľ", occurrences: "Výskyty", reasonCode: "Kód dôvodu", confidence: "Istota", status: "Stav" },
      timelineEvent: { detection_review_started: "Posudzovanie začaté", detection_ignored: "Ignorované", detection_false_positive: "Označené ako false positive", detection_linked: "Incident vytvorený a pripojený", detection_reopened: "Znovu otvorené" },
      create: { subject: "Chránená osoba", choose: "Vyberte osobu…", summary: "Čo sa stalo", summaryHint: "Dôverné zhrnutie pre posudzovateľov. Otvorí incident na ľudské preskúmanie — žiadna automatická akcia.", submit: "Vytvoriť incident", note: "Detekcia bude pripojená k novému incidentu. Nie je to potvrdený incident, kým nebude preskúmaný.", noSubjects: "Nie sú dostupné žiadne chránené osoby. Najprv musí byť vytvorená chránená osoba." },
      empty: { title: "Žiadne detekcie", body: "Vo vašom workspace nie sú žiadne bezpečnostné detekcie na posúdenie.", noTimeline: "Zatiaľ žiadna aktivita posudzovania." },
      banner: { ok: "Hotovo.", forbidden: "Na túto akciu nemáte oprávnenie.", not_found: "Detekcia sa nenašla alebo je mimo rozsahu.", already_linked: "Táto detekcia je už pripojená k incidentu.", invalid_transition: "Táto akcia nie je z aktuálneho stavu povolená.", subject: "Vyberte chránenú osobu.", summary: "Pridajte zhrnutie (10–4000 znakov).", error: "Akciu sa nepodarilo dokončiť.", applied: "Hromadná akcia použitá." },
    },
    case: {
      title: "Správa prípadu", readOnly: "K tomuto prípadu máte iba čitateľský prístup.",
      protection: { title: "Ochranný plán", riskLevel: "Manuálna úroveň rizika", status: "Stav ochrany", objective: "Cieľ ochrany", notes: "Poznámky", save: "Uložiť plán", noRisk: "Nenastavené" },
      risk: { low: "Nízke", medium: "Stredné", high: "Vysoké", critical: "Kritické" },
      protStatus: { not_started: "Nezačaté", monitoring: "Monitorovanie", active: "Aktívne", resolved: "Vyriešené" },
      followUp: { title: "Následné kroky", next: "Dátum ďalšieho review", last: "Dátum posledného review", notes: "Poznámky k následným krokom", save: "Uložiť následné kroky" },
      milestones: { title: "Míľniky", mark: "Označiť splnené", unmark: "Vrátiť", label: { initial_review: "Prvotné posúdenie", evidence_collected: "Dôkazy zozbierané", victim_contacted: "Obeť kontaktovaná", protection_active: "Ochrana aktívna", resolved: "Vyriešené" } },
      tasks: { title: "Úlohy", add: "Pridať úlohu", titleLabel: "Názov", descLabel: "Popis", assignee: "Pridelené", due: "Termín", create: "Vytvoriť úlohu", empty: "Zatiaľ žiadne úlohy.", start: "Začať", complete: "Dokončiť", cancel: "Zrušiť", reopen: "Znovu otvoriť" },
      taskStatus: { todo: "Na spracovanie", in_progress: "Prebieha", done: "Hotové", cancelled: "Zrušené" },
      banner: { ok: "Uložené.", forbidden: "Na túto akciu nemáte oprávnenie.", not_found: "Nenájdené alebo mimo rozsahu.", invalid_transition: "Táto zmena nie je z aktuálneho stavu povolená.", validation: "Skontrolujte polia a skúste znova.", error: "Akciu sa nepodarilo dokončiť." },
    },
    notif: {
      bell: "Upozornenia", center: "Upozornenia", subtitle: "Interné upozornenia o incidentoch, s ktorými môžete pracovať. Otvorenie znovu overí váš prístup.", unread: "Neprečítané", all: "Všetky", markRead: "Označiť prečítané", markAllRead: "Označiť všetky prečítané", dismiss: "Zavrieť", open: "Otvoriť", empty: "Žiadne upozornenia.", unreadCountLabel: "neprečítaných upozornení",
      severity: { info: "Info", attention: "Pozornosť", urgent: "Naliehavé" },
      type: { incident_assigned: "Incident vám bol priradený", incident_reassigned: "Incident vám bol prepísaný", incident_unassigned: "Priradenie vám bolo zrušené", case_task_assigned: "Úloha vám bola priradená", task_due_soon: "Úloha sa blíži k termínu", task_overdue: "Úloha po termíne", follow_up_due_soon: "Následný krok sa blíži", follow_up_overdue: "Následný krok po termíne", critical_risk_set: "Nastavené kritické riziko", incident_escalated: "Incident eskalovaný", escalation_resolved: "Eskalácia vyriešená", incident_reopened: "Incident znovu otvorený", evidence_scan_pending_long: "Sken dôkazu čaká" },
      banner: { read: "Označené ako prečítané.", dismissed: "Zavreté.", allRead: "Všetky označené ako prečítané." },
    },
    sla: {
      title: "SLA a eskalácia", overviewTitle: "Prehľad SLA", overviewSubtitle: "Časový stav odvodený z vašich incidentov — nič sa nerozhoduje automaticky.",
      card: { firstReviewOverdue: "Po termíne prvého review", criticalOverdue: "Kritické riziko po termíne", taskOverdue: "Úlohy po termíne", followUpOverdue: "Následné kroky po termíne", activeEscalations: "Aktívne eskalácie" },
      state: { not_applicable: "Neaplikovateľné", on_track: "V poriadku", due_soon: "Blíži sa termín", overdue: "Po termíne", satisfied: "Splnené" },
      firstReview: "Prvé review", criticalRisk: "Reakcia na kritické riziko", tasks: "Úlohy", followUp: "Následné kroky", nextDeadline: "Najbližší termín", oldestOverdue: "Najstaršie po termíne", none: "—",
    },
    esc: {
      title: "Eskalácia", add: "Pridať eskaláciu", severity: "Závažnosť", reason: "Dôvod", target: "Cieľový posudzovateľ", targetNone: "Bez konkrétneho cieľa", note: "Dôverná poznámka", noteRequired: "Dôverná poznámka (povinná)", submit: "Eskalovať", resolve: "Vyriešiť", cancel: "Zrušiť eskaláciu",
      active: "Aktívna eskalácia", none: "Žiadna aktívna eskalácia.", escalatedBy: "Eskaloval", escalatedAt: "Eskalované", status: "Stav",
      severityLabel: { attention: "Pozornosť", urgent: "Naliehavé" },
      reasonLabel: { sla_breach: "Porušenie SLA", critical_risk: "Kritické riziko", no_reviewer_response: "Bez reakcie posudzovateľa", repeated_incident: "Opakovaný incident", safety_concern: "Bezpečnostná obava", other: "Iné" },
      statusLabel: { active: "Aktívna", resolved: "Vyriešená", cancelled: "Zrušená" },
      banner: { ok: "Hotovo.", forbidden: "Na túto akciu nemáte oprávnenie.", not_found: "Nenájdené alebo mimo rozsahu.", invalid_transition: "Táto zmena nie je povolená.", invalid_recipient: "Tento príjemca to nemôže dostať.", invalid_reason: "Neplatná závažnosť alebo dôvod.", missing_note: "Pre „Iné“ je povinná dôverná poznámka.", duplicate: "Už existuje aktívna eskalácia.", error: "Akciu sa nepodarilo dokončiť." },
    },
    comp: {
      section: "Compliance reporty", subtitle: "Nemenné, hashované snapshoty prípadu v konkrétnom čase. Iba interné — žiadny download ani export.", create: "Vytvoriť report", latest: "Najnovší", empty: "Zatiaľ žiadne reporty.", view: "Zobraziť", back: "Späť na incident", readOnly: "Tento report je iba na čítanie a nemenný.",
      reportType: { cyberbullying_case_summary: "Súhrn prípadu", cyberbullying_evidence_package: "Balík dôkazov" },
      version: "Verzia", generatedAt: "Vytvorené", generatedBy: "Vytvoril", schemaVersion: "Schéma", hash: "Hash snapshotu", previousHash: "Predchádzajúci hash", redaction: "Redakcia", status: "Stav",
      redactionState: { unredacted_internal: "Neredigované (interné)", redaction_required: "Vyžaduje redakciu", redacted: "Redigované" },
      verification: { verified: "Overené", invalid: "Neplatné", unsupported_schema: "Nepodporovaná schéma", chain_incomplete: "Reťaz neúplná" },
      sections: { metadata: "Metadata reportu", incident: "Incident", protectedSubject: "Chránená osoba", assignments: "Priradenia", detections: "Detekcie", evidence: "Inventár dôkazov", custody: "Reťaz úschovy", chronology: "Chronológia", caseManagement: "Správa prípadu", sla: "SLA a eskalácia", integrity: "Integrita", omissions: "Vynechania" },
      omission: { INCIDENT_SUMMARY_EXCLUDED: "Zhrnutie incidentu vynechané", PROTECTION_NOTES_EXCLUDED: "Poznámky ochrany vynechané", PROTECTION_OBJECTIVE_EXCLUDED: "Cieľ ochrany vynechaný", FOLLOW_UP_NOTES_EXCLUDED: "Poznámky následných krokov vynechané", TASK_DESCRIPTION_EXCLUDED: "Popisy úloh vynechané", CONFIDENTIAL_ESCALATION_NOTE_EXCLUDED: "Dôverná poznámka eskalácie vynechaná", ORIGINAL_FILENAME_EXCLUDED: "Pôvodné názvy súborov vynechané", RAW_DETECTION_EVIDENCE_EXCLUDED: "Surové dáta detekcie vynechané", EVIDENCE_CONTENT_EXCLUDED: "Obsah dôkazov vynechaný", PERSONAL_CONTACT_DATA_EXCLUDED: "Osobné kontaktné údaje vynechané", CHRONOLOGY_TRUNCATED: "Chronológia skrátená", EVIDENCE_INVENTORY_TRUNCATED: "Inventár dôkazov skrátený", UNSUPPORTED_FIELD: "Nepodporované pole" },
      invalidWarning: "Tento report neprešiel overením. Je zachovaný nezmenený; export je zakázaný.", noData: "—",
      banner: { ok: "Report vytvorený.", forbidden: "Nemáte oprávnenie vytvoriť report.", not_found: "Incident sa nenašiel alebo je mimo rozsahu.", unsupported_type: "Nepodporovaný typ reportu.", duplicate_version: "Nastal konflikt verzií. Skúste znova.", source_too_large: "Prípad je príliš veľký na snapshot.", locked: "Táto funkcia nie je súčasťou vášho plánu.", error: "Report sa nepodarilo vytvoriť." },
    },
    red: {
      section: "Redakcia a export", subtitle: "Pripravte redigovanú kópiu a interný export balík — schvaľuje iný autor a žiadny súbor sa tu nevytvára.", createDraft: "Vytvoriť redakčný draft", workspace: "Redakčný priestor", back: "Späť na report", fourEyesNote: "Autor draftu ho nemôže schváliť — musí schváliť druhá oprávnená osoba (four-eyes).",
      draftStatus: { draft: "Draft", submitted: "Odoslané", approved: "Schválené", rejected: "Zamietnuté", superseded: "Nahradené", cancelled: "Zrušené" },
      addRule: "Pridať pravidlo", removeRule: "Odstrániť", preview: "Náhľad", submit: "Odoslať na schválenie", cancel: "Zrušiť", approve: "Schváliť", reject: "Zamietnuť", fieldPath: "Pole", action: "Akcia", reason: "Dôvod", note: "Dôverná poznámka", marker: "Marker", rules: "Redakčné pravidlá", noRules: "Zatiaľ žiadne pravidlá.",
      actionLabel: { remove: "Odstrániť", replace_with_label: "Nahradiť značkou", mask_identifier: "Maskovať identifikátor", keep: "Ponechať (explicitne)" },
      reasonLabel: { PERSONAL_DATA: "Osobné údaje", MINOR_PROTECTION: "Ochrana maloletého", CONTACT_DATA: "Kontaktné údaje", LOCATION_DATA: "Údaje o polohe", CONFIDENTIAL_NOTE: "Dôverná poznámka", ALLEGED_ACTOR_DATA: "Údaje údajného aktéra", INTERNAL_SECURITY_DATA: "Interné bezpečnostné údaje", LEGAL_RESTRICTION: "Právne obmedzenie", DATA_MINIMIZATION: "Minimalizácia údajov", OUT_OF_SCOPE: "Mimo rozsahu", OTHER: "Iné" },
      rejectReason: { INCOMPLETE_REDACTION: "Neúplná redakcia", EXCESSIVE_REDACTION: "Nadmerná redakcia", WRONG_RECIPIENT_SCOPE: "Nesprávny rozsah príjemcu", REQUIRED_FIELD_REMOVED: "Odstránené povinné pole", SENSITIVE_FIELD_UNRESOLVED: "Nevyriešené citlivé pole", INCORRECT_REASON: "Nesprávny dôvod", SOURCE_REPORT_OUTDATED: "Zdrojový report je zastaraný", OTHER: "Iné" },
      previewTitle: "Náhľad (neuložené)", diff: { removed: "Odstránené", replaced: "Nahradené", masked: "Maskované", kept: "Ponechané citlivé", unresolved: "Nevyriešené citlivé" },
      exportSection: "Autorizácia exportu", requestAuth: "Požiadať o autorizáciu", purpose: "Účel", recipient: "Typ príjemcu", recipientLabel: "Označenie príjemcu", expires: "Vyprší", approveAuth: "Schváliť", rejectAuth: "Zamietnuť", cancelAuth: "Zrušiť", prepareManifest: "Pripraviť balík",
      authStatus: { requested: "Požiadané", approved: "Schválené", rejected: "Zamietnuté", cancelled: "Zrušené", expired: "Vypršané", consumed: "Spotrebované" },
      purposeLabel: { INTERNAL_CASE_REVIEW: "Interné posúdenie prípadu", LEGAL_REVIEW: "Právne posúdenie", LAW_ENFORCEMENT_REQUEST: "Žiadosť orgánov činných v trestnom konaní", SCHOOL_SAFETY_REVIEW: "Bezpečnostné posúdenie školy", GUARDIAN_REQUEST: "Žiadosť opatrovníka", PLATFORM_REPORTING: "Nahlásenie platforme", REGULATORY_REQUEST: "Žiadosť regulátora", OTHER: "Iné" },
      recipientLabelMap: { INTERNAL_AUTHORIZED_USER: "Interný oprávnený používateľ", LEGAL_COUNSEL: "Právny zástupca", LAW_ENFORCEMENT: "Orgány činné v trestnom konaní", SCHOOL_AUTHORITY: "Školský orgán", GUARDIAN: "Opatrovník", PLATFORM_TRUST_SAFETY: "Trust & Safety platformy", REGULATOR: "Regulátor", OTHER: "Iné" },
      drafts: "Redakčné drafty", authorizations: "Autorizácie exportu", manifests: "Manifesty balíkov", manifest: "Manifest balíka", packageVersion: "Balík", verification: "Overenie", noItems: "Zatiaľ žiadne.",
      banner: { ok: "Hotovo.", forbidden: "Na túto akciu nemáte oprávnenie.", not_found: "Nenájdené alebo mimo rozsahu.", invalid_status: "V aktuálnom stave to nie je povolené.", invalid_field: "Toto pole nie je možné redigovať.", invalid_action: "Táto akcia nie je pre toto pole povolená.", invalid_reason: "Neplatný dôvod.", missing_note: "Pre „Iné“ je povinná dôverná poznámka.", self_approval: "Nemôžete schváliť vlastný draft ani žiadosť (four-eyes).", unresolved_sensitive: "Najprv vyriešte všetky vysoko citlivé polia.", source_stale: "Zdrojový report sa nedá overiť.", report_not_redacted: "Report musí byť najprv redigovaný.", authorization_invalid: "Autorizácia nie je platná.", expired: "Autorizácia vypršala.", duplicate: "Už existuje.", error: "Akciu sa nepodarilo dokončiť." },
    },
  },
  de: {
    moduleName: "Cybermobbing-Schutz", moduleDesc: "Opferzentrierte Vorfallprüfung — erkannte Signale und manuelle Meldungen, getrennt von der Markenmoderation.", available: "Verfügbar",
    openIncidents: (n) => (n === 1 ? "1 offener Vorfall" : `${n} offene Vorfälle`), openDashboard: "Dashboard öffnen",
    overviewTitle: "Cybermobbing-Schutz", overviewSubtitle: "Geprüfte Cybermobbing-Vorfälle auf einen Blick. Nur Erkennung & Prüfung — keine automatische Maßnahme.",
    inboxTitle: "Vorfall-Posteingang", inboxSubtitle: "Geprüfte Fälle. Ein Signal ist kein bestätigter Vorfall; ein Akteur ist bis zur Prüfung mutmaßlich.",
    detailTitle: "Vorfall", backToInbox: "Zurück zum Posteingang", system: "System", reason: "Grund", detectOnly: "Nur Erkennung & Prüfung — Tamanor handelt nie selbst auf einer Plattform.", allegedNote: "Mutmaßlich — kein bestätigter Angreifer ohne menschliche Prüfung.",
    timeframe: { "7": "7T", "30": "30T", "90": "90T" },
    kpi: { open: "Offene Vorfälle", underReview: "In Prüfung", actionRequired: "Maßnahme erforderlich", resolved: "Gelöst", withoutEvidence: "Ohne verknüpfte Nachweise", createdInWindow: "Im Zeitraum erstellt", linkedDetections: "Verknüpfte Erkennungen", avgOpenAge: "Ø Alter offen (h)" },
    status: STATUS_DE, reportSource: SOURCE_DE, participantRole: ROLE_DE, timelineEvent: TL_DE,
    evidenceMeta: { type: "Typ", source: "Quelle", captureMethod: "Erfassung", capturedAt: "Erfasst", mimeType: "MIME", sizeBytes: "Größe", integrity: "Integrität", scan: "Scan", retention: "Aufbewahrung bis", legalHold: "Legal Hold" },
    col: { id: "Vorfall", subject: "Geschützte Person", status: "Status", category: "Kategorie", source: "Quelle", allegedActor: "Mutmaßlicher Akteur", detections: "Erkennungen", evidence: "Nachweise", created: "Erstellt", updated: "Aktualisiert" },
    filter: { status: "Status", source: "Quelle", subject: "Person", evidence: "Nachweise", detections: "Erkennungen", timeframe: "Erstellt", search: "Suchen", all: "Alle", hasEvidence: "Mit Nachweis", noEvidence: "Ohne Nachweis", hasDetections: "Mit Erkennungen", manualOnly: "Nur manuell", reset: "Filter zurücksetzen", sort: "Sortieren" },
    sort: { newest: "Neueste", oldest: "Älteste", recentlyUpdated: "Kürzlich aktualisiert", statusPriority: "Nach Status" },
    section: { overview: "Übersicht", subject: "Geschützte Person", summary: "Zusammenfassung", allegedActor: "Mutmaßlicher Akteur", participants: "Teilnehmer", detections: "Verknüpfte Erkennungen", evidence: "Verknüpfte Nachweise", timeline: "Zeitachse" },
    empty: { noIncidentsTitle: "Noch keine Vorfälle", noIncidentsBody: "In Ihrem Workspace gibt es noch keine geprüften Cybermobbing-Vorfälle.", filterTitle: "Keine passenden Vorfälle", filterBody: "Keine Vorfälle entsprechen diesen Filtern.", noDetections: "Keine verknüpften Erkennungen — evtl. durch eine manuelle Meldung eröffnet.", noEvidence: "Keine verknüpften Nachweise.", noTimeline: "Noch keine Aktivität über die Erstellung hinaus." },
    error: { title: "Etwas ist schiefgelaufen", body: "Dieser Bereich konnte nicht geladen werden. Bitte erneut versuchen.", notFound: "Vorfall nicht gefunden oder kein Zugriff." },
    pageOf: (p, total) => `Seite ${p} · ${total} gesamt`, prev: "Zurück", next: "Weiter",
    ops: { title: "Prüf-Auslastung", subtitle: "Ihre operative Warteschlange — serverseitig berechnet, personenbezogen.", assignedToMe: "Mir zugewiesen", waitingReview: "Wartet auf Prüfung", awaitingAction: "Wartet auf Maßnahme", avgReviewTime: "Ø Prüfzeit (h)" },
    actionsPanel: { title: "Prüf-Aktionen", none: "Sie haben nur Lesezugriff auf diesen Vorfall.", changeStatus: "Status ändern", reason: "Grund", reasonRequired: "Grund (erforderlich)", reasonOptional: "Grund (optional)", submit: "Anwenden" },
    act: { under_review: "Prüfung starten", acknowledged: "Bestätigen", confirmed: "Nach Prüfung bestätigen", action_required: "Maßnahme markieren", resolved: "Lösen", dismissed: "Abweisen", archived: "Archivieren", reopen: "Wiedereröffnen" },
    assign: { title: "Zuweisung", unassigned: "Nicht zugewiesen", assignedTo: "Zugewiesen an", you: "Sie", claim: "Mir zuweisen", reassign: "Auf mich übertragen", unassign: "Zuweisung aufheben", historyTitle: "Zuweisungsverlauf", historyEmpty: "Noch keine Zuweisungsaktivität.", by: "von", actionLabel: { assigned: "Zugewiesen", reassigned: "Neu zugewiesen", unassigned: "Aufgehoben" } },
    notes: { title: "Prüfernotizen", subtitle: "Intern & vertraulich — nie für die geschützte Person sichtbar. Nur Anfügen.", empty: "Noch keine Prüfernotizen.", you: "Sie", placeholder: "Interne Notiz hinzufügen (kein Nachweis)…", add: "Notiz hinzufügen", confidential: "Vertraulich" },
    banner: { ok: "Erledigt.", forbidden: "Sie haben keine Berechtigung für diese Aktion.", not_found: "Vorfall nicht gefunden oder außerhalb des Bereichs.", transition: "Diese Statusänderung ist aus dem aktuellen Zustand nicht erlaubt.", assignment: "Diese Zuweisungsänderung ist nicht erlaubt.", error: "Die Aktion konnte nicht abgeschlossen werden." },
    report: {
      cta: "Vorfall melden", title: "Cybermobbing-Vorfall melden", subtitle: "Erstellen Sie eine manuelle Meldung für eine bestehende geschützte Person. Es wird ein Vorfall zur menschlichen Prüfung eröffnet — es erfolgt keine automatische Maßnahme.",
      steps: { subject: "Geschützte Person", details: "Vorfalldetails", review: "Prüfen & senden" },
      subjectStep: { label: "Geschützte Person", helper: "Wählen Sie die Person, um die es geht. Es werden nur Personen angezeigt, für die Sie melden dürfen.", emptyTitle: "Keine geschützten Personen verfügbar", emptyBody: "Es gibt noch keine geschützten Personen, für die Sie melden können. Zuerst muss eine geschützte Person angelegt werden, bevor eine Meldung erstellt werden kann.", type: "Typ", choose: "Person auswählen…" },
      fields: { reportSource: "Meldungsquelle", category: "Kategorie", summary: "Was ist passiert", summaryHelper: "Vertrauliche Zusammenfassung für Prüfer. Keine Passwörter oder unbeteiligten personenbezogenen Daten einfügen.", actorLabel: "Bezeichnung des mutmaßlichen Akteurs", actorLabelHelper: "Optional. Eine neutrale Bezeichnung der gemeldeten Person oder des Kontos — kein Urteil.", actorRef: "Referenz des mutmaßlichen Akteurs", actorRefHelper: "Optional. Ein Handle, Profillink oder eine Kontoreferenz.", optional: "optional" },
      reviewStep: { title: "Vor dem Senden prüfen", notConfirmed: "Dieser Vorfall ist nicht bestätigt. Beim Senden wird er zur menschlichen Prüfung weitergeleitet.", humanReview: "Die folgenden Angaben werden von einer autorisierten Person geprüft.", allegedNeutral: "Der mutmaßliche Akteur ist nur eine gemeldete Person oder ein Konto — nie ein bestätigter Angreifer." },
      buttons: { next: "Weiter", back: "Zurück", cancel: "Abbrechen", submit: "Meldung senden", submitting: "Wird gesendet…" },
      success: { title: "Meldung erhalten", body: "Der Vorfall wurde erstellt und wartet auf Prüfung.", incident: "Vorfall", status: "Status", pending: "Wartet auf Prüfung", openDetail: "Vorfall öffnen", backToInbox: "Zurück zum Posteingang", newReport: "Weitere Meldung erstellen" },
      errors: { required: "Dieses Feld ist erforderlich.", too_short: "Dies ist zu kurz.", too_long: "Dies ist zu lang.", invalid: "Dieser Wert ist ungültig.", denied: "Sie haben keine Berechtigung, eine Meldung zu erstellen.", locked: "Diese Funktion ist in Ihrem Tarif nicht enthalten.", error: "Die Meldung konnte nicht gesendet werden. Bitte erneut versuchen." },
      category: { harassment: "Belästigung", threats: "Drohungen", impersonation: "Identitätsmissbrauch", doxxing: "Doxxing", exclusion: "Ausgrenzung", other: "Sonstiges" },
    },
    evUpload: {
      addCta: "Nachweis hinzufügen", title: "Nachweis hinzufügen", subtitle: "Laden Sie lokale Dateien als Nachweis für diesen Vorfall hoch. Dateien werden sicher gespeichert und geprüft; ihr Inhalt ist in dieser Version nicht einsehbar.",
      dropTitle: "Dateien hierher ziehen oder durchsuchen", dropHint: "Bilder (JPEG/PNG/WebP), PDF oder Klartext.", browse: "Dateien wählen", selected: "Ausgewählte Dateien", remove: "Entfernen", noFiles: "Noch keine Dateien ausgewählt.",
      allowed: "Erlaubt: JPEG, PNG, WebP, PDF, Klartext.", perFile: "Max. 10 MB pro Bild, 15 MB pro PDF/Text.", maxFiles: "Bis zu 5 Dateien pro Upload.",
      contentNotice: "Der Nachweisinhalt wird in dieser Version nicht angezeigt — nur sichere Metadaten.", scanNotice: "Jede Datei wird geprüft. Bis eine Prüfung abgeschlossen ist, erscheint „Sicherheitsprüfung ausstehend“.",
      submit: "Nachweis hochladen", submitting: "Wird hochgeladen…", cancel: "Abbrechen",
      successTitle: "Nachweis angehängt", successBody: "Die Dateien wurden gespeichert und mit diesem Vorfall verknüpft.", backToIncident: "Zurück zum Vorfall",
      lockedTitle: "In Ihrem Tarif nicht enthalten", deniedTitle: "Kein Zugriff", notFoundTitle: "Vorfall nicht gefunden", closedTitle: "Dieser Vorfall ist abgeschlossen", closedBody: "Zu einem gelösten, abgewiesenen oder archivierten Vorfall können keine Nachweise hinzugefügt werden.",
      scanLabel: { pending_scan: "Sicherheitsprüfung ausstehend", clean: "Geprüft — keine Bedrohungen", infected: "Blockiert — Bedrohung erkannt", scan_failed: "Prüfung fehlgeschlagen" },
      integrityLabel: { unverified: "Ungeprüft", verified: "Verifiziert", failed: "Integrität fehlgeschlagen" },
      errors: { type: "Dateityp nicht erlaubt.", size: "Datei ist zu groß.", empty: "Datei ist leer.", too_many: "Zu viele Dateien (max. 5).", total_size: "Der Upload ist zu groß.", mismatch: "Dateiinhalt passt nicht zum Typ.", filename: "Dateiname nicht erlaubt.", malformed: "Der Upload war fehlerhaft.", denied: "Sie haben keine Berechtigung, Nachweise hinzuzufügen.", locked: "Diese Funktion ist in Ihrem Tarif nicht enthalten.", not_found: "Vorfall nicht gefunden.", invalid_status: "Zum aktuellen Status des Vorfalls können keine Nachweise hinzugefügt werden.", scan: "Eine Datei wurde von der Sicherheitsprüfung blockiert.", error: "Der Upload konnte nicht abgeschlossen werden. Bitte erneut versuchen." },
    },
    det: {
      cta: "Erkennungs-Queue", queueTitle: "Erkennungs-Queue", queueSubtitle: "Bestehende Sicherheitssignale zur menschlichen Prüfung vorbereitet. Nichts wird automatisch entschieden — ein Prüfer ignoriert, markiert als Fehlalarm oder eröffnet einen Vorfall.",
      col: { id: "Erkennung", time: "Erkannt", source: "Quelle", kind: "Kategorie", severity: "Schweregrad", target: "Ziel", status: "Status" },
      status: { new: "Neu", under_review: "In Prüfung", false_positive: "Fehlalarm", linked_to_incident: "Mit Vorfall verknüpft", ignored: "Ignoriert" },
      severity: { low: "Niedrig", medium: "Mittel", high: "Hoch", critical: "Kritisch" },
      filter: { status: "Status", severity: "Schweregrad", kind: "Kategorie", subject: "Zieltyp", search: "Suchen", all: "Alle", reset: "Zurücksetzen", sort: "Sortieren" },
      sort: { newest: "Neueste", oldest: "Älteste", severity: "Schweregrad", status: "Status" },
      op: { start_review: "Prüfung starten", ignore: "Ignorieren", false_positive: "Als Fehlalarm markieren", reopen: "Wiedereröffnen", create_incident: "Vorfall erstellen" },
      bulk: { selected: "ausgewählt", apply: "Anwenden", startReview: "Prüfung starten", ignore: "Ignorieren", falsePositive: "Als Fehlalarm markieren", none: "Wählen Sie Erkennungen für Sammelaktionen." },
      detailTitle: "Erkennung", back: "Zurück zur Queue", linked: "Mit Vorfall verknüpft", linkedTo: "Verknüpfter Vorfall", viewIncident: "Vorfall öffnen",
      section: { overview: "Signal", timeline: "Prüfverlauf", createIncident: "Vorfall erstellen", actions: "Prüf-Aktionen" },
      meta: { detectedAt: "Erkannt", source: "Quelle", kind: "Kategorie", severity: "Schweregrad", subject: "Ziel", occurrences: "Vorkommen", reasonCode: "Ursachencode", confidence: "Konfidenz", status: "Status" },
      timelineEvent: { detection_review_started: "Prüfung gestartet", detection_ignored: "Ignoriert", detection_false_positive: "Als Fehlalarm markiert", detection_linked: "Vorfall erstellt & verknüpft", detection_reopened: "Wiedereröffnet" },
      create: { subject: "Geschützte Person", choose: "Person auswählen…", summary: "Was ist passiert", summaryHint: "Vertrauliche Zusammenfassung für Prüfer. Eröffnet einen Vorfall zur menschlichen Prüfung — keine automatische Maßnahme.", submit: "Vorfall erstellen", note: "Die Erkennung wird mit dem neuen Vorfall verknüpft. Es ist kein bestätigter Vorfall, bis er geprüft wurde.", noSubjects: "Es sind keine geschützten Personen verfügbar. Zuerst muss eine geschützte Person angelegt werden." },
      empty: { title: "Keine Erkennungen", body: "In Ihrem Workspace gibt es keine zu prüfenden Sicherheitserkennungen.", noTimeline: "Noch keine Prüfaktivität." },
      banner: { ok: "Erledigt.", forbidden: "Sie haben keine Berechtigung für diese Aktion.", not_found: "Erkennung nicht gefunden oder außerhalb des Bereichs.", already_linked: "Diese Erkennung ist bereits mit einem Vorfall verknüpft.", invalid_transition: "Diese Aktion ist aus dem aktuellen Status nicht erlaubt.", subject: "Wählen Sie eine geschützte Person.", summary: "Fügen Sie eine Zusammenfassung hinzu (10–4000 Zeichen).", error: "Die Aktion konnte nicht abgeschlossen werden.", applied: "Sammelaktion angewendet." },
    },
    case: {
      title: "Fallmanagement", readOnly: "Sie haben nur Lesezugriff auf diesen Fall.",
      protection: { title: "Schutzplan", riskLevel: "Manuelle Risikostufe", status: "Schutzstatus", objective: "Schutzziel", notes: "Notizen", save: "Plan speichern", noRisk: "Nicht gesetzt" },
      risk: { low: "Niedrig", medium: "Mittel", high: "Hoch", critical: "Kritisch" },
      protStatus: { not_started: "Nicht begonnen", monitoring: "Überwachung", active: "Aktiv", resolved: "Gelöst" },
      followUp: { title: "Nachverfolgung", next: "Nächster Prüftermin", last: "Letzter Prüftermin", notes: "Nachverfolgungsnotizen", save: "Nachverfolgung speichern" },
      milestones: { title: "Meilensteine", mark: "Als erledigt markieren", unmark: "Rückgängig", label: { initial_review: "Erstprüfung", evidence_collected: "Nachweise gesammelt", victim_contacted: "Opfer kontaktiert", protection_active: "Schutz aktiv", resolved: "Gelöst" } },
      tasks: { title: "Aufgaben", add: "Aufgabe hinzufügen", titleLabel: "Titel", descLabel: "Beschreibung", assignee: "Zugewiesen", due: "Fällig am", create: "Aufgabe erstellen", empty: "Noch keine Aufgaben.", start: "Starten", complete: "Abschließen", cancel: "Abbrechen", reopen: "Wiedereröffnen" },
      taskStatus: { todo: "Zu erledigen", in_progress: "In Bearbeitung", done: "Erledigt", cancelled: "Abgebrochen" },
      banner: { ok: "Gespeichert.", forbidden: "Sie haben keine Berechtigung für diese Aktion.", not_found: "Nicht gefunden oder außerhalb des Bereichs.", invalid_transition: "Diese Änderung ist aus dem aktuellen Status nicht erlaubt.", validation: "Bitte prüfen Sie die Felder und versuchen Sie es erneut.", error: "Die Aktion konnte nicht abgeschlossen werden." },
    },
    notif: {
      bell: "Benachrichtigungen", center: "Benachrichtigungen", subtitle: "Interne Hinweise zu Vorfällen, an denen Sie arbeiten können. Beim Öffnen wird Ihr Zugriff erneut geprüft.", unread: "Ungelesen", all: "Alle", markRead: "Als gelesen markieren", markAllRead: "Alle als gelesen markieren", dismiss: "Schließen", open: "Öffnen", empty: "Keine Benachrichtigungen.", unreadCountLabel: "ungelesene Benachrichtigungen",
      severity: { info: "Info", attention: "Achtung", urgent: "Dringend" },
      type: { incident_assigned: "Vorfall Ihnen zugewiesen", incident_reassigned: "Vorfall Ihnen neu zugewiesen", incident_unassigned: "Zuweisung aufgehoben", case_task_assigned: "Aufgabe Ihnen zugewiesen", task_due_soon: "Aufgabe bald fällig", task_overdue: "Aufgabe überfällig", follow_up_due_soon: "Nachverfolgung bald fällig", follow_up_overdue: "Nachverfolgung überfällig", critical_risk_set: "Kritisches Risiko gesetzt", incident_escalated: "Vorfall eskaliert", escalation_resolved: "Eskalation gelöst", incident_reopened: "Vorfall wiedereröffnet", evidence_scan_pending_long: "Nachweisprüfung ausstehend" },
      banner: { read: "Als gelesen markiert.", dismissed: "Geschlossen.", allRead: "Alle als gelesen markiert." },
    },
    sla: {
      title: "SLA & Eskalation", overviewTitle: "SLA-Übersicht", overviewSubtitle: "Zeitbasierter Status aus Ihren Vorfällen — nichts wird automatisch entschieden.",
      card: { firstReviewOverdue: "Erstprüfung überfällig", criticalOverdue: "Kritisches Risiko überfällig", taskOverdue: "Aufgaben überfällig", followUpOverdue: "Nachverfolgungen überfällig", activeEscalations: "Aktive Eskalationen" },
      state: { not_applicable: "Nicht zutreffend", on_track: "Im Plan", due_soon: "Bald fällig", overdue: "Überfällig", satisfied: "Erfüllt" },
      firstReview: "Erstprüfung", criticalRisk: "Reaktion auf kritisches Risiko", tasks: "Aufgaben", followUp: "Nachverfolgung", nextDeadline: "Nächste Frist", oldestOverdue: "Älteste überfällig", none: "—",
    },
    esc: {
      title: "Eskalation", add: "Eskalation hinzufügen", severity: "Schweregrad", reason: "Grund", target: "Ziel-Prüfer", targetNone: "Kein bestimmtes Ziel", note: "Vertrauliche Notiz", noteRequired: "Vertrauliche Notiz (erforderlich)", submit: "Eskalieren", resolve: "Lösen", cancel: "Eskalation abbrechen",
      active: "Aktive Eskalation", none: "Keine aktive Eskalation.", escalatedBy: "Eskaliert von", escalatedAt: "Eskaliert am", status: "Status",
      severityLabel: { attention: "Achtung", urgent: "Dringend" },
      reasonLabel: { sla_breach: "SLA-Verstoß", critical_risk: "Kritisches Risiko", no_reviewer_response: "Keine Prüferreaktion", repeated_incident: "Wiederholter Vorfall", safety_concern: "Sicherheitsbedenken", other: "Sonstiges" },
      statusLabel: { active: "Aktiv", resolved: "Gelöst", cancelled: "Abgebrochen" },
      banner: { ok: "Erledigt.", forbidden: "Sie haben keine Berechtigung für diese Aktion.", not_found: "Nicht gefunden oder außerhalb des Bereichs.", invalid_transition: "Diese Änderung ist nicht erlaubt.", invalid_recipient: "Dieser Empfänger kann dies nicht erhalten.", invalid_reason: "Ungültiger Schweregrad oder Grund.", missing_note: "Für „Sonstiges“ ist eine vertrauliche Notiz erforderlich.", duplicate: "Es gibt bereits eine aktive Eskalation.", error: "Die Aktion konnte nicht abgeschlossen werden." },
    },
    comp: {
      section: "Compliance-Berichte", subtitle: "Unveränderliche, gehashte Momentaufnahmen des Falls zu einem Zeitpunkt. Nur intern — kein Download oder Export.", create: "Bericht erstellen", latest: "Neueste", empty: "Noch keine Berichte.", view: "Ansehen", back: "Zurück zum Vorfall", readOnly: "Dieser Bericht ist schreibgeschützt und unveränderlich.",
      reportType: { cyberbullying_case_summary: "Fallzusammenfassung", cyberbullying_evidence_package: "Nachweispaket" },
      version: "Version", generatedAt: "Erstellt am", generatedBy: "Erstellt von", schemaVersion: "Schema", hash: "Snapshot-Hash", previousHash: "Vorheriger Hash", redaction: "Schwärzung", status: "Status",
      redactionState: { unredacted_internal: "Ungeschwärzt (intern)", redaction_required: "Schwärzung erforderlich", redacted: "Geschwärzt" },
      verification: { verified: "Verifiziert", invalid: "Ungültig", unsupported_schema: "Nicht unterstütztes Schema", chain_incomplete: "Kette unvollständig" },
      sections: { metadata: "Berichtsmetadaten", incident: "Vorfall", protectedSubject: "Geschützte Person", assignments: "Zuweisungen", detections: "Erkennungen", evidence: "Nachweisinventar", custody: "Verwahrungskette", chronology: "Chronologie", caseManagement: "Fallmanagement", sla: "SLA & Eskalation", integrity: "Integrität", omissions: "Auslassungen" },
      omission: { INCIDENT_SUMMARY_EXCLUDED: "Vorfallzusammenfassung ausgeschlossen", PROTECTION_NOTES_EXCLUDED: "Schutznotizen ausgeschlossen", PROTECTION_OBJECTIVE_EXCLUDED: "Schutzziel ausgeschlossen", FOLLOW_UP_NOTES_EXCLUDED: "Nachverfolgungsnotizen ausgeschlossen", TASK_DESCRIPTION_EXCLUDED: "Aufgabenbeschreibungen ausgeschlossen", CONFIDENTIAL_ESCALATION_NOTE_EXCLUDED: "Vertrauliche Eskalationsnotiz ausgeschlossen", ORIGINAL_FILENAME_EXCLUDED: "Originaldateinamen ausgeschlossen", RAW_DETECTION_EVIDENCE_EXCLUDED: "Rohe Erkennungsdaten ausgeschlossen", EVIDENCE_CONTENT_EXCLUDED: "Nachweisinhalt ausgeschlossen", PERSONAL_CONTACT_DATA_EXCLUDED: "Persönliche Kontaktdaten ausgeschlossen", CHRONOLOGY_TRUNCATED: "Chronologie gekürzt", EVIDENCE_INVENTORY_TRUNCATED: "Nachweisinventar gekürzt", UNSUPPORTED_FIELD: "Nicht unterstütztes Feld" },
      invalidWarning: "Dieser Bericht hat die Verifizierung nicht bestanden. Er bleibt unverändert erhalten; Export ist deaktiviert.", noData: "—",
      banner: { ok: "Bericht erstellt.", forbidden: "Sie haben keine Berechtigung, einen Bericht zu erstellen.", not_found: "Vorfall nicht gefunden oder außerhalb des Bereichs.", unsupported_type: "Nicht unterstützter Berichtstyp.", duplicate_version: "Ein Versionskonflikt ist aufgetreten. Bitte erneut versuchen.", source_too_large: "Der Fall ist zu groß für eine Momentaufnahme.", locked: "Diese Funktion ist in Ihrem Tarif nicht enthalten.", error: "Der Bericht konnte nicht erstellt werden." },
    },
    red: {
      section: "Schwärzung & Export", subtitle: "Eine geschwärzte Kopie und ein internes Exportpaket vorbereiten — ein zweiter Autor genehmigt, und hier wird keine Datei erzeugt.", createDraft: "Schwärzungsentwurf erstellen", workspace: "Schwärzungs-Arbeitsbereich", back: "Zurück zum Bericht", fourEyesNote: "Der Autor eines Entwurfs kann ihn nicht genehmigen — eine zweite berechtigte Person muss genehmigen (Vier-Augen).",
      draftStatus: { draft: "Entwurf", submitted: "Eingereicht", approved: "Genehmigt", rejected: "Abgelehnt", superseded: "Ersetzt", cancelled: "Abgebrochen" },
      addRule: "Regel hinzufügen", removeRule: "Entfernen", preview: "Vorschau", submit: "Zur Genehmigung einreichen", cancel: "Abbrechen", approve: "Genehmigen", reject: "Ablehnen", fieldPath: "Feld", action: "Aktion", reason: "Grund", note: "Vertrauliche Notiz", marker: "Markierung", rules: "Schwärzungsregeln", noRules: "Noch keine Regeln.",
      actionLabel: { remove: "Entfernen", replace_with_label: "Durch Markierung ersetzen", mask_identifier: "Kennung maskieren", keep: "Behalten (explizit)" },
      reasonLabel: { PERSONAL_DATA: "Personenbezogene Daten", MINOR_PROTECTION: "Minderjährigenschutz", CONTACT_DATA: "Kontaktdaten", LOCATION_DATA: "Standortdaten", CONFIDENTIAL_NOTE: "Vertrauliche Notiz", ALLEGED_ACTOR_DATA: "Daten des mutmaßlichen Akteurs", INTERNAL_SECURITY_DATA: "Interne Sicherheitsdaten", LEGAL_RESTRICTION: "Rechtliche Beschränkung", DATA_MINIMIZATION: "Datenminimierung", OUT_OF_SCOPE: "Außerhalb des Bereichs", OTHER: "Sonstiges" },
      rejectReason: { INCOMPLETE_REDACTION: "Unvollständige Schwärzung", EXCESSIVE_REDACTION: "Übermäßige Schwärzung", WRONG_RECIPIENT_SCOPE: "Falscher Empfängerbereich", REQUIRED_FIELD_REMOVED: "Pflichtfeld entfernt", SENSITIVE_FIELD_UNRESOLVED: "Sensibles Feld ungelöst", INCORRECT_REASON: "Falscher Grund", SOURCE_REPORT_OUTDATED: "Quellbericht veraltet", OTHER: "Sonstiges" },
      previewTitle: "Vorschau (nicht gespeichert)", diff: { removed: "Entfernt", replaced: "Ersetzt", masked: "Maskiert", kept: "Sensibles behalten", unresolved: "Ungelöst sensibel" },
      exportSection: "Export-Autorisierung", requestAuth: "Autorisierung anfordern", purpose: "Zweck", recipient: "Empfängertyp", recipientLabel: "Empfänger-Label", expires: "Läuft ab", approveAuth: "Genehmigen", rejectAuth: "Ablehnen", cancelAuth: "Abbrechen", prepareManifest: "Paket vorbereiten",
      authStatus: { requested: "Angefordert", approved: "Genehmigt", rejected: "Abgelehnt", cancelled: "Abgebrochen", expired: "Abgelaufen", consumed: "Verbraucht" },
      purposeLabel: { INTERNAL_CASE_REVIEW: "Interne Fallprüfung", LEGAL_REVIEW: "Rechtliche Prüfung", LAW_ENFORCEMENT_REQUEST: "Strafverfolgungsanfrage", SCHOOL_SAFETY_REVIEW: "Schulsicherheitsprüfung", GUARDIAN_REQUEST: "Anfrage des Erziehungsberechtigten", PLATFORM_REPORTING: "Plattform-Meldung", REGULATORY_REQUEST: "Regulierungsanfrage", OTHER: "Sonstiges" },
      recipientLabelMap: { INTERNAL_AUTHORIZED_USER: "Interner berechtigter Benutzer", LEGAL_COUNSEL: "Rechtsbeistand", LAW_ENFORCEMENT: "Strafverfolgung", SCHOOL_AUTHORITY: "Schulbehörde", GUARDIAN: "Erziehungsberechtigter", PLATFORM_TRUST_SAFETY: "Plattform Trust & Safety", REGULATOR: "Regulierungsbehörde", OTHER: "Sonstiges" },
      drafts: "Schwärzungsentwürfe", authorizations: "Export-Autorisierungen", manifests: "Paket-Manifeste", manifest: "Paket-Manifest", packageVersion: "Paket", verification: "Verifizierung", noItems: "Noch keine.",
      banner: { ok: "Erledigt.", forbidden: "Sie haben keine Berechtigung für diese Aktion.", not_found: "Nicht gefunden oder außerhalb des Bereichs.", invalid_status: "Im aktuellen Status nicht erlaubt.", invalid_field: "Dieses Feld kann nicht geschwärzt werden.", invalid_action: "Diese Aktion ist für dieses Feld nicht erlaubt.", invalid_reason: "Ungültiger Grund.", missing_note: "Für „Sonstiges“ ist eine vertrauliche Notiz erforderlich.", self_approval: "Sie können Ihren eigenen Entwurf/Antrag nicht genehmigen (Vier-Augen).", unresolved_sensitive: "Lösen Sie zuerst alle hochsensiblen Felder.", source_stale: "Der Quellbericht kann nicht verifiziert werden.", report_not_redacted: "Der Bericht muss zuerst geschwärzt werden.", authorization_invalid: "Die Autorisierung ist ungültig.", expired: "Die Autorisierung ist abgelaufen.", duplicate: "Existiert bereits.", error: "Die Aktion konnte nicht abgeschlossen werden." },
    },
  },
};

const TONE_FOR_STATUS: Record<string, "neutral" | "brand" | "ok" | "warn" | "danger"> = {
  open: "brand", under_review: "brand", acknowledged: "brand", confirmed: "warn", action_required: "danger", resolved: "ok", dismissed: "neutral", archived: "neutral",
};
export function statusTone(status: string): "neutral" | "brand" | "ok" | "warn" | "danger" {
  return TONE_FOR_STATUS[status] ?? "neutral";
}
