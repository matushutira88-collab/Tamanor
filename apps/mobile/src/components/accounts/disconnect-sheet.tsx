/**
 * `DisconnectSheet` — the confirmation shown before disconnecting an account.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRUTHFULNESS IS THE POINT of this sheet. Disconnecting is destructive to the
 * Tamanor connection, and the copy has to say exactly what does and does not happen:
 *
 *   - Tamanor stops using the connection and removes the access it stored
 *   - monitoring and synchronization stop for it
 *   - NOTHING published on Facebook, Instagram or Google is deleted or changed
 *   - when the credentials are shared with other accounts, they go too — the count
 *     is shown BEFORE the user confirms
 *
 * It must never read as "disconnected from Facebook completely": Meta exposes no
 * per-Page token revoke, so the post-disconnect guidance in the result explains the
 * manual cleanup instead of pretending it already happened.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button } from '@/components/ui';
import { useTheme } from '@/theme';

export interface DisconnectSheetStrings {
  title: string;
  body: string;
  /** The "nothing public is deleted" statement. Never omitted. */
  publicNotice: string;
  /** Shown only when the server told us other accounts share the credentials. */
  clusterNotice: string | null;
  confirm: string;
  cancel: string;
}

export interface DisconnectSheetProps {
  visible: boolean;
  strings: DisconnectSheetStrings;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DisconnectSheet({ visible, strings, busy, onConfirm, onCancel }: DisconnectSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android's hardware back must cancel, never confirm.
      onRequestClose={busy ? undefined : onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        {/* Tapping outside cancels — but not mid-request, which would strand it. */}
        <Pressable
          style={{ flex: 1 }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={busy ? undefined : onCancel}
        />

        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            borderTopWidth: 1,
            borderColor: theme.colors.border,
            padding: theme.spacing.xl,
            paddingBottom: theme.spacing.xl + insets.bottom,
            gap: theme.spacing.lg,
          }}>
          <AppText variant="heading" accessibilityRole="header">{strings.title}</AppText>

          <AppText variant="body" tone="foregroundMuted">{strings.body}</AppText>

          {/*
            The cluster warning goes BEFORE confirmation, not after: someone about to
            remove three connections at once must know that before they tap.
          */}
          {strings.clusterNotice ? (
            <AppText variant="body" tone="warning">{strings.clusterNotice}</AppText>
          ) : null}

          {/* The sentence that stops "disconnect" reading as "delete my posts". */}
          <AppText variant="callout" tone="foregroundMuted">{strings.publicNotice}</AppText>

          <View style={{ gap: theme.spacing.sm }}>
            <Button label={strings.confirm} variant="danger" block busy={busy} onPress={onConfirm} />
            <Button label={strings.cancel} variant="secondary" block disabled={busy} onPress={onCancel} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
