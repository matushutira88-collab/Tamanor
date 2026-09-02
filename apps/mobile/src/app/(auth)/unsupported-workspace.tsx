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
import { t } from '@/i18n';
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
            {t.auth.unsupportedTitle}
          </AppText>
        </View>

        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <AppText variant="body">
              {session?.tenantName
                ? t.auth.unsupportedNamed(session.tenantName)
                : t.auth.unsupportedGeneric}
            </AppText>
            <AppText variant="callout" tone="foregroundMuted">
              {t.auth.unsupportedBody}
            </AppText>
          </View>
        </Card>

        <Button
          label={t.common.signOut}
          variant="secondary"
          block
          onPress={() => void signOut()}
          accessibilityHint={t.auth.signOutHint}
        />
      </View>
    </Screen>
  );
}
