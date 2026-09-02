/**
 * Overview — the Business dashboard.
 *
 * Every number here is computed SERVER-side and arrives as one aggregated DTO. The
 * screen never loads comments to derive a KPI, never recomputes a protection score,
 * and never invents a delta.
 *
 * Load behaviour:
 *   first load        → skeleton
 *   timeframe change  → new request; a stale response cannot overwrite a newer one
 *   pull-to-refresh   → existing content stays on screen while refreshing
 *   401/403           → handed to the M2 auth machine, never handled locally
 *   network / server  → truthful error with a retry, never demo data
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchDashboard } from '@/api/shell';
import { isSessionInvalid } from '@/api/client';
import {
  TIMEFRAMES,
  type AccessBanner as AccessBannerKind,
  type ApiErrorCode,
  type Dashboard,
  type Timeframe,
} from '@/api/types';
import { readToken } from '@/auth/session-storage';
import { useAuth } from '@/auth/auth-provider';
import { useShell } from '@/shell/shell-provider';
import {
  createRequestTracker, initialQueryState, isBlockingError, isInitialLoad, isRefreshing,
  queryReducer,
} from '@/data/query';
import { AppHeader } from '@/components/shell/app-header';
import { AccountSummaryCard } from '@/components/dashboard/account-summary-card';
import { ActivityRow } from '@/components/dashboard/activity-row';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { ProtectionSummary } from '@/components/dashboard/protection-summary';
import { TrendChart } from '@/components/dashboard/trend-chart';
import {
  AppText, Badge, Button, Card, EmptyState, ErrorState, SectionHeader, SkeletonCard,
} from '@/components/ui';
import { activeLocale, t } from '@/i18n';
import { useTheme } from '@/theme';

/** One fixed sentence per bounded error code — never raw server text. */
function messageFor(error: ApiErrorCode): string {
  switch (error) {
    case 'network': return t.errors.network;
    case 'timeout': return t.errors.timeout;
    case 'config': return t.errors.config;
    case 'invalid_request': return t.errors.forbidden;
    default: return t.errors.server;
  }
}

