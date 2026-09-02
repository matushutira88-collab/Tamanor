/**
 * Authenticated routes.
 *
 * Reaching this layout already implies a server-validated, email-verified session
 * in a supported workspace — the root layout only registers this group when
 * `canEnterApp(state)` is true. Screens beneath it may assume a session exists,
 * but must still treat every API 401 as authoritative: the provider signs the user
 * out and the group unmounts itself.
 */

import { Stack } from 'expo-router';

export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
