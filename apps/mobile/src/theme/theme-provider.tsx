/**
 * Theme plumbing: resolves the active appearance and exposes it to the tree.
 *
 * Appearance resolution order:
 *   1. an explicit user preference (`light` / `dark`), when set
 *   2. otherwise the OS appearance reported by `useColorScheme()`
 *   3. otherwise `light`
 *
 * The preference lives in memory for now. When M2 introduces persisted
 * settings, only the `useState` here needs to become a persisted store — no
 * consumer changes.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { themeFor, type ColorScheme, type Theme, type ThemePreference } from './theme';

interface ThemeContextValue {
  theme: Theme;
  /** The appearance actually being rendered. */
  scheme: ColorScheme;
  /** What the user asked for — `system` unless they pinned an appearance. */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function TamanorThemeProvider({
  children,
  fontsReady = false,
  initialPreference = 'system',
}: {
  children: ReactNode;
  /** Whether the brand faces registered — see `./fonts`. */
  fontsReady?: boolean;
  initialPreference?: ThemePreference;
}) {
  const [preference, setPreference] = useState<ThemePreference>(initialPreference);
  // `null` on the first frame and whenever the OS reports no preference.
  const systemScheme = useColorScheme();

  const value = useMemo<ThemeContextValue>(() => {
    const scheme: ColorScheme =
      preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

    return { theme: themeFor(scheme, fontsReady), scheme, preference, setPreference };
  }, [preference, systemScheme, fontsReady]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function useThemeContext(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside <TamanorThemeProvider>.');
  }
  return value;
}

/** The active theme — the usual entry point for components. */
export function useTheme(): Theme {
  return useThemeContext().theme;
}

/** Appearance state and control, for a future Settings screen. */
export function useAppearance() {
  const { scheme, preference, setPreference } = useThemeContext();
  return { scheme, preference, setPreference };
}
