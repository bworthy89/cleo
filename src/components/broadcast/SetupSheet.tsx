import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import { AmberCTA } from '../AmberCTA';
import { BroadcastBackdrop } from '../BroadcastBackdrop';
import { HairlineRow } from '../HairlineRow';
import type { MusicPlaylist } from '../../../modules/expo-music-kit';
import type { Manifest } from '../../engines/BroadcastPlayer.types';

type Vibe = Manifest['vibe'];
type Length = Manifest['length'];

const VIBES: { id: Vibe; label: string; subtitle: string }[] = [
  { id: 'morning',    label: 'Morning',    subtitle: 'Sun’s up, gentle forward motion' },
  { id: 'focus',      label: 'Focus',      subtitle: 'Head-down, unobtrusive momentum' },
  { id: 'workout',    label: 'Workout',    subtitle: 'Sustained drive, no breathers' },
  { id: 'feelGood',   label: 'Feel Good',  subtitle: 'Warm, uplifting, communal' },
  { id: 'lateNight',  label: 'Late Night', subtitle: 'Hushed, warm, drifting' },
  { id: 'melancholy', label: 'Melancholy', subtitle: 'Reflective, sad in a good way' },
  { id: 'party',      label: 'Party',      subtitle: 'Saturday night, builds and releases' },
];

const LENGTHS: { id: Length; label: string; subtitle: string }[] = [
  { id: 'quick',    label: 'Quick',      subtitle: '5 tracks · 15 min' },
  { id: 'standard', label: 'Standard',   subtitle: '9 tracks · 30 min' },
  { id: 'long',     label: 'Long Drive', subtitle: '15 tracks · 60 min' },
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
  initialStep?: 0 | 1 | 2;
  initialSelection?: { playlistId?: string | null; vibe?: Vibe | null; length?: Length | null };
}