export default function OverviewScreen() {
  const theme = useTheme();
  // Applied manually rather than via `Screen`: this route owns a ScrollView so the
  // RefreshControl attaches to the scroller itself. The tab bar already clears the
  // bottom inset, so only the top notch needs handling here.
  const insets = useSafeAreaInsets();
  const { onSessionRejected } = useAuth();
  const { bootstrap, reload: reloadShell } = useShell();

  const [timeframe, setTimeframe] = useState<Timeframe>(30);
  const [state, dispatch] = useReducer(queryReducer<Dashboard>, null, initialQueryState<Dashboard>);
  const tracker = useRef(createRequestTracker());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(
    async (tf: Timeframe, options?: { refresh?: boolean }) => {
      // Same timeframe already in flight → this is a duplicate; skip it.
      const ticket = tracker.current.begin(String(tf));
      if (ticket.duplicate) return;

      dispatch({ type: 'START', refresh: options?.refresh });
      try {
        const token = await readToken();
        if (!token) {
          onSessionRejected('unauthenticated');
          return;
        }

        const result = await fetchDashboard(token, tf);
        // A superseded request must never commit: the user has moved on.
        if (!mounted.current || !tracker.current.isLatest(ticket.seq)) return;

        if (result.ok) {
          dispatch({ type: 'SUCCESS', data: result.data.dashboard });
          return;
        }
        // An invalid session goes through the ONE auth path.
        if (isSessionInvalid(result.error)) {
          onSessionRejected(result.error);
          return;
        }
        dispatch({ type: 'FAILURE', error: result.error });
      } finally {
        tracker.current.end(ticket);
      }
    },
    [onSessionRejected],
  );

  useEffect(() => {
    void load(timeframe);
  }, [load, timeframe]);

  const onRefresh = useCallback(async () => {
    // Refresh reloads BOTH the shell counters and the dashboard — one call each,
    // not a fan-out, and no background polling anywhere.
    await Promise.all([reloadShell({ refresh: true }), load(timeframe, { refresh: true })]);
  }, [reloadShell, load, timeframe]);

  const dashboard = state.data;

  const formatDate = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(activeLocale, { day: 'numeric', month: 'short' });
    return (iso: string) => {
      try { return fmt.format(new Date(iso)); } catch { return ''; }
    };
  }, []);
  const formatDateTime = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(activeLocale, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    return (iso: string) => {
      try { return fmt.format(new Date(iso)); } catch { return ''; }
    };
  }, []);

  const trendSummary = useMemo(() => {
    if (!dashboard) return '';
    const { buckets, total } = dashboard.riskTrend;
    const parts = [t.trend.summary(total, dashboard.timeframe)];
    const peak = buckets.reduce((best, b) => (b.count > best.count ? b : best), { key: '', count: 0 });
    if (peak.count > 0) parts.push(t.trend.peak(peak.count, formatDate(peak.key)));
    return parts.join(' ');
  }, [dashboard, formatDate]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{
        paddingTop: insets.top + theme.spacing.sm,
        paddingHorizontal: theme.spacing.xl,
        paddingBottom: theme.spacing.xxxl,
        gap: theme.spacing.xl,
      }}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing(state)}
          onRefresh={() => void onRefresh()}
          tintColor={theme.colors.brand}
          colors={[theme.colors.brand]}
        />
      }>
      <AppHeader
        title={t.dashboard.eyebrow}
        workspaceName={bootstrap?.workspace.name}
        demo={bootstrap?.workspace.demo}
        demoLabel={t.accounts.status.demo}
        unreadCount={bootstrap?.counts.unreadNotifications ?? 0}
        unreadLabel={t.nav.alerts}
      />

      {bootstrap?.access.banner ? <AccessBanner banner={bootstrap.access.banner} /> : null}

      {dashboard?.realTestMode ? (
        <Card variant="sunken">
          <AppText variant="callout" tone="brand">
            {t.dashboard.realTestMode}
          </AppText>
          <AppText variant="caption" tone="foregroundMuted">
            {t.dashboard.realTestModeHint}
          </AppText>
        </Card>
      ) : null}

      <TimeframePicker value={timeframe} onChange={setTimeframe} />

      {isInitialLoad(state) ? (
        <View accessibilityLabel={t.common.loading} accessibilityState={{ busy: true }} style={{ gap: theme.spacing.lg }}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={4} />
          <SkeletonCard lines={3} />
        </View>
      ) : isBlockingError(state) ? (
        <ErrorState
          title={t.errors.title}
          message={messageFor(state.error ?? 'server_error')}
          retryLabel={t.common.retry}
          onRetry={() => void load(timeframe)}
        />
      ) : dashboard ? (
        dashboard.isEmpty ? (
          <EmptyState
            title={t.empty.title}
            body={t.empty.body}
            hint={t.empty.hint}
            action={<Button label={t.empty.cta} variant="secondary" disabled accessibilityHint={t.empty.hint} />}
          />
        ) : (
          <DashboardContent
            dashboard={dashboard}
            trendSummary={trendSummary}
            formatDate={formatDate}
            formatDateTime={formatDateTime}
          />
        )
      ) : null}

      {/* A refresh that failed keeps the content above and explains itself here. */}
      {state.status === 'error' && dashboard ? (
        <Card variant="sunken">
          <AppText variant="caption" tone="danger">
            {messageFor(state.error ?? 'server_error')}
          </AppText>
        </Card>
      ) : null}
    </ScrollView>
  );
}

