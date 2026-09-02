/**
 * Assembles the raw tokens into the `Theme` object that components consume.
 */

import type { TextStyle } from 'react-native';

import {
  colors,
  fontFamily,
  fontWeight,
  radius,
  sizing,
  spacing,
  typography,
  type ColorTokens,
  type FontFamilyToken,
  type TypographyToken,
} from './tokens';

/** The two appearances the app can render in. */
export type ColorScheme = 'light' | 'dark';

/**
 * What the user has chosen. `system` follows the OS appearance and is the
 * default; the other two pin the app regardless of the OS.
 */
export type ThemePreference = ColorScheme | 'system';

export interface Theme {
  scheme: ColorScheme;
  colors: ColorTokens;
  spacing: typeof spacing;
  radius: typeof radius;
  sizing: typeof sizing;
  typography: typeof typography;
  /** Whether the Plus Jakarta Sans faces are registered and safe to reference. */
  fontsReady: boolean;
  /**
   * Resolves a type step to a React Native `TextStyle`. Kept on the theme (not
   * a free function) so a future per-scheme type adjustment has somewhere to go.
   */
  textStyle: (token: TypographyToken) => TextStyle;
  /**
   * The loaded family name for a weight token, or `undefined` while falling
   * back to the platform system font.
   */
  font: (token: FontFamilyToken) => string | undefined;
}

/**
 * `fontsReady` is threaded through because referencing a custom `fontFamily`
 * that never registered renders unstyled text on iOS and logs a hard font-asset
 * error on Android. Until the faces load — and permanently, if they fail — the
 * theme emits `fontWeight` against the system font instead, which both
 * platforms synthesise correctly.
 */
function buildTheme(scheme: ColorScheme, fontsReady: boolean): Theme {
  return {
    scheme,
    colors: colors[scheme],
    spacing,
    radius,
    sizing,
    typography,
    fontsReady,
    font: (token) => (fontsReady ? fontFamily[token] : undefined),
    textStyle: (token) => {
      const step = typography[token];
      return {
        fontSize: step.fontSize,
        lineHeight: step.lineHeight,
        ...(fontsReady
          ? { fontFamily: fontFamily[step.family] }
          : { fontWeight: fontWeight[step.family] }),
        ...('letterSpacing' in step ? { letterSpacing: step.letterSpacing } : null),
      };
    },
  };
}

const themes = {
  light: { true: buildTheme('light', true), false: buildTheme('light', false) },
  dark: { true: buildTheme('dark', true), false: buildTheme('dark', false) },
} as const;

export function themeFor(scheme: ColorScheme, fontsReady: boolean): Theme {
  return themes[scheme][fontsReady ? 'true' : 'false'];
}
