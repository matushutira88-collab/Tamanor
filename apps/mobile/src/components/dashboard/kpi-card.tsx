/**
 * `KpiCard` — one headline metric.
 *
 * Delta rules mirror the web dashboard exactly:
 *   - `delta === null` means the previous window was zero. There is no honest
 *     baseline, so the card says so rather than showing a fabricated 0% or +100%.
 *   - whether a change is GOOD depends on the metric: more analyzed comments is
 *     good, more risk comments is not. The caller decides; this component only
 *     renders.
 *
 * The delta's direction is stated in words (“up”/“down”) as well as by colour and
 * arrow, so it is never communicated by colour alone.
 */

import { View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme';

export type KpiTone = 'brand' | 'danger' | 'success' | 'warning';

export interface KpiCardProps {
  label: string;
  value: number;
  tone?: KpiTone;
  /** Percent change vs. the previous window, or null when there is no baseline. */
  delta?: number | null;
  /** True when an increase is a GOOD outcome for this metric. */
  higherIsBetter?: boolean;
  /** Shown instead of a delta when the metric has no comparison concept. */
  hint?: string;
  /** Words for the delta direction, so meaning is not colour-only. */
  strings: { up: string; down: string; noBaseline: string; vsPrev: string };
}

export function KpiCard({
  label,
  value,
  tone = 'brand',
  delta,
  higherIsBetter = true,
  hint,
  strings,
}: KpiCardProps) {
  const theme = useTheme();

  const accent = {
    brand: theme.colors.brand,
    danger: theme.colors.danger,
    success: theme.colors.success,
    warning: theme.colors.warning,
  }[tone];

  const hasDelta = typeof delta === 'number';
  const rising = hasDelta && delta > 0;
  const flat = hasDelta && delta === 0;
  // "Good" is metric-dependent: fewer risk comments is an improvement.
  const good = hasDelta ? (rising ? higherIsBetter : flat ? true : !higherIsBetter) : true;
  const deltaColor = flat ? theme.colors.foregroundMuted : good ? theme.colors.success : theme.colors.danger;
  const directionWord = rising ? strings.up : strings.down;

  // Spoken as one unit so a screen reader does not read "12" and "Risk comments"
  // as unrelated fragments.
  const spoken = [
    `${label}: ${value}`,
    hasDelta
      ? flat
        ? `0% ${strings.vsPrev}`
        : `${Math.abs(delta)}% ${directionWord} ${strings.vsPrev}`
      : hint ?? strings.noBaseline,
  ].join('. ');

  return (
    <View
      accessible
      accessibilityLabel={spoken}
      style={{
        flexGrow: 1,
        flexShrink: 1,
        // Two per row on a normal phone; one per row on a very small screen.
        flexBasis: '46%',
        minWidth: 150,
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.lg,
        gap: theme.spacing.sm,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: 6, height: 6, borderRadius: theme.radius.pill, backgroundColor: accent }}
        />
        <AppText variant="caption" tone="foregroundMuted" numberOfLines={2} style={{ flexShrink: 1 }}>
          {label}
        </AppText>
      </View>

      <AppText variant="display" style={{ fontSize: 28, lineHeight: 34 }}>
        {String(value)}
      </AppText>

      {hasDelta ? (
        <AppText variant="caption" style={{ color: deltaColor }} numberOfLines={2}>
          {flat ? `0% ${strings.vsPrev}` : `${rising ? '▲' : '▼'} ${Math.abs(delta)}% ${strings.vsPrev}`}
        </AppText>
      ) : (
        <AppText variant="caption" tone="foregroundMuted" numberOfLines={2}>
          {hint ?? strings.noBaseline}
        </AppText>
      )}
    </View>
  );
}
