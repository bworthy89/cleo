# Tonight on ONAY — Curator-Driven Slot Publishing

**Date:** 2026-04-18
**Status:** Design approved, pending plan
**Related:** `docs/superpowers/specs/2026-04-16-curation-design.md` (Ask ONAY)

---

## Purpose

Turn the existing "Tonight on ONAY" home-screen section into a living editorial
grid with two named slots that refresh on a predictable cadence, while keeping
the curator firmly in the driver's seat. ONAY the station gets a programming
schedule; ONAY the voice still sounds like it was made by a human.

## Goals

- Give listeners two fresh featured broadcasts per day, one **Morning** and one
  **Evening**, framed as "tonight's drops" by the home screen.
- Give the curator a fast, low-ceremony way to publish into either slot from
  the same Ask ONAY flow they already use — no separate admin surface.
- Preserve human curation. The LLM assists, the curator ships.
- Add zero infrastructure surface (no cron, no server-side scheduler, no
  Apple Music server-side developer token). Everything rides on the existing
  curator-authenticated `POST /broadcast/featured/publish` path.

## Non-Goals

- Autonomous/cron-triggered bakes. Decided against — too impersonal and too
  costly at the 2-bakes/day cadence if we ever had to fall back from Ollama
  to Gemini (quota risk).
- Track sourcing via server-side Apple Music Catalog API. Not needed — the
  curator is on iOS, track resolution already happens client-side via
  MusicKit + `searchCatalog`.
- A rolling window, archive, or more than 2 simultaneous slots. Exactly 2 live
  slots at any time. Future v2 concern.
- Automated cleanup of orphaned segment MP3s when a slot is re-baked.
- Generated artwork for slot broadcasts.

---

## User Experience

### Listener

- `HomeBroadcastScreen` "Tonight on ONAY" section renders two cards:
  - **Morning** slot (small `MORNING` DM Mono label above the title)
  - **Evening** slot (small `EVENING` DM Mono label above the title)
- If a slot is empty (not yet baked, or registry missing the record), render a
  muted placeholder card ("Tonight's Morning — coming soon") that is
  non-tappable.
- Legacy non-slot featured broadcasts (e.g. the existing `late-night-soul`
  record) render below the two slot cards in a "More from ONAY" row.

### Curator

No new screen. The publish path in `AskOnayScreen` grows a small sheet with
three options:

1. **Free-form** — today's behavior, untouched. Curator enters a title +
   description, publishes without a slot.
2. **Tonight's Morning** — sheet pre-fills title/description/vibe/length from
   `getThemeFor('morning', today)`. Curator can edit title + description and
   override `themeDay` via a day picker. Vibe and length are locked to the
   theme to keep the slate coherent.
3. **Tonight's Evening** — same, for the Evening theme.

If the tracks were curated under a different vibe than the slot's fixed vibe
(e.g. curator built a `party` session but selected the Morning slot), the
sheet shows a soft warning explaining that commentary will regenerate for the
slot's vibe. Curator can confirm or cancel.

On confirm, the client calls the existing publish endpoint with `slot` and
`themeDay` fields populated. The server bakes using the slot's vibe + length,
not whatever the Ask ONAY session was chatting about.

`themeDay` is computed from the curator's device local time at publish —
no server clock, no timezone configuration. If the curator is up at 1 AM
thinking of "last night's slot," the day-override picker handles it.

---

## Theme Library

Single flat module, mirrored on client and server so the publish request and
server bake consume the same values:

**Path:** `src/config/tonightOnOnay.ts` (client),
`server/src/config/tonightOnOnay.ts` (server mirror).

```ts
export type SlotKey = 'morning' | 'evening';
export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface SlotTheme {
  slot: SlotKey;
  day: DayOfWeek;
  title: string;        // "Throwback Tuesday Morning"
  description: string;  // curator-facing + home-screen copy
  vibe: Manifest['vibe'];
  length: Manifest['length'];
}

export const SLOT_THEMES: SlotTheme[] = [ /* 14 entries: 7 days × 2 slots */ ];

export function getThemeFor(slot: SlotKey, day: DayOfWeek): SlotTheme;
```

- 14 entries total, one per (day × slot) combination.
- Edited via normal PRs; this is the station's programming schedule and
  should evolve over time.
- The v1 set of themes is a curator decision and will be populated during
  implementation (placeholder entries in the plan, real copy before merge).

---

## Data Model

Extend `FeaturedBroadcast` in
`server/src/services/broadcast/FeaturedBroadcastRegistry.ts`:

```ts
export interface FeaturedBroadcast {
  id: string;                // "slot_morning" | "slot_evening" | legacy ids
  slot?: SlotKey;            // new; present iff this is a Tonight-on-ONAY slot
  themeDay?: DayOfWeek;      // new; denormalized day this bake was themed for
  title: string;
  description: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
  artworkUrl?: string;
  baked: boolean;
  createdAt: number;
  manifest: Manifest;
}
```

