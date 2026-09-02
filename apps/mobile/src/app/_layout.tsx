/**
 * Root layout for the Tamanor native app.
 *
 * Responsibilities, in order: hold the splash screen until the brand faces are
 * ready, establish the safe-area and theme providers, hand the navigator a
 * navigation theme derived from our own tokens, and drive the status bar from
 * the active appearance.
 *
 * Route groups: this file is the single root. When M2 adds authentication the
 * intended shape is `src/app/(auth)/` for signed-out routes and `src/app/(app)/`
 * for signed-in ones, with the redirect decided here once session state exists.
 * Both groups are URL-transparent, so adding them will not change any path.
 */

import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider as NavigationThemeProvider,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppText, Button, Screen } from '@/components/ui';
import { TamanorThemeProvider, useBrandFonts, useTheme } from '@/theme';

// Must run at module scope, before the first render.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { ready, fontsReady } = useBrandFonts();

  useEffect(() => {
    if (ready) {
      void SplashScreen.hideAsync();
    }
  }, [ready]);

  // Holding the tree back until the faces resolve avoids a visible reflow from
  // the system font to Plus Jakarta Sans. The splash stays up meanwhile.
  if (!ready) {
    return null;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <TamanorThemeProvider fontsReady={fontsReady}>
          <ThemedNavigator />
        </TamanorThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Bridges the Tamanor theme into React Navigation, which owns the colours of
 * anything the navigator draws itself (screen background during transitions,
 * headers, card edges).
 */
function ThemedNavigator() {
  const theme = useTheme();

  const navigationTheme = useMemo(() => {
    const base = theme.scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: theme.scheme === 'dark',
      colors: {
        ...base.colors,
        primary: theme.colors.brand,
        background: theme.colors.background,
        card: theme.colors.surface,
        text: theme.colors.foreground,
        border: theme.colors.border,
        notification: theme.colors.danger,
      },
    };
  }, [theme]);

  return (
    <NavigationThemeProvider value={navigationTheme}>
      {/* `style` follows the appearance: light content on the dark canvas. */}
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      />
    </NavigationThemeProvider>
  );
}

/**
 * Root error boundary. Exporting `ErrorBoundary` from a layout route makes
 * Expo Router catch render errors beneath it and show this instead of an
 * unhandled crash — including in production builds, where there is no red box.
 */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return (
    <SafeAreaProvider>
      <TamanorThemeProvider>
        <Screen centered>
          <View style={styles.errorBody}>
            <AppText variant="title">Something went wrong</AppText>
            <AppText variant="body" tone="foregroundMuted">
              Tamanor hit an unexpected error and could not finish loading this screen.
            </AppText>
            <AppText variant="caption" tone="foregroundMuted" selectable>
              {error.message}
            </AppText>
            <Button
              label="Try again"
              onPress={() => void retry()}
              accessibilityHint="Reloads the screen that failed"
            />
          </View>
        </Screen>
      </TamanorThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  errorBody: { gap: 16 },
});
