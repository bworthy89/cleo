import { View } from 'react-native';
import { AM } from '../../tokens/design-tokens';

type Pos = 'tl' | 'tr' | 'bl' | 'br';

interface Props {
  pos: Pos;
  color?: string;
  size?: number;
  /** Background color that "bites into" the corner (hides the border under the tick). */
  bg?: string;
}

/** Corner nick — sits on the corner of a bordered box to give it a catalog-plate feel. */
export function Tick({ pos, color = AM.amber, size = 10, bg = AM.bg }: Props) {
  const base = {
    position: 'absolute' as const,
    width: size,
    height: size,
    borderColor: color,
    backgroundColor: bg,
    borderStyle: 'solid' as const,
  };
  const map: Record<Pos, object> = {
    tl: { top: -1, left: -1,   borderTopWidth: 1.5, borderLeftWidth: 1.5 },
    tr: { top: -1, right: -1,  borderTopWidth: 1.5, borderRightWidth: 1.5 },
    bl: { bottom: -1, left: -1,  borderBottomWidth: 1.5, borderLeftWidth: 1.5 },
    br: { bottom: -1, right: -1, borderBottomWidth: 1.5, borderRightWidth: 1.5 },
  };
  return <View style={[base, map[pos]]} pointerEvents="none" />;
}
