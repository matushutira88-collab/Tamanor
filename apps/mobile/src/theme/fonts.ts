/**
 * Brand typeface loading.
 *
 * Plus Jakarta Sans is the one Tamanor typeface on web (`--font-app`), so the
 * native app ships the same four weights. Each weight registers under its own
 * family name because Android does not synthesise weights for custom fonts.
 *
 * The faces are imported from their per-weight subpaths, not from the package
 * root. The root index re-exports all fourteen faces, and because each is a
 * `require()`d asset rather than a tree-shakeable binding, importing from it
 * bundles every italic and unused weight — about 1.3 MB of dead font data in
 * the shipped app. The subpaths pull only what we register.
 */

import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import { useFonts } from 'expo-font';

/** Keys must match `fontFamily` in `./tokens`. */
const brandFonts = {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
};

/**
 * Loads the brand faces.
 *
 * `ready` goes true once the app may render: either the faces registered, or
 * loading failed and we accept the system-font fallback rather than holding the
 * splash screen forever.
 */
export function useBrandFonts(): { ready: boolean; fontsReady: boolean } {
  const [loaded, error] = useFonts(brandFonts);
  return { ready: loaded || error !== null, fontsReady: loaded };
}
