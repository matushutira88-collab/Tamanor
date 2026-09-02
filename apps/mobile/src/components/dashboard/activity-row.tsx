/**
 * `ActivityRow` — one bounded activity event.
 *
 * The server only ever sends a known event key, and the screen resolves the label
 * from the dictionary before this renders. The dot is decorative — the label
 * carries the meaning.
 */

import { View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme';
import type { ActivityType } from '@/api/types';

/** Tone per event, mirroring the web dashboard's ACTIVITY_TONE map. */
const ACTIVITY_TONE: Record<ActivityType, 'brand' | 'success' | 'warning' | 'danger'> = {
  'sync.completed': 'success',
  'sync.failed': 'danger',
  'auto_protect.would_auto_hide': 'brand',
  'protection.action_executed': 'brand',
  'incident.created': 'danger',
  'proposal.created': 'warning',
  'account.connected': 'success',
  'token.expired': 'warning',
};

export function ActivityRow({
  type,
  label,
  timestamp,
}: {
  type: ActivityType;
  label: string;
  timestamp: string;
}) {
  const theme = useTheme();
  const tone = ACTIVITY_TONE[type] ?? 'brand';
  const color = {
    brand: theme.colors.brand,
    success: theme.colors.success,
    warning: theme.colors.warning,
    danger: theme.colors.danger,
  }[tone];

  return (
    <View
      accessible
      accessibilityLabel={`${label}. ${timestamp}`}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md }}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 8,
          height: 8,
          borderRadius: theme.radius.pill,
          backgroundColor: color,
          marginTop: 6,
        }}
      />
      <View style={{ flexShrink: 1, gap: 2 }}>
        <AppText variant="callout" numberOfLines={2}>
          {label}
        </AppText>
        <AppText variant="caption" tone="foregroundMuted">
          {timestamp}
        </AppText>
      </View>
    </View>
  );
}
