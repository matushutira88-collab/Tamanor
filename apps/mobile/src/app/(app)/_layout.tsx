/**
 * Authenticated app shell — bottom navigation.
 *
 * Reaching this layout already implies a server-validated, email-verified session
 * in a supported workspace: the root layout only registers this group when
 * `canEnterApp(state)` is true.
 *
 * NAVIGATION MODEL: five permanent bottom tabs mapped onto the web product's daily
 * loop (Overview / Comments / Accounts / Alerts), plus More for everything else.
 * This is not a port of the web sidebar — the sidebar's nine destinations do not
 * fit a phone, so the four highest-frequency ones are promoted and the rest live
 * under More.
 *
 * `Tabs` comes from `expo-router/js-tabs`: the JavaScript tab navigator, which
 * behaves identically on iOS and Android. (The root `expo-router` export is
 * deprecated in SDK 57, and `unstable-native-tabs` is iOS-flavoured and unstable.)
 *
 * Tabs the server has NOT allowed are hidden. That is a UX affordance only — every
 * endpoint re-authorizes independently, so hiding a tab protects nothing on its own.
 *
 * BOOTSTRAP FAILURE (M8C). If bootstrap has never answered and has failed, this
 * layout renders a retryable error INSTEAD of the tab bar. It must not fall through
 * to `Tabs`: with `allowedNav` empty that produced a silently degraded two-tab shell
 * with no workspace name and an empty More screen, and nothing but an app restart
 * repaired it. Fail closed and say so, rather than fail closed and stay quiet.
 */

import { Tabs } from 'expo-router/js-tabs';
import { Platform, View } from 'react-native';

import type { ApiErrorCode } from '@/api/types';
import { CountBadge, ErrorState, Screen } from '@/components/ui';
import {
  AccountsIcon, AlertsIcon, CommentsIcon, MoreIcon, OverviewIcon,
} from '@/components/shell/tab-icons';
import { ShellProvider, useShell } from '@/shell/shell-provider';
import { t } from '@/i18n';
import { useTheme } from '@/theme';

/** One fixed sentence per bounded code — never raw server text. */
function messageFor(error: ApiErrorCode): string {
  switch (error) {
    case 'network': return t.errors.network;
    case 'timeout': return t.errors.timeout;
    case 'config': return t.errors.config;
    case 'permission_denied': return t.errors.forbidden;
    case 'workspace_unsupported': return t.errors.forbidden;
    default: return t.errors.server;
  }
}

export default function AppLayout() {
  return (
    <ShellProvider>
      <ShellTabs />
    </ShellProvider>
  );
}

function ShellTabs() {
  const theme = useTheme();
  const { bootstrap, allowedNav, phase, state, reload } = useShell();

  // Bootstrap failed with nothing to fall back on. Show it, and offer the retry
  // that repairs the whole shell — navigation, workspace name, badges and More.
  // A 401 never reaches here; the provider routes it to the M2 auth machine.
  if (phase === 'error') {
    return (
      <Screen centered>
        <ErrorState
          title={t.errors.title}
          message={messageFor(state.error ?? 'server_error')}
          retryLabel={t.common.retry}
          busy={state.status === 'loading' || state.status === 'refreshing'}
          onRetry={() => void reload()}
        />
      </Screen>
    );
  }

  // Until bootstrap answers, `allowedNav` is empty. Overview is always mounted so
  // the shell has a destination to render while the server is still deciding; the
  // optional tabs appear only once the server has actually allowed them.
  const allow = (key: 'comments' | 'accounts' | 'alerts') => allowedNav.includes(key);
  const pending = bootstrap?.counts.pendingReview ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.brand,
        tabBarInactiveTintColor: theme.colors.foregroundMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          // Android draws no hairline by default; make the two match.
          borderTopWidth: 1,
          ...Platform.select({ android: { elevation: 8 }, default: {} }),
        },
        tabBarLabelStyle: { fontSize: 11 },
        // Keep the bar usable when the OS text size is very large.
        tabBarAllowFontScaling: false,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t.nav.overview,
          tabBarAccessibilityLabel: t.nav.overview,
          tabBarIcon: ({ color }) => <OverviewIcon color={color} />,
        }}
      />

      <Tabs.Protected guard={allow('comments')}>
        <Tabs.Screen
          name="comments"
          options={{
            title: t.nav.comments,
            tabBarAccessibilityLabel: t.nav.comments,
            tabBarIcon: ({ color }) => <CommentsIcon color={color} />,
          }}
        />
      </Tabs.Protected>

      <Tabs.Protected guard={allow('accounts')}>
        <Tabs.Screen
          name="accounts"
          options={{
            title: t.nav.accounts,
            tabBarAccessibilityLabel: t.nav.accounts,
            tabBarIcon: ({ color }) => <AccountsIcon color={color} />,
          }}
        />
      </Tabs.Protected>

      <Tabs.Protected guard={allow('alerts')}>
        <Tabs.Screen
          name="alerts"
          options={{
            title: t.nav.alerts,
            // The count is spoken, not left to the badge glyph alone.
            tabBarAccessibilityLabel:
              pending > 0 ? `${t.nav.alerts}, ${pending}` : t.nav.alerts,
            tabBarIcon: ({ color }) => (
              <View>
                <AlertsIcon color={color} />
                <View style={{ position: 'absolute', top: -6, right: -10 }}>
                  <CountBadge count={pending} />
                </View>
              </View>
            ),
          }}
        />
      </Tabs.Protected>

      <Tabs.Screen
        name="more"
        options={{
          title: t.nav.more,
          tabBarAccessibilityLabel: t.nav.more,
          tabBarIcon: ({ color }) => <MoreIcon color={color} />,
        }}
      />
    </Tabs>
  );
}
