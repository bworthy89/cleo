# UI Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the P0 findings from the 2026-04-24 UI + UX review so `ui-review` branch can merge, followed by high-value P1 polish.

**Architecture:** Each finding maps to a small focused commit. Phase 1 covers ship-blockers (fake hardcoded copy, destructive actions without confirmation, banned section-header pattern, Anton cap-clipping, missing backdrop, opaque playlist validation). Phase 2 covers high-impact polish (bespoke section headers that bypass `SectionMarker`, vestigial `AmberCTA`, fake-tappable transport buttons, invisible volume dial, no-cancel tuning overlay, destructive `START FRESH` without confirm, Ask ONAY subscription guard). No new abstractions — every fix is a local edit against existing tokens + components.

**Tech Stack:** React Native 0.83, Expo SDK 55, TypeScript strict. Design tokens in `src/tokens/design-tokens.ts` (`AM`, `Fonts`, `TypeScale`, `Space`, `withAlpha`). Shared chrome components in `src/components/crate/` (`SectionMarker`, `StampButton`, `Tick`, `Halftone`, `VUMeter`, `CatalogRow`, `LinerNotes`, `SpinningRecord`, `StatusStrip`, `SettingsCog`, `SleeveArt`). No client-side Jest harness — verification is manual on iOS simulator.

**Branch:** Work on `ui-review` (already pushed to origin). One commit per task. Squash-or-merge at PR time.

**Verification baseline:** Before starting, run `npx expo start` from repo root, launch iOS simulator, sign in, complete onboarding, and confirm the home + player + setup sheet + onboarding + login render cleanly. Take screenshots of each as a before-reference.

---

## Phase 1 — P0 ship-blockers

### Task 1: Remove hardcoded "Philly Groove" fake liner note

**Why:** `app/(main)/(broadcast)/player.tsx:247-253` renders `"Coming up — a Philly Groove single from 1970, and it still hits."` on every broadcast, every track, regardless of what's actually playing. Directly contradicts the "picked, not generated" pitch. The block exists as design placeholder. Remove it until real segment-preview data is wired from `manifest.segmentSlots[i]` (separate feature).

**Files:**
- Modify: `app/(main)/(broadcast)/player.tsx:245-253`

- [ ] **Step 1: Read current state**

Run: `grep -n "Philly Groove" app/\(main\)/\(broadcast\)/player.tsx`
Expected: one match near line 250.

- [ ] **Step 2: Delete the hardcoded liner block**

Locate the block roughly matching this shape (line numbers drift — match by content):

```tsx
<Text style={styles.linerHeader}>BETWEEN TRACKS</Text>
<Text style={styles.linerBody}>
  Coming up — a Philly Groove single from 1970, and it still hits.
</Text>
```

Delete both elements and any wrapping `<View>` whose sole purpose is to hold them. If `linerHeader` / `linerBody` / `linerBlock` styles become unused after deletion, remove them from the `StyleSheet.create` call at the bottom of the file.

- [ ] **Step 3: Also remove the static "NO SKIPS · SIT WITH IT" duplicate if present twice**

Check: the player currently shows `NO SKIPS · SIT WITH IT` once below the transport row (keep this one). If the liner block also contained that phrase, ensure it's only rendered once.

Run: `grep -n "NO SKIPS" app/\(main\)/\(broadcast\)/player.tsx`
Expected: one match.

- [ ] **Step 4: Verify on simulator**

Start metro if not running: `cd /Users/kari/Documents/cleo-app && npx expo start`
In simulator: launch app → pick a featured broadcast → enter player.
Expected: no "Philly Groove" text anywhere; layout flows cleanly without empty gap where the liner used to be.

- [ ] **Step 5: Commit**

```bash
git add app/\(main\)/\(broadcast\)/player.tsx
git commit -m "fix(player): remove hardcoded 'Philly Groove' liner note placeholder

Shipped every broadcast regardless of content — contradicts
'picked, not generated' editorial stance. Real segment-preview
data wiring is a separate feature.
"
```

---

### Task 2: Confirm dialog + 44×44 target on END BROADCAST

**Why:** `app/(main)/(broadcast)/player.tsx:112-142` — END BROADCAST is a one-tap destructive action with ~40×32 hit area (hitSlop: 12). Clears MMKV cursor via `broadcastPlayer.end()` and pops the route. An errant pocket-tap destroys a half-played 30-min broadcast with no undo. Fix: wrap in `Alert.alert` confirm with destructive-styled button, expand hit target to ≥44×44.

**Files:**
- Modify: `app/(main)/(broadcast)/player.tsx` (onEnd handler + Pressable hitSlop)

- [ ] **Step 1: Read the current onEnd + Pressable markup**

Run: `grep -n "END BROADCAST\|onEnd\|hitSlop" app/\(main\)/\(broadcast\)/player.tsx | head -20`
Expected: matches around lines 112-142.

- [ ] **Step 2: Ensure `Alert` is imported**

At the top of `player.tsx`, `Alert` must be in the `react-native` import. If not present, add it:

```tsx
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
```

- [ ] **Step 3: Wrap the end handler in a confirm dialog**

Replace the existing `onEnd` handler (the function currently calling `Haptics.impactAsync` + `broadcastPlayer.end()` + `router.back()`) with:

```tsx
const onEnd = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  Alert.alert(
    "End tonight's broadcast?",
    "You won't be able to pick it up where you left off.",
    [
      { text: 'Keep listening', style: 'cancel' },
      {
        text: 'End broadcast',
        style: 'destructive',
        onPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          broadcastPlayer.end();
          router.back();
        },
      },
    ],
  );
};
```

