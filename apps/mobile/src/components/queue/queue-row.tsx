/**
 * `QueueRow` — one proposed action in the Alerts list.
 *
 * Reading order is what an approver actually scans: what Tamanor wants to do, then
 * what it would be done to, then why, then where it stands.
 *
 * The row shows the DECISION state and, separately, whether anything has actually
 * run on the platform. It never merges the two into a single "Done" — an approved
 * item whose platform action was only a dry run must not read as executed.
 *
 * Decision buttons live on the row only when the SERVER said this item is decidable;
 * that is an affordance, and the endpoint re-authorizes every request regardless.
 */

import { memo } from 'react';
import { Pressable, View } from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { useTheme } from '@/theme';
import type { QueueItem } from '@/api/types';
import {
  executionTone, needsDecision, platformLabel, proposedActionTone, queueStateTone,
  riskTone, shouldShowLifecycle,
} from '@/queue/presentation';

export interface QueueRowStrings {
  proposedAction: string;
  state: string;
  /** Localized risk label; null when the item carries no risk band. */
  risk: string | null;
  execution: string | null;
  lifecycle: string | null;
  reason: string | null;
  needsDecision: string;
  proposes: string;
  noAuthor: string;
  approve: string;
  reject: string;
}

export interface QueueRowProps {
  item: QueueItem;
  strings: QueueRowStrings;
  timestamp: string;
  /** True while a decision for THIS row is in flight. */
  pending: boolean;
  onPress: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

function QueueRowBase({
  item, strings, timestamp, pending, onPress, onApprove, onReject,
}: QueueRowProps) {
  const theme = useTheme();
  const decide = needsDecision(item);
  const author = item.author ?? strings.noAuthor;

  // One spoken sentence per row rather than a dozen disconnected fragments.
  const spoken = [
    decide ? strings.needsDecision : null,
    `${strings.proposes}: ${strings.proposedAction}`,
    strings.state,
    author,
    platformLabel(item.platform),
    item.contentPreview,
    item.rating !== null ? `${item.rating}/5` : null,
    strings.risk,
    strings.reason,
    strings.execution,
    strings.lifecycle,
    timestamp,
  ].filter(Boolean).join('. ');

  return (
    <Pressable
      onPress={() => onPress(item.id)}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      android_ripple={{ color: theme.colors.brandSoft }}
      style={({ pressed }) => ({
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: theme.radius.lg,
        // A left rule reinforces "needs you" — the label above still says it.
        borderLeftWidth: decide ? 3 : 1,
        borderLeftColor: decide ? theme.colors.brand : theme.colors.border,
        padding: theme.spacing.lg,
        gap: theme.spacing.sm,
        opacity: pressed ? 0.85 : 1,
      })}>
      {/* What Tamanor proposes — the headline of the row. */}
      <View
        style={{
          flexDirection: 'row', alignItems: 'center',
          justifyContent: 'space-between', gap: theme.spacing.sm,
        }}>
        <AppText variant="callout" numberOfLines={2} style={{ flex: 1 }}>
          {strings.proposedAction}
        </AppText>
        <AppText variant="caption" tone="foregroundMuted">
          {timestamp}
        </AppText>
      </View>

      {/* Who and where. */}
      <AppText variant="caption" tone="foregroundMuted" numberOfLines={1}>
        {[author, platformLabel(item.platform), item.account].filter(Boolean).join(' · ')}
      </AppText>

      {item.contentPreview ? (
        <AppText variant="caption" numberOfLines={2}>
          {item.contentPreview}
        </AppText>
      ) : null}

      {/* Status. Decision state and platform state are separate badges, always. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
        <Badge label={strings.state} tone={queueStateTone(item.queueState)} />
        <Badge label={strings.proposedAction} tone={proposedActionTone(item.proposedAction)} />
        {strings.risk ? <Badge label={strings.risk} tone={riskTone(item.risk)} /> : null}
        {strings.execution && item.execution ? (
          <Badge label={strings.execution} tone={executionTone(item.execution.status)} />
        ) : null}
        {strings.lifecycle && shouldShowLifecycle(item.lifecycle) ? (
          <Badge label={strings.lifecycle} tone="neutral" />
        ) : null}
      </View>

      {strings.reason ? (
        <AppText variant="caption" tone="foregroundMuted" numberOfLines={2}>
          {strings.reason}
        </AppText>
      ) : null}

      {/*
        Inline decisions, only when the server allowed them. These record a Tamanor
        decision; they do not run anything on a platform.
      */}
      {item.canApprove || item.canReject ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, paddingTop: theme.spacing.xs }}>
          {item.canApprove ? (
            <Button
              label={strings.approve}
              variant="primary"
              disabled={pending}
              onPress={() => onApprove(item.id)}
            />
          ) : null}
          {item.canReject ? (
            <Button
              label={strings.reject}
              variant="secondary"
              disabled={pending}
              onPress={() => onReject(item.id)}
            />
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export const QueueRow = memo(QueueRowBase);
