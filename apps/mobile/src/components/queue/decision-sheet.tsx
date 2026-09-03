/**
 * `DecisionSheet` — the confirmation shown before an approve / reject / mark-handled.
 *
 * DELIBERATELY NOT the web's live-hide confirmation. That dialog demands a typed
 * confirmation phrase because it triggers a real provider write; this one does not
 * exist to gate a dangerous action, it exists so the body copy can state plainly
 * what the decision does and does NOT do:
 *
 *   "This records your approval in Tamanor. It does not hide or delete anything
 *    on the platform."
 *
 * So there is no phrase input, no destructive styling on approve, and no wording
 * that could read as a promise that a comment will disappear. If a live-execution
 * surface ever ships on mobile it must be a SEPARATE component with its own gate —
 * never this one with stronger copy.
 */

import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button } from '@/components/ui';
import { useTheme } from '@/theme';
import type { QueueDecision } from '@/api/types';

export interface DecisionSheetStrings {
  title: string;
  body: string;
  confirm: string;
  cancel: string;
}

export interface DecisionSheetProps {
  /** The pending decision, or null when the sheet is closed. */
  decision: QueueDecision | null;
  strings: DecisionSheetStrings | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DecisionSheet({
  decision, strings, busy, onConfirm, onCancel,
}: DecisionSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const visible = decision !== null && strings !== null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android's hardware back must cancel, never confirm.
      onRequestClose={busy ? undefined : onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        {/* Tapping the scrim cancels — but not mid-request, which would strand it. */}
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
          <AppText variant="heading" accessibilityRole="header">
            {strings?.title ?? ''}
          </AppText>

          {/*
            The scope statement. This is the sentence that keeps a Tamanor decision
            from reading as a platform action — it must never be shortened away.
          */}
          <AppText variant="body" tone="foregroundMuted">
            {strings?.body ?? ''}
          </AppText>

          <View style={{ gap: theme.spacing.sm }}>
            <Button
              label={strings?.confirm ?? ''}
              variant="primary"
              block
              busy={busy}
              onPress={onConfirm}
            />
            <Button
              label={strings?.cancel ?? ''}
              variant="secondary"
              block
              disabled={busy}
              onPress={onCancel}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
