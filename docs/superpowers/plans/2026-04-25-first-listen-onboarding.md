# First-Listen Onboarding Bake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a personalized first-listen prep screen between `music-auth` and `/(main)` so first-time users meet ONAY by name, with a fresh bake from the playlist they were just listening to, and a press-play CTA.

**Architecture:** New screen `app/(onboarding)/first-listen.tsx` walks the user through three sequential states (name capture → bake-in-flight → press-play). Personalization uses `fetchPlaylists()`'s existing `lastPlayedDate` ordering — first user playlist with ≥5 sanitize-passing tracks; falls back to a pre-baked featured broadcast when no qualifying playlist exists. The bake gates on name input so the cold open's TTS audio commits with the user's name. No auto-play — the user's tap on `DROP THE NEEDLE` is the user-initiated event that activates the audio session.

**Tech Stack:** TypeScript strict mode, React Native + Expo Router, MMKV for persistence, existing `BroadcastManifestClient` for the bake call, existing `expo-music-kit` native module for playlists, Jest + ts-jest for unit tests of pure helpers.

**Spec:** [`docs/superpowers/specs/2026-04-25-first-listen-onboarding-design.md`](../specs/2026-04-25-first-listen-onboarding-design.md)

**Issue:** [bworthy89/cleo#33](https://github.com/bworthy89/cleo/issues/33). Phase 2 milestone.

**Branch:** `phase-2-first-listen-onboarding` (already created; spec already committed).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/services/Storage.ts` (**modify**) | Add `hasAnyBroadcastHistory()` accessor for the first-launch gate |
| `__tests__/services/Storage.test.ts` (**modify**) | Test the new accessor |
| `src/onboarding/firstListenSource.ts` (**new**) | Pure helper: pick the playlist or featured fallback for the first listen |
| `__tests__/onboarding/firstListenSource.test.ts` (**new**) | Unit tests for the selection helper (4 path cases) |
| `app/(onboarding)/first-listen.tsx` (**new**) | The prep screen; State A/B/C state machine, name input, bake orchestration, press-play CTA |
| `app/(onboarding)/music-auth.tsx` (**modify**) | `finish()` routes to `first-listen` instead of `/(main)` |
| `app/index.tsx` (**modify**) | Auth-redirect logic: first-time users (empty broadcast history) land on `first-listen`; users with history skip to `/(main)` |
| `modules/expo-music-kit/index.ts` (**modify**) | JSDoc on `fetchPlaylists` documenting the `lastPlayedDate` ordering semantic |
| `CLAUDE.md` (**modify**) | Note the ordering semantic + the first-listen flow in the onboarding section |

---

## Notes for the Implementer

- TypeScript strict mode. No `any` casts unless unavoidable.
- The codebase has **no React Native screen-test infrastructure** today (no `*.test.tsx` files, no `@testing-library/react-native`). This plan **does not introduce screen tests** — that's a separate infrastructure lift. The screen's correctness is verified via TypeScript + manual TestFlight smoke.
- Pure-helper unit tests live under `__tests__/` at the repo root, mirroring `src/` (e.g., `src/services/Storage.ts` → `__tests__/services/Storage.test.ts`). Use `__mocks__/react-native-mmkv` for MMKV-touching tests; pattern is established in the existing Storage test.
- Run client-side Jest from the repo root: `npx jest <pattern>`. Server tests live under `server/` and are unrelated to this work.
- Commit-message convention: `<type>(<scope>): <subject>` (e.g., `feat(client):`, `test(client):`, `chore(client):`) with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` footer.
- Don't `git add -A` — the working tree has unrelated dirty files. Stage exact paths only.
- Vibe selection for the bake: time-of-day default (`morning` 5–11, `lateNight` 22–5, `feelGood` otherwise). Simple, defensible, no new product decision.
- The branch is `phase-2-first-listen-onboarding` and the spec lives at `docs/superpowers/specs/2026-04-25-first-listen-onboarding-design.md` — read it once for context before starting.

---

### Task 1: `hasAnyBroadcastHistory()` accessor in Storage.ts

**Files:**
- Modify: `src/services/Storage.ts` — add new exported function
- Modify: `__tests__/services/Storage.test.ts` — add new test cases

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/services/Storage.test.ts` after the existing `getBroadcastHistory` test block (anywhere inside the same outer file scope is fine — there's no single wrapping `describe` block):

```ts
describe('hasAnyBroadcastHistory', () => {
  it('returns false on a fresh install', () => {
    expect(hasAnyBroadcastHistory()).toBe(false);
  });

  it('returns true after a broadcast lands in history', () => {
    const manifest = {
      broadcastId: 'b1', userId: 'u1', playlistId: 'p1',
      vibe: 'morning' as const, length: 'quick' as const, createdAt: Date.now(),
      tracks: [{ id: 't0', title: 'T', artistName: 'A', albumTitle: 'Al', duration: 200 }],
      segmentSlots: [],
    };
    addBroadcastToHistory(manifest as any, ['https://cdn/v0.mp3']);
    expect(hasAnyBroadcastHistory()).toBe(true);
  });

  it('returns false when all entries are past the retention window', () => {
    const manifest = {
      broadcastId: 'old', userId: 'u1', playlistId: 'p1',
      vibe: 'morning' as const, length: 'quick' as const, createdAt: 0,
      tracks: [{ id: 't0', title: 'T', artistName: 'A', albumTitle: 'Al', duration: 200 }],
      segmentSlots: [],
    };
    addBroadcastToHistory(manifest as any, ['https://cdn/v0.mp3']);
    // Advance time past the retention window. getBroadcastHistory prunes
    // expired entries on read; hasAnyBroadcastHistory delegates to it.
    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + BROADCAST_HISTORY_RETENTION_MS + 1000);
    try {
      expect(hasAnyBroadcastHistory()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
```

Then add `hasAnyBroadcastHistory` to the imports at the top of the test file:

```ts
import {
  getUser,
  setUser,
  // ... existing imports ...
  hasAnyBroadcastHistory,   // ← new
  // ... existing imports ...
} from '../../src/services/Storage';
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx jest __tests__/services/Storage.test.ts -t "hasAnyBroadcastHistory"`
Expected: FAIL — "hasAnyBroadcastHistory is not exported" (compile-time TypeScript error from ts-jest).

- [ ] **Step 3: Implement the accessor**

In `src/services/Storage.ts`, add a new exported function immediately after the existing `getBroadcastHistory` function (around line 189):

```ts
/**
 * True iff the user has at least one non-expired broadcast in history.
 * Used to gate the first-listen onboarding flow — a returning user with
 * any prior broadcast skips straight to /(main).
 */
export function hasAnyBroadcastHistory(): boolean {
  return getBroadcastHistory().length > 0;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx jest __tests__/services/Storage.test.ts`
Expected: PASS — all existing Storage tests + the 3 new ones.

Also run TS check:
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/services/Storage.ts __tests__/services/Storage.test.ts
git commit -m "$(cat <<'EOF'
feat(client): add hasAnyBroadcastHistory accessor

Convenience wrapper around getBroadcastHistory() for the upcoming
first-listen onboarding gate (issue #33). Returns true iff the user
has at least one non-expired broadcast in their MMKV history.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `firstListenSource` selection helper

**Files:**
- Create: `src/onboarding/firstListenSource.ts`
- Create: `__tests__/onboarding/firstListenSource.test.ts`

The helper picks one of: a user-playlist source (first playlist with ≥5 sanitize-passing tracks, ordered by `lastPlayedDate` since `fetchPlaylists` already sorts that way), a featured-broadcast fallback, or `kind: 'none'` if neither is available.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/onboarding/firstListenSource.test.ts`:

```ts
import { pickFirstListenSource } from '../../src/onboarding/firstListenSource';
import type { MusicPlaylist, MusicTrack } from '../../modules/expo-music-kit';

const validTrack = (id: string): MusicTrack => ({
  id, title: `T${id}`, artistName: 'A', albumTitle: 'Al', duration: 200,
  // playlistsCacheKey is unused; the helper only consumes id/title/artist/duration
  artworkUrl: undefined, genreNames: undefined, isrc: undefined,
} as MusicTrack);

const playlist = (id: string, name: string): MusicPlaylist => ({
  id, name, trackCount: 10,
} as MusicPlaylist);

describe('pickFirstListenSource', () => {
  it('returns the first user playlist with >= 5 valid tracks', async () => {
    const deps = {
      fetchPlaylists: jest.fn(async () => [playlist('p1', 'My Mix'), playlist('p2', 'Other')]),
      fetchPlaylistTracks: jest.fn(async (id: string) => {
        if (id === 'p1') return [validTrack('a'), validTrack('b'), validTrack('c'), validTrack('d'), validTrack('e')];
        return [];
      }),
      listFeatured: jest.fn(async () => []),
    };
    const result = await pickFirstListenSource(deps);
    expect(result.kind).toBe('user');
    if (result.kind !== 'user') throw new Error('expected user');
    expect(result.playlistId).toBe('p1');
    expect(result.playlistName).toBe('My Mix');
    expect(result.tracks).toHaveLength(5);
    // Should NOT have queried p2 because p1 already qualified.
    expect(deps.fetchPlaylistTracks).toHaveBeenCalledTimes(1);
  });

  it('skips playlists with fewer than 5 valid tracks and tries the next', async () => {
    const deps = {
      fetchPlaylists: jest.fn(async () => [playlist('small', 'Small'), playlist('big', 'Big')]),
      fetchPlaylistTracks: jest.fn(async (id: string) => {
        if (id === 'small') return [validTrack('a'), validTrack('b')];
        if (id === 'big') return Array.from({ length: 8 }, (_, i) => validTrack(`b${i}`));
        return [];
      }),
      listFeatured: jest.fn(async () => []),
    };
    const result = await pickFirstListenSource(deps);
    expect(result.kind).toBe('user');
    if (result.kind !== 'user') throw new Error('expected user');
    expect(result.playlistId).toBe('big');
  });

  it('falls back to featured when no playlist qualifies', async () => {
    const featuredEntry = {
      id: 'feat-1',
      title: 'Tonight',
      description: 'A featured set.',
      vibe: 'feelGood' as const,
      length: 'standard' as const,
      baked: true,
      createdAt: Date.now(),
      manifest: { broadcastId: 'feat-1', segmentSlots: [] } as any,
    };
    const deps = {
      fetchPlaylists: jest.fn(async () => [playlist('p1', 'Empty')]),
      fetchPlaylistTracks: jest.fn(async () => []),
      listFeatured: jest.fn(async () => [featuredEntry]),
    };
    const result = await pickFirstListenSource(deps);
    expect(result.kind).toBe('featured');
    if (result.kind !== 'featured') throw new Error('expected featured');
    expect(result.featured.id).toBe('feat-1');
  });

  it('returns kind: none when fetchPlaylists throws AND featured registry is empty', async () => {
    const deps = {
      fetchPlaylists: jest.fn(async () => { throw new Error('not authorized'); }),
      fetchPlaylistTracks: jest.fn(async () => []),
      listFeatured: jest.fn(async () => []),
    };
    const result = await pickFirstListenSource(deps);
    expect(result.kind).toBe('none');
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx jest __tests__/onboarding/firstListenSource.test.ts`
Expected: FAIL — "Cannot find module '../../src/onboarding/firstListenSource'".

- [ ] **Step 3: Implement the helper**

Create `src/onboarding/firstListenSource.ts`:

```ts
import type { MusicPlaylist, MusicTrack } from '../../modules/expo-music-kit';
import type { FeaturedBroadcast } from '../engines/BroadcastCurationClient';
import { sanitizeTracksForBake } from '../engines/BroadcastManifestClient';

export type FirstListenSource =
  | {
      kind: 'user';
      playlistId: string;
      playlistName: string;
      // Sanitized tracks ready to send to /broadcast/create.
      tracks: ReturnType<typeof sanitizeTracksForBake>;
    }
  | { kind: 'featured'; featured: FeaturedBroadcast }
  | { kind: 'none' };

export interface FirstListenSourceDeps {
  fetchPlaylists: () => Promise<MusicPlaylist[]>;
  fetchPlaylistTracks: (id: string) => Promise<MusicTrack[]>;
  listFeatured: () => Promise<FeaturedBroadcast[]>;
}

const MIN_TRACKS = 5;

/**
 * Pick the source for a user's first-listen broadcast.
 *
 * Order:
 *   1. First user playlist with ≥5 sanitize-passing tracks. fetchPlaylists()
 *      is already sorted by Apple's lastPlayedDate (most-recent first), so
 *      this is the playlist the user was just listening to.
 *   2. Latest featured broadcast from the registry (pre-baked; instant).
 *   3. kind: 'none' if neither is available — caller decides how to degrade.
 *
 * fetchPlaylists throwing is handled (e.g., user skipped Apple Music auth).
 * Per-playlist fetch errors stop iteration through that playlist but not
 * the whole search.
 */
export async function pickFirstListenSource(
  deps: FirstListenSourceDeps,
): Promise<FirstListenSource> {
  let playlists: MusicPlaylist[] = [];
  try {
    playlists = await deps.fetchPlaylists();
  } catch {
    // Skipped Apple Music auth or other library access failure — continue
    // to featured fallback.
  }

  for (const p of playlists) {
    let raw: MusicTrack[] = [];
    try {
      raw = await deps.fetchPlaylistTracks(p.id);
    } catch {
      continue;
    }
    const sanitized = sanitizeTracksForBake(raw);
    if (sanitized.length >= MIN_TRACKS) {
      return {
        kind: 'user',
        playlistId: p.id,
        playlistName: p.name,
        tracks: sanitized,
      };
    }
  }

  let featured: FeaturedBroadcast[] = [];
  try {
    featured = await deps.listFeatured();
  } catch {
    // Registry unreachable — fall through to none.
  }
  if (featured.length > 0) {
    return { kind: 'featured', featured: featured[0] };
  }

  return { kind: 'none' };
}
```

`FeaturedBroadcast` carries the full `manifest` inline (it's `BroadcastCurationClient`'s response shape — see `src/engines/BroadcastCurationClient.ts:6-18`), so the consumer doesn't need a second fetch to get the manifest. `sanitizeTracksForBake` is exported from `src/engines/BroadcastManifestClient.ts`.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx jest __tests__/onboarding/firstListenSource.test.ts`
Expected: PASS — 4 tests green.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/onboarding/firstListenSource.ts __tests__/onboarding/firstListenSource.test.ts
git commit -m "$(cat <<'EOF'
feat(client): add pickFirstListenSource helper for #33

Pure helper that picks the source for a user's first-listen broadcast:
first user playlist with ≥5 sanitize-passing tracks (fetchPlaylists is
already lastPlayedDate-sorted, so this is the playlist they were just
listening to in Apple Music), falling back to the latest featured
broadcast, falling back to kind: 'none'.

Dependency-injected via FirstListenSourceDeps so tests use jest.fn()
mocks rather than the native module. 4 unit tests cover the path
matrix.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: First-listen screen — State A (name capture) + scaffold

**Files:**
- Create: `app/(onboarding)/first-listen.tsx`

This task lays down the screen scaffold (state machine + States A's UI) but does NOT yet kick off the bake. The handlers transition to State B but State B/C/error rendering is stubbed for Task 4 to fill in.

- [ ] **Step 1: Create the file with State A + scaffolding**

Create `app/(onboarding)/first-listen.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
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
        <LinerNotes>{props.message}</LinerNotes>
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
  nameInput: {
    marginTop: Space.s26,
    fontFamily: Fonts.display,
    fontSize: TypeScale.s24,
    color: AM.ink,
    letterSpacing: 0.5,
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean. The screen file itself shouldn't have any errors. (Expo Router will still complain at runtime about the missing music-auth → first-listen wiring, but that's Task 6.)

- [ ] **Step 3: Smoke check the imports + tokens**

Look at the imports — `AM`, `Fonts`, `Space`, `TypeScale`, `BroadcastBackdrop`, `StampButton`, `LinerNotes`, `SpinningRecord`. Verify each exists at the path imported:

```bash
grep -l "export.*StampButton\|export.*LinerNotes\|export.*SpinningRecord" src/components/crate/index.ts
grep -l "export.*BroadcastBackdrop" src/components/BroadcastBackdrop.tsx
grep "export.*\(AM\|Fonts\|Space\|TypeScale\)" src/tokens/design-tokens.ts | head -5
```

If any import doesn't resolve, fix the path before committing.

- [ ] **Step 4: Commit**

```bash
git add app/\(onboarding\)/first-listen.tsx
git commit -m "$(cat <<'EOF'
feat(client): scaffold first-listen onboarding screen for #33

State machine for the prep screen between music-auth and /(main):
States A (name capture), B (bake-in-flight), C (ready/press-play),
and error. State A is fully implemented — captures the user's name,
persists to MMKV, transitions to B. States B/C/error render their
copy but the bake orchestration + press-play handler land in the
next task.

A user with a name already in MMKV (from Firebase displayName or a
prior partial onboarding) skips State A and starts in B.

No tests — the codebase has no React Native screen test infrastructure
today; correctness is verified via TypeScript + manual TestFlight smoke.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: First-listen screen — bake orchestration + press-play handler

**Files:**
- Modify: `app/(onboarding)/first-listen.tsx`

Wire State B to actually fire `pickFirstListenSource` and `BroadcastManifestClient.createBroadcast`, then transition to State C with a working press-play CTA.

- [ ] **Step 1: Add the bake orchestration**

Edit `app/(onboarding)/first-listen.tsx`. Replace the imports block at the top with:

```tsx
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
```

Note: confirm `BroadcastCurationClient` is the right import for `fetchFeaturedRegistry`. Check with:

```bash
grep -rn "fetchFeaturedRegistry\|featured.*list\b" src/engines/ | head -5
```

If the featured-list method lives on `BroadcastManifestClient` instead, adjust the import. If it doesn't exist at all, search for the method that calls `GET /broadcast/featured`.

Replace the `ScreenState` type with a richer version that carries the bake result:

```tsx
type ScreenState =
  | { kind: 'name' }
  | { kind: 'baking'; name: string }
  | { kind: 'ready'; name: string; manifest: Manifest; firstSegmentUrls: string[] }
  | { kind: 'error'; message: string };
```

Replace the body of `FirstListenScreen` with a version that drives the bake side-effect on State B entry:

```tsx
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
              dayOfWeek: localDayOfWeekShort(),
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
    setState({ kind: 'baking', name: 'tonight’s listener' });
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

function localDayOfWeekShort(): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
}
```

The `NameCaptureBody`, `BakingBody`, `ReadyBody`, `ErrorBody`, and `styles` blocks from Task 3 stay unchanged.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean. If `BroadcastCurationClient.fetchFeaturedRegistry` doesn't exist or has a different name, the compile will tell you. Look in `src/engines/BroadcastCurationClient.ts` and `src/engines/BroadcastManifestClient.ts` for the method that hits `GET /broadcast/featured`. Use the right one. The same applies to `fetchFeaturedManifest` — the actual method name might be `fetchManifest` or similar. Check existing `HomeBroadcastScreen.tsx` for how it loads featured broadcasts:

```bash
grep -n "featured\|fetchFeatured\|fetchManifest" src/screens/home/HomeBroadcastScreen.tsx | head -10
```

Adapt the imports + method calls in `runBake` to whatever the existing patterns use. The plan's exact method names are best-guess; the existing screen is the source of truth for the right shape.

- [ ] **Step 3: Smoke-test by running the type-check + the existing test suite**

Run: `npx jest 2>&1 | tail -10`
Expected: all existing tests pass. The new screen file isn't unit-tested but shouldn't break anything.

- [ ] **Step 4: Commit**

```bash
git add app/\(onboarding\)/first-listen.tsx
git commit -m "$(cat <<'EOF'
feat(client): wire first-listen bake orchestration + press-play

State B side-effect now fires on entry: pickFirstListenSource resolves
the user's most-recently-played qualifying playlist (or featured
fallback), and the bake POST runs with a 30s AbortController timeout.
Result lands in State C; press-play CTA navigates to /player and
starts the broadcastPlayer.

The user-playlist path uses time-of-day vibe defaults (morning 5-11,
lateNight 22-5, feelGood otherwise). firstTimeUser is true; the cold
open prompt picks first-time-user phrasing.

Late-cancel guard via bakeAttemptRef ignores stale results if the
state machine flipped during an in-flight call.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire music-auth + app/index.tsx routing

**Files:**
- Modify: `app/(onboarding)/music-auth.tsx`
- Modify: `app/index.tsx`

- [ ] **Step 1: Update `music-auth.tsx`'s `finish()` to navigate to first-listen**

Edit `app/(onboarding)/music-auth.tsx`. Find the existing `finish` function (around line 15):

```tsx
const finish = (appleMusicAuthorized: boolean) => {
    const existing = getUser();
    setUser({
      name: existing?.name,
      appleMusicAuthorized,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    });
    router.replace('/(main)');
  };
```

Change the final line to navigate to first-listen:

```tsx
const finish = (appleMusicAuthorized: boolean) => {
    const existing = getUser();
    setUser({
      name: existing?.name,
      appleMusicAuthorized,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    });
    router.replace('/(onboarding)/first-listen');
  };
```

- [ ] **Step 2: Update `app/index.tsx` auth-redirect to gate first-listen on history**

Edit `app/index.tsx`. The current file ends with two redirects:

```tsx
  // Logged in but no local profile (first login)
  const user = getUser();
  if (!user) {
    return <Redirect href="/(onboarding)/welcome" />;
  }

  // Logged in with profile
  return <Redirect href="/(main)" />;
}
```

Add the `hasAnyBroadcastHistory` import alongside the existing Storage imports at the top of the file:

```tsx
import { getUser, setUser, clearUserData, hasAnyBroadcastHistory } from '../src/services/Storage';
```

Replace the final `return <Redirect href="/(main)" />;` block (the "Logged in with profile" comment and its return) with:

```tsx
  // Logged in with profile. First-time users (no broadcast history yet)
  // route through first-listen onboarding so ONAY introduces herself with
  // a personalized bake. Returning users skip directly to /(main).
  // UITEST_MODE bypasses to keep snapshot tests deterministic.
  if (!UITEST_MODE && !hasAnyBroadcastHistory()) {
    return <Redirect href="/(onboarding)/first-listen" />;
  }
  return <Redirect href="/(main)" />;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Smoke check the redirect logic**

There's no automated test for the routing, but verify by reading:

- `app/(onboarding)/music-auth.tsx` finish function navigates to `/(onboarding)/first-listen`
- `app/index.tsx` has both branches: returning users → `/(main)`, first-time → `/(onboarding)/first-listen`
- The first-listen screen file (from Task 3+4) exists at `app/(onboarding)/first-listen.tsx`

- [ ] **Step 5: Commit**

```bash
git add app/\(onboarding\)/music-auth.tsx app/index.tsx
git commit -m "$(cat <<'EOF'
feat(client): route first-time users through first-listen screen

music-auth.tsx finish() now navigates to /(onboarding)/first-listen
instead of /(main) directly. app/index.tsx auth-redirect gates
first-listen on hasAnyBroadcastHistory() — returning users with prior
broadcasts skip straight to /(main); first-time users land on the
prep screen.

Final piece of #33's wiring; the screen itself + bake orchestration
landed in earlier commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Documentation — JSDoc on `fetchPlaylists` + CLAUDE.md notes

**Files:**
- Modify: `modules/expo-music-kit/index.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add JSDoc on `fetchPlaylists`**

Edit `modules/expo-music-kit/index.ts`. Find the existing `fetchPlaylists` declaration:

```ts
export async function fetchPlaylists(): Promise<MusicPlaylist[]> {
  return await ExpoMusicKit.fetchPlaylists();
}
```

Add a JSDoc block above it:

```ts
/**
 * Fetch the user's Apple Music playlists.
 *
 * **Ordering:** results are sorted by Apple's `lastPlayedDate` (most-recent
 * first), via `MusicLibraryRequest<Playlist>().sort(by: \.lastPlayedDate)`
 * in the native module. The first entry is the playlist the user was just
 * listening to in Apple Music — useful as a "what should ONAY play first?"
 * signal (see `src/onboarding/firstListenSource.ts`).
 *
 * `lastPlayedDate` reflects whole-Apple-Music history (across the iOS
 * Music app, etc.), not just plays inside this app — so the ordering is
 * meaningful even on fresh app installs for existing Apple Music users.
 */
export async function fetchPlaylists(): Promise<MusicPlaylist[]> {
  return await ExpoMusicKit.fetchPlaylists();
}
```

- [ ] **Step 2: Update CLAUDE.md**

Find the section in `CLAUDE.md` about the onboarding flow (search for `(onboarding)` or `welcome → music-auth`). Add a note about the first-listen flow:

```bash
grep -n "(onboarding)/welcome\|cleo-setup\|music-auth.tsx" CLAUDE.md | head -5
```

Wherever the onboarding flow is documented, update it to reflect the new sequence:

```text
welcome → music-auth → first-listen → /(main)
                       └─ skipped on subsequent launches
                          (gated on hasAnyBroadcastHistory())
```

Also find the section that mentions `fetchPlaylists` (likely under `Tech Stack` → `Custom expo-music-kit native module` or similar) and add:

> `fetchPlaylists()` returns playlists sorted by Apple's `lastPlayedDate` (most-recent first) — used for first-listen onboarding personalization.

Use `grep -n` to find the right spots; the file is long and the right section depends on its current structure.

- [ ] **Step 3: Verify**

Read both edits and confirm they're accurate. No tests for docs; the change is purely informational.

- [ ] **Step 4: Commit**

```bash
git add modules/expo-music-kit/index.ts CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: document fetchPlaylists ordering + first-listen flow

JSDoc on fetchPlaylists notes the lastPlayedDate-first ordering
that the native module already produces, plus the firstListenSource
consumer. CLAUDE.md updated with the new welcome → music-auth →
first-listen → /(main) flow and the hasAnyBroadcastHistory() gate
for returning users.

Closes #33.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Pre-PR checklist

- [ ] All 6 tasks complete
- [ ] `npx jest` from repo root — full client suite green (the 7 new Storage tests + 4 new firstListenSource tests + everything else)
- [ ] `npx tsc --noEmit` — clean
- [ ] **Manual TestFlight verification** on a real iOS device with a fresh Apple Music sign-in:
  - First-listen screen appears after music-auth completes
  - Name input or skip works; name persists to MMKV (re-launch with same UID, name pre-fills)
  - Bake completes and State C shows DROP THE NEEDLE
  - Press-play navigates to /player and audio starts (cold open addresses by name)
  - Returning to onboarding (e.g., via Profile → sign out → sign in) skips the screen because history exists
  - **Verify the playlist used by first-listen matches what you were last listening to in the iOS Music app** (this is the empirical check that closes the #40 question)
- [ ] If any step blew up the bake (network slow, server error), the error variant ("Hmm. Take me home.") rendered correctly
- [ ] `coderabbit review --plain --base main --type committed` from repo root; verify each finding against current code, fix legitimate ones in new commits, re-run only if substantive
- [ ] `gh pr create --title "feat(client): first-listen onboarding bake (#33)"` with a body summarizing the screen flow + the manual verification result
