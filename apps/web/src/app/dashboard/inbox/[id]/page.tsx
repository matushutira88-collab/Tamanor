import Link from "next/link";
import { notFound } from "next/navigation";
import {
  PLATFORM_META,
  Permission,
  Platform,
  ReputationStatus,
  RiskLevel,
  Priority,
  can,
} from "@guardora/core";
import { PageHeader, Badge, Textarea, PrimaryButton } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { humanize, formatDateTime } from "@/lib/format";
import { RISK_TONE, STATUS_TONE, PRIORITY_TONE } from "@/lib/ui-maps";
import {
  resolveItem,
  escalateItem,
  ignoreItem,
  proposeHide,
  proposeDelete,
  proposeReply,
} from "../actions";

const OPEN_PROPOSAL_STATUSES = ["proposed", "approved"];

export const dynamic = "force-dynamic";

const NOTICE_TONE: Record<string, string> = {
  ok: "ok",
  unsupported: "warn",
  error: "danger",
};

export default async function InboxItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await requireSession();
  const act = can(session.role, Permission.InboxAct);
  const propose = can(session.role, Permission.ProposalPropose);

  const item = await prisma.reputationItem.findFirst({
    where: { id, tenantId: session.tenantId },
    include: {
      contentItem: true,
      brand: { select: { name: true, defaultTone: true } },
      decisions: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!item) notFound();

  const meta = PLATFORM_META[item.platform as Platform];
  const notice = sp.notice;
  const noticeKind = sp.kind ?? "ok";
  const openProposals = item.decisions.filter((d) =>
    OPEN_PROPOSAL_STATUSES.includes(d.status),
  );

  return (
    <>
      <PageHeader
        title="Reputation item"
        description={`${item.brand.name} · ${meta.label} · ${humanize(item.contentItem.kind)}`}
        action={
          <Badge tone={STATUS_TONE[item.status as ReputationStatus]}>
            {humanize(item.status)}
          </Badge>
        }
      />

      <Link
        href="/dashboard/inbox"
        className="text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
      >
        ← Back to inbox
      </Link>

      {notice ? (
        <div className="mt-4" role="status">
          <Badge tone={NOTICE_TONE[noticeKind] ?? "neutral"}>
            {noticeKind === "unsupported" ? "Unsupported" : humanize(noticeKind)}
          </Badge>{" "}
          <span className="text-sm text-[var(--color-muted)]">{notice}</span>
        </div>
      ) : null}

      {openProposals.length > 0 ? (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-[var(--color-warn)] bg-[var(--color-surface)] px-4 py-3">
          <span className="text-sm">
            <Badge tone="warn">Pending approval</Badge>{" "}
            <span className="text-[var(--color-muted)]">
              {openProposals.length} open proposal(s) awaiting review.
            </span>
          </span>
          <Link
            href="/dashboard/approvals"
            className="text-xs font-medium text-[var(--color-brand)] hover:underline"
          >
            Go to approval queue →
          </Link>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Content + actions */}
        <div className="space-y-6">
          <div className="gu-card p-5">
            <div className="mb-2 flex items-center gap-2 text-xs text-[var(--color-muted)]">
              <span>{item.contentItem.authorDisplayName ?? "Unknown author"}</span>
              {typeof item.contentItem.rating === "number" ? (
                <Badge tone="neutral">{item.contentItem.rating}★</Badge>
              ) : null}
              <span>· {formatDateTime(item.contentItem.publishedAt)}</span>
            </div>
            <p className="text-[15px] leading-relaxed">{item.contentItem.text}</p>
          </div>

          {/* Immediate actions (Guardora-side, no platform call) */}
          {act ? (
            <div className="gu-card p-5">
              <h3 className="mb-1 text-sm font-semibold">Triage</h3>
              <p className="mb-3 text-xs text-[var(--color-muted)]">
                Immediate, audited status changes — no platform action.
              </p>
              <div className="flex flex-wrap gap-2">
                <form action={resolveItem.bind(null, item.id)}>
                  <ActionBtn tone="ok">Mark resolved</ActionBtn>
                </form>
                <form action={escalateItem.bind(null, item.id)}>
                  <ActionBtn tone="danger">Escalate</ActionBtn>
                </form>
                <form action={ignoreItem.bind(null, item.id)}>
                  <ActionBtn tone="neutral">Ignore</ActionBtn>
                </form>
              </div>
            </div>
          ) : null}

          {/* Propose platform actions (require approval before execution) */}
          {propose ? (
            <div className="gu-card p-5">
              <div className="mb-1 flex items-center gap-2">
                <h3 className="text-sm font-semibold">Propose platform action</h3>
                <Badge tone="ok">No platform action executed</Badge>
              </div>
              <p className="mb-3 text-xs text-[var(--color-muted)]">
                Creates a proposal for review. Nothing runs until an authorized
                reviewer approves and executes it — Guardora is read-only by default.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <form action={proposeHide.bind(null, item.id)}>
                  <ActionBtn tone="warn">Propose hide</ActionBtn>
                </form>
                {!meta.supportsHide ? (
                  <span
                    title={`${meta.label} API does not support hiding`}
                    className="text-xs text-[var(--color-warn)]"
                  >
                    ⚠ Hide is unsupported on {meta.label} — will fail at execution.
                  </span>
                ) : null}
                <form action={proposeDelete.bind(null, item.id)}>
                  <ActionBtn tone="danger">Propose delete</ActionBtn>
                </form>
              </div>

              <form action={proposeReply.bind(null, item.id)} className="mt-4 space-y-2">
                <label className="block text-xs font-medium text-[var(--color-muted)]">
                  Propose reply{" "}
                  <span className="normal-case">
                    (tone: {humanize(item.brand.defaultTone)})
                  </span>
                </label>
                <Textarea
                  name="replyText"
                  rows={3}
                  placeholder="Write a reply draft… (queued for approval; not sent)"
                />
                <PrimaryButton type="submit">Propose reply</PrimaryButton>
              </form>
            </div>
          ) : null}

          {!act && !propose ? (
            <div className="gu-card p-5 text-xs text-[var(--color-muted)]">
              Your role ({session.role}) has read-only access to this item.
            </div>
          ) : null}

          {/* Decision history */}
          <div className="gu-card p-5">
            <h3 className="mb-3 text-sm font-semibold">Decision history</h3>
            {item.decisions.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">No decisions yet.</p>
            ) : (
              <ul className="space-y-2">
                {item.decisions.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] pb-2 text-sm last:border-0">
                    <div>
                      <span className="font-medium">{humanize(d.action)}</span>
                      <span className="text-[var(--color-muted)]"> · {humanize(d.status)}</span>
                      {d.replyText ? (
                        <p className="mt-1 text-xs text-[var(--color-muted)]">“{d.replyText}”</p>
                      ) : null}
                      {d.reason ? (
                        <p className="mt-0.5 text-xs text-[var(--color-muted)]">{d.reason}</p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-xs text-[var(--color-muted)]">
                      {formatDateTime(d.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Risk sidebar */}
        <aside className="space-y-4">
          <div className="gu-card p-5">
            <h3 className="mb-3 text-sm font-semibold">AI Risk assessment</h3>
            <dl className="space-y-2 text-sm">
              <Row label="Risk level">
                <Badge tone={RISK_TONE[item.riskLevel as RiskLevel]}>
                  {humanize(item.riskLevel)}
                </Badge>
              </Row>
              <Row label="Confidence">
                {(item.riskConfidence * 100).toFixed(0)}%
              </Row>
              <Row label="Priority">
                <Badge tone={PRIORITY_TONE[item.priority as Priority]}>
                  {humanize(item.priority)}
                </Badge>
              </Row>
              <Row label="Sentiment">{humanize(item.sentiment)}</Row>
              <Row label="Approval">
                {item.requiresApproval ? (
                  <Badge tone="warn">Required</Badge>
                ) : (
                  <span className="text-[var(--color-muted)]">Not required</span>
                )}
              </Row>
            </dl>
            {item.riskCategories.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {item.riskCategories.map((c) => (
                  <Badge key={c}>{humanize(c)}</Badge>
                ))}
              </div>
            ) : null}
            {item.riskRationale ? (
              <p className="mt-3 text-xs text-[var(--color-muted)]">
                {item.riskRationale}
              </p>
            ) : null}
            {item.riskEngine ? (
              <p className="mt-2 text-[11px] text-[var(--color-muted)]">
                Engine: {item.riskEngine}
              </p>
            ) : null}
          </div>

          <div className="gu-card p-5">
            <h3 className="mb-2 text-sm font-semibold">Platform capabilities</h3>
            <div className="flex flex-wrap gap-1.5">
              {meta.supportsReply ? <Badge tone="ok">Reply</Badge> : <Badge tone="warn">No reply</Badge>}
              {meta.supportsHide ? <Badge tone="ok">Hide</Badge> : <Badge tone="warn">No hide</Badge>}
              {meta.supportsDelete ? <Badge tone="ok">Delete</Badge> : <Badge tone="warn">No delete</Badge>}
            </div>
            <p className="mt-2 text-[11px] text-[var(--color-muted)]">
              Actions are checked against the connector. Unsupported actions are
              never faked.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ActionBtn({
  tone,
  children,
}: {
  tone: string;
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    ok: "hover:border-[var(--color-ok)] hover:text-[var(--color-ok)]",
    danger: "hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]",
    warn: "hover:border-[var(--color-warn)] hover:text-[var(--color-warn)]",
    neutral: "hover:border-[var(--color-brand)]",
  };
  return (
    <button
      type="submit"
      className={`rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs transition ${tones[tone] ?? tones.neutral}`}
    >
      {children}
    </button>
  );
}
