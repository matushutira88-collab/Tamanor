/**
 * Temporary foundation screen.
 *
 * Confirms the brand, the theme and the primitives all render natively. M2
 * replaces this route with the authentication flow under `src/app/(auth)/`.
 */

import { View } from 'react-native';

import { TamanorMark } from '@/components/brand/tamanor-mark';
import { AppText, Card, Divider, Screen } from '@/components/ui';
import { useAppearance, useTheme } from '@/theme';

export default function FoundationScreen() {
  const theme = useTheme();
  const { scheme, preference } = useAppearance();

  return (
    <Screen scrollable centered>
      <View style={{ alignItems: 'center', gap: theme.spacing.xl }}>
        <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
          {/* The mark is decorative here — the heading below already announces
              the brand, so labelling it too would read "Tamanor" twice. */}
          <TamanorMark size={72} />
          <AppText variant="display" accessibilityRole="header">
            Tamanor
          </AppText>
          <AppText variant="callout" tone="foregroundMuted" style={{ textAlign: 'center' }}>
            Online reputation protection
          </AppText>
        </View>

        <Card style={{ alignSelf: 'stretch' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            {/* The dot is decorative; the adjacent text carries the state, so
                nothing here is communicated by colour alone. */}
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                width: 8,
                height: 8,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.success,
              }}
            />
            <AppText variant="bodyStrong">Mobile foundation ready</AppText>
          </View>

          <Divider spacing={theme.spacing.lg} />

          <View style={{ gap: theme.spacing.sm }}>
            <DetailRow label="Build" value="M1 · foundation" />
            <DetailRow label="Platforms" value="iOS · Android" />
            <DetailRow
              label="Appearance"
              value={preference === 'system' ? `System (${scheme})` : scheme}
            />
            <DetailRow label="Typeface" value={theme.fontsReady ? 'Plus Jakarta Sans' : 'System'} />
          </View>
        </Card>

        <AppText variant="caption" tone="foregroundMuted" style={{ textAlign: 'center' }}>
          Authentication arrives in the next milestone.
        </AppText>
      </View>
    </Screen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();

  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: theme.spacing.lg,
      }}>
      <AppText variant="caption" tone="foregroundMuted">
        {label}
      </AppText>
      {/* `flexShrink` lets long values wrap instead of pushing the row wide,
          which matters at large OS text sizes on small phones. */}
      <AppText variant="caption" style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </AppText>
    </View>
  );
}
