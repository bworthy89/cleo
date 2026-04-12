# Pre-Baked Broadcast — Plan 4: Delete Old Code + Migrate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rip out the live-generation runtime now that the pre-baked broadcast pipeline is proven end-to-end. Delete dead client code, promote `broadcast-player.tsx` to the primary player route, flip the feature flag to on and remove the flag, and clear deprecated MMKV state for returning users.

**Architecture:** Pure subtraction. No new functionality. Each task deletes one coherent slice and verifies the app still builds + runs. Commits are fine-grained so regressions can be bisected.

**Tech Stack:** Same as prior plans.

**Spec:** `docs/superpowers/specs/2026-04-12-pre-baked-broadcast-design.md` (section: Migration path — "Delete entirely")

**Depends on:** Plans 1, 2, and 3 complete and tagged. The new system is proven to work end-to-end on device before any of this plan runs.

---

## Pre-flight checklist

Before starting Plan 4:

- [ ] `plan-1-server-complete` tag exists
- [ ] `plan-2-broadcast-player-complete` tag exists
- [ ] `plan-3-home-and-curation-complete` tag exists
- [ ] Full device test within the last 24h confirming: start a broadcast, play through completion, resume after kill, featured broadcast plays
- [ ] Tag `pre-plan-4-baseline` at the current HEAD so a clean rollback point exists:
  ```bash
  git tag -a pre-plan-4-baseline -m "Last known-good state before deletion pass"
  ```

---

## File Structure

**Delete — client engines (no replacement; behavior moved server-side or into `BroadcastPlayer`):**
- `src/engines/TransitionPreloader.ts`
- `src/engines/SegmentController.ts`
- `src/engines/QueuePlanner.ts`
- `src/engines/LocalQueuePlanner.ts`
- `src/engines/SessionEngine.ts`
- `src/engines/AudioCoordinator.ts`
- `src/engines/QueueManager.ts`
- `src/engines/RulesEngine.ts`
- `src/engines/PlaylistCurator.ts` (if only used by old pipeline — verify first)
- `__tests__/engines/TransitionPreloader.test.ts`
- `__tests__/engines/SegmentController.test.ts`
- `__tests__/engines/AudioCoordinator.test.ts`
- `__tests__/engines/QueueManager.test.ts`
- `__tests__/engines/SessionEngine.test.ts`
- `__tests__/engines/LocalQueuePlanner.test.ts`

**Delete — client services:**
- `src/services/CleoScriptGenerator.ts` (lifted server-side in Plan 1)
- `src/services/CleoVoiceEngine.ts` (lifted server-side in Plan 1)
- `__tests__/services/CleoScriptGenerator.test.ts`
- `__tests__/services/CleoVoiceEngine.test.ts`

**Delete — client screens/components (replaced by Plan 2/3):**
- `src/screens/home/HomeScreenRedesign.tsx`
- `src/screens/player/BroadcastScreen.tsx`

**Delete — client `cleo/` logic lifted to server:**
- `src/cleo/static-core.ts` (reference only — source moved into `server/src/services/broadcast/SegmentScriptBuilder.ts`)
- `src/cleo/fallbacks.ts`
- `src/cleo/cold-opens.ts`
- `__tests__/cleo/coldOpens.test.ts`
- `__tests__/cleo/fallbacks.test.ts`

**Modify:**
- `app/(main)/(broadcast)/index.tsx` — unconditionally render `HomeBroadcastScreen`, remove flag branch
- `app/(main)/(broadcast)/player.tsx` — delete (replaced by `broadcast-player.tsx`)
- `app/(main)/(broadcast)/broadcast-player.tsx` → rename to `player.tsx`
- `app/(main)/(broadcast)/_layout.tsx` — remove the old `player` Stack.Screen entry if it was separately listed; confirm only one player route remains
- `src/services/Storage.ts` — remove `StorageKeys.STATIONS`, `STATIONS` storage helpers (`getStations`, `setStations`, `addStation`), `RECENTLY_PLAYED` (if unused), unused station types
- `src/config/flags.ts` — delete the `broadcastHome` flag (unconditional now)
- Native module: remove `playEjectTransition`, `cancelEjectTransition`, `onEjectTrackChanged` listener registration from `modules/expo-music-kit/index.ts` and the Swift implementation — see Task 6

