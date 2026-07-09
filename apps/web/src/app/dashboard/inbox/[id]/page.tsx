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
import { getLocale } from "@/i18n/locale-server";
import { getDictionary } from "@/i18n";
import { tEnum } from "@/i18n/labels";
import { withEmoji } from "@/lib/enum-emoji";
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
import { submitFeedback, addMemoryRule } from "./actions";

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
  const t = getDictionary(await getLocale());
  const act = can(session.role, Permission.InboxAct);
  const propose = can(session.role, Permission.ProposalPropose);
  const manageRules = can(session.role, Permission.RuleManage);

  const item = await prisma.reputationItem.findFirst({
    where: { id, tenantId: session.tenantId },
    include: {
      contentItem: true,
      brand: { select: { name: true, defaultTone: true } },
      decisions: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!item) notFound();

  const autoDecision = await prisma.autoProtectDecision.findUnique({ where: { itemId: item.id } });
  const lastAction = await prisma.platformActionExecution.findFirst({ where: { itemId: item.id }, orderBy: { createdAt: "desc" }, select: { status: true, reason: true } });

  const meta = PLATFORM_META[item.platform as Platform];
  const notice = sp.notice;
  const noticeKind = sp.kind ?? "ok";
  const openProposals = item.decisions.filter((d) =>
    OPEN_PROPOSAL_STATUSES.includes(d.status),
  );

  return (
    <>
      <PageHeader
        title={t.dash.reputationItem}
        description={`${item.brand.name} · ${meta.label} · ${withEmoji("kind", item.contentItem.kind, tEnum(t, "kind", item.contentItem.kind))}`}
        action={
          <Badge tone={STATUS_TONE[item.status as ReputationStatus]}>
            {tEnum(t, "status", item.status)}
          </Badge>
        }
      />

      <Link
        href="/dashboard/inbox"
        className="text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
      >
        {t.dash.backToInbox}
      </Link>

      {notice ? (
        <div className="mt-4" role="status">
          <Badge tone={NOTICE_TONE[noticeKind] ?? "neutral"}>
            {noticeKind === "unsupported" ? t.dash.unsupported : humanize(noticeKind)}
          </Badge>{" "}
          <span className="text-sm text-[var(--color-muted)]">{notice}</span>
        </div>
      ) : null}

      {openProposals.length > 0 ? (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-[var(--color-warn)] bg-[var(--color-surface)] px-4 py-3">
          <span className="text-sm">
            <Badge tone="warn">{t.dash.pendingApproval}</Badge>{" "}
            <span className="text-[var(--color-muted)]">
              {openProposals.length} {t.dash.openProposalsAwaiting}
            </span>
          </span>
          <Link
            href="/dashboard/approvals"
            className="text-xs font-medium text-[var(--color-brand)] hover:underline"
          >
            {t.dash.goToApprovalQueue}
          </Link>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Content + actions */}
        <div className="space-y-6">
          <div className="gu-card p-5">
            <div className="mb-2 flex items-center gap-2 text-xs text-[var(--color-muted)]">
              <span>{item.contentItem.authorDisplayName ?? t.dash.unknownAuthor}</span>
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
              <h3 className="mb-1 text-sm font-semibold">{t.dash.triage}</h3>
              <p className="mb-3 text-xs text-[var(--color-muted)]">
                {t.dash.triageDesc}
              </p>
              <div className="flex flex-wrap gap-2">
                <form action={resolveItem.bind(null, item.id)}>
                  <ActionBtn tone="ok">{t.dash.markResolved}</ActionBtn>
                </form>
                <form action={escalateItem.bind(null, item.id)}>
                  <ActionBtn tone="danger">{t.dash.escalate}</ActionBtn>
                </form>
                <form action={ignoreItem.bind(null, item.id)}>
                  <ActionBtn tone="neutral">{t.dash.ignore}</ActionBtn>
                </form>
              </div>
            </div>
          ) : null}

          {/* Propose platform actions (require approval before execution) */}
          {propose ? (
            <div className="gu-card p-5">
              <div className="mb-1 flex items-center gap-2">
                <h3 className="text-sm font-semibold">{t.dash.proposePlatformAction}</h3>
                <Badge tone="ok">{t.common.noPlatformAction}</Badge>
              </div>
              <p className="mb-3 text-xs text-[var(--color-muted)]">
                {t.dash.proposeActionDesc}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <form action={proposeHide.bind(null, item.id)}>
                  <ActionBtn tone="warn">{t.dash.proposeHide}</ActionBtn>
                </form>
                {!meta.supportsHide ? (
                  <span
                    title={`${meta.label} API does not support hiding`}
                    className="text-xs text-[var(--color-warn)]"
                  >
                    {t.dash.hideUnsupportedPre} {meta.label} {t.dash.hideUnsupportedPost}
                  </span>
                ) : null}
                <form action={proposeDelete.bind(null, item.id)}>
                  <ActionBtn tone="danger">{t.dash.proposeDelete}</ActionBtn>
                </form>
              </div>

              <form action={proposeReply.bind(null, item.id)} className="mt-4 space-y-2">
                <label className="block text-xs font-medium text-[var(--color-muted)]">
                  {t.dash.proposeReply}{" "}
                  <span className="normal-case">
                    ({t.dash.replyToneLabel}: {tEnum(t, "tone", item.brand.defaultTone)})
                  </span>
                </label>
                <Textarea
                  name="replyText"
                  rows={3}
                  placeholder={t.dash.replyPlaceholder}
                />
                <PrimaryButton type="submit">{t.dash.proposeReply}</PrimaryButton>
              </form>
            </div>
          ) : null}

          {!act && !propose ? (
            <div className="gu-card p-5 text-xs text-[var(--color-muted)]">
              {t.dash.readOnlyAccessPre} ({session.role}) {t.dash.readOnlyAccessPost}
            </div>
          ) : null}

          {/* Decision history */}
          <div className="gu-card p-5">
            <h3 className="mb-3 text-sm font-semibold">{t.dash.decisionHistory}</h3>
            {item.decisions.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{t.dash.noDecisions}</p>
            ) : (
              <ul className="space-y-2">
                {item.decisions.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] pb-2 text-sm last:border-0">
                    <div>
                      <span className="font-medium">{tEnum(t, "action", d.action)}</span>
                      <span className="text-[var(--color-muted)]"> · {withEmoji("decision", d.status, tEnum(t, "decision", d.status))}</span>
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
            <h3 className="mb-3 text-sm font-semibold">{t.dash.aiRiskAssessment}</h3>
            <dl className="space-y-2 text-sm">
              <Row label={t.dash.riskLevel}>
                <Badge tone={RISK_TONE[item.riskLevel as RiskLevel]}>
                  {withEmoji("risk", item.riskLevel, tEnum(t, "risk", item.riskLevel))}
                </Badge>
              </Row>
              <Row label={t.dash.confidence}>
                {(item.riskConfidence * 100).toFixed(0)}%
              </Row>
              <Row label={t.dash.priority}>
                <Badge tone={PRIORITY_TONE[item.priority as Priority]}>
                  {tEnum(t, "priority", item.priority)}
                </Badge>
              </Row>
              <Row label={t.dash.sentiment}>{withEmoji("sentiment", item.sentiment, tEnum(t, "sentiment", item.sentiment))}</Row>
              <Row label={t.dash.approval}>
                {item.requiresApproval ? (
                  <Badge tone="warn">{t.dash.required}</Badge>
                ) : (
                  <span className="text-[var(--color-muted)]">{t.dash.notRequired}</span>
                )}
              </Row>
            </dl>
            {item.riskCategories.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {item.riskCategories.map((c) => (
                  <Badge key={c}>{withEmoji("category", c, tEnum(t, "category", c))}</Badge>
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
                {t.dash.engine}: {item.riskEngine}
              </p>
            ) : null}
          </div>

          {/* Language & translation */}
          <div className="gu-card p-5">
            <h3 className="mb-3 text-sm font-semibold">🌍 {t.intel.languageTranslation}</h3>
            <dl className="space-y-2 text-sm">
              <Row label={t.intel.detectedLanguage}>
                <span className="flex items-center gap-1.5">
                  {tEnum(t, "detectedLang", item.detectedLanguage ?? "unknown")}
                  {item.isMixedLanguage ? <Badge tone="warn">{t.intel.mixedLanguage}</Badge> : null}
                </span>
              </Row>
              {typeof item.languageConfidence === "number" ? (
                <Row label={t.intel.confidence}>{(item.languageConfidence * 100).toFixed(0)}%</Row>
              ) : null}
            </dl>
            <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">{t.intel.original}</p>
              <p className="text-sm leading-relaxed">{item.contentItem.text}</p>
            </div>
            <div className="mt-2 rounded-lg border border-dashed border-[var(--color-border-strong)] p-3">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">{t.intel.translation}</p>
              {item.translationStatus === "translated" && item.translatedText ? (
                <p className="text-sm leading-relaxed">{item.translatedText}</p>
              ) : item.translationStatus === "not_needed" ? (
                <p className="text-xs text-[var(--color-muted)]">✅ {t.dash.notRequired}</p>
              ) : (
                <p className="text-xs text-[var(--color-muted)]">{t.intel.translationUnavailable}</p>
              )}
            </div>
            <p className="mt-2 text-[11px] text-[var(--color-muted)]">
              {t.intel.translationProviderLabel}: {item.translationProvider}
            </p>
          </div>

          {/* Why this was flagged */}
          {(() => {
            const expl = (item.riskExplanation ?? null) as {
              matchedTerms?: string[]; matchedRules?: string[]; riskSignals?: string[]; recommendedReviewAction?: string;
            } | null;
            const signals = expl?.riskSignals ?? [];
            const terms = expl?.matchedTerms ?? [];
            const action = expl?.recommendedReviewAction ?? "none";
            return (
              <div className="gu-card p-5">
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-sm font-semibold">⚠️ {t.intel.whyFlagged}</h3>
                  {item.classificationMode === "ai_assisted" ? (
                    <Badge tone="brand">{t.intel.aiAssisted}</Badge>
                  ) : (
                    <Badge tone="neutral">{t.intel.rulesOnly}</Badge>
                  )}
                </div>
                <p className="text-sm">
                  {signals.length > 0
                    ? `${t.intel.reasonPrefix} ${signals.map((s) => tEnum(t, "riskReason", s)).join(", ")}.`
                    : t.intel.noSignals}
                </p>
                {terms.length > 0 ? (
                  <div className="mt-3">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">{t.intel.matchedTerms}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {terms.map((tm) => (
                        <span key={tm} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 text-xs">{tm}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {signals.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {signals.map((s) => (
                      <Badge key={s} tone="danger">{withEmoji("category", s, tEnum(t, "category", s))}</Badge>
                    ))}
                  </div>
                ) : null}
                <p className="mt-3 text-xs">
                  <span className="font-medium">{t.intel.recommendation}:</span>{" "}
                  <span className="text-[var(--color-muted)]">{tEnum(t, "reviewAction", action)}</span>
                </p>
                {item.requiresApproval ? (
                  <p className="mt-2 text-xs text-[var(--color-warn)]">🛡️ {t.intel.approvalReason}</p>
                ) : null}
                <p className="mt-3 border-t border-[var(--color-border)] pt-2 text-[11px] text-[var(--color-muted)]">
                  {item.aiProviderStatus === "classified"
                    ? `${t.intel.classifiedWithAi} (${item.aiProvider})`
                    : `${t.intel.classifiedByRules} · ${t.intel.noExternalAi}`}
                </p>
              </div>
            );
          })()}

          {/* Auto-Protect decision (shadow only) */}
          {autoDecision ? (
            <div className="gu-card p-5">
              <h3 className="mb-3 text-sm font-semibold">🛡️ {t.autoProtect.decisionTitle}</h3>
              <dl className="space-y-2 text-sm">
                <Row label={t.autoProtect.matchedCategory}>{tEnum(t, "autoProtectCategory", autoDecision.matchedCategory)}</Row>
                <Row label={t.autoProtect.policyMode}>{autoDecision.policyMode === "none" ? "—" : tEnum(t, "autoProtectMode", autoDecision.policyMode)}</Row>
                <Row label={t.autoProtect.decision}>
                  {autoDecision.decision === "would_auto_hide" ? (
                    <Badge tone="warn">{t.autoProtect.wouldHideBadge}</Badge>
                  ) : (
                    <Badge tone={autoDecision.decision === "requires_approval" ? "brand" : "neutral"}>{tEnum(t, "autoProtectDecision", autoDecision.decision)}</Badge>
                  )}
                </Row>
                <Row label={t.autoProtect.reason}><span className="text-xs text-[var(--color-muted)]">{
                  autoDecision.decision === "would_auto_hide" ? t.autoProtect.rWouldHide
                  : autoDecision.decision === "requires_approval" ? t.autoProtect.rApproval
                  : autoDecision.decision === "blocked_by_safety" ? t.autoProtect.rBlocked
                  : autoDecision.decision === "no_action" ? t.autoProtect.rNoAction
                  : t.autoProtect.rMonitor
                }</span></Row>
                <Row label={t.autoProtect.liveExecuted}><span className="font-medium text-[var(--color-ok)]">{t.autoProtect.always}</span></Row>
              </dl>
              {autoDecision.decision === "would_auto_hide" ? (
                <div className="mt-3 rounded-lg border border-dashed border-[var(--color-warn)] p-3 text-xs">
                  <p className="font-medium">{t.autoProtect.wouldHideNote}</p>
                  <p className="mt-1 text-[var(--color-muted)]">{t.autoProtect.shadowExplain}</p>
                </div>
              ) : null}
              <div className="mt-3 border-t border-[var(--color-border)] pt-2 text-[11px]">
                {(() => {
                  const st = lastAction?.status;
                  const label = st === "executed" ? t.autoProtect.liveStateExecuted
                    : st === "dry_run" ? t.autoProtect.liveStateDryRun
                    : st === "blocked" || st === "failed" ? t.autoProtect.liveStateBlocked
                    : t.autoProtect.liveStateShadow;
                  const tone = st === "executed" ? "danger" : st === "dry_run" ? "warn" : "neutral";
                  return (
                    <>
                      <span className="mr-1"><Badge tone={tone}>{label}</Badge></span>
                      {lastAction && st !== "executed" ? (
                        <span className="text-[var(--color-muted)]">{t.autoProtect.liveWhyNot}: {(t.autoProtect.blockReason as Record<string, string>)[lastAction.reason ?? ""] ?? lastAction.reason}</span>
                      ) : null}
                    </>
                  );
                })()}
                <p className="mt-1.5 text-[var(--color-muted)]">✅ {t.autoProtect.noLiveAction} · {t.autoProtect.shadowOnly}</p>
              </div>
            </div>
          ) : null}

          {/* Improve Guardora for this brand (feedback + brand memory) */}
          {act ? (
            <div className="gu-card p-5">
              <h3 className="mb-1 text-sm font-semibold">🛡️ {t.memory.improveTitle}</h3>
              <p className="mb-3 text-[11px] text-[var(--color-muted)]">{t.memory.improveHint}</p>
              <form action={submitFeedback} className="space-y-2">
                <input type="hidden" name="itemId" value={item.id} />
                <div className="flex flex-wrap gap-1.5">
                  {(["correct_risk", "false_positive", "false_negative", "mark_safe", "mark_risky", "wrong_language", "wrong_sentiment"] as const).map((ft) => (
                    <button key={ft} name="feedbackType" value={ft} type="submit"
                      className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-xs hover:border-[var(--color-border-strong)]">
                      {t.memory[ft]}
                    </button>
                  ))}
                </div>
                <Textarea name="note" rows={2} placeholder={t.memory.notePlaceholder} />
              </form>

              {manageRules ? (
                <form action={addMemoryRule} className="mt-4 space-y-2 border-t border-[var(--color-border)] pt-3">
                  <input type="hidden" name="itemId" value={item.id} />
                  <p className="text-[11px] text-[var(--color-muted)]">{t.memory.suggestionBody}</p>
                  <input name="phrase" required placeholder={t.memory.phrasePlaceholder}
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm" />
                  <div className="flex gap-1.5">
                    <select name="type" defaultValue="watch_phrase"
                      className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs">
                      {(["watch_phrase", "allow_phrase", "block_phrase", "competitor_phrase", "crisis_phrase", "increase_risk_pattern", "reduce_risk_pattern"] as const).map((mt) => (
                        <option key={mt} value={mt}>{tEnum(t, "memoryType", mt)}</option>
                      ))}
                    </select>
                    <select name="severity" defaultValue="medium"
                      className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs">
                      {(["low", "medium", "high", "critical"] as const).map((s) => (
                        <option key={s} value={s}>{tEnum(t, "severity", s)}</option>
                      ))}
                    </select>
                    <PrimaryButton type="submit">{t.memory.add}</PrimaryButton>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}

          <div className="gu-card p-5">
            <h3 className="mb-2 text-sm font-semibold">{t.dash.platformCapabilities}</h3>
            <div className="flex flex-wrap gap-1.5">
              {meta.supportsReply ? <Badge tone="ok">{t.dash.reply}</Badge> : <Badge tone="warn">{t.dash.noReply}</Badge>}
              {meta.supportsHide ? <Badge tone="ok">{t.dash.hide}</Badge> : <Badge tone="warn">{t.dash.noHide}</Badge>}
              {meta.supportsDelete ? <Badge tone="ok">{t.dash.delete}</Badge> : <Badge tone="warn">{t.dash.noDelete}</Badge>}
            </div>
            <p className="mt-2 text-[11px] text-[var(--color-muted)]">
              {t.dash.capsChecked}
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