function DashboardContent({
  dashboard,
  trendSummary,
  formatDate,
  formatDateTime,
}: {
  dashboard: Dashboard;
  trendSummary: string;
  formatDate: (iso: string) => string;
  formatDateTime: (iso: string) => string;
}) {
  const theme = useTheme();
  const o = dashboard.overview;
  const d = dashboard.deltas;
  const kpiStrings = {
    up: t.kpi.up, down: t.kpi.down, noBaseline: t.kpi.noBaseline, vsPrev: t.dashboard.vsPrev,
  };

  return (
    <View style={{ gap: theme.spacing.xxl }}>
      {/* KPIs — a two-column wrap, not five squeezed into a row. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md }}>
        <KpiCard label={t.kpi.analyzed} value={o.analyzedComments} tone="brand" delta={d.analyzedComments} higherIsBetter strings={kpiStrings} />
        <KpiCard label={t.kpi.risk} value={o.riskComments} tone="danger" delta={d.riskComments} higherIsBetter={false} strings={kpiStrings} />
        <KpiCard label={t.kpi.autoHandled} value={o.autoHandled} tone="success" delta={d.autoHandled} higherIsBetter strings={kpiStrings} />
        <KpiCard label={t.kpi.pending} value={o.pendingReview} tone="warning" hint={t.kpi.pendingHint} strings={kpiStrings} />
        <KpiCard
          label={t.kpi.problem}
          value={o.accountsWithProblem}
          tone={o.accountsWithProblem > 0 ? 'danger' : 'success'}
          hint={t.kpi.problemHint}
          strings={kpiStrings}
        />
      </View>

      {/* Watched accounts */}
      {dashboard.watchedAccounts.length > 0 ? (
        <View>
          <SectionHeader
            title={t.accounts.section}
            description={
              dashboard.watchedAccountsTotal > dashboard.watchedAccounts.length
                ? t.accounts.showingOf(dashboard.watchedAccounts.length, dashboard.watchedAccountsTotal)
                : undefined
            }
          />
          <View style={{ gap: theme.spacing.md }}>
            {dashboard.watchedAccounts.map((account) => (
              <AccountSummaryCard
                key={account.id}
                account={account}
                formatDate={formatDate}
                strings={{
                  statusLabel: t.accounts.status[account.status] ?? account.status,
                  comments: t.accounts.comments,
                  risky: t.accounts.risky,
                  autoHide: t.accounts.autoHide,
                  on: t.accounts.on,
                  off: t.accounts.off,
                  lastSync: t.accounts.lastSync,
                  neverSync: t.accounts.neverSync,
                }}
              />
            ))}
          </View>
        </View>
      ) : null}

      {/* Risk trend */}
      <Card>
        <SectionHeader title={t.trend.section} description={t.trend.description} />
        {dashboard.riskTrend.total === 0 ? (
          <AppText variant="callout" tone="foregroundMuted">
            {t.trend.empty}
          </AppText>
        ) : (
          <View style={{ gap: theme.spacing.lg }}>
            <TrendChart buckets={dashboard.riskTrend.buckets} summary={trendSummary} />
            {dashboard.riskTrend.categories.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {dashboard.riskTrend.categories.map((c) => (
                  <Badge key={c.category} label={`${c.category} · ${c.count}`} tone="neutral" />
                ))}
              </View>
            ) : null}
          </View>
        )}
      </Card>

      {/* Protection */}
      {dashboard.protection ? (
        <Card>
          <SectionHeader title={t.protection.section} />
          <ProtectionSummary
            score={dashboard.protection.score}
            checks={dashboard.protection.checks}
            strings={{
              scoreOf: t.protection.scoreOf,
              level: { strong: t.protection.strong, partial: t.protection.partial, weak: t.protection.weak },
              state: t.protection.state,
              // An unrecognised check key renders as the key, never as a guess.
              checkLabel: (key) =>
                (t.protection.checks as Record<string, string>)[key] ?? key,
            }}
          />
        </Card>
      ) : null}

      {/* Recent activity */}
      <Card>
        <SectionHeader title={t.activity.section} />
        {dashboard.recentActivity.length === 0 ? (
          <AppText variant="callout" tone="foregroundMuted">
            {t.activity.empty}
          </AppText>
        ) : (
          <View style={{ gap: theme.spacing.lg }}>
            {dashboard.recentActivity.map((event) => (
              <ActivityRow
                key={event.id}
                type={event.type}
                label={t.activity.types[event.type] ?? event.type}
                timestamp={formatDateTime(event.at)}
              />
            ))}
          </View>
        )}
      </Card>
    </View>
  );
}

function TimeframePicker({ value, onChange }: { value: Timeframe; onChange: (tf: Timeframe) => void }) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        alignSelf: 'flex-start',
        backgroundColor: theme.colors.surfaceSunken,
        borderRadius: theme.radius.md,
        padding: 3,
        gap: 3,
      }}>
      {TIMEFRAMES.map((days) => {
        const selected = days === value;
        return (
          <Button
            key={days}
            label={t.dashboard.timeframe(days)}
            variant={selected ? 'primary' : 'ghost'}
            onPress={() => onChange(days)}
            accessibilityLabel={t.dashboard.timeframeA11y(days)}
            style={{
              height: theme.sizing.minTouchTarget,
              paddingHorizontal: theme.spacing.lg,
              borderRadius: theme.radius.sm,
            }}
          />
        );
      })}
    </View>
  );
}

function AccessBanner({ banner }: { banner: AccessBannerKind }) {
  const theme = useTheme();
  const { bootstrap } = useShell();

  const tone = banner === 'restricted' ? 'danger' : banner === 'past_due' ? 'warning' : 'brand';
  const message =
    banner === 'restricted'
      ? t.access.restricted
      : banner === 'past_due'
        ? t.access.past_due
        : t.access.trial_ending(bootstrap?.access.trialDaysLeft ?? 0);

  const background = {
    danger: theme.colors.dangerSoft,
    warning: theme.colors.warningSoft,
    brand: theme.colors.brandSoft,
  }[tone];
  const color = {
    danger: theme.colors.danger,
    warning: theme.colors.warning,
    brand: theme.colors.brand,
  }[tone];

  return (
    <View
      accessibilityRole="alert"
      style={{ backgroundColor: background, borderRadius: theme.radius.md, padding: theme.spacing.lg, gap: theme.spacing.sm }}>
      <AppText variant="callout" style={{ color }}>
        {message}
      </AppText>
    </View>
  );
}
