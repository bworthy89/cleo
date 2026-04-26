import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { AM, Fonts, Space, TypeScale } from '../../src/tokens/design-tokens';
import { BroadcastBackdrop } from '../../src/components/BroadcastBackdrop';
import { StampButton, LinerNotes, SpinningRecord } from '../../src/components/crate';
import { getUser, setUser } from '../../src/services/Storage';

type ScreenState =
  | { kind: 'name' }
  | { kind: 'baking'; name: string }
  | { kind: 'ready'; name: string }
  | { kind: 'error'; message: string };

export default function FirstListenScreen() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<ScreenState>(() => {
    // If we already have a name (from Firebase displayName written into
    // MMKV elsewhere, or persisted from a prior partial onboarding),
    // skip State A.
    const existing = getUser();
    return existing?.name
      ? { kind: 'baking', name: existing.name }
      : { kind: 'name' };
  });

  const [nameDraft, setNameDraft] = useState('');

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
    setState({ kind: 'baking', name: 'tonight’s listener' });
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
            <ReadyBody name={state.name} onPressPlay={() => { /* Task 4 */ }} />
          ) : (
            <ErrorBody message={state.message} onTakeMeHome={() => router.replace('/(main)')} />
          )}
        </View>
      </View>
    </BroadcastBackdrop>
  );
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
