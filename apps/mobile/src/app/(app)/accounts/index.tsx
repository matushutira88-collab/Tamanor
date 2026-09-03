/**
 * Accounts — the real connected-accounts screen.
 *
 * Replaces the M3 placeholder. A `FlatList` fed by `useAccountsController`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * FOUR SEPARATE TRUTHS. Every row shows connection health, monitoring and auto-sync
 * as three independently-toned, independently-labelled badges; the capability matrix
 * lives on the detail screen. Nothing on this screen combines them, and only the
 * connection badge may be green.
 *
 * The quick filter is client-side, which is safe here and NOT in the Inbox: this is
 * a bounded management list that the server already returns in full, and every
 * filter reads a bounded server-supplied field.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import type { ApiErrorCode, ConnectedAccountItem } from '@/api/types';
import { useShell } from '@/shell/shell-provider';
import { useAccountsController } from '@/accounts/use-accounts';
import {
  ACCOUNT_FILTERS, isBlockingError, isEmpty, isFilteredEmpty, isFirstLoad, isRefreshing,
  type AccountFilter,
} from '@/accounts/accounts-state';
import { consumeAccountsStale } from '@/accounts/accounts-sync';
import { AccountRow } from '@/components/accounts/account-row';
import { AppHeader } from '@/components/shell/app-header';
import {
  AppText, Badge, Button, EmptyState, ErrorState, SkeletonCard,
} from '@/components/ui';
import { activeLocale, t } from '@/i18n';
import { useTheme } from '@/theme';

/** One fixed sentence per bounded code — never raw server text. */
function messageFor(error: ApiErrorCode): string {
  switch (error) {
    case 'network': return t.errors.network;
    case 'timeout': return t.errors.timeout;
    case 'config': return t.errors.config;
    case 'permission_denied': return t.accounts.noPermission;
    case 'read_only': return t.accounts.readOnlyNotice;
    case 'not_found': return t.accounts.notFoundBody;
    case 'rate_limited': return t.errors.server;
    default: return t.errors.server;
  }
}

