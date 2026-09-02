/**
 * Unauthenticated / not-yet-eligible routes.
 *
 * A second layer of `Stack.Protected` picks exactly one destination from the auth
 * state, so the group can hold the sign-in screen alongside the two "signed in but
 * cannot enter the app" outcomes without any imperative redirect.
 *
 * `verify-email` and `unsupported-workspace` live here — not under `(app)` —
 * because both mean the user must NOT reach product content. Workspace routing
 * fails closed: an unknown workspace kind lands on `unsupported-workspace`, never
 * on a Business default.
 */

import { Stack } from 'expo-router';

import { useAuth } from '@/auth/auth-provider';

export default function AuthLayout() {
  const { state } = useAuth();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={state.status === 'verification_required'}>
        <Stack.Screen name="verify-email" />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'workspace_unsupported'}>
        <Stack.Screen name="unsupported-workspace" />
      </Stack.Protected>
      <Stack.Protected
        guard={
          state.status !== 'verification_required' && state.status !== 'workspace_unsupported'
        }>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}
