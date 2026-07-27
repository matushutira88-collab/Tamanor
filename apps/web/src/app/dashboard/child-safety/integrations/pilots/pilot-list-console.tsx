"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/dashboard/ui";
import type { PilotCopy } from "./pilot-i18n";

interface AppOption { partnerId: string; partnerKey: string; applicationId: string; applicationKey: string; environment: string }

async function post(body: unknown) {
  return fetch("/api/v1/child-safety/integrations/pilots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: "internal" }));
}

/** Create a new draft pilot for an existing partner application. Content-free — no sensitive input fields. */
export function PilotListConsole({ t, apps }: { t: PilotCopy; apps: AppOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sel, setSel] = useState("");

  async function create() {
    const opt = apps.find((a) => a.applicationId === sel);
    if (!opt) return;
    setBusy(true); setMsg(null);
    const r = await post({ action: "create_pilot", partnerId: opt.partnerId, applicationId: opt.applicationId, requestedCapabilities: ["signal.submit"] });
    setBusy(false);
    if (r.ok) router.refresh(); else setMsg(t.errorRef[String(r.error)] ?? String(r.error));
  }

  return (
    <Card className="space-y-2 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.sections.create}</h2>
      <form onSubmit={(e) => { e.preventDefault(); create(); }} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{t.fields.application}
          <select value={sel} onChange={(e) => setSel(e.target.value)} required className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-fg)]">
            <option value="">—</option>
            {apps.map((a) => <option key={a.applicationId} value={a.applicationId}>{a.partnerKey} / {a.applicationKey} ({a.environment})</option>)}
          </select>
        </label>
        <button type="submit" disabled={busy || !sel} className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-fg)]">{t.sections.create}</button>
      </form>
      {msg ? <p role="alert" className="text-xs text-[var(--color-danger)]">{msg}</p> : null}
    </Card>
  );
}
