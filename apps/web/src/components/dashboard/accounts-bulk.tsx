"use client";

import { createContext, useContext, useMemo, useState, useTransition } from "react";
import type { Locale } from "@/i18n";
import { bulkDisconnectAccounts, bulkDisableMonitoring, type BulkActionResult } from "@/app/dashboard/accounts/bulk-actions";

/**
 * V1.75 (P0) — bulk account selection + actions client. A selection context spans the
 * server-rendered accounts table: each row carries a <SelectCheckbox/>, the header carries a
 * <SelectAllCheckbox/>, and <BulkActionBar/> runs the two server-side bulk actions (Disconnect
 * selected, Disable monitoring of selected), each gated behind a <ConfirmDialog/>. The server
 * enforces tenant scope, permissions, idempotency and audit — this is presentation + confirm only.
 */

const BULK_COPY = {
  en: {
    selectItem: "Select account", selectPage: "Select all", selectedCount: (n: number) => `${n} selected`, clear: "Clear",
    disconnect: "Disconnect selected", disableMonitoring: "Turn off monitoring",
    confirmDisconnectTitle: "Disconnect selected accounts?",
    confirmDisconnectBody: (n: number) => `This disconnects ${n} account(s) and stops all monitoring for them. You can reconnect later.`,
    confirmDisableTitle: "Turn off monitoring?",
    confirmDisableBody: (n: number) => `Automatic sync will be turned off for ${n} account(s). They stay connected but will not be synced automatically.`,
    confirm: "Confirm", cancel: "Cancel",
    result: (s: number, a: number, f: number) => `${s} done · ${a} already · ${f} failed`,
    somethingWrong: "Something went wrong. Please try again.",
    emptyReason: "Select at least one account.",
  },
  sk: {
    selectItem: "Vybrať účet", selectPage: "Vybrať všetky", selectedCount: (n: number) => `Vybrané: ${n}`, clear: "Zrušiť výber",
    disconnect: "Odpojiť vybrané", disableMonitoring: "Vypnúť monitorovanie",
    confirmDisconnectTitle: "Odpojiť vybrané účty?",
    confirmDisconnectBody: (n: number) => `Odpojí sa ${n} účtov a zastaví sa ich monitorovanie. Neskôr ich môžete znovu pripojiť.`,
    confirmDisableTitle: "Vypnúť monitorovanie?",
    confirmDisableBody: (n: number) => `Automatická synchronizácia sa vypne pre ${n} účtov. Zostanú pripojené, ale nebudú sa automaticky synchronizovať.`,
    confirm: "Potvrdiť", cancel: "Zrušiť",
    result: (s: number, a: number, f: number) => `${s} hotové · ${a} už boli · ${f} zlyhané`,
    somethingWrong: "Niečo sa pokazilo. Skúste to znova.",
    emptyReason: "Vyberte aspoň jeden účet.",
  },
  de: {
    selectItem: "Konto auswählen", selectPage: "Alle auswählen", selectedCount: (n: number) => `${n} ausgewählt`, clear: "Auswahl aufheben",
    disconnect: "Ausgewählte trennen", disableMonitoring: "Überwachung ausschalten",
    confirmDisconnectTitle: "Ausgewählte Konten trennen?",
    confirmDisconnectBody: (n: number) => `Dies trennt ${n} Konto(en) und stoppt deren Überwachung. Sie können sie später erneut verbinden.`,
    confirmDisableTitle: "Überwachung ausschalten?",
    confirmDisableBody: (n: number) => `Die automatische Synchronisierung wird für ${n} Konto(en) ausgeschaltet. Sie bleiben verbunden, werden aber nicht automatisch synchronisiert.`,
    confirm: "Bestätigen", cancel: "Abbrechen",
    result: (s: number, a: number, f: number) => `${s} erledigt · ${a} bereits · ${f} fehlgeschlagen`,
    somethingWrong: "Etwas ist schiefgelaufen. Bitte erneut versuchen.",
    emptyReason: "Wählen Sie mindestens ein Konto.",
  },
} as const;

type Ctx = { selected: Set<string>; toggle: (id: string) => void; clear: () => void; setAll: (ids: string[], on: boolean) => void };
const SelectionCtx = createContext<Ctx | null>(null);
function useSelection(): Ctx {
  const c = useContext(SelectionCtx);
  if (!c) throw new Error("useSelection outside AccountsSelectionProvider");
  return c;
}

export function AccountsSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ctx = useMemo<Ctx>(() => ({
    selected,
    toggle: (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    clear: () => setSelected(new Set()),
    setAll: (ids, on) => setSelected((prev) => { const n = new Set(prev); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; }),
  }), [selected]);
  return <SelectionCtx.Provider value={ctx}>{children}</SelectionCtx.Provider>;
}

