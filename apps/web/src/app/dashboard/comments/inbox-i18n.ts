import type { Locale } from "@/i18n";

/**
 * V1.65 — self-contained SK/EN/DE copy for the inbox/comments client-control module (the six
 * `"use client"` components: assignee/label/notes editors, item controls, bulk selection). The
 * `InboxCopy` type forces every locale to define the SAME keys (TS errors otherwise), so a missing
 * translation cannot ship. Only visible text lives here — enum `value`s, testids, data-* attributes
 * and server-action calls stay in the components untouched.
 */
export type InboxCopy = {
  // assignee-editor
  unassigned: string;
  assignedTo: (name: string) => string;
  assignee: string;
  okAssigned: string;
  okUnassigned: string;
  assignToMe: string;
  okAssignedToYou: string;
  unassign: string;
  // label-editor
  removeLabel: (name: string) => string;
  okLabelRemoved: string;
  okLabelAdded: string;
  noLabels: string;
  addLabelPlaceholder: string;
  newLabelPlaceholder: string;
  okLabelCreated: string;
  create: string;
  pending: string;
  manageLabels: (n: number) => string;
  newLabelName: string;
  save: string;
  okRenamed: string;
  cancel: string;
  rename: string;
  del: string;
  okLabelDeleted: string;
  noLabelsYet: string;
  // notes-section
  okNoteDeleted: string;
  noNotesYet: string;
  notePlaceholder: string;
  okNoteAdded: string;
  addNote: string;
  saving: string;
  // inbox-controls
  markUnread: string;
  markRead: string;
  unarchive: string;
  archive: string;
  priority: string;
  workflowStatus: string;
  // inbox-selection
  selectItem: string;
  selectPage: string;
  updatedOf: (a: number, b: number) => string;
  clear: string;
  selectedCount: (n: number) => string;
  setPriority: string;
  setStatus: string;
  assignTo: string;
  bulkAddLabel: string;
  bulkRemoveLabel: string;
};

