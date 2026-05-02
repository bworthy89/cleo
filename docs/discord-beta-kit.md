# The ONAY Booth — Discord Beta Kit

Everything needed to launch the closed beta Discord server. Copy/paste ready.

---

## 1. Server identity

- **Name:** The ONAY Booth
- **Icon:** gold ONAY orb (extract from `OnayCharacter.tsx`)
- **Vibe:** production room, not audience. Testers are insiders.

Alternate names if "The Booth" doesn't land:
- **ONAY After Hours** — radio-noir, intimate
- **Frequency 826** — cryptic, fan-space feel

---

## 2. Roles

| Role | Color | Description |
|---|---|---|
| `@Producer` | `#C8832A` (gold) | The person building ONAY. That's me. |
| `@On-Air` | `#E8B872` (light gold) | Co-mods. Trusted to keep the booth running. |
| `@Charter Listener` | `#FFFFFF` (white) | Beta tester. First wave. Your taste shapes the show. |
| `@Bot` | `#4A4A4A` (graphite) | Automation. Don't @ them, they won't answer. |

Optional notification roles (in `#roles`, opt-in via reaction):
- `@Bug Hunter` 🐛 — pings for "we need testers" calls
- `@Voice Critic` 🎙 — pings for ONAY script feedback asks
- `@Featured Voter` 🔥 — pings when new featured drops

Use these pings sparingly — once or twice a week max, or testers mute the server.

---

## 3. Channel structure

### 📻 LOBBY
- `#welcome` — read-only: rules, what ONAY is, current beta version, known issues
- `#apply` — application form (everyone can see, only Producer can review)
- `#start-here` — react-to-get-role gate (✅ → @Charter Listener unlocks the rest)
- `#announcements` — Producer only; new builds, featured drops, downtime
- `#roles` — opt-in notification roles via reactions

### 🎙 THE STUDIO (community)
- `#general` — casual chat
- `#now-playing` — share clips/screenshots of broadcasts you're hearing
- `#vibe-requests` — testers pitch new vibes or playlist ideas
- `#the-airwaves` (voice) — listening parties

### 🐛 FEEDBACK
- `#bug-reports` — forum channel. Tags: `crash` `audio` `ui` `bake-failure` `onay-script` `auth` `other`
- `#feature-ideas` — forum channel, upvote via reactions
- `#testflight-builds` — Producer posts each build with changelog; testers thread replies

### 🗳 EDITORIAL
- `#tonight-on-onay` — featured candidates; vote 🔥 / 💀
- `#episode-clips` — favorite ONAY commentary moments

### 🔒 BACKSTAGE (mods only)
- `#producer-notes` — private scratchpad
- `#mod-log` — bot audit log

---

## 4. Channel topic strings

Paste into each channel's topic field:

```
#welcome         → "Between the tracks, between the bugs. You're early."
#apply           → "Tell us what you listen to. We'll tell you when you're in."
#announcements   → "New builds, new episodes, downtime warnings. Read-only."
#general         → "Off-air chat. Anything goes."
#now-playing     → "What ONAY is saying right now. Clips, screenshots, receipts."
#vibe-requests   → "What should ONAY know how to do that she doesn't yet?"
#bug-reports     → "One thread per bug. Screenshots > words."
#feature-ideas   → "Pitch it. The 🔥 button decides what we build."
#testflight-builds → "Every build, every changelog. Update fast."
#tonight-on-onay → "Vote on what goes out to the whole listener base. 🔥 = ship it. 💀 = kill it."
#episode-clips   → "Your favorite ONAY moments. Receipts for the highlight reel."
#producer-notes  → "Scratchpad. Half-thoughts about ONAY, things to test, ideas at 2am."
```

---

## 5. Bots

| Bot | Purpose |
|---|---|
| **Carl-bot** (or MEE6) | Reaction roles, auto-DM on role grant, auto-mod, mod log |
| **Sesh** | Schedule listening parties / beta sync calls |
| **Discord native polls** | Voting in `#tonight-on-onay` |
| **GitHub bot** (optional) | Pipe `#bug-reports` issues into a private repo |

