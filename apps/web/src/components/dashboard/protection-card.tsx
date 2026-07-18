"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { updateProtectionAction } from "@/app/dashboard/accounts/protection-actions";
import type { Locale } from "@/i18n";

/**
 * V1.60 (2c) — per-account "Comment protection" card. The three modes map to the server-enforced
 * autoHideMode (recommend | manual_approval | automatic). Nothing here can weaken the gate: AUTOMATIC is
 * unavailable for test/read-only accounts, the confidence slider is floored at the server minimum (0.8),
 * choosing AUTOMATIC requires an explicit confirmation, and the operator kill-switch is shown as a status
 * (it pauses execution without touching the saved choice). Categories come from the Control Center — this
 * card only shows which categories are auto-executable and states the rest need manual approval.
 */
type UiMode = "suggest_only" | "require_approval" | "automatic";
const SERVER_MIN = 0.8;
const AUTO_CATEGORIES = ["spam", "scam", "phishing"];

const T = {
  en: {
    title: "Comment protection", subtitle: "Choose how Tamanor handles harmful comments on this account.",
    suggest_only: "Suggest only", suggest_onlyD: "Detect and suggest. Nothing is hidden.",
    require_approval: "Require approval", require_approvalD: "Prepare hides for your one-click approval.",
    automatic: "Automatic", automaticD: "Auto-hide eligible high-confidence comments.",
    threshold: "Minimum confidence to auto-hide", thresholdHint: `The server never goes below ${Math.round(SERVER_MIN * 100)}%.`,
    autoCats: "Auto-executable categories", otherCats: "Other categories (profanity, hate, harassment, impersonation…) are detected and proposed, never hidden automatically.",
    confirmTitle: "Turn on automatic hiding?", confirmBody: "When a comment is classified as spam, scam or phishing above your confidence threshold, Tamanor will hide it from the public automatically — no click needed. You can switch back anytime.",
    confirmCheck: "I understand and want automatic hiding on this account.",
    killPaused: "Automatic execution is temporarily paused by the operator. Your setting is saved and resumes when it's turned back on.",
    monitoringOff: "Monitoring is off for this account — protection is inactive until you turn monitoring on.",
    autoUnavailable: "Automatic is unavailable for a test or read-only account.",
    save: "Save protection", saving: "Saving…", noPermission: "Only a workspace admin can change protection.",
  },
  sk: {
    title: "Ochrana komentárov", subtitle: "Vyberte, ako Tamanor rieši škodlivé komentáre na tomto účte.",
    suggest_only: "Iba návrhy", suggest_onlyD: "Detekcia a návrh. Nič sa neskrýva.",
    require_approval: "Vyžadovať schválenie", require_approvalD: "Pripraví skrytia na vaše schválenie jedným klikom.",
    automatic: "Automaticky", automaticD: "Automaticky skryje spôsobilé komentáre s vysokým confidence.",
    threshold: "Minimálny confidence na automatické skrytie", thresholdHint: `Server nikdy neklesne pod ${Math.round(SERVER_MIN * 100)} %.`,
    autoCats: "Automaticky vykonateľné kategórie", otherCats: "Ostatné kategórie (vulgarizmy, nenávisť, obťažovanie, vydávanie sa za iného…) sa detegujú a navrhujú, nikdy neskrývajú automaticky.",
    confirmTitle: "Zapnúť automatické skrývanie?", confirmBody: "Keď je komentár klasifikovaný ako spam, podvod alebo phishing nad vaším prahom confidence, Tamanor ho automaticky skryje pred verejnosťou — bez kliknutia. Kedykoľvek to môžete vrátiť.",
    confirmCheck: "Rozumiem a chcem automatické skrývanie na tomto účte.",
    killPaused: "Automatické vykonávanie je dočasne pozastavené operátorom. Vaše nastavenie je uložené a obnoví sa po opätovnom zapnutí.",
    monitoringOff: "Monitorovanie tohto účtu je vypnuté — ochrana je neaktívna, kým monitorovanie nezapnete.",
    autoUnavailable: "Automatický režim nie je dostupný pre testovací alebo read-only účet.",
    save: "Uložiť ochranu", saving: "Ukladá sa…", noPermission: "Ochranu môže meniť iba správca pracovného priestoru.",
  },
  de: {
    title: "Kommentarschutz", subtitle: "Wählen Sie, wie Tamanor schädliche Kommentare bei diesem Konto behandelt.",
    suggest_only: "Nur Vorschläge", suggest_onlyD: "Erkennen und vorschlagen. Nichts wird ausgeblendet.",
    require_approval: "Freigabe erforderlich", require_approvalD: "Bereitet Ausblendungen zur Ein-Klick-Freigabe vor.",
    automatic: "Automatisch", automaticD: "Blendet geeignete Kommentare mit hoher Konfidenz automatisch aus.",
    threshold: "Mindestkonfidenz für automatisches Ausblenden", thresholdHint: `Der Server geht nie unter ${Math.round(SERVER_MIN * 100)} %.`,
    autoCats: "Automatisch ausführbare Kategorien", otherCats: "Andere Kategorien (Vulgarität, Hass, Belästigung, Identitätsmissbrauch…) werden erkannt und vorgeschlagen, nie automatisch ausgeblendet.",
    confirmTitle: "Automatisches Ausblenden aktivieren?", confirmBody: "Wenn ein Kommentar über Ihrem Konfidenzschwellenwert als Spam, Betrug oder Phishing eingestuft wird, blendet Tamanor ihn automatisch öffentlich aus — ohne Klick. Sie können jederzeit zurückwechseln.",
    confirmCheck: "Ich verstehe es und möchte automatisches Ausblenden bei diesem Konto.",
    killPaused: "Die automatische Ausführung ist vom Betreiber vorübergehend pausiert. Ihre Einstellung ist gespeichert und wird wieder aktiv, sobald sie eingeschaltet wird.",
    monitoringOff: "Die Überwachung für dieses Konto ist aus — der Schutz ist inaktiv, bis Sie die Überwachung einschalten.",
    autoUnavailable: "Automatisch ist für ein Test- oder Nur-Lese-Konto nicht verfügbar.",
    save: "Schutz speichern", saving: "Wird gespeichert…", noPermission: "Nur ein Workspace-Admin kann den Schutz ändern.",
  },
} as const;

