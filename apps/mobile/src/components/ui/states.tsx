/**
 * Shared screen states: skeleton, empty, and error.
 *
 * Each is a real, labelled state rather than a blank frame, so the user always
 * knows whether the app is working, has nothing to show, or failed.
 */

import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

import { AppText } from './app-text';
import { Button } from './button';
import { Card } from './card';
import { useTheme } from '@/theme';

/**
 * `Skeleton` — a neutral placeholder block.
 *
 * Deliberately static: an animated shimmer on every card is a lot of work on the
 * UI thread for a load that usually lasts a few hundred milliseconds. The
 * surrounding container carries the accessibility "busy" state.
 */
export function Skeleton({ height = 16, width, radius }: { height?: number; width?: number | `${number}%`; radius?: number }) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        height,
        width: width ?? '100%',
        borderRadius: radius ?? theme.radius.sm,
        backgroundColor: theme.colors.surfaceSunken,
      }}
    />
  );
}

/** A card-shaped skeleton, used while the dashboard's first load is in flight. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  const theme = useTheme();
  return (
    <Card>
      <View style={{ gap: theme.spacing.md }}>
        <Skeleton height={14} width="45%" />
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} height={12} width={i === lines - 1 ? '70%' : '100%'} />
        ))}
      </View>
    </Card>
  );
}

export interface EmptyStateProps {
  title: string;
  body: string;
  hint?: string;
  action?: ReactNode;
  style?: ViewStyle;
}

/** `EmptyState` — nothing to show, and that is a normal, explainable situation. */
export function EmptyState({ title, body, hint, action, style }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <Card style={style}>
      <View style={{ gap: theme.spacing.md, alignItems: 'flex-start' }}>
        <AppText variant="heading" accessibilityRole="header">
          {title}
        </AppText>
        <AppText variant="body" tone="foregroundMuted">
          {body}
        </AppText>
        {hint ? (
          <AppText variant="caption" tone="foregroundMuted">
            {hint}
          </AppText>
        ) : null}
        {action}
      </View>
    </Card>
  );
}

export interface ErrorStateProps {
  title: string;
  message: string;
  retryLabel: string;
  onRetry: () => void;
  busy?: boolean;
  style?: ViewStyle;
}

/**
 * `ErrorState` — a truthful failure with a way out.
 *
 * `message` is always one of the app's own bounded sentences; a raw server or
 * network error string is never passed here.
 */
export function ErrorState({ title, message, retryLabel, onRetry, busy, style }: ErrorStateProps) {
  const theme = useTheme();
  return (
    <Card style={style}>
      <View accessibilityRole="alert" style={{ gap: theme.spacing.md, alignItems: 'flex-start' }}>
        <AppText variant="heading" accessibilityRole="header">
          {title}
        </AppText>
        <AppText variant="body" tone="foregroundMuted">
          {message}
        </AppText>
        <Button label={retryLabel} onPress={onRetry} busy={busy} variant="secondary" />
      </View>
    </Card>
  );
}

/** `SectionHeader` — a titled band above a group of cards. */
export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: theme.spacing.md,
        marginBottom: theme.spacing.md,
      }}>
      <View style={{ flexShrink: 1, gap: 2 }}>
        <AppText variant="heading" accessibilityRole="header">
          {title}
        </AppText>
        {description ? (
          <AppText variant="caption" tone="foregroundMuted">
            {description}
          </AppText>
        ) : null}
      </View>
      {action}
    </View>
  );
}
