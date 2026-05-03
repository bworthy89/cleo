# Product

## Register

product

## Users

The 32-year-old who used to make mixtapes and now finds Spotify
autoplay exhausting. More broadly: people worn out by infinite-choice
streaming who want a curator, not a catalog. They're not looking for
discovery in the algorithmic sense; they want a host who hears the
shape of an evening and plays records into it.

The use is ritual, not background. Headphones on, no other tab open,
30 to 90 minutes. They picked the playlist; ONAY picks everything else.

## Product Purpose

ONAY is a pre-baked AI radio broadcast. The user supplies a playlist,
a vibe, and a length; the server bakes the entire episode (track order
plus host commentary) before playback begins. Once it's playing, the
broadcast is locked: no skips, no live reactions, no recovery prompts.

Success is a single phrase: "ONAY gets me." The user closes the app
feeling read, not served. The product wins when the curation feels
inevitable in retrospect, like the only order those tracks could
have been in.

## Brand Personality

Intimate. Unhurried. Laid back.

In-genre reference points: Cita's World and Rap City. Late-night BET
energy where the host knows the music cold, has a point of view, and
doesn't rush. ONAY is the late-night college DJ who's seen things, not
the morning-show drop-in.

Out-of-category register: editorial print, not app chrome. Liner
notes, hand-set type, hairlines, catalog numbers. The app frames the
broadcast the way a sleeve frames a record.

## Anti-references

- **Yoodio.** UI is a Spotify-skin card grid. ONAY is editorial print:
  Anton display, Fraunces italic body, JetBrains Mono catalog labels,
  hairline rules, sharp corners, no nested cards.
- **Radiant.** Host is a peppy FM-morning drop-in voice with bright
  affect and quick handoffs. ONAY's voice is female, measured,
  late-night, with restraint and the patience to leave silence between
  thoughts. Never "your boy / my man / this guy" DJ phrasing.
- **Algorithmic discovery surfaces** (Spotify Daylist, Apple Music
  Stations). ONAY isn't an infinite feed; it's a finite, locked
  episode with a beginning and an end.
- **Generic "AI radio" tells:** synth-glow gradients, neon accents,
  glassmorphism, robot-host iconography, "Powered by AI" badges,
  hero-metric dashboards.

## Design Principles

1. **No skip button is a feature.** Skipping breaks the curation
   contract. The user trusts ONAY for the duration; ONAY earns it by
   sequencing well. UI never offers an out the host wouldn't.

2. **Every interaction should feel like cueing up a record, not
   pressing a button.** Stamp plates, corner ticks, hairline rules,
   physical-affordance language ("DROP THE NEEDLE", not "PLAY"). When
   in doubt, ask: would this exist on a record sleeve?

3. **One host, one voice.** ONAY is a person, not a roster or a tunable
   persona. The product is differentiated by the single voice, not by
   choice. Don't ship voice pickers, host swaps, or "select your DJ".

4. **The broadcast is locked once it starts.** No live mid-episode
   reactions, no failure-recovery prompts, no "regenerate". Server
   bakes; client plays. Errors during a baked broadcast are silent
   degradations, not interruptions.

## Accessibility & Inclusion

WCAG 2.2 AA. The app already respects `useAppActive()` to pause
animation loops when backgrounded; extend that respect to
`reduceMotion` for the spinning record, VU meter, and tuning-in
overlay. Verify cream/amber/oxblood combinations against the warm-black
base meet 4.5:1; pay special attention to `amberDim` and `inkDim`
which are the most likely to fall below threshold. No transcript
commitment.
