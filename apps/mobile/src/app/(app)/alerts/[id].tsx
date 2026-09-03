/**
 * Action Queue proposal detail.
 *
 * Answers, in order, the questions an approver actually has: what is being proposed,
 * to what content, why, what the policy and safety position is, what has (or has not)
 * happened on the platform, and what was done in Tamanor and by whom.
 *
 * TWO TRUTHS, NEVER MERGED: "Tamanor decision" and "Platform action" are separate
 * sections with separate labels. An approved item whose execution was a dry run must
 * read as exactly that — approved in Tamanor, nothing changed publicly.
 *
 * NO LIVE EXECUTION SURFACE. Readiness is displayed as information; there is no
 * "run it now", no retry-execution control, and no rollback control. M5 ships three
 * internal decisions only: approve, reject, mark handled.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { fetchQueueItem, submitQueueDecision } from '@/api/queue';
import { isSessionInvalid } from '@/api/client';
import type {
  ApiErrorCode, QueueDecision, QueueExecution, QueueItemDetail,
} from '@/api/types';
import { useAuth } from '@/auth/auth-provider';
import { readToken } from '@/auth/session-storage';
import { useShell } from '@/shell/shell-provider';
import { markQueueStale } from '@/queue/queue-sync';
import {
  executionSummary, executionTone, platformLabel, proposedActionTone, queueStateTone,
  readinessTone, riskTone, shouldShowLifecycle, shouldShowReadiness,
} from '@/queue/presentation';
import { DecisionSheet } from '@/components/queue/decision-sheet';
import {
  AppText, Badge, Button, Card, Divider, EmptyState, ErrorState, SectionHeader, SkeletonCard,
} from '@/components/ui';
import { activeLocale, t } from '@/i18n';
import { useTheme } from '@/theme';

function messageFor(error: ApiErrorCode): string {
  switch (error) {
    case 'network': return t.errors.network;
    case 'timeout': return t.errors.timeout;
    case 'config': return t.errors.config;
    case 'permission_denied': return t.queue.result.permissionDenied;
    case 'read_only': return t.queue.result.readOnly;
    case 'conflict': return t.queue.result.conflict;
    case 'not_found': return t.queue.result.notFound;
    default: return t.errors.server;
  }
}

export default function QueueDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { onSessionRejected } = useAuth();
  const { reload: reloadShell } = useShell();

  const [item, setItem] = useState<QueueItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [canDecide, setCanDecide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<QueueDecision | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(
    async (mode: 'first' | 'refresh' = 'first') => {
      if (!id) return;
      if (mode === 'refresh') setRefreshing(true); else setLoading(true);
      setError(null);

      const token = await readToken();
      if (!token) {
        onSessionRejected('unauthenticated');
        return;
      }
      const result = await fetchQueueItem(token, id);
      if (!mounted.current) return;
      setLoading(false);
      setRefreshing(false);

      if (result.ok) {
        setItem(result.data.item);
        setCanDecide(result.data.canDecide);
        setNotFound(false);
        return;
      }
      if (isSessionInvalid(result.error)) {
        onSessionRejected(result.error);
        return;
      }
      // A foreign, missing or forbidden item is one indistinguishable outcome by
      // design — the screen must not confirm that some other tenant's id exists.
      if (result.error === 'network' || result.error === 'timeout' || result.error === 'server_error') {
        setError(result.error);
      } else {
        setNotFound(true);
      }
    },
    [id, onSessionRejected],
  );

  useEffect(() => { void load('first'); }, [load]);

  const decide = useCallback(async () => {
    if (!id || !confirming || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const token = await readToken();
      if (!token) {
        onSessionRejected('unauthenticated');
        return;
      }
      const result = await submitQueueDecision(token, id, confirming);
      if (!mounted.current) return;

      if (!result.ok) {
        if (isSessionInvalid(result.error)) {
          onSessionRejected(result.error);
          return;
        }
        setNotice(messageFor(result.error));
        // Lost the race: the server holds the truth, so resync rather than retry.
        if (result.error === 'conflict') {
          markQueueStale();
          void load('refresh');
        }
        return;
      }

      setNotice(
        confirming === 'approve' ? t.queue.result.approved
          : confirming === 'reject' ? t.queue.result.rejected
            : t.queue.result.resolved,
      );
      // The list is a separate controller — tell it to reconcile on focus.
      markQueueStale();
      // Refetch the detail so every derived section (activity, readiness, executions)
      // comes from the server rather than from a guess about what changed.
      void load('refresh');
      void reloadShell({ refresh: true });
    } finally {
      if (mounted.current) {
        setBusy(false);
        setConfirming(null);
      }
    }
  }, [id, confirming, busy, onSessionRejected, load, reloadShell]);

  const confirmStrings = useMemo(() => {
    switch (confirming) {
      case 'approve':
        return {
          title: t.queue.confirm.approveTitle, body: t.queue.confirm.approveBody,
          confirm: t.queue.actions.approve, cancel: t.queue.actions.cancel,
        };
      case 'reject':
        return {
          title: t.queue.confirm.rejectTitle, body: t.queue.confirm.rejectBody,
          confirm: t.queue.actions.reject, cancel: t.queue.actions.cancel,
        };
      case 'resolve':
        return {
          title: t.queue.confirm.resolveTitle, body: t.queue.confirm.resolveBody,
          confirm: t.queue.actions.resolve, cancel: t.queue.actions.cancel,
        };
      default:
        return null;
    }
  }, [confirming]);

  const formatDateTime = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(activeLocale, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    return (iso: string) => {
      try { return fmt.format(new Date(iso)); } catch { return ''; }
    };
  }, []);

  const executionLine = useCallback(
    (e: QueueExecution) => {
      const status = t.queue.execution[e.status] ?? e.status;
      const trigger = e.trigger === 'autonomous' ? t.queue.execution.byAutonomous : t.queue.execution.byApproval;
      return `${status} — ${trigger}`;
    },
    [],
  );

  /* ---------------------------------------------------------------- states */

  if (loading && !item) {
    return (
      <View
        accessibilityLabel={t.common.loading}
        accessibilityState={{ busy: true }}
        style={{
          flex: 1, backgroundColor: theme.colors.background,
          paddingTop: insets.top + theme.spacing.xl,
          paddingHorizontal: theme.spacing.xl, gap: theme.spacing.md,
        }}>
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
      </View>
    );
  }

  if (notFound) {
    return (
      <View
        style={{
          flex: 1, backgroundColor: theme.colors.background,
          paddingTop: insets.top + theme.spacing.xl, paddingHorizontal: theme.spacing.xl,
        }}>
        <EmptyState
          title={t.queue.notFoundTitle}
          body={t.queue.notFoundBody}
          action={<Button label={t.common.back} variant="secondary" onPress={() => router.back()} />}
        />
      </View>
    );
  }

  if (!item) {
    return (
      <View
        style={{
          flex: 1, backgroundColor: theme.colors.background,
          paddingTop: insets.top + theme.spacing.xl, paddingHorizontal: theme.spacing.xl,
        }}>
        <ErrorState
          title={t.errors.title}
          message={messageFor(error ?? 'server_error')}
          retryLabel={t.common.retry}
          onRetry={() => void load('first')}
        />
      </View>
    );
  }

  const summary = executionSummary(item);
  const proposed = t.queue.proposedAction[item.proposedAction] ?? item.proposedAction;
  const riskLabel = item.risk ? t.inbox.risk[item.risk as keyof typeof t.inbox.risk] ?? null : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
          paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md,
        }}>
        <Button label={t.common.back} variant="ghost" onPress={() => router.back()} />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: theme.spacing.xxxl + insets.bottom,
          gap: theme.spacing.lg,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load('refresh')}
            tintColor={theme.colors.brand}
            colors={[theme.colors.brand]}
          />
        }>
        {/* -------------------------------------------------- Proposal */}
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="caption" tone="foregroundMuted">{t.queue.proposes}</AppText>
            <AppText variant="title" accessibilityRole="header">{proposed}</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
              <Badge
                label={t.queue.state[item.queueState] ?? item.queueState}
                tone={queueStateTone(item.queueState)}
              />
              <Badge label={proposed} tone={proposedActionTone(item.proposedAction)} />
              {riskLabel ? <Badge label={riskLabel} tone={riskTone(item.risk)} /> : null}
            </View>
            <AppText variant="caption" tone="foregroundMuted">
              {formatDateTime(item.createdAt)}
            </AppText>
          </View>
        </Card>

        {/* -------------------------------------------------- Content */}
        <SectionHeader title={t.queue.sections.content} />
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="caption" tone="foregroundMuted">
              {[item.author ?? t.inbox.noAuthor, platformLabel(item.platform), item.account]
                .filter(Boolean).join(' · ')}
            </AppText>
            {item.rating !== null ? (
              <AppText variant="caption" tone="foregroundMuted">{`${item.rating}/5`}</AppText>
            ) : null}
            <AppText variant="body">
              {item.contentText ?? item.contentPreview ?? t.queue.relatedUnavailable}
            </AppText>
            {shouldShowLifecycle(item.lifecycle) ? (
              <Badge label={t.queue.lifecycle[item.lifecycle] ?? item.lifecycle} tone="neutral" />
            ) : null}
            {/*
              A safe link back into the M4 Inbox item — only when the server actually
              gave us one. It is an in-app route, never a provider deep link.
            */}
            {item.relatedInboxItemId ? (
              <Button
                label={item.contentType === 'review' ? t.queue.openReview : t.queue.openComment}
                variant="secondary"
                onPress={() => router.push(`/comments/${item.relatedInboxItemId}`)}
              />
            ) : null}
          </View>
        </Card>

        {/* -------------------------------------------------- Risk & reason */}
        <SectionHeader title={t.queue.sections.risk} />
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            <Row label={t.inbox.filterLabels.risk} value={riskLabel ?? '—'} />
            <Row label={t.queue.sections.proposal} value={item.category} />
            {item.confidence !== null ? (
              <Row label={t.queue.reason.low_confidence} value={`${Math.round(item.confidence * 100)}%`} />
            ) : null}
            {item.reason ? (
              <AppText variant="callout">{t.queue.reason[item.reason] ?? item.reason}</AppText>
            ) : null}
          </View>
        </Card>

        {/* -------------------------------------------------- Policy & safety */}
        <SectionHeader title={t.queue.sections.policy} />
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            {item.policy.mode ? (
              <Row label={t.queue.policy.mode} value={t.queue.policy.modeValue[item.policy.mode] ?? item.policy.mode} />
            ) : null}
            <AppText variant="callout" tone="foregroundMuted">
              {item.policy.neverAutonomous
                ? t.queue.policy.neverAutonomous
                : item.policy.autonomousEligible
                  ? t.queue.policy.autonomousEligible
                  : t.queue.policy.notEligible}
            </AppText>
          </View>
        </Card>

        {/* -------------------------------------------------- Readiness (info only) */}
        {shouldShowReadiness(item.readiness.state) ? (
          <>
            <SectionHeader title={t.queue.sections.readiness} />
            <Card variant="sunken">
              <View style={{ gap: theme.spacing.sm }}>
                <Badge
                  label={t.queue.readiness[item.readiness.state] ?? item.readiness.state}
                  tone={readinessTone(item.readiness.state)}
                />
                {item.readiness.reason ? (
                  <AppText variant="callout">
                    {t.queue.reason[item.readiness.reason] ?? item.readiness.reason}
                  </AppText>
                ) : null}
                {/* States what this section is NOT: a control. */}
                <AppText variant="caption" tone="foregroundMuted">{t.queue.readiness.note}</AppText>
              </View>
            </Card>
          </>
        ) : null}

        {/* -------------------------------------------------- Platform action */}
        <SectionHeader title={t.queue.sections.execution} />
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            {summary.platformStatus === null ? (
              <AppText variant="callout" tone="foregroundMuted">{t.queue.execution.none}</AppText>
            ) : (
              <>
                <Badge
                  label={t.queue.execution[summary.platformStatus] ?? summary.platformStatus}
                  tone={executionTone(summary.platformStatus)}
                />
                {item.executions.map((e, i) => (
                  <View key={`${e.at}-${i}`} style={{ gap: theme.spacing.xxs }}>
                    <AppText variant="caption">{executionLine(e)}</AppText>
                    {e.reason ? (
                      <AppText variant="caption" tone="foregroundMuted">
                        {t.queue.reason[e.reason] ?? e.reason}
                      </AppText>
                    ) : null}
                    <AppText variant="caption" tone="foregroundMuted">{formatDateTime(e.at)}</AppText>
                    {i < item.executions.length - 1 ? <Divider spacing={theme.spacing.xs} /> : null}
                  </View>
                ))}
              </>
            )}
          </View>
        </Card>

        {/* -------------------------------------------------- Activity */}
        {item.activity.length > 0 ? (
          <>
            <SectionHeader title={t.queue.sections.activity} />
            <Card>
              <View style={{ gap: theme.spacing.sm }}>
                {item.activity.map((a) => (
                  <View key={a.id} style={{ gap: theme.spacing.xxs }}>
                    <AppText variant="callout">{t.queue.activityEvent[a.event] ?? a.event}</AppText>
                    <AppText variant="caption" tone="foregroundMuted">{formatDateTime(a.at)}</AppText>
                  </View>
                ))}
              </View>
            </Card>
          </>
        ) : null}

        {/* -------------------------------------------------- Decision */}
        <SectionHeader title={t.queue.sections.decision} />
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <Badge
              label={t.queue.state[summary.decisionState] ?? summary.decisionState}
              tone={queueStateTone(summary.decisionState)}
            />

            {notice ? (
              <AppText variant="callout" tone="brand" accessibilityLiveRegion="polite">
                {notice}
              </AppText>
            ) : null}

            {!canDecide ? (
              <AppText variant="callout" tone="foregroundMuted">{t.queue.noPermission}</AppText>
            ) : (
              <View style={{ gap: theme.spacing.sm }}>
                {item.canApprove ? (
                  <Button
                    label={t.queue.actions.approve}
                    variant="primary"
                    block
                    disabled={busy}
                    accessibilityHint={t.queue.confirm.approveBody}
                    onPress={() => setConfirming('approve')}
                  />
                ) : null}
                {item.canReject ? (
                  <Button
                    label={t.queue.actions.reject}
                    variant="secondary"
                    block
                    disabled={busy}
                    accessibilityHint={t.queue.confirm.rejectBody}
                    onPress={() => setConfirming('reject')}
                  />
                ) : null}
                {item.canResolve ? (
                  <Button
                    label={t.queue.actions.resolve}
                    variant="secondary"
                    block
                    disabled={busy}
                    accessibilityHint={t.queue.confirm.resolveBody}
                    onPress={() => setConfirming('resolve')}
                  />
                ) : null}
              </View>
            )}
          </View>
        </Card>
      </ScrollView>

      <DecisionSheet
        decision={confirming}
        strings={confirmStrings}
        busy={busy}
        onConfirm={() => void decide()}
        onCancel={() => setConfirming(null)}
      />
    </View>
  );
}

/** A label/value pair, so the detail sections read consistently. */
function Row({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md }}>
      <AppText variant="caption" tone="foregroundMuted">{label}</AppText>
      <AppText variant="caption" style={{ flexShrink: 1, textAlign: 'right' }}>{value}</AppText>
    </View>
  );
}
