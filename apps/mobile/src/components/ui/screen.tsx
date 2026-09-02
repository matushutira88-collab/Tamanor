/**
 * `Screen` — the outer frame every route renders inside.
 *
 * Handles the things that are easy to get wrong per-screen: safe-area insets,
 * the themed canvas, keyboard avoidance, and capping the content measure on
 * wide displays (large phones today, tablets later) instead of letting lines
 * run edge to edge.
 */

import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

export interface ScreenProps {
  children: ReactNode;
  /** Wrap content in a `ScrollView`. Off by default — most screens own their list. */
  scrollable?: boolean;
  /** Remove the default horizontal gutter (for edge-to-edge lists). */
  padded?: boolean;
  /** Centre content vertically. Useful for empty/auth/splash-like states. */
  centered?: boolean;
  contentContainerStyle?: ViewStyle;
  style?: ViewStyle;
}

export function Screen({
  children,
  scrollable = false,
  padded = true,
  centered = false,
  contentContainerStyle,
  style,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  // Insets are applied manually rather than via `SafeAreaView` so a screen can
  // still paint into the inset area (headers, hero backgrounds) while its
  // content stays clear of the notch, home indicator and Android gesture bar.
  const frame: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
    paddingLeft: insets.left,
    paddingRight: insets.right,
  };

  const content: ViewStyle = {
    flexGrow: 1,
    width: '100%',
    alignSelf: 'center',
    maxWidth: theme.sizing.maxContentWidth,
    paddingHorizontal: padded ? theme.spacing.xl : 0,
    ...(centered ? { justifyContent: 'center' } : null),
  };

  const body = scrollable ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[content, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      // Android has no bounce; iOS keeps it for the usual rubber-band feel.
      alwaysBounceVertical={false}
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={[content, contentContainerStyle]}>{children}</View>
  );

  return (
    <View style={[frame, style]}>
      <KeyboardAvoidingView
        style={styles.fill}
        // `padding` is correct on iOS; on Android the window soft-input mode
        // already resizes the view, and adding padding double-counts it.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {body}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
