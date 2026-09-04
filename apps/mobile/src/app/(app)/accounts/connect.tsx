/**
 * Connect an account — the native OAuth flow, end to end.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SCREEN NEVER DOES.
 *
 * It never builds a provider URL (the server does), never shows a Tamanor login in
 * a browser (the phone is already signed in), and never decides that something was
 * connected. Every outcome rendered below comes from `controller.state.status`,
 * which only `useOAuthFlow`'s authenticated status read can set.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The selection step is NATIVE: when the server reports `selection_required` the
 * user picks Pages or locations here, and the choice is applied through the same
 * canonical connector services the dashboard uses.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { fetchOAuthProviders } from '@/api/oauth';
import { isSessionInvalid } from '@/api/client';
import type {
  ApiErrorCode, OAuthProvider, OAuthProviderAvailability, OAuthSelectableOption,
} from '@/api/types';
import { useAuth } from '@/auth/auth-provider';
import { readToken } from '@/auth/session-storage';
import { useOAuthFlow } from '@/oauth/use-oauth-flow';
import { acknowledgeOAuthReturn } from '@/oauth/oauth-return';
import {
  AppText, Badge, Button, Card, EmptyState, ErrorState, Loading, SectionHeader,
} from '@/components/ui';
import { t } from '@/i18n';
import { useTheme } from '@/theme';

function messageFor(error: ApiErrorCode): string {
  switch (error) {
    case 'network': return t.errors.network;
    case 'timeout': return t.errors.timeout;
    case 'config': return t.errors.config;
    case 'permission_denied': return t.accounts.noPermission;
    default: return t.errors.server;
  }
}

export default function ConnectAccountScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { onSessionRejected } = useAuth();
  const controller = useOAuthFlow();
  const { state } = controller;

  // An optional reconnect target, passed by the account detail screen. It is a
  // routing hint only — the server re-derives brand and provider from the account.
  const { accountId, provider: reconnectProvider, flow: callbackFlowId } = useLocalSearchParams<{
    accountId?: string; provider?: string; flow?: string;
  }>();

  /**
   * M10B — an OAuth return handed here by the `oauth/callback` route.
   *
   * The id is a CORRELATION REFERENCE, never a result: this asks the controller to
   * re-read the SERVER's authoritative status, which is the same single response
   * every other wake-up signal (browser close, deep link, app resume, cold start)
   * already funnels into. No status is set locally and no second state machine is
   * introduced — `resolve` is the controller's own public entry point and is
   * documented as safe to call repeatedly, which is what makes a duplicated
   * callback harmless.
   *
   * The guard keys on the id so a re-render cannot re-ask, while a genuinely
   * different flow still resolves.
   */
  const resolveFlow = controller.resolve;
  const resumedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!callbackFlowId || resumedRef.current === callbackFlowId) return;
    resumedRef.current = callbackFlowId;
    // M10E — the continuation has now been ACCEPTED by the screen that owns the
    // resolver, which is the safe point to retire the recovery card. Doing it any
    // earlier would drop the user's only way back if navigation never landed.
    // It records a client-navigation fact only; the outcome is still the server's.
    acknowledgeOAuthReturn(callbackFlowId);
    void resolveFlow(callbackFlowId);
  }, [callbackFlowId, resolveFlow]);

  const [providers, setProviders] = useState<OAuthProviderAvailability[]>([]);
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiErrorCode | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await readToken();
      if (!token) { onSessionRejected('unauthenticated'); return; }
      const result = await fetchOAuthProviders(token);
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        if (isSessionInvalid(result.error)) { onSessionRejected(result.error); return; }
        setError(result.error);
        return;
      }
      setProviders(result.data.providers);
      setBrands(result.data.brands);
      setCanManage(result.data.canManageConnectors);
      setBrandId(result.data.brands[0]?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, [onSessionRejected]);

  const startProvider = useCallback(
    async (p: OAuthProvider) => {
      if (accountId) {
        // RECONNECT: only the account id travels. The server derives the rest.
        await controller.start({ provider: p, intent: 'reconnect', accountId });
        return;
      }
      if (!brandId) return;
      await controller.start({ provider: p, intent: 'connect', brandId });
    },
    [controller, accountId, brandId],
  );

  const isReconnect = Boolean(accountId);

  /* ------------------------------------------------------------- render --- */

  const body = useMemo(() => {
    if (loading) return <Loading label={t.common.loading} />;
    if (error) {
      return (
        <ErrorState
          title={t.errors.title}
          message={messageFor(error)}
          retryLabel={t.common.retry}
          onRetry={() => router.replace('/accounts/connect')}
        />
      );
    }
    if (!canManage) {
      return <EmptyState title={t.accounts.noPermission} body={t.accounts.empty.viewerBody} />;
    }

    // ---- selection (server said selection_required) ------------------------
    if (state.phase === 'selecting' || state.phase === 'submitting') {
      return (
        <View style={{ gap: theme.spacing.md }}>
          <SectionHeader title={t.oauth.selectTitle} />
          <AppText variant="callout" tone="foregroundMuted">
            {state.provider === 'google_business'
              ? t.oauth.selectSubtitleGoogle
              : t.oauth.selectSubtitleMeta}
          </AppText>
          {state.options.map((o) => (
            <OptionRow
              key={o.id}
              option={o}
              checked={state.selected.includes(o.id)}
              disabled={state.phase === 'submitting' || !o.eligible}
              onToggle={() => controller.toggle(o.id)}
            />
          ))}
          {state.selected.length === 0 ? (
            <AppText variant="caption" tone="foregroundMuted">{t.oauth.selectNone}</AppText>
          ) : null}
          <Button
            label={state.phase === 'submitting' ? t.oauth.submitting : t.oauth.submit}
            variant="primary"
            block
            busy={state.phase === 'submitting'}
            disabled={!controller.canSubmit}
            onPress={() => void controller.submit()}
          />
        </View>
      );
    }

    // ---- terminal (the SERVER's verdict) -----------------------------------
    if (state.phase === 'done') {
      const connected = state.status === 'completed';
      return (
        <Card>
          <View style={{ gap: theme.spacing.md, alignItems: 'flex-start' }}>
            <AppText variant="heading" accessibilityRole="header">
              {connected ? t.oauth.doneTitle : t.oauth.failedTitle}
            </AppText>
            {connected ? (
              <>
                <AppText variant="body">{t.oauth.doneBody(state.connected)}</AppText>
                {state.limited > 0 ? (
                  <AppText variant="callout" tone="warning">{t.oauth.donePartial(state.limited)}</AppText>
                ) : null}
                {state.slotTaken > 0 ? (
                  <AppText variant="callout" tone="warning">{t.oauth.doneSlot(state.slotTaken)}</AppText>
                ) : null}
              </>
            ) : (
              <AppText variant="body" tone="danger">
                {t.oauth.reason[state.resultCode ?? 'unknown']}
              </AppText>
            )}
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              {!connected ? (
                <Button label={t.oauth.tryAgain} variant="secondary" onPress={controller.reset} />
              ) : null}
              <Button
                label={t.oauth.close}
                variant={connected ? 'primary' : 'ghost'}
                onPress={() => { controller.reset(); router.back(); }}
              />
            </View>
          </View>
        </Card>
      );
    }

    // ---- in flight ---------------------------------------------------------
    if (state.phase !== 'idle') {
      return (
        <Card>
          <View style={{ gap: theme.spacing.md, alignItems: 'flex-start' }}>
            <Loading
              label={state.phase === 'checking' ? t.oauth.checking : t.oauth.opening}
            />
            <AppText variant="callout" tone="foregroundMuted">
              {state.phase === 'checking' ? t.oauth.checking : t.oauth.inBrowser}
            </AppText>
            <Button label={t.oauth.cancel} variant="ghost" onPress={controller.reset} />
          </View>
        </Card>
      );
    }

    // ---- provider picker ---------------------------------------------------
    return (
      <View style={{ gap: theme.spacing.md }}>
        {!isReconnect && brands.length > 1 ? (
          <>
            <SectionHeader title={t.oauth.chooseBrand} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {brands.map((b) => {
                const active = b.id === brandId;
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => setBrandId(b.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={b.name}
                    style={{
                      minHeight: theme.sizing.minTouchTarget,
                      justifyContent: 'center',
                      paddingHorizontal: theme.spacing.lg,
                      borderRadius: theme.radius.pill,
                      backgroundColor: active ? theme.colors.brand : theme.colors.surface,
                      borderWidth: 1,
                      borderColor: active ? theme.colors.brand : theme.colors.border,
                    }}>
                    <AppText
                      variant="caption"
                      style={{ color: active ? theme.colors.brandOn : theme.colors.foreground }}>
                      {b.name}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {!isReconnect && brands.length === 0 ? (
          <AppText variant="callout" tone="foregroundMuted">{t.oauth.noBrands}</AppText>
        ) : null}

        {providers
          // On a reconnect the provider is fixed by the account.
          .filter((p) => !isReconnect || p.provider === reconnectProvider)
          .map((p) => {
            const blocked = !p.available || (!isReconnect && brands.length === 0);
            return (
              <Card key={p.provider}>
                <View style={{ gap: theme.spacing.sm, alignItems: 'flex-start' }}>
                  <AppText variant="bodyStrong">{t.oauth.provider[p.provider]}</AppText>
                  <AppText variant="caption" tone="foregroundMuted">
                    {t.oauth.providerHint[p.provider]}
                  </AppText>
                  {!p.available ? (
                    <Badge
                      label={p.configured && !p.approved ? t.oauth.notApproved : t.oauth.unavailable}
                      tone="neutral"
                    />
                  ) : null}
                  <Button
                    label={isReconnect ? t.accounts.actions.reconnect : t.accounts.actions.connect}
                    variant="primary"
                    disabled={blocked}
                    onPress={() => void startProvider(p.provider)}
                  />
                </View>
              </Card>
            );
          })}

        {/* The browser step is explained before it happens, not after. */}
        <AppText variant="caption" tone="foregroundMuted">{t.oauth.browserNotice}</AppText>
      </View>
    );
  }, [
    loading, error, canManage, state, controller, theme, brands, brandId,
    isReconnect, reconnectProvider, providers, router, startProvider,
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
      <View
        style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md,
        }}>
        <Button label={t.common.back} variant="ghost" onPress={() => router.back()} />
      </View>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: theme.spacing.xxxl + insets.bottom,
          gap: theme.spacing.lg,
        }}>
        <AppText variant="title" accessibilityRole="header">{t.oauth.connectTitle}</AppText>
        <AppText variant="callout" tone="foregroundMuted">{t.oauth.connectSubtitle}</AppText>
        {body}
      </ScrollView>
    </View>
  );
}

/** One selectable Page / Instagram account / location. Carries no credential. */
function OptionRow({
  option, checked, disabled, onToggle,
}: {
  option: OAuthSelectableOption;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={disabled ? undefined : onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={[
        option.displayName,
        option.alreadyConnected ? t.oauth.alreadyConnected : null,
        option.eligible ? null : t.oauth.ineligible,
      ].filter(Boolean).join('. ')}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
        minHeight: theme.sizing.minTouchTarget,
        borderWidth: 1,
        borderColor: checked ? theme.colors.brand : theme.colors.border,
        backgroundColor: checked ? theme.colors.brandSoft : theme.colors.surface,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.lg,
        opacity: disabled ? 0.55 : 1,
      }}>
      <AppText variant="bodyStrong" tone={checked ? 'brand' : 'foreground'}>
        {checked ? '☑' : '☐'}
      </AppText>
      <View style={{ flex: 1, gap: theme.spacing.xxs }}>
        <AppText variant="callout" numberOfLines={1}>{option.displayName}</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
          {option.alreadyConnected ? (
            <Badge label={t.oauth.alreadyConnected} tone="neutral" />
          ) : null}
          {!option.eligible ? (
            <Badge
              label={
                option.reason === 'unverified'
                  ? t.oauth.ineligibleReason.unverified
                  : t.oauth.ineligible
              }
              tone="warning"
            />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
