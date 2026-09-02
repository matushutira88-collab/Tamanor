/**
 * More — the overflow destination.
 *
 * Holds account context (plan, usage) that does not deserve permanent space in the
 * header, the secondary destinations the bottom bar cannot fit, and sign-out.
 *
 * Secondary destinations are listed only when the SERVER allowed them, and are
 * rendered disabled because their screens arrive in M4. That is honest about both
 * facts: you may see it, and it is not built yet.
 */

import { useState } from 'react';
import { View } from 'react-native';

import { AppHeader } from '@/components/shell/app-header';
import { AppText, Button, Card, Divider, Screen, SectionHeader } from '@/components/ui';
import { useAuth } from '@/auth/auth-provider';
import { useShell } from '@/shell/shell-provider';
import type { NavKey } from '@/api/types';
import { t } from '@/i18n';
import { useTheme } from '@/theme';

/** Destinations that live under More rather than in the bottom bar. */
const SECONDARY: NavKey[] = ['activity', 'rules', 'billing', 'team', 'settings'];

export default function MoreScreen() {
  const theme = useTheme();
  const { signOut } = useAuth();
  const { bootstrap, allowedNav } = useShell();
  const [signingOut, setSigningOut] = useState(false);
  const [revokeWarning, setRevokeWarning] = useState(false);

  const secondary = SECONDARY.filter((key) => allowedNav.includes(key));

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xl, paddingBottom: theme.spacing.xxl }}>
        <AppHeader title={t.nav.more} workspaceName={bootstrap?.workspace.name} />

        {bootstrap ? (
          <Card>
            <View style={{ gap: theme.spacing.sm }}>
              <AppText variant="bodyStrong">{bootstrap.user.name}</AppText>
              <AppText variant="caption" tone="foregroundMuted">
                {bootstrap.user.email}
              </AppText>
              <Divider spacing={theme.spacing.md} />
              {bootstrap.access.planName ? (
                <Row label="Plan" value={bootstrap.access.planName} />
              ) : null}
              <Row
                label={t.usage.processedItems}
                value={formatUsage(bootstrap.usage.processedItems)}
              />
              <Row label={t.usage.accounts} value={formatUsage(bootstrap.usage.accounts)} />
            </View>
          </Card>
        ) : null}

        {secondary.length > 0 ? (
          <View>
            <SectionHeader title={t.nav.more} />
            <Card>
              <View style={{ gap: theme.spacing.md }}>
                {secondary.map((key) => (
                  <View
                    key={key}
                    accessible
                    accessibilityLabel={`${t.nav[key]}. ${t.common.comingSoon}`}
                    style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md }}>
                    <AppText variant="callout" tone="foregroundMuted">
                      {t.nav[key]}
                    </AppText>
                    <AppText variant="caption" tone="foregroundMuted">
                      {t.common.comingSoon}
                    </AppText>
                  </View>
                ))}
              </View>
            </Card>
          </View>
        ) : null}

        {revokeWarning ? (
          <View
            accessibilityRole="alert"
            style={{
              backgroundColor: theme.colors.warningSoft,
              borderRadius: theme.radius.md,
              padding: theme.spacing.lg,
            }}>
            <AppText variant="callout" tone="warning">
              You are signed out on this device, but Tamanor could not confirm the session was ended
              on the server.
            </AppText>
          </View>
        ) : null}

        <Button
          label={t.common.signOut}
          variant="secondary"
          block
          busy={signingOut}
          onPress={async () => {
            setSigningOut(true);
            try {
              const { serverRevoked } = await signOut();
              if (!serverRevoked) setRevokeWarning(true);
            } finally {
              setSigningOut(false);
            }
          }}
        />
      </View>
    </Screen>
  );
}

/** `limit: null` means unlimited on this plan — never render it as a number. */
function formatUsage({ used, limit }: { used: number; limit: number | null }): string {
  return limit === null ? `${used} · ${t.common.unlimited}` : `${used} ${t.common.of} ${limit}`;
}

function Row({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.lg }}>
      <AppText variant="caption" tone="foregroundMuted">
        {label}
      </AppText>
      <AppText variant="caption" style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </AppText>
    </View>
  );
}