**Delete — native module eject code:**
- `playEjectTransition(ttsBase64, fadeInDelayMs)` function in `modules/expo-music-kit/ios/ExpoMusicKitModule.swift` (plus helper state for crossfade coordination)
- `cancelEjectTransition()` function (same file)
- `onEjectTrackChanged` event emission sites (same file)
- Corresponding TS exports in `modules/expo-music-kit/index.ts`

---

## Task 1: Verify current state is green

**Files:** (none — verification only)

- [ ] **Step 1: Check on the right branch**

```bash
git status
git branch --show-current
```

Expected: clean working tree, on the branch where Plans 1-3 are merged.

- [ ] **Step 2: Run all tests**

```bash
npx jest
cd server && npx jest && cd ..
```

Expected: everything passes.

- [ ] **Step 3: Build for iOS**

```bash
npx expo prebuild --platform ios --no-install
npx tsc --noEmit
```

Expected: no TypeScript errors. Prebuild completes without failure.

- [ ] **Step 4: Device smoke test**

On a physical iPhone: launch the app, start a user-sourced broadcast, play through a track transition, confirm ONAY speaks and music continues.

Do NOT proceed to Task 2 unless this works. If broken, bisect back to `pre-plan-4-baseline`.

---

## Task 2: Flip the feature flag + promote new player route

**Files:**
- Modify: `src/config/flags.ts`
- Modify: `app/(main)/(broadcast)/index.tsx`
- Delete: `app/(main)/(broadcast)/player.tsx`
- Rename: `app/(main)/(broadcast)/broadcast-player.tsx` → `app/(main)/(broadcast)/player.tsx`
- Modify: `src/screens/home/HomeBroadcastScreen.tsx` (fix the `router.push()` path)

- [ ] **Step 1: Confirm flag is already on**

Open `src/config/flags.ts`, confirm `broadcastHome: true`. If not, set it now and commit separately.

- [ ] **Step 2: Delete the old player route**

```bash
git rm app/\(main\)/\(broadcast\)/player.tsx
```

- [ ] **Step 3: Rename broadcast-player.tsx to player.tsx**

```bash
git mv app/\(main\)/\(broadcast\)/broadcast-player.tsx app/\(main\)/\(broadcast\)/player.tsx
```

- [ ] **Step 4: Update navigation push paths**

In `src/screens/home/HomeBroadcastScreen.tsx`, change:
```typescript
router.push('/(main)/(broadcast)/broadcast-player');
```
to:
```typescript
router.push('/(main)/(broadcast)/player');
```

(Expo Router will route to the renamed file.)

- [ ] **Step 5: Remove the old layout entry for `player` if it's duplicated**

Read `app/(main)/(broadcast)/_layout.tsx`. Ensure only one `<Stack.Screen name="player" />` entry remains. Remove any `<Stack.Screen name="broadcast-player" />` entry.

- [ ] **Step 6: Remove the flag branch in the home route**

In `app/(main)/(broadcast)/index.tsx`, replace:
```typescript
import { FLAGS } from '@/config/flags';
import HomeScreenRedesign from '@/screens/home/HomeScreenRedesign';
import HomeBroadcastScreen from '@/screens/home/HomeBroadcastScreen';

export default function HomeRoute() {
  return FLAGS.broadcastHome ? <HomeBroadcastScreen /> : <HomeScreenRedesign />;
}
```
with:
```typescript
import HomeBroadcastScreen from '@/screens/home/HomeBroadcastScreen';

export default function HomeRoute() {
  return <HomeBroadcastScreen />;
}
```

- [ ] **Step 7: Delete the flags file entirely (unless used by others)**

```bash
grep -rn "from '@/config/flags'" src app || echo "no imports — safe to delete"
```

If no other file imports it:
```bash
git rm src/config/flags.ts
```

If there are other imports, just remove the `broadcastHome` entry and keep the file.

- [ ] **Step 8: Build + device smoke test**

