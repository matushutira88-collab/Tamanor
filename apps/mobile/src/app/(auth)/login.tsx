/**
 * Native sign-in.
 *
 * Error handling is deliberately blunt: the server's bounded code is mapped to one
 * of a handful of fixed sentences. A raw server message is never rendered, and
 * "no such account" and "wrong password" share one wording so the screen cannot be
 * used to discover whether an email is registered.
 *
 * The password is held in component state only for the lifetime of the form and is
 * never logged, persisted or included in any error.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, TextInput, View, type TextInput as TextInputType } from 'react-native';

import { TamanorMark } from '@/components/brand/tamanor-mark';
import { AppText, Button, Card, Screen } from '@/components/ui';
import { useAuth } from '@/auth/auth-provider';
import type { ApiErrorCode } from '@/api/types';
import { t } from '@/i18n';
import { useTheme } from '@/theme';

/** One fixed sentence per bounded code. Never interpolates server text. */
function messageFor(error: ApiErrorCode): string {
  switch (error) {
    case 'invalid_credentials':
      // Identical for a missing account and a wrong password — by design.
      return t.auth.errInvalid;
    case 'rate_limited':
      return t.auth.errRateLimited;
    case 'challenge_required':
      return t.auth.errChallenge;
    case 'invalid_request':
      return t.auth.errMissingFields;
    case 'network':
      return t.auth.errNetwork;
    case 'timeout':
      return t.auth.errTimeout;
    case 'config':
      return t.auth.errConfig;
    case 'unauthenticated':
    case 'session_expired':
    case 'session_revoked':
    case 'server_error':
    default:
      return t.auth.errGeneric;
  }
}

export default function LoginScreen() {
  const theme = useTheme();
  const { state, signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [revealPassword, setRevealPassword] = useState(false);
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const passwordRef = useRef<TextInputType>(null);

  const busy = state.status === 'authenticating';
  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  // The machine reports an ended session; show it once, above the form.
  const expiredNotice = state.status === 'session_expired';

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setError(null);
    const failure = await signIn({ email, password, rememberMe });
    if (failure) {
      setError(failure);
      // Clear the password on a rejected attempt so a shoulder-surfer or a left-open
      // screen does not retain it; the email stays for convenience.
      setPassword('');
    }
  }, [canSubmit, signIn, email, password, rememberMe]);

  const fieldStyle = useMemo(
    () => ({
      minHeight: theme.sizing.minTouchTarget,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      color: theme.colors.foreground,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      ...theme.textStyle('body'),
    }),
    [theme],
  );

  return (
    <Screen scrollable centered>
      <View style={{ gap: theme.spacing.xl }}>
        <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
          {/* Decorative — the heading below announces the brand. */}
          <TamanorMark size={56} />
          <AppText variant="title" accessibilityRole="header">
            {t.auth.signInTitle}
          </AppText>
          <AppText variant="callout" tone="foregroundMuted" style={{ textAlign: 'center' }}>
            {t.auth.tagline}
          </AppText>
        </View>

        {expiredNotice ? (
          <Card variant="sunken">
            <AppText variant="callout">
              {t.auth.sessionEnded}
            </AppText>
          </Card>
        ) : null}

        <View style={{ gap: theme.spacing.lg }}>
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="caption" tone="foregroundMuted" nativeID="login-email-label">
              {t.auth.email}
            </AppText>
            <TextInput
              value={email}
              onChangeText={setEmail}
              style={fieldStyle}
              placeholder={t.auth.emailPlaceholder}
              placeholderTextColor={theme.colors.foregroundMuted}
              accessibilityLabel={t.auth.email}
              accessibilityLabelledBy="login-email-label"
              keyboardType="email-address"
              textContentType="username"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              editable={!busy}
              onSubmitEditing={() => passwordRef.current?.focus()}
              submitBehavior="submit"
            />
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="caption" tone="foregroundMuted" nativeID="login-password-label">
              {t.auth.password}
            </AppText>
            <View>
              <TextInput
                ref={passwordRef}
                value={password}
                onChangeText={setPassword}
                style={[fieldStyle, { paddingRight: theme.spacing.xxxl + theme.spacing.lg }]}
                placeholder={t.auth.passwordPlaceholder}
                placeholderTextColor={theme.colors.foregroundMuted}
                accessibilityLabel={t.auth.password}
                accessibilityLabelledBy="login-password-label"
                secureTextEntry={!revealPassword}
                textContentType="password"
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                editable={!busy}
                onSubmitEditing={() => void submit()}
              />
              <Pressable
                onPress={() => setRevealPassword((v) => !v)}
                disabled={busy}
                accessibilityRole="switch"
                accessibilityState={{ checked: revealPassword, disabled: busy }}
                accessibilityLabel={revealPassword ? t.auth.hidePasswordA11y : t.auth.showPasswordA11y}
                accessibilityHint={t.auth.passwordToggleHint}
                // Larger than it looks: the visible text is short, but the target
                // fills the field's full height so it clears 44pt.
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  bottom: 0,
                  minWidth: theme.sizing.minTouchTarget,
                  paddingHorizontal: theme.spacing.lg,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <AppText variant="caption" tone="brand">
                  {revealPassword ? t.auth.hide : t.auth.show}
                </AppText>
              </Pressable>
            </View>
          </View>

          <Pressable
            onPress={() => setRememberMe((v) => !v)}
            disabled={busy}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: rememberMe, disabled: busy }}
            accessibilityLabel={t.auth.rememberMe}
            accessibilityHint={t.auth.rememberMeHint}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              minHeight: theme.sizing.minTouchTarget,
            }}>
            {/* The tick is redundant with the checkbox state announced above, and
                the box is outlined in both states — never colour alone. */}
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: theme.radius.sm,
                borderWidth: 2,
                borderColor: rememberMe ? theme.colors.brand : theme.colors.borderStrong,
                backgroundColor: rememberMe ? theme.colors.brand : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              {rememberMe ? (
                <AppText variant="caption" style={{ color: theme.colors.brandOn }}>
                  ✓
                </AppText>
              ) : null}
            </View>
            <AppText variant="callout">{t.auth.rememberMe}</AppText>
          </Pressable>

          {error ? (
            <View
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={{
                backgroundColor: theme.colors.dangerSoft,
                borderRadius: theme.radius.md,
                padding: theme.spacing.lg,
              }}>
              <AppText variant="callout" tone="danger">
                {messageFor(error)}
              </AppText>
            </View>
          ) : null}

          <Button
            label={busy ? t.auth.signingIn : t.auth.signIn}
            onPress={() => void submit()}
            disabled={!canSubmit}
            busy={busy}
            block
            accessibilityLabel={t.auth.signIn}
            accessibilityHint={t.auth.signInHint}
          />
        </View>

        <AppText variant="caption" tone="foregroundMuted" style={{ textAlign: 'center' }}>
          {/* M2 scope: registration and password recovery stay on the web for now. */}
          {t.auth.footer}
        </AppText>
      </View>
    </Screen>
  );
}
