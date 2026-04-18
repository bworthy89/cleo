import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AM, Fonts } from '../../tokens/design-tokens';

/**
 * Placeholder album-sleeve generator. Used when `artworkUrl` isn't
 * available. Three deterministic styles, seeded off title + artist so
 * the same track always renders the same sleeve.
 *
 *   v0 · center-label — concentric ring vinyl label
 *   v1 · typographic  — giant condensed title on a color field
 *   v2 · horizon      — gradient + halftone + name at the bottom
 */
const ART_PALETTE: [string, string, string][] = [
  ['#8B2E1F', '#2A0E08', '#E8A24B'],   // oxblood + amber
  ['#1B3A4B', '#08131A', '#C8B990'],   // deep teal
  ['#6B5A2E', '#1F1A08', '#E8D28B'],   // mustard
  ['#3B2B4E', '#150E1F', '#C9A7E8'],   // plum
  ['#2E4B3A', '#0A1F14', '#A8C990'],   // bottle green
  ['#4B1F2E', '#1F0810', '#E88BA0'],   // rose
  ['#4B3A1F', '#1F1608', '#E8B88B'],   // cognac
  ['#1F2E4B', '#08101F', '#8BA0E8'],   // navy
];

function seedFor(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

interface Props {
  title?: string;
  artist?: string;
  /** Square edge. Fallback: 120. */
  size?: number;
  /** Pin a variant (0 | 1 | 2). Otherwise derived from seed. */
  variant?: 0 | 1 | 2;
  /** Override palette index. Otherwise seed-chosen. */
  paletteIndex?: number;
  /** Use a real image URL if supplied (preferred over placeholder). */
  artworkUrl?: string | null;
}

export function SleeveArt({ title = '', artist = '', size = 120, variant, paletteIndex, artworkUrl }: Props) {
  if (artworkUrl) {
    return (
      <Image
        source={{ uri: artworkUrl }}
        style={{ width: size, height: size, backgroundColor: AM.bgDeep }}
        accessibilityIgnoresInvertColors
      />
    );
  }

  const seed = seedFor(`${title}|${artist}`);
  const pIdx = paletteIndex ?? seed % ART_PALETTE.length;
  const pal = ART_PALETTE[pIdx];
  const v = variant ?? ((seed % 3) as 0 | 1 | 2);

  if (v === 0) {
    // Center-label — 5-band concentric radial, matching source v0 gradient:
    //   0-42%   pal[0]
    //   42-46%  pal[1]   (inner ring)
    //   46-58%  pal[0]
    //   58-62%  pal[1]   (outer ring)
    //   62-100% pal[0]
    // Rendered as stacked full-circle disks, outer first, each inset further.
    const centerSize = size * 0.3;
    const bands: { radius: number; color: string }[] = [
      { radius: 1.00, color: pal[0] },  // 62-100% outer
      { radius: 0.62, color: pal[1] },  // 58-62% thin ring
      { radius: 0.58, color: pal[0] },  // 46-58% middle band
      { radius: 0.46, color: pal[1] },  // 42-46% thin ring
      { radius: 0.42, color: pal[0] },  // 0-42% inner disk
    ];
    return (
      <View style={{ width: size, height: size, overflow: 'hidden', backgroundColor: pal[1] }}>
        {bands.map((b, i) => {
          const d = size * b.radius;
          const offset = (size - d) / 2;
          return (
            <View
              key={i}
              style={{
                position: 'absolute',
                top: offset, left: offset,
                width: d, height: d,
                borderRadius: d / 2,
                backgroundColor: b.color,
              }}
            />
          );
        })}
        <View style={{
          position: 'absolute',
          top: size / 2 - centerSize / 2, left: size / 2 - centerSize / 2,
          width: centerSize, height: centerSize,
          borderRadius: centerSize / 2,
          backgroundColor: pal[2],
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{
            fontFamily: Fonts.mono, color: pal[1],
            fontSize: size * 0.08, letterSpacing: 2,
          }}>ONAY</Text>
        </View>
        <Text style={{
          position: 'absolute', top: 6, left: 6,
          fontFamily: Fonts.mono, color: pal[2], fontSize: size * 0.055,
          letterSpacing: 1.5,
        }}>SIDE A · {String(seed % 99).padStart(2, '0')}</Text>
      </View>
    );
  }

  if (v === 1) {
    // Typographic — big condensed title on colored ground
    const short = (title || 'UNTITLED').slice(0, 14).toUpperCase();
    return (
      <View style={{ width: size, height: size, overflow: 'hidden', backgroundColor: pal[0] }}>
        <View style={{
          position: 'absolute',
          top: size * 0.36, right: -size * 0.1,
          width: size * 0.6, height: size * 0.6,
          backgroundColor: pal[1],
          transform: [{ rotate: '12deg' }],
        }} />
        <View style={[StyleSheet.absoluteFillObject, { padding: size * 0.07, justifyContent: 'space-between' }]}>
          <Text style={{
            fontFamily: Fonts.mono, color: pal[2], opacity: 0.7,
            fontSize: size * 0.06, letterSpacing: 2,
          }}>LP / {String(seed % 999).padStart(3, '0')}</Text>
          <Text style={{
            fontFamily: Fonts.display, color: pal[2],
            fontSize: size * 0.24, lineHeight: size * 0.22,
            letterSpacing: -0.5,
          }}>{short}</Text>
        </View>
      </View>
    );
  }

  // v2: horizon/field — gradient + text at bottom
  const label = (artist || title || 'UNTITLED').slice(0, 20).toUpperCase();
  return (
    <View style={{ width: size, height: size, overflow: 'hidden', backgroundColor: pal[1] }}>
      <LinearGradient
        colors={[pal[0], pal[1], `${pal[2]}33`]}
        locations={[0, 0.55, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Text style={{
        position: 'absolute',
        bottom: size * 0.08, left: size * 0.08, right: size * 0.08,
        fontFamily: Fonts.display, color: pal[2],
        fontSize: size * 0.11, letterSpacing: 0.5, lineHeight: size * 0.13,
      }}>{label}</Text>
    </View>
  );
}