export function SetupSheet({
  visible,
  playlists,
  playlistsLoading,
  playlistsError,
  onRetryPlaylists,
  onAskOnay,
  onClose,
  onSubmit,
  initialStep,
  initialSelection,
}: Props) {
  const [step, setStep] = useState<0 | 1 | 2>(initialStep ?? 0);
  const [playlistId, setPlaylistId] = useState<string | null>(initialSelection?.playlistId ?? null);
  const [vibe, setVibe] = useState<Vibe | null>(initialSelection?.vibe ?? null);
  const [length, setLength] = useState<Length | null>(initialSelection?.length ?? null);

  const stepOpacity = useRef(new Animated.Value(1)).current;
  const stepTranslate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    setStep(initialStep ?? 0);
    setPlaylistId(initialSelection?.playlistId ?? null);
    setVibe(initialSelection?.vibe ?? null);
    setLength(initialSelection?.length ?? null);
  }, [
    visible,
    initialStep,
    initialSelection?.playlistId,
    initialSelection?.vibe,
    initialSelection?.length,
  ]);

  useEffect(() => {
    stepOpacity.setValue(0);
    stepTranslate.setValue(12);
    Animated.parallel([
      Animated.timing(stepOpacity,   { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(stepTranslate, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [step, stepOpacity, stepTranslate]);

  const close = () => {
    // Don't wipe selection on close — Home owns it and may re-open with
    // the same values.
    onClose();
  };

  const goStep = (next: 0 | 1 | 2) => {
    Haptics.selectionAsync().catch(() => {});
    setStep(next);
  };

  const submit = () => {
    if (!playlistId || !vibe || !length) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onSubmit({ playlistId, vibe, length });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={close}
    >
      <BroadcastBackdrop>
        <View style={styles.handleRow}>
          <View style={styles.handle} />
        </View>

        <View style={styles.chrome}>
          <Pressable
            onPress={step === 0 ? close : () => goStep((step - 1) as 0 | 1 | 2)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={step === 0 ? 'Close' : 'Back'}
          >
            <Text style={styles.chromeMono}>{step === 0 ? 'close' : 'back'}</Text>
          </Pressable>
          <Text style={styles.stepIndicator}>
            {`0${step + 1}`} <Text style={styles.stepIndicatorSlash}>/</Text> 03
          </Text>
        </View>

        <Animated.View
          style={[
            styles.body,
            { opacity: stepOpacity, transform: [{ translateX: stepTranslate }] },
          ]}
        >
          {step === 0 && (
            <PlaylistStep
              playlists={playlists}
              playlistsLoading={playlistsLoading}
              playlistsError={playlistsError}
              onRetryPlaylists={onRetryPlaylists}
              onAskOnay={onAskOnay}
              playlistId={playlistId}
              onPick={(id) => { setPlaylistId(id); goStep(1); }}
            />
          )}

          {step === 1 && (
            <VibeStep
              vibe={vibe}
              onPick={(v) => { setVibe(v); goStep(2); }}
            />
          )}

          {step === 2 && (
            <LengthStep
              length={length}
              canSubmit={!!(playlistId && vibe && length)}
              onPick={(l) => { Haptics.selectionAsync().catch(() => {}); setLength(l); }}
              onSubmit={submit}
            />
          )}
        </Animated.View>
      </BroadcastBackdrop>
    </Modal>
  );
}

// ───────────────────────── Steps ─────────────────────────

function StepTitle({ label, title }: { label: string; title: string }) {
  return (
    <View style={styles.titleBlock}>
      <Text style={styles.stepLabel}>{label}</Text>
      <Text style={styles.stepTitle}>{title}</Text>
    </View>
  );
}

function PlaylistStep({
  playlists,
  playlistsLoading,
  playlistsError,
  onRetryPlaylists,
  onAskOnay,
  playlistId,
  onPick,
}: {
  playlists: MusicPlaylist[];
  playlistsLoading?: boolean;
  playlistsError?: string | null;
  onRetryPlaylists?: () => void;
  onAskOnay?: () => void;
  playlistId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <>
      <StepTitle label="SOURCE" title="Pick a source" />
      <ScrollView showsVerticalScrollIndicator={false}>
        {onAskOnay && (
          <HairlineRow
            topRule
            verticalPadding={Space.s16}
            leading={<Text style={styles.askLabel}>ONAY</Text>}
            leadingWidth={54}
            value={<Text style={styles.askValue}>Let me pick for you</Text>}
            trailing={<Text style={styles.chev}>{'›'}</Text>}
            onPress={onAskOnay}
            accessibilityLabel="Let ONAY pick tracks"
          />
        )}

        {playlistsLoading && (
          <Text style={styles.note}>Loading your Apple Music playlists{'…'}</Text>
        )}

        {playlistsError && !playlistsLoading && (
          <View style={styles.errorBlock}>
            <Text style={styles.errorText}>Couldn{'’'}t load your playlists.</Text>
            <Text style={styles.note}>{playlistsError}</Text>
            {onRetryPlaylists && (
              <Pressable
                onPress={onRetryPlaylists}
                accessibilityRole="button"
                accessibilityLabel="Retry loading playlists"
                style={({ pressed }) => [styles.retry, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.retryText}>retry</Text>
              </Pressable>
            )}
          </View>
        )}

        {!playlistsLoading && !playlistsError && playlists.length === 0 && (
          <Text style={styles.note}>
            No playlists in your Apple Music library. Create one in the Music app and come back.
          </Text>
        )}

        {playlists.map((p, idx) => {
          const selected = p.id === playlistId;
          const count = p.trackCount;
          const tooFew = typeof count === 'number' && count < 5;
          const countText =
            typeof count === 'number'
              ? tooFew
                ? `${count} TRACKS · NEED 5+`
                : `${count} TRACKS`
              : 'TRACKS UNKNOWN';
          const countLabel = typeof count === 'number' ? `${count} tracks.` : '';
          const accessibilityLabel = `${p.name}. ${countLabel}${
            tooFew ? ' Not enough to start a broadcast.' : ''
          }`
            .replace(/\s+/g, ' ')
            .trim();
          return (
            <HairlineRow
              key={p.id}
              topRule={idx === 0 && !onAskOnay}
              verticalPadding={Space.s16}
              style={tooFew ? styles.playlistRowDisabled : undefined}
              disabled={tooFew}
              value={
                <View>
                  <Text
                    style={[styles.playlistName, selected && styles.playlistNameSelected]}
                    numberOfLines={1}
                  >
                    {p.name}
                  </Text>
                  <Text style={[styles.playlistMeta, tooFew && styles.playlistMetaWarn]}>
                    {countText}
                  </Text>
                </View>
              }
              trailing={
                selected ? (
                  <Text style={styles.selectDot}>{'•'}</Text>
                ) : (
                  <Text style={styles.chev}>{'›'}</Text>
                )
              }
              onPress={() => onPick(p.id)}
              accessibilityLabel={accessibilityLabel}
            />
          );
        })}
      </ScrollView>
    </>
  );
}

function VibeStep({
  vibe,
  onPick,
}: {
  vibe: Vibe | null;
  onPick: (v: Vibe) => void;
}) {
  return (
    <>
      <StepTitle label="VIBE" title="Pick a vibe" />
      <ScrollView showsVerticalScrollIndicator={false}>
        {VIBES.map((v, idx) => {
          const selected = v.id === vibe;
          return (
            <HairlineRow
              key={v.id}
              topRule={idx === 0}
              verticalPadding={Space.s16}
              value={
                <View>
                  <Text style={[styles.vibeLabel, selected && styles.vibeLabelSelected]}>
                    {v.label}
                  </Text>
                  <Text style={styles.vibeSubtitle}>{v.subtitle}</Text>
                </View>
              }
              trailing={
                selected ? <Text style={styles.selectDot}>{'•'}</Text> : null
              }
              onPress={() => onPick(v.id)}
              accessibilityLabel={`Pick vibe ${v.label}: ${v.subtitle}`}
            />
          );
        })}
      </ScrollView>
    </>
  );
}

function LengthStep({
  length,
  canSubmit,
  onPick,
  onSubmit,
}: {
  length: Length | null;
  canSubmit: boolean;
  onPick: (l: Length) => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <StepTitle label="LENGTH" title="Pick a length" />
      <View>
        {LENGTHS.map((l, idx) => {
          const selected = l.id === length;
          return (
            <HairlineRow
              key={l.id}
              topRule={idx === 0}
              verticalPadding={Space.s16}
              value={
                <View>
                  <Text style={[styles.vibeLabel, selected && styles.vibeLabelSelected]}>
                    {l.label}
                  </Text>
                  <Text style={styles.vibeSubtitle}>{l.subtitle}</Text>
                </View>
              }
              trailing={
                selected ? <Text style={styles.selectDot}>{'•'}</Text> : null
              }
              onPress={() => onPick(l.id)}
              accessibilityLabel={`Pick length ${l.label}, ${l.subtitle}`}
            />
          );
        })}
      </View>
      <View style={{ height: Space.s34 }} />
      <AmberCTA
        label="Begin broadcast"
        onPress={onSubmit}
        disabled={!canSubmit}
        accessibilityHint={canSubmit ? 'Starts your broadcast' : 'Finish picking a length first'}
      />
    </>
  );
}

// ───────────────────────── Styles ─────────────────────────

const styles = StyleSheet.create({
  handleRow: {
    alignItems: 'center',
    paddingTop: Space.s10,
    paddingBottom: Space.s6,
  },
  handle: {
    width: 36,
    height: 3,
    backgroundColor: AM.ruleStrong,
    borderRadius: 1.5,
  },
  chrome: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Space.s26,
    paddingTop: Space.s10,
    paddingBottom: Space.s22,
    borderBottomWidth: 1,
    borderBottomColor: AM.amberFaint,
  },
  chromeMono: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.amber,
  },
  stepIndicator: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.amberDim,
  },
  stepIndicatorSlash: {
    color: AM.amberFaint,
  },
  body: {
    flex: 1,
    paddingHorizontal: Space.s26,
    paddingTop: Space.s22,
  },

  titleBlock: {
    marginBottom: Space.s22,
  },
  stepLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.inkDim,
    marginBottom: Space.s6,
  },
  stepTitle: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s22,
    color: AM.ink,
    lineHeight: TypeScale.s22 * 1.2,
  },

  // Playlist step
  askLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.amberDim,
  },
  askValue: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s18,
    color: AM.amber,
  },
  playlistName: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s16,
    color: AM.ink,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  playlistNameSelected: {
    color: AM.amber,
  },
  playlistRowDisabled: {
    opacity: 0.5,
  },
  playlistMeta: {
    marginTop: 4,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.inkDim,
  },
  playlistMetaWarn: { color: AM.oxblood },

  // Vibe / length list items
  vibeLabel: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s18,
    color: AM.inkMid,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  vibeLabelSelected: {
    color: AM.ink,
  },
  vibeSubtitle: {
    marginTop: Space.s4,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1.5,
    color: AM.inkDim,
  },

  // Shared
  chev: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s16,
    color: AM.inkDim,
  },
  selectDot: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s18,
    color: AM.amber,
    lineHeight: TypeScale.s18,
  },

  // Status / error
  note: {
    paddingVertical: Space.s16,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1.5,
    color: AM.inkDim,
    textAlign: 'center',
  },
  errorBlock: {
    paddingVertical: Space.s22,
    gap: Space.s8,
  },
  errorText: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s16,
    color: AM.ink,
  },
  retry: {
    alignSelf: 'flex-start',
    paddingVertical: Space.s8,
  },
  retryText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.amber,
  },
});
