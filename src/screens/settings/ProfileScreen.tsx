import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import { BroadcastBackdrop } from '../../components/BroadcastBackdrop';
import {
  StatusStrip,
  LinerNotes,
  SectionMarker,
  Halftone,
} from '../../components/crate';
import { useSettings } from '../../contexts/SettingsContext';
import {
  getBroadcastHistory,
  getWeatherSettings,
  setWeatherSettings,
  type BroadcastHistoryEntry,
  type WeatherSettings,
} from '../../services/Storage';
import { authenticatedFetch } from '../../services/api';
import { memberNo as formatMemberNo, memberSlot } from '../../lib/memberNo';

interface WeatherCandidate {
  name: string;
  state?: string;
  country: string;
  lat: number;
  lon: number;
}

/**
 * ONAY tab — member lounge. Identity + recent listens + an editorial note
 * from ONAY. Account settings live in the drawer (cog in StatusStrip), not
 * here — this tab is the human-facing face of the app.
 */
export function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const settings = useSettings();

  const firebaseUser = auth().currentUser;
  const email = firebaseUser?.email ?? '—';
  const displayName = firebaseUser?.displayName ?? 'Listener';
  const memberNo = formatMemberNo(firebaseUser?.uid);
  const memberSlotStr = memberSlot(firebaseUser?.uid);

  const [history, setHistory] = useState<BroadcastHistoryEntry[]>([]);
  useEffect(() => {
    setHistory(getBroadcastHistory());
  }, []);

  // ── Weather context state ────────────────────────────────────────────
  const [weather, setWeatherState] = useState<WeatherSettings | null>(() => getWeatherSettings());
  const [cityInput, setCityInput] = useState(weather?.city ?? '');
  const [geocoding, setGeocoding] = useState(false);
  const [candidates, setCandidates] = useState<WeatherCandidate[]>([]);

  // Wrap setCityInput so any in-flight candidate picker disappears the
  // moment the user edits the field — otherwise stale picks linger over
  // a different query.
  const onCityInputChange = (next: string) => {
    setCityInput(next);
    if (candidates.length > 0) setCandidates([]);
  };

  const onToggleWeather = (next: boolean) => {
    if (!next) {
      // Toggling off: keep saved coords (so the user can flip back on
      // without re-picking) but flip enabled to false.
      const cur = getWeatherSettings();
      if (cur) {
        const updated = { ...cur, enabled: false };
        setWeatherSettings(updated);
        setWeatherState(updated);
      } else {
        setWeatherState(null);
      }
      return;
    }
    // Toggling on: only meaningful if a city is already saved with coords.
    const cur = getWeatherSettings();
    if (cur) {
      const updated = { ...cur, enabled: true };
      setWeatherSettings(updated);
      setWeatherState(updated);
    } else {
      // First-time enable, no city picked yet. The {0,0} coords are an
      // ephemeral React-state placeholder — never written to MMKV (no
      // setWeatherSettings call here) and replaced by real coords in
      // confirmCandidate. getWeatherCoordsForBake reads MMKV, so it
      // never sees this sentinel; it also short-circuits on empty
      // resolvedLabel as defense in depth.
      setWeatherState({ enabled: true, city: '', coords: { lat: 0, lon: 0 }, resolvedLabel: '' });
    }
  };

  const confirmCandidate = (c: WeatherCandidate) => {
    const label = [c.name, c.state, c.country].filter(Boolean).join(', ');
    const settings: WeatherSettings = {
      // Preserve the toggle's actual state — never silently opt-in. If the
      // user is confirming a candidate, they reached this flow via the
      // toggle UI which already set weather.enabled, so reading it here
      // gives the truthful intent. Falling back to false avoids implicit
      // enable when state is somehow null.
      enabled: weather?.enabled === true,
      city: cityInput.trim(),
      coords: { lat: c.lat, lon: c.lon },
      resolvedLabel: label,
    };
    setWeatherSettings(settings);
    setWeatherState(settings);
    setCandidates([]);
  };

  const onSubmitCity = async () => {
    const q = cityInput.trim();
    if (!q || geocoding) return;
    setGeocoding(true);
    setCandidates([]);
    try {
      const res = await authenticatedFetch('/weather/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q }),
      });
      if (!res.ok) {
        Alert.alert('Weather lookup unavailable', 'Try again later.');
        return;
      }
      const body = await res.json() as { candidates: WeatherCandidate[] };
      if (body.candidates.length === 0) {
        Alert.alert("Couldn't find that city", 'Try the full name or a ZIP code.');
        return;
      }
      if (body.candidates.length === 1) {
        // Auto-confirm.
        confirmCandidate(body.candidates[0]);
      } else {
        setCandidates(body.candidates);
      }
    } catch {
      Alert.alert('Weather lookup unavailable', 'Try again later.');
    } finally {
      setGeocoding(false);
    }
  };
  // ── End weather context ──────────────────────────────────────────────

  const totalMinutes = history.reduce((total, entry) => {
    const tracks = entry.manifest.tracks ?? [];
    const dur = tracks.reduce((a, t) => a + (t.duration ?? 180), 0);
    return total + Math.round(dur / 60);
  }, 0);

  const firstListen = history.length > 0
    ? new Date(Math.min(...history.map(h => h.createdAt)))
    : null;
  const sinceLabel = firstListen
    ? `SINCE ${firstListen.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }).toUpperCase()}`
    : "SINCE '26";

  const openSettings = () => {
    Haptics.selectionAsync().catch(() => {});
    settings.open();
  };

  return (
    <BroadcastBackdrop>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={{
          paddingTop: insets.top + Space.s6,
          paddingBottom: insets.bottom + 120,
          paddingHorizontal: 20,
        }}
        showsVerticalScrollIndicator={false}
      >
        <StatusStrip onAir={false} num={memberSlotStr} />

        {/* Oxblood member card masthead */}
        <View style={styles.card}>
          <Halftone opacity={0.3} spacing={5} />
          <View style={{ position: 'relative' }}>
            <View style={styles.cardTop}>
              <Text style={styles.cardKicker}>MEMBER CARD · REG №</Text>
              <Text style={styles.cardMemberNo}>{memberNo}</Text>
            </View>
            <Text style={styles.cardName}>{displayName.toUpperCase()}</Text>
            <Text style={styles.cardSub}>{email}</Text>
            <View style={styles.cardFooter}>
              <Text style={styles.cardSince}>{sinceLabel}</Text>
              <Pressable
                onPress={openSettings}
                accessibilityRole="button"
                accessibilityLabel="Open settings"
                hitSlop={6}
                style={({ pressed }) => [pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.cardManage}>MANAGE →</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* Greeting */}
        <View style={styles.liner}>
          <LinerNotes>
            Welcome back. Tonight&rsquo;s set is already being baked — I&rsquo;ll ping you
            when the needle&rsquo;s ready to drop.
          </LinerNotes>
        </View>

        {/* Listening stats */}
        <SectionMarker num="D·01" title="YOUR LISTENING" side="LAST 24 HOURS" />
        <View style={styles.stats}>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{history.length}</Text>
            <Text style={styles.statLabel}>BROADCASTS</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{totalMinutes}</Text>
            <Text style={styles.statLabel}>MINUTES</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{(history[0]?.manifest.tracks ?? []).length}</Text>
            <Text style={styles.statLabel}>LAST SET</Text>
          </View>
        </View>

        {/* Settings shortcut */}
        <SectionMarker num="D·02" title="BACK OFFICE" side="MEMBER CARD" />
        <Pressable
          onPress={openSettings}
          accessibilityRole="button"
          accessibilityLabel="Open settings drawer"
          style={({ pressed }) => [styles.settingsLink, pressed && { opacity: 0.7 }]}
        >
          <View>
            <Text style={styles.settingsLabel}>SETTINGS</Text>
            <Text style={styles.settingsSub}>Account · Notifications · Connections · About</Text>
          </View>
          <Text style={styles.settingsArrow}>→</Text>
        </Pressable>

        {/* Weather context */}
        <SectionMarker num="D·03" title="WEATHER CONTEXT" side="OPTIONAL" />

        <View style={styles.weatherSection}>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onToggleWeather(!(weather?.enabled ?? false));
            }}
            accessibilityRole="switch"
            accessibilityState={{ checked: weather?.enabled ?? false }}
            style={styles.weatherToggleRow}
          >
            <Text style={styles.weatherToggleLabel}>
              Mention weather in cold opens
            </Text>
            <Text style={[
              styles.weatherToggleValue,
              (weather?.enabled ?? false) ? styles.weatherToggleOn : null,
            ]}>
              {weather?.enabled ? 'ON' : 'OFF'}
            </Text>
          </Pressable>

          <Text style={styles.weatherSub}>
            When ON, ONAY may say something like &ldquo;It&rsquo;s 47 and lightly raining
            in Brooklyn.&rdquo; One mention max per episode. Off by default.
          </Text>

          <View style={styles.weatherCityRow}>
            <Text style={styles.weatherFieldLabel}>City</Text>
            <TextInput
              style={styles.weatherCityInput}
              value={cityInput}
              onChangeText={onCityInputChange}
              autoCapitalize="words"
              autoCorrect={false}
              placeholder="Brooklyn"
              placeholderTextColor={AM.inkGhost}
              returnKeyType="done"
              onSubmitEditing={onSubmitCity}
              accessibilityLabel="City for weather context"
            />
            <Pressable
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onSubmitCity().catch(() => {});
              }}
              disabled={geocoding || cityInput.trim().length === 0}
              style={({ pressed }) => [
                styles.weatherSetBtn,
                pressed && { opacity: 0.7 },
                (geocoding || cityInput.trim().length === 0) && { opacity: 0.4 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Look up city"
            >
              {geocoding ? (
                <ActivityIndicator color={AM.amber} size="small" />
              ) : (
                <Text style={styles.weatherSetBtnLabel}>SET</Text>
              )}
            </Pressable>
          </View>

          {weather?.resolvedLabel && candidates.length === 0 ? (
            <Text style={styles.weatherSavedLabel}>saved: {weather.resolvedLabel}</Text>
          ) : null}

          {candidates.length > 0 ? (
            <View style={styles.weatherCandidates}>
              <Text style={styles.weatherCandidatesPrompt}>Did you mean&hellip;</Text>
              {candidates.map((c, i) => (
                <Pressable
                  key={`${c.lat}-${c.lon}-${i}`}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    confirmCandidate(c);
                  }}
                  style={({ pressed }) => [styles.weatherCandidateRow, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                >
                  <Text style={styles.weatherCandidateLabel}>
                    {[c.name, c.state, c.country].filter(Boolean).join(', ')}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        {/* Colophon */}
        <View style={styles.colophon}>
          <Text style={styles.colophonText}>ONAY RADIO · EST. 2026</Text>
          <Text style={styles.colophonText}>NO ALGORITHMS · NO SHUFFLE · SIDE A → SIDE B</Text>
        </View>
      </ScrollView>
    </BroadcastBackdrop>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  card: {
    marginTop: Space.s22,
    padding: 18,
    backgroundColor: AM.oxblood,
    overflow: 'hidden',
    position: 'relative',
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(232,224,208,0.35)',
    paddingBottom: 8,
  },
  cardKicker: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.cream,
    letterSpacing: 3,
    opacity: 0.85,
  },
  cardMemberNo: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s14,
    color: AM.cream,
    letterSpacing: 2,
    lineHeight: 17,
  },
  cardName: {
    marginTop: 14,
    fontFamily: Fonts.display,
    fontSize: TypeScale.s28,
    color: AM.cream,
    letterSpacing: 0.5,
    lineHeight: 34,
  },
  cardSub: {
    marginTop: 6,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s13,
    color: AM.cream,
    opacity: 0.85,
  },
  cardFooter: {
    marginTop: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardSince: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.cream,
    letterSpacing: 2.5,
    opacity: 0.75,
  },
  cardManage: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    color: AM.cream,
    letterSpacing: 2,
  },

  liner: {
    marginTop: Space.s22,
  },

  stats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 4,
  },
  statCell: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 6,
  },
  statDivider: {
    width: 0.5,
    backgroundColor: AM.rule,
  },
  statValue: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s30,
    color: AM.amber,
    letterSpacing: 0.5,
    lineHeight: 36,
  },
  statLabel: {
    fontFamily: Fonts.mono,
    fontSize: 8,
    color: AM.inkDim,
    letterSpacing: 2.5,
  },

  settingsLink: {
    marginTop: 4,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 0.5,
    borderColor: AM.ruleStrong,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingsLabel: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s16,
    color: AM.ink,
    letterSpacing: 1.5,
    lineHeight: 19,
  },
  settingsSub: {
    marginTop: 4,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.inkDim,
    letterSpacing: 1.5,
  },
  settingsArrow: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s18,
    color: AM.amber,
    lineHeight: 22,
  },

  colophon: {
    marginTop: Space.s40,
    paddingTop: 16,
    borderTopWidth: 0.5,
    borderTopColor: AM.rule,
    alignItems: 'center',
    gap: 4,
  },
  colophonText: {
    fontFamily: Fonts.mono,
    fontSize: 8,
    letterSpacing: 2,
    color: AM.inkDim,
  },

  // ── Weather context ────────────────────────────────────────────────
  weatherSection: {
    paddingVertical: Space.s14,
    gap: Space.s12,
  },
  weatherToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Space.s8,
  },
  weatherToggleLabel: {
    fontFamily: Fonts.serif,
    fontSize: TypeScale.s16,
    color: AM.ink,
  },
  weatherToggleValue: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.inkDim,
  },
  weatherToggleOn: {
    color: AM.amber,
  },
  weatherSub: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s13,
    color: AM.inkMid,
    lineHeight: TypeScale.s13 * 1.5,
  },
  weatherCityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.s10,
  },
  weatherFieldLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.inkDim,
    width: 60,
  },
  weatherCityInput: {
    flex: 1,
    fontFamily: Fonts.serif,
    fontSize: TypeScale.s16,
    color: AM.ink,
    paddingVertical: Space.s8,
    borderBottomWidth: 1,
    borderBottomColor: AM.rule,
  },
  weatherSetBtn: {
    paddingHorizontal: Space.s14,
    paddingVertical: Space.s8,
    borderWidth: 1,
    borderColor: AM.amber,
  },
  weatherSetBtnLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.amber,
  },
  weatherSavedLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1.5,
    color: AM.inkDim,
  },
  weatherCandidates: {
    gap: Space.s8,
    paddingVertical: Space.s8,
  },
  weatherCandidatesPrompt: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.inkDim,
  },
  weatherCandidateRow: {
    paddingVertical: Space.s8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: AM.rule,
  },
  weatherCandidateLabel: {
    fontFamily: Fonts.serif,
    fontSize: TypeScale.s14,
    color: AM.ink,
  },
  // ── End weather context ────────────────────────────────────────────
});

export default ProfileScreen;
