"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge } from "@/components/dashboard/ui";
// Browser-safe subpath (not the "@guardora/core" barrel) so this client module never drags the barrel's
// server-only crypto (hibp → node:crypto) into the bundle.
import { PARTNER_RISK_TYPES, PARTNER_CONFIDENCE_BANDS, PARTNER_SEVERITY_HINTS } from "@guardora/core/child-safety-integration";
import type { IntegrationCopy } from "./integration-i18n";
import { installationStatusTone, keyStatusTone, resultCodeTone } from "./integration-view";

interface Installation { id: string; installationKey: string; status: string }
interface Application { id: string; applicationKey: string; environment: string; status: string; installations: Installation[] }
interface Partner { id: string; partnerKey: string; displayName: string; status: string; applications: Application[] }
interface Caps { manage: boolean; keys: boolean; sandbox: boolean }

async function post(body: unknown) {
  return fetch("/api/v1/child-safety/integrations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: "internal" }));
}

/** LOCAL SANDBOX registry + key lifecycle + synthetic signal builder. No raw-message field, no private-key
 *  upload (public key only), no window.confirm, no unsafe HTML, no executable content. */
export function IntegrationConsole({ t, caps, partners }: { t: IntegrationCopy; caps: Caps; partners: Partner[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [newPartner, setNewPartner] = useState("");

  async function run(body: unknown) { setBusy(true); setMsg(null); const r = await post(body); setBusy(false); if (r.ok) { router.refresh(); } else setMsg(String(r.error ?? "error")); return r; }

  return (
    <div className="space-y-4">
      <section aria-label={t.sections.partners} className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.partners}</h2>
        {caps.manage ? (
          <form onSubmit={(e) => { e.preventDefault(); if (newPartner) run({ action: "create_partner", partnerKey: newPartner, displayName: newPartner }); setNewPartner(""); }} className="flex flex-wrap items-end gap-2" aria-label={t.actions.createPartner}>
            <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{t.labels.partnerKey}
              <input value={newPartner} onChange={(e) => setNewPartner(e.target.value)} pattern="[a-z0-9][a-z0-9_-]{1,63}" required className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-fg)]" />
            </label>
            <button type="submit" disabled={busy} className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-fg)]">{t.actions.createPartner}</button>
          </form>
        ) : null}
        {msg ? <p role="alert" className="text-xs text-[var(--color-danger)]">{(t.errorRef as Record<string, string>)[msg] ?? msg}</p> : null}
      </section>

      {partners.length === 0 ? <Card className="p-6 text-center text-sm text-[var(--color-muted)]">{t.labels.empty}</Card> : partners.map((p) => (
        <Card key={p.id} className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{p.partnerKey}</span>
            <Badge tone={installationStatusTone(p.status)}>{t.statusLabel[p.status] ?? p.status}</Badge>
            {caps.manage ? <NewChild label={t.actions.createApplication} placeholder={t.labels.applicationKey} onCreate={(v) => run({ action: "create_application", partnerId: p.id, applicationKey: v, displayName: v })} busy={busy} /> : null}
          </div>
          {p.applications.map((a) => (
            <div key={a.id} className="ml-3 space-y-2 border-l border-[var(--color-border)] pl-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono">{a.applicationKey}</span><Badge tone="neutral">{a.environment}</Badge>
                {caps.manage ? <NewChild label={t.actions.createInstallation} placeholder={t.labels.installationKey} onCreate={(v) => run({ action: "create_installation", applicationId: a.id, installationKey: v })} busy={busy} /> : null}
              </div>
              {a.installations.map((inst) => (
                <InstallationPanel key={inst.id} t={t} caps={caps} inst={inst} busy={busy} run={run} />
              ))}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}

function NewChild({ label, placeholder, onCreate, busy }: { label: string; placeholder: string; onCreate: (v: string) => void; busy: boolean }) {
  const [v, setV] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (v) onCreate(v); setV(""); }} className="flex items-center gap-1">
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder} pattern="[a-z0-9][a-z0-9_-]{1,63}" className="w-28 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-fg)]" />
      <button type="submit" disabled={busy} className="rounded-lg border border-[var(--color-border-strong)] px-2 py-1 text-xs font-medium">＋ {label}</button>
    </form>
  );
}

function InstallationPanel({ t, caps, inst, busy, run }: { t: IntegrationCopy; caps: Caps; inst: Installation; busy: boolean; run: (b: unknown) => Promise<{ ok: boolean; result?: { code: string } }> }) {
  const [pubKey, setPubKey] = useState("");
  const [subj, setSubj] = useState("");
  const [profile, setProfile] = useState("");
  const [riskType, setRiskType] = useState(PARTNER_RISK_TYPES[0]!);
  const [conf, setConf] = useState("high");
  const [danger, setDanger] = useState(false);
  const [sandboxResult, setSandboxResult] = useState<string | null>(null);

  return (
    <div className="ml-3 space-y-2 rounded-lg border border-[var(--color-border)] p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono">{inst.installationKey}</span>
        <Badge tone={installationStatusTone(inst.status)}>{t.statusLabel[inst.status] ?? inst.status}</Badge>
        {caps.manage ? (
          <button type="button" disabled={busy} onClick={() => run({ action: "set_installation_status", installationId: inst.id, status: inst.status === "active" ? "suspended" : "active" })} className="rounded-lg border border-[var(--color-border-strong)] px-2 py-1 font-medium">{inst.status === "active" ? t.actions.suspend : t.actions.reactivate}</button>
        ) : null}
      </div>

      {caps.keys ? (
        <form onSubmit={(e) => { e.preventDefault(); if (pubKey) run({ action: "register_key", installationId: inst.id, publicKeyBase64: pubKey.trim() }); setPubKey(""); }} className="flex flex-wrap items-end gap-1">
          <label className="flex flex-1 flex-col gap-1 text-[var(--color-muted)]">{t.labels.publicKey}
            <input value={pubKey} onChange={(e) => setPubKey(e.target.value)} placeholder="base64 SPKI (public key only)" className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[var(--color-fg)]" />
          </label>
          <button type="submit" disabled={busy} className="rounded-lg border border-[var(--color-border-strong)] px-2 py-1 font-medium">{t.actions.registerKey}</button>
        </form>
      ) : null}

      {caps.manage ? (
        <form onSubmit={(e) => { e.preventDefault(); if (subj && profile) run({ action: "link_subject", installationId: inst.id, pseudonymousSubjectId: subj, protectedProfileId: profile }); }} className="flex flex-wrap items-end gap-1">
          <input value={subj} onChange={(e) => setSubj(e.target.value)} placeholder={t.labels.pseudonymousSubject} aria-label={t.labels.pseudonymousSubject} className="w-32 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1 text-[var(--color-fg)]" />
          <input value={profile} onChange={(e) => setProfile(e.target.value)} placeholder={t.labels.protectedProfile} aria-label={t.labels.protectedProfile} className="w-32 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1 text-[var(--color-fg)]" />
          <button type="submit" disabled={busy} className="rounded-lg border border-[var(--color-border-strong)] px-2 py-1 font-medium">{t.actions.linkSubject}</button>
        </form>
      ) : null}

      {caps.sandbox ? (
        <div className="space-y-1 rounded-lg bg-[var(--color-neutral-soft)] p-2">
          <p className="font-semibold">🧪 {t.builder.title}</p>
          <p className="text-[var(--color-muted)]">{t.builder.noRawFieldNote}</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[var(--color-muted)]">{t.builder.signalType}
              <select value={riskType} onChange={(e) => setRiskType(e.target.value)} className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1 text-[var(--color-fg)]">{PARTNER_RISK_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 text-[var(--color-muted)]">{t.builder.confidenceBand}
              <select value={conf} onChange={(e) => setConf(e.target.value)} className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1 text-[var(--color-fg)]">{PARTNER_CONFIDENCE_BANDS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            </label>
            <label className="flex items-center gap-1 text-[var(--color-muted)]"><input type="checkbox" checked={danger} onChange={(e) => setDanger(e.target.checked)} /> {t.builder.immediateDanger}</label>
            <button type="button" disabled={busy} onClick={async () => { const r = await run({ action: "sandbox_send", installationId: inst.id, signal: { signalType: riskType, confidenceBand: conf, severityHint: PARTNER_SEVERITY_HINTS.includes(conf) ? conf : undefined, immediateDangerFlag: danger, pseudonymousSubjectId: subj || undefined } }); if (r?.result) setSandboxResult(r.result.code); }} className="rounded-lg bg-[var(--color-brand)] px-3 py-1 font-semibold text-[var(--color-brand-fg)]">{t.actions.sandboxSend}</button>
          </div>
          {sandboxResult ? <p aria-live="polite"><Badge tone={resultCodeTone(sandboxResult)}>{t.resultLabel[sandboxResult] ?? sandboxResult}</Badge></p> : null}
        </div>
      ) : null}
      {keyStatusTone("active") ? null : null}
    </div>
  );
}