**Replacement by natural key.** Slot broadcasts use fixed ids
`"slot_morning"` and `"slot_evening"`. `registry.put()` already overwrites on
id match, so re-baking a slot naturally replaces the prior record without any
new logic. Previous segment MP3s are orphaned in `.broadcast-cache/` / R2;
acceptable at 2 bakes/day max.

**New accessor:** `FeaturedBroadcastRegistry.getBySlot(slot: SlotKey)`
returning the baked record for that slot or `null`.

**Ordering on `list()`:** slot records sorted `morning → evening`, then any
non-slot legacy records after.

**No migration required.** Existing registry entries without `slot` fields
remain valid and render in the "More from ONAY" row.

---

## API Changes

### `POST /broadcast/featured/publish`

Extend `publishSchema` in `server/src/routes/featured.ts`:

```ts
const publishSchema = z.object({
  id: z.string().min(1).max(80),
  slot: z.enum(['morning', 'evening']).optional(),
  themeDay: z.enum(['mon','tue','wed','thu','fri','sat','sun']).optional(),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(400),
  vibe: vibeSchema,
  length: lengthSchema,
  artworkUrl: z.string().url().optional(),
  tracks: z.array(trackSchema).min(5).max(100),
});
```

Validation rules:

- If `slot` is present, `themeDay` must also be present and `id` must equal
  `\`slot_${slot}\``. Reject 400 otherwise.
- If `slot` is absent, behaves exactly as today (legacy free-form publish).
  Reject 400 if a slot-absent request uses a reserved id (`^slot_`); prevents
  a free-form publish from clobbering a slot record.
- `vibe` and `length` submitted by the client for slot publishes must match
  the theme's vibe/length (server consults the theme library and rejects
  mismatches). This prevents accidental vibe drift if the client code has
  a stale theme snapshot.

Record written to the registry includes `slot` and `themeDay` when present.

Existing middleware — `requireCurator`, `bakeLimiter` — applies unchanged.
Ownership gate (`userId === 'curator'` bypass) continues to make slot
broadcasts publicly readable.

### `GET /broadcast/featured`

No shape change. Response body now carries `slot` and `themeDay` on applicable
records; client is expected to handle their absence for legacy records.

Ordering of the response follows the registry's new `list()` ordering
(morning → evening → legacy).

---

## Client Changes

### `AskOnayScreen` — Publish Sheet (replacing the Alert prompt)

Today the "Publish as Tonight on ONAY" button on a curator-visible playlist
opens a native `Alert.prompt` that asks for a title override and then fires
`publishFeatured`. That flow goes away entirely. It is replaced with a new
modal component:

**New file:** `src/components/broadcast/PublishFeaturedSheet.tsx`

Visual layout (top to bottom, full-height modal with the existing black base):

1. **Header row** — left: a `×` close pressable; right: DM Mono 10px gold
   label "PUBLISH AS FEATURED" with a 2×40 gold underbar. Matches
   `SectionMarker` treatment.