---

## 6. Discord-gated TestFlight flow

The cleanest setup for a vetted closed beta. Discord is the funnel, the vetting layer, and the community.

**Setup:**
1. App Store Connect → TestFlight → create a **public link** (cap at 25–50 testers).
2. In Discord, gate the link behind `@Charter Listener`:
   - `#apply` has the application form below
   - You review, react ✅ to good applications
   - Carl-bot grants `@Charter Listener` + auto-DMs the TestFlight URL
3. That role unlocks `#testflight-builds`, where the URL is also pinned

**Why this beats email-collected TestFlight:**
- Zero email collection
- Instant access once approved
- Easy to revoke (kick from Discord, regenerate TestFlight link if needed)
- Apple's invite emails get lost in spam — this avoids that entirely

---

## 7. Copy library

### `#welcome` post (pinned, read-only)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📻 THE ONAY BOOTH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You're in the production room.

ONAY is an AI radio host. You hand her a playlist and a vibe;
she builds you a full broadcast — track order, commentary,
the arc between songs. Like a real DJ, but one who only ever
plays music you already love.

This server is where she gets made.

━━━ HOW THIS WORKS ━━━

  → New builds drop in #testflight-builds. Update fast.
  → Bugs go in #bug-reports, one thread each.
  → Vote on what gets featured in #tonight-on-onay.
  → Share the moments that hit in #episode-clips.

━━━ THE RULES ━━━

  1. Don't share the TestFlight link, builds, or screenshots
     outside this server. Not yet. We'll say when.

  2. File bugs the way you'd want them filed if you were
     fixing them: what you did, what happened, what you
     expected, screenshot if you can.

  3. Be honest. "This is bad" is more useful than "this is
     fine." We can't fix what we don't hear.

  4. Don't be a jerk. To us, to each other, to ONAY. She's
     learning.

  5. What's said in the booth stays in the booth. We talk
     about unreleased features, internal numbers, and stuff
     that isn't ready for the world.