```bash
npx tsc --noEmit
```

Device test: home screen shows `HomeBroadcastScreen`, tapping a broadcast navigates to the (renamed) `player` route, playback works.

- [ ] **Step 9: Commit**

```bash
git add app/\(main\)/\(broadcast\)/ src/screens/home/HomeBroadcastScreen.tsx src/config/flags.ts
git commit -m "refactor: promote broadcast-player to primary player route; remove flag"
```

---

## Task 3: Delete HomeScreenRedesign

**Files:**
- Delete: `src/screens/home/HomeScreenRedesign.tsx`

- [ ] **Step 1: Confirm no remaining imports**

```bash
grep -rn "HomeScreenRedesign" src app __tests__ || echo "no imports — safe to delete"
```

Expected: nothing (Task 2 removed the last import). If anything remains, investigate before deleting.

- [ ] **Step 2: Delete**

```bash
git rm src/screens/home/HomeScreenRedesign.tsx
```

- [ ] **Step 3: Build**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete HomeScreenRedesign (replaced by HomeBroadcastScreen)"
```

---

## Task 4: Delete BroadcastScreen (old player)

**Files:**
- Delete: `src/screens/player/BroadcastScreen.tsx`

- [ ] **Step 1: Confirm no remaining imports**

```bash
grep -rn "screens/player/BroadcastScreen" src app __tests__ || echo "no imports"
grep -rn "from.*BroadcastScreen[^P]" src app __tests__ || echo "no imports"
```

Note: distinguish from `BroadcastPlayerScreen` (new) which may also match "Broadcast". If anything imports the old one, investigate.

- [ ] **Step 2: Delete**

```bash
git rm src/screens/player/BroadcastScreen.tsx
```

- [ ] **Step 3: If `src/screens/player/` is now empty, remove the dir**

```bash
ls src/screens/player/ || rmdir src/screens/player
```

- [ ] **Step 4: Build**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: delete old BroadcastScreen (replaced by player.tsx)"
```

---

## Task 5: Delete client engines that moved server-side

**Files:** (see list in File Structure above)

**Strategy:** Delete one engine at a time, rebuild after each to catch stale imports immediately. The order is bottom-up: dependency-free files first, so later files' deletions don't hit broken references.

- [ ] **Step 1: Delete TransitionPreloader**

```bash
grep -rn "TransitionPreloader" src app __tests__ | grep -v '^src/engines/TransitionPreloader.ts:'
```

Expected: only `__tests__/engines/TransitionPreloader.test.ts` references it. If anything else does, find the caller and remove the import first.

```bash
git rm src/engines/TransitionPreloader.ts __tests__/engines/TransitionPreloader.test.ts
npx tsc --noEmit
```

- [ ] **Step 2: Delete SegmentController**

```bash
grep -rn "SegmentController" src app __tests__ | grep -v '^src/engines/SegmentController.ts:'
```

Remove any callers. Then:
```bash
git rm src/engines/SegmentController.ts __tests__/engines/SegmentController.test.ts
npx tsc --noEmit
```

- [ ] **Step 3: Delete LocalQueuePlanner**

```bash
grep -rn "LocalQueuePlanner" src app __tests__ | grep -v '^src/engines/LocalQueuePlanner.ts:'
git rm src/engines/LocalQueuePlanner.ts __tests__/engines/LocalQueuePlanner.test.ts
npx tsc --noEmit
```

- [ ] **Step 4: Delete QueuePlanner**

```bash
grep -rn "src/engines/QueuePlanner" src app __tests__
```

If anything still imports the client-side `QueuePlanner` (as opposed to the server one), remove those imports. Then:
```bash
git rm src/engines/QueuePlanner.ts
npx tsc --noEmit
```

- [ ] **Step 5: Delete RulesEngine**

```bash
grep -rn "RulesEngine" src app __tests__ | grep -v '^src/engines/RulesEngine.ts:'
git rm src/engines/RulesEngine.ts
npx tsc --noEmit
```

- [ ] **Step 6: Delete PlaylistCurator (if unused)**

