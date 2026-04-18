import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, TypeScale } from '../../tokens/design-tokens';
import { Tick } from './Tick';

interface Props {
  label: string;
  sub?: string;
  onPress?: () => void;
  kind?: 'amber' | 'oxblood';
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  trailing?: ReactNode;
}

/**
 * Primary CTA with the catalog-plate / ink-stamp feel. Bordered rectangle
 * with four corner Ticks, mono sub-label, arrow trailing. Two kinds:
 *   amber   — outlined amber on dark (default)
 *   oxblood — outlined oxblood on dark
 *
 * For the filled-oxblood "DROP THE NEEDLE" play strip from the source,
 * use a bespoke pressable instead — it's a different shape (no corner
 * ticks, spans the width of a parent card).
 */
export function StampButton({
  label,
  sub,
  onPress,
  kind = 'amber',
  disabled,
  accessibilityLabel,
  accessibilityHint,
  trailing,
}: Props) {
  const stroke = kind === 'oxblood' ? AM.oxblood : AM.amber;
  const ink    = stroke;
  const tickBg = AM.bg;

  const handle = () => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onPress?.();
  };

  return (
    <Pressable
      onPress={handle}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.wrap,
        { borderColor: stroke },
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Tick pos="tl" color={stroke} bg={tickBg} />
      <Tick pos="tr" color={stroke} bg={tickBg} />
      <Tick pos="bl" color={stroke} bg={tickBg} />
      <Tick pos="br" color={stroke} bg={tickBg} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: ink }]}>{label}</Text>
        {sub && <Text style={[styles.sub, { color: AM.inkDim }]}>{sub}</Text>}
      </View>
      {trailing !== undefined ? trailing : (
        <Text style={[styles.arrow, { color: ink }]}>→</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s20,
    letterSpacing: 2,
    lineHeight: 20,
  },
  sub: {
    marginTop: 4,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 2,
  },
  arrow: {
    fontFamily: Fonts.display,
    fontSize: 24,
    lineHeight: 24,
    marginLeft: 12,
  },
});
