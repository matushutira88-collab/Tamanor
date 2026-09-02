/**
 * Verification gate.
 *
 * A password check alone does not grant product access. The account has a valid
 * server session, but `emailVerified` is false, so the app holds here — mirroring
 * the web flow, where an unverified user is redirected to /verify-email rather than
 * into the dashboard.
 *
 * Verification itself happens by email link (web). "I've verified" re-asks the
 * server; only the server's answer can move the app forward.
 */

import { useState } from 'react';
import { View } from 'react-native';

import { TamanorMark } from '@/components/brand/tamanor-mark';
import { AppText, Button, Card, Screen } from '@/components/ui';
import { useAuth } from '@/auth/auth-provider';
import { t } from '@/i18n';
import { useTheme } from '@/theme';

export default function VerifyEmailScreen() {
  const theme = useTheme();
  const { session, revalidate, signOut } = useAuth();
  const [checking, setChecking] = useState(false);

  return (
    <Screen scrollable centered>
      <View style={{ gap: theme.spacing.xl }}>
        <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
          <TamanorMark size={56} />
          <AppText variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t.auth.verifyTitle}
          </AppText>
        </View>

        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <AppText variant="body">
              {t.auth.verifySentTo}{' '}
              <AppText variant="bodyStrong">{session?.userEmail ?? 'your email address'}</AppText>.
            </AppText>
            <AppText variant="callout" tone="foregroundMuted">
              {t.auth.verifyBody}
            </AppText>
          </View>
        </Card>

        <View style={{ gap: theme.spacing.md }}>
          <Button
            label={checking ? t.auth.verifyChecking : t.auth.verifyCheck}
            busy={checking}
            block
            onPress={async () => {
              setChecking(true);
              try {
                await revalidate();
              } finally {
                setChecking(false);
              }
            }}
            accessibilityHint={t.auth.verifyHint}
          />
          <Button
            label={t.common.signOut}
            variant="secondary"
            block
            onPress={() => void signOut()}
            accessibilityHint={t.auth.signOutHint}
          />
        </View>
      </View>
    </Screen>
  );
}
