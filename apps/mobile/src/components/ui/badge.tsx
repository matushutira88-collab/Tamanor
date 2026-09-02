/**
 * `Badge` — a small tinted label.
 *
 * The tone is decorative: the label text always carries the meaning, so a badge is
 * never the only way a state is communicated (WCAG 1.4.1).
 */

import { View, type ViewStyle } from 'react-native';

import { AppText } from './app-text';
import { useTheme } from '@/theme';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  style?: ViewStyle;
}

export function Badge({ label, tone = 'neutral', style }: BadgeProps) {
  const theme = useTheme();

  const palette: Record<BadgeTone, { bg: string; fg: string }> = {
    neutral: { bg: theme.colors.neutralSoft, fg: theme.colors.foregroundMuted },
    brand: { bg: theme.colors.brandSoft, fg: theme.colors.brand },
    success: { bg: theme.colors.successSoft, fg: theme.colors.success },
    warning: { bg: theme.colors.warningSoft, fg: theme.colors.warning },
    danger: { bg: theme.colors.dangerSoft, fg: theme.colors.danger },
  };
  const { bg, fg } = palette[tone];

  return (
    <View
      style={[
        {
          alignSelf: 'flex-start',
          backgroundColor: bg,
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.xs,
        },
        style,
      ]}>
      <AppText variant="caption" style={{ color: fg }} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

/**
 * `CountBadge` — the numeric bubble on a navigation tab.
 *
 * Hidden entirely at zero, and capped at 99+ so a large count cannot stretch the
 * tab bar. It is decorative here because the tab's own accessibility label states
 * the count in words.
 */
export function CountBadge({ count, max = 99 }: { count: number; max?: number }) {
  const theme = useTheme();
  if (count <= 0) return null;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        minWidth: 18,
        height: 18,
        paddingHorizontal: 5,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.colors.danger,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <AppText
        style={{ color: '#ffffff', fontSize: 11, lineHeight: 14 }}
        numberOfLines={1}
        // A badge must stay a badge at large OS text sizes.
        allowFontScaling={false}>
        {count > max ? `${max}+` : String(count)}
      </AppText>
    </View>
  );
}
