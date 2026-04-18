import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  type BroadcastHistoryEntry,
} from '../../services/Storage';
import { memberNo as formatMemberNo, memberSlot } from '../../lib/memberNo';

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
});

export default ProfileScreen;
