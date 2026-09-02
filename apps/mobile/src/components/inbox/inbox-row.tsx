/**
 * `InboxRow` — one comment or review in the list.
 *
 * Ordered by what a reviewer scans for: importance (risk / action state) first,
 * then the content, then where it came from, then workflow. This is NOT the web
 * card shrunk down — the data semantics are identical, the layout is native.
 *
 * Nothing is communicated by colour alone: every badge renders a localized word,
 * and the unread marker is announced in the row's accessibility label.
 *
 * Memoized because the list re-renders on every mutation and every page append.
 */

import { memo } from 'react';
import { Pressable, View } from 'react-native';

import { AppText, Badge } from '@/components/ui';
import { useTheme } from '@/theme';
import type { InboxItem } from '@/api/types';
import {
  actionStateTone, isRatingOnlyReview, platformLabel, priorityTone, riskTone,
  shouldShowActionState, shouldShowConnector, shouldShowProcessing, workflowTone,
} from '@/inbox/presentation';

export interface InboxRowStrings {
  risk: string;
  workflow: string;
  priority: string | null;
  actionState: string | null;
  processing: string | null;
  connector: string | null;
  ratingOnly: string;
  noAuthor: string;
  unread: string;
}

export interface InboxRowProps {
  item: InboxItem;
  strings: InboxRowStrings;
  timestamp: string;
  onPress: (id: string) => void;
}

function InboxRowBase({ item, strings, timestamp, onPress }: InboxRowProps) {
  const theme = useTheme();
  const author = item.author ?? strings.noAuthor;
  const ratingOnly = isRatingOnlyReview(item);
  const body = ratingOnly ? strings.ratingOnly : item.preview;

  // One spoken sentence per row: a screen reader should not have to assemble the
  // meaning from six separate fragments.
  const spoken = [
    item.isRead ? null : strings.unread,
    author,
    platformLabel(item.platform),
    body,
    item.rating !== null ? `${item.rating}/5` : null,
    strings.risk,
    strings.workflow,
    strings.priority,
    strings.actionState,
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
        // A left rule reinforces unread — but the label above states it too.
        borderLeftWidth: item.isRead ? 1 : 3,
        borderLeftColor: item.isRead ? theme.colors.border : theme.colors.brand,
        padding: theme.spacing.lg,
        gap: theme.spacing.sm,
        opacity: pressed ? 0.85 : 1,
        minHeight: theme.sizing.minTouchTarget,
      })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <AppText
          variant={item.isRead ? 'callout' : 'bodyStrong'}
          numberOfLines={1}
          style={{ flexShrink: 1, flexGrow: 1 }}>
          {author}
        </AppText>
        <AppText variant="caption" tone="foregroundMuted" numberOfLines={1}>
          {timestamp}
        </AppText>
      </View>

      <AppText variant="caption" tone="foregroundMuted" numberOfLines={1}>
        {[platformLabel(item.platform), item.account].filter(Boolean).join(' · ')}
      </AppText>

      {body ? (
        <AppText
          variant="callout"
          tone={ratingOnly ? 'foregroundMuted' : 'foreground'}
          numberOfLines={3}
          style={{ marginTop: 2 }}>
          {body}
        </AppText>
      ) : null}

      {item.rating !== null ? (
        <AppText variant="caption" tone="foregroundMuted">
          {'★'.repeat(Math.max(0, Math.min(5, item.rating)))}
          {'☆'.repeat(Math.max(0, 5 - Math.min(5, item.rating)))}
        </AppText>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: 2 }}>
        <Badge label={strings.risk} tone={riskTone(item.risk)} />
        <Badge label={strings.workflow} tone={workflowTone(item.workflow)} />
        {strings.priority && item.priority !== 'normal' ? (
          <Badge label={strings.priority} tone={priorityTone(item.priority)} />
        ) : null}
        {strings.actionState && shouldShowActionState(item.actionState) ? (
          <Badge label={strings.actionState} tone={actionStateTone(item.actionState)} />
        ) : null}
        {strings.processing && shouldShowProcessing(item.processing) ? (
          <Badge label={strings.processing} tone="warning" />
        ) : null}
        {strings.connector && shouldShowConnector(item.connectorHealth) ? (
          <Badge label={strings.connector} tone="warning" />
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * Re-render only when something the row actually draws has changed. The list is the
 * app's highest-frequency screen, and a mutation patches one row — the other
 * twenty-four should not re-render with it.
 */
export const InboxRow = memo(InboxRowBase, (prev, next) =>
  prev.item === next.item &&
  prev.timestamp === next.timestamp &&
  prev.strings.risk === next.strings.risk &&
  prev.strings.workflow === next.strings.workflow &&
  prev.strings.priority === next.strings.priority &&
  prev.strings.actionState === next.strings.actionState &&
  prev.strings.processing === next.strings.processing &&
  prev.strings.connector === next.strings.connector &&
  prev.onPress === next.onPress,
);