function SaveButton({ label, saving, disabled }: { label: string; saving: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending}
      className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)] disabled:cursor-not-allowed disabled:opacity-50">
      {pending ? saving : label}
    </button>
  );
}

export function ProtectionCard({ accountId, currentMode, currentMinConfidence, canAutomatic, monitoringActive, killSwitchActive, canManage, locale }: {
  accountId: string; currentMode: UiMode; currentMinConfidence: number; canAutomatic: boolean;
  monitoringActive: boolean; killSwitchActive: boolean; canManage: boolean; locale: Locale;
}) {
  const c = T[locale];
  const [mode, setMode] = useState<UiMode>(currentMode);
  const [conf, setConf] = useState<number>(Math.max(SERVER_MIN, currentMinConfidence));
  const [confirmed, setConfirmed] = useState(false);
  const modes: { key: UiMode; label: string; desc: string }[] = [
    { key: "suggest_only", label: c.suggest_only, desc: c.suggest_onlyD },
    { key: "require_approval", label: c.require_approval, desc: c.require_approvalD },
    { key: "automatic", label: c.automatic, desc: c.automaticD },
  ];
  const wantsAutomatic = mode === "automatic";
  // Choosing AUTOMATIC always needs an explicit fresh confirmation (conscious action every save).
  const saveDisabled = !canManage || (wantsAutomatic && !confirmed);

  return (
    <div className="mt-6 gu-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-sm font-semibold">🛡️ {c.title}</h3>
      </div>
      <p className="mb-4 text-xs text-[var(--color-muted)]">{c.subtitle}</p>

      {killSwitchActive ? (
        <p className="mb-3 rounded-lg border border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-2 text-xs text-[var(--color-warn)]">⏸ {c.killPaused}</p>
      ) : null}
      {!monitoringActive ? (
        <p className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-xs text-[var(--color-muted)]">{c.monitoringOff}</p>
      ) : null}

      <form action={updateProtectionAction} className="space-y-4">
        <input type="hidden" name="accountId" value={accountId} />
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="minConfidence" value={conf} />

        {/* Segmented mode control */}
        <div role="radiogroup" aria-label={c.title} className="grid gap-2 sm:grid-cols-3">
          {modes.map((m) => {
            const active = mode === m.key;
            const disabled = !canManage || (m.key === "automatic" && !canAutomatic);
            return (
              <button key={m.key} type="button" role="radio" aria-checked={active} disabled={disabled}
                title={m.key === "automatic" && !canAutomatic ? c.autoUnavailable : undefined}
                onClick={() => { setMode(m.key); if (m.key !== "automatic") setConfirmed(false); }}
                className={`rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${active ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)]/40 ring-1 ring-[var(--color-brand)]" : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"}`}>
                <span className="block text-sm font-medium">{m.label}</span>
                <span className="mt-0.5 block text-[11px] text-[var(--color-muted)]">{m.desc}</span>
              </button>
            );
          })}
        </div>
        {!canAutomatic ? <p className="text-[11px] text-[var(--color-muted)]">{c.autoUnavailable}</p> : null}

        {/* Confidence slider (server-floored) */}
        <div>
          <label htmlFor="minConfidence-slider" className="flex items-center justify-between text-xs font-medium">
            <span>{c.threshold}</span>
            <span className="tabular-nums text-[var(--color-brand)]">{Math.round(conf * 100)}%</span>
          </label>
          <input id="minConfidence-slider" type="range" min={SERVER_MIN} max={1} step={0.01} value={conf}
            disabled={!canManage}
            onChange={(e) => setConf(Math.max(SERVER_MIN, Number(e.target.value)))}
            className="mt-2 w-full accent-[var(--color-brand)]" />
          <p className="mt-1 text-[11px] text-[var(--color-muted)]">{c.thresholdHint}</p>
        </div>

        {/* Auto-executable categories (from Control Center; shown here, not re-toggled) */}
        <div>
          <p className="text-xs font-medium">{c.autoCats}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {AUTO_CATEGORIES.map((cat) => (
              <span key={cat} className="rounded-full border border-[var(--color-ok)] bg-[var(--color-ok-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-ok)]">{cat}</span>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--color-muted)]">{c.otherCats}</p>
        </div>

        {/* AUTOMATIC confirmation — conscious action with a plain-language explanation */}
        {wantsAutomatic && canAutomatic ? (
          <div className="rounded-xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)]/50 p-3">
            <p className="text-xs font-semibold">{c.confirmTitle}</p>
            <p className="mt-1 text-[11px] text-[var(--color-muted)]">{c.confirmBody}</p>
            <label className="mt-2 flex items-start gap-2 text-[11px]">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 accent-[var(--color-brand)]" />
              <span>{c.confirmCheck}</span>
            </label>
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <SaveButton label={c.save} saving={c.saving} disabled={saveDisabled} />
          {!canManage ? <span className="text-[11px] text-[var(--color-muted)]">{c.noPermission}</span> : null}
        </div>
      </form>
    </div>
  );
}