```bash
grep -rn "PlaylistCurator" src app __tests__ | grep -v '^src/engines/PlaylistCurator.ts:'
```

If referenced by `HomeBroadcastScreen` or anything live, leave it. If only by deleted code, delete:
```bash
git rm src/engines/PlaylistCurator.ts
npx tsc --noEmit
```

- [ ] **Step 7: Delete QueueManager**

```bash
grep -rn "QueueManager" src app __tests__ | grep -v '^src/engines/QueueManager.ts:'
```

Remove any callers. Then:
```bash
git rm src/engines/QueueManager.ts __tests__/engines/QueueManager.test.ts
npx tsc --noEmit
```

- [ ] **Step 8: Delete AudioCoordinator**

```bash
grep -rn "AudioCoordinator" src app __tests__ | grep -v '^src/engines/AudioCoordinator.ts:'
git rm src/engines/AudioCoordinator.ts __tests__/engines/AudioCoordinator.test.ts
npx tsc --noEmit
```

- [ ] **Step 9: Delete SessionEngine**

```bash
grep -rn "SessionEngine" src app __tests__ | grep -v '^src/engines/SessionEngine.ts:'
```

If anything still imports (e.g., ProfileScreen showing session stats), stub out those usages first. Then:
```bash
git rm src/engines/SessionEngine.ts __tests__/engines/SessionEngine.test.ts
npx tsc --noEmit
```

- [ ] **Step 10: Commit each deletion**

After each engine is deleted cleanly, commit:
```bash
git commit -m "chore: delete <EngineName> (replaced by server-side pipeline or BroadcastPlayer)"
```

Granular commits enable bisecting if a later runtime issue traces back to one specific deletion.

- [ ] **Step 11: Device smoke test**

Build and launch. Full broadcast flow: home → start → play through → resume. Expect everything to still work.

---

## Task 6: Delete Cleo voice + script services

**Files:**
- Delete: `src/services/CleoScriptGenerator.ts`
- Delete: `src/services/CleoVoiceEngine.ts`
- Delete: `__tests__/services/CleoScriptGenerator.test.ts`
- Delete: `__tests__/services/CleoVoiceEngine.test.ts`

- [ ] **Step 1: Confirm no remaining imports**

```bash
grep -rn "CleoScriptGenerator\|CleoVoiceEngine" src app __tests__ | grep -v 'src/services/Cleo.*Engine\|src/services/CleoScript'
```

Expected: empty (other than the files themselves and their tests). Any remaining imports are almost certainly in deleted files not yet re-indexed; double-check.

- [ ] **Step 2: Delete**

```bash
git rm src/services/CleoScriptGenerator.ts src/services/CleoVoiceEngine.ts
git rm __tests__/services/CleoScriptGenerator.test.ts __tests__/services/CleoVoiceEngine.test.ts
```

- [ ] **Step 3: Build**

```bash
npx tsc --noEmit
npx jest
```

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete CleoScriptGenerator and CleoVoiceEngine (logic lifted to server)"
```

---

## Task 7: Delete cleo/ prompt library

**Files:**
- Delete: `src/cleo/static-core.ts`
- Delete: `src/cleo/fallbacks.ts`
- Delete: `src/cleo/cold-opens.ts`
- Delete: `__tests__/cleo/coldOpens.test.ts`
- Delete: `__tests__/cleo/fallbacks.test.ts`

**Context:** These files are the source of truth for ONAY's prompt style. The server-side `SegmentScriptBuilder` in Plan 1 copied the relevant parts. Before deleting, confirm the copied prompt text is equivalent or intentionally improved.

- [ ] **Step 1: Review server's SegmentScriptBuilder vs these files**

Open `server/src/services/broadcast/SegmentScriptBuilder.ts` alongside `src/cleo/static-core.ts`. Confirm:
- System prompt captures ONAY's voice (warmth, wit, seasoned-DJ authority, no stage directions, no AI meta-reference, curly quotes).
- Cold open angles map reasonably to the pool in `cold-opens.ts`.
- Fallback handling (pre-written segments) is not needed in pre-bake world — a bake failure skips the segment entirely (Plan 2 Task 9).

If anything important is missing from the server, port it over before deleting the client originals.

- [ ] **Step 2: Confirm no imports remain**

```bash
grep -rn "src/cleo/" src app __tests__ | grep -v '^src/cleo/\|^__tests__/cleo/'
```

Expected: empty. These were imported by `SegmentController`, `CleoScriptGenerator`, `CleoVoiceEngine`, and a few UI labels — all deleted in Tasks 5-6 or never referenced after Plan 3.

- [ ] **Step 3: Delete**

```bash
git rm -r src/cleo/ __tests__/cleo/
npx tsc --noEmit
npx jest
```

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete src/cleo/ prompt library (lifted to server SegmentScriptBuilder)"
```

