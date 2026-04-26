import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { AM, Fonts, Space, TypeScale } from '../../src/tokens/design-tokens';
import { BroadcastBackdrop } from '../../src/components/BroadcastBackdrop';
import { StampButton, LinerNotes, SpinningRecord } from '../../src/components/crate';
import { getUser, setUser } from '../../src/services/Storage';
import { fetchPlaylists, fetchPlaylistTracks } from '../../modules/expo-music-kit';
import { BroadcastManifestClient } from '../../src/engines/BroadcastManifestClient';
import { BroadcastCurationClient } from '../../src/engines/BroadcastCurationClient';
import { broadcastPlayer } from '../../src/engines/BroadcastPlayer.singleton';
import { pickFirstListenSource } from '../../src/onboarding/firstListenSource';
import type { Manifest } from '../../src/engines/BroadcastPlayer.types';

type ScreenState =
  | { kind: 'name' }
  | { kind: 'baking'; name: string }
  | { kind: 'ready'; name: string; manifest: Manifest; firstSegmentUrls: string[] }
  | { kind: 'error'; message: string };

export default function FirstListenScreen() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<ScreenState>(() => {
    const existing = getUser();
    return existing?.name
      ? { kind: 'baking', name: existing.name }
      : { kind: 'name' };
  });
  const [nameDraft, setNameDraft] = useState('');
  // Track the in-flight bake so we can ignore late results if the user
  // backs out / unmounts.
  const bakeAttemptRef = useRef(0);

  // Kick off the bake whenever we transition into 'baking'. The deps
  // array on state.kind means React fires this once per State B entry.
  useEffect(() => {
    if (state.kind !== 'baking') return;
    const attempt = ++bakeAttemptRef.current;
    void runBake(state.name, attempt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind]);

  const runBake = async (name: string, attempt: number) => {
    try {
      const curationClient = new BroadcastCurationClient();
      const manifestClient = new BroadcastManifestClient();
      const source = await pickFirstListenSource({
        fetchPlaylists,
        fetchPlaylistTracks,
        listFeatured: () => curationClient.listFeatured(),
      });

      // Late-cancel guard — if a new bake attempt started, ignore us.
      if (attempt !== bakeAttemptRef.current) return;

      if (source.kind === 'none') {
        setState({
          kind: 'error',
          message: "Can't put a set together right now — try again from the home screen.",
        });
        return;
      }

      if (source.kind === 'featured') {
        // Featured manifest is already embedded in the registry entry,
        // so no second fetch is needed. Mirror playFeatured() in
        // HomeBroadcastScreen.
        const manifest = source.featured.manifest;
        const firstSegmentUrls = manifest.segmentSlots[0]?.audioUrls ?? [];
        setState({ kind: 'ready', name, manifest, firstSegmentUrls });
        return;
      }

      // User-playlist path — fresh bake.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await manifestClient.createBroadcast(
          {
            playlistId: source.playlistId,
            vibe: defaultVibeForFirstListen(),
            length: 'quick',
            userContext: {
              timeOfDay: localTimeHHMM(),
              dayOfWeek: localDayOfWeek(),
              firstTimeUser: true,
              listenerName: name,
            },
            tracks: source.tracks,
          },
          controller.signal,
        );
        if (attempt !== bakeAttemptRef.current) return;
        setState({
          kind: 'ready',
          name,
          manifest: response.manifest,
          firstSegmentUrls: response.firstSegmentUrls,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      if (attempt !== bakeAttemptRef.current) return;
      const message = err instanceof Error && err.name === 'AbortError'
        ? 'That took longer than expected. Take me home and try again from there.'
        : "Hmm, can't put a set together right now.";
      setState({ kind: 'error', message });
    }
  };

  const submitName = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    const existing = getUser();
    setUser({
      ...(existing ?? { appleMusicAuthorized: false, createdAt: new Date().toISOString() }),
      name: trimmed,
    });
    setState({ kind: 'baking', name: trimmed });
  };

  const skipName = () => {
    setState({ kind: 'baking', name: "tonight’s listener" });
  };

  const pressPlay = () => {
    if (state.kind !== 'ready') return;
    const { manifest, firstSegmentUrls } = state;
    router.replace('/(main)/(broadcast)/player');
    // Fire-and-forget — the player handles its own lifecycle.
    broadcastPlayer.start(manifest, firstSegmentUrls).catch(() => {
      // If start fails the player surfaces it; we've already navigated.
    });
  };

  return (
    <BroadcastBackdrop>
      <View style={[
        styles.root,
        { paddingTop: insets.top + Space.s32, paddingBottom: insets.bottom + Space.s22 },
      ]}>
        <View style={styles.content}>
          <Text style={styles.kicker}>SETTING THE NEEDLE · 06 / 06</Text>
          <View style={styles.vinylWrap}>
            <SpinningRecord size={120} tonearm={false} period={4200} />
          </View>

          {state.kind === 'name' ? (
            <NameCaptureBody
              nameDraft={nameDraft}
              onChangeDraft={setNameDraft}
              onSubmit={submitName}
              onSkip={skipName}
            />
          ) : state.kind === 'baking' ? (
            <BakingBody name={state.name} />
          ) : state.kind === 'ready' ? (
            <ReadyBody name={state.name} onPressPlay={pressPlay} />
          ) : (
            <ErrorBody message={state.message} onTakeMeHome={() => router.replace('/(main)')} />
          )}
        </View>
      </View>
    </BroadcastBackdrop>
  );
}

