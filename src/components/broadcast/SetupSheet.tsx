import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, Image, ActivityIndicator, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors, Surface, TextColors, Spacing, Typography, Radius, getVibeAccent } from '../../tokens/design-tokens';
import type { MusicPlaylist } from '../../../modules/expo-music-kit';
import type { Manifest } from '../../engines/BroadcastPlayer.types';

type Vibe = Manifest['vibe'];
type Length = Manifest['length'];

const VIBES: { id: Vibe; label: string; subtitle: string }[] = [
  { id: 'morning',    label: 'Morning',    subtitle: 'Warm, bright, gently energizing' },
  { id: 'chill',      label: 'Chill',      subtitle: 'Relaxed, unhurried, easygoing' },
  { id: 'workout',    label: 'Workout',    subtitle: 'Pumped, driving, high-energy' },
  { id: 'lateNight',  label: 'Late Night', subtitle: 'Intimate, moody, introspective' },
  { id: 'party',      label: 'Party',      subtitle: 'Celebratory, dance-floor energy' },
  { id: 'focus',      label: 'Focus',      subtitle: 'Minimal, calm, concentration-friendly' },
  { id: 'feelGood',   label: 'Feel Good',  subtitle: 'Uplifting, affirming' },
  { id: 'throwback',  label: 'Throwback',  subtitle: 'Nostalgic, warm, era-evoking' },
  { id: 'elevated',   label: 'Elevated',   subtitle: 'Sophisticated, refined' },
  { id: 'melancholy', label: 'Melancholy', subtitle: 'Bittersweet, reflective' },
  { id: 'sunday',     label: 'Sunday',     subtitle: 'Laid-back, slow-burn, unhurried' },
  { id: 'general',    label: 'General',    subtitle: 'Balanced, conversational, eclectic' },
];

const LENGTHS: { id: Length; label: string; subtitle: string }[] = [
  { id: 'quick', label: 'Quick Set', subtitle: '~15 min · 5 tracks' },
  { id: 'standard', label: 'Standard', subtitle: '~30 min · 9 tracks' },
  { id: 'long', label: 'Long Drive', subtitle: '~60 min · 15 tracks' },
];

export interface SetupResult {
  playlistId: string;
  vibe: Vibe;
  length: Length;
}

interface Props {
  visible: boolean;
  playlists: MusicPlaylist[];
  playlistsLoading?: boolean;
  playlistsError?: string | null;
  onRetryPlaylists?: () => void;
  onAskOnay?: () => void;
  onClose: () => void;
  onSubmit: (result: SetupResult) => void;
}

const monoLabel = {
  color: TextColors.secondary,
  fontFamily: Typography.mono.family,
  fontSize: 10,
  letterSpacing: 2,
};

