/**
 * `WebConnectNotice` — the Connect / Reconnect hand-off to the Tamanor web app.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * M6 does NOT ship a native OAuth handshake. The web connector flows are
 * browser-cookie based, and every way of bridging a mobile bearer into them — the
 * token in the URL, in the OAuth `state`, or behind a special header — is a
 * credential leak. So this component opens the Tamanor web account manager in the
 * SYSTEM BROWSER and says plainly that the user may have to sign in again there.
 *
 * The URL is built by `resolveHandoffUrl` from the CONFIGURED API origin, never from
 * an API response, and is re-validated by `isOpenableHandoffUrl` immediately before
 * opening. It carries no query string at all, so no bearer, session token, user id
 * or tenant id can ride along.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useState } from 'react';
import { Linking, View } from 'react-native';

import { AppText, Button, Card } from '@/components/ui';
import { useTheme } from '@/theme';
import { isOpenableHandoffUrl, resolveHandoffUrl, type HandoffTarget } from '@/accounts/web-handoff';

export interface WebConnectNoticeStrings {
  title: string;
  body: string;
  open: string;
  /** Shown when the browser could not be opened. */
  unavailable: string;
  /** Shown when this build has no usable web origin configured. */
  notConfigured: string;
}

export interface WebConnectNoticeProps {
  target: HandoffTarget;
  /** Required for `manage`; ignored for `connect`. */
  accountId?: string | null;
  strings: WebConnectNoticeStrings;
  /** Rendered as a plain card when false — used inside the empty state. */
  compact?: boolean;
}

export function WebConnectNotice({ target, accountId, strings, compact }: WebConnectNoticeProps) {
  const theme = useTheme();
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async () => {
    setError(null);
    const resolved = resolveHandoffUrl(target, accountId ?? null);
    if (!resolved.ok) {
      setError(resolved.reason === 'config' || resolved.reason === 'insecure'
        ? strings.notConfigured
        : strings.unavailable);
      return;
    }
    // Belt and braces: the URL is re-checked against the same allowlist right before
    // it is handed to the OS, so nothing can be opened that did not pass twice.
    if (!isOpenableHandoffUrl(resolved.url)) {
      setError(strings.notConfigured);
      return;
    }
    try {
      await Linking.openURL(resolved.url);
    } catch {
      // A device with no browser, or a blocked scheme. Never a crash.
      setError(strings.unavailable);
    }
  }, [target, accountId, strings]);

  const content = (
    <View style={{ gap: theme.spacing.sm, alignItems: 'flex-start' }}>
      <AppText variant="bodyStrong" accessibilityRole="header">{strings.title}</AppText>
      <AppText variant="callout" tone="foregroundMuted">{strings.body}</AppText>
      {error ? (
        <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">{error}</AppText>
      ) : null}
      <Button
        label={strings.open}
        variant="secondary"
        onPress={() => void open()}
        // Spoken so a screen-reader user knows this leaves the app.
        accessibilityHint={strings.body}
      />
    </View>
  );

  return compact ? content : <Card>{content}</Card>;
}
