import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import auth from '@react-native-firebase/auth';
import { AM, Fonts, Space, TypeScale, ZIndex } from '../../tokens/design-tokens';
import { Tick } from '../crate/Tick';
import { storage, StorageKeys } from '../../services/Storage';
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import { authorize } from '../../../modules/expo-music-kit';
import { memberNo as formatMemberNo } from '../../lib/memberNo';

/**
 * Right-side settings drawer. Opens on demand (via SettingsContext / StatusStrip
 * cog). Exact port of the source HTML SettingsDrawer: oxblood section plates,
 * dashed inkGhost row dividers, mono labels + amber values, physical toggle
 * switches, oxblood Sign Out stamp with corner ticks.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
}

// ─────────────── Section plate ───────────────

function SectionPlate({ children }: { children: string }) {
  return (
    <View style={styles.plate}>
      <Text style={styles.plateText}>{children}</Text>
    </View>
  );
}

// ─────────────── Row ───────────────

function Row({
  label,
  value,
  detail,
  onPress,
  chevron = true,
  dim = false,
}: {
  label: string;
  value: string;
  detail?: string;
  onPress?: () => void;
  chevron?: boolean;
  dim?: boolean;
}) {
  const content = (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        <Text
          style={[styles.rowValue, dim && { color: AM.inkDim }]}
          numberOfLines={1}
        >
          {value}
        </Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
        {chevron && onPress ? (
          <Svg width={6} height={10} viewBox="0 0 6 10" style={{ flexShrink: 0 }}>
            <Path d="M1 1l4 4-4 4" stroke={AM.inkDim} strokeWidth={1.2} fill="none" strokeLinecap="round" />
          </Svg>
        ) : null}
      </View>
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${value}`}
      style={({ pressed }) => [pressed && { opacity: 0.6 }]}
    >
      {content}
    </Pressable>
  );
}

// ─────────────── Toggle row (physical switch) ───────────────

function ToggleRow({
  label,
  sub,
  on,
  onChange,
}: {
  label: string;
  sub?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onChange(!on)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      style={({ pressed }) => [styles.toggleRow, pressed && { opacity: 0.7 }]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.toggleSub}>{sub}</Text> : null}
      </View>
      <View style={[
        styles.switchFrame,
        { borderColor: on ? AM.amber : AM.inkGhost, backgroundColor: on ? AM.amberFaint : 'transparent' },
      ]}>
        <View style={[
          styles.switchKnob,
          { left: on ? 20 : 1, backgroundColor: on ? AM.amber : AM.inkDim },
        ]} />
      </View>
    </Pressable>
  );
}

// ─────────────── Drawer ───────────────

export function SettingsDrawer({ open, onClose, onSignOut }: Props) {
  const insets = useSafeAreaInsets();
  const scrimOpacity = useRef(new Animated.Value(0)).current;
  const slideX = useRef(new Animated.Value(1)).current; // 1 = off-screen right, 0 = open
  const [mounted, setMounted] = useState(open);

  const firebaseUser = auth().currentUser;
  const email = firebaseUser?.email ?? '—';
  const memberNo = formatMemberNo(firebaseUser?.uid);

  const [notifSet, setNotifSet] = useState<boolean>(() => {
    const v = storage.getString(StorageKeys.NOTIF_TONIGHT_READY);
    return v == null ? true : v === 'true';
  });
  const [notifMorning, setNotifMorning] = useState<boolean>(() => {
    const v = storage.getString(StorageKeys.NOTIF_MORNING_RECAP);
    return v == null ? false : v === 'true';
  });
  const onNotifSet = (v: boolean) => {
    setNotifSet(v);
    storage.set(StorageKeys.NOTIF_TONIGHT_READY, v ? 'true' : 'false');
  };
  const onNotifMorning = (v: boolean) => {
    setNotifMorning(v);
    storage.set(StorageKeys.NOTIF_MORNING_RECAP, v ? 'true' : 'false');
  };

  const [appleConnected, setAppleConnected] = useState(false);
  useEffect(() => {
    if (!open) return;
    musicKitPlayer.isAuthorized().then(setAppleConnected).catch(() => {});
  }, [open]);

  const handleAppleConnect = async () => {
    try {
      const result = await authorize();
      if (result.status === 'authorized') setAppleConnected(true);
    } catch {
      // user denied or native error — stay on current state
    }
  };

  // Animate in / out. `mounted` stays true through the close animation.
  useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(scrimOpacity, {
          toValue: 1,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(slideX, {
          toValue: 0,
          duration: 340,
          easing: Easing.bezier(0.2, 0.7, 0.2, 1),
          useNativeDriver: true,
        }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(scrimOpacity, {
          toValue: 0,
          duration: 200,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(slideX, {
          toValue: 1,
          duration: 260,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [open, scrimOpacity, slideX, mounted]);

  // Android back button closes the drawer when open
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  if (!mounted) return null;

  // Drawer is 88% of screen width, sliding in from the right.
  // We translate by 100% of the drawer's own width (88% of screen).
  const translateX = slideX.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View
      style={[StyleSheet.absoluteFillObject, styles.root]}
      pointerEvents={open ? 'auto' : 'none'}
    >
      {/* Scrim */}
      <Animated.View
        style={[StyleSheet.absoluteFillObject, styles.scrim, { opacity: scrimOpacity }]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close settings"
        />
      </Animated.View>

      {/* Drawer */}
      <Animated.View
        style={[styles.drawer, { transform: [{ translateX }] }]}
      >
        {/* Drawer header */}
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Text style={styles.headerKicker}>BACK OFFICE · MEMBER CARD</Text>
          <Text style={styles.headerTitle}>SETTINGS</Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={10}
            style={({ pressed }) => [
              styles.closeBtn,
              { top: insets.top + 14 },
              pressed && { opacity: 0.5 },
            ]}
          >
            <Text style={styles.closeText}>CLOSE ×</Text>
          </Pressable>
        </View>

        {/* Scrollable body */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: 20,
            paddingHorizontal: 20,
            paddingBottom: 100 + insets.bottom,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* 01 ACCOUNT */}
          <SectionPlate>01 · ACCOUNT</SectionPlate>
          <View style={{ marginTop: 10 }}>
            <Row label="MEMBER NO." value={memberNo} dim detail="SINCE '26" chevron={false} />
            <Row label="SIGNED IN AS" value={email} chevron={false} />
            <Row label="HANDLE" value="—" detail="ANON" chevron={false} />
          </View>

          {/* 02 NOTIFICATIONS */}
          <View style={{ marginTop: 24 }}>
            <SectionPlate>02 · NOTIFICATIONS</SectionPlate>
            <View style={{ marginTop: 10 }}>
              <ToggleRow
                label="TONIGHT’S SET IS READY"
                sub="We’ll ping you at 23:58 when ONAY cues up. Silent on your lock screen."
                on={notifSet}
                onChange={onNotifSet}
              />
              <ToggleRow
                label="MORNING RECAP"
                sub="A short note at 8am about last night’s picks."
                on={notifMorning}
                onChange={onNotifMorning}
              />
            </View>
          </View>

          {/* 03 CONNECTIONS */}
          <View style={{ marginTop: 24 }}>
            <SectionPlate>03 · CONNECTIONS</SectionPlate>
            <View style={{ marginTop: 10 }}>
              <Row
                label="APPLE MUSIC"
                value={appleConnected ? 'Connected' : 'Not connected'}
                dim={!appleConnected}
                onPress={appleConnected ? undefined : handleAppleConnect}
                chevron={!appleConnected}
              />
              <Row label="SPOTIFY" value="Not connected" dim chevron={false} />
              <Row label="LAST.FM" value="Off" dim chevron={false} />
            </View>
            <Text style={styles.blurb}>
              ONAY pulls from whichever service has the record tonight.
              If it&rsquo;s not in yours, we&rsquo;ll play a 30-second sample.
            </Text>
          </View>

          {/* 04 ABOUT */}
          <View style={{ marginTop: 24 }}>
            <SectionPlate>04 · ABOUT</SectionPlate>
            <View style={{ marginTop: 10 }}>
              <Row label="VERSION" value="0.4.1" detail="BUILD 051" chevron={false} />
              <Row label="LATE-NIGHT LICENSE" value="BETA" chevron={false} />
              <Row label="CREDITS" value="—" chevron={false} />
              <Row label="TERMS & PRIVACY" value="—" chevron={false} />
            </View>
            <Text style={[styles.blurb, { fontSize: 13 }]}>
              ONAY is a late-night broadcast built by three people in a room.
              One set, one record at a time. Thanks for tuning in.
            </Text>
            <Text style={styles.colophon}>— EST. 2026 · BROOKLYN · NO SHUFFLE —</Text>
          </View>

          {/* Sign out */}
          <Pressable
            onPress={onSignOut}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.75 }]}
          >
            <Tick pos="tl" color={AM.oxblood} bg={AM.bg} />
            <Tick pos="tr" color={AM.oxblood} bg={AM.bg} />
            <Tick pos="bl" color={AM.oxblood} bg={AM.bg} />
            <Tick pos="br" color={AM.oxblood} bg={AM.bg} />
            <Text style={styles.signOutLabel}>SIGN OUT</Text>
            <Text style={styles.signOutSub}>END BROADCAST →</Text>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

