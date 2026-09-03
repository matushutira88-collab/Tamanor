/**
 * Comment/review detail.
 *
 * Read/unread and archive are EXPLICIT actions here, matching the web product —
 * opening an item does not silently mark it read, because the web Inbox does not do
 * that either and inventing it would change a workflow people rely on.
 *
 * Every mutation is server-authoritative: the UI updates only from the canonical
 * item the server returns, so a failure can never leave the screen claiming a change
 * that did not happen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { fetchInboxItem, performInboxAction } from '@/api/inbox';
import { isSessionInvalid } from '@/api/client';
import {
  INBOX_PRIORITIES, INBOX_WORKFLOWS,
  type ApiErrorCode, type InboxActionKey, type InboxItemDetail,
  type InboxPriority, type InboxWorkflow,
} from '@/api/types';
import { useAuth } from '@/auth/auth-provider';
import { readToken } from '@/auth/session-storage';
import { useShell } from '@/shell/shell-provider';
import { markInboxStale } from '@/inbox/inbox-sync';
import {
  actionStateTone, isRatingOnlyReview, platformLabel, priorityTone, riskTone,
  shouldShowActionState, shouldShowConnector, shouldShowProcessing, workflowTone,
} from '@/inbox/presentation';
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
    default: return t.errors.server;
  }
}

export default function InboxDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { onSessionRejected } = useAuth();
  const { reload: reloadShell } = useShell();

  const [item, setItem] = useState<InboxItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [canAct, setCanAct] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const token = await readToken();
    if (!token) {
      onSessionRejected('unauthenticated');
      return;
    }
    const result = await fetchInboxItem(token, id);
    if (!mounted.current) return;
    setLoading(false);

    if (result.ok) {
      setItem(result.data.item);
      setCanAct(result.data.canAct);
      setNotFound(false);
      return;
    }
    if (isSessionInvalid(result.error)) {
      onSessionRejected(result.error);
      return;
    }
    // A foreign or deleted item is indistinguishable by design — both are "unavailable".
    if (result.error === 'invalid_request' || result.error === 'server_error') setError(result.error);
    setNotFound(result.error !== 'network' && result.error !== 'timeout' && result.error !== 'server_error');
    if (result.error === 'network' || result.error === 'timeout') setError(result.error);
  }, [id, onSessionRejected]);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback(
    async (action: InboxActionKey, value?: InboxPriority | InboxWorkflow) => {
      if (!id || busy) return;
      setBusy(true);
      setActionError(null);
      try {
        const token = await readToken();
        if (!token) {
          onSessionRejected('unauthenticated');
          return;
        }
        const result = await performInboxAction(token, id, action, value);
        if (!mounted.current) return;

        if (!result.ok) {
          if (isSessionInvalid(result.error)) {
            onSessionRejected(result.error);
            return;
          }
          // Bounded messages only — the raw server error is never rendered.
          setActionError(
            result.error === 'invalid_request' ? t.detail.noPermission : t.detail.actionFailed,
          );
          return;
        }
        // The list is a separate controller, so tell it to reconcile when the user
        // navigates back — otherwise an archived row would still be sitting there.
        markInboxStale();
        // Re-read so the detail reflects the server's canonical state (the action
        // response carries the LIST shape, which has no notes/activity).
        await load();
        if (action !== 'priority' && action !== 'workflow') void reloadShell({ refresh: true });
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [id, busy, onSessionRejected, load, reloadShell],
  );

  const openPermalink = useCallback(async () => {
    if (!item?.permalink) return;
    try {
      const supported = await Linking.canOpenURL(item.permalink);
      if (!supported) { setActionError(t.detail.openFailed); return; }
      await Linking.openURL(item.permalink);
    } catch {
      setActionError(t.detail.openFailed);
    }
  }, [item]);

  const formatDateTime = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(activeLocale, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    return (iso: string) => {
      try { return fmt.format(new Date(iso)); } catch { return ''; }
    };
  }, []);

  const title = item?.type === 'review' ? t.detail.reviewTitle : t.detail.title;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{
        paddingTop: insets.top + theme.spacing.sm,
        paddingHorizontal: theme.spacing.xl,
        paddingBottom: theme.spacing.xxxl,
        gap: theme.spacing.lg,
      }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={theme.colors.brand} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t.common.back}
          hitSlop={12}
          style={{
            minWidth: theme.sizing.minTouchTarget, minHeight: theme.sizing.minTouchTarget,
            alignItems: 'center', justifyContent: 'center',
          }}>
          <AppText variant="heading" tone="brand">←</AppText>
        </Pressable>
        <AppText variant="heading" accessibilityRole="header" style={{ flexShrink: 1 }}>
          {title}
        </AppText>
      </View>

      {loading && !item ? (
        <View accessibilityState={{ busy: true }} style={{ gap: theme.spacing.md }}>
          <SkeletonCard lines={4} />
          <SkeletonCard lines={3} />
        </View>
      ) : notFound ? (
        <EmptyState title={t.detail.notFoundTitle} body={t.detail.notFoundBody} />
      ) : error && !item ? (
        <ErrorState
          title={t.errors.title}
          message={messageFor(error)}
          retryLabel={t.common.retry}
          onRetry={() => void load()}
        />
      ) : item ? (
        <>
          {/* Content */}
          <Card>
            <View style={{ gap: theme.spacing.sm }}>
              <AppText variant="bodyStrong">{item.author ?? t.inbox.noAuthor}</AppText>
              <AppText variant="caption" tone="foregroundMuted">
                {[platformLabel(item.platform), item.account].filter(Boolean).join(' · ')}
                {' · '}
                {formatDateTime(item.createdAt)}
              </AppText>
              <Divider spacing={theme.spacing.md} />
              {item.rating !== null ? (
                <AppText variant="callout" accessibilityLabel={t.detail.rating(item.rating)}>
                  {'★'.repeat(Math.max(0, Math.min(5, item.rating)))}
                  {'☆'.repeat(Math.max(0, 5 - Math.min(5, item.rating)))}
                </AppText>
              ) : null}
              <AppText variant="body" tone={item.text ? 'foreground' : 'foregroundMuted'} selectable>
                {item.text ?? (isRatingOnlyReview(item) ? t.inbox.ratingOnly : t.inbox.ratingOnly)}
              </AppText>
              {item.permalink ? (
                <Button
                  label={t.detail.openOnPlatform}
                  variant="secondary"
                  onPress={() => void openPermalink()}
                  accessibilityHint={t.detail.openHint}
                />
              ) : null}
            </View>
          </Card>

          {/* Risk & classification */}
          <Card>
            <SectionHeader title={t.detail.classification} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              <Badge label={t.inbox.risk[item.risk]} tone={riskTone(item.risk)} />
              <Badge label={t.inbox.sentiment[item.sentiment]} tone="neutral" />
              <Badge label={t.inbox.classification[item.classification]} tone="neutral" />
              {shouldShowProcessing(item.processing) ? (
                <Badge label={t.inbox.processing[item.processing]} tone="warning" />
              ) : null}
              {shouldShowConnector(item.connectorHealth) ? (
                <Badge label={t.inbox.connector[item.connectorHealth]} tone="warning" />
              ) : null}
              {shouldShowActionState(item.actionState) ? (
                <Badge label={t.inbox.actionState[item.actionState]} tone={actionStateTone(item.actionState)} />
              ) : null}
              {item.requiresReanalysis ? <Badge label={t.detail.reanalysisNeeded} tone="warning" /> : null}
            </View>
          </Card>

          {/* Workflow + actions */}
          <Card>
            <SectionHeader title={t.detail.workflowSection} />
            <View style={{ gap: theme.spacing.lg }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                <Badge label={t.inbox.workflow[item.workflow]} tone={workflowTone(item.workflow)} />
                <Badge label={t.inbox.priority[item.priority]} tone={priorityTone(item.priority)} />
              </View>

              {!canAct ? (
                <AppText variant="caption" tone="foregroundMuted">
                  {t.detail.noPermission}
                </AppText>
              ) : (
                <>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                    <Button
                      label={item.isRead ? t.detail.markUnread : t.detail.markRead}
                      variant="secondary"
                      busy={busy}
                      disabled={busy}
                      onPress={() => void act(item.isRead ? 'unread' : 'read')}
                    />
                    <Button
                      label={item.archived ? t.detail.unarchive : t.detail.archive}
                      variant="secondary"
                      busy={busy}
                      disabled={busy}
                      onPress={() => void act(item.archived ? 'unarchive' : 'archive')}
                    />
                  </View>
                  <AppText variant="caption" tone="foregroundMuted">
                    {t.detail.archiveNote}
                  </AppText>

                  <OptionRow
                    label={t.detail.setPriority}
                    options={INBOX_PRIORITIES.map((p) => ({ value: p, label: t.inbox.priority[p] }))}
                    selected={item.priority}
                    disabled={busy}
                    onSelect={(v) => void act('priority', v as InboxPriority)}
                  />
                  <OptionRow
                    label={t.detail.setWorkflow}
                    options={INBOX_WORKFLOWS.map((w) => ({ value: w, label: t.inbox.workflow[w] }))}
                    selected={item.workflow}
                    disabled={busy}
                    onSelect={(v) => void act('workflow', v as InboxWorkflow)}
                  />
                </>
              )}

              {actionError ? (
                <View accessibilityRole="alert">
                  <AppText variant="caption" tone="danger">{actionError}</AppText>
                </View>
              ) : null}
            </View>
          </Card>

          {/* Notes */}
          {item.notes.length > 0 ? (
            <Card>
              <SectionHeader title={t.detail.notes} />
              <View style={{ gap: theme.spacing.md }}>
                {item.notes.map((note) => (
                  <View key={note.id} style={{ gap: 2 }}>
                    <AppText variant="callout">{note.body}</AppText>
                    <AppText variant="caption" tone="foregroundMuted">
                      {[note.authorName, formatDateTime(note.createdAt)].filter(Boolean).join(' · ')}
                    </AppText>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}

          {/* Activity */}
          {item.activity.length > 0 ? (
            <Card>
              <SectionHeader title={t.detail.activity} />
              <View style={{ gap: theme.spacing.md }}>
                {item.activity.map((event) => (
                  <View key={event.id} style={{ gap: 2 }}>
                    {/* Bounded event keys only — an unknown one never reaches here. */}
                    <AppText variant="callout">{t.audit[event.event] ?? event.event}</AppText>
                    <AppText variant="caption" tone="foregroundMuted">
                      {formatDateTime(event.at)}
                    </AppText>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

function OptionRow({
  label, options, selected, disabled, onSelect,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string;
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <AppText variant="caption" tone="foregroundMuted" accessibilityRole="header">
        {label}
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {options.map((option) => {
          const active = option.value === selected;
          return (
            <Pressable
              key={option.value}
              onPress={() => !active && onSelect(option.value)}
              disabled={disabled || active}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled }}
              accessibilityLabel={`${label}: ${option.label}`}
              style={{
                minHeight: theme.sizing.minTouchTarget,
                justifyContent: 'center',
                paddingHorizontal: theme.spacing.lg,
                borderRadius: theme.radius.pill,
                borderWidth: 1,
                borderColor: active ? theme.colors.brand : theme.colors.border,
                backgroundColor: active ? theme.colors.brandSoft : theme.colors.surface,
                opacity: disabled ? 0.5 : 1,
              }}>
              <AppText variant="caption" tone={active ? 'brand' : 'foreground'}>
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
