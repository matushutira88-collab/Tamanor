/**
 * `Button` — the app's single tappable action.
 *
 * Cross-platform notes:
 *  - `Pressable` (not `TouchableOpacity`) so Android gets its own press feedback
 *    via `android_ripple` while iOS gets an opacity dip.
 *  - The target is never shorter than `sizing.minTouchTarget`, which clears both
 *    the iOS 44pt and Android 48dp guidance.
 *  - Busy and disabled states are exposed through `accessibilityState`, not just
 *    colour, so assistive tech reports them.
 */

import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { AppText } from './app-text';
import { useTheme } from '@/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Shows a spinner and blocks presses. */
  busy?: boolean;
  /** Stretch to the container width. */
  block?: boolean;
  /**
   * Spoken label, when `label` alone is ambiguous out of context
   * (e.g. "Open" -> "Open protection rules").
   */
  accessibilityLabel?: string;
  /** Longer spoken explanation of what the action will do. */
  accessibilityHint?: string;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  block = false,
  accessibilityLabel,
  accessibilityHint,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const inactive = disabled || busy;

  const surface: Record<ButtonVariant, { background: string; border: string; label: string }> = {
    primary: {
      background: theme.colors.brand,
      border: theme.colors.brand,
      label: theme.colors.brandOn,
    },
    secondary: {
      background: theme.colors.surface,
      border: theme.colors.borderStrong,
      label: theme.colors.foreground,
    },
    ghost: {
      background: 'transparent',
      border: 'transparent',
      label: theme.colors.brand,
    },
    danger: {
      background: theme.colors.danger,
      border: theme.colors.danger,
      label: theme.colors.brandOn,
    },
  };

  const tone = surface[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      android_ripple={
        variant === 'ghost' || variant === 'secondary'
          ? { color: theme.colors.brandSoft, borderless: false }
          : { color: theme.colors.brandStrong, borderless: false }
      }
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: theme.sizing.minTouchTarget,
          height: theme.sizing.controlHeight,
          paddingHorizontal: theme.spacing.xl,
          borderRadius: theme.radius.md,
          backgroundColor: tone.background,
          borderColor: tone.border,
          alignSelf: block ? 'stretch' : 'flex-start',
          opacity: inactive ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}>
      <View style={styles.content}>
        {busy ? (
          <ActivityIndicator
            size="small"
            color={tone.label}
            style={{ marginRight: theme.spacing.sm }}
          />
        ) : null}
        <AppText variant="bodyStrong" style={{ color: tone.label }} numberOfLines={1}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // Keeps the Android ripple inside the rounded corners.
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
