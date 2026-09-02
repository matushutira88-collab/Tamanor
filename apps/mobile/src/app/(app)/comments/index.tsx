/**
 * Inbox — the real comment/review feed.
 *
 * A virtualized `FlatList` (never nested in a same-direction ScrollView), fed by
 * `useInboxController`: server-side filters and search, keyset pagination, and
 * mutation reconciliation. Nothing is filtered or searched on the device.
 */

import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { INBOX_VIEWS, type InboxItem, type InboxView } from '@/api/types';
import { fetchInboxOptions } from '@/api/inbox';
import { readToken } from '@/auth/session-storage';
import { useShell } from '@/shell/shell-provider';
import { useInboxController } from '@/inbox/use-inbox';
import {
  activeFilterCount, isBlockingError, isEmpty, isFilteredEmpty, isFirstLoad, isLoadingMore,
  isRefreshing,
} from '@/inbox/inbox-state';
import { InboxRow } from '@/components/inbox/inbox-row';
import { FilterSheet } from '@/components/inbox/filter-sheet';
import { consumeInboxStale } from '@/inbox/inbox-sync';
import { AppHeader } from '@/components/shell/app-header';
import {
  AppText, Badge, Button, Card, EmptyState, ErrorState, Loading, SkeletonCard,
} from '@/components/ui';
import { activeLocale, t } from '@/i18n';
import { useTheme } from '@/theme';
import type { ApiErrorCode } from '@/api/types';
import { useEffect } from 'react';

/** One fixed sentence per bounded code — never raw server text. */
function messageFor(error: ApiErrorCode): string {
  switch (error) {
    case 'network': return t.errors.network;
    case 'timeout': return t.errors.timeout;
    case 'config': return t.errors.config;
    default: return t.errors.server;
  }
}