// ─────────────── Styles ───────────────

const styles = StyleSheet.create({
  root: {
    zIndex: ZIndex.drawer,
  },
  scrim: {
    backgroundColor: 'rgba(5, 4, 3, 0.75)',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: '88%',
    backgroundColor: AM.bg,
    borderLeftWidth: 1,
    borderLeftColor: AM.amberDim,
    shadowColor: AM.bgDeep,
    shadowOffset: { width: -10, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 30,
    elevation: 16,
  },

  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: AM.inkGhost,
    position: 'relative',
  },
  headerKicker: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.amberDim,
    letterSpacing: 3,
  },
  headerTitle: {
    marginTop: 6,
    fontFamily: Fonts.display,
    fontSize: TypeScale.s30,
    color: AM.ink,
    letterSpacing: 0.5,
    lineHeight: 36,
  },
  closeBtn: {
    position: 'absolute',
    right: 18,
    padding: 4,
  },
  closeText: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: AM.inkDim,
    letterSpacing: 2.5,
  },

  plate: {
    alignSelf: 'flex-start',
    backgroundColor: AM.oxblood,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  plateText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.cream,
    letterSpacing: 3,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: AM.inkGhost,
    borderStyle: 'dashed',
  },
  rowLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.inkDim,
    letterSpacing: 2.5,
    flexShrink: 0,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    flex: 1,
    justifyContent: 'flex-end',
  },
  rowValue: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s14,
    color: AM.amber,
    letterSpacing: 0.5,
    textAlign: 'right',
    flexShrink: 1,
    lineHeight: 17,
  },
  rowDetail: {
    fontFamily: Fonts.mono,
    fontSize: 8,
    color: AM.inkDim,
    letterSpacing: 2,
  },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: AM.inkGhost,
    borderStyle: 'dashed',
  },
  toggleSub: {
    marginTop: 4,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s12,
    color: AM.inkMid,
    lineHeight: TypeScale.s12 * 1.4,
  },
  switchFrame: {
    width: 42,
    height: 22,
    borderWidth: 1,
    flexShrink: 0,
    position: 'relative',
  },
  switchKnob: {
    position: 'absolute',
    top: 1,
    bottom: 1,
    width: 20,
  },

  blurb: {
    marginTop: 10,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s12,
    color: AM.inkMid,
    lineHeight: TypeScale.s12 * 1.5,
  },
  colophon: {
    marginTop: 10,
    fontFamily: Fonts.mono,
    fontSize: 8,
    color: AM.inkDim,
    letterSpacing: 2,
  },

  signOut: {
    marginTop: 28,
    position: 'relative',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: AM.oxblood,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  signOutLabel: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s15,
    color: AM.oxblood,
    letterSpacing: 2,
    lineHeight: 18,
  },
  signOutSub: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.oxbloodDim,
    letterSpacing: 2,
  },
});
