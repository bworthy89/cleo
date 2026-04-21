import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import { BroadcastBackdrop } from '../../components/BroadcastBackdrop';
import { SleeveArt, SectionMarker, Halftone, SettingsCog } from '../../components/crate';
import {
  BroadcastCurationClient,
  type FeaturedBroadcast,
} from '../../engines/BroadcastCurationClient';
import { broadcastPlayer } from '../../engines/BroadcastPlayer.singleton';
import {
  dayOfWeekFor,
  getThemeFor,
  type DayOfWeek,
  type SlotKey,
  type SlotTheme,
} from '../../config/tonightOnOnay';

// Sun-indexed rotation; mirrors `dayOfWeekFor` internals so we can step forward.
const DAY_ROTATION: DayOfWeek[] = ['sun','mon','tue','wed','thu','fri','sat'];
const dayAfter = (d: DayOfWeek, offset: number): DayOfWeek =>
  DAY_ROTATION[(DAY_ROTATION.indexOf(d) + offset) % 7];

/**
 * Dedicated TONIGHT tab — magazine-index of every featured broadcast. Exact
 * port of source tonight.jsx TonightScreen: oxblood halftoned masthead,
 * indexed shows with sleeve + № + length + title + tagline, and a
 * "LATER THIS WEEK" teaser list of upcoming shows.
 */
