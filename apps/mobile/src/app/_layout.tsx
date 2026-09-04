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
 * Nothing inside `(app)` renders while the session is still being validated. That
 * holds because `canEnterApp` is false for every non-authenticated state, `booting`
 * included — not because the navigator is absent. Since M10B the navigator stays
 * mounted and the boot screen covers it as an overlay, so an incoming OAuth deep
 * link has something to resolve against instead of being dropped.
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
import { useOAuthReturnAuthGate, useOAuthReturnCapture } from '@/oauth/use-oauth-return';
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

  // M10D — feed native OAuth return URLs into the coordinator. CAPTURE ONLY: this
  // never navigates. It lives at the root because a cold return arrives at
  // `getInitialURL()` before the auth machine has booted and long before `(app)`
  // mounts, so the id has to be caught above both. The declarative redirect that
  // acts on it lives in `(app)/_layout.tsx`, inside a live navigator.
  useOAuthReturnCapture();
  // …and drop it once auth is authoritatively unusable. Still no navigation.
  useOAuthReturnAuthGate({ booting: isBooting(state), canEnterApp: canEnterApp(state) });

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
      {/*
        M10B — the navigator is ALWAYS mounted, and the boot screen covers it as an
        OVERLAY rather than replacing it.

        Replacing it was why a cold OAuth return was lost: `tamanor://oauth/callback`
        launches the app, but with no navigator mounted there is nothing for Expo
        Router to resolve the incoming URL against, so the destination was silently
        dropped and the app settled on its default route.

        The security property is unchanged, because it never depended on this branch:
        `(app)` renders only under `guard={signedIn}`, and `canEnterApp` is false for
        every non-authenticated state including `booting`. Nothing inside `(app)` can
        paint before the session is server-validated. `(auth)` additionally excludes
        `booting` so a login screen cannot flash behind the overlay.
      */}
      <View style={styles.root}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.background },
          }}>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn && !isBooting(state)}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
          {/*
            M10B — the OAuth return URL (`tamanor://oauth/callback?flow=…`) must
            resolve to a real screen in EVERY auth state, so it is declared here at
            the root rather than inside a group a guard can hide. Undeclared, it
            fell through to `+not-found` on a warm return and had no destination at
            all on a cold one.

            Declaring it grants no access: the screen is a dispatcher that resolves
            the auth state itself and sends an unauthenticated arrival back to the
            root. `(app)` remains reachable only through its own guard.
          */}
          <Stack.Screen name="oauth/callback" />
        </Stack>
        {isBooting(state) ? (
          <View style={StyleSheet.absoluteFill}>
            <BootScreen />
          </View>
        ) : null}
      </View>
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
