/**
 * Root layout for the Tamanor native app.
 *
 * Order of responsibility: hold the splash until the brand faces are ready,
 * establish safe-area / theme / auth providers, then mount the navigator with
 * DECLARATIVE route guards.
 *
 * Route protection uses `Stack.Protected`. When a guard is false the screens are
 * not registered with the navigator at all, so a deep link into `(app)` cannot
 * resolve without a server-validated session — and because exactly one guard is
 * true for every auth state, there is no redirect loop to avoid.
 *
 * Nothing inside `(app)` renders while the session is still being validated: the
 * boot screen replaces the navigator entirely during `booting`.
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

import { TamanorMark } from '@/components/brand/tamanor-mark';
import { AppText, Button, Loading, Screen } from '@/components/ui';
import { AuthProvider, useAuth } from '@/auth/auth-provider';
import { canEnterApp, isBooting } from '@/auth/auth-machine';
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
          <AuthProvider>
            <ThemedNavigator />
          </AuthProvider>
        </TamanorThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Bridges the Tamanor theme into React Navigation, which owns the colours of
 * anything the navigator draws itself, and applies the auth route guards.
 */
function ThemedNavigator() {
  const theme = useTheme();
  const { state } = useAuth();

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

  const signedIn = canEnterApp(state);

  return (
    <NavigationThemeProvider value={navigationTheme}>
      {/* `style` follows the appearance: light content on the dark canvas. */}
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      {isBooting(state) ? (
        <BootScreen />
      ) : (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.background },
          }}>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
        </Stack>
      )}
    </NavigationThemeProvider>
  );
}

/**
 * Shown while the stored token is being validated against the server. This is a
 * real screen rather than a blank frame, and it is what guarantees no protected
 * content is ever painted before validation completes.
 */
function BootScreen() {
  const theme = useTheme();
  return (
    <Screen centered>
      <View style={{ alignItems: 'center', gap: theme.spacing.xl }}>
        <TamanorMark size={64} />
        <Loading label="Checking your session" />
      </View>
    </Screen>
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
