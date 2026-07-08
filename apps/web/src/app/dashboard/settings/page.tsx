import Link from "next/link";
import { getMetaConfig } from "@guardora/config";
import { PageHeader, Card, Badge } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { navItem } from "@/lib/nav";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/settings");

export default async function SettingsPage() {
  await requireSession();
  const meta = getMetaConfig();

  const sections = [
    {
      title: "Brand profile",
      body: "Names, languages, timezones, default reply tone, and status for each brand you protect.",
      href: "/dashboard/brands",
      cta: "Manage brands",
      badge: null as null | { tone: string; text: string },
    },
    {
      title: "Moderation rules",
      body: "Deterministic brand policies — blocked words, competitors, crisis keywords — layered on the AI Risk Engine.",
      href: "/dashboard/rules",
      cta: "Manage rules",
      badge: null,
    },
    {
      title: "Automations",
      body: "Read-only sync and AI proposals run in the background. Auto-execution of moderation actions stays OFF.",
      href: "/dashboard/accounts",
      cta: "View accounts",
      badge: { tone: "ok", text: "Actions disabled" },
    },
    {
      title: "Webhooks",
      body: "Inbound platform events are signature-verified and stored. No automatic actions are taken.",
      href: "/dashboard/accounts",
      cta: "View webhook status",
      badge: meta.webhookVerifyToken ? { tone: "ok", text: "Verify token set" } : { tone: "warn", text: "Not configured" },
    },
    {
      title: "Security",
      body: "Official OAuth only. Tokens are stored server-side, never shown or logged. Production requires encrypted-at-rest storage (KMS).",
      href: "/dashboard/audit",
      cta: "Open audit log",
      badge: { tone: "brand", text: "OAuth only" },
    },
  ];

  return (
    <>
      <PageHeader title={nav.label} description={nav.description} />

      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((s) => (
          <Card key={s.title} className="flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold">{s.title}</h3>
              {s.badge ? <Badge tone={s.badge.tone}>{s.badge.text}</Badge> : null}
            </div>
            <p className="mt-1.5 flex-1 text-sm text-[var(--color-muted)]">{s.body}</p>
            <Link
              href={s.href}
              className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-white px-3.5 py-2 text-sm font-medium transition hover:bg-[var(--color-surface-2)]"
            >
              {s.cta} →
            </Link>
          </Card>
        ))}
      </div>
    </>
  );
}
