/**
 * Alerts / Action Queue route stack.
 *
 * A nested Stack inside the Alerts tab so a proposal detail pushes ABOVE the tab
 * root, keeping the bottom bar mounted and back navigation natural. Mirrors the
 * Comments stack from M4; this navigator owns only its own subtree.
 */

import { Stack } from 'expo-router';

export default function AlertsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
