/**
 * Catch-all for unknown paths — reachable today via a bad deep link
 * (`tamanor://…`), and later via stale in-app links.
 */

import { Link } from 'expo-router';
import { View } from 'react-native';

import { AppText, Screen } from '@/components/ui';
import { useTheme } from '@/theme';

export default function NotFoundScreen() {
  const theme = useTheme();

  return (
    <Screen centered>
      <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <AppText variant="title">Page not found</AppText>
        <AppText variant="body" tone="foregroundMuted" style={{ textAlign: 'center' }}>
          That link does not point anywhere in Tamanor.
        </AppText>
        <Link href="/" accessibilityRole="link" accessibilityHint="Returns to the home screen">
          <AppText variant="bodyStrong" tone="brand">
            Go to the start
          </AppText>
        </Link>
      </View>
    </Screen>
  );
}
