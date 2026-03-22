# ONAY Monetization Design — "Radio Station" Freemium

**Date:** 2026-03-21
**Status:** Approved

---

## Overview

ONAY adopts a freemium model with two revenue streams: a subscription tier (ONAY+) and tasteful visual ads for free users. The core principle is that every free session delivers the full radio experience — limits are on frequency and customization, never on audio quality.

---

## Free vs Premium Feature Split

### Free Tier — "Listener"

| Feature | Detail |
|---------|--------|
| ONAY-hosted sessions | 3 per week (resets Sunday midnight, user's local time) |
| Full radio experience | All delivery modes, crossfade, eject transitions — no degradation |
| Stations/playlists | Limited to 1 saved station (can switch playlists, but only 1 "station" saved with vibe/preferences) |
| Session history | Only current session visible (no Archive tab access) |
| Vibes | 6 core vibes: general, chill, workout, lateNight, feelGood, morning |
| AI queue upgrade | Disabled — plays playlist order |
| Enrichment | Disabled — no editorial insight cards with producer/songwriter data |
| Session memory | Disabled — no cross-session continuity |
| Ads | Native ads on Home screen + interstitial on session end |

### Premium — "ONAY+"

| Feature | Detail |
|---------|--------|
| Sessions | Unlimited |
| Stations | Unlimited saved stations with per-station vibe/preferences |
| Archive | Full broadcast history with filter tabs |
| Vibes | All 12 vibes including elevated, melancholy, throwback, sunday, focus, party |
| AI queue upgrade | Enabled — ONAY reorders queue intelligently |
| Session memory | Cross-session continuity (ONAY remembers previous sessions) |
| Enrichment | Full MusicBrainz + Genius data in editorial insight cards |
| Ads | None |

### Design Principle

Every free session feels like the real thing. Limits are on *how often* and *how much you can customize*, not *how good it sounds*. Nobody's first impression of ONAY should be a watered-down version.

---

## Subscription — ONAY+

### Pricing

| Option | Price | Notes |
|--------|-------|-------|
| Monthly | $3.99/mo | Under the $5 psychological threshold; small add-on for Apple Music subscribers |
| Annual | $29.99/yr | ~$2.50/mo — 37% savings, displayed as recommended option |

### Free Trial

- 1-week free trial on first subscription (either plan)
- Users experience unlimited sessions, all 12 vibes, archive, AI queue, no ads
- Reverts to free tier if they don't convert
- Apple handles trial management via StoreKit 2

### StoreKit Configuration

- **Subscription group:** "ONAY+" (single group, single level — both plans are equivalent tier)
- **Product IDs:** `com.worthymedia.cleo.onayplus.monthly`, `com.worthymedia.cleo.onayplus.annual`
- **Introductory offer:** 1-week free trial on both products
- **Family Sharing:** Disabled — each user requires their own subscription
- **Restore Purchases:** "Restore Purchases" button on Profile screen calls `AppStore.sync()` (required by App Store Review Guidelines 3.1.1)

### Paywall Touchpoints

1. **Session limit hit** — "You've used your 3 free sessions this week. Upgrade to ONAY+ for unlimited broadcasts." Full-screen paywall with feature comparison.
2. **Locked features** — tapping a premium vibe, Archive tab, or AI queue toggle shows a smaller inline prompt: "This is an ONAY+ feature" with upgrade button.
3. **Profile screen** — persistent "Upgrade to ONAY+" card in settings area.
4. **No paywall on first launch** — onboarding and first session are completely uninterrupted. Paywall only appears organically when users hit a limit.

---

## Ad Placements

### Where Ads Appear

**1. Home Screen — Native Ad Card**
- Appears in "YOUR STATIONS" or "PLAYLISTS" scroll area as a gold-edge card
- Styled identically to a StationCard: `Surface.container` background, 2px `Colors.accent` left border, `Radius.sm` corners
- Mono gold label at top: `"SPONSORED"` (DM Mono, 10px, letterSpacing 2.5)
- Ad headline in Inter 500, ad image fills card area
- One ad per Home screen visit, positioned after the 2nd station/playlist card
- Falls back gracefully if no ad fills (card doesn't render — no empty space)

**2. Session End — Interstitial**
- Full-screen interstitial ad shown when a free user ends a session
- Conditions: free user + session > 2 min + hasn't seen one today
- Daily frequency cap tracked in MMKV: `{ lastInterstitialDate }`

**3. Archive Upgrade Prompt (not a third-party ad)**
- Free users who tap Archive tab see a styled upgrade card
- "Your broadcast history is waiting. Unlock the archive with ONAY+."
- Uses own upsell design, not AdMob

### Where Ads Never Appear

- Broadcast screen — never. ONAY is performing.
- Speaking overlay — never.
- Session Arc screen — never.
- No audio ads, ever. ONAY is the only voice.

---

## Ad Integration — Technical

### SDK

- `react-native-google-mobile-ads` with Expo config plugin
- AdMob App ID added to `app.json` plugin config
- ATT prompt via `expo-tracking-transparency`

### Components

**`NativeAdCard`** — wraps AdMob native ad view inside gold-edge card styling. Renders ad headline in Inter 500, ad image fills card, "SPONSORED" mono label. Falls back gracefully if no fill.

**`InterstitialManager` service** — preloads interstitial at session start. Fires on session end if conditions met. Tracks daily cap in MMKV.

### ATT Prompt

- Added to onboarding after music-auth, before first session
- If declined, ads still show but non-personalized (lower CPM)
- Only prompted once — iOS remembers the choice

### Privacy Requirements

- Update `PrivacyInfo.xcprivacy` with AdMob tracking domains
- App Store privacy nutrition labels updated for advertising data collection

### Test vs Production Ads

- Use AdMob test ad unit IDs during development (`ca-app-pub-3940256099942544/...`)
- Production ad unit IDs stored in `app.json` extra config
- Showing real ads in development builds violates AdMob policy

---

## Entitlement System — Technical Architecture

### Flow

```
App Launch
  → StoreKit Transaction.currentEntitlements check
  → Store in MMKV: { tier: "free" | "premium", expiresAt: Date }
  → All feature gates read from cached value
```

### Entitlements Service

Single file: `src/services/Entitlements.ts`

Exposes:
- `isPremium()` — checks cached tier
- `canStartSession()` — checks tier + weekly session count
- `remainingFreeSessions()` — returns count remaining this week
- `availableVibes()` — returns 6 or 12 based on tier

Session counter stored in MMKV: `{ weekStartDate, sessionsUsed }` — resets when current date > Sunday midnight. Week boundary is Sunday 00:00:00 in device's local timezone. Store `weekStartDate` as ISO date string (YYYY-MM-DD) and compare date components to avoid DST edge cases.

A session is counted when playback begins (first `onTrackChanged` event fires). Sessions under 30 seconds are not counted against the weekly limit.

All feature gates call this service. No scattered `if (premium)` checks.

### Entitlement Edge Cases

- **Subscription lapse mid-session:** Entitlement checks occur at session start only. An active session is never interrupted by expiration. On next app launch, `Transaction.currentEntitlements` refreshes the cached tier.
- **Offline:** Trust the cached MMKV tier if `expiresAt` is within a 7-day grace window. Beyond that, fall to free tier. Re-verify on next network availability.
- **Server-side validation:** Deferred. Phase 1 uses client-only entitlement checks via StoreKit 2. Apple Server Notifications v2 and server-side receipt validation are deferred to a future phase when subscriber analytics are needed.

### Files Changed

| File | Change |
|------|--------|
| `BroadcastScreen.tsx` | Check `canStartSession()` before playback; show paywall if false |
| `HomeScreenRedesign.tsx` | Insert native ad card in station/playlist list; show upgrade prompt |
| `VibePicker.tsx` | Lock 6 premium vibes with lock icon; tap shows inline upgrade |
| `ArchiveScreen.tsx` | Gate behind `isPremium()`; show upgrade card for free users |
| `ProfileScreen.tsx` | Add ONAY+ subscription card with manage/upgrade CTA + Restore Purchases button |
| Enrichment call site | Gate `enrich-track` API calls behind `isPremium()`; skip enrichment for free users |
| `QueueManager.ts` | Gate `upgradeQueueInBackground()` behind `isPremium()` |
| `SessionMemory.ts` | Gate cross-session persistence behind `isPremium()` |
| `AudioCoordinator.ts` | No changes — audio experience identical for both tiers |
| `SegmentController.ts` | No changes — ONAY speaks the same way for everyone |

### Paywall Components

**`PaywallScreen`** — full-screen modal shown when session limit is hit.
- `Surface.container` background, Playfair Display title: "Unlock Unlimited Broadcasts"
- Feature comparison table: two columns (Free vs ONAY+), gold checkmarks for premium features
- Plan toggle: monthly/annual with annual highlighted as "BEST VALUE"
- Uses `SubscriptionStoreView` for purchase UI (handles edge cases natively)
- "Restore Purchases" link at bottom
- Close button returns to Home screen

**`InlineUpgradePrompt`** — compact card shown when tapping locked features.
- Gold-edge card (2px `Colors.accent` left border)
- Lock icon + feature name in Inter 500
- "Upgrade to ONAY+" button in DM Mono, gold accent
- Tapping opens `PaywallScreen`

### Analytics Events (Phase 3 prerequisite)

Events to instrument during implementation for future conversion tracking:

| Event | Parameters | When |
|-------|-----------|------|
| `paywall_shown` | `source` (session_limit, locked_feature, profile) | Paywall or inline prompt displayed |
| `paywall_dismissed` | `source` | User closes paywall without action |
| `trial_started` | `plan` (monthly, annual) | Free trial begins |
| `subscription_purchased` | `plan` | Paid subscription starts |
| `session_started` | `tier` (free, premium) | Playback begins |
| `session_limit_reached` | — | Free user hits 3/week cap |
| `ad_impression` | `placement` (home_native, session_end_interstitial) | Ad shown |

Route through Firebase Analytics (already integrated).

### Principle

Gating happens at the UI and service layer, not in the engines. The audio pipeline doesn't know or care about tiers.

---

## Rollout Phases

### Phase 1 — Subscription Only (Ship First)

- Implement `Entitlements` service, session counter, StoreKit 2 integration
- Add paywalls at 3 touchpoints (session limit, locked features, profile)
- Gate premium vibes, archive, AI queue, session memory, enrichment
- Free trial enabled
- No ads yet

### Phase 2 — Ads (Ship After Subscription Is Stable)

- Add `react-native-google-mobile-ads` + ATT prompt
- Native ad card on Home screen
- Session-end interstitial with frequency cap
- Two revenue streams: subscribers pay to remove ads, free users generate ad revenue

### Phase 3 — Iterate Based on Data

- Track conversion rate: free → trial → paid
- Track session counts for free users (is 3/week the right cap?)
- Track ad CPMs and fill rates
- Adjust pricing, session caps, and trial length based on real usage

### Why Phase It

- StoreKit is well-documented and contained — can ship quickly
- AdMob integration is more complex (ATT, privacy manifests, ad load timing, fallback states) — worth doing separately
- Revenue from subscriptions starts on day one; ads are the optimization layer
