import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getSession } from "@/server/auth";
import { resolveWorkspaceDestination } from "@/server/workspace-routing";
import { getLocale } from "@/i18n/locale-server";
import { familyDict } from "@/app/family/family-i18n";

export const metadata: Metadata = { title: "Choose your Tamanor — Family or Business", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * CS-C6 — the mandatory FAMILY/BUSINESS choice that opens registration. The choice is NOT pre-filled and
 * NOT a pricing table; it decides the immutable WorkspaceKind (created server-side in registerAction).
 * A user who already has a workspace is routed by their active kind, never back into the chooser.
 */
export default async function WorkspaceTypePage() {
  const session = await getSession();
  // CS-C6.1 — an authenticated user is routed by the central resolver (fail-closed; never a Business default).
  if (session) redirect((await resolveWorkspaceDestination(session)).href);
  const t = familyDict(await getLocale());
  const c = t.chooser;

  const Card = ({ kind, title, text, bullets, cta, tone }: { kind: string; title: string; text: string; bullets: string[]; cta: string; tone: "brand" | "neutral" }) => (
    <div className={`flex flex-col rounded-2xl border p-6 ${tone === "brand" ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)]" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}>
      <h2 className="text-lg font-semibold text-[var(--color-fg)]">{title}</h2>
      <p className="mt-2 text-sm text-[var(--color-muted)]">{text}</p>
      <ul className="mt-4 space-y-1.5 text-sm text-[var(--color-fg)]">{bullets.map((b) => <li key={b} className="flex gap-2"><span className="text-[var(--color-brand)]">•</span> {b}</li>)}</ul>
      <Link href={`/register?kind=${kind}`} className={`mt-6 rounded-lg px-4 py-2.5 text-center text-sm font-semibold ${tone === "brand" ? "bg-[var(--color-brand)] text-white" : "border border-[var(--color-border-strong)] text-[var(--color-fg)]"}`}>{cta}</Link>
    </div>
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo />
        <h1 className="mt-4 text-2xl font-semibold text-[var(--color-fg)]">{c.title}</h1>
        <p className="mt-2 max-w-xl text-sm text-[var(--color-muted)]">{c.subtitle}</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Card kind="family" title={c.familyTitle} text={c.familyText} bullets={c.familyBullets} cta={c.familyCta} tone="brand" />
        <Card kind="business" title={c.businessTitle} text={c.businessText} bullets={c.businessBullets} cta={c.businessCta} tone="neutral" />
      </div>
      <p className="mt-8 text-center text-sm text-[var(--color-muted)]"><Link href="/login" className="font-medium text-[var(--color-brand-strong)]">← Prihlásiť sa</Link></p>
    </main>
  );
}
