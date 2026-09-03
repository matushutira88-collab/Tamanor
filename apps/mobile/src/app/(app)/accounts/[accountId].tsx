/**
 * Connected account detail.
 *
 * Answers, in order, the questions the M6 quality bar asks: which account is this,
 * is it connected, is Tamanor monitoring it, is automatic sync actually working,
 * when did a sync last succeed, can I sync now, do I need to reconnect, what can
 * Tamanor actually do — and what happens if I disconnect.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * FOUR SEPARATE SECTIONS FOR FOUR SEPARATE TRUTHS: Connection, Monitoring,
 * Synchronization and "What Tamanor can do". They are never merged, and only the
 * connection section may render a success tone.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * WRITE ACTIONS: monitoring on/off, a manual READ-ONLY sync, and disconnect. There
 * is no moderation control, no kill-switch mutation, and no native OAuth — the
 * reconnect CTA is the safe web hand-off.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  disconnectAccount as apiDisconnect, fetchAccount, setAccountMonitoring, startAccountSync,
} from '@/api/accounts';
import { isSessionInvalid } from '@/api/client';
import type {
  AccountCapabilities, ApiErrorCode, CapabilityState, ConnectedAccountDetail, SyncRunItem,
} from '@/api/types';
import { useAuth } from '@/auth/auth-provider';
import { readToken } from '@/auth/session-storage';
import { useShell } from '@/shell/shell-provider';
import { markAccountsStale } from '@/accounts/accounts-sync';
import {
  autoSyncTone, canToggleMonitoring, canTriggerSync, capabilityTone, connectionTone,
  displayPlatform, firstSyncTone, monitoringTone, shouldOfferReconnect, shouldShowCapability,
  syncRunTone, tokenHealthTone,
} from '@/accounts/presentation';
import { DisconnectSheet } from '@/components/accounts/disconnect-sheet';
import { WebConnectNotice } from '@/components/accounts/web-connect-notice';
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
    case 'permission_denied': return t.accounts.noPermission;
    case 'read_only': return t.accounts.readOnlyNotice;
    case 'account_limit_reached': return t.accounts.monitoringLimitReached;
    case 'not_found': return t.accounts.notFoundBody;
    default: return t.errors.server;
  }
}

/** The capability rows, in the order an operator would ask about them. */
const CAPABILITY_ORDER: (keyof AccountCapabilities)[] = [
  'canRead', 'canSync', 'canMonitor', 'moderationState', 'replyState', 'canReconnect', 'canDisconnect',
];