export default function TonightScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [featured, setFeatured] = useState<FeaturedBroadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadFeatured = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const feats = await new BroadcastCurationClient().listFeatured();
      setFeatured(feats);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Couldn’t reach the broadcast schedule.';
      setFetchError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const feats = await new BroadcastCurationClient().listFeatured();
        if (mounted) {
          setFeatured(feats);
          setFetchError(null);
        }
      } catch (err) {
        if (mounted) {
          const msg = err instanceof Error ? err.message : 'Couldn’t reach the broadcast schedule.';
          setFetchError(msg);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const playFeatured = useCallback((fb: FeaturedBroadcast) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const firstSlot = fb.manifest.segmentSlots[0];
    const firstUrls = firstSlot?.audioUrls ?? [];
    router.push('/(main)/(broadcast)/player');
    broadcastPlayer.start(fb.manifest, firstUrls).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Playback failed';
      Alert.alert('Broadcast error', msg);
    });
  }, [router]);

  // Weekday label for the masthead kicker — e.g. "THURSDAY · APR 18"
  const now = new Date();
  const weekday = now.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase();
  const month = now.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
  const day = now.getDate();

  // Slot-aware derivations: today's morning + evening slots (baked record
  // or scheduled theme), plus legacy (non-slot) featured records.
  const today = dayOfWeekFor(now);
  const morningRecord = featured.find(b => b.slot === 'morning') ?? null;
  const eveningRecord = featured.find(b => b.slot === 'evening') ?? null;
  const legacy = featured.filter(b => !b.slot);
  const morningTheme = getThemeFor('morning', today);
  const eveningTheme = getThemeFor('evening', today);

  // Upcoming: next 3 slot-drops in chronological order — tomorrow AM,
  // tomorrow PM, day-after AM.
  const upcoming: Array<{ day: DayOfWeek; slot: SlotKey; theme: SlotTheme }> = (
    [
      { day: dayAfter(today, 1), slot: 'morning' as SlotKey },
      { day: dayAfter(today, 1), slot: 'evening' as SlotKey },
      { day: dayAfter(today, 2), slot: 'morning' as SlotKey },
    ]
  ).map(u => ({ ...u, theme: getThemeFor(u.slot, u.day) }));

  return (
    <BroadcastBackdrop>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 120,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Oxblood masthead with halftone */}
        <View style={styles.masthead}>
          <Halftone opacity={0.35} spacing={5} />
          <View style={styles.cogWrap}>
            <SettingsCog color={AM.cream} />
          </View>
          <View style={{ position: 'relative' }}>
            <Text style={styles.mastheadKicker}>
              BROADCAST SCHEDULE · {weekday} · {month} {day}
            </Text>
            <Text style={styles.mastheadTitle}>
              TONIGHT{'\n'}ON ONAY
            </Text>
            <Text style={styles.mastheadTagline}>
              Two shows a day. Picked records, not algorithms.
            </Text>
          </View>
        </View>

        {/* Today's slots — magazine index */}
        <View style={styles.indexWrap}>
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={AM.amber} />
            </View>
          ) : fetchError ? (
            <View style={styles.empty}>
              <Text style={styles.errorKicker}>A HITCH —</Text>
              <Text style={styles.emptyHead}>Couldn&rsquo;t reach the schedule.</Text>
              <Text style={styles.emptySub}>{fetchError}</Text>
              <Pressable
                onPress={loadFeatured}
                accessibilityRole="button"
                accessibilityLabel="Retry loading tonight's broadcasts"
                style={({ pressed }) => [styles.retry, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.retryText}>TRY AGAIN →</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <SlotIndexRow
                slotLabel="MORNING"
                record={morningRecord}
                theme={morningTheme}
                divider
                onPlay={morningRecord ? () => playFeatured(morningRecord) : null}
              />
              <SlotIndexRow
                slotLabel="EVENING"
                record={eveningRecord}
                theme={eveningTheme}
                divider={legacy.length > 0}
                onPlay={eveningRecord ? () => playFeatured(eveningRecord) : null}
              />

              {legacy.length > 0 && (
                <View style={styles.archiveSection}>
                  <SectionMarker num="T·02" title="MORE FROM ONAY" side="ARCHIVE" />
                  {legacy.map((fb, i) => {
                    const trackCount = fb.manifest.tracks?.length ?? 0;
                    const totalMin = Math.round(
                      (fb.manifest.tracks ?? []).reduce((a, t) => a + (t.duration ?? 180), 0) / 60,
                    );
                    const lengthLabel = `${trackCount} TRACKS · ${totalMin} MIN`;
                    const artwork = fb.manifest.tracks?.[0]?.artworkUrl ?? null;
                    return (
                      <Pressable
                        key={fb.id}
                        onPress={() => playFeatured(fb)}
                        accessibilityRole="button"
                        accessibilityLabel={`Play ${fb.title}`}
                        style={({ pressed }) => [
                          styles.indexRow,
                          i < legacy.length - 1 && styles.indexRowDivider,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <SleeveArt title={fb.title} artist="ONAY" size={88} artworkUrl={artwork} />
                        <View style={styles.indexBody}>
                          <View style={styles.indexMeta}>
                            <Text style={styles.indexNum}>
                              № {(i + 1).toString().padStart(2, '0')}
                            </Text>
                            <Text style={styles.indexLength}>{lengthLabel}</Text>
                          </View>
                          <Text style={styles.indexTitle} numberOfLines={2}>
                            {fb.title.toUpperCase()}
                          </Text>
                          {fb.description ? (
                            <Text style={styles.indexTagline} numberOfLines={3}>
                              {fb.description}
                            </Text>
                          ) : null}
                        </View>
                        <Text style={styles.indexArrow}>→</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </>
          )}
        </View>

        {/* Upcoming teaser — next 3 slot-drops pulled from the theme library */}
        <View style={styles.upcoming}>
          <SectionMarker num="T·03" title="LATER THIS WEEK" side="COMING UP" />
          {upcoming.map(u => (
            <View key={`${u.day}-${u.slot}`} style={styles.upcomingRow}>
              <Text style={styles.upcomingTitle}>{u.theme.title.toUpperCase()}</Text>
              <Text style={styles.upcomingDrops}>
                {u.day.toUpperCase()} · {u.slot.toUpperCase()}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </BroadcastBackdrop>
  );
}

// ─────────────── SlotIndexRow ───────────────
//
// One row of the magazine index that represents a Tonight-on-ONAY slot.
// When `record` is present, it renders the baked broadcast (sleeve art from
// the first track, real title/description, arrow to play). When absent, it
// renders the scheduled theme as a dimmed "COMING UP" placeholder.

interface SlotIndexRowProps {
  slotLabel: 'MORNING' | 'EVENING';
  record: FeaturedBroadcast | null;
  theme: SlotTheme;
  divider: boolean;
  onPlay: (() => void) | null;
}

function SlotIndexRow({ slotLabel, record, theme, divider, onPlay }: SlotIndexRowProps) {
  const baked = record !== null;
  const title = baked ? record.title : theme.title;
  const description = baked ? record.description : theme.description;
  const artwork = baked ? (record.manifest.tracks?.[0]?.artworkUrl ?? null) : null;

  const rightMeta = baked
    ? (() => {
        const trackCount = record.manifest.tracks?.length ?? 0;
        const totalMin = Math.round(
          (record.manifest.tracks ?? []).reduce((a, t) => a + (t.duration ?? 180), 0) / 60,
        );
        return `${trackCount} TRACKS · ${totalMin} MIN`;
      })()
    : `${theme.vibe.toUpperCase()} · ${theme.length.toUpperCase()}`;

  const Body = (
    <>
      <SleeveArt title={title} artist="ONAY" size={88} artworkUrl={artwork} />
      <View style={styles.indexBody}>
        <View style={styles.indexMeta}>
          <Text style={styles.slotMetaLabel}>{slotLabel}</Text>
          <Text style={styles.indexLength}>{rightMeta}</Text>
        </View>
        <Text style={styles.indexTitle} numberOfLines={2}>
          {title.toUpperCase()}
        </Text>
        {description ? (
          <Text style={styles.indexTagline} numberOfLines={3}>
            {description}
          </Text>
        ) : null}
        {!baked ? <Text style={styles.comingUpTag}>COMING UP</Text> : null}
      </View>
      {baked ? <Text style={styles.indexArrow}>→</Text> : null}
    </>
  );

  const rowStyle = [
    styles.indexRow,
    divider && styles.indexRowDivider,
    !baked && styles.indexRowPlaceholder,
  ];

  if (baked && onPlay) {
    return (
      <Pressable
        onPress={onPlay}
        accessibilityRole="button"
        accessibilityLabel={`Play ${title}`}
        style={({ pressed }) => [...rowStyle, pressed && { opacity: 0.7 }]}
      >
        {Body}
      </Pressable>
    );
  }

  return (
    <View
      accessible
      accessibilityLabel={`${slotLabel.toLowerCase()} slot — ${title} coming up`}
      style={rowStyle}
    >
      {Body}
    </View>
  );
}

// ─────────────── Styles ───────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },

  masthead: {
    backgroundColor: AM.oxblood,
    paddingVertical: 18,
    paddingHorizontal: 20,
    paddingBottom: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  cogWrap: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 2,
  },
  mastheadKicker: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.cream,
    letterSpacing: 3,
    opacity: 0.8,
    paddingRight: 28,
  },
  mastheadTitle: {
    marginTop: 6,
    fontFamily: Fonts.display,
    fontSize: TypeScale.s42,
    color: AM.cream,
    letterSpacing: 0.5,
    // Anton's cap-height extends past even a 1.0x line-box on iOS. For a
    // big multi-line poster at 42px, need ~1.2x (50) to keep the "T" in
    // "TONIGHT" from clipping at the top of the oxblood plate.
    lineHeight: 50,
  },
  mastheadTagline: {
    marginTop: 10,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s13,
    color: AM.cream,
    opacity: 0.9,
    lineHeight: TypeScale.s13 * 1.4,
  },

  indexWrap: {
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  loading: {
    paddingVertical: Space.s40,
    alignItems: 'center',
  },
  empty: {
    paddingVertical: Space.s22,
    gap: Space.s6,
  },
  emptyHead: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s18,
    color: AM.ink,
    letterSpacing: 0.5,
  },
  emptySub: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    color: AM.inkDim,
    letterSpacing: 1.5,
  },
  errorKicker: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.oxblood,
    letterSpacing: 2.5,
  },
  retry: {
    alignSelf: 'flex-start',
    marginTop: Space.s10,
    paddingVertical: Space.s8,
    paddingHorizontal: Space.s12,
    borderWidth: 0.5,
    borderColor: AM.amberDim,
  },
  retryText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    color: AM.amber,
    letterSpacing: 2,
  },

  indexRow: {
    flexDirection: 'row',
    gap: 14,
    paddingVertical: 14,
    alignItems: 'flex-start',
  },
  indexRowDivider: {
    borderBottomWidth: 0.5,
    borderBottomColor: AM.rule,
  },
  indexBody: {
    flex: 1,
    minWidth: 0,
  },
  indexMeta: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  indexNum: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.oxblood,
    letterSpacing: 2,
  },
  slotMetaLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.amber,
    letterSpacing: 2.5,
  },
  comingUpTag: {
    marginTop: 6,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.amberDim,
    letterSpacing: 2.5,
  },
  indexRowPlaceholder: {
    opacity: 0.55,
  },
  archiveSection: {
    marginTop: Space.s14,
  },
  indexLength: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.inkDim,
    letterSpacing: 2,
  },
  indexTitle: {
    marginTop: 4,
    fontFamily: Fonts.display,
    fontSize: TypeScale.s18,
    color: AM.ink,
    letterSpacing: 0.3,
    lineHeight: 22,
  },
  indexTagline: {
    marginTop: 6,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s12,
    color: AM.inkMid,
    lineHeight: TypeScale.s12 * 1.4,
  },
  indexArrow: {
    alignSelf: 'center',
    fontFamily: Fonts.display,
    fontSize: TypeScale.s20,
    color: AM.amber,
  },

  upcoming: {
    paddingHorizontal: 20,
  },
  upcomingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: AM.rule,
    borderStyle: 'dotted',
  },
  upcomingTitle: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s14,
    color: AM.inkMid,
    letterSpacing: 0.4,
  },
  upcomingDrops: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.inkDim,
    letterSpacing: 2,
  },
});
