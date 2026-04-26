import { StyleSheet, Text, View } from 'react-native';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import { SectionMarker } from '../crate';
import type { UpcomingItem } from '../../engines/BroadcastPlayer.types';

interface Props {
  items: UpcomingItem[];
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${pad2(m)}:${pad2(s)}`;
}

export function UpNextList({ items }: Props) {
  const trackCount = items.filter(i => i.kind === 'track').length;
  const sideLabel = `${pad2(trackCount)} REMAINING`;

  return (
    <View style={styles.wrap}>
      <SectionMarker num="B·02" title="UP NEXT" side={sideLabel} />
      {items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.empty}>THIS IS THE LAST ONE</Text>
        </View>
      ) : (
        items.map(item => {
          if (item.kind === 'track') {
            const duration = formatDuration(item.duration);
            const trackNum = pad2((item.trackIndex ?? 0) + 1);
            const durationSpoken = item.duration
              ? `${Math.floor(item.duration / 60)} minutes ${Math.floor(item.duration % 60)} seconds`
              : '';
            return (
              <View
                key={item.key}
                style={styles.trackRow}
                accessibilityRole="text"
                accessibilityLabel={`Up next, track ${(item.trackIndex ?? 0) + 1}, ${item.title} by ${item.artistName}${durationSpoken ? `, ${durationSpoken}` : ''}`}
              >
                <Text style={styles.trackIdx}>TRK {trackNum}</Text>
                <View style={styles.trackBody}>
                  <Text style={styles.trackTitle} numberOfLines={1}>
                    {(item.title ?? '').toUpperCase()}
                  </Text>
                  <Text style={styles.trackArtist} numberOfLines={1}>
                    {item.artistName}
                  </Text>
                </View>
                {duration ? (
                  <Text style={styles.trackMeta} accessibilityElementsHidden>
                    {duration}
                  </Text>
                ) : null}
              </View>
            );
          }
          const text = item.kind === 'sign_off' ? '↘ ONAY · SIGN-OFF' : '↘ ONAY · TRANSITION';
          const a11y = item.kind === 'sign_off' ? 'ONAY sign-off' : 'ONAY transition between tracks';
          return (
            <View
              key={item.key}
              style={styles.segRow}
              accessibilityRole="text"
              accessibilityLabel={a11y}
            >
              <Text style={styles.segText}>{text}</Text>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: Space.s30,
  },
  emptyWrap: {
    paddingVertical: Space.s12,
    alignItems: 'center',
  },
  empty: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 2,
    color: AM.inkDim,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Space.s8,
    borderBottomWidth: 0.5,
    borderBottomColor: AM.rule,
    gap: Space.s10,
  },
  trackIdx: {
    width: 36,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 1.5,
    color: AM.inkDim,
  },
  trackBody: {
    flex: 1,
  },
  trackTitle: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s14,
    letterSpacing: 0.5,
    color: AM.ink,
    lineHeight: 17,
  },
  trackArtist: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s12,
    color: AM.inkMid,
    marginTop: Space.s2,
  },
  trackMeta: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 1.5,
    color: AM.inkDim,
  },
  segRow: {
    paddingVertical: Space.s6,
    alignItems: 'center',
  },
  segText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s8,
    letterSpacing: 2,
    color: AM.inkDim,
  },
});
