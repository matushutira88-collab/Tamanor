"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PolicyCopy } from "../policy-i18n";
import { versionUiActions, decisionSummaryFlags, type PolicyUiCapabilities } from "../policy-view";

interface VersionLite { id: string; versionNumber: number; status: string; definition: unknown; }
interface SimResult { matchedRuleIds: string[]; unmatchedRuleIds?: string[]; explanationCodes: string[]; decision: Parameters<typeof decisionSummaryFlags>[0]; ok: boolean; errorCode: string | null; }

/** Per-version lifecycle + editor + validate + simulate. All state changes go through same-origin API
 *  routes; the server re-enforces permission, immutability, and two-person control. No window.confirm,
 *  no unsafe HTML, no executable content — the definition is data (JSON). */
export function VersionActions({ t, policyId, version, caps, purpose }: { t: PolicyCopy; policyId: string; version: VersionLite; caps: PolicyUiCapabilities; purpose: string }) {
  const router = useRouter();
  const a = versionUiActions(version.status, caps);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [definition, setDefinition] = useState(() => JSON.stringify(version.definition, null, 2));
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[] } | null>(null);
  const [showSim, setShowSim] = useState(false);
  const [cases, setCases] = useState("[{}]");
  const [sim, setSim] = useState<SimResult[] | null>(null);
  const [confirmActivate, setConfirmActivate] = useState(false);
  const [reason, setReason] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirmActivate) return;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setConfirmActivate(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmActivate]);

  const errText = (code: string): string => (t.errors as Record<string, string>)[code] ?? t.errors.internal ?? "Error";
  async function post(url: string, body: unknown, method = "POST") {
    setBusy(true); setMsg(null);
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: "internal" }));
    setBusy(false);
    return res as { ok: boolean; error?: string; [k: string]: unknown };
  }
  const base = `/api/v1/child-safety/policies/${policyId}/versions/${version.id}`;

  async function saveDraft() {
    let parsed: unknown; try { parsed = JSON.parse(definition); } catch { setMsg({ kind: "err", text: errText("invalid_definition") }); return; }
    const r = await post(base, { definition: parsed }, "PATCH");
    if (r.ok) { setMsg({ kind: "ok", text: t.actions.save }); router.refresh(); } else setMsg({ kind: "err", text: errText(r.error ?? "internal") });
  }
  async function validate() {
    let parsed: unknown; try { parsed = JSON.parse(definition); } catch { setValidation({ valid: false, errors: ["invalid_json"] }); return; }
    const r = await post(`${base}/action`, { action: "validate", definition: parsed });
    if (r.ok) setValidation(r.validation as { valid: boolean; errors: string[] });
  }
  async function runSim() {
    let parsed: unknown; try { parsed = JSON.parse(cases); } catch { setMsg({ kind: "err", text: errText("invalid_definition") }); return; }
    const r = await post(`${base}/action`, { action: "simulate", cases: parsed });
    if (r.ok) setSim(((r.cases as Array<{ result: SimResult }>) ?? []).map((c) => c.result));
    else setMsg({ kind: "err", text: errText(r.error ?? "internal") });
  }
  async function lifecycle(action: "submit" | "approve" | "reject" | "activate") {
    const r = await post(`${base}/action`, { action, ...(action === "reject" ? { reasonCode: reason || "rejected" } : {}) });
    setConfirmActivate(false);
    if (r.ok) { setMsg({ kind: "ok", text: t.actions[action] ?? action }); router.refresh(); } else setMsg({ kind: "err", text: errText(r.error ?? "internal") });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {a.canEdit ? <button type="button" onClick={() => setShowEditor((s) => !s)} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">{t.actions.edit}</button> : null}
        {a.canSimulate ? <button type="button" onClick={() => setShowSim((s) => !s)} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">{t.actions.simulate}</button> : null}
        {a.canSubmit ? <button type="button" disabled={busy} onClick={() => lifecycle("submit")} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">{t.actions.submit}</button> : null}
        {a.canApprove ? <button type="button" disabled={busy} onClick={() => lifecycle("approve")} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">{t.actions.approve}</button> : null}
        {a.canReject ? <button type="button" disabled={busy} onClick={() => lifecycle("reject")} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">{t.actions.reject}</button> : null}
        {a.canActivate ? <button type="button" disabled={busy} onClick={() => setConfirmActivate(true)} className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-fg)]">{t.actions.activate}</button> : null}
      </div>
      {msg ? <p role="status" className={`text-xs ${msg.kind === "err" ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]"}`}>{msg.text}</p> : null}

      {showEditor && a.canEdit ? (
        <div className="space-y-2">
          <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{t.editor.definitionJson}
            <textarea value={definition} onChange={(e) => setDefinition(e.target.value)} spellCheck={false} rows={12} className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-xs text-[var(--color-fg)]" />
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={saveDraft} className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-fg)]">{t.actions.save}</button>
            <button type="button" disabled={busy} onClick={validate} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">{t.actions.validate}</button>
          </div>
          {validation ? (
            validation.valid ? <p className="text-xs text-[var(--color-ok)]">✓ {t.editor.validationOk}</p>
              : <div className="text-xs text-[var(--color-danger)]"><p>{t.editor.validationErrors}:</p><ul className="ml-4 list-disc">{validation.errors.slice(0, 10).map((e, i) => <li key={i} className="font-mono">{e}</li>)}</ul></div>
          ) : null}
        </div>
      ) : null}

      {showSim && a.canSimulate ? (
        <div className="space-y-2">
          <p className="text-[11px] text-[var(--color-muted)]">🧪 {t.simulation.noSideEffects}</p>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{t.simulation.caseLabel} (JSON)
            <textarea value={cases} onChange={(e) => setCases(e.target.value)} spellCheck={false} rows={5} className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-xs text-[var(--color-fg)]" />
          </label>
          <button type="button" disabled={busy} onClick={runSim} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">{t.simulation.run}</button>
          {sim ? (
            <div className="space-y-2">
              {sim.map((s, i) => (
                <div key={i} className="rounded-lg border border-[var(--color-border)] p-2 text-xs">
                  <p className="font-semibold">{t.simulation.caseLabel} {i + 1}</p>
                  <p className="text-[var(--color-muted)]">{t.simulation.matchedRules}: <span className="font-mono">{s.matchedRuleIds.join(", ") || "—"}</span></p>
                  <p className="text-[var(--color-muted)]">{t.simulation.effects}: <span className="font-mono">{decisionSummaryFlags(s.decision).join(", ") || "—"}</span></p>
                  <p className="text-[var(--color-muted)]">{t.simulation.explanations}: <span className="font-mono">{s.explanationCodes.join(", ")}</span></p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {confirmActivate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t.approval.activateTitle} ref={dialogRef}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h3 className="text-sm font-semibold text-[var(--color-fg)]">{t.approval.activateTitle}</h3>
            <p className="mt-2 text-sm text-[var(--color-muted)]">{t.approval.activateBody}</p>
            <p className="mt-2 text-[11px] text-[var(--color-muted)]">👥 {t.twoPersonNotice}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmActivate(false)} className="rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium">{t.actions.cancel}</button>
              <button type="button" disabled={busy} onClick={() => lifecycle("activate")} className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)]">{t.approval.confirmActivate}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
