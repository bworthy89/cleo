import { StyleSheet } from 'react-native';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';
import { AM } from '../../tokens/design-tokens';

interface Props {
  /** Opacity of the dot field. Default 0.35. */
  opacity?: number;
  /** Override dot color; default cream-on-oxblood. */
  color?: string;
  /** Dot spacing in px. Default 5. */
  spacing?: number;
  /** Dot radius in px. Default 0.7. */
  radius?: number;
}

/**
 * Halftone dot pattern used under oxblood panels and big stamps for grit /
 * printed-poster feel. Rendered as a single SVG `<Pattern>` — one DOM node
 * regardless of coverage area, so it composes fine inside scrollable lists
 * without the per-dot View overhead of a grid.
 */
export function Halftone({ opacity = 0.35, color, spacing = 5, radius = 0.7 }: Props) {
  const fill = color ?? AM.cream;

  return (
    <Svg
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { opacity }]}
      // width/height get replaced by the 100% attributes below, but RN-SVG
      // requires numeric props too; any finite value works since we fill.
      width="100%"
      height="100%"
    >
      <Defs>
        <Pattern
          id="halftone"
          x="0"
          y="0"
          width={spacing}
          height={spacing}
          patternUnits="userSpaceOnUse"
        >
          <Circle cx={radius} cy={radius} r={radius} fill={fill} />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#halftone)" />
    </Svg>
  );
}
