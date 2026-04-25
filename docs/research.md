# Building ONAY: Competitive Research on Yoodio Radio & Radiant, Plus Actionable Recommendations

> **Updated 2026-04-24** to align with ONAY's actual architecture. Parts 1–3 (competitive intel) are unchanged. Parts 4–7 (recommendations) have been rewritten — the original draft assumed a "shared CDN segment library + per-listener real-time TTS via Replicate Chatterbox + Claude Sonnet scripts" architecture that ONAY does not have. See **Part 4** for the architectural reset that drives the rewritten recommendations.

## Executive Summary

Two indie iOS apps occupy almost exactly the niche ONAY is targeting. **Yoodio Radio** (launched April 2025 by solo developer "Quiche"/Kishore Hariharan under Generative Experiences LLC) bets on prompt-driven, generative stations with multiple AI DJ personas. **Radiant** (built by Pat Quinn since 2019) bets on a single sassy AI host named "Rad" who DJs your existing Apple Music library and overlays news/weather/traffic. They illustrate two opposite product theses.

ONAY's actual architecture — **per-user pre-baked broadcast episodes** generated server-side before playback begins, with self-hosted F5/CosyVoice TTS, Gemini 2.5 Flash + Groq llama-3.3-70b for scripts, sparse-cadence tiered segments (cold_open / fact_bridge / tight_bridge / deep_dive / sign_off), and Apple Music exclusively via `expo-music-kit` — sits in a different sweet spot than the original draft assumed. The wedge isn't "shared CDN segment library"; it's **bake-once-then-lock**: every episode is fully composed before the user hits play, so no live LLM/TTS calls happen between tracks. That's structurally different from Yoodio (live per-listener generation, paying real Replicate $/inference) and Radiant (live news/traffic scraping, paying ongoing maintenance + uptime).

This report documents what each app actually does (sourced from App Store release notes, founder interviews, and user reviews), then translates the findings into a prioritized roadmap for ONAY: an MVP that ships in weeks and a 12-month plan that exploits the two most exposed competitive gaps — **stability/reliability** (Radiant's Achilles heel) and **per-listener real-time cost** (Yoodio's structural problem).

-----

## Part 1: Yoodio Radio — Deep Dive

### Developer and provenance

