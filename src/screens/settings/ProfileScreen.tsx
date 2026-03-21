import React, { useEffect, useState } from 'react';
import { Alert, View, Text, ScrollView, StyleSheet, Pressable, Switch } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import { router } from 'expo-router';
import {
  Colors, Surface, TextColors, Typography, Spacing, Radius, withAlpha, AppHeaderTokens,
} from '../../tokens/design-tokens';
import { AppHeader } from '../../components/AppHeader';
import { storage } from '../../services/Storage';
import { signOut } from '../../services/AuthService';
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import { setTTSVolume, authorize } from '../../../modules/expo-music-kit';

// ─── Types ───────────────────────────────────────────────────────────

type Personality = 'curator' | 'companion' | 'oracle';

interface PersonalityOption {
  key: Personality;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
}

const PERSONALITIES: PersonalityOption[] = [
  {
    key: 'curator',
    label: 'Curator',
    description: 'Analytical & Knowledgeable. Deep dives into musicology and technical specs.',
    icon: 'library-outline',
    iconColor: Colors.accent,
  },
  {
    key: 'companion',
    label: 'Companion',
    description: 'Warm & Empathetic. Focuses on emotional resonance and mood matching.',
    icon: 'heart-outline',
    iconColor: Colors.vibe.chill.accent,
  },
  {
    key: 'oracle',
    label: 'Oracle',
    description: 'Enigmatic & Avant-garde. Experimental discoveries and cryptic curation.',
    icon: 'eye-outline',
    iconColor: '#ff97b8',
  },
];

// ─── Component ───────────────────────────────────────────────────────

