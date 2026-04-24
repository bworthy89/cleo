import { StyleSheet, Text, View } from 'react-native';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import { Halftone } from '../crate/Halftone';

interface Props {
  slotLabel: 'MORNING' | 'EVENING';
}

/** Matches the outer shape of FeaturedBroadcastCard so the twin-slot
 *  stack stays visually consistent whether baked or not. */
export function SlotPlaceholderCard({ slotLabel }: Props) {
  return (
    <View style={styles.wrap} accessible accessibilityLabel={`Tonight's ${slotLabel.toLowerCase()} coming up`}>
      <View style={styles.plate}>
        <Halftone opacity={0.3} />
        <View style={styles.plateRow}>
          <Text style={styles.plateLabel}>TONIGHT ON ONAY</Text>
          <Text style={styles.plateStamp}>{slotLabel}</Text>
        </View>
      </View>
      <View style={styles.card}>
        <View style={styles.meta}>
          <Text style={styles.title}>COMING UP</Text>
          <Text style={styles.tagline}>ONAY is between tracks.</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: Space.s14, opacity: 0.55 },
  plate: {
    backgroundColor: AM.oxblood,
    paddingVertical: 6, paddingHorizontal: 10, overflow: 'hidden',
  },
  plateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  plateLabel: { fontFamily: Fonts.mono, fontSize: TypeScale.s9, color: AM.cream, letterSpacing: 3 },
  plateStamp:  { fontFamily: Fonts.mono, fontSize: TypeScale.s9, color: AM.cream, letterSpacing: 2, opacity: 0.85 },

  card: {
    borderWidth: 1, borderTopWidth: 0, borderColor: AM.oxblood,
    paddingVertical: Space.s20, paddingHorizontal: Space.s14,
    minHeight: 120, justifyContent: 'center',
  },
  meta: {},
  title:   { fontFamily: Fonts.display, fontSize: TypeScale.s22, color: AM.inkMid, letterSpacing: 0.3, lineHeight: 26 },
  tagline: { marginTop: 6, fontFamily: Fonts.serif, fontStyle: 'italic', fontSize: TypeScale.s12, color: AM.inkMid },
});
