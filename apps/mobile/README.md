# Tamanor Mobile

The native iOS and Android application for **Tamanor** — online reputation protection.

This is the native counterpart to `apps/web`, not a wrapper around it. There is no
WebView, no iframe and no remote rendering of tamanor.com anywhere in this app.

## Status — M1 (foundation)

The Expo starter template has been removed and replaced with the Tamanor
application shell: design tokens, theme provider, primitives, brand assets and a
single temporary foundation screen. **Authentication and product features are not
built yet.**

## Running it

Dependencies are installed from the monorepo root (`pnpm install`).

```bash
# From apps/mobile
pnpm ios          # iOS simulator
pnpm android      # Android device/emulator
pnpm typecheck
pnpm lint
pnpm doctor       # Expo dependency + config validation
```

The known-good local iOS command on this machine — LAN mode has previously timed
out, so development runs over localhost on a non-default port:

```bash
pnpm exec expo start --ios --localhost --port 8083
```

## Layout

```
src/
  app/            Expo Router routes (file-based)
    _layout.tsx   Root: splash gate, providers, navigator, error boundary
    index.tsx     Temporary foundation screen
    +not-found.tsx
  theme/          Design tokens and theme plumbing
    tokens.ts     Colour / spacing / radius / typography — the only design values
    theme.ts      Token assembly into the `Theme` object
    theme-provider.tsx
    fonts.ts      Plus Jakarta Sans loading
  components/
    brand/        Tamanor mark and lockup
    ui/           Screen, AppText, Card, Button, Divider, Loading
```

## Conventions

**Design values live in `src/theme/tokens.ts` and nowhere else.** Screens read
them via `useTheme()`. A literal hex code, font size or spacing number in a
screen or primitive is a bug.

The palette is ported from `apps/web/src/app/globals.css`, which is the design
source of truth: the `@theme` block supplies the light appearance and the
`.gu-dark` scope supplies the dark one. If the web brand changes, change
`tokens.ts` to match — do not diverge.

**Both platforms, always.** Every file here must run on iOS *and* Android. Do not
introduce an iOS-only module as app foundation. Where behaviour genuinely differs,
isolate it with `Platform.select` and say why in a comment, or use a `.ios.tsx` /
`.android.tsx` pair.

**Typography.** Android does not synthesise weights for custom fonts, so each
weight is registered as its own family and components select a family token
(`regular` / `medium` / `semibold` / `bold`), never a numeric `fontWeight`.

## Route groups (planned, M2)

Routing is a single root today. Authentication will introduce two URL-transparent
groups, with the signed-in/signed-out decision made once in `app/_layout.tsx`:

```
src/app/
  (auth)/    signed-out routes  — sign in, register, reset password
  (app)/     signed-in routes   — dashboard, accounts, inbox, alerts, …
```

Adding them will not change any existing path.
