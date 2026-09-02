/**
 * The Tamanor brand mark — a shield with a padlock.
 *
 * This is a direct port of `ShieldMark` in `apps/web/src/components/logo.tsx`,
 * kept on the same 32x32 viewBox with the same path data so the native mark and
 * the web mark are geometrically identical. Colours come from the theme, so the
 * mark restyles itself between the light and dark appearances.
 */

import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { useTheme } from '@/theme';

export interface TamanorMarkProps {
  size?: number;
}

export function TamanorMark({ size = 32 }: TamanorMarkProps) {
  const theme = useTheme();
  const gradientId = 'tamanor-shield-gradient';

  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Defs>
        <LinearGradient id={gradientId} x1="5" y1="3" x2="27" y2="28">
          <Stop offset="0" stopColor={theme.colors.brand} />
          <Stop offset="1" stopColor={theme.colors.brandStrong} />
        </LinearGradient>
      </Defs>

      {/* shield */}
      <Path
        d="M16 3 5 6.5v7.2c0 6.4 4.5 10.7 11 13.3 6.5-2.6 11-6.9 11-13.3V6.5L16 3Z"
        fill={`url(#${gradientId})`}
        stroke={theme.colors.brandStrong}
        strokeWidth={1.1}
      />
      {/* padlock body */}
      <Rect
        x={11}
        y={14.5}
        width={10}
        height={8}
        rx={1.6}
        fill={theme.colors.brandOn}
        opacity={0.95}
      />
      {/* padlock shackle */}
      <Path
        d="M13 14.5v-1.8a3 3 0 0 1 6 0v1.8"
        stroke={theme.colors.brandOn}
        strokeWidth={1.7}
        strokeLinecap="round"
        opacity={0.95}
      />
      {/* keyhole */}
      <Circle cx={16} cy={17.8} r={1.15} fill={theme.colors.brand} />
      <Rect x={15.45} y={18.2} width={1.1} height={2.4} rx={0.55} fill={theme.colors.brand} />
    </Svg>
  );
}
