/**
 * `AccountSummaryCard` — one watched account on the dashboard.
 *
 * The status badge is server-derived (`MobileAccountStatus`); this component never
 * infers health from the counters. An account with an unrecognised status falls
 * back to the neutral treatment rather than being shown as healthy.
 */

import { View } from 'react-native';

import { AppText, Badge, type BadgeTone } from '@/components/ui';
import { useTheme } from '@/theme';
import type { AccountStatus, WatchedAccount } from '@/api/types';

/** Tone per status. Decorative only — the badge label states the same thing. */
const STATUS_TONE: Record<AccountStatus, BadgeTone> = {
  active: 'success',
  permissions_expired: 'danger',
  sync_failed: 'warning',
  monitoring_off: 'neutral',
  demo: 'brand',
};

/** Display label for a platform key, falling back to the raw key when unknown. */
const PLATFORM_LABEL: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  google_business: 'Google Business',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
};

export interface AccountSummaryCardProps {
  account: WatchedAccount;
  strings: {
    statusLabel: string;
    comments: string;
    risky: string;
    autoHide: string;
    on: string;
    off: string;
    lastSync: string;
    neverSync: string;
  };
  /** Locale-aware date formatter supplied by the screen. */
  formatDate: (iso: string) => string;
}

export function AccountSummaryCard({ account, strings, formatDate }: AccountSummaryCardProps) {
  const theme = useTheme();
  const platform = PLATFORM_LABEL[account.platform] ?? account.platform;
  const title = account.name ?? platform;
  const tone = STATUS_TONE[account.status] ?? 'neutral';

  const sync = account.lastSyncAt
    ? `${strings.lastSync} · ${formatDate(account.lastSyncAt)}`
    : strings.neverSync;

  return (
    <View
      accessible
      accessibilityLabel={[
        title,
        platform,
        strings.statusLabel,
        `${strings.comments}: ${account.comments}`,
        `${strings.risky}: ${account.risky}`,
        `${strings.autoHide}: ${account.autoHideEnabled ? strings.on : strings.off}`,
        sync,
      ].join('. ')}
      style={{
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.lg,
        gap: theme.spacing.md,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md }}>
        <View style={{ flexShrink: 1, gap: 2 }}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {title}
          </AppText>
          <AppText variant="caption" tone="foregroundMuted" numberOfLines={1}>
            {platform}
          </AppText>
        </View>
      </View>

      <Badge label={strings.statusLabel} tone={tone} />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.lg }}>
        <Metric label={strings.comments} value={String(account.comments)} />
        <Metric label={strings.risky} value={String(account.risky)} />
        <Metric label={strings.autoHide} value={account.autoHideEnabled ? strings.on : strings.off} />
      </View>

      <AppText variant="caption" tone="foregroundMuted" numberOfLines={1}>
        {sync}
      </AppText>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 2, minWidth: 72 }}>
      <AppText variant="caption" tone="foregroundMuted" numberOfLines={1}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={{ fontSize: 15, lineHeight: 20 }} numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}