export const INBOX_COPY: Record<Locale, InboxCopy> = {
  en: {
    unassigned: "Unassigned",
    assignedTo: (name) => `Assigned to ${name}`,
    assignee: "Assignee",
    okAssigned: "Assigned",
    okUnassigned: "Unassigned",
    assignToMe: "Assign to me",
    okAssignedToYou: "Assigned to you",
    unassign: "Unassign",
    removeLabel: (name) => `Remove label ${name}`,
    okLabelRemoved: "Label removed",
    okLabelAdded: "Label added",
    noLabels: "No labels",
    addLabelPlaceholder: "+ Add label…",
    newLabelPlaceholder: "New label",
    okLabelCreated: "Label created",
    create: "Create",
    pending: "…",
    manageLabels: (n) => `Manage labels (${n})`,
    newLabelName: "New label name",
    save: "Save",
    okRenamed: "Renamed",
    cancel: "Cancel",
    rename: "Rename",
    del: "Delete",
    okLabelDeleted: "Label deleted",
    noLabelsYet: "No labels yet.",
    okNoteDeleted: "Note deleted",
    noNotesYet: "No notes yet.",
    notePlaceholder: "Add an internal note (not sent to the platform)…",
    okNoteAdded: "Note added",
    addNote: "Add note",
    saving: "Saving…",
    markUnread: "Mark unread",
    markRead: "Mark read",
    unarchive: "Unarchive",
    archive: "Archive",
    priority: "Priority",
    workflowStatus: "Workflow status",
    selectItem: "Select item",
    selectPage: "Select page",
    updatedOf: (a, b) => `Updated ${a} of ${b}.`,
    clear: "Clear",
    selectedCount: (n) => `${n} selected`,
    setPriority: "Set priority…",
    setStatus: "Set status…",
    assignTo: "Assign to…",
    bulkAddLabel: "Add label…",
    bulkRemoveLabel: "Remove label…",
  },
  sk: {
    unassigned: "Nepriradené",
    assignedTo: (name) => `Priradené: ${name}`,
    assignee: "Zodpovedná osoba",
    okAssigned: "Priradené",
    okUnassigned: "Priradenie zrušené",
    assignToMe: "Priradiť mne",
    okAssignedToYou: "Priradené vám",
    unassign: "Zrušiť priradenie",
    removeLabel: (name) => `Odstrániť štítok ${name}`,
    okLabelRemoved: "Štítok odobraný",
    okLabelAdded: "Štítok pridaný",
    noLabels: "Žiadne štítky",
    addLabelPlaceholder: "+ Pridať štítok…",
    newLabelPlaceholder: "Nový štítok",
    okLabelCreated: "Štítok vytvorený",
    create: "Vytvoriť",
    pending: "…",
    manageLabels: (n) => `Spravovať štítky (${n})`,
    newLabelName: "Názov nového štítka",
    save: "Uložiť",
    okRenamed: "Premenované",
    cancel: "Zrušiť",
    rename: "Premenovať",
    del: "Odstrániť",
    okLabelDeleted: "Štítok odstránený",
    noLabelsYet: "Zatiaľ žiadne štítky.",
    okNoteDeleted: "Poznámka odstránená",
    noNotesYet: "Zatiaľ žiadne poznámky.",
    notePlaceholder: "Pridať internú poznámku (neodosiela sa na platformu)…",
    okNoteAdded: "Poznámka pridaná",
    addNote: "Pridať poznámku",
    saving: "Ukladá sa…",
    markUnread: "Označiť ako neprečítané",
    markRead: "Označiť ako prečítané",
    unarchive: "Vrátiť z archívu",
    archive: "Archivovať",
    priority: "Priorita",
    workflowStatus: "Stav pracovného postupu",
    selectItem: "Vybrať položku",
    selectPage: "Vybrať stránku",
    updatedOf: (a, b) => `Aktualizované ${a} z ${b}.`,
    clear: "Vyčistiť",
    selectedCount: (n) => `${n} vybraných`,
    setPriority: "Nastaviť prioritu…",
    setStatus: "Nastaviť stav…",
    assignTo: "Priradiť…",
    bulkAddLabel: "Pridať štítok…",
    bulkRemoveLabel: "Odstrániť štítok…",
  },
  de: {
    unassigned: "Nicht zugewiesen",
    assignedTo: (name) => `Zugewiesen an ${name}`,
    assignee: "Zuständig",
    okAssigned: "Zugewiesen",
    okUnassigned: "Zuweisung aufgehoben",
    assignToMe: "Mir zuweisen",
    okAssignedToYou: "Ihnen zugewiesen",
    unassign: "Zuweisung aufheben",
    removeLabel: (name) => `Label ${name} entfernen`,
    okLabelRemoved: "Label entfernt",
    okLabelAdded: "Label hinzugefügt",
    noLabels: "Keine Labels",
    addLabelPlaceholder: "+ Label hinzufügen…",
    newLabelPlaceholder: "Neues Label",
    okLabelCreated: "Label erstellt",
    create: "Erstellen",
    pending: "…",
    manageLabels: (n) => `Labels verwalten (${n})`,
    newLabelName: "Name des neuen Labels",
    save: "Speichern",
    okRenamed: "Umbenannt",
    cancel: "Abbrechen",
    rename: "Umbenennen",
    del: "Löschen",
    okLabelDeleted: "Label gelöscht",
    noLabelsYet: "Noch keine Labels.",
    okNoteDeleted: "Notiz gelöscht",
    noNotesYet: "Noch keine Notizen.",
    notePlaceholder: "Interne Notiz hinzufügen (wird nicht an die Plattform gesendet)…",
    okNoteAdded: "Notiz hinzugefügt",
    addNote: "Notiz hinzufügen",
    saving: "Wird gespeichert…",
    markUnread: "Als ungelesen markieren",
    markRead: "Als gelesen markieren",
    unarchive: "Aus Archiv holen",
    archive: "Archivieren",
    priority: "Priorität",
    workflowStatus: "Workflow-Status",
    selectItem: "Element auswählen",
    selectPage: "Seite auswählen",
    updatedOf: (a, b) => `${a} von ${b} aktualisiert.`,
    clear: "Leeren",
    selectedCount: (n) => `${n} ausgewählt`,
    setPriority: "Priorität festlegen…",
    setStatus: "Status festlegen…",
    assignTo: "Zuweisen an…",
    bulkAddLabel: "Label hinzufügen…",
    bulkRemoveLabel: "Label entfernen…",
  },
};