Yoodio is built by a solo developer who goes by "Quiche" (real name Kishore Hariharan, contact `kishorehariharan925@gmail.com`), operating under the LLC **Generative Experiences** ([Apple App Store](https://apps.apple.com/us/app/yoodio-radio/id6743950965); [Yoodio TestFlight beta form](https://docs.google.com/forms/d/e/1FAIpQLSeNj1JN1CFAHJ4RnIH4uN5AWKf_cEhlCFth2rXyAEQJAlcITA/viewform?usp=send_form)). The first public TestFlight was announced on Hacker News on Feb 5, 2025, requiring Spotify Premium and capped at 25 testers due to Spotify's developer quota ([Hacker News](https://news.ycombinator.com/item?id=42944880)). The 1.0 App Store release shipped April 1, 2025 ([App Store version history](https://apps.apple.com/us/app/yoodio-radio/id6743950965)). Public-facing footprint: marketing site `yoodioapp.com`, Discord server, X/Twitter, Instagram (`@yoodioradio`, very small), a MacRumors forum thread, and a Product Hunt launch ([Product Hunt](https://www.producthunt.com/products/yoodio-generative-radio); [MacRumors thread](https://forums.macrumors.com/threads/i-made-an-ai-dj-for-apple-music.2450033/)). There is no public devlog or engineering blog beyond release notes and forum posts.

### Platform, audience, and ratings

iOS 18+, macOS 15+ (M1+), and visionOS 2+ only; designed-for-iPhone, "not verified for macOS" ([App Store listing](https://apps.apple.com/us/app/yoodio-radio/id6743950965)). The US App Store currently shows **4.1 stars from 13 ratings** as of April 2026 ([App Store](https://apps.apple.com/us/app/yoodio-radio/id6743950965)). The MacRumors pitch positions Yoodio as "Spotify AI DJ but just way better," with the differentiator being "news commentary between tracks focusing on news, traffic, and weather around you" ([MacRumors](https://forums.macrumors.com/threads/i-made-an-ai-dj-for-apple-music.2450033/)).

### AI DJ personas

Three "A-lister" personas are surfaced on the App Store description: **DJ Aya, DJ Flash, and Joey Cotillard** ([App Store description](https://apps.apple.com/us/app/yoodio-radio/id6743950965)). A fill-in jockey named "Valerie" is referenced in 1.01 release notes ("Made the fill-in jockey, Valerie, more responsive and compliant to curation protocols") ([App Store version history](https://apps.apple.com/us/app/yoodio-radio/id6743950965)). The 1.02.3 release notes claim **"1,000+ radio personalities and 30+ unique voices with your generative stations"** under what Yoodio calls the **Advance DJs system** ([App Store version history](https://apps.apple.com/us/app/yoodio-radio/id6743950965)). These appear to be procedurally combined personality templates over a smaller set of actual voice synthesis outputs — a single user reviewer ("hdhbwbsi") complained "only 3 to choose from," and the developer responded by clarifying that station/host creation is unlimited via the "create a station" button ([App Store reviews](https://apps.apple.com/us/app/yoodio-radio/id6743950965)).

### Custom station via prompt

The marquee feature: type a prompt like "Jungle beats fit for an evening around the campfire" or "Zen daytime tracks for a garden party," hit Create, and Yoodio "finds a DJ friend ready to bathe you in new discography" ([App Store description](https://apps.apple.com/us/app/yoodio-radio/id6743950965)). Prompts can include **station addons** (tracks, artists, location) added in 1.03.5 to seed curation and to anchor news/traffic to a geography ([App Store version history](https://apps.apple.com/us/app/yoodio-radio/id6743950965)). Stations take time to generate first time around (curation runs server-side); a notification fires when generation is complete so users can leave the app and return ([App Store version history](https://apps.apple.com/us/app/yoodio-radio/id6743950965)).

### Commentary types

Version 1.04.0 (Dec 15, 2025) explicitly names the segment library: **music deep dives, life stories, weather reports/forecasts, lyric breakdowns, and local-business shoutouts** ([App Store version history](https://apps.apple.com/us/app/yoodio-radio/id6743950965)). Commentary length is user-configurable as of 1.03.6 ([App Store version history](https://apps.apple.com/us/app/yoodio-radio/id6743950965)). Transition commentary sits between tracks rather than over the tail of the previous song (1.03.6 fix) ([App Store version history](https://apps.apple.com/us/app/yoodio-radio/id6743950965)).

### Music source — Spotify or Apple Music?

The picture is mixed and has shifted. The Feb 2025 HN beta required **Spotify Premium** ([Hacker News](https://news.ycombinator.com/item?id=42944880)). The MacRumors thread is titled "I made an AI DJ for Apple Music" ([MacRumors](https://forums.macrumors.com/threads/i-made-an-ai-dj-for-apple-music.2450033/)). One App Store reviewer explicitly asks for the ability to play tracks from their Apple Music playlist, suggesting current Apple Music integration is at best partial ([App Store review by "Nekcik"](https://apps.apple.com/us/app/yoodio-radio/id6743950965)). The AIChief 2026 review states Yoodio "focuses on generative commentary and curated content. Direct music playlist integration is not available yet" ([AIChief review](https://aichief.com/ai-music-generator/yoodio-generative-radio/)). Reading the totality, Yoodio's curation appears to surface Apple Music catalog tracks (as it played for reviewers without the user importing playlists), and its 1.03.5 release added **playlist import** for seeded curation, but bidirectional, library-aware listening is not its core flow.

### Last.fm and station sharing

**Last.fm scrobbling integration** added in 1.03.5 (Oct 9, 2025); **station sharing** added in 1.03.6 (Nov 27, 2025) ([App Store version history](https://apps.apple.com/us/app/yoodio-radio/id6743950965)).

### Visual/UI design

The 1.03.5 release explicitly added **"Liquid Glass UI"** — Apple's translucent, refraction/reflection material introduced at WWDC 2025 and shipped in iOS 26 ([Apple Newsroom on Liquid Glass](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/); [App Store version history](https://apps.apple.com/us/app/yoodio-radio/id6743950965)). 1.03.2 replaced AI-generated station covers with **mesh gradients** and added system-variant app icons. The app is single-language English, ~75 MB, and uses Sign in with Apple as its primary auth ([App Store listing](https://apps.apple.com/us/app/yoodio-radio/id6743950965)).

### Onboarding

1.03.1 "Streamlined onboarding flow from 4 screens to only 2" ([App Store version history](https://apps.apple.com/us/app/yoodio-radio/id6743950965)). 1.03.6 mentions "a slightly revamped onboarding flow improves the first-time user experience with clearer guidance" and added "a search function directly to the context bar to streamline discovery." The Sign in with Apple integration was added 1.03.1 to "simplify cross-device usage." Station curation was simplified to happen inline with the creation flow rather than as a separate step.

### Pricing

Free download with **Yoodio Pro** in-app purchase: **$0.99/month or $9.99/year** (the App Store currently shows these prices; an earlier archived version listed $2.99/mo and $29.99/yr, suggesting Quiche cut prices to encourage adoption) ([App Store listing](https://apps.apple.com/us/app/yoodio-radio/id6743950965); [Yoodio Infinite Radio archived listing](https://apps.apple.com/us/app/yoodio-infinite-radio/id6743950965)). Yoodio Pro grants **10× daily Advance Host transitions** and **up to 10 expert-level Advance Hosts per day**; unlimited station creation is always free ([App Store version history](https://apps.apple.com/us/app/yoodio-radio/id6743950965)).

### What users love

"As far as I can find this is the only generative AI radio app out there, and the bones of it are really fun to use. You can get fairly descriptive with what you're looking for…the integration of hosts and locations makes it feel particularly unique and personalized" ([brocklw, App Store review, Sept 2025](https://apps.apple.com/us/app/yoodio-radio/id6743950965)). Product Hunt commenters praised the "describe your ideal station" concept ([Product Hunt](https://www.producthunt.com/products/yoodio-generative-radio)).

### What users complain about

- "Vibe coded slop. Tried going to a station and just didn't work, neither did exiting out of the station. Also only 3 to choose from" — generation latency and apparent host scarcity ([hdhbwbsi review](https://apps.apple.com/us/app/yoodio-radio/id6743950965)).
- "I was really looking to be able to add my own Playlist… have a DJ say things like 'this next song from your Playlist'" — limited Apple Music library integration ([Nekcik review](https://apps.apple.com/us/app/yoodio-radio/id6743950965)).
- Default genre stations include country radio that one reviewer called "racist" and demanded the ability to delete defaults ([codexmendoza review](https://apps.apple.com/us/app/yoodio-radio/id6743950965)) — i.e., users want to remove curated defaults, not just add their own.
- Frequent "general bug fixes and improvements" releases (1.05.0–1.06.0 are nearly monthly with no other notes) suggest persistent stability work.

-----

## Part 2: Radiant — Deep Dive

### Developer and history

Radiant is built by **Patrick "Pat" Quinn**, started in 2019 as a side project while he worked as a traveling technical salesman; it was originally a three-person bootstrapped team ([Music Ally interview, May 2020](https://musically.com/2020/05/19/startup-files-radiants-spotify-powered-ai-dj/); [Kill the DJ interview, June 2024](https://killthedj.com/radiants-vs-spotify-interview/)). Quinn frames Radiant as "traditional radio but just for you" — an attempt to recapture pre-streaming radio's storytelling, weather, traffic, and artist context ([Kill the DJ](https://killthedj.com/radiants-vs-spotify-interview/)). The official website is `getradiant.app`, X handle `@getradiantapp` (281 followers, dormant) ([X/Twitter](https://x.com/getradiantapp)). There is an active subreddit `r/RadiantApp` where Pat responds to feedback ([AppleVis quote](https://www.applevis.com/apps/ios/music/radiant-future-radio)). Radiant has been featured in Music Ally, Hypebot, Product Hunt, AppleVis, and the Music Biz Weekly podcast ([Hypebot Ep. 417, May 2020](https://www.hypebot.com/hypebot/2020/05/radiant-personalized-radio-hosted-by-your-own-ai-powered-dj.html)).

### Streaming-provider history (Spotify → Apple Music)

**Radiant launched on Spotify in 2019/2020** ([Music Ally](https://musically.com/2020/05/19/startup-files-radiants-spotify-powered-ai-dj/)). When Quinn tried to monetize at €1/month, Spotify granted him a developer approval but not a commercial approval, then sent a kill notice when they spotted a press article about the paid plan; Radiant has been free ever since ([Kill the DJ interview](https://killthedj.com/radiants-vs-spotify-interview/)). After Spotify launched its own AI DJ "X" in February 2023 ([Spotify For the Record](https://newsroom.spotify.com/2023-02-22/spotify-debuts-a-new-ai-dj-right-in-your-pocket/)), Quinn dropped Spotify entirely and switched to **Apple Music exclusively**, and Radiant 3.0 (a "fresh new look," concert discovery, refined music discovery, "new personality for your AI DJ") relaunched on Apple Music in 2023 ([Product Hunt 3.0 launch](https://www.producthunt.com/posts/radiant)). Spotify is no longer supported; the App Store description now states "All you'll need is an Apple Music subscription and you're ready to tune in" ([App Store CA](https://apps.apple.com/ca/app/radiant-the-future-of-radio/id1476163061)).

### "Rad" voice and personality

Quinn deliberately leaned into a robotic, sarcastic Howard Stern–style 1980s/90s radio host tone after a "shiny" personality "started to annoy us after a few weeks": "they want C3PO not HAL" ([Music Ally](https://musically.com/2020/05/19/startup-files-radiants-spotify-powered-ai-dj/)). Personality used to come from a hand-built "personality index" of thousands of catchphrases, transition phrases, stingers, bumpers — passed to **Google Cloud Speech** for synthesis. After ChatGPT, Radiant moved to a hybrid: **ChatGPT 3.5 for three "personality components"** and **Llama 2 (self-hosted, cheaper)** for simpler parts, with explicit guardrail prompts to keep tone respectful around tragic news ([Kill the DJ](https://killthedj.com/radiants-vs-spotify-interview/)). The paid Rad.FM Plus tier — repeatedly previewed but not yet shipped as of the Kill the DJ piece — promises "a better, more natural-sounding voice synthesizer."

### Voice and frequency customization

Users can toggle Rad **male/female** ([MakeUseOf review](https://www.makeuseof.com/apple-music-app-brings-spotify-ai-dj/)) and set commentary frequency from **every song through every 10 songs, or off entirely**; news and weather can independently be toggled off ([MakeUseOf](https://www.makeuseof.com/apple-music-app-brings-spotify-ai-dj/)).

### Recommendation algorithm

Three-stage pipeline ([Kill the DJ](https://killthedj.com/radiants-vs-spotify-interview/)):

1. **Filter** songs by BPM, modality, and timbre matching a candidate state of mind.
2. **Narrow** with collaborative filtering (other listeners' tastes).
3. **Order** with an "AI that sorts the music as though it's a DJ setting the set," driven by contextual variables — time of day, day of week, weather, motion, holidays. Each song has a **valence score** combining lyrical sentiment, BPM, and modality, sourced from public **MetaBrainz** datasets. The goal is a "sine wave motion" of building and releasing energy across a session.

### News, weather, traffic, artist info

Hourly news, weather, traffic, and artist back-stories are all geographically tied. Sources have included Last.fm and Discogs for biographical info ([Music Ally](https://musically.com/2020/05/19/startup-files-radiants-spotify-powered-ai-dj/)). 3.0 added **"Song Explorer"** with lyrical analysis and a **chat-with-Rad** mode for asking follow-up questions about a song ([Kill the DJ](https://killthedj.com/radiants-vs-spotify-interview/)). 3.0 also added **concert discovery** via partnerships with Bandsintown, Eventbrite, and Ticketmaster, with the eventual goal of taking ticketing affiliate fees on local-gig recommendations ([Music Ally](https://musically.com/2020/05/19/startup-files-radiants-spotify-powered-ai-dj/); [Product Hunt 3.0](https://www.producthunt.com/posts/radiant)).

### Feedback loop

Thumbs Up / Thumbs Down on the playing track. Thumbs Up saves the song to a "list" the user can revisit; Thumbs Down adjusts Rad's selections on the fly. An "Up Next" view exposes the queue and a Plus icon lets users insert specific songs ([MakeUseOf](https://www.makeuseof.com/apple-music-app-brings-spotify-ai-dj/)).

### Last.fm scrobbling

Added in version 3.0.16; further improved in 3.0.17 ([AppPure version history](https://iphone.apkpure.com/app/radiant-the-future-of-radio/co.broadcastapp.radiantapp)).

### Known stability issues and "Emergency Fixes"

Radiant 3.0.26's release notes literally read: **"Emergency Fix: Restore service. Fix: Improve end song detection again"** ([Turkish App Store listing](https://apps.apple.com/tr/app/radiant-the-future-of-radio/id1476163061)). The Google Play page contains a 5-star reviewer note saying: "Originally 10/5 stars, loved it. Recently got an Apple Music subscription again… But it turns out the app is broken, at the 'What are you into?' stage it simply doesn't work, I guess some 3rd party integration broke and it's no longer maintained" ([Google Play](https://play.google.com/store/apps/details?id=co.broadcastapp.Radiant)). AppleVis users report Rad announcing one song while a different one plays: "the speaker announced 'Nancy Mulligan' by Ed Sheeran and it played 'Happier'; it announced a song by Céline Dion and played Robin Schulz" ([AppleVis review](https://www.applevis.com/apps/ios/music/radiant-future-radio)). Magic Tap and VoiceOver were broken, then partially fixed when Pat acknowledged the redesign ([AppleVis](https://www.applevis.com/apps/ios/music/radiant-future-radio)). News sources are not user-customizable (US-defaulting to USA Today/NYT/CNN, with non-US users unable to swap to local papers), and the synthesized voice does not switch language even when songs are non-English ([AppleVis](https://www.applevis.com/apps/ios/music/radiant-future-radio)).

### Praise

"All the recommended songs are just perfect. And all the comments about the song. Just crazy" ([Google Play review](https://play.google.com/store/apps/details?id=co.broadcastapp.Radiant)). "I use Discover Weekly on Spotify religiously but Radiant suggests music more accurately and more joyfully than Spotify does" ([Calum Webb on Product Hunt](https://www.producthunt.com/posts/radiant)). The blind/accessibility community is a notably loyal early-adopter base: "a large portion of Radiant user base is blind. The blind community has been a very passionate and vocal supporter of the project" ([Pat Quinn, Kill the DJ](https://killthedj.com/radiants-vs-spotify-interview/)).

### Pricing and monetization

Currently 100% free, requires an existing Apple Music subscription (Radiant pays no royalties because Apple Music handles playback). Quinn has stated the planned **Rad.FM Plus** subscription will gate "more features, better AI recommendations, and a better voice for the DJ" using a more expensive premium synthesizer, plus possible affiliate revenue from local-gig ticket sales ([Kill the DJ](https://killthedj.com/radiants-vs-spotify-interview/); [Music Ally](https://musically.com/2020/05/19/startup-files-radiants-spotify-powered-ai-dj/)). Quinn also speculated about Bandcamp integration for direct musician payments. No paid tier is live as of the most recent reporting.

### Onboarding

"Open Radiant, authorise its access to your Spotify account [now Apple Music], and Rad — the virtual host — briefly introduces him or herself (you can choose) then plays a song that it knows you love" ([Music Ally](https://musically.com/2020/05/19/startup-files-radiants-spotify-powered-ai-dj/)). The flow asks the user to pick three artists ("What are you into?") — the step that has been buggy ([AppleVis](https://www.applevis.com/apps/ios/music/radiant-future-radio); [Google Play review](https://play.google.com/store/apps/details?id=co.broadcastapp.Radiant)).

### Visual design

The Product Hunt 3.0 launch emphasized "a fresh new look" with the landing page tagline "A real radio DJ" prominently noting Rad is a robot. The app currently sits at 26.3 MB ([AppPure](https://iphone.apkpure.com/app/radiant-the-future-of-radio/co.broadcastapp.radiantapp)). It is M1/M2 Mac-installable per Calum Webb's Product Hunt comment.

-----

## Part 3: Adjacent Competitive Context

### Spotify AI DJ

Launched February 2023; voice "X" (Xavier "X" Jernigan, Spotify's Head of Cultural Partnerships) modeled on Spotify's 2022 Sonantic acquisition, with content generated using OpenAI; expanded to Spanish via "DJ Livi" in July 2024 and now reaches 68 markets ([Spotify For the Record](https://newsroom.spotify.com/2023-02-22/spotify-debuts-a-new-ai-dj-right-in-your-pocket/); [CNBC profile](https://www.cnbc.com/2024/07/27/how-xavier-jernigan-became-the-voice-of-spotifys-ai-dj.html); [Spotify announcement on DJ Livi](https://newsroom.spotify.com/2024-07-17/spanish-ai-dj-livi-voice/)). 2025 added text-and-voice conversational requests, prompt suggestions, and DJ: Wrapped ([Groove Gainer 2026 features summary](https://www.groovegainer.com/spotify-new-features-2026-ai-and-groove-gainer/); [Spotify Wrapped 2024 post](https://newsroom.spotify.com/2024-12-04/make-this-years-spotify-wrapped-even-more-about-you-with-these-ai-experiences/)). Critically, Spotify's DJ does **not** add news/weather/traffic and does not allow voice/persona switching ([NPR review](https://www.npr.org/2024/11/13/nx-s1-5184493/spotify-ai-dj-music)).

### YouTube Music "Beyond the Beat"

Launched September 2025 in YouTube Labs; two AI hosts converse before/after songs in radio/mixes (not user-curated playlists); commentary appears roughly **every 5 songs**; available only in the US to a limited tester pool; cannot be permanently disabled, only snoozed for 1 hour or 1 day ([TechCrunch](https://techcrunch.com/2025/09/26/youtube-music-tests-ai-hosts-that-share-trivia-and-commentary/); [Gadget Hacks](https://android.gadgethacks.com/how-to/youtube-music-ai-hosts-beyond-the-beat-changes-streaming/); [Technology.org](https://www.technology.org/2025/09/29/youtubes-ai-radio-host-talks-between-your-songs-and-you-cant-turn-it-off/)). Early Slashdot reaction was hostile ([Slashdot](https://news.slashdot.org/story/25/09/27/027234/youtube-music-is-testing-ai-hosts-that-will-interrupt-your-tunes)).

### Tech-stack reality checks (and how ONAY's stack compares)

- **Replicate Chatterbox** runs at roughly **$0.0030 per inference (~333 runs/$1) with ~4-second latency on an L40S GPU**, with a 300-character cap per request requiring batching for long segments ([Replicate Chatterbox Multilingual](https://replicate.com/resemble-ai/chatterbox-multilingual); [TTS Insider review](https://www.ttsinsider.com/chatterbox-tts/)). Chatterbox is MIT-licensed, supports 23 languages, includes a Perth neural watermark, and supports zero-shot voice cloning from ~5–10 seconds of reference audio ([Resemble AI page](https://www.resemble.ai/chatterbox/); [GitHub repo](https://github.com/resemble-ai/chatterbox)). **ONAY does not use Chatterbox** — its primary chain is self-hosted **CosyVoice3** (port 8001) with **F5-TTS** (port 8000) as fallback, both running on a LAN box (<TTS_HOST>, AMD 6700XT) exposed via a Pangolin tunnel at `<TTS_TUNNEL>`. Marginal cost per inference is electricity; concurrency is gated by an `asyncio.Lock` per provider because both runtimes are not thread-safe on ROCm. Cartesia / ElevenLabs / Orpheus sit further down the chain as paid fallbacks.
- **MusicKit / ApplicationMusicPlayer** is the only Apple-blessed way to play Apple Music catalog content from a third-party iOS app, and Apple Music subscription is gated by `MusicSubscription.canPlayCatalogContent`; there is no public API for raw PCM, beat grids, or DJ-style automix from streamed catalog tracks ([Apple MusicKit overview](https://developer.apple.com/musickit/); [Apple Developer Forums on Automix](https://developer.apple.com/forums/tags/apple-music-api)). ONAY uses MusicKit through a custom native module (`expo-music-kit`) that wraps auth, playlist fetch, playback, audio-session control, and catalog lookup. Audio session discipline (`activateDuckingSession` ↔ `releaseAudioSession`) is critical: TTS playback puts the session in `mixWithOthers` and MusicKit can't reclaim exclusive control until the session is explicitly released.
- **Spotify's developer commercial approval** is non-trivial — Radiant's monetization was killed precisely because dev approval ≠ commercial approval ([Kill the DJ](https://killthedj.com/radiants-vs-spotify-interview/)). The Yoodio HN beta cap of 25 users reflects Spotify's dev-tier quota ([Hacker News](https://news.ycombinator.com/item?id=42944880)). ONAY ships Apple Music exclusive at launch — not because Spotify support is impossible, but because the commercial-approval surface area is a known solo-dev trap.
- **Liquid Glass** is iOS 26's translucent material with refraction/reflection on edges, applied via SwiftUI's `liquidGlassMaterial` modifier or UIKit's updated `UIVisualEffectView` materials; full adoption becomes effectively required when iOS 27 ships next year ([WWDC25 "Build a UIKit app with the new design"](https://developer.apple.com/videos/play/wwdc2025/284/); [Apple Newsroom](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/); [InspiringApps timeline analysis](https://www.inspiringapps.com/blog/ios-18-lessons-preparing-ios-19-app-development)). ONAY's deployment target is iOS 16.2 (gated by `MusicLibraryRequest` and Live Activities), so universal Liquid Glass adoption requires either a deployment-target bump or runtime `#available(iOS 26, *)` guards. **ONAY's roadmap keeps Liquid Glass as a planned progressive enhancement** — see MVP-3 and LT-2 below.
- **LLM stack:** ONAY uses **Gemini 2.5 Flash** as the script LLM with **Groq llama-3.3-70b-versatile** in the primary slot as of build 57+, and Ollama disabled in production (`OLLAMA_BASE_URL` unset triggers Gemini promotion). Not Claude. Provider failover happens inside the broadcast orchestrator so a transient Groq outage falls through to Gemini without surfacing to the client.

-----

## Part 4: ONAY's Actual Architecture — Reset for Recommendations

The original draft of this report optimized recommendations against an architecture ONAY does not have ("shared CDN segment library + per-listener real-time TTS via Replicate Chatterbox + Claude Sonnet scripts"). This section restates what ONAY actually is, so the recommendations in Parts 5–7 land correctly.

### Architecture in one paragraph

ONAY is a **per-user pre-baked broadcast pipeline**. The user picks a playlist + vibe + length (or describes a vibe in natural language via Ask ONAY). The server runs a deterministic track sequencer, builds a manifest (sparse-cadence segment slots), kicks off background enrichment + cold-open generation in parallel, returns the manifest with slot 0 ready (~11–19s on a 5-track episode), then fires-and-forgets background slot generation with a 4-worker pool. The client polls for pending slots, plays the locked episode beginning to end. **No LLM or TTS calls happen between tracks during playback.** When the bake completes, the episode is immutable.

### What's already shipped (don't re-recommend)

- **Pre-baked broadcast model** replacing the prior live-generation model that failed iOS's 48s/60s background CPU budget.
- **Single named female host (ONAY, "Ohnay")** with a voice bible hardcoded into `SegmentScriptBuilder.systemPrompt` — explicit she/her, forbids masculine DJ phrasing ("your boy," "the homie," "this guy"), self-references as ONAY/me/I, never as "the host" or "the listener."
- **Self-hosted TTS chain** — CosyVoice3 (primary) → F5-TTS (fallback) → Cartesia → ElevenLabs → Orpheus. Filesystem cache at `~/.cache/cleo-tts` dedupes identical text across bakes.
- **Apple Music exclusive** via custom `expo-music-kit` native module; iOS 16.2 deployment target.
- **Sparse-cadence tier system**: `cold_open / fact_bridge / tight_bridge / deep_dive / sign_off` with per-tier word budgets (35–120 words) in `TIER_SHAPES`. Transitions only before tracks at indices 2, 4, 6, …; tracks between transitions play back-to-back. Tier alternation `fact_bridge → tight_bridge`, with `featureSlots` overrides to `deep_dive`.
- **Deterministic vibe-curve sequencer** — 7 vibes × 7 audio features (tempo / energy / valence / danceability / acousticness / loudness / instrumentalness), 4-keyframe interpolation across the episode, top-K random pick from candidates via `mulberry32` seeded on `broadcastId`. Adjacency penalties (+0.15 same artist, +0.30 same album). LLM sequencer behind `SEQUENCER_MODE=llm` for rollback.
- **Feature-fetch ladder**: ReccoBeats (planned, ISRC-keyed) → Deezer (BPM+loudness) → Last.fm tags + genre synth → genre defaults → neutrals. `EnrichmentCache` keyed on normalized title|artist with 30-day re-enrichment.
- **Prompt-driven custom curation already shipped** — Ask ONAY screen (`AskOnayScreen` + `BroadcastCurationClient` + `PlaylistCurator`) lets users describe a vibe in chat; ONAY returns a curated playlist that can either be created in Apple Music or passed straight into a bake.
- **Featured / curator-published shared broadcasts** — `POST /broadcast/featured/publish` gated by `requireCurator` against `CURATOR_EMAILS`. These are the one place where multiple listeners hear the *same* manifest. Home renders `GET /broadcast/featured` as `FeaturedBroadcastCard`s.
- **3-screen onboarding** — welcome → music-auth → cleo-setup.
- **Crate Digger design system** — Anton (display) / Fraunces italic (liner-notes voice) / JetBrains Mono (labels) / oxblood + amber + warm-black palette / halftone overlays / sharp corners / no inline styles. All vibe surfaces unified on amber after the per-vibe color system was deleted (commit `d7193096`). Vibes shrank 12 → 7 (commit `9804f997`).
- **Production at `api.worthymedia.tech`** (Hostinger VPS, PM2 `cleo-broadcast`), Cloudflare R2 for segment audio (7-day presigned URLs), Firebase JWT auth.
- **Track-based monotonic progress bar**, `BroadcastResumer` for 24h resume window via MMKV, `BroadcastSegmentCache` in-memory base64.

### Implications for recommendations

1. **The stability pitch is even stronger** than the original draft claimed. Once a bake completes, the episode is locked; no failure surface during playback. Yoodio's "general bug fixes" and Radiant's "Emergency Fix" are both in the play-time critical path. ONAY's failure surface is bake-time only.
2. **Latency lives in the bake**, not per-track. Optimization target = "time to slot 0" (currently ~11–19s on a 5-track episode). Anything that improves bake latency is high-leverage; anything that improves between-track latency is moot because it's already zero.
3. **The structural cost moat is self-hosted TTS**, not CDN segment caching. Yoodio at Replicate's $0.003/inference is paying real money per listener. ONAY's marginal cost per inference is electricity on a single 6700XT. The trade-off: ONAY has a single point of failure (the LAN box at <TTS_HOST>) which the paid fallbacks (Cartesia/ElevenLabs/Orpheus) backstop.
4. **Featured / curator broadcasts are the natural shareable surface.** Per-user broadcasts are awkward to share (recipient has no entitlement); featured broadcasts are designed for it.
5. **Single-host architecture is hardcoded enough that adding hosts is non-trivial.** System prompt + reference audio + phonetic substitution rewrite + filesystem cache key all assume one host. Multi-host requires a coordinated change across the segment script builder, the CosyVoice/F5 reference upload, the cache key, and the documentation in CLAUDE.md.

-----

## Part 5: MVP Recommendations for ONAY (Weeks → 1 Month)

These are prioritized against the actual code state. Already-shipped items are listed in Part 4 and excluded here.

### MVP-1. Bake abort endpoint (`DELETE /broadcast/:id`)

- **WHY:** Already in CLAUDE.md "What's Left." When a user cancels mid-bake, ONAY still runs every queued LLM + TTS call to completion. On the free Gemini tier (20 RPM) and the LAN box (single-GPU), that's wasted time *and* pushes other users' bakes back. Cancel should propagate.
- **WHAT:** `DELETE /broadcast/:id` endpoint that flips a manifest status and signals running workers to short-circuit. `BroadcastOrchestrator.inFlight` map already exists; add an `aborted` flag checked between segment generations.
- **HOW:** Cooperative cancellation, not preemptive — let the in-flight TTS request finish (CosyVoice/F5 are blocking on the lock), then check abort before queuing the next. Mark all remaining slots `aborted` in the manifest, persist, and let the client drop the broadcast from history.
- **COMPETITIVE INSIGHT:** Yoodio's per-listener generation has the same problem at much higher cost; they have not shipped abort either. This is a small lift with real user-trust upside ("ONAY respects your time").

### MVP-2. Stability moat — make the architectural advantage visible

- **WHY:** Both incumbents wear visible reliability scars. ONAY's pre-baked architecture genuinely doesn't have a play-time failure surface, but no one knows that. Telemetry → App Store positioning → marketing.
- **WHAT:**
  - Per-bake telemetry to Sentry / Firebase Performance: time-to-slot-0, time-to-completion, per-provider TTS fallback depth (how often we drop from CosyVoice → F5 → Cartesia), drainNow API timing breakdown.
  - Threshold alerts: > N% bakes falling through to Cartesia (paid fallback = LAN box health degraded), > N% bakes exceeding budgeted time-to-slot-0.
  - Public-ish status indicator in app — "ONAY is operating normally" / "TTS provider is degraded" / "Bake queue is backed up" — sourced from server health endpoint.
- **HOW:** `BroadcastOrchestrator` already emits `[Sequencer]` telemetry; extend to a structured event stream consumed by Firebase Performance. Status indicator is a small client poll against a new `/health/public` endpoint.
- **COMPETITIVE INSIGHT:** Reframe App Store description around "the AI radio that doesn't break mid-song." Quote Yoodio's "vibe coded slop" review and Radiant's literal "Emergency Fix" release notes (without naming them) as the negative space ONAY occupies.

### MVP-3. Liquid Glass — phased adoption on iOS 26+ chrome surfaces

*Kept per explicit user direction; reframed against ONAY's iOS 16.2 deployment + Crate Digger system.*

- **WHY:** Yoodio adopted Liquid Glass in Oct 2025 (1.03.5). Apple's iOS 27 timeline makes Liquid Glass adoption effectively mandatory for "looks current" within ~12–18 months. ONAY launching without any Liquid Glass surfaces will read as a 2024 app to iOS 26 users.
- **CONSTRAINT:** Liquid Glass APIs (`liquidGlassMaterial`, the new `UIVisualEffectView` materials) are iOS 26+. ONAY's deployment target is iOS 16.2 (gated by `MusicLibraryRequest` + Live Activities). Crate Digger is the editorial design language and shouldn't be swapped wholesale.
- **WHAT:** **Progressive enhancement, not replacement.** Apply Liquid Glass on iOS 26+ devices to *chrome surfaces only*, while the editorial Crate Digger layer (cards, segment players, oxblood/amber stamps, halftone, Anton/Fraunces typography) stays untouched on the content layer.
  - Chrome candidates: `CustomTabBar`, `AppHeader`, `NowPlayingBar`, modal sheets (`SetupSheet`, `SettingsDrawer`, `PublishFeaturedSheet`), `OfflineBanner`.
  - Content surfaces stay Crate Digger: `FeaturedBroadcastCard`, `CatalogRow`, `LinerNotes`, `SleeveArt`, `SpinningRecord`, `StampButton`, `SectionMarker`.
- **HOW:**
  1. Add `iOS 26` `#available` runtime guards in chrome components. Apply `liquidGlassMaterial` (or the UIKit equivalent) on iOS 26+; fall back to current `BlurView`/`AM.bgDeep` patterns on iOS 25 and below.
  2. Test side-by-side on iOS 16.2 (lowest supported), iOS 18, iOS 26. Crate Digger should still feel coherent on all three.
  3. **Don't** bump deployment target to drop the fallbacks until ≥ ~70% of paying users are on iOS 26 (likely 12–18 months after iOS 26 release). Track via App Store Connect analytics.
- **COMPETITIVE INSIGHT:** Yoodio's Liquid Glass adoption is universal and effectively erases visual identity (which is why their station-cover regression to mesh gradients in 1.03.2 happened — they had nothing else holding the look together). ONAY can ship the iOS 26 "looks current" signal *and* keep the editorial Crate Digger differentiation. Best of both.

### MVP-4. Universal Link share-to-preview (featured broadcasts first)

- **WHY:** Yoodio shipped "station sharing" in 1.03.6 but recipient still has to regenerate the station per-listener (so the preview is generic). ONAY's featured/curator broadcasts have a literal shared manifest — same audio, same segments, every listener. That makes preview-without-install structurally cheaper than Yoodio can offer.
- **WHAT:** Universal link `onay.app/b/<broadcastId>` → marketing landing page that:
  - Plays the cold_open MP3 directly (already in R2 with a presigned URL).
  - Shows the first 3–5 tracks with cover art.
  - "Open in ONAY" CTA that deep-links into the broadcast on install.
  - Restrict to `userId === 'curator'` broadcasts initially. Per-user share is Phase 2.
- **HOW:** Universal Links + a static marketing page (could live on `worthymedia.tech` infra). Public read endpoint `GET /broadcast/:id/manifest?public=true` — bypasses the ownership gate only when manifest is curator-owned.
- **COMPETITIVE INSIGHT:** Preview-without-install is the growth-channel-shaped hole in both Yoodio and Radiant. ONAY's shared-manifest curator flow is the one place the architecture makes this trivial.

### MVP-5. Per-curator publish budget

- **WHY:** Already in CLAUDE.md "What's Left." Featured publish currently shares the global generation rate limiter; a runaway curator account could exhaust quota for everyone.
- **WHAT:** Cap featured publishes per curator email per day (e.g., 3/day). 429 with a clear error.
- **HOW:** Counter keyed on `req.uid` in the curator middleware; Redis or in-memory with TTL.
- **COMPETITIVE INSIGHT:** Internal hygiene, not user-facing — but ships before any abuse incident.

### MVP-6. CosyVoice systemd unit

- **WHY:** ~~Already in CLAUDE.md "What's Left." CosyVoice currently runs via `nohup` uvicorn on the LAN box; restarts are manual; if the process dies overnight no alert fires until the next bake hits the F5 fallback. Systemd unit is staged at `~/cosyvoice-server/cosyvoice.service` — install it.~~ **Resolved by #17:** `cosyvoice.service` is now installed and active on <TTS_HOST> with `Restart=on-failure`, journal logging, and auto-start on boot. The original concern — that the `nohup` invocation left no alert path if the process died — is closed.
- **WHAT:** `systemctl enable --now cosyvoice` on <TTS_HOST>. Restart-on-failure, journal logging, auto-start on boot.
- **HOW:** `systemctl link /home/kari/cosyvoice-server/cosyvoice.service`, then enable + start. Verify via `systemctl status cosyvoice`. ~~Add a simple cron-driven health check that pings `127.0.0.1:8001/healthz` every minute and writes a status file consumed by the public health indicator (MVP-2).~~ **Superseded by PR #21:** the public health indicator is fed by an in-process 30s loop on the Hostinger VPS (`server/src/providers/tts/index.ts` `HEALTH_CHECK_INTERVAL_MS`) that pings CosyVoice + F5 over the Pangolin tunnel. The in-process check catches both LAN-box-wedged and tunnel-down failures, so the cron + status-file component is no longer needed; see `docs/superpowers/specs/2026-04-24-onay-roadmap-design.md` Phase 1 item 4 for the amended architecture.
- **COMPETITIVE INSIGHT:** Pure ops; reduces P0 surface area. The LAN box is the structural cost moat; treat it like infrastructure.

### MVP-7. Onboarding "first-listen" demonstration

- **WHY:** Music Ally describes Radiant's gold-standard onboarding pattern: "Open Radiant, authorise its access to your Spotify account, and Rad — the virtual host — briefly introduces him or herself then plays a song that it knows you love." That moment is what made Radiant's onboarding sticky despite the buggy "What are you into?" step.
- **WHAT:** After music-auth succeeds, kick off a tiny test bake (3 tracks) using the user's most-played Apple Music playlist or a featured fallback. Have ONAY's cold open address the user by name. Drop them straight into playback when cleo-setup finishes.
- **HOW:** Background-trigger `POST /broadcast/create` from `(onboarding)/cleo-setup.tsx` with a small `length: 'quick'` request. By the time the user finishes the cleo-setup screen, slot 0 is ready and they hit play with no wait.
- **COMPETITIVE INSIGHT:** Yoodio's onboarding ends with "create a station and wait." Spotify's AI DJ already has a song queued for you. Match Spotify's bar.

### MVP-8. App Store positioning + pricing setup

- **WHY:** Yoodio's $0.99/mo is a tip jar that anchors "AI radio is worth nothing." Radiant has been free for 7 years and never shipped Rad.FM Plus. Both leave money on the table; both train users to expect free.
- **WHAT (launch):** Free download, no IAP. No StoreKit code yet. Lead with "ONAY: the AI radio that doesn't break" as primary App Store positioning. Screenshots emphasizing the editorial Crate Digger aesthetic + tier-style segment cadence + locked-episode reliability.
- **WHAT (Phase 2):** ONAY+ at **~$3.99/month or $29.99/year** when StoreKit ships (LT-3 below). Don't anchor on Yoodio.
- **HOW:** Write App Store copy now; defer subscription wiring to LT-3. Borrow Spotify's Premium framing — "AI DJ comes with the subscription" — at a deliberate undercut to Spotify Premium ($10.99) but a deliberate premium over Yoodio ($0.99).

-----

## Part 6: Long-Term Recommendations for ONAY (Months → 1 Year)

### LT-1. CarPlay (priority 1, months 3–4)

- **WHY:** Radio is driving music. Neither Yoodio nor Radiant ships CarPlay despite both having had years. ONAY's pre-baked model is *especially* well-suited to CarPlay because the episode is locked before playback starts — no LTE-flaky LLM calls between tracks when the car hits a tunnel or a low-signal bridge.
- **WHAT:** `com.apple.developer.carplay-audio` entitlement; `CPNowPlayingTemplate`-driven UI; lock-screen-class minimal interface (album art + episode title + a discreet "ONAY commentary in 2 tracks" hint above the scrubber).
- **HOW:**
  1. Apply for the CarPlay Audio entitlement (Apple review ~2 weeks).
  2. Add CarPlay scene + `CPListTemplate` for "Featured" + "Earlier Tonight" categories, both backed by existing endpoints.
  3. Wire `CPNowPlayingTemplate` to `BroadcastPlayer` state — currentTrackIndex, computeProgress(), per-tier indicator.
  4. Audio session discipline: CarPlay enforces stricter session ownership; verify `releaseAudioSession` call between segment and next track works on CarPlay (it should — same MusicKit handoff pattern).
- **COMPETITIVE INSIGHT:** Six-month lead time. Shipping CarPlay before either Radiant or Yoodio is a real moat — Radiant's user base is heavily commuter-radio-replacement and they still don't have it.

### LT-2. iOS 26 deployment-target bump + universal Liquid Glass

- **WHY:** Once iOS 26 adoption crosses ~70% of paying users (typically 12–18 months post-release), the Liquid Glass `#available` fallbacks (MVP-3) become dead code worth removing. At that point bump `IPHONEOS_DEPLOYMENT_TARGET` and apply Liquid Glass universally.
- **WHAT:** Bump deployment target from iOS 16.2 → iOS 26 (or iOS 27 if WWDC26 introduces relevant new APIs). Remove `#available` guards. Verify `MusicLibraryRequest` and ActivityKit still work as before (iOS 16.2 was the original gate; both APIs are still supported on later iOS).
- **HOW:** Edit `ios/ONAY.xcodeproj/project.pbxproj` `IPHONEOS_DEPLOYMENT_TARGET`; rebuild; smoke-test all surfaces. Document the change in CLAUDE.md.
- **COMPETITIVE INSIGHT:** Holds the line on visual identity through the iOS-26-becomes-mandatory moment; lets ONAY ship a clean Liquid Glass story without ever having broken older devices.

### LT-3. StoreKit 2 + ONAY+ subscription

- **WHY:** Apple Music users are already paying ~$10.99/mo for music; an extra $3.99 for "the radio host on top" is plausible if it gates real value. Yoodio's $0.99 is a tip jar; Radiant has been free for 7 years. Both are evidence that pricing is hard *and* that nobody has solved it yet.
- **WHAT:** Single SKU at **$3.99/mo or $29.99/yr** with a 7-day free trial. No tiers at launch. Gates:
  - Faster bake queue (priority lane in `BroadcastOrchestrator`)
  - `length: 'long'` only for ONAY+ (free tier capped at quick/standard)
  - Replay last segment ("hey, what did ONAY just say about that song?")
  - Multiple host voices once shipped (LT-4)
- **WHAT NOT TO GATE:** core listening, basic vibes, basic playlist sources, featured broadcasts. Conversion comes from "want it to be better," not "want it to work."
- **HOW:** StoreKit 2 with on-device receipt validation; entitlement signal to server via a Firebase custom claim (`onay_plus: true`). `BroadcastOrchestrator` reads claim from `req.user` to choose priority queue + length cap. No server-side IAP receipt validation in v1 — Firebase claim is the trust boundary.
- **COMPETITIVE INSIGHT:** Spotify's DJ X is gated behind Premium ($10.99+), so users are conditioned to "AI DJ is part of a paid bundle." $3.99 says "premium feature, premium price" without overcommitting.

### LT-4. Multiple hosts as personality archetypes

- **WHY:** Yoodio's "1,000+ personalities" is procedural recombination; reviewers don't connect to specific hosts. Radiant's single-host approach is warm but limited. The right answer is **2–3 named, voice-actor-licensed hosts**, each with:
  - Distinct voice clone reference (`*.wav` + `*.txt` per host)
  - Personality bible in a host-specific system-prompt fragment
  - Genre / time-of-day affinities (e.g., M counterpart for morning energy, ONAY for late-night chill, a third for indie deep-dives)
- **WHAT:** Generalize the single-host hardcode into a `host` parameter throughout the pipeline.
- **HOW:**
  1. Generalize `SegmentScriptBuilder.systemPrompt` to take a `host` config — different name, different reference clip, different voice rules. The current "ONAY (Ohnay)" / female / phonetic substitution becomes the default `host: 'onay'` configuration.
  2. Update `preprocessForTTS` phonetic substitutions to be host-aware (the `\bONAY\b → Ohnay` rewrite must update in lockstep when adding a host — this is in CLAUDE.md as a constraint).
  3. Voice actor session per new host (~$300–800 via Voices.com); contract for AI-cloning rights explicitly. Bank ~5 minutes of high-quality reference audio per actor.
  4. Filesystem TTS cache key becomes `(text, host_id)` instead of `(text)`.
  5. Host preference per user OR per station — likely tied to ONAY+ tier (free users always get ONAY; ONAY+ unlocks others).
- **CONSTRAINT TO RESPECT:** the system prompt's "ONAY" name + Ohnay phonetic + reference audio + cache key must update **as a single coordinated change**. Per CLAUDE.md: "If the host is ever renamed, update the regex, system prompt hint, and reference transcript in lockstep."
- **COMPETITIVE INSIGHT:** Three voice-actor-licensed hosts beats a thousand procedural ones. But ONAY's single-host moat is meaningful — only break it when you can keep all hosts at the current quality level.

### LT-5. Weather + minimal time-of-day awareness

- **WHY:** Radiant's news+weather+traffic combo is its most-loved feature *and* its biggest failure surface. Weather alone is the lowest-risk subset.
- **WHAT:** Single weather mention near `cold_open`, optionally a sign_off variation if temp/precipitation crosses a threshold mid-session. **No news. No traffic. No local-business shoutouts.**
- **HOW:**
  1. Free OpenWeatherMap; client passes `latitude/longitude` (or city) into `POST /broadcast/create` `userContext`.
  2. `SegmentScriptBuilder` cold_open prompt gets an optional `weatherHint` slot ("It's 47 and drizzling in your zip code"). The filesystem TTS cache will dedupe identical phrasing across listeners in the same city/condition.
  3. Strict guard: only one weather reference per episode; off by default in user prefs (opt-in).
- **COMPETITIVE INSIGHT:** Radiant's killer combo is also its biggest engineering surface. Ship weather only; the narrative win — "ONAY actually works" — beats feature parity.

### LT-6. ReccoBeats audio-features integration (pull forward from roadmap)

- **WHY:** Already on the roadmap; mentioned in `reference_reccobeats_api.md` and `project_playlist_algorithm_redesign.md`. The "identical-order-across-vibes" bug that motivated the playlist algorithm redesign branch is the strongest argument for shipping this sooner.
- **WHAT:** Plug ReccoBeats into the `FeatureFetchChain` ladder (currently: Deezer → Last.fm → genre defaults → neutrals). Becomes new chain top: ReccoBeats (ISRC) → Deezer → Last.fm → defaults → neutrals.
- **HOW:** `BackgroundEnricher.drainNow` already serializes per-API at 1.1s; ReccoBeats slots in cleanly. Track richness telemetry in `[Sequencer]` log.
- **COMPETITIVE INSIGHT:** Radiant's recommendation pipeline relies on MetaBrainz datasets (BPM + valence + modality) — ONAY's ReccoBeats path is the modern equivalent and gets us to feature parity on the curation algorithm.

### LT-7. User-facing Last.fm scrobble

- **WHY:** Both Yoodio (1.03.5) and Radiant (3.0.16) ship Last.fm scrobbling. It's a table-stakes feature for the audiophile/curator user demographic. ONAY currently uses Last.fm *server-side for enrichment* (genre + tags via `LastFmFetcher`) but does NOT scrobble user listens.
- **WHAT:** User opts in via Profile screen, links Last.fm account via OAuth. Every track played by `MusicKitPlayer.play([trackId])` emits a `track.scrobble` event to Last.fm.
- **HOW:**
  1. Last.fm OAuth flow on `ProfileScreen` (token storage in Firestore per user, never in MMKV).
  2. Server-side scrobble worker that consumes a per-user queue of "now playing" + "scrobble" events from the client.
  3. Distinguish from existing server-side enrichment use — different keys, different rate limits, never auto-scrobble unless the user opted in.
- **COMPETITIVE INSIGHT:** Cheap to add (Last.fm SDK + OAuth are already integrated server-side for enrichment). Closes a known gap with both incumbents.

### LT-8. Voice cloning for ONAY Pro tier

- **WHY:** CosyVoice and F5-TTS already do zero-shot voice cloning from ~5–10s of reference audio. The tech is in the stack; the UX surface isn't. Neither Yoodio nor Radiant offers user-uploaded voice cloning. This is a defensible Pro-tier feature.
- **WHAT:** ONAY Pro ($9.99/mo, second tier above ONAY+) lets a user upload 30s of their own (or a friend's, with consent) voice; ONAY plays back personal-station bakes using that voice. **Personal stations only — never shared, never used in featured/curator broadcasts.**
- **HOW:**
  1. New endpoint `POST /voice-clone/upload` — store reference audio in R2 keyed on userId.
  2. `BroadcastOrchestrator.create` accepts optional `customVoiceId`; routes that bake's TTS to the custom reference instead of the default `onay-cartesia.wav`.
  3. Hard guard: `customVoiceId` rejected when `userId === 'curator'` (no custom voices in featured broadcasts).
  4. Consent + biometric challenge ("read this challenge phrase") before saving — prevents trivially uploading someone else's voice.
- **CONSTRAINT:** F5/CosyVoice are not legally watermarked the way Chatterbox claims (Perth watermark). Add explicit ToS clauses; consider Perth-equivalent watermarking before shipping. Hold this until at least one paid host (LT-4) is shipping smoothly — the legal surface is real.
- **COMPETITIVE INSIGHT:** Spotify won't ship this because of label politics. Yoodio and Radiant don't have the TTS stack for it. Genuinely defensible Pro feature.

### LT-9. Featured discovery feed + collaborative episodes

- **WHY:** Featured broadcasts already exist as a shared-manifest surface. Today they're a single home-screen rail. Lifting them into a real discovery surface — and adding multi-curator authorship — is where ONAY's architecture pays dividends Yoodio cannot copy.
- **WHAT (priority order):**
  1. **Public discovery feed** — dedicated tab listing all `userId === 'curator'` broadcasts. Heart, save, follow-curator.
  2. **Collaborative episodes** — multiple curators co-author a single featured broadcast. Track-list contributions; sign_off shouts out contributors by curator handle.
  3. **Friends activity** ("Bakari is listening to 'Late Night Drive Vol. 3'") — Spotify-like presence, opt-in.
- **HOW:**
  1. Extend `FeaturedBroadcastRegistry` schema to include `coAuthors: string[]` and a `featuredAt: timestamp` for the discovery feed sort.
  2. Discovery feed is a pageable query against the registry; current `GET /broadcast/featured` is the unpaginated v1.
  3. Collaborative is a multi-author manifest; `requireCurator` extends to verify all listed authors are in `CURATOR_EMAILS`.
- **COMPETITIVE INSIGHT:** Yoodio cannot easily ship collaborative stations because each station is per-user-generative. ONAY's manifests are already shared assets for curators — just attach multiple authors.

### LT-10. Platform expansion (sequenced)

1. **CarPlay** (LT-1, months 3–4) — done first.
2. **iPad polish** — already inherited; treat as a real surface (Yoodio doesn't).
3. **macOS Catalyst** (months 6–8) — leverage MusicKit on macOS; Calum Webb's Product Hunt comment shows Radiant users do this on M1/M2 Macs.
4. **Web preview / shareable landing pages** (months 9–12) — extension of MVP-4. MusicKit on the Web exists for Apple Music.
5. **Android** — post-1-year, only with revenue or a co-founder. MusicKit for Android exists but the React Native + Swift native module split makes Android porting non-trivial.
6. **Wear OS / Apple Watch / Vision Pro** — all later. Vision Pro inherits via universal binary.

### LT-11. Differentiation framing vs Yoodio, Radiant, Spotify DJ, YouTube Music

| Axis | Yoodio | Radiant | Spotify DJ | YouTube Music | **ONAY's edge** |
|------|--------|---------|------------|---------------|----------------|
| Custom station prompts | ✅ flagship | ❌ | ⚠️ via chat | ⚠️ via Conversational Radio | ✅ Ask ONAY shipped |
| Multiple host personas | ✅ but generic | ❌ (1) | ❌ (1) | ✅ (2 hosts) | ⏳ Phase 2 — voice-actor-licensed |
| News/weather/traffic | ✅ all 3 | ✅ all 3 (buggy) | ❌ | ❌ | ⚠️ weather only at LT-5 (deliberate) |
| Apple Music | ⚠️ partial | ✅ exclusive | ❌ | ❌ | ✅ first-class via expo-music-kit |
| Spotify | ✅ partial/historical | ❌ dropped | ✅ native | ❌ | ❌ deliberate non-goal |
| CarPlay | ❌ | ❌ | ✅ | ⚠️ | ✅ ship in 6 months (LT-1) |
| Last.fm scrobbling (user) | ✅ | ✅ | ❌ | ❌ | ⏳ LT-7 |
| Liquid Glass | ✅ universal | ❌ | n/a | n/a | ⏳ phased iOS 26+ chrome (MVP-3 → LT-2) |
| Stability at play time | ⚠️ "general bug fixes" monthly | ❌ "Emergency Fix" | ✅ | ⚠️ early Labs | ✅ pre-baked model = no play-time failure surface |
| Per-listener compute cost | ❌ Replicate $/inference | ⚠️ moderate | ✅ low (scale) | ✅ low (scale) | ✅ self-hosted F5/CosyVoice ≈ electricity |
| Collaborative stations | ❌ | ❌ | ❌ | ❌ | ⏳ LT-9 (only ONAY can ship) |
| Voice clone (yours) | ❌ | ❌ | ❌ | ❌ | ⏳ LT-8 (CosyVoice/F5 already in stack) |
| Editorial design system | ⚠️ generic Liquid Glass | ❌ unremarkable | n/a | n/a | ✅ Crate Digger |

**Defensible long-term ONAY positioning:** *"The only Apple-Music-native AI radio with bake-then-lock reliability, CarPlay-first, that doesn't break."* Reliability is the most undersold competitive axis in this category — Radiant's "Emergency Fix" releases and Yoodio's "vibe coded slop" review are both stability indictments rooted in their architectures (Radiant: brittle live scraping; Yoodio: per-listener live generation). ONAY's pre-baked-then-locked architecture is the structural answer.

-----

## Part 7: Solo-Developer Caveats (Updated)

- **The pre-baked model is your real moat, not "shared CDN segments."** Reframe internally: ONAY isn't "an AI radio host" — it's "a bake-once-then-lock broadcast pipeline that doesn't degrade under flaky cellular or LLM provider outages." Yoodio (live per-listener) and Radiant (live news/traffic scraping) cannot copy this without architectural rebuilds.
- **Self-hosted TTS is your structural cost moat — and your single point of failure.** Yoodio is paying real $/inference at Replicate; ONAY is paying electricity on the LAN box. As the user base grows, that gap widens. But it also means: ONAY's stability depends on <TTS_HOST> staying up. Build redundancy (Cartesia/ElevenLabs paid fallback already wired) before hitting scale; ship the systemd unit (MVP-6); add the public health indicator (MVP-2).
- **Don't take on real-time news in v1 or v2.** Quinn's Kill the DJ interview is a confession: news/traffic integrations are the brittle part. Defer indefinitely; ship weather only when you do (LT-5).
- **Don't replicate Yoodio's "1,000+ personalities."** It's procedural recombination; reviewers don't believe it. 2–3 voice-actor-licensed hosts (LT-4) beat a thousand procedural ones.
- **Liquid Glass adoption is important on iOS 26+ devices** but ONAY's iOS 16.2 deployment target requires phasing it in as runtime-guarded progressive enhancement (MVP-3) until ~70% of paying users are on iOS 26 (LT-2). Don't trash the Crate Digger aesthetic on iOS 16–25 to chase the iOS 26 look — guard with `#available`.
- **Don't underprice when StoreKit ships.** Yoodio at $9.99/year is a cautionary anchor. $3.99/month gives a real revenue line and signals "premium feature," not "tip jar."
- **Spotify support is a Phase 3+ trap.** Quinn lost years to Spotify's commercial approval; Yoodio's beta was capped at 25 users. Apple Music is the path of least resistance for a solo dev — and `expo-music-kit` already covers every native binding you'd need to add for CarPlay (LT-1).
- **Stack you already have is correct.** Gemini 2.5 Flash + Groq llama-3.3-70b for scripts (cheap, fast), self-hosted F5/CosyVoice for TTS (cost moat), Apple Music via MusicKit (no Spotify approval gauntlet), Firebase JWT auth. This is the right indie-dev configuration. Don't get talked into adding Claude or Replicate for parity with what people *think* you should be using.
- **Three places where you should ship before either competitor:** CarPlay (LT-1), paid voice cloning for Pro tier (LT-8), collaborative featured episodes (LT-9). Each leverages something only your architecture provides.
- **Ask ONAY is already a competitive feature** — don't bury it. Yoodio's "describe your station" prompt is its #1 differentiator; ONAY has the same surface (prompt-driven curation via the Ask ONAY screen) but less marketing emphasis. Treat Ask ONAY as a tier-1 feature in onboarding + App Store screenshots.
- **The featured/curator flow is your shareable surface.** Per-user broadcasts are private and ephemeral; featured broadcasts have a stable manifest, public read, and are designed to be linked to. That's where Universal Links (MVP-4), discovery feed (LT-9), and preview-without-install all converge.

-----

The single most actionable insight from this research, restated against ONAY's actual architecture: **ship the "doesn't break" pitch as the primary App Store positioning.** Both incumbents wear visible reliability scars (Radiant's "Emergency Fix" releases, Yoodio's "vibe coded slop" review), and the underlying reasons — live per-listener generation in Yoodio's case, brittle third-party scraping in Radiant's case — are exactly what ONAY's pre-baked-then-locked architecture solves. Lead with that in App Store copy, lead with that on `worthymedia.tech`, lead with that when introducing ONAY to anyone who's tried the alternatives.