export function SetupSheet({
  visible, playlists, playlistsLoading, playlistsError, onRetryPlaylists, onAskOnay,
  onClose, onSubmit,
}: Props) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [vibe, setVibe] = useState<Vibe | null>(null);
  const [length, setLength] = useState<Length | null>(null);
  const stepOpacity = useRef(new Animated.Value(1)).current;
  const stepTranslate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Slide + fade the active step in on each change.
    stepOpacity.setValue(0);
    stepTranslate.setValue(20);
    Animated.parallel([
      Animated.timing(stepOpacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(stepTranslate, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [step, stepOpacity, stepTranslate]);

  const reset = () => { setStep(0); setPlaylistId(null); setVibe(null); setLength(null); };
  const close = () => { reset(); onClose(); };

  const advanceStep = (next: 0 | 1 | 2) => {
    Haptics.selectionAsync().catch(() => {});
    setStep(next);
  };

  const submit = () => {
    if (!playlistId || !vibe || !length) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onSubmit({ playlistId, vibe, length });
    reset();
  };

  const rowStyle = (selected: boolean) => ({
    padding: Spacing.md,
    backgroundColor: Surface.container,
    borderRadius: Radius.sm,
    marginBottom: Spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: selected ? Colors.accent : 'transparent',
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: Colors.base.black, padding: Spacing.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg }}>
          <Pressable
            onPress={step === 0 ? close : () => setStep((step - 1) as 0 | 1 | 2)}
            accessibilityRole="button"
            accessibilityLabel={step === 0 ? 'Cancel' : 'Back'}
          >
            <Text style={{ color: Colors.accent, fontFamily: Typography.mono.family, letterSpacing: 2 }}>
              {step === 0 ? 'CANCEL' : 'BACK'}
            </Text>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            {[0, 1, 2].map(i => (
              <View
                key={i}
                style={{
                  width: i === step ? 20 : 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: i <= step ? Colors.accent : Surface.high,
                }}
              />
            ))}
          </View>
        </View>

        <Animated.View style={{ flex: 1, opacity: stepOpacity, transform: [{ translateX: stepTranslate }] }}>

        {step === 0 && (
          <>
            <Text style={{ color: TextColors.primary, fontFamily: Typography.display.family, fontSize: 26, marginBottom: Spacing.md }}>
              Pick a source
            </Text>

            {onAskOnay && (
              <Pressable
                onPress={onAskOnay}
                accessibilityRole="button"
                accessibilityLabel="Let ONAY pick tracks for you"
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: Spacing.sm,
                  paddingVertical: Spacing.md,
                  paddingHorizontal: Spacing.md,
                  backgroundColor: Surface.container,
                  borderRadius: Radius.sm,
                  marginBottom: Spacing.md,
                  borderLeftWidth: 2,
                  borderLeftColor: Colors.accent,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <Ionicons name="sparkles" size={18} color={Colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={{
                    color: Colors.accent,
                    fontFamily: Typography.mono.family,
                    fontSize: 10,
                    letterSpacing: 2,
                    marginBottom: 2,
                  }}>
                    OR
                  </Text>
                  <Text style={{ color: TextColors.primary, fontFamily: Typography.display.family, fontSize: 16 }}>
                    Let ONAY pick for you
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={TextColors.outline} />
              </Pressable>
            )}

            <ScrollView>
              {playlistsLoading ? (
                <View style={{ padding: Spacing.lg, alignItems: 'center' }}>
                  <ActivityIndicator color={Colors.accent} />
                  <Text style={{ color: TextColors.secondary, marginTop: Spacing.sm }}>
                    Loading your Apple Music playlists…
                  </Text>
                </View>
              ) : playlistsError ? (
                <View style={{ padding: Spacing.md, backgroundColor: Surface.container, borderRadius: Radius.sm, borderLeftWidth: 2, borderLeftColor: Colors.error }}>
                  <Text style={{ color: TextColors.primary, marginBottom: Spacing.sm }}>
                    Couldn’t load your playlists.
                  </Text>
                  <Text style={{ color: TextColors.secondary, fontSize: 12, marginBottom: Spacing.sm }}>
                    {playlistsError}
                  </Text>
                  {onRetryPlaylists && (
                    <Pressable
                      onPress={onRetryPlaylists}
                      accessibilityRole="button"
                      accessibilityLabel="Retry loading playlists"
                      style={{ alignSelf: 'flex-start', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, backgroundColor: Surface.high, borderRadius: Radius.sm }}
                    >
                      <Text style={{ color: Colors.accent, fontFamily: Typography.mono.family, fontSize: 11, letterSpacing: 2 }}>
                        RETRY
                      </Text>
                    </Pressable>
                  )}
                </View>
              ) : playlists.length === 0 ? (
                <Text style={{ color: TextColors.secondary }}>
                  No playlists in your Apple Music library. Create one in the Music app and come back.
                </Text>
              ) : null}
              {playlists.map(p => (
                <Pressable
                  key={p.id}
                  onPress={() => { setPlaylistId(p.id); advanceStep(1); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Pick playlist ${p.name}`}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    ...rowStyle(playlistId === p.id),
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  {p.artworkUrl && (
                    <Image source={{ uri: p.artworkUrl }} style={{ width: 48, height: 48, marginRight: Spacing.sm, borderRadius: Radius.sm }} />
                  )}
                  <Text style={{ color: TextColors.primary, flex: 1 }} numberOfLines={1}>{p.name}</Text>
                  <Ionicons name="chevron-forward" size={18} color={TextColors.outline} />
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {step === 1 && (
          <>
            <Text style={{ color: TextColors.primary, fontFamily: Typography.display.family, fontSize: 26, marginBottom: Spacing.md }}>
              Pick a vibe
            </Text>
            <ScrollView>
              {VIBES.map(v => (
                <Pressable
                  key={v.id}
                  onPress={() => { setVibe(v.id); advanceStep(2); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Pick vibe ${v.label}: ${v.subtitle}`}
                  style={({ pressed }) => ({
                    ...rowStyle(vibe === v.id),
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: Spacing.md,
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <View style={{
                    width: 12, height: 12, borderRadius: 6,
                    backgroundColor: getVibeAccent(v.id),
                  }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{
                      color: TextColors.primary,
                      fontFamily: Typography.body.familyMedium,
                      fontSize: 15,
                    }}>
                      {v.label}
                    </Text>
                    <Text style={{ color: TextColors.secondary, fontSize: 12, marginTop: 2 }}>
                      {v.subtitle}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={TextColors.outline} />
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {step === 2 && (
          <>
            <Text style={{ color: TextColors.primary, fontFamily: Typography.display.family, fontSize: 26, marginBottom: Spacing.md }}>
              Pick a length
            </Text>
            {LENGTHS.map(l => (
              <Pressable
                key={l.id}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setLength(l.id);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Pick length ${l.label}`}
                style={({ pressed }) => ({
                  ...rowStyle(length === l.id),
                  flexDirection: 'row',
                  alignItems: 'center',
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{
                    color: TextColors.primary,
                    fontFamily: Typography.body.familySemiBold,
                    fontSize: 16,
                  }}>
                    {l.label}
                  </Text>
                  <Text style={{ color: TextColors.secondary, marginTop: 2 }}>{l.subtitle}</Text>
                </View>
                <Ionicons
                  name={length === l.id ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={length === l.id ? Colors.accent : TextColors.outline}
                />
              </Pressable>
            ))}
            <Pressable
              onPress={submit}
              disabled={!length}
              accessibilityRole="button"
              accessibilityLabel="Start broadcast"
              style={{
                padding: Spacing.md,
                backgroundColor: length ? Colors.accent : Surface.high,
                borderRadius: Radius.sm,
                marginTop: Spacing.lg,
                alignItems: 'center',
              }}
            >
              <Text style={{
                color: length ? Colors.base.black : TextColors.secondary,
                fontFamily: Typography.mono.family,
                letterSpacing: 2,
              }}>
                START BROADCAST
              </Text>
            </Pressable>
          </>
        )}
        </Animated.View>
      </View>
    </Modal>
  );
}
