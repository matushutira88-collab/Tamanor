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
            Verify your email
          </AppText>
        </View>

        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <AppText variant="body">
              We sent a verification link to{' '}
              <AppText variant="bodyStrong">{session?.userEmail ?? 'your email address'}</AppText>.
            </AppText>
            <AppText variant="callout" tone="foregroundMuted">
              Open that link, then come back and continue. Tamanor keeps your account locked until
              the address is confirmed.
            </AppText>
          </View>
        </Card>

        <View style={{ gap: theme.spacing.md }}>
          <Button
            label={checking ? 'Checking…' : "I've verified my email"}
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
            accessibilityHint="Asks Tamanor to check whether your email is now verified"
          />
          <Button
            label="Sign out"
            variant="secondary"
            block
            onPress={() => void signOut()}
            accessibilityHint="Signs out and returns to the sign-in screen"
          />
        </View>
      </View>
    </Screen>
  );
}
