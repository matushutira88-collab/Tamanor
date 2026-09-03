/**
 * Alerts — the real Action Queue.
 *
 * Replaces the M3 placeholder. A virtualized `FlatList` fed by `useQueueController`:
 * server-side tab views, keyset pagination, and decision reconciliation.
 *
 * WHAT A DECISION HERE DOES: it records an approve / reject / mark-handled inside
 * Tamanor. It does not hide, delete, reply to or report anything on a platform. The
 * screen therefore shows the queue state and any platform-execution state as two
 * separate facts, and the confirmation copy says so explicitly.
 */

import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { QUEUE_TABS, type ApiErrorCode, type QueueDecision, type QueueItem, type QueueTab } from '@/api/types';
import { useShell } from '@/shell/shell-provider';
import { useQueueController } from '@/queue/use-queue';
import {
  isBlockingError, isEmpty, isFirstLoad, isLoadingMore, isRefreshing,
} from '@/queue/queue-state';
import { consumeQueueStale } from '@/queue/queue-sync';
import { QueueRow } from '@/components/queue/queue-row';
import { DecisionSheet } from '@/components/queue/decision-sheet';
import { AppHeader } from '@/components/shell/app-header';
import {
  AppText, Badge, Button, Card, EmptyState, ErrorState, Loading, SkeletonCard,
} from '@/components/ui';
import { activeLocale, t } from '@/i18n';
import { useTheme } from '@/theme';

/** One fixed sentence per bounded code — never raw server text. */
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

