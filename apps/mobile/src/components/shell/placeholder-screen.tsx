/**
 * `PlaceholderScreen` — a truthful "not built yet" destination.
 *
 * M3 ships the navigation shell, not these features. The screen says so plainly
 * and points at the web, rather than showing an empty list that reads as "you have
 * nothing" — which would be a lie.
 */

import { View } from 'react-native';

import { AppHeader } from './app-header';
import { EmptyState, Screen } from '@/components/ui';
import { useShell } from '@/shell/shell-provider';
import { t } from '@/i18n';
import { useTheme } from '@/theme';

export function PlaceholderScreen({ title }: { title: string }) {
  const theme = useTheme();
  const { bootstrap } = useShell();

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xl }}>
        <AppHeader title={title} workspaceName={bootstrap?.workspace.name} />
        <EmptyState title={t.common.comingSoon} body={t.common.comingSoonBody} />
      </View>
    </Screen>
  );
}