━━━ WHAT YOU GET ━━━

  → First access to every build, forever
  → Your name in the credits when we ship 1.0
  → Direct line to the people building it (that's me)
  → A say in what ONAY becomes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Head to #apply to get in.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Application form (pinned in `#apply`)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📻 ONAY CHARTER LISTENER APPLICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ONAY is an AI radio host who builds you a full broadcast —
track order, commentary, the whole arc — from your Apple Music
playlists. We're looking for a small group of charter listeners
to shape what she becomes.

To apply, post your answers below. We read every one.

  1. What are you listening to lately? (a playlist, an artist,
     a vibe — whatever's been on repeat)

  2. When you imagine the perfect radio host between your
     tracks, what are they saying? What are they NOT saying?

  3. iPhone model + iOS version (we need iOS 16+)

  4. Apple Music subscriber? (required — ONAY plays from your
     library)

  5. One sentence: why you?

React 📻 to your own post when you're done.
We'll get back to you within 48 hours.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Auto-DM on approval (Carl-bot trigger when `@Charter Listener` is granted)

```
Hey — you're in.

Welcome to the booth. You're one of the first people on Earth
to hear what ONAY sounds like, which means two things:

  → things will break. tell us when they do.
  → your taste is shaping the show. tell us what you think.

Your TestFlight link:
{TESTFLIGHT_URL}

Three places to land first:

  #testflight-builds — every new build, with a changelog and
  what we want you to try

  #bug-reports — one thread per bug. screenshots and the
  exact playlist/vibe you used = gold

  #tonight-on-onay — vote on what gets featured to the
  whole listener base. your 🔥 / 💀 reactions decide.

One ask: don't share the TestFlight link or build screenshots
outside this server yet. We'll tell you when it's go-time.

That's it. Go make her say something interesting.

— The Producer
```

### Waitlist DM (manual send for rejected/wave-2 applicants)

```
Thanks for applying to the ONAY beta.

We're keeping the first wave small — like 25 people small —
to make sure the feedback loop stays tight. You're on the
waitlist for wave two, which we'll open in a few weeks.

Stay in the server if you want — #general and #vibe-requests
are open to everyone. The more we hear from you there, the
faster you move up the list.

— The Producer
```

### "First 5 things to try" (pinned in `#testflight-builds`)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📻 YOUR FIRST 5 BROADCASTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You just installed ONAY. Here's the tour. Try these in order
— each one stresses a different part of the system, and your
feedback on each is gold.

━━━ 1. THE CLASSIC ━━━

  Pick a playlist you know cold.
  Vibe: Late Night.
  Length: Standard.

  → Listen all the way through. Does ONAY's commentary
    feel like it belongs between THESE songs, or could it
    have been any songs?

━━━ 2. THE STRESS TEST ━━━

  Same playlist. Vibe: Workout. Length: Quick.

  → Same songs, totally different ONAY. Does the energy
    actually shift? Or does she sound the same?

━━━ 3. THE EDGE CASE ━━━

  Pick the smallest playlist you have (5–10 songs).
  Any vibe. Length: Long.

  → We want to know if she handles short pools gracefully
    or if it falls apart.

━━━ 4. THE TASTE TEST ━━━

  Tap "Ask ONAY" instead of using a playlist.
  Type: "build me something for a rainy Sunday morning"
  (or whatever rainy-Sunday means to you).

  → Does what she picks actually feel like a rainy
    Sunday? Tell us in #vibe-requests.

━━━ 5. THE LIVE TEST ━━━

  Open #tonight-on-onay. Play tonight's featured broadcast.

  → React 🔥 if you'd listen again. 💀 if you wouldn't.
    No middle ground. We need the signal sharp.

━━━ AFTER YOU'RE DONE ━━━

  → Bugs → #bug-reports
  → "ONAY just said something amazing" → #episode-clips
  → "ONAY should be able to do X" → #feature-ideas
  → Anything else → #general, just tag @Producer

That's it. Go listen.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Bug report template (pin in `#bug-reports`, set as forum default)

```
━━━ BEFORE YOU POST ━━━

Search the channel. If your bug already has a thread, add to
that one instead of starting a new one — repro counts matter.

━━━ THE TEMPLATE ━━━

**What happened:**
(one sentence — the bug itself)

**What you were doing:**
- Playlist:
- Vibe:
- Length:
- iPhone model + iOS version:

**What you expected to happen:**

**Steps to reproduce (if you can):**
1.
2.
3.

**Screenshot or screen recording:**
(drag it in)

**Bug or weird?**
○ Crash / hang
○ Audio glitch
○ ONAY said something wrong/weird
○ UI looks broken
○ Bake failed / never finished
○ Something else

━━━ TAG YOUR THREAD ━━━

Use the forum tags so we can triage fast:
crash · audio · ui · bake-failure · onay-script · auth · other
```

### Build announcement template (you post in `#testflight-builds`)

```
━━━ BUILD {N} — {YYYY-MM-DD} ━━━

**What's new:**
  → {feature 1}
  → {feature 2}
  → {feature 3}

**What we want you to try:**
  → {test scenario 1}
  → {test scenario 2}

**Known issues we already know about:**
  → {issue 1}
  → {issue 2}

Update via TestFlight. Reload the app once after install.
```

### `#tonight-on-onay` post template

```
━━━ TONIGHT'S BROADCAST ━━━

🎙 **{TITLE}**
Vibe: {VIBE}  ·  Length: {LENGTH}  ·  ~{MIN} min

{ONE-LINE DESCRIPTION — what it sounds like, who it's for}

Tracklist:
  1. {TRACK} — {ARTIST}
  2. {TRACK} — {ARTIST}
  ...

━━━ VOTE ━━━

🔥 = ship it. Let everyone hear this.
💀 = kill it. Don't push this one out.

We ship the ones that hit 10 🔥 by midnight.
```

### `#episode-clips` prompt (pinned)

```
━━━ SHARE THE MOMENTS THAT HIT ━━━

When ONAY says something that makes you laugh, cringe, or
hit pause to listen again — capture it. We're building the
highlight reel for launch.

How to share:
  → Screen record the moment (iPhone: side button + volume up)
  → Trim to just the ONAY commentary if you can
  → Drop it here with one line of context: what playlist,
    what vibe, what made it land

The best clips end up on our launch page with your @ in
the credits.
```

### `#vibe-requests` prompt (pinned)

```
━━━ WHAT VIBE IS MISSING? ━━━

ONAY ships with 7 vibes today: Morning, Focus, Workout,
Feel Good, Late Night, Melancholy, Party.

What's the 8th? The 12th?

Pitch a vibe in 3 lines:
  → Name it
  → When you'd reach for it (the moment, the mood)
  → 2–3 songs that would feel right under it

The pitches that get the most 🔥 reactions get built next.
```

### Listening party announcement (Sesh bot)

```
/sesh create

Title: ONAY LIVE — Saturday Tune-In
When: Saturday 9pm ET
Where: Voice channel #the-airwaves

We all start the same featured broadcast at the same time.
Talk over it in voice. React to ONAY's calls in real time.
First time we test ONAY as a group ritual instead of
a solo experience.

RSVP with 📻 below. We'll @ everyone 10 min before.
```

---

## 8. Bot setup commands

### Reaction roles (Carl-bot)

In `#start-here`, post a message, get its ID, then:
```
?rr make <message-id> 📻 @Charter Listener
```

For optional notification roles in `#roles`:
```
?rr make <message-id> 🐛 @Bug Hunter
?rr make <message-id> 🎙 @Voice Critic
?rr make <message-id> 🔥 @Featured Voter
```

### Mod log (Carl-bot)

Run in `#mod-log`:
```
?logging messageDeleted #mod-log
?logging messageEdited #mod-log
?logging memberJoined #mod-log
?logging memberLeft #mod-log
?logging roleAdded #mod-log
```

### Auto-DM on role grant (Carl-bot)

Configure via Carl-bot dashboard → Automod / Autoresponder → trigger on
`@Charter Listener` granted → action: DM user with the approval copy above.

---

## 9. Custom emoji to upload

Extract from app assets (`OnayCharacter.tsx`, vibe icons in design tokens):

```
:onay:           — gold orb, default state
:onay_live:      — orb + pulsing dot
:onay_thinking:  — orb mid-bake
:vibe_morning:   — sun
:vibe_latenight: — moon
:vibe_workout:   — flame
:vibe_focus:     — diamond
:vibe_melancholy:— rain
:vibe_feelgood:  — sparkle
:vibe_party:     — disco ball
:bake:           — oven (for "baking your broadcast" jokes)
:tuning:         — radio dial
```

Upload at Server Settings → Emoji. Free tier = 50 slots; Boost Level 1 doubles it.

---

## 10. Launch sequence (do this top to bottom)

```
1.  Create server → name it "The ONAY Booth"
2.  Upload server icon (gold orb)
3.  Create roles in this order: @Producer, @On-Air,
    @Charter Listener, @Bot — set colors
4.  Build the channel structure (categories first, then channels)
5.  Set channel permissions: @everyone can only see #welcome
    and #apply; @Charter Listener unlocks the rest
6.  Paste channel topic strings into each channel
7.  Pin the #welcome post, the application form,
    the bug template, and the "first 5 things to try"
8.  Invite Carl-bot, Sesh
9.  Set up reaction roles in #start-here
10. Set up auto-DM on @Charter Listener role grant
11. Upload custom emoji
12. Enable App Store Connect TestFlight public link
13. Paste TestFlight URL into the auto-DM payload
14. Make YOURSELF a tester first — run through the whole
    flow as if you were a stranger. Fix what's awkward.
15. Send the first invite link to one person you trust.
    Watch them go through it. Fix what they trip on.
16. Open the gates.
```
