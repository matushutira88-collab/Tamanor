/**
 * Fail-closed workspace outcome.
 *
 * The session is valid and verified, but the server reported a workspace kind the
 * mobile app does not support (or could not classify). The app refuses to guess —
 * it never falls back to Business — so this is a terminal state until the account
 * is sorted out on the web.
 */

import { View } from 'react-native';

import { TamanorMark } from '@/components/brand/tamanor-mark';
import { AppText, Button, Card, Screen } from '@/components/ui';
import { useAuth } from '@/auth/auth-provider';
import { useTheme } from '@/theme';

export default function UnsupportedWorkspaceScreen() {
  const theme = useTheme();
  const { session, signOut } = useAuth();

  return (
    <Screen scrollable centered>
      <View style={{ gap: theme.spacing.xl }}>
        <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
          <TamanorMark size={56} />
          <AppText variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
            Workspace not available
          </AppText>
        </View>

        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <AppText variant="body">
              {session?.tenantName
                ? `“${session.tenantName}” cannot be opened in the Tamanor mobile app yet.`
                : 'This workspace cannot be opened in the Tamanor mobile app yet.'}
            </AppText>
            <AppText variant="callout" tone="foregroundMuted">
              Sign in at tamanor.com to continue, or switch to a workspace the app supports.
            </AppText>
          </View>
        </Card>

        <Button
          label="Sign out"
          variant="secondary"
          block
          onPress={() => void signOut()}
          accessibilityHint="Signs out and returns to the sign-in screen"
        />
      </View>
    </Screen>
  );
}