// Machine reason → human text (whitelisted; no raw SQL/Prisma/token/note body is ever surfaced).
const REASON_COPY: Record<Locale, Record<string, string>> = {
  en: {
    not_found: "That item no longer exists.",
    assignee_not_member: "That person is not an active member of this workspace.",
    assignee_required: "Pick someone to assign.",
    duplicate_label: "A label with that name already exists.",
    invalid_name: "Enter a label name.",
    item_or_label_missing: "That item or label no longer exists.",
    item_missing: "That item no longer exists.",
    empty_note: "Write something before saving.",
    note_too_long: "Note is too long (max 5000 characters).",
    not_found_or_not_author: "You can only delete your own note.",
    action_not_bulk_eligible: "That action can’t be run in bulk.",
    empty_selection: "Select at least one item.",
    priority_required: "Choose a priority.",
    status_required: "Choose a status.",
    permission_denied: "You don’t have permission to do that.",
  },
  sk: {
    not_found: "Táto položka už neexistuje.",
    assignee_not_member: "Táto osoba nie je aktívnym členom tohto pracovného priestoru.",
    assignee_required: "Vyberte osobu, ktorú chcete priradiť.",
    duplicate_label: "Štítok s takým názvom už existuje.",
    invalid_name: "Zadajte názov štítka.",
    item_or_label_missing: "Táto položka alebo štítok už neexistuje.",
    item_missing: "Táto položka už neexistuje.",
    empty_note: "Pred uložením niečo napíšte.",
    note_too_long: "Poznámka je príliš dlhá (max. 5000 znakov).",
    not_found_or_not_author: "Môžete odstrániť iba svoju vlastnú poznámku.",
    action_not_bulk_eligible: "Túto akciu nemožno spustiť hromadne.",
    empty_selection: "Vyberte aspoň jednu položku.",
    priority_required: "Vyberte prioritu.",
    status_required: "Vyberte stav.",
    permission_denied: "Na túto akciu nemáte oprávnenie.",
  },
  de: {
    not_found: "Dieses Element existiert nicht mehr.",
    assignee_not_member: "Diese Person ist kein aktives Mitglied dieses Arbeitsbereichs.",
    assignee_required: "Wählen Sie eine Person zum Zuweisen.",
    duplicate_label: "Ein Label mit diesem Namen existiert bereits.",
    invalid_name: "Geben Sie einen Label-Namen ein.",
    item_or_label_missing: "Dieses Element oder Label existiert nicht mehr.",
    item_missing: "Dieses Element existiert nicht mehr.",
    empty_note: "Schreiben Sie etwas, bevor Sie speichern.",
    note_too_long: "Notiz ist zu lang (max. 5000 Zeichen).",
    not_found_or_not_author: "Sie können nur Ihre eigene Notiz löschen.",
    action_not_bulk_eligible: "Diese Aktion kann nicht als Massenaktion ausgeführt werden.",
    empty_selection: "Wählen Sie mindestens ein Element.",
    priority_required: "Wählen Sie eine Priorität.",
    status_required: "Wählen Sie einen Status.",
    permission_denied: "Sie haben keine Berechtigung dafür.",
  },
};

const REASON_FALLBACK: Record<Locale, string> = {
  en: "That action could not be completed.",
  sk: "Túto akciu sa nepodarilo dokončiť.",
  de: "Diese Aktion konnte nicht abgeschlossen werden.",
};

export function reasonText(reason: string, locale: Locale): string {
  return REASON_COPY[locale][reason] ?? REASON_FALLBACK[locale];
}

const SOMETHING_WRONG: Record<Locale, (ref: string) => string> = {
  en: (ref) => `Something went wrong. Reference ${ref}.`,
  sk: (ref) => `Niečo sa pokazilo. Referencia ${ref}.`,
  de: (ref) => `Etwas ist schiefgelaufen. Referenz ${ref}.`,
};

export function somethingWrong(ref: string, locale: Locale): string {
  return SOMETHING_WRONG[locale](ref);
}

// Dropdown OPTION text only — the option VALUE stays the raw enum in the components.
export const PRIORITY_LABEL: Record<Locale, Record<"low" | "normal" | "high" | "urgent", string>> = {
  en: { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" },
  sk: { low: "Nízka", normal: "Normálna", high: "Vysoká", urgent: "Urgentná" },
  de: { low: "Niedrig", normal: "Normal", high: "Hoch", urgent: "Dringend" },
};

export const STATUS_LABEL: Record<Locale, Record<"new" | "in_review" | "action_required" | "resolved", string>> = {
  en: { new: "New", in_review: "In review", action_required: "Action required", resolved: "Resolved" },
  sk: { new: "Nové", in_review: "Na kontrole", action_required: "Vyžaduje akciu", resolved: "Vyriešené" },
  de: { new: "Neu", in_review: "In Prüfung", action_required: "Aktion erforderlich", resolved: "Erledigt" },
};