- [ ] **Step 4: Bump the Pressable hit target to ≥44×44**

Locate the `END BROADCAST` Pressable (the one using `onEnd`). On that Pressable, change `hitSlop={12}` (or similar) to:

```tsx
hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
```

And in the style array passed to `style=`, ensure `minHeight: 44` is set. If the surrounding style object has `paddingVertical` < 12, raise to 12.

- [ ] **Step 5: Verify on simulator**

Launch → enter a broadcast → tap END BROADCAST.
Expected: iOS native Alert appears with "End tonight's broadcast?" + Cancel + red "End broadcast" button. Cancel returns to player, End exits and wipes cursor.

- [ ] **Step 6: Commit**

```bash
git add app/\(main\)/\(broadcast\)/player.tsx
git commit -m "fix(player): confirm before ending broadcast, 44x44 hit target

One-tap destructive action with ~40x32 target was too easy to
trigger from a pocket. Wraps in Alert.alert with destructive
styling; expands hitSlop + minHeight to iOS 44pt guidance.
"
```

---

### Task 3: Pre-bake playlist validation — annotate rows with track count, disable <5

**Why:** `src/screens/home/HomeBroadcastScreen.tsx:285-308` throws a generic `Error` for playlists with <5 playable tracks, caught and surfaced as `Alert.alert('Broadcast unavailable', ...)` *after* the Tuning In overlay has shown. User lands back on Home with no context about which playlist failed. Validation should happen in the SetupSheet at row selection time.

**Files:**
- Modify: `src/components/broadcast/SetupSheet.tsx` (playlist row rendering + selection handler)
- Modify: `src/engines/BroadcastManifestClient.ts` (expose `countPlayable` helper if not already)
- Modify: `src/screens/home/HomeBroadcastScreen.tsx` (keep Alert as fallback, but reframe)

- [ ] **Step 1: Check current exports in BroadcastManifestClient**

Run: `grep -n "sanitize\|countPlayable\|playable" src/engines/BroadcastManifestClient.ts`
Expected: `sanitizeTracksForBake` is exported. We need a `countPlayableTracks` helper that uses the same rules without sanitizing.

- [ ] **Step 2: Add `countPlayableTracks` helper**

If `countPlayableTracks` does not already exist in `BroadcastManifestClient.ts`, add it alongside `sanitizeTracksForBake`. Mirror the same drop rules (0-duration, empty title, bad URL):

```ts
/**
 * Count how many tracks pass sanitizeTracksForBake's drop rules,
 * without doing the full clamp pass. Cheap — callable per row.
 */
export function countPlayableTracks(tracks: readonly AppleMusicTrack[]): number {
  return tracks.filter(isPlayableTrack).length;
}
```

Where `isPlayableTrack` is the same predicate `sanitizeTracksForBake` uses internally. If that predicate is inlined in `sanitizeTracksForBake`, extract it to a module-private function and reuse from both.

- [ ] **Step 3: Plumb track count into SetupSheet playlist row**

In `SetupSheet.tsx`, the playlist list receives an array of `Playlist` objects. These carry `tracks` (or a count). Locate the rendering code for each playlist row (around the area currently printing `playlistName`).

Add a mono sub-label under each row. If count < 5, use oxblood; otherwise use `AM.inkDim`:

```tsx
const playable = countPlayableTracks(p.tracks);
const tooFew = playable < 5;

<Pressable
  onPress={() => {
    if (tooFew) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    onPick(p.id);
  }}
  disabled={tooFew}
  accessibilityLabel={`${p.name}. ${playable} playable tracks.${tooFew ? ' Not enough to start a broadcast.' : ''}`}
  style={({ pressed }) => [
    styles.playlistRow,
    tooFew && styles.playlistRowDisabled,
    pressed && !tooFew && { opacity: 0.8 },
  ]}
>
  <Text style={styles.playlistName}>{p.name}</Text>
  <Text style={[styles.playlistMeta, tooFew && { color: AM.oxblood }]}>
    {playable} PLAYABLE · {tooFew ? 'NEED 5+' : `${p.tracks.length} TOTAL`}
  </Text>
</Pressable>
```

And add to the stylesheet:

```ts
playlistRowDisabled: { opacity: 0.5 },
playlistMeta: {
  marginTop: 4,
  fontFamily: Fonts.mono,
  fontSize: TypeScale.s10,
  letterSpacing: 2,
  color: AM.inkDim,
},
```

Import `countPlayableTracks` + `AM` + `Fonts` + `TypeScale` at the top if not already.

- [ ] **Step 4: Reframe the late Alert as a safety net**

In `HomeBroadcastScreen.tsx`, the catch block around lines 285-308 currently shows a generic alert. Change the error message for the <5 tracks case specifically so that if it *does* slip through (e.g., playlist edited between selection and BEGIN tap), the copy is helpful:

```tsx
if (err instanceof Error && /playable tracks/i.test(err.message)) {
  Alert.alert(
    'Playlist changed',
    'This playlist no longer has enough playable tracks. Pick another.',
    [{ text: 'OK', onPress: () => openSetupSheet() }],
  );
  return;
}
// …existing fallback handling
```

Where `openSetupSheet()` is the existing function that re-opens the sheet at step 0. If it takes no args, call it as-is.

- [ ] **Step 5: Verify on simulator**

