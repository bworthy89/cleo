import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AM, Fonts, TypeScale } from '../../tokens/design-tokens';

interface Props {
  children: ReactNode;
  /** Small italic attribution under the quote. Defaults to "ONAY". */
  attribution?: string;
  /** Override border color (defaults to oxblood). */
  accent?: string;
}

/**
 * Editorial "ONAY speaks" block. Serif italic text with an oxblood
 * left border and a mono attribution — not a chat bubble.
 */
export function LinerNotes({ children, attribution = 'ONAY', accent = AM.oxblood }: Props) {
  return (
    <View style={[styles.wrap, { borderLeftColor: accent }]}>
      {typeof children === 'string' ? (
        <Text style={styles.body}>{children}</Text>
      ) : (
        children
      )}
      <Text style={[styles.attr, { color: accent }]}>— {attribution}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderLeftWidth: 2,
    paddingLeft: 14,
  },
  body: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s15,
    color: AM.inkMid,
    lineHeight: TypeScale.s15 * 1.5,
  },
  attr: {
    marginTop: 8,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 2.5,
  },
});