export default function AccountsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { bootstrap } = useShell();
  const controller = useAccountsController();
  const { state, visible, counts } = controller;

  const formatDate = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(activeLocale, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    return (iso: string | null) => {
      if (!iso) return null;
      try { return fmt.format(new Date(iso)); } catch { return null; }
    };
  }, []);

  const openAccount = useCallback((id: string) => router.push(`/accounts/${id}`), [router]);

  // Returning from a detail screen where something was mutated: reconcile once.
  useFocusEffect(
    useCallback(() => {
      if (consumeAccountsStale()) void controller.refresh();
    }, [controller]),
  );

  const renderItem = useCallback(
    ({ item }: { item: ConnectedAccountItem }) => {
      const last = formatDate(item.lastSuccessfulSyncAt);
      return (
        <AccountRow
          account={item}
          onPress={openAccount}
          strings={{
            connection: t.accounts.connection[item.connectionState],
            monitoringLabel: t.accounts.monitoringLabel,
            monitoringValue: item.monitoringEnabled ? t.accounts.monitoringOn : t.accounts.monitoringOff,
            autoSyncLabel: t.accounts.autoSyncLabel,
            autoSyncValue: t.accounts.autoSync[item.autoSyncState],
            lastSync: last
              ? `${t.accounts.lastSuccessfulSync}: ${last}`
              : t.accounts.neverSynced,
            metrics: item.commentsToday > 0 || item.riskToday > 0
              ? `${t.accounts.commentsToday}: ${item.commentsToday} · ${t.accounts.riskToday}: ${item.riskToday}`
              : null,
            reason: item.reason ? t.accounts.reason[item.reason] : null,
            attention: t.accounts.filters.attention,
          }}
        />
      );
    },
    [formatDate, openAccount],
  );

  const capacity = state.capacity;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: theme.spacing.xl }}>
        <AppHeader title={t.accounts.title} workspaceName={bootstrap?.workspace.name} />

        {/* Compact summary: how many, how much of the plan, how many are unhealthy. */}
        {capacity ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs, paddingBottom: theme.spacing.md }}>
            <Badge label={t.accounts.connectedCount(state.accounts.length)} tone="neutral" />
            <Badge label={t.accounts.monitoringUsage(capacity.monitored, capacity.limit)} tone="neutral" />
            {state.needsAttention > 0 ? (
              <Badge label={t.accounts.needsAttention(state.needsAttention)} tone="danger" />
            ) : state.accounts.length > 0 ? (
              <Badge label={t.accounts.allHealthy} tone="success" />
            ) : null}
          </View>
        ) : null}

        {/* Quick filters. Bounded, client-side over an already-complete list. */}
        {state.accounts.length > 0 ? (
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={ACCOUNT_FILTERS as readonly AccountFilter[]}
            keyExtractor={(f) => f}
            contentContainerStyle={{ gap: theme.spacing.sm, paddingBottom: theme.spacing.md }}
            renderItem={({ item: key }) => {
              const active = state.filter === key;
              const count = counts[key];
              const label = t.accounts.filters[key];
              return (
                <Pressable
                  onPress={() => controller.setFilter(key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${label}, ${count}`}
                  style={{
                    minHeight: theme.sizing.minTouchTarget,
                    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs,
                    paddingHorizontal: theme.spacing.lg,
                    borderRadius: theme.radius.pill,
                    backgroundColor: active ? theme.colors.brand : theme.colors.surface,
                    borderWidth: 1,
                    borderColor: active ? theme.colors.brand : theme.colors.border,
                  }}>
                  <AppText variant="caption" style={{ color: active ? theme.colors.brandOn : theme.colors.foreground }}>
                    {label}
                  </AppText>
                  <AppText
                    variant="caption"
                    style={{ color: active ? theme.colors.brandOn : theme.colors.foregroundMuted }}>
                    {count}
                  </AppText>
                </Pressable>
              );
            }}
          />
        ) : null}

        {/* A viewer can browse but must not see an active management control. */}
        {state.phase === 'ready' && !state.canManage ? (
          <View style={{ paddingBottom: theme.spacing.md }}>
            <Badge label={t.accounts.noPermission} tone="neutral" />
          </View>
        ) : null}
      </View>

      {isFirstLoad(state) ? (
        <View
          accessibilityLabel={t.common.loading}
          accessibilityState={{ busy: true }}
          style={{ paddingHorizontal: theme.spacing.xl, gap: theme.spacing.md }}>
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
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
          data={visible}
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
          ListEmptyComponent={
            isFilteredEmpty(state) ? (
              <EmptyState
                title={t.accounts.empty.filterTitle}
                body={t.accounts.empty.filterBody}
                action={
                  <Button
                    label={t.accounts.empty.clearFilter}
                    variant="secondary"
                    onPress={() => controller.setFilter('all')}
                  />
                }
              />
            ) : isEmpty(state) ? (
              <EmptyState
                title={t.accounts.empty.title}
                body={state.canManage ? t.accounts.empty.body : t.accounts.empty.viewerBody}
              />
            ) : null
          }
          // The Connect hand-off lives at the END of the list so it is reachable from
          // both the empty state and a populated one, and only for a role that may use it.
          // M7 — the Connect CTA now starts a NATIVE OAuth flow. The M6 "manage on
          // the web" hand-off is gone: the phone is already an authenticated Tamanor
          // client, so it never sends the user to a browser to log in again.
          ListFooterComponent={
            state.phase === 'ready' && state.canManage ? (
              <View style={{ paddingTop: theme.spacing.lg }}>
                <Button
                  label={t.accounts.actions.connect}
                  variant="primary"
                  block
                  onPress={() => router.push('/accounts/connect')}
                />
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}
