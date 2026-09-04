/**
 * Catch-all for unknown paths — reachable today via a bad deep link
 * (`tamanor://…`), and later via stale in-app links.
 */

import { Link } from 'expo-router';
import { View } from 'react-native';

import { AppText, Screen } from '@/components/ui';
import { t } from '@/i18n';
import { useTheme } from '@/theme';

export default function NotFoundScreen() {
  const theme = useTheme();

  return (
    <Screen centered>
      <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <AppText variant="title">{t.common.notFoundTitle}</AppText>
        <AppText variant="body" tone="foregroundMuted" style={{ textAlign: 'center' }}>
          {t.common.notFoundBody}
        </AppText>
        <Link href="/" accessibilityRole="link" accessibilityHint="Returns to the home screen">
          <AppText variant="bodyStrong" tone="brand">
            {t.common.notFoundAction}
          </AppText>
        </Link>
      </View>
    </Screen>
  );
}
