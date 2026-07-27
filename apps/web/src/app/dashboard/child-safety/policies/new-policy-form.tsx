"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/dashboard/ui";
import type { PolicyCopy } from "./policy-i18n";

const PURPOSES = ["SIGNAL_TRIAGE", "INCIDENT_CLASSIFICATION", "ESCALATION", "PROTECTION_PLAN", "INTERVENTION_AUTHORIZATION", "GUARDIAN_CONTACT_ELIGIBILITY"];

const TEMPLATE = (purpose: string) => JSON.stringify({
  schemaVersion: 1, purpose, defaultEffect: "REQUIRE_REVIEW",
  rules: [{ id: "example_rule", priority: 10, enabled: true, explanationCode: "example", condition: { field: purpose === "SIGNAL_TRIAGE" ? "confidenceBand" : "severity", operator: "EQUALS", value: purpose === "SIGNAL_TRIAGE" ? "high" : "critical" }, effects: [{ type: "REQUIRE_REVIEW" }] }],
}, null, 2);

/** Create a new policy + first draft version. Data-only JSON editor — no script/expression execution. */
export function NewPolicyForm({ t }: { t: PolicyCopy }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState(PURPOSES[0]!);
  const [policyKey, setPolicyKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [definition, setDefinition] = useState(TEMPLATE(PURPOSES[0]!));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    let parsed: unknown;
    try { parsed = JSON.parse(definition); } catch { setError(t.errors.invalid_definition ?? "Error"); setBusy(false); return; }
    const res = await fetch("/api/v1/child-safety/policies", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ policyKey, purpose, displayName, definition: parsed }),
    }).then((r) => r.json()).catch(() => ({ ok: false, error: "internal" }));
    setBusy(false);
    if (res.ok) { setOpen(false); setPolicyKey(""); setDisplayName(""); router.refresh(); }
    else setError((t.errors as Record<string, string>)[res.error] ?? t.errors.internal ?? "Error");
  }

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)]">{t.actions.create}</button>;
  }
  return (
    <Card className="space-y-3 p-4">
      <form onSubmit={submit} className="space-y-3" aria-label={t.actions.create}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{t.list.policyKey}
            <input required value={policyKey} onChange={(e) => setPolicyKey(e.target.value)} pattern="[a-z0-9][a-z0-9_-]{1,63}" className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-fg)]" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{t.list.purpose}
            <select value={purpose} onChange={(e) => { setPurpose(e.target.value); setDefinition(TEMPLATE(e.target.value)); }} className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-fg)]">
              {PURPOSES.map((p) => <option key={p} value={p}>{t.purpose[p] ?? p}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{t.detail.version}
            <input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-fg)]" />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{t.editor.definitionJson}
          <textarea value={definition} onChange={(e) => setDefinition(e.target.value)} spellCheck={false} rows={12} className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-xs text-[var(--color-fg)]" />
        </label>
        <p className="text-[11px] text-[var(--color-muted)]">{t.editor.noExecutable}</p>
        {error ? <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p> : null}
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] disabled:opacity-50">{busy ? t.actions.working : t.actions.create}</button>
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium">{t.actions.cancel}</button>
        </div>
      </form>
    </Card>
  );
}