export function AccountSelectCheckbox({ id, locale }: { id: string; locale: Locale }) {
  const { selected, toggle } = useSelection();
  return (
    <input type="checkbox" aria-label={BULK_COPY[locale].selectItem} data-testid="account-select" data-select-id={id}
      checked={selected.has(id)} onChange={() => toggle(id)}
      className="h-4 w-4 shrink-0 rounded border-[var(--color-border-strong)]" />
  );
}

export function AccountSelectAllCheckbox({ ids, locale }: { ids: string[]; locale: Locale }) {
  const { selected, setAll } = useSelection();
  const allOn = ids.length > 0 && ids.every((i) => selected.has(i));
  return (
    <input type="checkbox" aria-label={BULK_COPY[locale].selectPage} data-testid="account-select-all"
      checked={allOn} onChange={(e) => setAll(ids, e.target.checked)}
      className="h-4 w-4 rounded border-[var(--color-border-strong)]" />
  );
}

function ConfirmDialog({ title, body, confirmLabel, cancelLabel, pending, onConfirm, onCancel }: {
  title: string; body: string; confirmLabel: string; cancelLabel: string; pending: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} data-testid="confirm-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-card)]">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-[var(--color-muted)]">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={pending} onClick={onCancel} data-testid="confirm-cancel"
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium disabled:opacity-50">{cancelLabel}</button>
          <button type="button" disabled={pending} onClick={onConfirm} data-testid="confirm-ok"
            className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

type PendingKind = "disconnect" | "disable" | null;

export function AccountsBulkBar({ locale }: { locale: Locale }) {
  const L = BULK_COPY[locale];
  const { selected, clear } = useSelection();
  const [pending, start] = useTransition();
  const [confirmKind, setConfirmKind] = useState<PendingKind>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const ids = [...selected];
  if (ids.length === 0) return null;

  function run(action: (ids: string[]) => Promise<BulkActionResult>) {
    setMsg(null);
    start(async () => {
      try {
        const r = await action(ids);
        if (!r.ok) { setMsg({ kind: "error", text: r.reason === "empty_selection" ? L.emptyReason : L.somethingWrong }); return; }
        const already = r.results.filter((x) => x.outcome === "already").length;
        const failed = r.results.filter((x) => x.outcome === "failed").length;
        setMsg({ kind: failed > 0 ? "error" : "ok", text: L.result(r.affected, already, failed) });
        clear();
      } catch {
        setMsg({ kind: "error", text: L.somethingWrong });
      } finally {
        setConfirmKind(null);
      }
    });
  }

  const btn = "rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium disabled:opacity-50";

  return (
    <>
      <div data-testid="accounts-bulk-bar" data-selected-count={ids.length}
        className="sticky bottom-3 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-card)]">
        <span className="text-xs font-semibold" data-testid="accounts-bulk-count">{L.selectedCount(ids.length)}</span>
        <button type="button" className={btn} disabled={pending} data-testid="accounts-bulk-clear" onClick={() => { clear(); setMsg(null); }}>{L.clear}</button>
        <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
        <button type="button" className={btn} disabled={pending} data-testid="accounts-bulk-disable" onClick={() => setConfirmKind("disable")}>{L.disableMonitoring}</button>
        <button type="button" className={`${btn} text-[var(--color-danger)]`} disabled={pending} data-testid="accounts-bulk-disconnect" onClick={() => setConfirmKind("disconnect")}>{L.disconnect}</button>
        {msg ? <p role="status" data-accounts-bulk-msg={msg.kind} className={`w-full text-xs ${msg.kind === "ok" ? "text-[var(--color-ok)]" : "text-[var(--color-danger)]"}`}>{msg.text}</p> : null}
      </div>
      {confirmKind === "disconnect" ? (
        <ConfirmDialog title={L.confirmDisconnectTitle} body={L.confirmDisconnectBody(ids.length)} confirmLabel={L.confirm} cancelLabel={L.cancel}
          pending={pending} onConfirm={() => run(bulkDisconnectAccounts)} onCancel={() => setConfirmKind(null)} />
      ) : null}
      {confirmKind === "disable" ? (
        <ConfirmDialog title={L.confirmDisableTitle} body={L.confirmDisableBody(ids.length)} confirmLabel={L.confirm} cancelLabel={L.cancel}
          pending={pending} onConfirm={() => run(bulkDisableMonitoring)} onCancel={() => setConfirmKind(null)} />
      ) : null}
    </>
  );
}
