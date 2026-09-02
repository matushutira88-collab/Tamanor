/**
 * `Divider` — a hairline rule between blocks.
 *
 * Uses `StyleSheet.hairlineWidth` so the line is one physical pixel on both
 * platforms rather than a 1dp bar that looks heavy on high-density Android
 * screens. It is decorative, so it is hidden from assistive tech.
 */

import { StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  /** Space above and below (or either side, when vertical). */
  spacing?: number;
  style?: ViewStyle;
}

export function Divider({ orientation = 'horizontal', spacing, style }: DividerProps) {
  const theme = useTheme();
  const gap = spacing ?? theme.spacing.lg;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        orientation === 'horizontal'
          ? { height: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: gap }
          : { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginHorizontal: gap },
        { backgroundColor: theme.colors.border },
        style,
      ]}
    />
  );
}
