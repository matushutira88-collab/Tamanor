import Link from "next/link";
import { notFound } from "next/navigation";
import { Permission, PLATFORM_META, Platform, can } from "@guardora/core";
import { NEVER_AUTONOMOUS, AUTONOMOUS_ELIGIBLE, FACEBOOK_HIDE_PERMISSION } from "@guardora/ai";
import { getLiveActionsConfig } from "@guardora/config";
import { predictHideOutcome, findPreflightDryRun, resolvePrimaryAction, checkAccountToken, getCommentLifecycle, ROLLBACK_AVAILABLE } from "@guardora/sync";
import { PageHeader, Card, Badge } from "@/components/dashboard/ui";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { LiveHideForm } from "@/components/dashboard/live-hide-form";
import { Notice } from "@/components/dashboard/notice";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { formatDateTime } from "@/lib/format";
import { approveQueueItem, approveWithoutHide, retryQueueItem, rejectQueueItem, markSafeQueueItem, markHarmfulQueueItem, markHandledQueueItem, createIncidentFromQueue } from "./actions";
import { rollbackExecution } from "../../safety-actions";

export const dynamic = "force-dynamic";

export default async function ApprovalDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const t = await getT();
  const session = await requireSession();
  const canApprove = can(session.role, Permission.ProposalApprove);
  const canAct = can(session.role, Permission.InboxAct);

  const q = await prisma.actionQueueItem.findFirst({ where: { id, tenantId: session.tenantId } });
  if (!q) notFound();

  const [item, policy, audits, lastExec] = await Promise.all([
    prisma.reputationItem.findFirst({ where: { id: q.itemId }, include: { contentItem: { include: { connectedAccount: { select: { id: true, status: true, health: true, grantedPermissions: true, pageId: true, externalId: true, externalName: true, platform: true, connectionStatus: true, tokenHealth: true } } } }, brand: { select: { name: true } } } }),
    prisma.controlPolicy.findFirst({ where: { brandId: q.brandId, category: q.category, isActive: true } }),
    prisma.auditLog.findMany({ where: { tenantId: session.tenantId, OR: [{ targetId: q.id }, { targetId: q.itemId }] }, orderBy: { createdAt: "desc" }, take: 10, select: { event: true, createdAt: true } }),
    prisma.platformActionExecution.findFirst({ where: { tenantId: session.tenantId, queueItemId: q.id, actionType: "hide_comment", trigger: "approval" }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, reason: true, providerErrorCode: true, createdAt: true } }),
  ]);
  // V1.27 — autonomous (auto-hide) execution for this item, if any.
  const autoExec = await prisma.platformActionExecution.findFirst({
    where: { tenantId: session.tenantId, queueItemId: q.id, actionType: "hide_comment", trigger: "autonomous", status: { in: ["executed", "failed"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, reason: true, confidence: true, policyCategory: true, providerErrorCode: true, providerErrorMessage: true, executedAt: true, createdAt: true },
  });
  const meta = item ? PLATFORM_META[item.platform as Platform] : null;
  const neverAuto = NEVER_AUTONOMOUS.has(q.category as never);
  const fpRisk = q.confidence >= 0.85 ? "Low" : q.confidence >= 0.7 ? "Medium" : "High";

  // Controlled hide test — predict the outcome without executing (V1.25).
  const live = getLiveActionsConfig();
  const acct = item?.contentItem.connectedAccount;
  // V1.27D — self-heal a stale needs_reconnect/expired row before predicting, so the
  // panel reflects a fresh Graph check (the same repair the diagnostics/hide run does).
  let effHealth = acct?.health as unknown as string | undefined;
  let effConn = acct?.connectionStatus as string | undefined;
  let effTok = acct?.tokenHealth as string | undefined;
  if (acct && live.canExecuteLive && q.proposedAction === "hide_comment" &&
      (effConn !== "connected" || effHealth !== "healthy" || effTok === "expired" || effTok === "invalid" || effTok === "revoked")) {
    try {
      const res = await checkAccountToken(acct.id);
      effConn = res.connectionStatus; effTok = res.tokenHealth;
      if (res.tokenHealth === "ok") effHealth = "healthy";
    } catch { /* best-effort; fall back to stored state */ }
  }
  const predicted = acct ? predictHideOutcome({
    tenantId: session.tenantId, brandId: q.brandId, itemId: q.itemId, queueItemId: q.id, policyId: policy?.id ?? null,
    connectedAccountId: acct.id, platform: acct.platform as unknown as string,
    externalCommentId: item!.contentItem.externalId, externalPostId: item!.contentItem.externalParentId ?? null,
    matchedCategory: q.category, confidence: q.confidence, riskLevel: item!.riskLevel as unknown as string,
    mode: policy?.mode ?? "approval", trigger: "approval",
    account: { status: acct.status as unknown as string, health: effHealth as string, grantedPermissions: acct.grantedPermissions, pageId: acct.pageId, externalId: acct.externalId, connectionStatus: effConn, tokenHealth: effTok },
  }, live) : null;
  const EXP_LABEL: Record<string, string> = { blocked: t.cc.expBlocked, dry_run: t.cc.expDryRun, live_possible: t.cc.expLivePossible };
  const EXP_TONE: Record<string, string> = { blocked: "ok", dry_run: "warn", live_possible: "danger" };

  // --- V1.26 controlled LIVE hide readiness (preflight + gates). ---
  const preflight = q.proposedAction === "hide_comment"
    ? await findPreflightDryRun({ tenantId: session.tenantId, queueItemId: q.id, policyId: policy?.id ?? null })
    : null;
  const permGranted = !!acct && acct.grantedPermissions.includes(FACEBOOK_HIDE_PERMISSION);
  const eligibleCategory = AUTONOMOUS_ELIGIBLE.has(q.category as never) && !neverAuto;
  const alreadyExecuted = lastExec?.status === "executed";
  const readiness = {
    liveEnabled: live.liveEnabled,
    facebookHideEnabled: live.facebookHideEnabled,
    dryRunOff: !live.dryRun,
    liveConfirmed: live.liveConfirmed,
    permission: permGranted,
    preflight: !!preflight,
    idempotency: !alreadyExecuted,
    safety: eligibleCategory && q.confidence >= 0.8,
  };
  // V1.26C — when the item predicts "live_possible", the LIVE hide is the PRIMARY
  // action and its form renders directly (not conditioned on preflight). Single
  // source of truth shared with the UX test.
  // V1.27E — proactively read the comment's lifecycle from Facebook when relevant, so
  // the panel reflects deleted/hidden/cannot_hide BEFORE any attempt. One read-only GET,
  // only for a live-capable hide item that would otherwise offer a live action.
  let commentDeleted = false;
  let commentCannotHide = false;
  // Graph-verified is_hidden=true → the comment is hidden from the PUBLIC (the
  // author/admin may still see it — expected Facebook behavior).
  let commentHiddenPublicly = false;
  if (acct && q.proposedAction === "hide_comment" && live.canExecuteLive && item?.contentItem.externalId &&
      (predicted?.expected === "live_possible" || alreadyExecuted)) {
    try {
      const lc = await getCommentLifecycle({ accountId: acct.id, commentId: item.contentItem.externalId });
      commentDeleted = lc.status === "deleted";
      commentCannotHide = lc.status === "cannot_hide";
      commentHiddenPublicly = lc.status === "hidden";
    } catch { /* best-effort; fall back to attempt-time detection */ }
  }
  // V1.27C — Facebook may refuse to hide a specific comment (can_hide=false); V1.27E
  // adds proactive detection (commentCannotHide) alongside the last attempt's reason.
  const canHideFalse = commentCannotHide || lastExec?.reason === "facebook_can_hide_false" || autoExec?.reason === "facebook_can_hide_false";
  const decision = resolvePrimaryAction({ proposedAction: q.proposedAction, expected: predicted?.expected ?? null, alreadyExecuted });
  // A deleted comment is a resolved, neutral state — never live/reconnect/token.
  const liveMode = decision.primary === "live_hide" && !canHideFalse && !commentDeleted;
  const showLiveForm = decision.showLiveForm;
  const showRetry = showLiveForm && lastExec?.status === "failed";
  const isDev = process.env.NODE_ENV !== "production";
  // V1.27B/D — show a reconnect CTA only when the account is ACTUALLY unhealthy now.
  // A self-healed (connected/ok) account must never show a stale reconnect CTA.
  const accountUnhealthyNow = effConn !== "connected" || effTok === "expired" || effTok === "invalid" || effTok === "revoked";
  // A deleted comment is a resolved state — never surface reconnect/token error for it.
  const tokenExpired = !commentDeleted && accountUnhealthyNow && (
    (lastExec?.status === "failed" && (lastExec.reason === "token_expired" || lastExec.providerErrorCode === "token_expired"))
    || (autoExec?.status === "failed" && (autoExec.reason === "token_expired" || autoExec.providerErrorCode === "token_expired")));
  const reconnectHref = acct ? `/api/connectors/meta/start?brandId=${q.brandId}&accountId=${acct.id}` : "/dashboard/accounts";
  const R = ({ ok, label }: { ok: boolean; label: string }) => (
    <li className="flex items-center gap-1.5">{ok ? "✅" : "⛔"} <span className={ok ? "" : "text-[var(--color-muted)]"}>{label}</span></li>
  );

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex justify-between gap-4 border-b border-[var(--color-border)] py-1.5 text-sm last:border-0">
      <span className="text-[var(--color-muted)]">{label}</span><span className="text-right font-medium">{children}</span>
    </div>
  );

  return (
    <>
      <PageHeader eyebrow={t.cc.queueTitle} title={t.cc.approvalTitle} description={item?.contentItem.text ?? ""} action={<Badge tone="neutral">{t.cc.noLiveAction}</Badge>} />
      <Notice notice={sp.notice} kind={sp.kind} />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card>
            <h3 className="mb-2 text-sm font-semibold">{t.cc.whatHappened}</h3>
            <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm">{item?.contentItem.text}</p>
            <dl className="mt-3">
              <Field label={t.cc.colCategory}>{tEnum(t, "autoProtectCategory", q.category)}</Field>
              <Field label="Confidence">{(q.confidence * 100).toFixed(0)}%</Field>
              <Field label={meta?.label ?? "Platform"}>{item?.brand.name} · {item?.contentItem.authorDisplayName ?? "—"}</Field>
              <Field label={t.cc.proposedActionLabel}>{q.proposedAction.replace(/_/g, " ")}</Field>
              <Field label={t.cc.colState}><Badge tone="warn">{tEnum(t, "queueState", q.queueState)}</Badge></Field>
              <Field label={t.cc.whyLabel}><span className="text-xs">{q.reason}</span></Field>
              <Field label={t.cc.triggeredPolicy}>{policy ? `${tEnum(t, "autoProtectCategory", policy.category)} → ${tEnum(t, "controlMode", policy.mode)}` : "—"}</Field>
              <Field label={t.cc.falsePositiveRisk}>{fpRisk}</Field>
            </dl>
          </Card>

          {autoExec ? (
            <Card>
              {autoExec.status === "executed" ? (
                <>
                  <div className="mb-2 flex items-center gap-2"><Badge tone="danger">🤖 {t.cc.autoHidden}</Badge><span className="text-xs text-[var(--color-muted)]">{t.cc.autoHiddenBy}</span></div>
                  <p className="mb-2 text-sm font-medium">{t.cc.autoHiddenPublic}</p>
                  <dl>
                    <Field label={t.cc.whyLabel}><span className="text-xs">{(t.autoProtect.blockReason as Record<string, string>)[autoExec.reason ?? ""] ?? autoExec.reason}</span></Field>
                    <Field label={t.cc.triggeredPolicy}>{autoExec.policyCategory ? tEnum(t, "autoProtectCategory", autoExec.policyCategory) : "—"}</Field>
                    <Field label="Confidence">{((autoExec.confidence ?? 0) * 100).toFixed(0)}%</Field>
                    <Field label="Execution ID"><span className="font-mono text-[11px]">{autoExec.id}</span></Field>
                    <Field label={t.cc.lastAttemptAt}>{formatDateTime(autoExec.executedAt ?? autoExec.createdAt)}</Field>
                  </dl>
                  <p className="mt-2 text-[11px] text-[var(--color-muted)]">{t.cc.hiddenAdminNote}</p>
                  {canApprove && ROLLBACK_AVAILABLE ? (
                    <form action={rollbackExecution} className="mt-2">
                      <input type="hidden" name="executionId" value={autoExec.id} />
                      <input type="hidden" name="backTo" value={`/dashboard/action-queue/${q.id}`} />
                      <SubmitButton variant="secondary" pendingLabel={t.cc.approving} className="w-full">↩︎ {t.cc.restoreComment}</SubmitButton>
                    </form>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="mb-2 flex items-center gap-2"><Badge tone="danger">⚠️ {t.cc.autoHiddenFailed}</Badge></div>
                  {autoExec.providerErrorCode === "token_expired" || autoExec.reason === "token_expired" ? (
                    <>
                      <p className="text-xs font-medium text-[var(--color-danger)]">{t.cc.tokenExpired}</p>
                      <a href={reconnectHref} className="mt-2 inline-block rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-brand-strong)]">{t.cc.reconnectPage}</a>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-[var(--color-danger)]">{autoExec.providerErrorMessage ?? autoExec.providerErrorCode ?? autoExec.reason}</p>
                      <p className="mt-1 text-[11px] text-[var(--color-muted)]">{t.cc.lastAttemptFailed}</p>
                    </>
                  )}
                </>
              )}
            </Card>
          ) : null}

          {canHideFalse ? (
            <Card>
              <div className="mb-1 flex items-center gap-2"><Badge tone="warn">🚫 {t.cc.canHideFalseTitle}</Badge></div>
              <p className="text-xs text-[var(--color-muted)]">{t.cc.canHideFalse}</p>
            </Card>
          ) : null}

          {predicted ? (
            <Card>
              <h3 className="mb-2 text-sm font-semibold">🧪 {t.cc.controlledHideTest}</h3>
              {live.canExecuteLive ? (
                <div className="mb-3 rounded-lg border-2 border-[var(--color-danger)] p-2 text-xs">
                  <p className="font-bold text-[var(--color-danger)]">🚨 {t.cc.liveWarningTitle}</p>
                  <p className="mt-1 text-[var(--color-muted)]">{t.cc.liveWarningBody}</p>
                  <p className="mt-1"><Badge tone={live.liveConfirmed ? "danger" : "ok"}>{live.liveConfirmed ? t.cc.liveConfirmSet : t.cc.liveConfirmNeeded}</Badge></p>
                </div>
              ) : null}
              <dl className="text-sm">
                <Field label={acct!.externalName ?? "Account"}>{acct!.externalName} · {acct!.pageId ?? acct!.externalId}</Field>
                <Field label={t.cc.envGates}>LIVE={String(live.liveEnabled)} · FB_HIDE={String(live.facebookHideEnabled)} · DRY_RUN={String(live.dryRun)}</Field>
                <Field label={t.cc.linkedPolicies}>{policy ? tEnum(t, "controlMode", policy.mode) : "—"}</Field>
                <Field label={t.cc.expectedResult}>
                  <Badge tone={EXP_TONE[predicted.expected] ?? "neutral"}>{EXP_LABEL[predicted.expected] ?? predicted.expected}</Badge>
                  <span className="ml-2 text-xs text-[var(--color-muted)]">{(t.autoProtect.blockReason as Record<string, string>)[predicted.reason] ?? predicted.reason}</span>
                </Field>
              </dl>
              {lastExec ? (
                <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-xs">
                  {lastExec.status === "executed" ? (
                    <p className="font-medium">✅ {t.cc.alreadyExecuted}</p>
                  ) : lastExec.status === "dry_run" ? (
                    <p className="font-medium">🧪 {t.cc.dryRunAlreadyPrepared}</p>
                  ) : lastExec.status === "failed" ? (
                    <p className="font-medium text-[var(--color-danger)]">⚠️ {t.cc.lastAttemptFailed}</p>
                  ) : (
                    <p className="font-medium">🛡️ {(t.autoProtect.blockReason as Record<string, string>)[lastExec.reason ?? ""] ?? lastExec.reason}</p>
                  )}
                  <p className="mt-0.5 text-[var(--color-muted)]">{t.cc.lastAttemptAt}: {formatDateTime(lastExec.createdAt)}</p>
                </div>
              ) : null}
              <p className="mt-2 text-[11px] text-[var(--color-muted)]">✅ {t.cc.stillVisible}</p>
            </Card>
          ) : null}

          {predicted && q.proposedAction === "hide_comment" && !alreadyExecuted ? (
            <Card>
              <h3 className="mb-2 text-sm font-semibold">🔴 {t.cc.liveHideTitle}</h3>
              <p className="mb-2 text-xs font-medium">{t.cc.liveReadiness}</p>
              <ul className="space-y-0.5 text-xs">
                <R ok={readiness.liveEnabled} label="LIVE_ACTIONS_ENABLED=true" />
                <R ok={readiness.facebookHideEnabled} label="FACEBOOK_HIDE_ENABLED=true" />
                <R ok={readiness.dryRunOff} label="LIVE_ACTIONS_DRY_RUN=false" />
                <R ok={readiness.liveConfirmed} label="LIVE_HIDE_TEST_CONFIRM=YES" />
                <R ok={readiness.permission} label="pages_manage_engagement" />
                <R ok={readiness.preflight} label={t.cc.preflightDryRun} />
                <R ok={readiness.idempotency} label={t.cc.idempotencyOk} />
                <R ok={readiness.safety} label={t.cc.safetyOk} />
              </ul>
              <p className="mt-2 text-[11px] text-[var(--color-muted)]">{liveMode ? t.cc.liveReadyPrimary : t.cc.liveGatesNotMet}</p>
            </Card>
          ) : null}

          <Card>
            <h3 className="mb-2 text-sm font-semibold">{t.cc.ifAutonomous}</h3>
            <p className="text-sm text-[var(--color-muted)]">{t.cc.ifAutonomousBody}</p>
          </Card>

          <Card>
            <h3 className="mb-2 text-sm font-semibold">{t.cc.safetyChecks}</h3>
            <ul className="space-y-1 text-xs">
              <li>{neverAuto ? "🛡️" : "✅"} {t.cc.neverHideCriticism}</li>
              <li>✅ {t.cc.liveDisabled} · {t.cc.noLiveAction}</li>
              <li>{q.safetyBlocked ? "🛡️ " + tEnum(t, "queueState", "blocked_by_safety") : "✅ " + t.cc.dryRun}</li>
            </ul>
          </Card>

          <Card>
            <h3 className="mb-2 text-sm font-semibold">{t.cc.auditTrail}</h3>
            {audits.length === 0 ? <p className="text-xs text-[var(--color-muted)]">—</p> : (
              <ul className="space-y-1 text-xs">
                {audits.map((a, i) => (<li key={i} className="flex justify-between"><span className="font-mono">{a.event}</span><span className="text-[var(--color-muted)]">{formatDateTime(a.createdAt)}</span></li>))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-3">
          {commentDeleted ? (
            <Card>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm">
                <p className="font-medium">✅ {t.cc.commentDeleted}</p>
                <p className="mt-1 text-xs text-[var(--color-muted)]">{t.cc.commentDeletedResolved}</p>
              </div>
              {canApprove ? (
                <form action={markHandledQueueItem} className="mt-2"><input type="hidden" name="id" value={q.id} /><SubmitButton variant="secondary" pendingLabel={t.cc.approving} className="w-full">{t.cc.markHandled}</SubmitButton></form>
              ) : null}
            </Card>
          ) : alreadyExecuted ? (
            <Card>
              <div className="rounded-lg border-2 border-[var(--color-danger)] bg-[var(--color-surface-2)] p-3 text-sm">
                <p className="font-bold">✅ {t.cc.liveDone}</p>
                {commentHiddenPublicly ? (
                  <div className="mt-2 rounded-md border border-[var(--color-ok)] p-2 text-xs">
                    <p className="font-medium">🔒 {t.cc.hiddenPublicly} — {t.cc.hiddenConfirmed}</p>
                    <p className="mt-0.5 text-[var(--color-muted)]">{t.cc.hiddenVerified}</p>
                  </div>
                ) : null}
                <p className="mt-1 text-xs text-[var(--color-muted)]">{t.cc.hiddenAdminNote}</p>
                <p className="mt-1 text-xs text-[var(--color-muted)]">{t.cc.liveDoneRollback}</p>
                {lastExec?.createdAt ? <p className="mt-1 text-xs text-[var(--color-muted)]">{t.cc.lastAttemptAt}: {formatDateTime(lastExec.createdAt)}</p> : null}
              </div>
              {canApprove && lastExec?.id && ROLLBACK_AVAILABLE ? (
                <form action={rollbackExecution} className="mt-2">
                  <input type="hidden" name="executionId" value={lastExec.id} />
                  <input type="hidden" name="backTo" value={`/dashboard/action-queue/${q.id}`} />
                  <SubmitButton variant="secondary" pendingLabel={t.cc.approving} className="w-full">↩︎ {t.cc.restoreComment}</SubmitButton>
                </form>
              ) : null}
            </Card>
          ) : liveMode ? (
            <Card>
              <p className="mb-2 text-sm font-semibold text-[var(--color-danger)]">🔴 {t.cc.liveReadyPrimary}</p>
              {isDev ? (
                <pre className="mb-2 rounded bg-[var(--color-surface-2)] p-1 text-[10px] text-[var(--color-muted)]">primaryAction={decision.primary}{"\n"}expectedResult={predicted?.expected}</pre>
              ) : null}
              {canApprove ? (
                <div className="space-y-2">
                  {tokenExpired ? (
                    <div className="rounded-lg border-2 border-[var(--color-danger)] p-2 text-xs">
                      <p className="font-medium text-[var(--color-danger)]">{t.cc.tokenExpired}</p>
                      <p className="mt-1 text-[var(--color-muted)]">{t.cc.reconnectFirst}</p>
                      <a href={reconnectHref} className="mt-2 inline-block rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-brand-strong)]">{t.cc.reconnectPage}</a>
                    </div>
                  ) : (
                  /* V1.26C — live form renders directly whenever live_possible. */
                  <LiveHideForm
                    id={q.id}
                    retry={showRetry}
                    warning={t.cc.liveHideWarning}
                    ackLabel={t.cc.liveHideAck}
                    phraseLabel={t.cc.liveHidePhrase}
                    phrasePlaceholder="LIVE HIDE"
                    buttonLabel={showRetry ? t.cc.liveHideRetryButton : t.cc.liveHideButton}
                    pendingLabel={t.cc.approving}
                  />
                  )}
                  <form action={approveWithoutHide}><input type="hidden" name="id" value={q.id} /><SubmitButton variant="secondary" pendingLabel={t.cc.approving} className="w-full">{t.cc.approveWithoutHide}</SubmitButton></form>
                  <form action={rejectQueueItem}><input type="hidden" name="id" value={q.id} /><SubmitButton variant="secondary" className="w-full">{t.cc.reject}</SubmitButton></form>
                </div>
              ) : null}
            </Card>
          ) : null}

          <Card>
            <p className="mb-1 text-xs font-medium">{t.cc.approveExplains}</p>
            <p className="mb-3 text-[11px] text-[var(--color-muted)]">{t.cc.approveExplainsBody} {t.cc.approveNote}</p>
            <div className="space-y-2">
              {canApprove && !liveMode && !alreadyExecuted && !commentDeleted ? (
                <>
                  <form action={approveQueueItem}><input type="hidden" name="id" value={q.id} /><SubmitButton pendingLabel={t.cc.approving} className="w-full">{t.cc.approve}</SubmitButton></form>
                  {tokenExpired ? (
                    <div className="rounded-lg border border-[var(--color-danger)] p-2 text-xs">
                      <p className="font-medium text-[var(--color-danger)]">{t.cc.reconnectFirst}</p>
                      <a href={reconnectHref} className="mt-1 inline-block text-[var(--color-brand)] hover:underline">{t.cc.reconnectPage} →</a>
                    </div>
                  ) : lastExec?.status === "failed" && !live.canExecuteLive ? (
                    <form action={retryQueueItem}><input type="hidden" name="id" value={q.id} /><SubmitButton variant="secondary" pendingLabel={t.cc.approving} className="w-full">{t.cc.retry}</SubmitButton></form>
                  ) : null}
                  <form action={rejectQueueItem}><input type="hidden" name="id" value={q.id} /><SubmitButton variant="secondary" className="w-full">{t.cc.reject}</SubmitButton></form>
                </>
              ) : null}
              {canAct ? (
                <div className="grid grid-cols-2 gap-2">
                  <form action={markSafeQueueItem}><input type="hidden" name="id" value={q.id} /><button type="submit" className="w-full rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs hover:border-[var(--color-border-strong)]">{t.cc.markSafe}</button></form>
                  <form action={markHarmfulQueueItem}><input type="hidden" name="id" value={q.id} /><button type="submit" className="w-full rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs hover:border-[var(--color-border-strong)]">{t.cc.markHarmful}</button></form>
                  <form action={createIncidentFromQueue} className="col-span-2"><input type="hidden" name="id" value={q.id} /><button type="submit" className="w-full rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs hover:border-[var(--color-border-strong)]">{t.cc.createIncidentBtn}</button></form>
                </div>
              ) : null}
            </div>
          </Card>
          <Card>
            <div className="space-y-1.5 text-xs">
              <Link href={`/dashboard/inbox/${q.itemId}`} className="block text-[var(--color-brand)] hover:underline">{t.cc.openItem} →</Link>
              <Link href="/dashboard/control-center" className="block text-[var(--color-brand)] hover:underline">{t.cc.editPolicy} →</Link>
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
