/**
 * `AccountRow` — one connected account in the list.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * FOUR BADGES, NEVER ONE. Connection, monitoring and auto-sync are three separate
 * labelled badges, and the capability summary lives on the detail screen. There is
 * deliberately no combined "Active" chip, and only the CONNECTION badge may ever be
 * styled as a success — a monitored account with an expired token still reads red.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Nothing is communicated by colour alone: every badge renders a localized word, and
 * the whole row is announced as one sentence.
 *
 * Memoized because the list re-renders on every mutation.
 */

import { memo } from 'react';
import { Pressable, View } from 'react-native';

import { AppText, Badge } from '@/components/ui';
import { useTheme } from '@/theme';
import type { ConnectedAccountItem } from '@/api/types';
import {
  autoSyncTone, connectionTone, displayPlatform, monitoringTone, needsAttention,
} from '@/accounts/presentation';

export interface AccountRowStrings {
  connection: string;
  monitoringLabel: string;
  monitoringValue: string;
  autoSyncLabel: string;
  autoSyncValue: string;
  lastSync: string;
  /** Already-formatted "12 comments today · 2 risky" fragment, or null. */
  metrics: string | null;
  reason: string | null;
  attention: string;
}

export interface AccountRowProps {
  account: ConnectedAccountItem;
  strings: AccountRowStrings;
  onPress: (id: string) => void;
}

function AccountRowBase({ account, strings, onPress }: AccountRowProps) {
  const theme = useTheme();
  const attention = needsAttention(account);
  const platform = displayPlatform(account);
  const title = account.name ?? platform;

  // One spoken sentence per row: a screen reader should not have to assemble the
  // meaning from six separate fragments. The three truths are named explicitly.
  const spoken = [
    attention ? strings.attention : null,
    title,
    account.username,
    platform,
    strings.connection,
    `${strings.monitoringLabel}: ${strings.monitoringValue}`,
    `${strings.autoSyncLabel}: ${strings.autoSyncValue}`,
    strings.reason,
    strings.lastSync,
    strings.metrics,
  ].filter(Boolean).join('. ');

  return (
    <Pressable
      onPress={() => onPress(account.id)}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      android_ripple={{ color: theme.colors.brandSoft }}
      style={({ pressed }) => ({
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: theme.radius.lg,
        // A left rule reinforces "needs attention" — the label above still says it.
        borderLeftWidth: attention ? 3 : 1,
        borderLeftColor: attention ? theme.colors.danger : theme.colors.border,
        padding: theme.spacing.lg,
        gap: theme.spacing.sm,
        opacity: pressed ? 0.85 : 1,
      })}>
      {/* Identity */}
      <View style={{ gap: theme.spacing.xxs }}>
        <AppText variant="bodyStrong" numberOfLines={1}>{title}</AppText>
        <AppText variant="caption" tone="foregroundMuted" numberOfLines={1}>
          {[platform, account.username].filter(Boolean).join(' · ')}
        </AppText>
      </View>

      {/*
        The three truths as three independently-toned badges. They are rendered in a
        fixed order so the same fact is always in the same place, and each carries its
        own label so none can be misread as describing another.
      */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
        <Badge label={strings.connection} tone={connectionTone(account.connectionState)} />
        <Badge
          label={`${strings.monitoringLabel}: ${strings.monitoringValue}`}
          tone={monitoringTone(account.monitoringEnabled)}
        />
        <Badge
          label={`${strings.autoSyncLabel}: ${strings.autoSyncValue}`}
          tone={autoSyncTone(account.autoSyncState)}
        />
      </View>

      {strings.reason ? (
        <AppText variant="caption" tone="danger" numberOfLines={2}>{strings.reason}</AppText>
      ) : null}

      <AppText variant="caption" tone="foregroundMuted" numberOfLines={1}>
        {strings.lastSync}
      </AppText>

      {strings.metrics ? (
        <AppText variant="caption" tone="foregroundMuted">{strings.metrics}</AppText>
      ) : null}
    </Pressable>
  );
}

export const AccountRow = memo(AccountRowBase);
