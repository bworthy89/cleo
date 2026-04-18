import { StyleSheet, Text, View } from 'react-native';
import { AM, Fonts, TypeScale } from '../../tokens/design-tokens';

interface Props {
  /** Catalog number, e.g. "B·01". Renders in amber-dim mono. */
  num?: string;
  title: string;
  /** Right-aligned side label, e.g. "FROM YOUR LIBRARY". */
  side?: string;
}

/**
 * Catalog-style section header. Replaces the small-caps amber label
 * with a slab display header + hairline rule + optional right-side label.
 */
export function SectionMarker({ num, title, side }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.left}>
          {num && <Text style={styles.num}>{num}</Text>}
          <Text style={styles.title}>{title}</Text>
        </View>
        {side && <Text style={styles.side}>{side}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 32,
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: AM.ruleStrong,
    paddingBottom: 6,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    flex: 1,
  },
  num: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    color: AM.amberDim,
    letterSpacing: 2,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s22,
    color: AM.ink,
    letterSpacing: 0.5,
    lineHeight: 22,
  },
  side: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.inkDim,
    letterSpacing: 2,
  },
});