export default function AccountDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  const { onSessionRejected } = useAuth();
  const { reload: reloadShell } = useShell();

  const [account, setAccount] = useState<ConnectedAccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clusterCount, setClusterCount] = useState<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(
    async (mode: 'first' | 'refresh' = 'first') => {
      if (!accountId) return;
      if (mode === 'refresh') setRefreshing(true); else setLoading(true);
      setError(null);

      const token = await readToken();
      if (!token) {
        onSessionRejected('unauthenticated');
        return;
      }
      const result = await fetchAccount(token, accountId);
      if (!mounted.current) return;
      setLoading(false);
      setRefreshing(false);

      if (result.ok) {
        setAccount(result.data.account);
        setCanManage(result.data.capabilities.canManageConnectors);
        setNotFound(false);
        return;
      }
      if (isSessionInvalid(result.error)) {
        onSessionRejected(result.error);
        return;
      }
      // A foreign, missing or forbidden account is ONE indistinguishable outcome — the
      // screen must never confirm that some other tenant's id exists.
      if (result.error === 'network' || result.error === 'timeout' || result.error === 'server_error') {
        setError(result.error);
      } else {
        setNotFound(true);
      }
    },
    [accountId, onSessionRejected],
  );

  useEffect(() => { void load('first'); }, [load]);

  /** Run one mutation, guarding a double submit and never guessing the result. */
  const mutate = useCallback(
    async <T,>(run: (token: string) => Promise<{ ok: true; data: T } | { ok: false; error: ApiErrorCode }>): Promise<T | null> => {
      if (!accountId || busy) return null;
      setBusy(true);
      setNotice(null);
      try {
        const token = await readToken();
        if (!token) {
          onSessionRejected('unauthenticated');
          return null;
        }
        const result = await run(token);
        if (!mounted.current) return null;
        if (!result.ok) {
          if (isSessionInvalid(result.error)) {
            onSessionRejected(result.error);
            return null;
          }
          setNotice(messageFor(result.error));
          // Another operator changed the account: resync rather than guess.
          if (result.error === 'not_found') {
            markAccountsStale();
            setNotFound(true);
          }
          return null;
        }
        return result.data;
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [accountId, busy, onSessionRejected],
  );

  const onToggleMonitoring = useCallback(
    async (enabled: boolean) => {
      const data = await mutate((token) => setAccountMonitoring(token, accountId!, enabled));
      if (!data) return;
      // Adopt the SERVER's resulting account, never the requested value.
      setAccount((prev) => (prev ? { ...prev, ...data.account } : prev));
      markAccountsStale();
      // Monitored usage changed, so the shell's capacity counters must reconcile.
      void reloadShell({ refresh: true });
    },
    [mutate, accountId, reloadShell],
  );

  const onSyncNow = useCallback(async () => {
    const data = await mutate((token) => startAccountSync(token, accountId!));
    if (!data) return;
    // A bounded key: `started` means started. No completion is fabricated and no
    // polling loop is begun — the user pulls to refresh.
    setNotice(t.accounts.syncResult[data.result]);
    if (data.result === 'started') markAccountsStale();
  }, [mutate, accountId]);

  const onDisconnect = useCallback(async () => {
    const data = await mutate((token) => apiDisconnect(token, accountId!));
    setConfirming(false);
    if (!data) return;
    markAccountsStale();
    setClusterCount(data.clusterCount);
    // Truthful post-disconnect guidance: when the provider cannot revoke its own
    // authorization, say so rather than implying a complete removal.
    setNotice([
      t.accounts.disconnectResult.done,
      data.clusterCount > 1 ? t.accounts.disconnectResult.clusterAffected(data.clusterCount) : null,
      data.manualCleanupRecommended ? t.accounts.disconnectResult.manualCleanup : null,
    ].filter(Boolean).join(' '));
    void reloadShell({ refresh: true });
    void load('refresh');
  }, [mutate, accountId, reloadShell, load]);

  const formatDateTime = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(activeLocale, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    return (iso: string | null) => {
      if (!iso) return null;
      try { return fmt.format(new Date(iso)); } catch { return null; }
    };
  }, []);

  /* ---------------------------------------------------------------- states */

  if (loading && !account) {
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
          title={t.accounts.notFoundTitle}
          body={t.accounts.notFoundBody}
          action={<Button label={t.common.back} variant="secondary" onPress={() => router.back()} />}
        />
      </View>
    );
  }

  if (!account) {
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

  const platform = displayPlatform(account);
  const lastSuccess = formatDateTime(account.lastSuccessfulSyncAt);
  const lastAttempt = formatDateTime(account.lastAttemptAt);
  const monitoringToggleable = canManage && canToggleMonitoring(account) && !busy;
  const syncable = canManage && canTriggerSync(account);
  const offerReconnect = shouldOfferReconnect(account);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
      <View
        style={{
          flexDirection: 'row', alignItems: 'center',
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
        {/* -------------------------------------------------- Identity */}
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="title" accessibilityRole="header">
              {account.name ?? platform}
            </AppText>
            <AppText variant="caption" tone="foregroundMuted">
              {[platform, account.username, account.brandName].filter(Boolean).join(' · ')}
            </AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
              <Badge label={t.accounts.accountKind[account.accountKind]} tone="neutral" />
              {account.protectionPaused ? (
                <Badge label={t.accounts.protectionPaused} tone="warning" />
              ) : null}
            </View>
          </View>
        </Card>

        {notice ? (
          <AppText variant="callout" tone="brand" accessibilityLiveRegion="polite">{notice}</AppText>
        ) : null}

        {/* -------------------------------------------------- TRUTH 1: Connection */}
        <SectionHeader title={t.accounts.sections.connection} />
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            <Badge
              label={t.accounts.connection[account.connectionState]}
              tone={connectionTone(account.connectionState)}
            />
            {account.reason ? (
              <AppText variant="callout" tone="danger">{t.accounts.reason[account.reason]}</AppText>
            ) : null}
            <Row label={t.accounts.tokenHealthLabel} value={t.accounts.tokenHealth[account.tokenHealth]}
                 tone={tokenHealthTone(account.tokenHealth)} />
            {account.tokenExpiresAt ? (
              <Row label={t.accounts.tokenExpires} value={formatDateTime(account.tokenExpiresAt) ?? '—'} />
            ) : null}
            {account.lastSuccessfulProviderCheckAt ? (
              <Row label={t.accounts.lastProviderCheck}
                   value={formatDateTime(account.lastSuccessfulProviderCheckAt) ?? '—'} />
            ) : null}
          </View>
        </Card>

        {/* The reconnect hand-off, shown only when the connection actually needs it. */}
        {offerReconnect ? (
          <WebConnectNotice
            target="manage"
            accountId={account.id}
            strings={{
              title: t.accounts.webHandoff.reconnectTitle,
              body: t.accounts.webHandoff.reconnectBody,
              open: t.accounts.actions.reconnect,
              unavailable: t.accounts.webHandoff.unavailable,
              notConfigured: t.accounts.webHandoff.notConfigured,
            }}
          />
        ) : null}

        {/* -------------------------------------------------- TRUTH 2: Monitoring */}
        <SectionHeader title={t.accounts.sections.monitoring} />
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md }}>
              <View style={{ flexShrink: 1, gap: theme.spacing.xxs }}>
                <AppText variant="bodyStrong">{t.accounts.monitoringLabel}</AppText>
                <AppText variant="caption" tone="foregroundMuted">
                  {account.monitoringEnabled ? t.accounts.monitoringOn : t.accounts.monitoringOff}
                </AppText>
              </View>
              <Switch
                value={account.monitoringEnabled}
                disabled={!monitoringToggleable}
                onValueChange={(v) => void onToggleMonitoring(v)}
                accessibilityLabel={t.accounts.monitoringLabel}
                accessibilityHint={t.accounts.monitoringMeaning}
                accessibilityState={{ checked: account.monitoringEnabled, disabled: !monitoringToggleable }}
                trackColor={{ true: theme.colors.brand, false: theme.colors.border }}
              />
            </View>
            {/* The sentence that stops monitoring reading as "connected and moderating". */}
            <AppText variant="caption" tone="foregroundMuted">{t.accounts.monitoringMeaning}</AppText>
            {!account.monitoringEnabled && !account.monitoringCanBeEnabled ? (
              <AppText variant="caption" tone="warning">{t.accounts.monitoringLimitReached}</AppText>
            ) : null}
            {!canManage ? (
              <AppText variant="caption" tone="foregroundMuted">{t.accounts.noPermission}</AppText>
            ) : null}
          </View>
        </Card>

        {/* -------------------------------------------------- TRUTH 3: Sync */}
        <SectionHeader title={t.accounts.sections.sync} />
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
              <Badge
                label={`${t.accounts.autoSyncLabel}: ${t.accounts.autoSync[account.autoSyncState]}`}
                tone={autoSyncTone(account.autoSyncState)}
              />
              <Badge
                label={`${t.accounts.firstSyncLabel}: ${t.accounts.firstSync[account.firstSyncState]}`}
                tone={firstSyncTone(account.firstSyncState)}
              />
            </View>
            <Row label={t.accounts.lastSuccessfulSync} value={lastSuccess ?? t.accounts.neverSynced} />
            {lastAttempt ? <Row label={t.accounts.lastAttempt} value={lastAttempt} /> : null}
            <Row label={t.accounts.commentsToday} value={String(account.commentsToday)} />
            <Row label={t.accounts.riskToday} value={String(account.riskToday)} />

            {canManage ? (
              <Button
                label={busy ? t.accounts.actions.syncing : t.accounts.actions.syncNow}
                variant="secondary"
                disabled={!syncable || busy}
                onPress={() => void onSyncNow()}
                accessibilityHint={t.accounts.capability.canSync}
              />
            ) : null}
            {canManage && !syncable ? (
              <AppText variant="caption" tone="foregroundMuted">
                {t.accounts.capabilityState[account.capabilities.canSync]}
              </AppText>
            ) : null}
          </View>
        </Card>

        {/* -------------------------------------------------- TRUTH 4: Capabilities */}
        <SectionHeader title={t.accounts.sections.permissions} />
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            {CAPABILITY_ORDER.filter((k) => shouldShowCapability(account.capabilities[k])).map((key) => (
              <Row
                key={key}
                label={t.accounts.capability[key]}
                value={t.accounts.capabilityState[account.capabilities[key]]}
                tone={capabilityTone(account.capabilities[key] as CapabilityState)}
              />
            ))}
          </View>
        </Card>

        {/* -------------------------------------------------- Sync history */}
        <SectionHeader title={t.accounts.sections.activity} />
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            {account.syncRuns.length === 0 ? (
              <AppText variant="callout" tone="foregroundMuted">{t.accounts.syncRun.none}</AppText>
            ) : (
              account.syncRuns.map((run, i) => (
                <View key={run.id} style={{ gap: theme.spacing.xxs }}>
                  <SyncRunLine run={run} formatDateTime={formatDateTime} />
                  {i < account.syncRuns.length - 1 ? <Divider spacing={theme.spacing.xs} /> : null}
                </View>
              ))
            )}
          </View>
        </Card>

        {/* -------------------------------------------------- Disconnect */}
        {canManage && account.capabilities.canDisconnect === 'available' ? (
          <>
            <SectionHeader title={t.accounts.sections.danger} />
            <Card variant="sunken">
              <View style={{ gap: theme.spacing.md, alignItems: 'flex-start' }}>
                <AppText variant="callout" tone="foregroundMuted">
                  {t.accounts.disconnectConfirm.publicNotice}
                </AppText>
                <Button
                  label={t.accounts.actions.disconnect}
                  variant="danger"
                  disabled={busy}
                  onPress={() => setConfirming(true)}
                  accessibilityHint={t.accounts.disconnectConfirm.body}
                />
              </View>
            </Card>
          </>
        ) : null}
      </ScrollView>

      <DisconnectSheet
        visible={confirming}
        busy={busy}
        onConfirm={() => void onDisconnect()}
        onCancel={() => setConfirming(false)}
        strings={{
          title: t.accounts.disconnectConfirm.title,
          body: t.accounts.disconnectConfirm.body,
          publicNotice: t.accounts.disconnectConfirm.publicNotice,
          // Only shown when a PREVIOUS disconnect told us the credentials are shared —
          // the canonical API offers no safe pre-flight, so none is invented.
          clusterNotice: clusterCount !== null && clusterCount > 1
            ? t.accounts.disconnectConfirm.clusterNotice(clusterCount)
            : null,
          confirm: t.accounts.actions.disconnect,
          cancel: t.accounts.actions.cancel,
        }}
      />
    </View>
  );
}

