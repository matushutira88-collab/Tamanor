"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge } from "@/components/dashboard/ui";
import type { AdminCopy } from "../admin-i18n";

interface AdminRow { userId: string; name: string | null; email: string; platformRole: string; active: boolean; platformRoleUpdatedAt: string | null; platformLastAccessAt: string | null }
const ASSIGNABLE = ["owner", "admin", "analyst", "support"] as const;

async function post(body: unknown) {
  return fetch("/api/platform/admins", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: "internal" }));
}

/** Administrator management (owner-only). Accessible confirmation dialogs; no password/session handling; no
 *  hardcoded email logic. Last-owner protection + recent-auth are enforced server-side. */
export function AdminConsole({ t, selfUserId, admins }: { t: AdminCopy; selfUserId: string; admins: AdminRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("analyst");
  const [confirm, setConfirm] = useState<null | { kind: "deactivate" | "change"; row: AdminRow; role?: string }>(null);

  async function run(body: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    const r = await post(body);
    setBusy(false);
    if (r.ok) router.refresh(); else setMsg(t.errorRef[String(r.error)] ?? String(r.error));
    return r;
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{t.admin.addExisting}</h2>
        <form onSubmit={(e) => { e.preventDefault(); if (email) run({ action: "add_admin", email, role }); }} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{t.admin.addEmail}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-fg)]" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{t.admin.addRole}
            <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-fg)]">{ASSIGNABLE.map((r) => <option key={r} value={r}>{t.roleLabel[r] ?? r}</option>)}</select>
          </label>
          <button type="submit" disabled={busy || !email} className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-fg)]">{t.admin.add}</button>
        </form>
        {msg ? <p role="alert" className="text-xs text-[var(--color-danger)]">{msg}</p> : null}
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-xs"><caption className="sr-only">{t.nav.administrators}</caption>
          <thead><tr className="border-b border-[var(--color-border)] text-left uppercase tracking-wider text-[var(--color-muted)]"><th scope="col" className="px-4 py-2">{t.fields.name}</th><th scope="col" className="px-3 py-2">{t.fields.role}</th><th scope="col" className="px-3 py-2">{t.fields.status}</th><th scope="col" className="px-3 py-2">{t.fields.lastChange}</th><th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.userId} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-2">{a.name ?? a.email}</td>
                <td className="px-3 py-2">
                  {a.userId === selfUserId ? <Badge tone="brand">{t.roleLabel[a.platformRole] ?? a.platformRole}</Badge> : (
                    <select aria-label={t.admin.changeRole} defaultValue={a.platformRole} disabled={busy} onChange={(e) => { if (e.target.value !== a.platformRole) setConfirm({ kind: "change", row: a, role: e.target.value }); }} className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1 text-xs">{ASSIGNABLE.map((r) => <option key={r} value={r}>{t.roleLabel[r] ?? r}</option>)}</select>
                  )}
                </td>
                <td className="px-3 py-2"><Badge tone={a.active ? "ok" : "neutral"}>{a.active ? t.fields.active : t.fields.inactive}</Badge></td>
                <td className="px-3 py-2 whitespace-nowrap text-[var(--color-muted)]">{a.platformRoleUpdatedAt?.slice(0, 10) ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  {a.userId !== selfUserId ? (a.active
                    ? <button type="button" disabled={busy} onClick={() => setConfirm({ kind: "deactivate", row: a })} className="rounded-lg border border-[var(--color-warn)] px-2 py-1 text-[11px] font-medium text-[var(--color-warn)]">{t.admin.deactivate}</button>
                    : <button type="button" disabled={busy} onClick={() => run({ action: "reactivate", targetUserId: a.userId })} className="rounded-lg border border-[var(--color-border-strong)] px-2 py-1 text-[11px] font-medium">{t.admin.reactivate}</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {confirm ? (
        <div role="dialog" aria-modal="true" aria-label={confirm.kind === "deactivate" ? t.admin.confirmDeactivate : t.admin.confirmChange} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-sm space-y-3 p-5">
            <p className="text-sm">{confirm.kind === "deactivate" ? t.admin.confirmDeactivate : t.admin.confirmChange}</p>
            <p className="text-xs text-[var(--color-muted)]">{t.admin.reauthWarning} {t.admin.lastOwnerNote}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setConfirm(null); router.refresh(); }} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium">{t.admin.cancel}</button>
              <button type="button" disabled={busy} onClick={async () => { const c = confirm; setConfirm(null); if (c.kind === "deactivate") await run({ action: "deactivate", targetUserId: c.row.userId }); else await run({ action: "change_role", targetUserId: c.row.userId, role: c.role, expectedUpdatedAt: c.row.platformRoleUpdatedAt }); }} className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-fg)]">{t.admin.confirm}</button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
