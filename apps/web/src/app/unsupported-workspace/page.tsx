import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { classifyWorkspaceRouting } from "@guardora/core";
import { Logo } from "@/components/logo";
import { getSession } from "@/server/auth";
import { resolveWorkspaceDestination } from "@/server/workspace-routing";
import { signOut } from "@/server/session-actions";
import { getLocale } from "@/i18n/locale-server";
import { familyDict } from "@/app/family/family-i18n";

export const metadata: Metadata = { title: "Unsupported workspace — Tamanor", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * CS-C6.1 — the SAFE fail-closed destination for a workspace whose immutable kind is unknown, corrupt or
 * unsupported by the current app. It is NEVER a data-repair or default-to-Business path:
 *   • not signed in            → /login
 *   • signed in, no workspace  → /register/workspace-type (choose a kind)
 *   • a SUPPORTED kind          → bounced to its real destination via the central resolver (no loop, since a
 *                                 supported kind never resolves back here)
 *   • an UNSUPPORTED kind        → this page renders (the only branch that renders)
 * The page shows NO raw workspaceKind, tenantId or any internal id — only a safe explanation plus the two
 * safe exits: sign out, or contact support. SK/EN/DE via the existing family dictionary.
 */
export default async function UnsupportedWorkspacePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.tenantId) redirect("/register/workspace-type");
  // A supported kind must never land here — send it to its real destination (fail-closed; no loop).
  if (classifyWorkspaceRouting(session.workspaceKind) !== "unsupported") {
    redirect((await resolveWorkspaceDestination(session)).href);
  }

  const t = familyDict(await getLocale()).unsupported;

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-6 py-12 text-center">
      <Logo />
      <div className="mt-8 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-7 text-left">
        <h1 className="text-xl font-semibold text-[var(--color-fg)]">{t.title}</h1>
        <p className="mt-3 text-sm text-[var(--color-fg)]">{t.body}</p>
        <p className="mt-3 text-sm text-[var(--color-muted)]">{t.explain}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <form action={signOut} className="sm:flex-1">
            <button
              type="submit"
              className="w-full rounded-xl bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)]"
            >
              {t.logout}
            </button>
          </form>
          <a
            href="mailto:support@tamanor.com"
            className="rounded-xl border border-[var(--color-border-strong)] px-4 py-2.5 text-center text-sm font-semibold text-[var(--color-fg)] sm:flex-1"
          >
            {t.help}
          </a>
        </div>
      </div>
    </main>
  );
}
