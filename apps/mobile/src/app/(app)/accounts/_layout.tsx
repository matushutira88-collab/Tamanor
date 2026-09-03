/**
 * Accounts route stack.
 *
 * A nested Stack inside the Accounts tab so an account detail pushes ABOVE the tab
 * root, keeping the bottom bar mounted and back navigation natural. Mirrors the
 * Comments and Alerts stacks; this navigator owns only its own subtree.
 */

import { Stack } from 'expo-router';

export default function AccountsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
