"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/dashboard/ui";
import {
  PILOT_SUSPENSION_REASON_CODES, PILOT_TERMINATION_REASON_CODES, REQUIRED_READINESS_TESTS,
} from "@guardora/core/child-safety-partner-pilot";
import type { PilotCopy } from "../pilot-i18n";

interface PilotLite { id: string; status: string; version: number }
interface Caps { manage: boolean; review: boolean; activate: boolean; suspend: boolean; audit: boolean }

async function post(body: unknown) {
  return fetch("/api/v1/child-safety/integrations/pilots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: "internal" }));
}

// Which lifecycle transition buttons are available from a status (mirrors the server state machine).
const TRANSITIONS_FOR: Record<string, string[]> = {
  DRAFT: ["submit"], CHANGES_REQUIRED: ["submit"], SUBMITTED: ["begin_review"],
  UNDER_REVIEW: ["approve_sandbox", "request_changes", "reject"], APPROVED_FOR_SANDBOX: ["activate_sandbox"],
  SANDBOX_ACTIVE: ["start_readiness"], READINESS_REVIEW: ["mark_ready", "request_changes"],
  PILOT_ACTIVE: ["pause"], PILOT_PAUSED: ["resume"], SUSPENDED: ["start_readiness"],
};

export function PilotDetailControls({ t, pilot, caps }: { t: PilotCopy; pilot: PilotLite; caps: Caps }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<null | { kind: "activate" | "suspend" | "terminate"; reason?: string }>(null);

  async function run(body: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    const r = await post({ ...body, pilotId: pilot.id, expectedVersion: pilot.version });
    setBusy(false);
    if (r.ok) router.refresh(); else setMsg(t.errorRef[String(r.error)] ?? String(r.error));
    return r;
  }

  const canReviewOrManage = caps.review || caps.manage;
  const transitions = (TRANSITIONS_FOR[pilot.status] ?? []).filter((tr) => {
    if (tr === "submit" || tr === "activate_sandbox") return caps.manage;
    if (tr === "pause" || tr === "resume") return caps.suspend || caps.manage;
    return caps.review; // review/approve/reject/readiness
  });

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.controls}</h2>
      <div className="flex flex-wrap gap-2">
        {transitions.map((tr) => (
          <button key={tr} type="button" disabled={busy} onClick={() => run({ action: "transition", transition: tr })} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">
            {t.actionLabel[tr] ?? tr}
          </button>
        ))}
        {caps.activate && pilot.status === "READY_FOR_PILOT" ? (
          <button type="button" disabled={busy} onClick={() => setConfirmAction({ kind: "activate" })} className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-fg)]">{t.actionLabel.activate}</button>
        ) : null}
        {caps.suspend && ["APPROVED_FOR_SANDBOX", "SANDBOX_ACTIVE", "READINESS_REVIEW", "READY_FOR_PILOT", "PILOT_ACTIVE", "PILOT_PAUSED"].includes(pilot.status) ? (
          <button type="button" disabled={busy} onClick={() => setConfirmAction({ kind: "suspend", reason: PILOT_SUSPENSION_REASON_CODES[0] })} className="rounded-lg border border-[var(--color-warn)] px-3 py-1.5 text-xs font-semibold text-[var(--color-warn)]">{t.actionLabel.suspend}</button>
        ) : null}
        {caps.activate && !["TERMINATED", "REJECTED"].includes(pilot.status) ? (
          <button type="button" disabled={busy} onClick={() => setConfirmAction({ kind: "terminate", reason: PILOT_TERMINATION_REASON_CODES[0] })} className="rounded-lg border border-[var(--color-danger)] px-3 py-1.5 text-xs font-semibold text-[var(--color-danger)]">{t.actionLabel.terminate}</button>
        ) : null}
        <button type="button" disabled={busy} onClick={() => run({ action: "evaluate_readiness" })} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">{t.actionLabel.evaluate}</button>
      </div>

      {canReviewOrManage && !["TERMINATED", "REJECTED", "PILOT_ACTIVE"].includes(pilot.status) ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">{t.actionLabel.run_test}:</span>
          {REQUIRED_READINESS_TESTS.map((tt) => (
            <button key={tt} type="button" disabled={busy} onClick={() => run({ action: "run_test", testType: tt })} className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-[11px] font-medium">{t.testTypeLabel[tt] ?? tt}</button>
          ))}
        </div>
      ) : null}

      {msg ? <p role="alert" className="text-xs text-[var(--color-danger)]">{msg}</p> : null}

      {confirmAction ? (
        <div role="dialog" aria-modal="true" aria-label={t.confirm[confirmAction.kind]} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-sm space-y-3 p-5">
            <p className="text-sm text-[var(--color-fg)]">{t.confirm[confirmAction.kind]}</p>
            {confirmAction.kind === "suspend" ? (
              <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">Reason
                <select value={confirmAction.reason} onChange={(e) => setConfirmAction({ ...confirmAction, reason: e.target.value })} className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-fg)]">
                  {PILOT_SUSPENSION_REASON_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            ) : null}
            {confirmAction.kind === "terminate" ? (
              <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">Reason
                <select value={confirmAction.reason} onChange={(e) => setConfirmAction({ ...confirmAction, reason: e.target.value })} className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-fg)]">
                  {PILOT_TERMINATION_REASON_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmAction(null)} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">{t.confirm.cancel}</button>
              <button type="button" disabled={busy} onClick={async () => { const a = confirmAction; setConfirmAction(null); if (a.kind === "activate") await run({ action: "activate" }); else if (a.kind === "suspend") await run({ action: "suspend", reasonCode: a.reason }); else await run({ action: "terminate", reasonCode: a.reason }); }} className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-fg)]">{t.confirm.confirm}</button>
            </div>
          </Card>
        </div>
      ) : null}
    </Card>
  );
}