function defaultVibeForFirstListen(): Manifest['vibe'] {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 22 || hour < 5) return 'lateNight';
  return 'feelGood';
}

function localTimeHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function localDayOfWeek(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long' });
}

function NameCaptureBody(props: {
  nameDraft: string;
  onChangeDraft: (v: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
}) {
  return (
    <View>
      <Text style={styles.headline}>What should{'\n'}<Text style={styles.headlineAmber}>ONAY</Text> call you?</Text>
      <View style={styles.linerWrap}>
        <LinerNotes>
          A first name does it. Skip if you'd rather she just call you "listener."
        </LinerNotes>
      </View>
      <TextInput
        style={styles.nameInput}
        value={props.nameDraft}
        onChangeText={props.onChangeDraft}
        autoCapitalize="words"
        autoCorrect={false}
        placeholder="Your name"
        placeholderTextColor={AM.inkGhost}
        returnKeyType="done"
        onSubmitEditing={props.onSubmit}
        accessibilityLabel="Your name"
      />
      <View style={{ marginTop: Space.s14 }}>
        <StampButton
          label="THAT'S ME"
          sub="LET'S GO"
          onPress={props.onSubmit}
          disabled={props.nameDraft.trim().length === 0}
          kind="amber"
          accessibilityHint="Submit your name and start the first set"
        />
      </View>
      <Pressable
        onPress={props.onSkip}
        accessibilityRole="button"
        accessibilityLabel="Just call me listener"
        hitSlop={10}
        style={({ pressed }) => [styles.skip, pressed && { opacity: 0.5 }]}
      >
        <Text style={styles.skipText}>just call me listener</Text>
      </Pressable>
    </View>
  );
}

function BakingBody(props: { name: string }) {
  return (
    <View>
      <Text style={styles.headline}>Putting your first set together,{'\n'}<Text style={styles.headlineAmber}>{props.name}</Text>.</Text>
      <View style={styles.linerWrap}>
        <LinerNotes>One moment — this only happens the first time.</LinerNotes>
      </View>
    </View>
  );
}

function ReadyBody(props: { name: string; onPressPlay: () => void }) {
  return (
    <View>
      <Text style={styles.headline}>Ready,{'\n'}<Text style={styles.headlineAmber}>{props.name}</Text>.</Text>
      <View style={{ marginTop: Space.s30 }}>
        <StampButton
          label="DROP THE NEEDLE"
          sub="LET'S BEGIN"
          onPress={props.onPressPlay}
          kind="amber"
          accessibilityHint="Start your first listen"
        />
      </View>
    </View>
  );
}

function ErrorBody(props: { message: string; onTakeMeHome: () => void }) {
  return (
    <View>
      <Text style={styles.headline}>Hmm.</Text>
      <View style={styles.linerWrap}>
        <Text style={styles.errorBody}>{props.message}</Text>
      </View>
      <View style={{ marginTop: Space.s30 }}>
        <StampButton
          label="TAKE ME HOME"
          sub="WE'LL TRY AGAIN LATER"
          onPress={props.onTakeMeHome}
          kind="amber"
          accessibilityHint="Skip first listen and go to the home screen"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: Space.s20 },
  content: { flex: 1 },
  kicker: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 3, color: AM.inkDim },
  vinylWrap: { alignItems: 'center', marginTop: Space.s30 },
  headline: {
    marginTop: Space.s26,
    fontFamily: Fonts.display,
    fontSize: TypeScale.s42,
    color: AM.ink,
    letterSpacing: 0.8,
    lineHeight: 50,
    textAlign: 'center',
  },
  headlineAmber: { color: AM.amber },
  linerWrap: { marginTop: Space.s26 },
  errorBody: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s15,
    color: AM.inkMid,
    lineHeight: TypeScale.s15 * 1.5,
  },
  nameInput: {
    marginTop: Space.s26,
    fontFamily: Fonts.serif,
    fontSize: TypeScale.s22,
    color: AM.ink,
    paddingVertical: Space.s10,
    borderBottomWidth: 1,
    borderBottomColor: AM.rule,
    textAlign: 'center',
  },
  skip: { alignItems: 'center', paddingVertical: Space.s10, marginTop: Space.s14 },
  skipText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.inkDim,
    textDecorationLine: 'underline',
  },
});