export function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const firebaseUser = auth().currentUser;

  const [selectedPersonality, setSelectedPersonality] = useState<Personality>(
    () => (storage.getString('cleoPersonality') as Personality) ?? 'curator',
  );
  const [appleMusicConnected, setAppleMusicConnected] = useState(false);
  const [hostVolume, setHostVolume] = useState<number>(
    () => {
      const saved = storage.getString('hostVolumeMix');
      return saved ? parseFloat(saved) : 0.7;
    },
  );

  useEffect(() => {
    musicKitPlayer.isAuthorized().then(setAppleMusicConnected).catch(() => {});
    setTTSVolume(hostVolume);
  }, []);

  const handlePersonalityChange = (personality: Personality) => {
    setSelectedPersonality(personality);
    storage.set('cleoPersonality', personality);
  };

  const handleVolumeChange = (value: number) => {
    setHostVolume(value);
    setTTSVolume(value);
    storage.set('hostVolumeMix', value.toString());
  };

  const volumeToDb = (v: number): string => {
    if (v <= 0.01) return '-∞ dB';
    const db = 20 * Math.log10(v);
    return `${db >= 0 ? '+' : ''}${db.toFixed(0)} dB`;
  };

  const handleAppleMusicToggle = async () => {
    if (appleMusicConnected) return;
    try {
      const result = await authorize();
      if (result.status === 'authorized') {
        setAppleMusicConnected(true);
        storage.set('appleMusicAuthorized', 'true');
      }
    } catch (err) {
      console.warn('[ProfileScreen] Apple Music auth failed:', err);
    }
  };

  const handleManageSubscription = () => {
    Alert.alert('Coming Soon', 'Subscription management will be available in a future update.');
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await musicKitPlayer.pause();
              await signOut();
              router.replace('/(auth)/login');
            } catch {
              // sign-out failed — stay on screen
            }
          },
        },
      ],
    );
  };

  const displayName = firebaseUser?.displayName ?? 'Listener';
  const email = firebaseUser?.email ?? '';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <View style={styles.root}>
      <AppHeader />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: AppHeaderTokens.height + insets.top + Spacing.lg },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Profile Header ── */}
        <View style={styles.profileHeader}>
          <LinearGradient
            colors={[Colors.accent, withAlpha(Colors.accent, 0.3)]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatarRing}
          >
            <View style={styles.avatarInner}>
              {displayName !== 'Listener' ? (
                <Text style={styles.avatarInitial}>{initial}</Text>
              ) : (
                <Ionicons name="person" size={36} color={TextColors.outline} />
              )}
            </View>
          </LinearGradient>
          <Text style={styles.userName}>{displayName}</Text>
          {email ? <Text style={styles.userEmail}>{email}</Text> : null}
        </View>

        {/* ── AI Personality ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>AI PERSONALITY</Text>
          {PERSONALITIES.map((p) => {
            const isSelected = selectedPersonality === p.key;
            return (
              <Pressable
                key={p.key}
                onPress={() => handlePersonalityChange(p.key)}
                style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                accessibilityLabel={`${p.label}: ${p.description}${isSelected ? ', selected' : ''}`}
                accessibilityRole="radio"
              >
                <View style={[
                  styles.personalityCard,
                  isSelected && styles.personalityCardSelected,
                ]}>
                  <View style={styles.personalityLeft}>
                    <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
                      {isSelected && <View style={styles.radioDot} />}
                    </View>
                    <View style={styles.personalityText}>
                      <View style={styles.personalityLabelRow}>
                        <Ionicons name={p.icon} size={16} color={p.iconColor} style={styles.personalityIcon} />
                        <Text style={[
                          styles.personalityLabel,
                          isSelected && styles.personalityLabelSelected,
                        ]}>{p.label}</Text>
                      </View>
                      <Text style={styles.personalityDesc}>{p.description}</Text>
                    </View>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* ── Connected Ecosystem ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CONNECTED ECOSYSTEM</Text>
          <View style={styles.ecosystemCard}>
            <View style={styles.ecosystemRow}>
              <Ionicons name="musical-note" size={20} color={Colors.accent} />
              <Text style={styles.ecosystemLabel}>Apple Music</Text>
              <Text style={styles.ecosystemStatus}>
                {appleMusicConnected ? 'Connected' : 'Not Connected'}
              </Text>
              <Switch
                value={appleMusicConnected}
                onValueChange={handleAppleMusicToggle}
                disabled={appleMusicConnected}
                trackColor={{ false: Surface.bright, true: withAlpha(Colors.accent, 0.4) }}
                thumbColor={appleMusicConnected ? Colors.accent : TextColors.outline}
                style={styles.ecosystemSwitch}
              />
            </View>
          </View>
        </View>

        {/* ── Voice Profile ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>VOICE PROFILE</Text>

          {/* Audio Fidelity (display-only) */}
          <View style={styles.sliderRow}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Audio Fidelity</Text>
              <Text style={styles.sliderValue}>LOSSLESS</Text>
            </View>
            <View style={styles.sliderTrack}>
              <LinearGradient
                colors={[Colors.accent, Colors.vibe.chill.accent]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.sliderFill, { width: '85%' }]}
              />
            </View>
          </View>

          {/* Host Volume Mix (interactive) */}
          <View style={styles.sliderRow}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Host Volume Mix</Text>
              <Text style={styles.sliderValue}>{volumeToDb(hostVolume)}</Text>
            </View>
            <Slider
              style={styles.volumeSlider}
              minimumValue={0}
              maximumValue={1}
              step={0.05}
              value={hostVolume}
              onValueChange={handleVolumeChange}
              minimumTrackTintColor={Colors.accent}
              maximumTrackTintColor={Surface.bright}
              thumbTintColor={Colors.base.white}
            />
          </View>
        </View>

        {/* ── Account ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ACCOUNT</Text>

          <Pressable
            style={({ pressed }) => [styles.accountRow, pressed && { opacity: 0.7 }]}
            onPress={handleManageSubscription}
            accessibilityLabel="Manage Subscription"
            accessibilityRole="button"
          >
            <Text style={styles.accountRowText}>Manage Subscription</Text>
            <Ionicons name="chevron-forward" size={18} color={TextColors.outline} />
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.accountRow, pressed && { opacity: 0.7 }]}
            onPress={handleSignOut}
            accessibilityLabel="Sign out"
            accessibilityRole="button"
          >
            <Text style={[styles.accountRowText, { color: Colors.error }]}>Sign Out</Text>
            <Ionicons name="chevron-forward" size={18} color={Colors.error} />
          </Pressable>
        </View>

        <View style={{ height: insets.bottom + 100 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────

const RING_SIZE = 100;
const RING_BORDER = 3;
const INNER_SIZE = RING_SIZE - RING_BORDER * 2;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Surface.base,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
  },

  // Section label
  sectionLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2.5,
    color: Colors.accent,
    marginBottom: Spacing.md,
  },

  // Profile Header
  profileHeader: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  avatarRing: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInner: {
    width: INNER_SIZE,
    height: INNER_SIZE,
    borderRadius: INNER_SIZE / 2,
    backgroundColor: Surface.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: Typography.display.family,
    fontSize: 36,
    color: TextColors.primary,
  },
  userName: {
    fontFamily: Typography.display.family,
    fontSize: 24,
    color: TextColors.primary,
    marginTop: Spacing.md,
  },
  userEmail: {
    fontFamily: Typography.body.family,
    fontSize: 12,
    color: TextColors.secondary,
    marginTop: Spacing.xs,
  },

  // Section
  section: {
    marginBottom: Spacing.xl,
  },

  // Personality Cards
  personalityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: Radius.sm,
    marginBottom: Spacing.sm,
    backgroundColor: Surface.container,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  personalityCardSelected: {
    borderColor: Colors.accent,
    backgroundColor: withAlpha(Colors.accent, 0.08),
  },
  personalityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: TextColors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  radioOuterSelected: {
    borderColor: Colors.accent,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.accent,
  },
  personalityText: {
    flex: 1,
  },
  personalityLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  personalityIcon: {
    marginRight: Spacing.xs,
  },
  personalityLabel: {
    fontFamily: Typography.body.familySemiBold,
    fontSize: 15,
    color: TextColors.primary,
  },
  personalityLabelSelected: {
    color: Colors.accent,
  },
  personalityDesc: {
    fontFamily: Typography.body.family,
    fontSize: 12,
    color: TextColors.outline,
    lineHeight: 17,
  },

  // Connected Ecosystem
  ecosystemCard: {
    backgroundColor: Surface.container,
    borderRadius: Radius.sm,
    padding: Spacing.md,
  },
  ecosystemRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ecosystemLabel: {
    fontFamily: Typography.body.familyMedium,
    fontSize: 14,
    color: TextColors.primary,
    marginLeft: Spacing.sm,
    flex: 1,
  },
  ecosystemStatus: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    color: Colors.accent,
    letterSpacing: 0.8,
    marginRight: Spacing.sm,
  },
  ecosystemSwitch: {
    transform: [{ scale: 0.8 }],
  },

  // Voice Profile Sliders
  sliderRow: {
    marginBottom: Spacing.lg,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  sliderLabel: {
    fontFamily: Typography.body.familyMedium,
    fontSize: 14,
    color: TextColors.primary,
  },
  sliderValue: {
    fontFamily: Typography.mono.family,
    fontSize: 11,
    color: Colors.accent,
    letterSpacing: 0.8,
  },
  sliderTrack: {
    height: 4,
    backgroundColor: Surface.bright,
    borderRadius: 2,
    overflow: 'visible',
    position: 'relative',
  },
  sliderFill: {
    height: 4,
    borderRadius: 2,
  },
  volumeSlider: {
    width: '100%',
    height: 30,
  },

  // Account Rows
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Surface.container,
    padding: Spacing.md,
    borderRadius: Radius.sm,
    marginBottom: Spacing.sm,
  },
  accountRowText: {
    fontFamily: Typography.body.familyMedium,
    fontSize: 14,
    color: TextColors.primary,
  },
});