export default function InboxScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { bootstrap } = useShell();
  const controller = useInboxController();
  const { state, filters, searchText, setSearchText, setFilters, setView } = controller;

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [platforms, setPlatforms] = useState<string[]>([]);

  // Filter options are small and stable — fetched once, not per page.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await readToken();
      if (!token) return;
      const result = await fetchInboxOptions(token);
      if (!cancelled && result.ok) setPlatforms(result.data.options.platforms);
    })();
    return () => { cancelled = true; };
  }, []);

  const formatTime = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(activeLocale, { day: 'numeric', month: 'short' });
    return (iso: string) => {
      try { return fmt.format(new Date(iso)); } catch { return ''; }
    };
  }, []);

  const openItem = useCallback((id: string) => router.push(`/comments/${id}`), [router]);

  // Returning from a detail screen where something was mutated: reconcile once.
  // A focus with no intervening change costs no request.
  useFocusEffect(
    useCallback(() => {
      if (consumeInboxStale()) void controller.refresh();
    }, [controller]),
  );

  const renderItem = useCallback(
    ({ item }: { item: InboxItem }) => (
      <InboxRow
        item={item}
        timestamp={formatTime(item.createdAt)}
        onPress={openItem}
        strings={{
          risk: t.inbox.risk[item.risk],
          workflow: t.inbox.workflow[item.workflow],
          priority: t.inbox.priority[item.priority] ?? null,
          actionState: t.inbox.actionState[item.actionState] ?? null,
          processing: t.inbox.processing[item.processing] ?? null,
          connector: t.inbox.connector[item.connectorHealth] ?? null,
          ratingOnly: t.inbox.ratingOnly,
          noAuthor: t.inbox.noAuthor,
          unread: t.inbox.views.unread,
        }}
      />
    ),
    [formatTime, openItem],
  );

  const emptyCopy = useMemo(() => {
    if (searchText.trim() || filters.q) return { title: t.inbox.empty.searchTitle, body: t.inbox.empty.searchBody };
    if (isFilteredEmpty(filters)) return { title: t.inbox.empty.filterTitle, body: t.inbox.empty.filterBody };
    switch (filters.view) {
      case 'unread': return { title: t.inbox.empty.unreadTitle, body: t.inbox.empty.unreadBody };
      case 'archived': return { title: t.inbox.empty.archivedTitle, body: t.inbox.empty.archivedBody };
      case 'assigned_me': return { title: t.inbox.empty.assignedTitle, body: t.inbox.empty.assignedBody };
      case 'unassigned': return { title: t.inbox.empty.unassignedTitle, body: t.inbox.empty.unassignedBody };
      default: return { title: t.inbox.empty.defaultTitle, body: t.inbox.empty.defaultBody };
    }
  }, [filters, searchText]);

  const filterCount = activeFilterCount(filters);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: theme.spacing.xl }}>
        <AppHeader title={t.inbox.title} workspaceName={bootstrap?.workspace.name} />

        {/* Search */}
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder={t.inbox.searchPlaceholder}
              placeholderTextColor={theme.colors.foregroundMuted}
              accessibilityLabel={t.inbox.searchPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={{
                minHeight: theme.sizing.minTouchTarget,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface,
                color: theme.colors.foreground,
                paddingHorizontal: theme.spacing.lg,
                paddingRight: searchText ? theme.spacing.xxxl : theme.spacing.lg,
                ...theme.textStyle('callout'),
              }}
            />
            {searchText ? (
              <Pressable
                onPress={() => setSearchText('')}
                accessibilityRole="button"
                accessibilityLabel={t.inbox.clearSearch}
                style={{
                  position: 'absolute', right: 0, top: 0, bottom: 0,
                  minWidth: theme.sizing.minTouchTarget,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                <AppText variant="caption" tone="brand">✕</AppText>
              </Pressable>
            ) : null}
          </View>

          <Pressable
            onPress={() => setFiltersOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t.inbox.filtersA11y}
            accessibilityState={{ expanded: filtersOpen }}
            style={{
              minHeight: theme.sizing.minTouchTarget,
              minWidth: theme.sizing.minTouchTarget,
              paddingHorizontal: theme.spacing.lg,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1,
              borderColor: filterCount > 0 ? theme.colors.brand : theme.colors.border,
              backgroundColor: filterCount > 0 ? theme.colors.brandSoft : theme.colors.surface,
              borderRadius: theme.radius.md,
            }}>
            <AppText variant="caption" tone={filterCount > 0 ? 'brand' : 'foreground'}>
              {filterCount > 0 ? `${t.inbox.filters} (${filterCount})` : t.inbox.filters}
            </AppText>
          </Pressable>
        </View>

        {/* Quick views */}
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={INBOX_VIEWS as readonly InboxView[]}
          keyExtractor={(v) => v}
          contentContainerStyle={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.md }}
          renderItem={({ item: view }) => {
            const active = filters.view === view;
            return (
              <Pressable
                onPress={() => setView(view)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t.inbox.views[view]}
                style={{
                  minHeight: theme.sizing.minTouchTarget,
                  justifyContent: 'center',
                  paddingHorizontal: theme.spacing.lg,
                  borderRadius: theme.radius.pill,
                  backgroundColor: active ? theme.colors.brand : theme.colors.surface,
                  borderWidth: 1,
                  borderColor: active ? theme.colors.brand : theme.colors.border,
                }}>
                <AppText variant="caption" style={{ color: active ? theme.colors.brandOn : theme.colors.foreground }}>
                  {t.inbox.views[view]}
                </AppText>
              </Pressable>
            );
          }}
        />

        {state.counts ? (
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, paddingBottom: theme.spacing.md }}>
            <Badge label={t.inbox.totalCount(state.counts.total)} tone="neutral" />
            {state.counts.unread > 0 ? (
              <Badge label={t.inbox.unreadCount(state.counts.unread)} tone="brand" />
            ) : null}
          </View>
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
          // Bounded rendering — the list may hold hundreds of rows.
          initialNumToRender={10}
          windowSize={7}
          removeClippedSubviews
          ListEmptyComponent={
            isEmpty(state) ? (
              <EmptyState
                title={emptyCopy.title}
                body={emptyCopy.body}
                action={
                  filterCount > 0 ? (
                    <Button
                      label={t.inbox.clearFilters}
                      variant="secondary"
                      onPress={() => setFilters({ ...filters, ...clearedAdvanced() })}
                    />
                  ) : undefined
                }
              />
            ) : null
          }
          ListFooterComponent={
            isLoadingMore(state) ? (
              <View style={{ paddingVertical: theme.spacing.xl }}>
                <Loading label={t.common.loading} />
              </View>
            ) : state.loadMoreFailed ? (
              <Card variant="sunken">
                <View style={{ gap: theme.spacing.md, alignItems: 'flex-start' }}>
                  <AppText variant="caption" tone="danger">
                    {t.inbox.loadMoreFailed}
                  </AppText>
                  <Button label={t.common.retry} variant="secondary" onPress={controller.retry} />
                </View>
              </Card>
            ) : state.items.length > 0 && !state.hasMore ? (
              <AppText
                variant="caption"
                tone="foregroundMuted"
                style={{ textAlign: 'center', paddingVertical: theme.spacing.xl }}>
                {t.inbox.endOfList}
              </AppText>
            ) : null
          }
        />
      )}

      <FilterSheet
        visible={filtersOpen}
        filters={filters}
        platforms={platforms}
        onApply={setFilters}
        onClose={() => setFiltersOpen(false)}
      />
    </View>
  );
}

/** The advanced narrowings, reset to "not applied". View and search are preserved. */
function clearedAdvanced() {
  return {
    range: 'all' as const, type: null, sentiment: null, workflow: null,
    priority: null, risk: null, provider: null, label: null, assignee: null,
  };
}
