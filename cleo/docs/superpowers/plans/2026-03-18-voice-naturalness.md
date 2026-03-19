# Voice Naturalness Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cleo's voice delivery more natural by upgrading the ElevenLabs model, tuning voice settings, adding prosody-aware text formatting, and updating the system prompt.

**Architecture:** Four focused changes across the TTS backend (model + fallback), client-side text processor (sentence splitting + breath marks), and AI prompt (cadence rules). No architectural changes — just tuning the existing pipeline.

**Tech Stack:** ElevenLabs API (`eleven_multilingual_v2`), TypeScript, Node.js/Express

**Spec:** `docs/superpowers/specs/2026-03-18-voice-naturalness-design.md`

---

### Task 1: Update ElevenLabs Model, Voice Settings, and Timeout Fallback

**Files:**
- Modify: `server/src/routes/voice.ts`

This task replaces the existing direct ElevenLabs fetch call with a helper function that supports model fallback on timeout.

- [ ] **Step 1: Add the callElevenLabs helper function**

Above the route handler (before `voiceRouter.post`), add:

```typescript
async function callElevenLabs(
  text: string,
  modelId: string,
  apiKey: string,
  voiceId: string,
  timeoutMs: number,
  pronunciationConfig?: object[]
): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability: 0.35,
            similarity_boost: 0.80,
            style: 0.55,
            use_speaker_boost: true,
          },
          pronunciation_dictionary_locators: pronunciationConfig,
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs ${response.status}: ${error}`);
    }

    return await response.arrayBuffer();
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 2: Replace the route handler body**

Replace the entire body of the `voiceRouter.post('/synthesize-voice', ...)` handler with:

```typescript
voiceRouter.post('/synthesize-voice', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    const wordCount = text?.split(/\s+/).length ?? 0;
    console.log(`[TTS] Received ${wordCount} words (${text?.length ?? 0} chars): "${text?.substring(0, 100)}..."`);

    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;

    if (!apiKey || !voiceId) {
      res.status(500).json({ error: 'ElevenLabs not configured' });
      return;
    }

    const pronunciationConfig = process.env.ELEVENLABS_PRONUNCIATION_DICT_ID ? [
      {
        pronunciation_dictionary_id: process.env.ELEVENLABS_PRONUNCIATION_DICT_ID,
        version_id: process.env.ELEVENLABS_PRONUNCIATION_DICT_VERSION,
      },
    ] : undefined;

    let arrayBuffer: ArrayBuffer;
    let modelUsed = 'eleven_multilingual_v2';

    try {
      arrayBuffer = await callElevenLabs(text, 'eleven_multilingual_v2', apiKey, voiceId, 10000, pronunciationConfig);
    } catch (primaryError: any) {
      if (primaryError.name === 'AbortError') {
        console.warn(`[TTS] Fallback: eleven_multilingual_v2 timed out (10s), retrying with turbo_v2_5`);
      } else {
        console.warn(`[TTS] Fallback: eleven_multilingual_v2 failed (${primaryError.message}), retrying with turbo_v2_5`);
      }
      modelUsed = 'eleven_turbo_v2_5 (fallback)';
      arrayBuffer = await callElevenLabs(text, 'eleven_turbo_v2_5', apiKey, voiceId, 8000, pronunciationConfig);
    }

    const audioSizeKB = Math.round(arrayBuffer.byteLength / 1024);
    const estimatedDurationS = Math.round(arrayBuffer.byteLength / 16000);
    console.log(`[TTS] Model: ${modelUsed} | Audio: ${audioSizeKB}KB (~${estimatedDurationS}s), ${wordCount} words`);
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');

    res.json({ audioContent: base64Audio });
  } catch (error) {
    console.error('Voice synthesis error:', error);
    res.status(500).json({ error: 'Failed to synthesize voice' });
  }
});
```