---

## Task 8: Storage cleanup — remove dead keys + helpers

**Files:**
- Modify: `src/services/Storage.ts`
- Modify: `__tests__/services/Storage.test.ts`

**Design:** Remove stations + session-related storage helpers that no longer have any live caller. Keep `USER`, `CURRENT_BROADCAST`, `SESSION_MEMORY`, `PLAYLISTS_CACHE`, `ONAY_SUGGESTION`, `HOST_VOLUME_MIX`. Remove `STATIONS`, `RECENTLY_PLAYED` (only populated by dead code), `CURRENT_SESSION`, `SESSION_HISTORY`, `COLD_OPEN_HISTORY`.

Old MMKV values on existing devices are harmless — the new app simply stops reading them. They'll be garbage after the app is uninstalled or MMKV's store is cleared. No destructive migration needed.

- [ ] **Step 1: Grep for each key before removing**

For each key to remove, confirm only dead-code callers:
```bash
for k in STATIONS RECENTLY_PLAYED CURRENT_SESSION SESSION_HISTORY COLD_OPEN_HISTORY; do
  echo "=== $k ==="
  grep -rn "StorageKeys\.$k\|'$k'" src app __tests__
done
```

Each group should only reference deleted files or the `Storage.ts`/test definitions themselves. If any live caller pops up, handle it before deletion.

- [ ] **Step 2: Remove dead helpers from Storage.ts**

Open `src/services/Storage.ts`. Remove:
- `getStations`, `setStations`, `addStation`, `removeStation`
- `getRecentlyPlayed`, `addRecentlyPlayedTrack`, related types
- Any `Session*` helpers tied to the deleted `SessionEngine`
- `COLD_OPEN_HISTORY` key + helpers (was written by deleted `SegmentController`)

Remove the corresponding entries from the `StorageKeys` const.

Keep:
- `USER`, `CURRENT_BROADCAST`, `SESSION_MEMORY`, `PLAYLISTS_CACHE`, `ONAY_SUGGESTION`, `HOST_VOLUME_MIX`, `CLEO_VIDEO_CACHE` (if still used), `ENRICHMENT_CACHE` (if still used)

- [ ] **Step 3: Remove corresponding tests**

Open `__tests__/services/Storage.test.ts`. Remove `describe` / `it` blocks for the deleted helpers. Leave the rest.

- [ ] **Step 4: Run tests + typecheck**

```bash
npx jest services/Storage
npx tsc --noEmit
```

