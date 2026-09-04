/**
 * The OAuth continuation card — the one recovery affordance after a provider return.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY A CARD AND NOT AN AUTOMATIC JUMP (M10E)
 *
 * The app cannot navigate itself here. M10C and M10D measured this on a real device:
 * imperative `router.*` from a layout effect (six variants, down to a bare tab
 * switch) and a declarative `<Redirect>` from the authenticated layout both leave
 * the screen where it was, while the state behind them was verified correct. What
 * does work — and always has — is navigation from a SCREEN.
 *
 * So the pending return is surfaced instead of acted on: the user sees that their
 * provider sign-in came back and finishes it with one deliberate tap. That tap is a
 * screen-level `router.push`, the proven path.
 *
 * WHAT THIS CARD IS ALLOWED TO KNOW
 *
 * That a validated callback was captured, and its flow id. That is all. It cannot
 * know whether anything connected, whether a selection is required, or whether the
 * provider failed — those are the server's to report, through `useOAuthFlow` on the
 * Connect screen. Hence the copy says the sign-in "returned", never that an account
 * was connected: claiming success here would be claiming something nobody has asked
 * the server about yet.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { useOAuthReturnState } from '@/oauth/use-oauth-return';
import { AppText, Button, Card } from '@/components/ui';
import { t } from '@/i18n';
import { useTheme } from '@/theme';

export function OAuthContinuationCard() {
  const theme = useTheme();
  const router = useRouter();
  const { pending } = useOAuthReturnState();

  // No captured return, or one already handed off: render nothing at all.
  if (!pending) return null;

  return (
    <Card>
      <View accessibilityRole="alert" style={{ gap: theme.spacing.md, alignItems: 'flex-start' }}>
        <AppText variant="bodyStrong">{t.oauth.continuation.title}</AppText>
        <AppText variant="body" tone="foregroundMuted">
          {t.oauth.continuation.body}
        </AppText>
        <Button
          label={t.oauth.continuation.cta}
          variant="primary"
          onPress={() => {
            /*
             * Navigate, and nothing else. The handoff is retired by CONNECT once it
             * has actually accepted the flow param — if this push never landed, the
             * user must keep the affordance that is their only way back in.
             */
            router.push(`/accounts/connect?flow=${encodeURIComponent(pending)}` as never);
          }}
        />
      </View>
    </Card>
  );
}
