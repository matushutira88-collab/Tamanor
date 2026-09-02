/**
 * `FilterSheet` — advanced Inbox filters in a modal.
 *
 * The four quick views live permanently in the header as a segmented control; every
 * other narrowing lives here, so the list is not buried under fifteen chips. Each
 * group offers "Any" as an explicit way back to unfiltered.
 */

import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, Divider } from '@/components/ui';
import { useTheme } from '@/theme';
import {
  INBOX_PRIORITIES, INBOX_RANGES, INBOX_RISKS, INBOX_SENTIMENTS, INBOX_TYPES, INBOX_WORKFLOWS,
  type InboxFilters,
} from '@/api/types';
import { clearedFilters } from '@/inbox/inbox-state';
import { platformLabel } from '@/inbox/presentation';
import { t } from '@/i18n';

export interface FilterSheetProps {
  visible: boolean;
  filters: InboxFilters;
  platforms: string[];
  onApply: (next: InboxFilters) => void;
  onClose: () => void;
}

export function FilterSheet({ visible, filters, platforms, onApply, onClose }: FilterSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Edited locally, committed on Apply — so a half-built filter set never triggers
  // a request per tap.
  const [draft, setDraft] = useState<InboxFilters>(filters);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      // Re-seed the draft from the live filters each time the sheet opens.
      onShow={() => setDraft(filters)}>
      <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
        <View
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg,
          }}>
          <AppText variant="heading" accessibilityRole="header">
            {t.inbox.filters}
          </AppText>
          <Button label={t.inbox.clearFilters} variant="ghost" onPress={() => setDraft(clearedFilters(draft))} />
        </View>
        <Divider spacing={0} />

        <ScrollView
          contentContainerStyle={{
            padding: theme.spacing.xl,
            paddingBottom: theme.spacing.xxxl,
            gap: theme.spacing.xl,
          }}>
          <Group
            label={t.inbox.filterLabels.range}
            options={INBOX_RANGES.map((r) => ({ value: r, label: t.inbox.range[r] }))}
            selected={draft.range}
            onSelect={(v) => setDraft({ ...draft, range: v as InboxFilters['range'] })}
          />
          <Group
            label={t.inbox.filterLabels.type}
            options={INBOX_TYPES.map((v) => ({ value: v, label: t.inbox.type[v] }))}
            selected={draft.type}
            nullable
            onSelect={(v) => setDraft({ ...draft, type: v as InboxFilters['type'] })}
          />
          <Group
            label={t.inbox.filterLabels.risk}
            options={INBOX_RISKS.map((v) => ({ value: v, label: t.inbox.risk[v] }))}
            selected={draft.risk}
            nullable
            onSelect={(v) => setDraft({ ...draft, risk: v as InboxFilters['risk'] })}
          />
          <Group
            label={t.inbox.filterLabels.sentiment}
            options={INBOX_SENTIMENTS.map((v) => ({ value: v, label: t.inbox.sentiment[v] }))}
            selected={draft.sentiment}
            nullable
            onSelect={(v) => setDraft({ ...draft, sentiment: v as InboxFilters['sentiment'] })}
          />
          <Group
            label={t.inbox.filterLabels.workflow}
            options={INBOX_WORKFLOWS.map((v) => ({ value: v, label: t.inbox.workflow[v] }))}
            selected={draft.workflow}
            nullable
            onSelect={(v) => setDraft({ ...draft, workflow: v as InboxFilters['workflow'] })}
          />
          <Group
            label={t.inbox.filterLabels.priority}
            options={INBOX_PRIORITIES.map((v) => ({ value: v, label: t.inbox.priority[v] }))}
            selected={draft.priority}
            nullable
            onSelect={(v) => setDraft({ ...draft, priority: v as InboxFilters['priority'] })}
          />
          {platforms.length > 0 ? (
            <Group
              label={t.inbox.filterLabels.provider}
              options={platforms.map((p) => ({ value: p, label: platformLabel(p) }))}
              selected={draft.provider}
              nullable
              onSelect={(v) => setDraft({ ...draft, provider: v })}
            />
          ) : null}
        </ScrollView>

        <View
          style={{
            padding: theme.spacing.xl,
            paddingBottom: insets.bottom + theme.spacing.lg,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}>
          <Button label={t.inbox.apply} block onPress={() => { onApply(draft); onClose(); }} />
        </View>
      </View>
    </Modal>
  );
}

function Group({
  label, options, selected, nullable, onSelect,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string | null;
  nullable?: boolean;
  onSelect: (value: string | null) => void;
}) {
  const theme = useTheme();
  const all = nullable ? [{ value: '', label: t.inbox.any }, ...options] : options;

  return (
    <View style={{ gap: theme.spacing.md }}>
      <AppText variant="caption" tone="foregroundMuted" accessibilityRole="header">
        {label}
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {all.map((option) => {
          const value = option.value === '' ? null : option.value;
          const active = selected === value;
          return (
            <Pressable
              key={option.value || 'any'}
              onPress={() => onSelect(value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}: ${option.label}`}
              style={{
                minHeight: theme.sizing.minTouchTarget,
                justifyContent: 'center',
                paddingHorizontal: theme.spacing.lg,
                borderRadius: theme.radius.pill,
                borderWidth: 1,
                borderColor: active ? theme.colors.brand : theme.colors.border,
                backgroundColor: active ? theme.colors.brandSoft : theme.colors.surface,
              }}>
              <AppText variant="caption" tone={active ? 'brand' : 'foreground'}>
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
