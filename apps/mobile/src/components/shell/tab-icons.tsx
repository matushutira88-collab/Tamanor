/**
 * Bottom-navigation icons.
 *
 * Drawn with `react-native-svg`, which the app already carries for the brand mark,
 * rather than pulling in an icon font package for five glyphs. Each is a simple
 * stroked 24x24 path so it stays crisp at any density on both platforms.
 *
 * Icons are decorative: every tab also has a visible label and an accessibility
 * label, so no destination is identified by its glyph alone.
 */

import type { ColorValue } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

export interface TabIconProps {
  /** `ColorValue`, not `string`: the tab navigator may hand us a platform color. */
  color: ColorValue;
  size?: number;
}

const STROKE = 1.9;

function Icon({ color, size = 24, children }: TabIconProps & { children: React.ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round">
      {children}
    </Svg>
  );
}

/** Overview — a compact bar-chart glyph. */
export function OverviewIcon(props: TabIconProps) {
  return (
    <Icon {...props}>
      <Path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Icon>
  );
}

/** Comments — a speech bubble, matching the web "inbox/comments" concept. */
export function CommentsIcon(props: TabIconProps) {
  return (
    <Icon {...props}>
      <Path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 0 1 11 4h2a8 8 0 0 1 8 8Z" />
    </Icon>
  );
}

/** Accounts — the connector/plug glyph the web dashboard uses for connections. */
export function AccountsIcon(props: TabIconProps) {
  return (
    <Icon {...props}>
      <Path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v5" />
    </Icon>
  );
}

/** Alerts — a warning triangle, matching the web risk KPI icon. */
export function AlertsIcon(props: TabIconProps) {
  return (
    <Icon {...props}>
      <Path d="M12 9v4M12 17h.01" />
      <Path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </Icon>
  );
}

/** More — the conventional overflow glyph. */
export function MoreIcon(props: TabIconProps) {
  return (
    <Icon {...props}>
      <Circle cx="5" cy="12" r="1.4" fill={props.color} stroke="none" />
      <Circle cx="12" cy="12" r="1.4" fill={props.color} stroke="none" />
      <Circle cx="19" cy="12" r="1.4" fill={props.color} stroke="none" />
    </Icon>
  );
}
