/**
 * Authenticated home — an M2 placeholder.
 *
 * Confirms end to end that a real Tamanor session was established and validated by
 * the server, and gives logout somewhere to live. The dashboard, inbox, alerts and
 * the rest of the product arrive in later milestones.
 */

import { useState } from 'react';
import { View } from 'react-native';

import { TamanorMark } from '@/components/brand/tamanor-mark';
import { AppText, Button, Card, Divider, Screen } from '@/components/ui';
import { useAuth } from '@/auth/auth-provider';
import { useTheme } from '@/theme';

export default function HomeScreen() {
  const theme = useTheme();
  const { session, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [revokeWarning, setRevokeWarning] = useState(false);

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xl, paddingVertical: theme.spacing.xxl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <TamanorMark size={36} />
          <View style={{ flexShrink: 1 }}>
            <AppText variant="heading" accessibilityRole="header">
              {session?.tenantName ?? 'Tamanor'}
            </AppText>
            <AppText variant="caption" tone="foregroundMuted">
              Online reputation protection
            </AppText>
          </View>
        </View>

        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="bodyStrong">Signed in</AppText>
            <Divider spacing={theme.spacing.md} />
            <Row label="Name" value={session?.userName ?? '—'} />
            <Row label="Email" value={session?.userEmail ?? '—'} />
            <Row label="Workspace" value={session?.workspace ?? '—'} />
            <Row label="Role" value={session?.role ?? '—'} />
          </View>
        </Card>

        <Card variant="sunken">
          <AppText variant="callout" tone="foregroundMuted">
            Mobile authentication foundation (M2). Dashboard, inbox, alerts and protection rules
            arrive in the next milestones.
          </AppText>
        </Card>

        {revokeWarning ? (
          <View
            accessibilityRole="alert"
            style={{
              backgroundColor: theme.colors.warningSoft,
              borderRadius: theme.radius.md,
              padding: theme.spacing.lg,
            }}>
            <AppText variant="callout" tone="warning">
              You are signed out on this device, but Tamanor could not confirm the session was
              ended on the server. If this device was lost, sign out everywhere from tamanor.com.
            </AppText>
          </View>
        ) : null}

        <Button
          label={signingOut ? 'Signing out…' : 'Sign out'}
          variant="secondary"
          block
          busy={signingOut}
          onPress={async () => {
            setSigningOut(true);
            try {
              const { serverRevoked } = await signOut();
              // The provider has already cleared local credentials; surface the
              // truth about server-side revocation rather than implying success.
              if (!serverRevoked) setRevokeWarning(true);
            } finally {
              setSigningOut(false);
            }
          }}
          accessibilityHint="Ends your Tamanor session on this device"
        />
      </View>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: theme.spacing.lg,
      }}>
      <AppText variant="caption" tone="foregroundMuted">
        {label}
      </AppText>
      <AppText variant="caption" style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </AppText>
    </View>
  );
}
