"use client";

import { useState } from "react";

/**
 * Client action-state panel ONLY. All authorization / readiness / execution is server-side (the POST route +
 * dispatch). This component just posts an intent and renders the returned COUNTS. It never receives or holds a
 * token/key/ciphertext/account id. Result is kept in component state only (never persisted to browser storage).
 */
interface SafeRun {
  scanned: number; skippedNoToken: number; alreadyVaulted: number; backfilled: number;
  verified: number; legacyCleared: number; errors: number; progress: "DONE" | "MORE"; resumeToken?: string;
}
interface ResultBody {
  ok: boolean; mode: string; error?: string;
  run?: SafeRun;
}

export function CutoverPanel({ ready, deploymentSha, legacyPopulated }: { ready: boolean; deploymentSha: string | null; legacyPopulated: number }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultBody | null>(null);
  const [phrase, setPhrase] = useState("");
  const [ack, setAck] = useState(false);

  const post = async (payload: Record<string, unknown>) => {
    setBusy(true); setResult(null);
    try {
      const res = await fetch("/api/platform/provider-credential-cutover", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      setResult(await res.json().catch(() => ({ ok: false, mode: String(payload.mode), error: "invalid_request" })));
    } catch {
      setResult({ ok: false, mode: String(payload.mode), error: "invalid_request" });
    } finally { setBusy(false); }
  };

  const canApply = ready && legacyPopulated > 0 && phrase === "MIGRATE_PROVIDER_CREDENTIALS_TO_VAULT" && ack && !busy;

  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => post({ mode: "dry-run" })}
          className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 font-semibold hover:bg-[var(--color-surface-2)] disabled:opacity-50">
          Run dry-run inventory
        </button>
        {ready ? <span className="text-[var(--color-muted)]">read-only · classifies legacy credentials</span> : <span className="text-[var(--color-muted)]">runtime not ready — actions are disabled server-side</span>}
      </div>

      <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
        <label className="block">
          <span className="text-[var(--color-muted)]">Type the exact phrase to arm apply</span>
          <input value={phrase} onChange={(e) => setPhrase(e.target.value)} spellCheck={false} autoComplete="off"
            className="mt-1 w-full rounded border border-[var(--color-border)] bg-transparent px-2 py-1 font-mono" placeholder="MIGRATE_PROVIDER_CREDENTIALS_TO_VAULT" />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>I understand this clears legacy token columns after the vault credential is verified. No provider call is made.</span>
        </label>
        <button type="button" disabled={!canApply} onClick={() => post({ mode: "apply", confirmation: phrase, acknowledge: ack, expectedSha: deploymentSha })}
          className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 font-semibold text-[var(--color-danger)] hover:bg-[var(--color-surface-2)] disabled:opacity-50">
          Apply cutover (bounded, 25/batch)
        </button>
        {legacyPopulated === 0 ? <p className="text-[var(--color-muted)]">No legacy credentials remain — apply is a no-op.</p> : null}
      </div>

      {busy ? <p className="text-[var(--color-muted)]">Working…</p> : null}
      {result ? (
        <div className="border-t border-[var(--color-border)] pt-3">
          <p className="mb-1 font-semibold">{result.ok ? "✓" : "✗"} {result.mode} {result.error ? `— ${result.error}` : ""}</p>
          {result.run ? (
            <pre className="overflow-x-auto rounded bg-[var(--color-surface-2)] p-2 font-mono text-[11px]">{JSON.stringify(result.run, null, 2)}</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
