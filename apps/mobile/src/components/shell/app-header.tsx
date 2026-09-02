/**
 * `AppHeader` — the compact authenticated header.
 *
 * Mobile space is scarce, so this carries only what changes meaning: the brand
 * mark, the workspace the user is looking at, and a notification indicator. Plan
 * and usage details live under "More" rather than taking permanent space, and the
 * user's role is not shown — it is not information the user acts on here.
 */

import type { ReactNode } from 'react';
import { View } from 'react-native';

import { TamanorMark } from '@/components/brand/tamanor-mark';
import { AppText, Badge, CountBadge } from '@/components/ui';
import { useTheme } from '@/theme';

export interface AppHeaderProps {
  title: string;
  /** Workspace name; omitted when it would just repeat the title. */
  workspaceName?: string;
  demo?: boolean;
  demoLabel?: string;
  unreadCount?: number;
  unreadLabel?: string;
  action?: ReactNode;
}

export function AppHeader({
  title,
  workspaceName,
  demo,
  demoLabel,
  unreadCount = 0,
  unreadLabel,
  action,
}: AppHeaderProps) {
  const theme = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.lg,
      }}>
      {/* Decorative: the title beside it names the screen. */}
      <TamanorMark size={32} />

      <View style={{ flexShrink: 1, flexGrow: 1, gap: 2 }}>
        <AppText variant="heading" accessibilityRole="header" numberOfLines={1}>
          {title}
        </AppText>
        {workspaceName ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <AppText variant="caption" tone="foregroundMuted" numberOfLines={1} style={{ flexShrink: 1 }}>
              {workspaceName}
            </AppText>
            {demo && demoLabel ? <Badge label={demoLabel} tone="brand" /> : null}
          </View>
        ) : null}
      </View>

      {unreadCount > 0 ? (
        <View
          accessible
          accessibilityLabel={unreadLabel ? `${unreadCount} ${unreadLabel}` : String(unreadCount)}
          style={{ minHeight: theme.sizing.minTouchTarget, justifyContent: 'center' }}>
          <CountBadge count={unreadCount} />
        </View>
      ) : null}

      {action}
    </View>
  );
}