Launch → open setup sheet → scroll playlists.
Expected: every row shows "N PLAYABLE · M TOTAL" mono label under the name. Any row with <5 playable is dimmed, tapping triggers warning haptic but doesn't advance.

Pick a valid playlist, complete setup, tap BEGIN. Expected: bakes normally.

- [ ] **Step 6: Commit**

```bash
git add src/components/broadcast/SetupSheet.tsx src/engines/BroadcastManifestClient.ts src/screens/home/HomeBroadcastScreen.tsx
git commit -m "fix(setup): surface <5 playable tracks at playlist-row selection

Previously threw mid-bake and surfaced as a generic Alert after
Tuning In was already visible. Now every row shows its playable
count; rows below threshold are disabled with an oxblood warning
sub-label. Late Alert retained as safety net for live playlist edits.
"
```

---

### Task 4: PublishFeaturedSheet — replace banned amber-label + 2×40 bar header

**Why:** `src/components/broadcast/PublishFeaturedSheet.tsx:317-318, 364-365` uses the old Sonic Ether "small-caps amber label + 40×2 amber bar underneath" pattern that Crate Digger explicitly replaced with `SectionMarker`. CLAUDE.md now calls this out. Also uses raw `backgroundColor: '#111'` at `:375`.

**Files:**
- Modify: `src/components/broadcast/PublishFeaturedSheet.tsx`

- [ ] **Step 1: Verify the pattern**

Run: `grep -n "headerLabel\|headerRule\|'#111'" src/components/broadcast/PublishFeaturedSheet.tsx`
Expected: 3+ matches.

- [ ] **Step 2: Import SectionMarker**

At the top of the file, add:

```tsx
import { SectionMarker } from '../crate';
```

(The `crate/index.ts` barrel already re-exports it.)

- [ ] **Step 3: Replace the header JSX**

Find the JSX currently rendering `<Text style={styles.headerLabel}>PUBLISH</Text>` followed by `<View style={styles.headerRule} />` (or similar). Replace both with:

```tsx
<SectionMarker num="P·01" title="PUBLISH" side="AS TONIGHT ON ONAY" />
```

- [ ] **Step 4: Replace the raw '#111' background**

Find `backgroundColor: '#111'` (around line 375). Replace with `backgroundColor: AM.bgDeep`.

Ensure `AM` is imported at the top:

```tsx
import { AM, Fonts, TypeScale, Space } from '../../tokens/design-tokens';
```

- [ ] **Step 5: Remove unused styles**

After the swap, delete `headerLabel` and `headerRule` from the `StyleSheet.create(...)` block. Run `grep` to confirm no other references:

```bash
grep -n "headerLabel\|headerRule" src/components/broadcast/PublishFeaturedSheet.tsx
```

Expected: no matches.

- [ ] **Step 6: Verify on simulator**

Launch as a curator account (email in `src/config/curators.ts`) → open Ask ONAY → publish a broadcast → PublishFeaturedSheet opens.
Expected: header now matches Home section style (numbered catalog + hairline rule + right-side mono label); no amber bar.

- [ ] **Step 7: Commit**

```bash
git add src/components/broadcast/PublishFeaturedSheet.tsx
git commit -m "fix(publish): replace banned amber-bar header with SectionMarker

PublishFeaturedSheet was the only remaining surface still using
the pre-Crate-Digger 'small-caps amber label + 40x2 bar' pattern.
Also swaps raw '#111' scrim for AM.bgDeep.
"
```

---

### Task 5: Anton lineHeight sweep — add 1.2× lineHeight to all Anton Text styles

**Why:** Anton's cap-height clips tight line-boxes on iOS. CLAUDE.md rule: `lineHeight ≈ 1.2× fontSize`. Violators render with top-clipped descenders/accents, especially on ≥ 20pt sizes. 11 known sites.

**Files (all modify):**
- `app/(auth)/login.tsx`
- `app/(onboarding)/music-auth.tsx`
- `src/components/TabBar.tsx`
- `src/components/AmberCTA.tsx`
- `src/components/NowPlayingBar.tsx`
- `src/components/broadcast/SlotPlaceholderCard.tsx`
- `src/components/broadcast/TuningInOverlay.tsx`
- `src/components/broadcast/SetupSheet.tsx`
- `src/components/broadcast/SettingsDrawer.tsx`
- `src/components/broadcast/PublishFeaturedSheet.tsx`

**Sweep rule:** for every `Text` style whose `fontFamily === Fonts.display`, ensure `lineHeight` is set to roughly `Math.round(fontSize * 1.2)`. Do not change fontSize. If an existing `lineHeight` is present but < fontSize, correct it to 1.2×.

- [ ] **Step 1: Fix login wordmark**

`app/(auth)/login.tsx` — `wordmark` style (Anton 56):
Change `lineHeight: 56 * 0.9` (~50) to `lineHeight: 67`.

- [ ] **Step 2: Fix music-auth headline**

`app/(onboarding)/music-auth.tsx` — `headline` style (Anton 42):
Change `lineHeight: 42 * 0.95` (~40) to `lineHeight: 50`.

- [ ] **Step 3: Fix TabBar label**

`src/components/TabBar.tsx` — `label` style (Anton 13): add `lineHeight: 16`.

- [ ] **Step 4: Fix AmberCTA label**

`src/components/AmberCTA.tsx` — `label` style (Anton `TypeScale.s18`): add `lineHeight: 22`.

- [ ] **Step 5: Fix NowPlayingBar title**

