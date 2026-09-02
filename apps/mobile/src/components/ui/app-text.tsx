/**
 * `AppText` — every string in the app renders through this.
 *
 * It binds a named type step and a colour role from the theme, so no screen
 * ever writes a font size or a hex value. Text scaling stays on (React Native's
 * default) so the OS "Larger Text" / "Font size" settings are honoured.
 */

import { Text, type TextProps } from 'react-native';

import { useTheme } from '@/theme';
import type { ColorTokens, TypographyToken } from '@/theme';

/** Colour roles that make sense for text. */
export type TextTone = Extract<
  keyof ColorTokens,
  | 'foreground'
  | 'foregroundMuted'
  | 'brand'
  | 'brandStrong'
  | 'brandOn'
  | 'success'
  | 'warning'
  | 'danger'
>;

export interface AppTextProps extends TextProps {
  variant?: TypographyToken;
  tone?: TextTone;
}

export function AppText({
  variant = 'body',
  tone = 'foreground',
  style,
  ...rest
}: AppTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[theme.textStyle(variant), { color: theme.colors[tone] }, style]}
      {...rest}
    />
  );
}