Expected: tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/Storage.ts __tests__/services/Storage.test.ts
git commit -m "chore: remove dead storage keys and helpers (stations, session history)"
```

---

## Task 9: Native module cleanup — delete eject transition APIs

**Files:**
- Modify: `modules/expo-music-kit/index.ts`
- Modify: `modules/expo-music-kit/src/ExpoMusicKitModule.ts` (type definitions if separate)
- Modify: `modules/expo-music-kit/ios/ExpoMusicKitModule.swift`
- Modify: `__mocks__/expo-music-kit.ts`

**Context:** `playEjectTransition`, `cancelEjectTransition`, and `onEjectTrackChanged` are no longer called by anything. Removing them simplifies the Swift code substantially — no more three-layer crossfade state machine.

This is the biggest single simplification in this plan. Save it for after everything else works, so if it breaks something unexpected, the blast radius is isolated.

- [ ] **Step 1: Confirm no JS caller**

```bash
grep -rn "playEjectTransition\|cancelEjectTransition\|onEjectTrackChanged\|addEjectTrackChangedListener" src app __tests__ modules
```

Expected: matches only inside the native module itself. Any other match means something is still calling it — fix first.

- [ ] **Step 2: Remove the TypeScript exports**

Open `modules/expo-music-kit/index.ts`. Delete:
- `playEjectTransition` function
- `cancelEjectTransition` function
- `addEjectTrackChangedListener` function
- `EjectTrackChangedEvent` type
- Any `onEjectTrackChanged` event name references

- [ ] **Step 3: Remove the Swift implementation**

Open `modules/expo-music-kit/ios/ExpoMusicKitModule.swift`. Find and delete:
- The `AsyncFunction("playEjectTransition")` block
- The `AsyncFunction("cancelEjectTransition")` block
- The `"onEjectTrackChanged"` event emission site (usually a `self.sendEvent("onEjectTrackChanged", ...)` call inside the track change observer)
- Any helper properties used exclusively by the eject crossfade: e.g., `ejectFadeOutPlayer`, `ejectIncomingPlayer`, `ejectCurrentPromise`, `ejectActive`, related timer refs
- Any `Events("onEjectTrackChanged")` declaration in the `Definition` block

Be careful: `onTrackChanged` and `onPlaybackStateChanged` must survive. Only `onEjectTrackChanged` goes.

If the module still references any of these after deletion, the Swift compiler will catch it during build. Rebuild and fix.

- [ ] **Step 4: Update the JS mock**

In `__mocks__/expo-music-kit.ts`, remove any `playEjectTransition`, `cancelEjectTransition`, `addEjectTrackChangedListener` stubs.

- [ ] **Step 5: Prebuild + iOS build**

```bash
npx expo prebuild --platform ios --clean
cd ios && pod install && cd ..
```

Build via Xcode (or `xcodebuild`). Expect it to succeed. If there's a Swift compile error, it's pointing at leftover references — remove them.

- [ ] **Step 6: Run tests**

```bash
npx jest
```

Expected: all tests pass. The mock's slimmer surface area is the only change.

- [ ] **Step 7: Device smoke test**

Launch on device. Play a broadcast through. Expect no behavior change — the new player never called these methods anyway, so removing them is purely a simplification.

- [ ] **Step 8: Commit**

```bash
git add modules/expo-music-kit/ __mocks__/expo-music-kit.ts ios/ android/
git commit -m "refactor(music-kit): remove eject transition APIs (unused in pre-baked model)"
```

---

## Task 10: Clean up unused dependencies

**Files:**
- Modify: `package.json`
- Modify: `server/package.json`

**Design:** Check for dependencies that were only used by deleted code. This isn't a hunt for every unused package — just the high-cost ones that noticeably affect bundle size or build time.

- [ ] **Step 1: Check each suspect dependency**

For each of these, grep for import usage:
```bash
for dep in "@google/genai" "react-native-track-player" "react-native-sound"; do
  echo "=== $dep ==="
  grep -rn "from '$dep'\|require('$dep')" src app __tests__ modules || echo "unused"
done
```

Remove any that show "unused". Do NOT remove `react-native-mmkv`, `expo-asset`, `expo-file-system` — all in active use.

- [ ] **Step 2: Remove + reinstall lockfile**

```bash
npm uninstall <each unused dep>
```

- [ ] **Step 3: Check server**

```bash
cd server
for dep in "@google/genai" "axios"; do
  echo "=== $dep ==="
  grep -rn "from '$dep'\|require('$dep')" src || echo "unused"