`src/components/NowPlayingBar.tsx` — `title` style (Anton `TypeScale.s15`): add `lineHeight: 18`.

- [ ] **Step 6: Fix SlotPlaceholderCard title**

`src/components/broadcast/SlotPlaceholderCard.tsx` — `title` style (Anton `TypeScale.s22`): add `lineHeight: 26`.

- [ ] **Step 7: Fix TuningInOverlay headline**

`src/components/broadcast/TuningInOverlay.tsx` — `headline` style (Anton `TypeScale.s22`): add `lineHeight: 26`.

- [ ] **Step 8: Fix SetupSheet playlistName + vibeLabel**

`src/components/broadcast/SetupSheet.tsx`:
- `playlistName` (Anton `TypeScale.s16`): add `lineHeight: 20`.
- `vibeLabel` (Anton `TypeScale.s18`): add `lineHeight: 22`.

- [ ] **Step 9: Fix SettingsDrawer rowValue + signOutLabel**

`src/components/broadcast/SettingsDrawer.tsx`:
- `rowValue` (Anton `TypeScale.s14`): add `lineHeight: 17`.
- `signOutLabel` (Anton `TypeScale.s15`): add `lineHeight: 18`.

- [ ] **Step 10: Fix PublishFeaturedSheet closeGlyph + tileTitle**

`src/components/broadcast/PublishFeaturedSheet.tsx`:
- `closeGlyph` (s26): add `lineHeight: 31`.
- `tileTitle` (Anton `TypeScale.s22`): add `lineHeight: 26`.

- [ ] **Step 11: Verify on simulator**

Launch → onboarding flow → home → setup sheet (try picking each playlist) → publish sheet (curator) → settings drawer → player (Now Playing bar).
Expected: no top-clipped cap-heights on any Anton title across all these surfaces.

- [ ] **Step 12: Commit**

```bash
git add app/\(auth\)/login.tsx app/\(onboarding\)/music-auth.tsx src/components/TabBar.tsx src/components/AmberCTA.tsx src/components/NowPlayingBar.tsx src/components/broadcast/SlotPlaceholderCard.tsx src/components/broadcast/TuningInOverlay.tsx src/components/broadcast/SetupSheet.tsx src/components/broadcast/SettingsDrawer.tsx src/components/broadcast/PublishFeaturedSheet.tsx
git commit -m "fix(ui): Anton lineHeight sweep — 1.2x rule across 11 sites

Anton's cap-height clips tight line-boxes on iOS. Every Anton
Text style now has lineHeight ~= 1.2x fontSize. Covers login
wordmark, music-auth headline, TabBar label, AmberCTA,
NowPlayingBar, SlotPlaceholderCard, TuningInOverlay, SetupSheet,
SettingsDrawer, PublishFeaturedSheet.
"
```

---

### Task 6: Wrap login in BroadcastBackdrop

**Why:** `app/(auth)/login.tsx:98-100, 360` paints a solid `AM.bg` SafeAreaView, covering the grain + amber bloom backdrop that every other primary screen uses. Login feels like a different app.

**Files:**
- Modify: `app/(auth)/login.tsx`

- [ ] **Step 1: Verify import**

