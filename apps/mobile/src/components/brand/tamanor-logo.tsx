/**
 * The Tamanor lockup: mark plus wordmark, matching `Logo` on web.
 *
 * The whole lockup is a single accessibility element reading "Tamanor" — the
 * mark and the word are one brand, not two things to swipe through.
 */

import { View, type ViewStyle } from 'react-native';

import { TamanorMark } from './tamanor-mark';
import { AppText } from '@/components/ui';
import { useTheme } from '@/theme';

export interface TamanorLogoProps {
  /** Height of the mark; the wordmark scales alongside it. */
  size?: number;
  /** Hide the wordmark, leaving just the shield. */
  markOnly?: boolean;
  style?: ViewStyle;
}

export function TamanorLogo({ size = 32, markOnly = false, style }: TamanorLogoProps) {
  const theme = useTheme();

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Tamanor"
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
        style,
      ]}>
      <TamanorMark size={size} />
      {markOnly ? null : (
        <AppText
          variant="title"
          style={{ fontSize: size * 0.66, lineHeight: size * 0.84 }}>
          Tamanor
        </AppText>
      )}
    </View>
  );
}
