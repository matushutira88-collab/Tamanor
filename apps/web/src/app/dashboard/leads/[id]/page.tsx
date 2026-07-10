import Link from "next/link";
import { notFound } from "next/navigation";
import { Permission, can } from "@guardora/core";
import { LeadStatus } from "@guardora/db";
import { PageHeader, Card, SectionHeader, Badge, Textarea, PrimaryButton } from "@/components/dashboard/ui";
import { Notice } from "@/components/dashboard/notice";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { humanize, formatDateTime } from "@/lib/format";
import { updateLeadStatus, saveLeadNotes } from "../actions";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = { new: "brand", contacted: "warn", closed: "neutral" };

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await requireSession();

  if (!can(session.role, Permission.MemberManage)) {
    return (
      <>
        <PageHeader title="Lead" description="Internal lead detail." />
        <Card>Your role ({session.role}) can&rsquo;t access leads.</Card>
      </>
    );
  }

  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) notFound();

  return (
    <>
      <PageHeader
        title={lead.name}
        description={lead.email}
        action={<Badge tone={STATUS_TONE[lead.status] ?? "neutral"}>{humanize(lead.status)}</Badge>}
      />
      <Link href="/dashboard/leads" className="text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]">← All leads</Link>
      <div className="mt-4">
        <Notice notice={sp.notice} kind={sp.kind} />
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <SectionHeader title="Details" />
          <dl className="space-y-2.5 text-sm">
            <Row label="Email"><a className="text-[var(--color-brand)] hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a></Row>
            <Row label="Company">{lead.company ?? "—"}</Row>
            <Row label="Website">{lead.website ? <a className="text-[var(--color-brand)] hover:underline" href={lead.website} target="_blank" rel="noreferrer">{lead.website}</a> : "—"}</Row>
            <Row label="Source">{humanize(lead.source)}</Row>
            <Row label="Platforms">{lead.platforms.length ? lead.platforms.join(", ") : "—"}</Row>
            <Row label="Consent">{lead.consent ? <Badge tone="ok">Given</Badge> : <Badge tone="warn">No</Badge>}</Row>
            <Row label="Received">{formatDateTime(lead.createdAt)}</Row>
          </dl>
          {lead.message ? (
            <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
              <p className="mb-1 text-xs font-medium text-[var(--color-muted)]">Message</p>
              <p className="text-sm leading-relaxed">{lead.message}</p>
            </div>
          ) : null}
        </Card>

        <div className="space-y-6">
          <Card>
            <SectionHeader title="Status" description="Track your outreach." />
            <div className="flex flex-wrap gap-2">
              {Object.values(LeadStatus).map((s) => (
                <form key={s} action={updateLeadStatus.bind(null, lead.id, s)}>
                  <button
                    type="submit"
                    disabled={lead.status === s}
                    className="rounded-lg border border-[var(--color-border-strong)] bg-white px-3 py-1.5 text-xs transition hover:border-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {humanize(s)}
                  </button>
                </form>
              ))}
            </div>
            <p className="mt-3 text-xs text-[var(--color-muted)]">
              No emails are sent from Tamanor — reach out from your own inbox.
            </p>
          </Card>

          <Card>
            <SectionHeader title="Internal notes" description="Visible to your team only." />
            <form action={saveLeadNotes.bind(null, lead.id)} className="space-y-3">
              <Textarea name="notes" rows={5} defaultValue={lead.notes ?? ""} placeholder="Add context, next steps…" />
              <PrimaryButton type="submit">Save notes</PrimaryButton>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="max-w-[60%] truncate text-right">{children}</dd>
    </div>
  );
}