export default function AlertsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { bootstrap } = useShell();
  const controller = useQueueController();
  const { state, tab, setTab, pendingIds } = controller;

  /** The decision awaiting confirmation, if any. */
  const [confirming, setConfirming] = useState<{ id: string; decision: QueueDecision } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const formatTime = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(activeLocale, { day: 'numeric', month: 'short' });
    return (iso: string) => {
      try { return fmt.format(new Date(iso)); } catch { return ''; }
    };
  }, []);

  const openItem = useCallback((id: string) => router.push(`/alerts/${id}`), [router]);

  // Returning from a detail screen where a decision was made: reconcile once.
  useFocusEffect(
    useCallback(() => {
      if (consumeQueueStale()) void controller.refresh();
    }, [controller]),
  );

  const confirmDecision = useCallback(async () => {
    if (!confirming) return;
    const { id, decision } = confirming;
    const result = await controller.decide(id, decision);
    setConfirming(null);
    if (result.ok) {
      setNotice(
        decision === 'approve' ? t.queue.result.approved
          : decision === 'reject' ? t.queue.result.rejected
            : t.queue.result.resolved,
      );
      return;
    }
    if (result.error) setNotice(messageFor(result.error));
  }, [confirming, controller]);

  const confirmStrings = useMemo(() => {
    if (!confirming) return null;
    switch (confirming.decision) {
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
      default:
        return {
          title: t.queue.confirm.resolveTitle, body: t.queue.confirm.resolveBody,
          confirm: t.queue.actions.resolve, cancel: t.queue.actions.cancel,
        };
    }
  }, [confirming]);

  const renderItem = useCallback(
    ({ item }: { item: QueueItem }) => (
      <QueueRow
        item={item}
        timestamp={formatTime(item.createdAt)}
        pending={pendingIds.includes(item.id)}
        onPress={openItem}
        onApprove={(id) => setConfirming({ id, decision: 'approve' })}
        onReject={(id) => setConfirming({ id, decision: 'reject' })}
        strings={{
          proposedAction: t.queue.proposedAction[item.proposedAction] ?? item.proposedAction,
          state: t.queue.state[item.queueState] ?? item.queueState,
          risk: item.risk ? t.inbox.risk[item.risk as keyof typeof t.inbox.risk] ?? null : null,
          execution: item.execution ? t.queue.execution[item.execution.status] ?? null : null,
          lifecycle: t.queue.lifecycle[item.lifecycle] ?? null,
          reason: item.reason ? t.queue.reason[item.reason] ?? null : null,
          needsDecision: t.queue.needsDecision,
          proposes: t.queue.proposes,
          noAuthor: t.inbox.noAuthor,
          approve: t.queue.actions.approve,
          reject: t.queue.actions.reject,
        }}
      />
    ),
    [formatTime, openItem, pendingIds],
  );

  const emptyCopy = useMemo(() => {
    switch (tab) {
      case 'approval': return { title: t.queue.empty.approvalTitle, body: t.queue.empty.approvalBody };
      case 'blocked': return { title: t.queue.empty.blockedTitle, body: t.queue.empty.blockedBody };
      case 'resolved': return { title: t.queue.empty.resolvedTitle, body: t.queue.empty.resolvedBody };
      case 'all': return { title: t.queue.empty.allTitle, body: t.queue.empty.allBody };
      default: return { title: t.queue.empty.activeTitle, body: t.queue.empty.activeBody };
    }
  }, [tab]);

  /** Badge counts per tab. Only the three the server publishes carry a number. */
  const countFor = (key: QueueTab): number | null => {
    const c = state.counts;
    if (!c) return null;
    return key === 'active' ? c.active : key === 'approval' ? c.approval : key === 'blocked' ? c.blocked : null;
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: theme.spacing.xl }}>
        <AppHeader title={t.queue.title} workspaceName={bootstrap?.workspace.name} />

        {/* Tabs. Horizontal, so five views fit any phone width. */}
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={QUEUE_TABS as readonly QueueTab[]}
          keyExtractor={(v) => v}
          contentContainerStyle={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.md }}
          renderItem={({ item: key }) => {
            const active = tab === key;
            const count = countFor(key);
            const label = t.queue.tabs[key];
            return (
              <Pressable
                onPress={() => setTab(key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                // The count is spoken, not left to the numeral alone.
                accessibilityLabel={count && count > 0 ? `${label}, ${count}` : label}
                style={{
                  minHeight: theme.sizing.minTouchTarget,
                  flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs,
                  paddingHorizontal: theme.spacing.lg,
                  borderRadius: theme.radius.pill,
                  backgroundColor: active ? theme.colors.brand : theme.colors.surface,
                  borderWidth: 1,
                  borderColor: active ? theme.colors.brand : theme.colors.border,
                }}>
                <AppText
                  variant="caption"
                  style={{ color: active ? theme.colors.brandOn : theme.colors.foreground }}>
                  {label}
                </AppText>
                {count && count > 0 ? (
                  <AppText
                    variant="caption"
                    style={{ color: active ? theme.colors.brandOn : theme.colors.foregroundMuted }}>
                    {count}
                  </AppText>
                ) : null}
              </Pressable>
            );
          }}
        />

        {/* A read-only role still sees the queue; it just cannot decide on it. */}
        {state.phase === 'ready' && !state.canDecide ? (
          <View style={{ paddingBottom: theme.spacing.md }}>
            <Badge label={t.queue.noPermission} tone="neutral" />
          </View>
        ) : null}

        {notice ? (
          <Pressable
            onPress={() => setNotice(null)}
            accessibilityRole="button"
            accessibilityLiveRegion="polite"
            style={{ paddingBottom: theme.spacing.md }}>
            <AppText variant="caption" tone="brand">{notice}</AppText>
          </Pressable>
        ) : null}
      </View>

      {isFirstLoad(state) ? (
        <View
          accessibilityLabel={t.common.loading}
          accessibilityState={{ busy: true }}
          style={{ paddingHorizontal: theme.spacing.xl, gap: theme.spacing.md }}>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </View>
      ) : isBlockingError(state) ? (
        <View style={{ paddingHorizontal: theme.spacing.xl }}>
          <ErrorState
            title={t.errors.title}
            message={messageFor(state.error ?? 'server_error')}
            retryLabel={t.common.retry}
            onRetry={controller.retry}
          />
        </View>
      ) : (
        <FlatList
          data={state.items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.xl,
            paddingBottom: theme.spacing.xxxl,
            gap: theme.spacing.md,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing(state)}
              onRefresh={() => void controller.refresh()}
              tintColor={theme.colors.brand}
              colors={[theme.colors.brand]}
            />
          }
          onEndReachedThreshold={0.4}
          onEndReached={controller.loadMore}
          initialNumToRender={10}
          windowSize={7}
          removeClippedSubviews
          ListEmptyComponent={
            isEmpty(state) ? <EmptyState title={emptyCopy.title} body={emptyCopy.body} /> : null
          }
          ListFooterComponent={
            isLoadingMore(state) ? (
              <View style={{ paddingVertical: theme.spacing.xl }}>
                <Loading label={t.common.loading} />
              </View>
            ) : state.loadMoreFailed ? (
              <Card variant="sunken">
                <View style={{ gap: theme.spacing.md, alignItems: 'flex-start' }}>
                  <AppText variant="caption" tone="danger">{t.queue.loadMoreFailed}</AppText>
                  <Button label={t.common.retry} variant="secondary" onPress={controller.retry} />
                </View>
              </Card>
            ) : state.items.length > 0 && !state.hasMore ? (
              <AppText
                variant="caption"
                tone="foregroundMuted"
                style={{ textAlign: 'center', paddingVertical: theme.spacing.xl }}>
                {t.queue.endOfList}
              </AppText>
            ) : null
          }
        />
      )}

      <DecisionSheet
        decision={confirming?.decision ?? null}
        strings={confirmStrings}
        busy={confirming ? pendingIds.includes(confirming.id) : false}
        onConfirm={() => void confirmDecision()}
        onCancel={() => setConfirming(null)}
      />
    </View>
  );
}
