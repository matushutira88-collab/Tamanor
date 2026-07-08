import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DecisionStatus,
  ModerationAction,
  PLATFORM_META,
  Permission,
  Platform,
  RiskLevel,
  can,
  canApproveDecision,
  approvalDenialReason,
  isPlatformAction,
} from "@guardora/core";
import { PageHeader, Badge } from "@/components/dashboard/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/db";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { withEmoji } from "@/lib/enum-emoji";
import { humanize, formatDateTime } from "@/lib/format";
import { RISK_TONE, DECISION_TONE } from "@/lib/ui-maps";
import { approve, reject, execute, cancel } from "../actions";

export const dynamic = "force-dynamic";

const NOTICE_TONE: Record<string, string> = {
  ok: "ok",
  unsupported: "warn",
  error: "danger",
};

/** Whether the platform API supports this action (null = not a platform action). */
function actionSupported(
  meta: (typeof PLATFORM_META)[Platform],
  action: ModerationAction,
): boolean | null {
  if (action === ModerationAction.Reply) return meta.supportsReply;
  if (action === ModerationAction.Hide) return meta.supportsHide;
  if (action === ModerationAction.Delete) return meta.supportsDelete;
  return null;
}

export default async function ProposalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await requirePermission(Permission.ProposalView);
  const t = await getT();

  const d = await prisma.moderationDecision.findFirst({
    where: { id, tenantId: session.tenantId },
    include: {
      reputationItem: { include: { contentItem: true } },
      brand: { select: { name: true } },
      proposer: { select: { name: true, email: true } },
      reviewer: { select: { name: true, email: true } },
    },
  });
  if (!d) notFound();

  const meta = PLATFORM_META[d.reputationItem.platform as Platform];
  const action = d.action as ModerationAction;
  const snapshot = d.riskSnapshot as {
    level?: RiskLevel;
    confidence?: number;
    categories?: string[];
    sentiment?: string;
  } | null;
  const snapshotLevel = snapshot?.level ?? (d.reputationItem.riskLevel as RiskLevel);
  const supported = actionSupported(meta, action);

  const status = d.status as DecisionStatus;
  const isProposed = status === DecisionStatus.Proposed;
  const isApproved = status === DecisionStatus.Approved;

  // Permission + policy gates (all via core helpers — no hardcoded role checks).
  const mayApprove =
    isProposed && canApproveDecision(session.role, action, snapshotLevel);
  const approveDenied = isProposed
    ? approvalDenialReason(session.role, action, snapshotLevel)
    : null;
  const mayReject = isProposed && can(session.role, Permission.ProposalApprove);
  const mayExecute = isApproved && can(session.role, Permission.ProposalExecute);
  const mayCancel =
    (isProposed || isApproved) && can(session.role, Permission.ProposalPropose);

  const notice = sp.notice;
  const noticeKind = sp.kind ?? "ok";

  return (
    <>
      <PageHeader
        title={`${t.dash.proposal} · ${tEnum(t, "action", d.action)}`}
        description={`${d.brand.name} · ${meta.label}`}
        action={<Badge tone={DECISION_TONE[status]}>{withEmoji("decision", status, tEnum(t, "decision", status))}</Badge>}
      />

      <Link
        href="/dashboard/approvals"
        className="text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
      >
        {t.dash.backToApprovalQueue}
      </Link>

      {notice ? (
        <div className="mt-4" role="status">
          <Badge tone={NOTICE_TONE[noticeKind] ?? "neutral"}>
            {noticeKind === "unsupported" ? t.dash.unsupported : humanize(noticeKind)}
          </Badge>{" "}
          <span className="text-sm text-[var(--color-muted)]">{notice}</span>
        </div>
      ) : null}

      {/* Comparison: original vs proposed */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="gu-card p-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
            {t.dash.originalContent}
          </h3>
          <div className="mb-2 flex items-center gap-2 text-xs text-[var(--color-muted)]">
            <span>{d.reputationItem.contentItem.authorDisplayName ?? t.dash.unknown}</span>
            {typeof d.reputationItem.contentItem.rating === "number" ? (
              <Badge tone="neutral">{d.reputationItem.contentItem.rating}★</Badge>
            ) : null}
            <span>· {formatDateTime(d.reputationItem.contentItem.publishedAt)}</span>
          </div>
          <p className="text-[15px] leading-relaxed">
            {d.reputationItem.contentItem.text}
          </p>
          <Link
            href={`/dashboard/inbox/${d.reputationItemId}`}
            className="mt-3 inline-block text-xs text-[var(--color-brand)] hover:underline"
          >
            {t.dash.viewItemInInbox}
          </Link>
        </div>

        <div className="gu-card p-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
            {t.dash.proposedAction}
          </h3>
          <div className="flex items-center gap-2">
            <Badge>{tEnum(t, "action", d.action)}</Badge>
            {isPlatformAction(action) ? (
              supported ? (
                <Badge tone="ok">{t.dash.apiSupported}</Badge>
              ) : (
                <Badge tone="danger">{t.dash.apiUnsupported}</Badge>
              )
            ) : (
              <Badge tone="neutral">{t.dash.guardoraSide}</Badge>
            )}
          </div>

          {d.replyText ? (
            <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-3 text-sm">
              “{d.replyText}”
            </div>
          ) : null}

          {isPlatformAction(action) && supported === false ? (
            <p className="mt-3 text-xs text-[var(--color-warn)]">
              ⚠ {meta.label} {t.dash.apiNoSupportMid} {tEnum(t, "action", d.action)}. {t.dash.apiNoSupportEnd}
            </p>
          ) : null}

          {d.reason ? (
            <p className="mt-3 text-xs text-[var(--color-muted)]">{d.reason}</p>
          ) : null}

          <dl className="mt-3 space-y-1 text-xs text-[var(--color-muted)]">
            <div className="flex justify-between">
              <dt>{t.dash.proposedBy}</dt>
              <dd>
                {humanize(d.proposedByKind)}
                {d.proposer ? ` · ${d.proposer.name ?? d.proposer.email}` : ""}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>{t.dash.created}</dt>
              <dd>{formatDateTime(d.createdAt)}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Risk snapshot + timeline */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="gu-card p-5">
          <h3 className="mb-3 text-sm font-semibold">{t.dash.aiRiskSnapshot}</h3>
          <p className="mb-3 text-xs text-[var(--color-muted)]">
            {t.dash.capturedWhenCreated}
          </p>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-[var(--color-muted)]">{t.dash.riskLevel}</dt>
              <dd>
                <Badge tone={RISK_TONE[snapshotLevel]}>{withEmoji("risk", snapshotLevel, tEnum(t, "risk", snapshotLevel))}</Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[var(--color-muted)]">{t.dash.aiConfidence}</dt>
              <dd>{((snapshot?.confidence ?? d.confidence ?? 0) * 100).toFixed(0)}%</dd>
            </div>
            {snapshot?.sentiment ? (
              <div className="flex items-center justify-between">
                <dt className="text-[var(--color-muted)]">{t.dash.sentiment}</dt>
                <dd>{withEmoji("sentiment", snapshot.sentiment, tEnum(t, "sentiment", snapshot.sentiment))}</dd>
              </div>
            ) : null}
          </dl>
          {snapshot?.categories?.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {snapshot.categories.map((c) => (
                <Badge key={c}>{withEmoji("category", c, tEnum(t, "category", c))}</Badge>
              ))}
            </div>
          ) : null}
        </div>

        <div className="gu-card p-5">
          <h3 className="mb-3 text-sm font-semibold">{t.dash.lifecycle}</h3>
          <ol className="space-y-2 text-sm">
            <Step done label={tEnum(t, "decision", DecisionStatus.Proposed)} when={formatDateTime(d.createdAt)} />
            <Step
              done={[DecisionStatus.Approved, DecisionStatus.Executed].includes(status)}
              rejected={status === DecisionStatus.Rejected || status === DecisionStatus.Cancelled}
              label={
                status === DecisionStatus.Rejected
                  ? tEnum(t, "decision", DecisionStatus.Rejected)
                  : status === DecisionStatus.Cancelled
                    ? humanize(DecisionStatus.Cancelled)
                    : tEnum(t, "decision", DecisionStatus.Approved)
              }
              when={d.reviewedAt ? formatDateTime(d.reviewedAt) : undefined}
              who={d.reviewer ? d.reviewer.name ?? d.reviewer.email : undefined}
            />
            <Step
              done={status === DecisionStatus.Executed}
              rejected={status === DecisionStatus.Failed}
              label={status === DecisionStatus.Failed ? tEnum(t, "decision", DecisionStatus.Failed) : tEnum(t, "decision", DecisionStatus.Executed)}
              when={d.executedAt ? formatDateTime(d.executedAt) : undefined}
            />
          </ol>
          {d.failureReason ? (
            <p className="mt-3 text-xs text-[var(--color-danger)]">
              {d.failureReason}
            </p>
          ) : null}
        </div>
      </div>

      {/* Decision controls */}
      <div className="mt-6 gu-card p-5">
        <h3 className="mb-3 text-sm font-semibold">{t.dash.reviewExecution}</h3>
        {status === DecisionStatus.Executed ||
        status === DecisionStatus.Rejected ||
        status === DecisionStatus.Cancelled ||
        status === DecisionStatus.Failed ? (
          <p className="text-sm text-[var(--color-muted)]">
            {t.dash.proposalFinalPre} {tEnum(t, "decision", status).toLowerCase()} {t.dash.proposalFinalPost}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {isProposed ? (
              <>
                {mayApprove ? (
                  <form action={approve.bind(null, d.id)}>
                    <button type="submit" className="rounded-lg bg-[var(--color-ok)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90">
                      {t.dash.approveBtn}
                    </button>
                  </form>
                ) : (
                  <span className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted)]">
                    {approveDenied ?? t.dash.cannotApprove}
                  </span>
                )}
                {mayReject ? (
                  <form action={reject.bind(null, d.id)}>
                    <button type="submit" className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm transition hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]">
                      {t.dash.rejectBtn}
                    </button>
                  </form>
                ) : null}
              </>
            ) : null}

            {isApproved ? (
              mayExecute ? (
                <form action={execute.bind(null, d.id)}>
                  <button type="submit" className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-brand-strong)] hover:text-white">
                    {t.dash.executeBtn} {isPlatformAction(action) ? t.dash.mockSuffix : ""}
                  </button>
                </form>
              ) : (
                <span className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted)]">
                  {t.dash.onlyAdminExecute}
                </span>
              )
            ) : null}

            {mayCancel ? (
              <form action={cancel.bind(null, d.id)}>
                <button type="submit" className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] transition hover:text-[var(--color-fg)]">
                  {t.dash.cancelBtn}
                </button>
              </form>
            ) : null}
          </div>
        )}
        <p className="mt-3 text-[11px] text-[var(--color-muted)]">
          {t.dash.capabilityRecheck}
        </p>
      </div>
    </>
  );
}

function Step({
  label,
  when,
  who,
  done,
  rejected,
}: {
  label: string;
  when?: string;
  who?: string;
  done?: boolean;
  rejected?: boolean;
}) {
  const dot = rejected
    ? "bg-[var(--color-danger)]"
    : done
      ? "bg-[var(--color-ok)]"
      : "bg-[var(--color-border)]";
  return (
    <li className="flex items-center gap-3">
      <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      <span className="flex-1">
        <span className={done || rejected ? "" : "text-[var(--color-muted)]"}>
          {label}
        </span>
        {who ? <span className="text-xs text-[var(--color-muted)]"> · {who}</span> : null}
      </span>
      {when ? <span className="text-xs text-[var(--color-muted)]">{when}</span> : null}
    </li>
  );
}
