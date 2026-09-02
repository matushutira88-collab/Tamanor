/**
 * Comments/Inbox route stack.
 *
 * A nested Stack inside the Comments tab, so detail pushes ABOVE the tab root and
 * back navigation works naturally while the bottom bar stays mounted. The other
 * four tabs are unaffected — this navigator owns only its own subtree.
 */

import { Stack } from 'expo-router';

export default function CommentsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