done
```

Only remove `@google/genai` if the Gemini provider is no longer instantiating via that package (confirm it uses the raw REST API instead — most don't). If unsure, leave it.

- [ ] **Step 4: Rebuild + test**

```bash
npx expo prebuild --platform ios --clean
cd ios && pod install && cd ..
npx tsc --noEmit
npx jest
cd server && npx jest && cd ..
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json server/package.json server/package-lock.json
git commit -m "chore: drop dependencies that were only used by deleted code"
```

---

## Task 11: Final device validation + tag

- [ ] **Step 1: Full broadcast flow test**

Physical iPhone, logged into real Apple Music account:

1. Open app. `HomeBroadcastScreen` renders with featured + your-broadcast.
2. Tap a featured broadcast. Tuning-in overlay. Broadcast starts.
3. Play through at least 2 track transitions. Confirm ONAY speaks, music ducks, transitions happen.
4. Lock the phone. Audio keeps playing backgrounded. Confirm no `RESOURCE_NOTIFY` / background CPU crash during a full 30-minute broadcast.
5. Unlock partway through. UI state intact.
6. Broadcast plays through to sign-off. State returns to home.
7. Kill app mid-session. Relaunch. "Resume broadcast?" alert. Tap Resume. Broadcast continues.
8. Home → "START YOUR BROADCAST" → pick playlist → vibe → length → START. User-sourced broadcast plays end-to-end.

Any failure here = don't tag. Bisect back to `pre-plan-4-baseline` and find what broke.

- [ ] **Step 2: Background CPU sanity check**

In Xcode, run Instruments → Activity Monitor while the app is backgrounded playing a broadcast. Compare CPU usage to the baseline from the current architecture. Expected: dramatically lower (no LLM / TTS bursts), stable around MusicKit's intrinsic cost.

- [ ] **Step 3: Tag**

```bash
git tag -a plan-4-cleanup-complete -m "Plan 4 complete: old live-generation code deleted; pre-baked broadcast is the only path"
git tag -a pre-baked-broadcast-v1 -m "Milestone: pre-baked broadcast architecture fully shipped"
```

- [ ] **Step 4: Bump buildNumber + ship to TestFlight**

Follow the existing TestFlight flow from CLAUDE.md: bump `buildNumber` in `app.json`, then:
```bash
SENTRY_DISABLE_AUTO_UPLOAD=true xcodebuild archive ...
xcodebuild -exportArchive ...
```

- [ ] **Step 5: Final commit**

```bash
git add app.json
git commit -m "chore: bump build number for pre-baked broadcast v1 TestFlight"
```

---

## Self-review

**Spec coverage — "Delete entirely" list:**
- ✅ `TransitionPreloader` — Task 5
- ✅ `SegmentController` — Task 5
- ✅ `QueuePlanner` (client-side) — Task 5
- ✅ `QueueManager.upgradeQueueInBackground` — Task 5 (entire QueueManager deleted)
- ✅ Client-side eject timing, `onEjectTrackChanged`, fallback logic, `generationId` dance — Task 9
- ✅ Mid-song drop scheduling — Task 5 (AudioCoordinator deletion)
- ✅ `post_song` delivery mode — Task 5 (AudioCoordinator deletion)

**Spec coverage — "Rewrite client-side" list:**
- ✅ `HomeScreenRedesign` → `HomeBroadcastScreen` — Plan 3, promoted in Task 2
- ✅ `BroadcastScreen` → `broadcast-player.tsx` → `player.tsx` — Task 2, 4
- ✅ `SessionEngine` → `BroadcastPlayer` — Plan 2, old one deleted in Task 5
- ✅ `AudioCoordinator` collapsed into `BroadcastPlayer` — Task 5
- ⚠️  `SessionArcScreen` reframe (show full manifest upfront) — not covered by any plan. Either repurpose as a simple "session remaining" view on top of `BroadcastPlayer.getStatus()` or delete outright. Either is a small follow-up — flag as a post-ship polish item.

**No placeholders:** every task has concrete file paths and grep commands to verify safety. Deletion order is explicit.

**Type consistency:** N/A — this plan doesn't introduce new types.

**Scope:** pure deletion pass with one rename. Produces a clean codebase as working software at the end, with a TestFlight build.

**Risk callouts:**
- Task 9 (native module deletion) is the highest-risk single step. Always do it in its own commit so it's bisectable.
- Task 8 (storage cleanup) touches a file that other code relies on for unrelated reasons. The grep-before-delete pattern is mandatory.
- If any step surfaces an unexpected dependency on deleted code, stop and investigate rather than stubbing it out.