/** One sync run: status, counts and when — never a provider body or a raw error. */
function SyncRunLine({
  run, formatDateTime,
}: { run: SyncRunItem; formatDateTime: (iso: string | null) => string | null }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xxs }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
        <Badge label={t.accounts.syncRun.status[run.status]} tone={syncRunTone(run.status)} />
        {run.demo ? <Badge label={t.accounts.syncRun.demo} tone="neutral" /> : null}
      </View>
      {run.reason ? (
        <AppText variant="caption" tone="foregroundMuted">{t.accounts.reason[run.reason]}</AppText>
      ) : null}
      <AppText variant="caption" tone="foregroundMuted">
        {[
          formatDateTime(run.startedAt),
          run.fetched > 0 ? t.accounts.syncRun.fetched(run.fetched) : null,
          run.created > 0 ? t.accounts.syncRun.created(run.created) : null,
        ].filter(Boolean).join(' · ')}
      </AppText>
    </View>
  );
}

/** A label/value pair, so the detail sections read consistently. */
function Row({ label, value, tone }: { label: string; value: string; tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md }}>
      <AppText variant="caption" tone="foregroundMuted">{label}</AppText>
      <AppText
        variant="caption"
        tone={tone === 'neutral' || tone === undefined ? 'foreground' : tone}
        style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </AppText>
    </View>
  );
}