Note: The outer try/catch handles the case where both the primary and fallback calls fail. `CleoVoiceEngine.ts` already handles 500 responses silently (Cleo just doesn't speak), which is acceptable.

- [ ] **Step 3: Test manually**

Run the server: `cd server && npm run dev`

```bash
curl -X POST http://localhost:3001/synthesize-voice \
  -H "Content-Type: application/json" \
  -d '{"text": "That bassline carries the whole track. Listen closely."}'
```

Expected: 200 response with `audioContent`. Server log should show `[TTS] Model: eleven_multilingual_v2`.

To verify fallback: temporarily set primary timeout to `1` (1ms), send a request. Log should show `[TTS] Fallback:` followed by `[TTS] Model: eleven_turbo_v2_5 (fallback)`. Restore to `10000` after.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/voice.ts
git commit -m "feat: switch to eleven_multilingual_v2 with tuned settings and turbo fallback

Model: turbo_v2_5 → multilingual_v2, stability 0.15→0.35, style 0.40→0.55.
10s primary timeout with automatic turbo_v2_5 fallback (8s timeout)."
```

---

### Task 2: Upgrade formatForSpeech() for Prosody

**Files:**
- Modify: `src/services/CleoVoiceEngine.ts` — replace the `formatForSpeech` function (lines 1-24, everything above `synthesizeAndPlay`)

- [ ] **Step 1: Replace formatForSpeech and add helper functions**

Replace lines 4-24 (the JSDoc comment and `formatForSpeech` function) with the following. Leave the import on line 1 and the `synthesizeAndPlay` function unchanged.

```typescript
/**
 * Post-process Gemini output for natural ElevenLabs delivery.
 *
 * 1. Strips quotes and stage directions
 * 2. Splits long sentences at natural clause boundaries
 * 3. Adds breath marks (em-dashes, ellipses) between complete thoughts
 *
 * Artist name pronunciation is handled server-side via ElevenLabs
 * Pronunciation Dictionary (ID: Tz7qFxqqoRQ7cvPkOlof).
 */

// No `g` flag — these are used with .test() and must not maintain lastIndex state
const ABBREVIATIONS = /\b(?:feat|vs|Dr|Mr|Mrs|Ms|Jr|Sr|St)\./i;
const SINGLE_INITIAL = /\b[A-Z]\./;

function isAbbreviationOrInitial(text: string, periodIndex: number): boolean {
  const before = text.substring(Math.max(0, periodIndex - 5), periodIndex + 1);
  return ABBREVIATIONS.test(before) || SINGLE_INITIAL.test(before);
}

function splitLongSentence(sentence: string): string[] {
  const words = sentence.split(/\s+/);
  if (words.length <= 15) return [sentence];

  // Strategy 1: Split at "comma + conjunction" — e.g. "carries the whole track, and if you..."
  const commaConjunction = sentence.match(/^(.{20,}?,)\s+(and|but|so|or)\s+(.+)$/i);
  if (commaConjunction) {
    const before = commaConjunction[1].replace(/,$/, '');
    const conjunction = commaConjunction[2];
    const after = commaConjunction[3];
    if (before.split(/\s+/).length >= 4) {
      return [before + '.', conjunction.charAt(0).toUpperCase() + conjunction.slice(1) + ' ' + after];
    }
  }

  // Strategy 2: Split at a bare conjunction (no comma) if sentence is long enough
  const conjunctionOnly = sentence.match(/^((?:\S+\s+){4,}?\S+)\s+(and|but|so|or)\s+(.+)$/i);
  if (conjunctionOnly && conjunctionOnly[1].split(/\s+/).length >= 5) {
    return [conjunctionOnly[1] + ' —', conjunctionOnly[3]];
  }

  // Strategy 3: Split at a comma with 4+ words before it
  const commaMatch = sentence.match(/^((?:\S+\s+){3,}\S+,)\s+(.+)$/);
  if (commaMatch) {
    return [commaMatch[1].replace(/,$/, '') + ' —', commaMatch[2]];
  }

  return [sentence];
}

function addBreathMarks(sentences: string[]): string {
  if (sentences.length <= 1) return sentences.join(' ');

  return sentences.map((s, i) => {
    if (i === sentences.length - 1) return s;
    // Short fragments (1-3 words) — natural emphasis points, leave as-is
    if (s.split(/\s+/).length <= 3) return s;
    // Sentences ending with em-dash already have a pause cue
    if (s.endsWith('—')) return s;
    // Sentences ending with period — add an ellipsis beat on ~every other one
    if (s.endsWith('.') && i % 2 === 0) {
      return s.slice(0, -1) + '...';
    }
    return s;
  }).join(' ');
}

function formatForSpeech(text: string): string {
  let processed = text
    // Remove any stray quotation marks
    .replace(/["""]/g, '')
    // Remove stage directions like (pause) or [beat]
    .replace(/[\(\[][^\)\]]{0,40}[\)\]]/g, '')
    // Comma before "and/but/so" at clause boundary → em-dash for stronger pause
    .replace(/, (and|but|so) /g, ' — $1 ')
    // Clean up any double spaces
    .replace(/  +/g, ' ')
    .trim();

  // Split into sentences, preserving abbreviations and initials
  const sentences: string[] = [];
  let current = '';
  for (let i = 0; i < processed.length; i++) {
    current += processed[i];
    if (processed[i] === '.' || processed[i] === '!' || processed[i] === '?') {
      if (processed[i] === '.' && isAbbreviationOrInitial(processed, i)) {
        continue;
      }
      if (i === processed.length - 1 || processed[i + 1] === ' ') {
        sentences.push(current.trim());
        current = '';
      }
    }
  }
  if (current.trim()) sentences.push(current.trim());

  // Split long sentences and add breath marks
  const split = sentences.flatMap(s => splitLongSentence(s));
  return addBreathMarks(split);
}
```

Key differences from the original:
- **Keeps the existing comma-to-em-dash transform** (`, and` → `— and`) from the current code
- **No `g` flag on regex constants** — avoids `.test()` statefulness bug
- **Three split strategies** — comma+conjunction, bare conjunction (no comma required), comma-only
- **`addBreathMarks` actually injects pauses** — converts `.` to `...` on alternating longer sentences, preserves em-dashes already placed by splitting

- [ ] **Step 2: Verify with mental test cases**

- `"Earth, Wind & Fire changed everything"` — comma at word 1, no split (< 15 words anyway). Correct.
- `"J. Cole dropped this in 2014"` — `isAbbreviationOrInitial` matches single initial `J.`, no false sentence break. Correct.
- `"That bassline carries the whole track and if you listen closely you can hear the original sample"` — 17 words, no comma, hits Strategy 2 (bare conjunction split at "and"). Produces: `"That bassline carries the whole track —"` + `"if you listen closely you can hear the original sample"`. Correct.
- `"Dr. Dre produced this feat. Snoop"` — both `Dr.` and `feat.` matched by `ABBREVIATIONS`, no false breaks. Correct.

- [ ] **Step 3: Test on device**

Build and run the app. Let a track change trigger Cleo. Check the `[CleoVoice] Sending X words` log — the formatted text should show em-dashes and ellipses at clause boundaries.

- [ ] **Step 4: Commit**

```bash
git add src/services/CleoVoiceEngine.ts
git commit -m "feat: upgrade formatForSpeech with sentence splitting and breath marks

Splits sentences >15 words at clause boundaries (conjunction, comma).
Adds ellipsis and em-dash prosody cues. Handles abbreviations and
artist names. Keeps existing comma-conjunction em-dash transform."
```

---

### Task 3: Add Cadence Rules to System Prompt

**Files:**
- Modify: `src/cleo/static-core.ts`

- [ ] **Step 1: Add two rules to VOICE RULES**

In `static-core.ts`, add these two lines after the existing rule on line 16 (`- Never start two consecutive segments with the same word or structure.`):

```
- Vary sentence length deliberately. Mix 3-word fragments with longer thoughts. Never write three sentences of similar length in a row.
- Write for breath. Each sentence should be speakable in one natural breath. If you would need to pause mid-sentence to breathe, it is too long.
```

The full VOICE RULES block should now read:

```
VOICE RULES
- Speak in short, natural sentences. No run-ons.
- Never sound like you are reading. Sound like you just thought of it.
- Use occasional dry humor — never forced, never corny.
- Let words breathe. Unhurried pace.
- Warm but not soft. Confident but never arrogant.
- Never use filler phrases like "Absolutely!" or "Great choice!"
- Never start two consecutive segments with the same word or structure.
- Vary sentence length deliberately. Mix 3-word fragments with longer thoughts. Never write three sentences of similar length in a row.
- Write for breath. Each sentence should be speakable in one natural breath. If you would need to pause mid-sentence to breathe, it is too long.
```

- [ ] **Step 2: Test by triggering a segment**

Run the app, let a track change fire. Check the Gemini response in the server log. Look for more varied sentence lengths — fragments mixed with longer sentences.

- [ ] **Step 3: Commit**

```bash
git add src/cleo/static-core.ts
git commit -m "feat: add cadence rules to Cleo system prompt

Encourages varied sentence length and breath-friendly writing for
better TTS prosody on longer segments."
```

---

### Task 4: Update CLAUDE.md Conventions

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Important Conventions section**

Find the line in the Important Conventions section:
```
- ElevenLabs: `eleven_turbo_v2_5` model with low stability (0.15) for natural inflection
```

Replace with:
```
- ElevenLabs: `eleven_multilingual_v2` model (stability 0.35, style 0.55) with turbo_v2_5 fallback on timeout
```

- [ ] **Step 2: Update the What's Built section**

Find the line in the What's Built section:
```
- ElevenLabs voice tuning: `eleven_turbo_v2_5` model, stability 0.15, style 0.40
```

Replace with:
```
- ElevenLabs voice tuning: `eleven_multilingual_v2` model, stability 0.35, style 0.55, turbo fallback
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md ElevenLabs convention to reflect model change"
```

---

### Task 5: End-to-End Listening Test

- [ ] **Step 1: Start the server**

```bash
cd server && npm run dev
```

- [ ] **Step 2: Run the app on device**

Build and run on a physical iOS device. Let a playlist play through 3-4 track changes.

- [ ] **Step 3: Listen for improvements**

Check for:
- Longer segments (40-75 words): Does she vary speed and emphasis now?
- Short vs long segments: Is quality more consistent across lengths?
- Emotional moments: Does she sound more engaged on track stories vs station IDs?
- Latency: Is the delay before she speaks noticeably longer? Check server logs for `[TTS] Model:` — if `(fallback)` appears frequently, may need to adjust timeout.

- [ ] **Step 4: If multilingual_v2 latency is unacceptable**

If the turbo fallback is firing on >30% of requests (check logs), increase the primary timeout from 10s to 12s. If latency is still unacceptable even when multilingual_v2 succeeds, revert to `eleven_turbo_v2_5` as the primary model but keep the tuned voice settings (stability 0.35, style 0.55) — those improvements apply to any model.