2. **Slot tiles** — three stacked Pressable cards on `Surface.container`
   with 2px `Colors.accent` left border (gold-edge card pattern). Selected
   tile gets a filled `Glow.ctaShadow`. One at a time is selected.
    - **Tile A — Free-form.** Small DM Mono label "FREE-FORM", then a
      Playfair title ("Name your own drop") and Inter body. Title + short
      description inputs render inline when the tile is selected.
    - **Tile B — Tonight's Morning.** Small DM Mono label "MORNING · {DAY}"
      in gold, then Playfair title from `getThemeFor('morning', today).title`,
      Inter body description. A vibe chip (using `getVibeAccent(theme.vibe)`)
      sits top-right. When selected, an "Edit" row reveals inline inputs for
      title + description overrides plus a day picker ("Using {DAY}'s
      theme — swap?"). Changing the day re-pulls theme defaults, including
      vibe and length, and updates the chip.
    - **Tile C — Tonight's Evening.** Same shape as Tile B, using the
      evening theme.
3. **Soft warning band** — below the tiles, only shown when a slot is
   selected AND `sessionVibe !== theme.vibe`. EB Garamond italic body copy:
   "This slot's vibe is *{theme.vibe}*. I'll re-voice the commentary for
   the morning angle." Not blocking — informational.
4. **Confirm CTA** — full-width `Gradient.cta` button, DM Mono uppercase
   label "PUBLISH AS {SELECTION}". Disabled until a tile is selected and
   (for free-form) a title has been entered.
5. **Publishing state** — on submit, the CTA swaps to a pulsing
   `Animation.pulseSlow` spinner with "BAKING…" copy. Errors render in a
   short text band above the CTA in `Colors.textMuted`.

Interaction rules:

- Only one tile is selected at a time. Selection persists while the sheet
  is open; closing resets.
- Edit affordance is inline (not a drill-in) so the sheet stays a single
  screen.
- Day picker is a compact horizontal row of 7 DM Mono chips (MON–SUN);
  today is highlighted with the accent.
- Haptic: `expo-haptics` light impact on tile select, medium on confirm.
- Accessibility: each tile is `accessibilityRole="radio"` with
  `accessibilityState={{ selected }}`. CTA is `"button"`.

The existing curator-visibility check (`canCurate` on `AskOnayScreen`) still
gates whether the button that opens the sheet renders.

### `HomeBroadcastScreen` — Twin-slot Layout

Today's pattern is **hero + rail**: one `FeaturedBroadcastCard` (hero) plus
horizontal `FeaturedRailCard`s (rest). We change the top-of-screen feed to
a **twin-slot stack** that always reserves space for both slots, then keeps
the rail for legacy records.

New structure in order:

1. **Section marker** — "TONIGHT ON ONAY" in the existing SectionMarker
   style (DM Mono gold, underbar, `num="T·01"`). New prop `pulse` is
   unchanged from today.
2. **Morning slot card.** If `getBySlot('morning')` exists, render a
   `FeaturedBroadcastCard` with `slotLabel="MORNING"`. If not, render a new
   `SlotPlaceholderCard` with copy "Tonight's Morning · coming up" in
   muted Inter, 2px `Colors.accent` left border, and no tap action.
3. **Evening slot card.** Same treatment with the evening record or
   placeholder.
4. **"More from ONAY" row** — only renders when at least one non-slot
   legacy record exists. Small DM Mono section label "MORE FROM ONAY" (no
   underbar, to read as a subsection), then the existing horizontal
   `FeaturedRailCard` rail.

Both slot cards are the same visual weight. No "hero" promotion — the slate
is programmed, not ranked.

Liner-note quote below the stack is unchanged, but its dynamic copy is
extended to pick from whichever slot is fresher:
`const lead = morningCard ?? eveningCard ?? null;` then fall back to the
existing static string.

### `FeaturedBroadcastCard` — Slot Label

Add one optional prop: `slotLabel?: string`. When set, renders a small chip
above the title: DM Mono 10px, `letterSpacing: 2.5`, `Colors.accent`,
uppercase. Sits in the same vertical rhythm as today's tagline. No layout
shift when the prop is absent.

### `SlotPlaceholderCard` (new)

**New file:** `src/components/broadcast/SlotPlaceholderCard.tsx`

- Same outer shape as `FeaturedBroadcastCard` (card radius, gold-edge
  border, min-height matched) so the Morning/Evening stack stays
  visually consistent whether baked or not.
- Content: slot chip ("MORNING" / "EVENING"), muted Playfair headline
  ("coming up"), Inter body ("ONAY is between tracks"). No pressable
  handler — the card is informational.
- Opacity 0.55 on the whole card; no animation (respects the "no
  backgrounded loops" rule and avoids pulling attention from live
  content).

### Design-token touch points

No new tokens. This feature uses existing: `Colors.accent`, `Colors.textMuted`,
`Surface.container`, `Gradient.cta`, `Glow.ctaShadow`, `Typography.*`,
`Space.*`, `Radius.*`, `Animation.pulseSlow`, `getVibeAccent()`.

---

## Testing

### Server (Jest)

1. `publishSchema` accepts `slot` + `themeDay`; rejects `slot` without
   `themeDay`; rejects `id` mismatched with `slot_${slot}`; rejects vibe/length
   that don't match the theme for that day.
2. `FeaturedBroadcastRegistry`: two consecutive `put()` calls with
   `id: 'slot_morning'` yield a list containing exactly one record with the
   newer `createdAt`.
3. `FeaturedBroadcastRegistry.list()` returns morning before evening before
   legacy records.
4. `getBySlot('morning')` returns null when nothing is baked for the slot.

### Client (Jest, existing suite)

1. `PublishFeaturedSheet` prefill logic pulls the right theme for the current
   local day.
2. Day override swaps the theme fields consistently (vibe/length included).
3. Slot-vibe-warning pure function returns `true` only when session vibe and
   slot vibe differ.

### Manual regression

- Free-form publish still works (no slot, no themeDay).
- Home screen renders muted placeholders on a fresh registry.
- Re-baking Morning twice leaves one record, newer timestamp.

---

## Risks & Mitigations

- **Orphaned segment MP3s.** Re-baking overwrites the registry entry but not
  the underlying cache/R2 objects. Storage growth at 2 bakes/day is trivial
  (~60 MB/month worst case at `long` length); accept for v1, add a sweep
  later.
- **Client-server theme drift.** Client and server mirror the theme library.
  If they drift (e.g. a client deploy with a new theme hits an older server),
  the server's vibe/length validation catches it with a 400. The error
  surfaces in the publish sheet.
- **Curator baking the "wrong day" unintentionally.** Day override is
  explicit and requires tapping into an edit sheet. Default is always
  today's local date. Low-risk.
- **Rate limit collision with user bakes.** Curator publishes share the
  existing `bakeLimiter`; a busy curation evening could eat into user bake
  quota. Acceptable at 2/day; revisit if cadence increases.

---

## Future Work (Out of Scope)

- Autonomous/scheduled bakes (cron, systemd, external trigger).
- Rolling-window archive of prior slot bakes.
- Server-side Apple Music Catalog API + seed-pool sourcing.
- Generated or fetched artwork per slot.
- Orphaned segment MP3 cleanup sweep.
- Per-slot analytics (listens, completion rate).
