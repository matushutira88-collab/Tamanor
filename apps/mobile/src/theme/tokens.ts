/**
 * Tamanor design tokens — the single source of design values for the native app.
 *
 * Every colour, space, radius and type step lives here. Screens and primitives
 * read them through `useTheme()`; nothing outside `src/theme` should contain a
 * literal design value.
 *
 * The palette is ported verbatim from the web product, which is the design
 * source of truth: `apps/web/src/app/globals.css` — `@theme` supplies the light
 * appearance and the `.gu-dark` scope supplies the dark appearance.
 */

/* -------------------------------------------------------------------------- */
/* Colour                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The colour roles a Tamanor surface can reference. Both appearances implement
 * the same role set, so a component never needs to branch on the scheme.
 */
export interface ColorTokens {
  /** App canvas, behind everything. */
  background: string;
  /** Slightly raised canvas (sheets, grouped sections). */
  backgroundElevated: string;
  /** Primary container colour — cards, list rows. */
  surface: string;
  /** Recessed container — inset blocks, code, secondary fills. */
  surfaceSunken: string;

  /** Hairlines and container edges. */
  border: string;
  /** Emphasised edges — focused fields, dividers that must read. */
  borderStrong: string;

  /** Primary text. */
  foreground: string;
  /** Secondary/supporting text. Meets 4.5:1 on `background`. */
  foregroundMuted: string;

  /** Tamanor accent — the brand colour used for primary actions. */
  brand: string;
  /** Pressed/active accent. */
  brandStrong: string;
  /** Tinted accent wash for badges and soft fills. */
  brandSoft: string;
  /** Text/icon colour that sits on top of `brand`. */
  brandOn: string;

  /** Positive state. */
  success: string;
  successSoft: string;
  /** Cautionary state. */
  warning: string;
  warningSoft: string;
  /** Destructive/critical state. */
  danger: string;
  dangerSoft: string;

  /** Neutral tint for inert badges and chips. */
  neutralSoft: string;
}

/** Light appearance — `@theme` in apps/web/src/app/globals.css. */
const lightColors: ColorTokens = {
  background: '#f8fafc',
  backgroundElevated: '#ffffff',
  surface: '#ffffff',
  surfaceSunken: '#f1f5f9',

  border: '#e5e7eb',
  borderStrong: '#d1d5db',

  foreground: '#111827',
  foregroundMuted: '#6b7280',

  brand: '#2563eb',
  brandStrong: '#1d4ed8',
  brandSoft: '#dbeafe',
  brandOn: '#ffffff',

  success: '#16a34a',
  successSoft: '#dcfce7',
  warning: '#b45309',
  warningSoft: '#fef3c7',
  danger: '#dc2626',
  dangerSoft: '#fee2e2',

  neutralSoft: '#f1f5f9',
};

/** Dark appearance — the `.gu-dark` scope in apps/web/src/app/globals.css. */
const darkColors: ColorTokens = {
  background: '#040d0c',
  backgroundElevated: '#07100f',
  surface: '#091a18',
  surfaceSunken: '#0e2321',

  border: '#16332f',
  borderStrong: '#21504a',

  foreground: '#eaf6f3',
  foregroundMuted: '#8aa8a2',

  brand: '#1fd0a4',
  brandStrong: '#14b48f',
  brandSoft: '#0c3a34',
  brandOn: '#04120f',

  success: '#34d399',
  successSoft: '#0e352a',
  warning: '#f3b657',
  warningSoft: '#33270f',
  danger: '#ff6b7a',
  dangerSoft: '#341620',

  neutralSoft: '#123330',
};

export const colors = { light: lightColors, dark: darkColors } as const;

/* -------------------------------------------------------------------------- */
/* Spacing                                                                     */
/* -------------------------------------------------------------------------- */

/** 4pt spacing scale, matching the web product's Tailwind rhythm. */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export type SpacingToken = keyof typeof spacing;

/* -------------------------------------------------------------------------- */
/* Radius                                                                      */
/* -------------------------------------------------------------------------- */

/** `--radius` / `--radius-lg` from the web tokens, plus the ends of the scale. */
export const radius = {
  none: 0,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export type RadiusToken = keyof typeof radius;

/* -------------------------------------------------------------------------- */
/* Typography                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Plus Jakarta Sans is the single Tamanor typeface (web uses it for headings and
 * body alike — see `--font-app` in globals.css).
 *
 * Android will not synthesise a weight for a custom font: asking for
 * `fontWeight: '600'` on a family that only ships Regular silently renders
 * Regular. So every weight is a separately registered family and components
 * select a *family*, never a numeric weight. `src/theme/fonts.ts` registers
 * these names and falls back to the platform system font until they load.
 */
export const fontFamily = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
} as const;

export type FontFamilyToken = keyof typeof fontFamily;

/**
 * Numeric equivalents of the weight tokens, used only by the system-font
 * fallback path (see `Theme.textStyle`). The platform system font — SF on iOS,
 * Roboto on Android — does synthesise these correctly.
 */
export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const satisfies Record<FontFamilyToken, TextStyleWeight>;

type TextStyleWeight = '400' | '500' | '600' | '700';

/** A named type step: size, leading, weight-family and tracking. */
export interface TypeStep {
  fontSize: number;
  lineHeight: number;
  family: FontFamilyToken;
  letterSpacing?: number;
}

/**
 * The type scale. `display` mirrors the web `.gu-display` treatment (semibold,
 * tight tracking); the rest is a conventional native ramp.
 *
 * These are *unscaled* base values — text still honours the OS font-size
 * setting, because every `AppText` renders with `allowFontScaling` on.
 */
export const typography = {
  display: { fontSize: 32, lineHeight: 38, family: 'bold', letterSpacing: -0.5 },
  title: { fontSize: 24, lineHeight: 30, family: 'bold', letterSpacing: -0.3 },
  heading: { fontSize: 18, lineHeight: 24, family: 'semibold', letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 24, family: 'regular' },
  bodyStrong: { fontSize: 16, lineHeight: 24, family: 'semibold' },
  callout: { fontSize: 15, lineHeight: 22, family: 'medium' },
  caption: { fontSize: 13, lineHeight: 18, family: 'medium' },
  overline: { fontSize: 12, lineHeight: 16, family: 'semibold', letterSpacing: 0.8 },
} as const satisfies Record<string, TypeStep>;

export type TypographyToken = keyof typeof typography;

/* -------------------------------------------------------------------------- */
/* Sizing                                                                      */
/* -------------------------------------------------------------------------- */

export const sizing = {
  /**
   * Minimum interactive edge. 44pt satisfies both the iOS HIG (44x44pt) and
   * Android's Material target (48dp ≈ 44pt at most densities, and Android
   * additionally expands the touch slop), so one value covers both platforms.
   */
  minTouchTarget: 44,
  /** Comfortable reading measure — also the tablet content cap. */
  maxContentWidth: 560,
  /** Default control height. */
  controlHeight: 48,
} as const;
