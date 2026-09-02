/**
 * `TrendChart` — risk comments over the selected window.
 *
 * Drawn with `react-native-svg`, which the app already carries for the brand mark.
 * No charting library: one area + line over a fixed-length daily series does not
 * justify the bundle size or the native surface of a chart framework.
 *
 * The chart itself is hidden from assistive technology and a TEXT SUMMARY is
 * exposed instead — a screen reader user gets the total, the period, and the peak
 * day, which is more useful than a traversable path element.
 */

import { useMemo, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme';

export interface TrendChartProps {
  buckets: { key: string; count: number }[];
  height?: number;
  /** Pre-built accessible summary sentence(s). */
  summary: string;
}

export function TrendChart({ buckets, height = 120, summary }: TrendChartProps) {
  const theme = useTheme();
  // Measured rather than assumed, so the chart fits any phone width.
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const { linePath, areaPath } = useMemo(() => {
    if (width <= 0 || buckets.length === 0) return { linePath: '', areaPath: '' };

    const max = Math.max(1, ...buckets.map((b) => b.count));
    const stepX = buckets.length > 1 ? width / (buckets.length - 1) : 0;
    // Inset so a full-height point is not clipped by the stroke.
    const top = 4;
    const usable = height - top - 1;

    const points = buckets.map((b, i) => {
      const x = buckets.length > 1 ? i * stepX : width / 2;
      const y = top + usable - (b.count / max) * usable;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });

    const line = `M${points.join(' L')}`;
    const area = `${line} L${width.toFixed(2)},${height} L0,${height} Z`;
    return { linePath: line, areaPath: area };
  }, [buckets, width, height]);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View
        onLayout={onLayout}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ height }}>
        {width > 0 && linePath ? (
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="tamanor-trend-fill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={theme.colors.brand} stopOpacity={0.28} />
                <Stop offset="1" stopColor={theme.colors.brand} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={areaPath} fill="url(#tamanor-trend-fill)" />
            <Path
              d={linePath}
              fill="none"
              stroke={theme.colors.brand}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        ) : null}
      </View>

      {/* The accessible equivalent of the drawing above. */}
      <AppText variant="caption" tone="foregroundMuted">
        {summary}
      </AppText>
    </View>
  );
}
