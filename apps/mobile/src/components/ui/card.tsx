/**
 * `Card` — the primary container, mirroring `.gu-card` on web: surface fill,
 * hairline border, large radius.
 *
 * Elevation is drawn with a border plus a soft shadow rather than Android's
 * `elevation` prop alone, because `elevation` renders nothing on iOS and
 * `shadow*` renders nothing on Android — both are set so the card reads the
 * same on each platform.
 */

import type { ReactNode } from 'react';
import { Platform, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

export interface CardProps {
  children: ReactNode;
  /** `sunken` is the recessed variant for nested blocks (web `.gu-inset`). */
  variant?: 'raised' | 'flat' | 'sunken';
  style?: ViewStyle;
}

export function Card({ children, variant = 'raised', style }: CardProps) {
  const theme = useTheme();

  const background =
    variant === 'sunken' ? theme.colors.surfaceSunken : theme.colors.surface;

  const elevation: ViewStyle =
    variant === 'raised'
      ? Platform.select<ViewStyle>({
          ios: {
            shadowColor: '#0f172a',
            shadowOpacity: theme.scheme === 'dark' ? 0.5 : 0.06,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 4 },
          },
          android: { elevation: 2 },
          default: {},
        }) ?? {}
      : {};

  return (
    <View
      style={[
        {
          backgroundColor: background,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: theme.radius.lg,
          padding: theme.spacing.lg,
        },
        elevation,
        style,
      ]}>
      {children}
    </View>
  );
}
