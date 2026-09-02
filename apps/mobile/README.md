# Tamanor Mobile

The native iOS and Android application for **Tamanor** — online reputation protection.

This is the native counterpart to `apps/web`, not a wrapper around it. There is no
WebView, no iframe and no remote rendering of tamanor.com anywhere in this app.

## Status — M2 (authentication foundation)

Real email/password authentication against the existing Tamanor server session, a
Keychain/Keystore-backed session token, authoritative session validation on launch,
and protected route groups. **No product features yet** — the authenticated screen
is a placeholder.

## Running it

Dependencies are installed from the monorepo root (`pnpm install`).

```bash
cp .env.example .env          # then point it at your API

# From apps/mobile
pnpm ios          # iOS simulator
pnpm android      # Android device/emulator
pnpm typecheck    # app + Node test scripts
pnpm lint
pnpm doctor       # Expo dependency + config validation
```

From the repo root:

```bash
pnpm mobile-auth-client:test  # mobile auth client (pure)
pnpm mobile-auth:test         # server mobile auth API (pure)
pnpm mobile-auth-db:test      # bearer transport vs. real Postgres (needs a DB)
```

`expo start --localhost` binds Metro to IPv6 `::1` only, so Expo Go's
`exp://127.0.0.1:PORT` deep link cannot reach it. Use the default (LAN) host, which
binds all interfaces:

```bash
pnpm exec expo start --port 8084
```

## Configuration

One public variable, inlined at build time:

```
EXPO_PUBLIC_TAMANOR_API_URL=https://tamanor.com
```

`EXPO_PUBLIC_*` values are readable by anyone with the app, so **nothing secret may
ever go there** — no database URL, server secret, OAuth client secret, encryption
key, Turnstile secret or session secret. The app holds none of those; it
authenticates with an opaque session token the server issues at login.

HTTPS is required unless this is a development build talking to a loopback or
private-range host. A missing or invalid value fails loudly rather than silently
falling back (`src/api/config.ts`).

`app.config.ts` was deliberately **not** introduced: Expo already inlines
`EXPO_PUBLIC_*` from the environment and `.env`, so a dynamic config would add a
moving part without enabling anything.

## Layout

```
src/
  app/                      Expo Router routes
    _layout.tsx             Providers, boot screen, declarative route guards
    (auth)/                 Signed-out and not-yet-eligible
      login.tsx
      verify-email.tsx
      unsupported-workspace.tsx
    (app)/                  Signed-in only
      index.tsx
    +not-found.tsx
  api/
    config.ts               Base URL resolution + validation
    client.ts               fetch + timeout + bearer + bounded error mapping
    auth.ts                 login / session / logout
    types.ts                Wire types (mirror apps/web/src/server/mobile-auth.ts)
  auth/
    session-storage.ts      SecureStore binding (read/write/delete only)
    session-storage-core.ts Storage policy, testable off-device
    auth-machine.ts         Pure state-machine reducer
    auth-flows.ts           Pure orchestration (bootstrap/sign-in/sign-out)
    auth-provider.tsx       React wiring + AppState revalidation
  theme/                    Design tokens (see below)
  components/               brand/ and ui/ primitives
```

## Authentication

**The server is the only authority.** The app holds an opaque random token issued by
`createUserSession` — the same token the web cookie carries. It is not a JWT and
encodes nothing: no user id, tenant, role or email. Identity is re-resolved
server-side from the `UserSession` row on every request.

Transport is `Authorization: Bearer <token>` against three routes in `apps/web`:
`POST /api/mobile/auth/login`, `GET /api/mobile/auth/session`,
`POST /api/mobile/auth/logout`.

**States** (`auth-machine.ts`): `booting → unauthenticated | authenticating |
authenticated | verification_required | workspace_unsupported | session_expired |
error`. `authenticated` is reachable ONLY from a server-validated session that is
email-verified and in a supported workspace. No connectivity failure can produce it.

**On cold start** the app reads the token, calls the session endpoint, and renders a
boot screen until the answer arrives — protected content is never painted first. A
definitive rejection deletes the token; a network failure keeps it and shows a
retryable error, because an unreachable server is not evidence of an invalid session.

**Route protection** uses `Stack.Protected`. When a guard is false the screens are
not registered with the navigator at all, so a deep link into `(app)` cannot resolve
without a valid session — and because exactly one guard is true per state, there is
no redirect loop.

**Logout** revokes server-side first, then clears local storage unconditionally. If
revocation could not be confirmed the UI says so rather than implying success.

### Security invariants

- The token lives only in `expo-secure-store` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), never
  in AsyncStorage, React state, the filesystem, logs, crash reports, analytics, or a URL.
- Nothing in the auth path calls `console.*`.
- The login screen renders one of a fixed set of sentences; raw server text never reaches it.
- "No such account" and "wrong password" are indistinguishable, by design.
- An unknown workspace fails closed — never a Business default.

## Known follow-ups

- **Native bot challenge.** The server's adaptive Turnstile challenge is enforced for
  mobile exactly as for web. The app cannot yet *complete* one, so a challenged login
  fails closed with `challenge_required` and tells the user to sign in on the web. A
  native challenge flow is M2B. There is deliberately no bypass header or mobile secret.
- **Registration / password recovery** stay on the web; the app links there in copy only.
- **Session rotation / refresh.** The server enforces idle and absolute ceilings. When a
  long-lived mobile session needs rotation, that endpoint should be designed explicitly —
  no long-lived JWT and no automatic infinite refresh.
- **Full workspace destination.** The app receives a `business | family | unsupported`
  discriminator. Family onboarding step resolution (`resolveWorkspaceDestination`) is a
  server DB call and is not wired yet.

## Conventions

**Design values live in `src/theme/tokens.ts` and nowhere else.** Screens read them via
`useTheme()`. A literal hex code, font size or spacing number in a screen is a bug.

The palette is ported from `apps/web/src/app/globals.css`: the `@theme` block supplies
the light appearance, the `.gu-dark` scope the dark one. If the web brand changes,
change `tokens.ts` to match.

**Both platforms, always.** Every file must run on iOS *and* Android. Where behaviour
differs, isolate it with `Platform.select` and say why, or use a `.ios.tsx` /
`.android.tsx` pair.

**Typography.** Android does not synthesise weights for custom fonts, so each weight is
its own registered family and components select a family token, never a numeric
`fontWeight`.

**Tests are plain `tsx` scripts** with a `check()` counter, matching the rest of the
monorepo — no extra test framework. This is only possible because the security-relevant
logic is kept out of React: the machine, flows, storage policy and error mapping are all
plain functions over injected dependencies.