Run: `grep -n "BroadcastBackdrop" app/\(auth\)/login.tsx`
Expected: no match (confirming it's missing).

Run: `grep -n "BroadcastBackdrop" src/components/BroadcastBackdrop.tsx`
Expected: exports `BroadcastBackdrop`.

- [ ] **Step 2: Add import**

At the top of `login.tsx`, add:

```tsx
import { BroadcastBackdrop } from '../../src/components/BroadcastBackdrop';
```

(Adjust relative path based on actual file location under `app/(auth)/`.)

- [ ] **Step 3: Wrap the root view**

Find the outermost `SafeAreaView` or `View` that sets `{ backgroundColor: AM.bg, flex: 1 }`. Change its container style to `{ flex: 1 }` (remove the background) and wrap its children in `<BroadcastBackdrop>`:

```tsx
return (
  <BroadcastBackdrop>
    <SafeAreaView style={styles.container /* now { flex: 1 } with no bg */}>
      <KeyboardAvoidingView ...>
        {/* ...existing content */}
      </KeyboardAvoidingView>
    </SafeAreaView>
  </BroadcastBackdrop>
);
```

Update `styles.container`: remove the `backgroundColor: AM.bg` line.

- [ ] **Step 4: Replace the raw scrim rgba**

Locate line ~571: `'rgba(5, 4, 3, 0.94)'`. Replace with:

```tsx
backgroundColor: withAlpha(AM.bgDeep, 0.94),
```

Ensure `withAlpha` is imported from `'../../src/tokens/design-tokens'` (adjust path).

- [ ] **Step 5: Verify on simulator**

Launch to the login screen (sign out first if needed).
Expected: warm-black background shows faint grain texture + amber bloom radiating from the top. Matches Home/Profile backdrop. Auth overlay (the "CHECKING YOUR MEMBERSHIP" spinner) reads as a bgDeep scrim.

- [ ] **Step 6: Commit**

```bash
git add app/\(auth\)/login.tsx
git commit -m "fix(login): restore BroadcastBackdrop so grain + bloom render

Login painted a solid AM.bg SafeAreaView, hiding the grain +
amber-bloom chrome every other screen uses. Now wraps in
BroadcastBackdrop. Also replaces raw 'rgba(5,4,3,0.94)' scrim
with withAlpha(AM.bgDeep, 0.94).
"
```

---

## Phase 2 — P1 high-impact polish

### Task 7: Home `MORE FROM ONAY` — replace with SectionMarker

**Why:** `src/screens/home/HomeBroadcastScreen.tsx:461-462, 701-708` uses a bespoke amber-mono label instead of `SectionMarker`. Mid-scroll the user sees three numbered catalog sections, then a tiny amber caption — reads as a bug.

**Files:**
- Modify: `src/screens/home/HomeBroadcastScreen.tsx`

- [ ] **Step 1: Locate the bespoke label**

Run: `grep -n "moreLabel\|MORE FROM ONAY" src/screens/home/HomeBroadcastScreen.tsx`

- [ ] **Step 2: Replace with SectionMarker**

Change the `<Text style={styles.moreLabel}>MORE FROM ONAY</Text>` JSX to:

```tsx
<SectionMarker num="B·04" title="MORE FROM ONAY" side="ARCHIVE" />
```

(Pick a catalog number that fits the existing Home section numbering sequence — inspect `grep -n "SectionMarker" src/screens/home/HomeBroadcastScreen.tsx` to see what's already in use; use the next in sequence.)

Ensure `SectionMarker` is imported from `'../../components/crate'`.

- [ ] **Step 3: Remove unused styles**

Delete `moreLabel` and (if unused) `featuredEmpty*` styles from the StyleSheet.

Run: `grep -n "moreLabel\|featuredEmpty" src/screens/home/HomeBroadcastScreen.tsx`
Expected: no matches.

- [ ] **Step 4: Verify on simulator**

Launch → Home → scroll to `MORE FROM ONAY`.
Expected: section header matches the others (numbered, hairline, side label).

- [ ] **Step 5: Commit**

```bash
git add src/screens/home/HomeBroadcastScreen.tsx
git commit -m "fix(home): use SectionMarker for MORE FROM ONAY section

Was a bespoke amber-mono caption while every other home section
uses SectionMarker — read as a bug mid-scroll.
"
```

---

### Task 8: Player `BETWEEN TRACKS` — replace with SectionMarker or remove

**Why:** `app/(main)/(broadcast)/player.tsx:249, 523-529` renders a bespoke oxblood mono label. After Task 1 removed the fake liner, this header may already be gone. If still present, decide: keep as intentional inline kicker (document in component comment) OR lift to `SectionMarker`. Prefer removal if the body below it is also gone.

**Files:**
- Modify: `app/(main)/(broadcast)/player.tsx`

- [ ] **Step 1: Check what's left after Task 1**

Run: `grep -n "BETWEEN TRACKS\|linerHeader" app/\(main\)/\(broadcast\)/player.tsx`

- [ ] **Step 2a: If no match remains → skip to Task 9**

Nothing to do. Go to Task 9.

- [ ] **Step 2b: If match remains → replace with SectionMarker or delete**

If the BETWEEN TRACKS header still has meaningful content below it post-Task-1, lift to `SectionMarker`:

```tsx
<SectionMarker num="A·02" title="BETWEEN TRACKS" side="LINER NOTES" />
```

If the header is orphaned (no body content after Task 1), delete it. Also remove `linerHeader` style.

- [ ] **Step 3: Verify on simulator**

Launch → enter player.
Expected: either no BETWEEN TRACKS header, or one rendered as a proper SectionMarker.

- [ ] **Step 4: Commit (only if changes made)**

```bash
git add app/\(main\)/\(broadcast\)/player.tsx
git commit -m "fix(player): SectionMarker for BETWEEN TRACKS header

Was a bespoke oxblood mono label — brought in line with Home/Profile
section pattern."
```

---

### Task 9: Migrate `AmberCTA` usage to `StampButton` + delete `AmberCTA`

**Why:** `AmberCTA` is a vestigial 2nd primary-CTA shape (lone amber border with pulsing glow, no corner Ticks) competing with `StampButton` (4-corner Tick outline). The only live usage is in `SetupSheet.tsx:367` for "Begin broadcast" — the final CTA of the whole setup flow. It ends up visually lower-status than the Home screen's `StampButton` "BEGIN BROADCAST".

**Files:**
- Modify: `src/components/broadcast/SetupSheet.tsx` (swap usage)
- Delete: `src/components/AmberCTA.tsx` (after confirming no other usage)

- [ ] **Step 1: Find all AmberCTA usage**

Run: `grep -rn "AmberCTA" src/ app/`
Expected: import in `SetupSheet.tsx` + possibly a re-export.

- [ ] **Step 2: Replace in SetupSheet**

Change the `<AmberCTA label="Begin broadcast" onPress={...} />` invocation to:

```tsx
<StampButton
  label="BEGIN BROADCAST"
  sub="NO SKIPS · SIT WITH IT"
  kind="amber"
  onPress={handleBegin}
  accessibilityLabel="Begin broadcast"
/>
```

Adjust prop names to match what `StampButton` expects (see `src/components/crate/StampButton.tsx`). Replace the `AmberCTA` import with `import { StampButton } from '../crate';`.

- [ ] **Step 3: Confirm no other usage**

Run: `grep -rn "AmberCTA" src/ app/`
Expected: no matches after step 2 removes the SetupSheet import.

- [ ] **Step 4: Delete the component**

```bash
rm src/components/AmberCTA.tsx
```

- [ ] **Step 5: Verify on simulator**

Launch → open setup sheet → walk through to step 3 (length) → BEGIN BROADCAST button appears at bottom.
Expected: matches the stamp-style button used on Home (corner ticks, Anton label, mono sub-label, arrow).

- [ ] **Step 6: Commit**

```bash
git add src/components/broadcast/SetupSheet.tsx src/components/AmberCTA.tsx
git commit -m "refactor(ui): migrate AmberCTA to StampButton, delete AmberCTA

AmberCTA was a vestigial 2nd primary-CTA shape competing with
StampButton on the final SetupSheet step. Single CTA language
across the app now.
"
```

---

### Task 10: Remove fake-tappable transport prev/next buttons

**Why:** `app/(main)/(broadcast)/player.tsx:214-243` renders two 44×44 bordered frames with `accessibilityState={{ disabled: true }}` — but sighted users can't tell they're disabled. Users will tap. Nothing happens. The `NO SKIPS · SIT WITH IT` line (line 245) already communicates the philosophy. Remove the fake buttons.

**Files:**
- Modify: `app/(main)/(broadcast)/player.tsx`

- [ ] **Step 1: Locate the transport row**

Run: `grep -n "disabled: true\|accessibilityState" app/\(main\)/\(broadcast\)/player.tsx`
Expected: matches around lines 214-243.

- [ ] **Step 2: Delete the two non-interactive Views**

Remove both `<View>` blocks that wrap the `‖` and `⟶|` glyphs. Keep only the center play/pause Pressable.

If the removal breaks the flexRow layout (e.g., the play button was centered via 3-column spacing), recenter with `justifyContent: 'center'` on the row container.

- [ ] **Step 3: Remove unused styles**

Delete styles specific to the side buttons (e.g., `prevBtn`, `nextBtn`, `sideBtnText`) from the StyleSheet.

- [ ] **Step 4: Verify on simulator**

Launch → enter player.
Expected: single centered play/pause control. `NO SKIPS · SIT WITH IT` still below it. No fake-disabled prev/next.

- [ ] **Step 5: Commit**

```bash
git add app/\(main\)/\(broadcast\)/player.tsx
git commit -m "fix(player): remove fake-tappable prev/next transport buttons

Two 44x44 bordered frames rendered as 'disabled' views but looked
identical to the active play button. Users tapped and nothing
happened. The 'NO SKIPS · SIT WITH IT' line already carries the
philosophy — the fake buttons were worst-of-both-worlds.
"
```

---

### Task 11: VolumeDial — add visible drag-handle thumb

**Why:** `app/(main)/(broadcast)/player.tsx:264-279` — the 24-bar amber dial has a transparent Slider overlay with no visible thumb. Users can't tell it's a control. First-time users see a status readout.

**Files:**
- Modify: `app/(main)/(broadcast)/player.tsx` (VolumeDial + sliderOverlay styles)

- [ ] **Step 1: Locate VolumeDial + sliderOverlay**

Run: `grep -n "VolumeDial\|sliderOverlay\|thumbTintColor\|activeCount" app/\(main\)/\(broadcast\)/player.tsx`

- [ ] **Step 2: Add a visible thumb indicator**

The Slider (`@react-native-community/slider`) supports `thumbTintColor`. Change the `sliderOverlay` props:

```tsx
<Slider
  style={styles.sliderOverlay}
  value={hostVolume}
  onValueChange={onVolumeChange}
  minimumValue={0}
  maximumValue={1}
  step={1 / 24}
  minimumTrackTintColor="transparent"
  maximumTrackTintColor="transparent"
  thumbTintColor={AM.amber}
  accessibilityRole="adjustable"
  accessibilityLabel="Host voice volume"
/>
```

Remove `opacity: 0` from `sliderOverlay` styles so the thumb is visible. Keep track transparency so only the thumb shows against the custom bar visual.

- [ ] **Step 3: Add an inline helper caption under the dial**

Directly below the VolumeDial + sliderOverlay, add:

```tsx
<Text style={styles.volumeHint}>DRAG TO ADJUST</Text>
```

Style:

```ts
volumeHint: {
  marginTop: Space.s4,
  alignSelf: 'center',
  fontFamily: Fonts.mono,
  fontSize: TypeScale.s9,
  letterSpacing: 2,
  color: AM.inkDim,
},
```

- [ ] **Step 4: Verify on simulator**

Launch → enter player → observe volume dial.
Expected: amber thumb visible at the current-volume position on the bar; "DRAG TO ADJUST" mono caption visible. Dragging updates the bar count.

- [ ] **Step 5: Commit**

```bash
git add app/\(main\)/\(broadcast\)/player.tsx
git commit -m "fix(player): give VolumeDial a visible thumb + drag hint

Transparent Slider overlay had no thumb — users couldn't tell
it was a control. Amber thumb + 'DRAG TO ADJUST' caption now
make the affordance visible.
"
```

---

### Task 12: TuningInOverlay — cancel button + soft-timeout reassurance

**Why:** `src/components/broadcast/TuningInOverlay.tsx` is full-bleed modal with no escape during the 11-40s bake. Users with slow networks have no feedback that work is progressing vs. hung.

**Files:**
- Modify: `src/components/broadcast/TuningInOverlay.tsx` (add cancel prop + extended reassurance)
- Modify: `src/screens/home/HomeBroadcastScreen.tsx` (wire cancel handler)

- [ ] **Step 1: Add cancel prop to TuningInOverlay**

In `TuningInOverlay.tsx`, add `onCancel?: () => void` to the Props interface. If defined, render a dim "TAKE IT BACK" pressable at the bottom of the overlay:

```tsx
{onCancel && (
  <Pressable
    onPress={onCancel}
    accessibilityRole="button"
    accessibilityLabel="Cancel tuning in"
    style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.6 }]}
    hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
  >
    <Text style={styles.cancelLabel}>TAKE IT BACK</Text>
  </Pressable>
)}
```

Styles:

```ts
cancel: {
  marginTop: Space.s30,
  alignSelf: 'center',
  paddingVertical: Space.s10,
  paddingHorizontal: Space.s20,
},
cancelLabel: {
  fontFamily: Fonts.mono,
  fontSize: TypeScale.s10,
  letterSpacing: 3,
  color: AM.inkDim,
},
```

- [ ] **Step 2: Add a soft-timeout reassurance line after 20s**

Inside `TuningInOverlay.tsx`, track elapsed seconds with a `useState` + `setInterval` (cleaned up on unmount):

```tsx
const [elapsed, setElapsed] = useState(0);
useEffect(() => {
  const id = setInterval(() => setElapsed((s) => s + 1), 1000);
  return () => clearInterval(id);
}, []);

const reassurance = elapsed >= 20
  ? 'Still writing — long sets take a minute.'
  : undefined;
```

Render the reassurance under the existing `voiceLine` if set.

- [ ] **Step 3: Wire cancel in HomeBroadcastScreen**

In `HomeBroadcastScreen.tsx`, where `TuningInOverlay` is rendered during `playUserSourced`, pass:

```tsx
<TuningInOverlay
  visible={tuningIn}
  // ...existing props
  onCancel={() => {
    // Abort the in-flight createBroadcast if possible; set local state to hide overlay.
    setTuningIn(false);
  }}
/>
```

If `createBroadcast` returns a cancellable handle, wire abort. Otherwise just hide the overlay (the bake completes server-side but the client ignores the result — acceptable for v1).

- [ ] **Step 4: Verify on simulator**

Launch → start a bake → overlay appears → wait 20s.
Expected: after 20s, reassurance copy appears. TAKE IT BACK is tappable and dismisses the overlay.

- [ ] **Step 5: Commit**

```bash
git add src/components/broadcast/TuningInOverlay.tsx src/screens/home/HomeBroadcastScreen.tsx
git commit -m "fix(tuning): add cancel + soft-timeout reassurance

11-40s bake with no escape was brutal on slow networks. Now shows
'still writing' after 20s and exposes a TAKE IT BACK pressable
to bail out of the overlay.
"
```

---

### Task 13: START FRESH under Resume — confirm + strengthen affordance

**Why:** `src/screens/home/HomeBroadcastScreen.tsx:521-528, 731-743` — START FRESH sits at 11px amber, 0.6 opacity, below the RESUME button. Calls `clearPersistedBroadcast()` silently. Wiping progress with one tap on a barely-visible link is the opposite of what the affordance warrants.

**Files:**
- Modify: `src/screens/home/HomeBroadcastScreen.tsx`

- [ ] **Step 1: Find the handler**

Run: `grep -n "onStartFresh\|startFresh\|START FRESH" src/screens/home/HomeBroadcastScreen.tsx`

- [ ] **Step 2: Wrap handler in Alert confirm**

Replace the `onStartFresh` handler with:

```tsx
const onStartFresh = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  Alert.alert(
    'Start a new broadcast?',
    "You'll lose your place in tonight's set.",
    [
      { text: 'Keep current', style: 'cancel' },
      {
        text: 'Start fresh',
        style: 'destructive',
        onPress: () => {
          clearPersistedBroadcast();
          // refresh resume state in the existing flow
          setResumeOffer(null);
        },
      },
    ],
  );
};
```

Ensure `Alert` is imported at the top.

- [ ] **Step 3: Strengthen the visible affordance**

Locate the START FRESH Pressable's Text style. Raise opacity from 0.6-area to full; raise fontSize from 11 to `TypeScale.s12`; keep amber color.

If the style key is `startFreshLabel`:

```ts
startFreshLabel: {
  fontFamily: Fonts.mono,
  fontSize: TypeScale.s12,
  letterSpacing: 2,
  color: AM.amber,
  textDecorationLine: 'underline',
},
```

Remove any `opacity: 0.6` from the surrounding container.

- [ ] **Step 4: Bump hitSlop**

Add `hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}` to the Pressable.

- [ ] **Step 5: Verify on simulator**

Launch with an active persisted broadcast → Home shows RESUME + START FRESH.
Expected: START FRESH is readable. Tapping opens Alert. Cancel returns, Start fresh wipes persistence.

- [ ] **Step 6: Commit**

```bash
git add src/screens/home/HomeBroadcastScreen.tsx
git commit -m "fix(home): confirm before START FRESH wipes persisted cursor

11px 0.6-opacity amber link silently wiped 24h resume progress
with one tap. Now requires destructive Alert confirmation and
raises the label to 12px full-opacity underlined.
"
```

---

### Task 14: Ask ONAY — pre-send subscription guard

**Why:** `src/screens/curate/AskOnayScreen.tsx:124-142, 183-220` — users without Apple Music subscription can type a prompt and tap PULL. The client runs the LLM call (~8s) before checkGuards fails, then surfaces an error block. Worse: the input was cleared at line 188, so the user loses their prompt.

**Files:**
- Modify: `src/screens/curate/AskOnayScreen.tsx`

- [ ] **Step 1: Find the subscription check**

Run: `grep -n "subscription\|checkGuards\|canPlayback" src/screens/curate/AskOnayScreen.tsx`

- [ ] **Step 2: Mount-time guard**

Add a `useEffect` at the top of the screen component that runs `checkGuards()` once and sets a local `subscriptionOk` state:

```tsx
const [subscriptionOk, setSubscriptionOk] = useState<boolean | null>(null);

useEffect(() => {
  (async () => {
    try {
      const ok = await musicKitPlayer.canPlaybackCatalog();
      setSubscriptionOk(ok);
    } catch {
      setSubscriptionOk(false);
    }
  })();
}, []);
```

Adjust `canPlaybackCatalog` to whatever the existing check is called (search the native-module binding).

- [ ] **Step 3: Render banner when subscription is missing**

Above the input (or at the top of the screen), render:

```tsx
{subscriptionOk === false && (
  <View style={styles.guardBanner} accessibilityRole="alert">
    <Text style={styles.guardBannerTitle}>APPLE MUSIC SUBSCRIPTION REQUIRED</Text>
    <Text style={styles.guardBannerBody}>
      ONAY can browse and pull, but you'll need an active subscription to play what she picks.
    </Text>
  </View>
)}
```

Styles:

```ts
guardBanner: {
  marginHorizontal: Space.s20,
  marginBottom: Space.s16,
  padding: Space.s14,
  borderWidth: 1,
  borderColor: AM.oxbloodDim,
  backgroundColor: withAlpha(AM.oxblood, 0.06),
},
guardBannerTitle: {
  fontFamily: Fonts.mono,
  fontSize: TypeScale.s10,
  letterSpacing: 3,
  color: AM.oxblood,
  marginBottom: Space.s4,
},
guardBannerBody: {
  fontFamily: Fonts.serif,
  fontStyle: 'italic',
  fontSize: TypeScale.s13,
  lineHeight: 17,
  color: AM.inkMid,
},
```

- [ ] **Step 4: Preserve the prompt text on PULL failure**

Find the `onSubmit` (or PULL) handler. Locate the `setInput('')` call (line 188 per review). Move it to after the PULL request resolves successfully:

```tsx
try {
  const result = await runPull(input);
  setInput(''); // clear only on success
  // ...existing handling
} catch (err) {
  // leave input populated so user can retry without retyping
  // ...existing error handling
}
```

- [ ] **Step 5: Verify on simulator**

Test path 1 (non-subscriber): sign in with an account without Apple Music → open Ask ONAY → banner visible at top. Type a prompt → tap PULL → LLM call doesn't fire (if guard disables) OR on failure the input retains the typed text.

Test path 2 (subscriber): banner hidden, flow works as before.

- [ ] **Step 6: Commit**

```bash
git add src/screens/curate/AskOnayScreen.tsx
git commit -m "fix(ask-onay): pre-send subscription guard + preserve prompt on failure

Non-subscribers saw the PULL animation for ~8s before the
subscription error surfaced, and lost their typed prompt in the
process. Mount-time guard surfaces an oxblood banner; prompt
now only clears on successful PULL.
"
```

---

## Phase 3 — Final checks

### Task 15: PR readiness sweep

- [ ] **Step 1: TypeScript check**

Run: `cd /Users/kari/Documents/cleo-app && npx tsc --noEmit`
Expected: no errors. Fix any that surfaced from the edits above.

- [ ] **Step 2: Full simulator walkthrough**

Cold-launch → login → onboarding skip path → home → setup sheet (pick a valid playlist + vibe + length) → tuning in (try the TAKE IT BACK button) → player (check END BROADCAST confirm, volume thumb, no fake prev/next, no Philly Groove text) → return to home (check RESUME + START FRESH flow) → ask ONAY (check subscription guard if testable) → settings drawer → sign out.

Expected: no visual regressions, no crashes, no fake copy, no destructive one-tap actions.

- [ ] **Step 3: Convert draft PR to ready, push**

```bash
git push origin ui-review
gh pr edit 12 --title "UI Review — P0/P1 fixes"
gh pr ready 12
```

(If PR #12 was closed earlier, re-open with `gh pr reopen 12` before `ready`.)

Or re-create:

```bash
gh pr create --title "UI Review — P0/P1 fixes" --body "$(cat docs/superpowers/plans/2026-04-24-ui-review-fixes.md | head -50)"
```

- [ ] **Step 4: Update memory**

If any finding reveals a systemic pattern worth remembering across sessions, add a `feedback_*` memory file per the auto-memory instructions. Otherwise skip.

---

## Out of scope (deferred follow-ups)

Not in this plan — pick up in a future branch:
- P1+ mono letter-spacing canonicalization (7 values across 140+ sites)
- P2 fontSize hardcoded → TypeScale sweep (~40 sites)
- P2 Space.sNN hardcoded-padding sweep
- P2 legacy-alias cleanup in `OfflineBanner.tsx`, `ErrorBoundary.tsx`, `app/index.tsx`
- P2 login Firebase error-string humanization
- P2 VUMeter wiring to real audio levels
- P2 SlotPlaceholderCard copy ("ONAY is between tracks" when not baked)
- P2 FeaturedBroadcastCard BAKED stamp tooltip
- P3 ON AIR · 23:58 clock / wordmark ambiguity
- P3 Earlier Tonight pruning UX (fade expired rows)
- P3 haptic standardization (selection / impact(Medium) / impact(Heavy) scheme)
