/**
 * `Loading` — the app's busy indicator.
 *
 * Always carries a spoken label: a bare spinner conveys "wait" purely through
 * motion, which assistive tech cannot relay.
 */

import { ActivityIndicator, View, type ViewStyle } from 'react-native';

import { AppText } from './app-text';
import { useTheme } from '@/theme';

export interface LoadingProps {
  /** Visible caption. Omit for a bare spinner (still labelled for a11y). */
  label?: string;
  /** Fill the available space and centre — for full-screen waits. */
  fill?: boolean;
  size?: 'small' | 'large';
  style?: ViewStyle;
}

export function Loading({ label, fill = false, size = 'small', style }: LoadingProps) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? 'Loading'}
      style={[
        {
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.md,
          ...(fill ? { flex: 1 } : null),
        },
        style,
      ]}>
      <ActivityIndicator size={size} color={theme.colors.brand} />
      {label ? (
        <AppText variant="caption" tone="foregroundMuted">
          {label}
        </AppText>
      ) : null}
    </View>
  );
}
