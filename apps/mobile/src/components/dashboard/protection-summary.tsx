/**
 * `ProtectionSummary` — the aggregate protection level.
 *
 * The score and every check state are computed SERVER-side (`aggregateProtection`
 * over `accountProtectionScore`); this component only renders them.
 *
 * Deliberately not a circular gauge. A ring would be decoration that adds no
 * information at phone size — the number, a worded level, and a linear meter say
 * more and stay readable at large text sizes. The meter is labelled numerically,
 * and each check states its own status in words, so nothing depends on colour.
 */

import { View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme';
import type { CheckState } from '@/api/types';
import { protectionLevel, type ProtectionLevel } from './protection-level';

export { protectionLevel };
export type { ProtectionLevel };

export interface ProtectionSummaryProps {
  score: number;
  checks: { key: string; state: CheckState }[];
  strings: {
    scoreOf: (score: number) => string;
    level: Record<ProtectionLevel, string>;
    state: Record<CheckState, string>;
    /** Localized label per check key; unknown keys fall back to the raw key. */
    checkLabel: (key: string) => string;
  };
}

export function ProtectionSummary({ score, checks, strings }: ProtectionSummaryProps) {
  const theme = useTheme();
  const level = protectionLevel(score);
  const clamped = Math.max(0, Math.min(100, score));

  const levelColor = {
    strong: theme.colors.success,
    partial: theme.colors.warning,
    weak: theme.colors.danger,
  }[level];

  const stateColor: Record<CheckState, string> = {
    ok: theme.colors.success,
    partial: theme.colors.warning,
    off: theme.colors.danger,
  };

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <View
        accessible
        accessibilityLabel={`${strings.scoreOf(clamped)}. ${strings.level[level]}.`}
        style={{ gap: theme.spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm }}>
          <AppText variant="display" style={{ fontSize: 34, lineHeight: 40 }}>
            {String(clamped)}
          </AppText>
          <AppText variant="callout" tone="foregroundMuted">
            / 100
          </AppText>
          <AppText variant="callout" style={{ color: levelColor, marginLeft: 'auto' }}>
            {strings.level[level]}
          </AppText>
        </View>

        {/* Linear meter. Decorative: the number above already states the value. */}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            height: 8,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.colors.surfaceSunken,
            overflow: 'hidden',
          }}>
          <View style={{ width: `${clamped}%`, height: '100%', backgroundColor: levelColor }} />
        </View>
      </View>

      <View style={{ gap: theme.spacing.md }}>
        {checks.map((check) => (
          <View
            key={check.key}
            accessible
            accessibilityLabel={`${strings.checkLabel(check.key)}: ${strings.state[check.state]}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: theme.spacing.md,
            }}>
            <AppText variant="caption" tone="foregroundMuted" style={{ flexShrink: 1 }} numberOfLines={2}>
              {strings.checkLabel(check.key)}
            </AppText>
            {/* Status is stated in words; the colour merely reinforces it. */}
            <AppText variant="caption" style={{ color: stateColor[check.state] }}>
              {strings.state[check.state]}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}
