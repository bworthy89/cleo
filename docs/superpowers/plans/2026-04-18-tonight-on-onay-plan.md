# Tonight on ONAY Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing "Tonight on ONAY" home-screen section into a two-slot editorial grid (Morning + Evening) with a curator-driven publish flow that rides on the existing `/broadcast/featured/publish` endpoint.

**Architecture:** A mirrored theme library (client + server) with 14 day-of-week × slot entries. The existing publish endpoint grows two optional fields (`slot`, `themeDay`) with tight validation. `AskOnayScreen` swaps its `Alert.prompt` for a new `PublishFeaturedSheet` with three selectable tiles (Free-form / Morning / Evening). `HomeBroadcastScreen` drops its hero+rail pattern for a twin-slot stack with a `SlotPlaceholderCard` when a slot is empty, plus a "More from ONAY" rail for legacy records.

**Tech Stack:** React Native (Expo SDK 55) + TypeScript, Express + Zod on the server, Jest + ts-jest on both sides. Design tokens from `src/tokens/design-tokens.ts` (`AM`, `Fonts`, `TypeScale`, `Space`, `AMGlow`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-18-tonight-on-onay-design.md`

---

## Task 1: Theme Library — Server

**Files:**
- Create: `server/src/config/tonightOnOnay.ts`
- Create: `server/__tests__/config/tonightOnOnay.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/config/tonightOnOnay.test.ts`:

```ts
import {
  SLOT_THEMES,
  getThemeFor,
  type SlotKey,
  type DayOfWeek,
} from '@/config/tonightOnOnay';

describe('tonightOnOnay theme library', () => {
  it('has exactly 14 entries — one per (day × slot)', () => {
    expect(SLOT_THEMES).toHaveLength(14);
  });

  it('has one entry for every (slot, day) pair with no duplicates', () => {
    const slots: SlotKey[] = ['morning', 'evening'];
    const days: DayOfWeek[] = ['mon','tue','wed','thu','fri','sat','sun'];
    const seen = new Set<string>();
    for (const s of slots) for (const d of days) {
      const key = `${s}:${d}`;
      const match = SLOT_THEMES.filter(t => t.slot === s && t.day === d);
      expect(match).toHaveLength(1);
      seen.add(key);
    }
    expect(seen.size).toBe(14);
  });

  it('getThemeFor returns the right entry', () => {
    const t = getThemeFor('morning', 'tue');
    expect(t.slot).toBe('morning');
    expect(t.day).toBe('tue');
    expect(typeof t.title).toBe('string');
    expect(t.title.length).toBeGreaterThan(0);
  });

  it('every entry has a valid vibe and length', () => {
    const vibes = new Set(['morning','focus','workout','feelGood','lateNight','melancholy','party']);
    const lengths = new Set(['quick','standard','long']);
    for (const t of SLOT_THEMES) {
      expect(vibes.has(t.vibe)).toBe(true);
      expect(lengths.has(t.length)).toBe(true);
      expect(t.title.length).toBeLessThanOrEqual(120);
      expect(t.description.length).toBeLessThanOrEqual(400);
    }
  });
});
```

- [ ] **Step 2: Run test, expect compile fail**

Run: `cd server && npm test -- tonightOnOnay`
Expected: FAIL — cannot resolve `@/config/tonightOnOnay`.

- [ ] **Step 3: Create the theme library**

Create `server/src/config/tonightOnOnay.ts`:

```ts
import type { Manifest } from '../services/broadcast/types';

export type SlotKey = 'morning' | 'evening';
export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface SlotTheme {
  slot: SlotKey;
  day: DayOfWeek;
  title: string;
  description: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
}

// v1 placeholder schedule — curator will tune copy before shipping.
// Keeps the grid functionally complete (14 entries, valid vibes/lengths).
export const SLOT_THEMES: SlotTheme[] = [
  // ── Morning slots ──────────────────────────────────────────────
  { slot: 'morning', day: 'mon', title: 'Monday Reset',       description: 'Slow start. Coffee first, noise later.',        vibe: 'morning',   length: 'standard' },
  { slot: 'morning', day: 'tue', title: 'Throwback Tuesday',  description: 'Old favorites to dust off the week.',            vibe: 'feelGood',  length: 'standard' },
  { slot: 'morning', day: 'wed', title: 'Midweek Lift',       description: 'Enough momentum to get over the hump.',          vibe: 'feelGood',  length: 'quick'    },
  { slot: 'morning', day: 'thu', title: 'Thursday Flow',      description: 'Focus music for the part of the week that ships.', vibe: 'focus',  length: 'standard' },
  { slot: 'morning', day: 'fri', title: 'Friday Warmup',      description: 'A shoulder-roll before the weekend starts.',     vibe: 'feelGood',  length: 'quick'    },
  { slot: 'morning', day: 'sat', title: 'Slow Pour',          description: 'Saturday as it was meant to be taken.',          vibe: 'morning',   length: 'standard' },
  { slot: 'morning', day: 'sun', title: 'Gentle Start',       description: 'Sundays are for returning to yourself.',         vibe: 'morning',   length: 'long'     },
  // ── Evening slots ──────────────────────────────────────────────
  { slot: 'evening', day: 'mon', title: 'Monday Unwind',      description: 'Off the clock, into the dim.',                   vibe: 'lateNight', length: 'standard' },
  { slot: 'evening', day: 'tue', title: 'Melancholy Hour',    description: 'Blue-hour records. Sit with them.',              vibe: 'melancholy', length: 'standard' },
  { slot: 'evening', day: 'wed', title: 'Focus Cuts',         description: 'Late-night studio sessions with nothing to prove.', vibe: 'focus', length: 'standard' },
  { slot: 'evening', day: 'thu', title: 'Thursday Build',     description: 'A slow climb toward the weekend.',               vibe: 'feelGood',  length: 'standard' },
  { slot: 'evening', day: 'fri', title: 'Friday Feels',       description: 'Whatever you need the night to be.',             vibe: 'party',     length: 'long'     },
  { slot: 'evening', day: 'sat', title: 'Saturday Pour',      description: 'The loud part of the evening.',                  vibe: 'party',     length: 'long'     },
  { slot: 'evening', day: 'sun', title: 'Late Night Soul',    description: 'Warm records for the last hour of the week.',    vibe: 'lateNight', length: 'standard' },
];

export function getThemeFor(slot: SlotKey, day: DayOfWeek): SlotTheme {
  const match = SLOT_THEMES.find(t => t.slot === slot && t.day === day);
  if (!match) throw new Error(`no theme for ${slot}/${day}`);
  return match;
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `cd server && npm test -- tonightOnOnay`
Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git add server/src/config/tonightOnOnay.ts server/__tests__/config/tonightOnOnay.test.ts
git commit -m "feat(server): tonight-on-onay theme library (14 slots)"
```

---

## Task 2: Theme Library — Client Mirror

**Files:**
- Create: `src/config/tonightOnOnay.ts`
- Create: `__tests__/config/tonightOnOnay.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/config/tonightOnOnay.test.ts`:

```ts
import {
  SLOT_THEMES as CLIENT,
  getThemeFor as getClient,
  type SlotKey,
  type DayOfWeek,
} from '../../src/config/tonightOnOnay';
import { SLOT_THEMES as SERVER } from '../../server/src/config/tonightOnOnay';

describe('tonightOnOnay client mirror', () => {
  it('has 14 entries', () => {
    expect(CLIENT).toHaveLength(14);
  });

  it('matches server 1:1 on (slot, day, vibe, length)', () => {
    // Title + description may drift slightly for display reasons; the
    // structural fields that drive validation must not drift.
    const keyOf = (t: { slot: string; day: string; vibe: string; length: string }) =>
      `${t.slot}:${t.day}:${t.vibe}:${t.length}`;
    expect(new Set(CLIENT.map(keyOf))).toEqual(new Set(SERVER.map(keyOf)));
  });

  it('getThemeFor returns a usable entry', () => {
    const t = getClient('evening' as SlotKey, 'fri' as DayOfWeek);
    expect(t.title.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test, expect compile fail**

Run: `npm test -- tonightOnOnay`
Expected: FAIL — `../../src/config/tonightOnOnay` not found.

- [ ] **Step 3: Create the client mirror**

Create `src/config/tonightOnOnay.ts` with identical content to the server file, but the `Manifest` import pointed at the client type file:

```ts
import type { Manifest } from '../engines/BroadcastPlayer.types';

export type SlotKey = 'morning' | 'evening';
export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface SlotTheme {
  slot: SlotKey;
  day: DayOfWeek;
  title: string;
  description: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
}

export const SLOT_THEMES: SlotTheme[] = [
  { slot: 'morning', day: 'mon', title: 'Monday Reset',       description: 'Slow start. Coffee first, noise later.',        vibe: 'morning',   length: 'standard' },
  { slot: 'morning', day: 'tue', title: 'Throwback Tuesday',  description: 'Old favorites to dust off the week.',            vibe: 'feelGood',  length: 'standard' },
  { slot: 'morning', day: 'wed', title: 'Midweek Lift',       description: 'Enough momentum to get over the hump.',          vibe: 'feelGood',  length: 'quick'    },
  { slot: 'morning', day: 'thu', title: 'Thursday Flow',      description: 'Focus music for the part of the week that ships.', vibe: 'focus',  length: 'standard' },
  { slot: 'morning', day: 'fri', title: 'Friday Warmup',      description: 'A shoulder-roll before the weekend starts.',     vibe: 'feelGood',  length: 'quick'    },
  { slot: 'morning', day: 'sat', title: 'Slow Pour',          description: 'Saturday as it was meant to be taken.',          vibe: 'morning',   length: 'standard' },
  { slot: 'morning', day: 'sun', title: 'Gentle Start',       description: 'Sundays are for returning to yourself.',         vibe: 'morning',   length: 'long'     },
  { slot: 'evening', day: 'mon', title: 'Monday Unwind',      description: 'Off the clock, into the dim.',                   vibe: 'lateNight', length: 'standard' },
  { slot: 'evening', day: 'tue', title: 'Melancholy Hour',    description: 'Blue-hour records. Sit with them.',              vibe: 'melancholy', length: 'standard' },
  { slot: 'evening', day: 'wed', title: 'Focus Cuts',         description: 'Late-night studio sessions with nothing to prove.', vibe: 'focus', length: 'standard' },
  { slot: 'evening', day: 'thu', title: 'Thursday Build',     description: 'A slow climb toward the weekend.',               vibe: 'feelGood',  length: 'standard' },
  { slot: 'evening', day: 'fri', title: 'Friday Feels',       description: 'Whatever you need the night to be.',             vibe: 'party',     length: 'long'     },
  { slot: 'evening', day: 'sat', title: 'Saturday Pour',      description: 'The loud part of the evening.',                  vibe: 'party',     length: 'long'     },
  { slot: 'evening', day: 'sun', title: 'Late Night Soul',    description: 'Warm records for the last hour of the week.',    vibe: 'lateNight', length: 'standard' },
];

export function getThemeFor(slot: SlotKey, day: DayOfWeek): SlotTheme {
  const match = SLOT_THEMES.find(t => t.slot === slot && t.day === day);
  if (!match) throw new Error(`no theme for ${slot}/${day}`);
  return match;
}

/** Helper for computing today's DayOfWeek from a Date (curator's local time). */
export function dayOfWeekFor(date: Date): DayOfWeek {
  const days: DayOfWeek[] = ['sun','mon','tue','wed','thu','fri','sat'];
  return days[date.getDay()];
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm test -- tonightOnOnay`
Expected: PASS — 3/3.

- [ ] **Step 5: Commit**

```bash
git add src/config/tonightOnOnay.ts __tests__/config/tonightOnOnay.test.ts
git commit -m "feat(client): tonight-on-onay theme library mirror"
```

---

## Task 3: Registry — Slot Field, `getBySlot`, Ordering

**Files:**
- Modify: `server/src/services/broadcast/FeaturedBroadcastRegistry.ts`
- Modify: `server/__tests__/broadcast/FeaturedBroadcastRegistry.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/__tests__/broadcast/FeaturedBroadcastRegistry.test.ts` (inside the existing `describe` block):

```ts
  const mkSlot = (id: string, slot: 'morning'|'evening', day: 'mon', createdAt: number) => ({
    id, slot, themeDay: day, title: `T ${id}`, description: 'D',
    vibe: slot === 'morning' ? 'morning' as const : 'lateNight' as const,
    length: 'quick' as const,
    baked: true, createdAt,
    manifest: { broadcastId: id, userId: 'curator', playlistId: null,
      vibe: 'morning' as const, length: 'quick' as const, createdAt,
      tracks: [], segmentSlots: [] },
  });

  it('slot put overwrites on id match (newer wins)', async () => {
    await reg.put(mkSlot('slot_morning', 'morning', 'mon', 100));
    await reg.put(mkSlot('slot_morning', 'morning', 'mon', 200));
    const list = reg.list();
    expect(list).toHaveLength(1);
    expect(list[0].createdAt).toBe(200);
  });

  it('list orders morning → evening → legacy', async () => {
    await reg.put(mk('legacy-a', true));
    await reg.put(mkSlot('slot_evening', 'evening', 'mon', 10));
    await reg.put(mkSlot('slot_morning', 'morning', 'mon', 10));
    const ids = reg.list().map(r => r.id);
    expect(ids).toEqual(['slot_morning', 'slot_evening', 'legacy-a']);
  });

  it('getBySlot returns the record or null', async () => {
    expect(reg.getBySlot('morning')).toBeNull();
    await reg.put(mkSlot('slot_morning', 'morning', 'mon', 10));
    const got = reg.getBySlot('morning');
    expect(got?.id).toBe('slot_morning');
    expect(reg.getBySlot('evening')).toBeNull();
  });
```

- [ ] **Step 2: Run tests, expect fails**

Run: `cd server && npm test -- FeaturedBroadcastRegistry`
Expected: FAIL on TypeScript (`slot` not on type) and on `getBySlot` not existing.

- [ ] **Step 3: Extend the registry**

Replace the contents of `server/src/services/broadcast/FeaturedBroadcastRegistry.ts` with:

```ts
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Manifest } from './types';
import type { SlotKey, DayOfWeek } from '../../config/tonightOnOnay';

export interface FeaturedBroadcast {
  id: string;
  /** Present iff this is a Tonight-on-ONAY slot record. Fixed ids
   *  `slot_morning` / `slot_evening` make re-bakes replace by natural key. */
  slot?: SlotKey;
  /** Day whose theme was used for this bake — denormalized onto the
   *  record so the client doesn't need to re-derive it. */
  themeDay?: DayOfWeek;
  title: string;
  description: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
  artworkUrl?: string;
  baked: boolean;
  createdAt: number;
  manifest: Manifest;
}

interface Snapshot { records: FeaturedBroadcast[] }

export class FeaturedBroadcastRegistry {
  private records: FeaturedBroadcast[] = [];

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Snapshot;
      this.records = parsed.records ?? [];
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      if (code === 'ENOENT') { this.records = []; return; }
      console.warn(`[FeaturedBroadcastRegistry] load failed, resetting:`, err);
      this.records = [];
    }
  }

  async put(record: FeaturedBroadcast): Promise<void> {
    const idx = this.records.findIndex(r => r.id === record.id);
    if (idx >= 0) this.records[idx] = record;
    else this.records.push(record);
    await this.save();
  }

  async remove(id: string): Promise<void> {
    this.records = this.records.filter(r => r.id !== id);
    await this.save();
  }

  /** Baked records only, ordered: morning slot → evening slot → legacy. */
  list(): FeaturedBroadcast[] {
    const baked = this.records.filter(r => r.baked);
    const rank = (r: FeaturedBroadcast) =>
      r.slot === 'morning' ? 0 : r.slot === 'evening' ? 1 : 2;
    return [...baked]
      .sort((a, b) => rank(a) - rank(b))
      .map(r => ({ ...r }));
  }

  getBySlot(slot: SlotKey): FeaturedBroadcast | null {
    const hit = this.records.find(r => r.baked && r.slot === slot);
    return hit ? { ...hit } : null;
  }

  private async save(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ records: this.records }, null, 2));
    await fs.rename(tmp, this.filePath);
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd server && npm test -- FeaturedBroadcastRegistry`
Expected: PASS — all existing tests plus 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/broadcast/FeaturedBroadcastRegistry.ts server/__tests__/broadcast/FeaturedBroadcastRegistry.test.ts
git commit -m "feat(server): FeaturedBroadcast slot field + getBySlot + ordering"
```

---

## Task 4: Publish Schema — Slot Fields + ID/Reserved Guards

**Files:**
- Modify: `server/src/routes/featured.ts`
- Modify: `server/__tests__/routes/featured.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/__tests__/routes/featured.test.ts` (inside the existing `describe` block). First, you'll need a stub orchestrator. Add this helper above the `describe`:

```ts
import type { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';

function stubOrchestrator(): BroadcastOrchestrator {
  const manifest = {
    broadcastId: 'bake-1', userId: 'curator', playlistId: null,
    vibe: 'morning' as const, length: 'standard' as const,
    createdAt: 1, tracks: [], segmentSlots: [],
  };
  return {
    create: jest.fn().mockResolvedValue({ manifest }),
    waitForCompletion: jest.fn().mockResolvedValue(undefined),
    getManifest: jest.fn().mockReturnValue(manifest),
  } as unknown as BroadcastOrchestrator;
}
```

Then add tests below the existing ones:

```ts
  const slotBody = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'slot_morning',
    slot: 'morning',
    themeDay: 'mon',
    title: 'Monday Reset',
    description: 'Slow start. Coffee first, noise later.',
    vibe: 'morning',
    length: 'standard',
    tracks: Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`, title: `T${i}`, artistName: 'A', albumTitle: '',
      duration: 180,
    })),
    ...over,
  });

  const curatorApp = () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as express.Request & { uid?: string; email?: string }).uid = 'u1';
      (req as express.Request & { uid?: string; email?: string }).email = 'bworthy89@gmail.com';
      next();
    });
    app.use(createFeaturedRouter(reg, stubOrchestrator()));
    return app;
  };

  it('accepts slot + themeDay + matching id', async () => {
    process.env.CURATOR_EMAILS = 'bworthy89@gmail.com';
    const res = await request(curatorApp()).post('/broadcast/featured/publish').send(slotBody());
    expect(res.status).toBe(200);
  });

  it('rejects slot present without themeDay', async () => {
    process.env.CURATOR_EMAILS = 'bworthy89@gmail.com';
    const body = slotBody(); delete (body as Record<string, unknown>).themeDay;
    const res = await request(curatorApp()).post('/broadcast/featured/publish').send(body);
    expect(res.status).toBe(400);
  });

  it('rejects id that does not match slot_${slot}', async () => {
    process.env.CURATOR_EMAILS = 'bworthy89@gmail.com';
    const res = await request(curatorApp())
      .post('/broadcast/featured/publish').send(slotBody({ id: 'slot_evening' }));
    expect(res.status).toBe(400);
  });

  it('rejects vibe/length that does not match the theme', async () => {
    process.env.CURATOR_EMAILS = 'bworthy89@gmail.com';
    const res = await request(curatorApp())
      .post('/broadcast/featured/publish').send(slotBody({ vibe: 'party' }));
    expect(res.status).toBe(400);
  });

  it('rejects free-form publish with reserved id (slot_*)', async () => {
    process.env.CURATOR_EMAILS = 'bworthy89@gmail.com';
    const body = slotBody({ id: 'slot_morning' });
    delete (body as Record<string, unknown>).slot;
    delete (body as Record<string, unknown>).themeDay;
    const res = await request(curatorApp()).post('/broadcast/featured/publish').send(body);
    expect(res.status).toBe(400);
  });

  it('persists slot + themeDay on the registry record', async () => {
    process.env.CURATOR_EMAILS = 'bworthy89@gmail.com';
    const res = await request(curatorApp()).post('/broadcast/featured/publish').send(slotBody());
    expect(res.status).toBe(200);
    const stored = reg.getBySlot('morning');
    expect(stored?.slot).toBe('morning');
    expect(stored?.themeDay).toBe('mon');
  });
```

- [ ] **Step 2: Run tests, expect fails**

Run: `cd server && npm test -- routes/featured`
Expected: FAIL — schema doesn't know `slot`/`themeDay`, no id/theme-match validation, reserved id not blocked.

- [ ] **Step 3: Extend the schema + handler**

Replace `server/src/routes/featured.ts` with:

```ts
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { FeaturedBroadcastRegistry } from '../services/broadcast/FeaturedBroadcastRegistry';
import type { BroadcastOrchestrator } from '../services/broadcast/BroadcastOrchestrator';
import { requireCurator, type AuthenticatedRequest } from '../middleware/auth';
import { getThemeFor } from '../config/tonightOnOnay';

const vibeSchema = z.enum([
  'morning', 'focus', 'workout', 'feelGood',
  'lateNight', 'melancholy', 'party',
]);

const lengthSchema = z.enum(['quick', 'standard', 'long']);
const slotSchema = z.enum(['morning', 'evening']);
const daySchema = z.enum(['mon','tue','wed','thu','fri','sat','sun']);

const trackSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  artistName: z.string().min(1).max(200),
  albumTitle: z.string().max(200),
  duration: z.number().positive().max(7200),
  artworkUrl: z.string().url().max(2048).optional(),
  genreNames: z.array(z.string().max(100)).max(10).optional(),
});

const publishSchema = z.object({
  id: z.string().min(1).max(80),
  slot: slotSchema.optional(),
  themeDay: daySchema.optional(),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(400),
  vibe: vibeSchema,
  length: lengthSchema,
  artworkUrl: z.string().url().optional(),
  tracks: z.array(trackSchema).min(5).max(100),
}).superRefine((v, ctx) => {
  if (v.slot) {
    if (!v.themeDay) {
      ctx.addIssue({ code: 'custom', path: ['themeDay'], message: 'themeDay required when slot is set' });
      return;
    }
    const expectedId = `slot_${v.slot}`;
    if (v.id !== expectedId) {
      ctx.addIssue({ code: 'custom', path: ['id'], message: `id must be "${expectedId}" for slot ${v.slot}` });
    }
    const theme = getThemeFor(v.slot, v.themeDay);
    if (theme.vibe !== v.vibe) {
      ctx.addIssue({ code: 'custom', path: ['vibe'], message: `vibe must match theme (${theme.vibe})` });
    }
    if (theme.length !== v.length) {
      ctx.addIssue({ code: 'custom', path: ['length'], message: `length must match theme (${theme.length})` });
    }
  } else {
    // Free-form publishes may not use the reserved slot id namespace.
    if (/^slot_/.test(v.id)) {
      ctx.addIssue({ code: 'custom', path: ['id'], message: 'id "slot_*" is reserved for Tonight on ONAY slots' });
    }
  }
});

export function createFeaturedRouter(
  registry: FeaturedBroadcastRegistry,
  orchestrator?: BroadcastOrchestrator,
  bakeLimiter?: RequestHandler,
): Router {
  const router = Router();

  router.get('/broadcast/featured', (_req, res) => {
    res.json({ broadcasts: registry.list() });
  });

  if (orchestrator) {
    const publishMiddleware: RequestHandler[] = [
      requireCurator,
      ...(bakeLimiter ? [bakeLimiter] : []),
    ];

    router.post('/broadcast/featured/publish', ...publishMiddleware, async (req: AuthenticatedRequest, res) => {
      const parsed = publishSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
      }
      const config = parsed.data;

      try {
        const { manifest: initial } = await orchestrator.create({
          userId: 'curator',
          playlistId: null,
          vibe: config.vibe,
          length: config.length,
          tracks: config.tracks,
          userContext: {
            timeOfDay: '12:00',
            dayOfWeek: '',
            firstTimeUser: false,
            listenerName: 'tonight\u2019s listener',
          },
        });

        await orchestrator.waitForCompletion(initial.broadcastId);
        const finalManifest = orchestrator.getManifest(initial.broadcastId) ?? initial;

        await registry.put({
          id: config.id,
          slot: config.slot,
          themeDay: config.themeDay,
          title: config.title,
          description: config.description,
          vibe: config.vibe,
          length: config.length,
          artworkUrl: config.artworkUrl,
          baked: true,
          createdAt: Date.now(),
          manifest: finalManifest,
        });

        return res.json({ id: config.id, broadcastId: finalManifest.broadcastId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'publish failed';
        return res.status(500).json({ error: msg });
      }
    });
  }

  return router;
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd server && npm test -- routes/featured`
Expected: PASS — existing + 6 new tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/featured.ts server/__tests__/routes/featured.test.ts
git commit -m "feat(server): slot-aware publish with theme + reserved id validation"
```

---

## Task 5: Client Curation Client — Extend Request Type

**Files:**
- Modify: `src/engines/BroadcastCurationClient.ts`

- [ ] **Step 1: Add slot/themeDay to the request type**

Edit `src/engines/BroadcastCurationClient.ts`:

Replace the `FeaturedBroadcast` and `PublishFeaturedRequest` interfaces with:

```ts
import type { SlotKey, DayOfWeek } from '../config/tonightOnOnay';

export interface FeaturedBroadcast {
  id: string;
  slot?: SlotKey;
  themeDay?: DayOfWeek;
  title: string;
  description: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
  artworkUrl?: string;
  baked: boolean;
  createdAt: number;
  manifest: Manifest;
}

export interface PublishFeaturedRequest {
  id: string;
  slot?: SlotKey;
  themeDay?: DayOfWeek;
  title: string;
  description: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
  artworkUrl?: string;
  tracks: ManifestTrack[];
}
```

The body of `publishFeatured()` is unchanged — it already serializes the whole input. No network shape change beyond the two new optional fields.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/engines/BroadcastCurationClient.ts
git commit -m "feat(client): PublishFeaturedRequest slot/themeDay fields"
```

---

## Task 6: Publish Sheet — Pure Helpers + Unit Tests

**Files:**
- Create: `src/components/broadcast/publishFeaturedSheet.helpers.ts`
- Create: `__tests__/components/publishFeaturedSheet.helpers.test.ts`

These are the testable bits — prefill, vibe-mismatch detection, day ordering. The component (Task 7) consumes them.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/components/publishFeaturedSheet.helpers.test.ts`:

```ts
import {
  DAYS_ORDERED,
  buildSlotPrefill,
  shouldWarnVibeMismatch,
} from '../../src/components/broadcast/publishFeaturedSheet.helpers';
import { getThemeFor } from '../../src/config/tonightOnOnay';

describe('publishFeaturedSheet.helpers', () => {
  it('DAYS_ORDERED starts Monday, ends Sunday', () => {
    expect(DAYS_ORDERED).toEqual(['mon','tue','wed','thu','fri','sat','sun']);
  });

  it('buildSlotPrefill pulls the right theme', () => {
    const p = buildSlotPrefill('morning', 'tue');
    const t = getThemeFor('morning', 'tue');
    expect(p.id).toBe('slot_morning');
    expect(p.slot).toBe('morning');
    expect(p.themeDay).toBe('tue');
    expect(p.title).toBe(t.title);
    expect(p.description).toBe(t.description);
    expect(p.vibe).toBe(t.vibe);
    expect(p.length).toBe(t.length);
  });

  it('shouldWarnVibeMismatch: true when session vibe differs from slot vibe', () => {
    expect(shouldWarnVibeMismatch('party', 'morning')).toBe(true);
    expect(shouldWarnVibeMismatch('morning', 'morning')).toBe(false);
    expect(shouldWarnVibeMismatch(undefined, 'morning')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect compile fail**

Run: `npm test -- publishFeaturedSheet.helpers`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the helpers module**

Create `src/components/broadcast/publishFeaturedSheet.helpers.ts`:

```ts
import { getThemeFor, type SlotKey, type DayOfWeek, type SlotTheme } from '../../config/tonightOnOnay';
import type { Manifest } from '../../engines/BroadcastPlayer.types';

export const DAYS_ORDERED: DayOfWeek[] = ['mon','tue','wed','thu','fri','sat','sun'];

export interface SlotPrefill {
  id: string;
  slot: SlotKey;
  themeDay: DayOfWeek;
  title: string;
  description: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
}

export function buildSlotPrefill(slot: SlotKey, day: DayOfWeek): SlotPrefill {
  const t: SlotTheme = getThemeFor(slot, day);
  return {
    id: `slot_${slot}`,
    slot,
    themeDay: day,
    title: t.title,
    description: t.description,
    vibe: t.vibe,
    length: t.length,
  };
}

/** True when the caller's current session vibe disagrees with the slot's
 *  theme vibe. Shows the soft warning band in the publish sheet. */
export function shouldWarnVibeMismatch(
  sessionVibe: Manifest['vibe'] | undefined,
  slotVibe: Manifest['vibe'],
): boolean {
  return !!sessionVibe && sessionVibe !== slotVibe;
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm test -- publishFeaturedSheet.helpers`
Expected: PASS — 3/3.

- [ ] **Step 5: Commit**

```bash
git add src/components/broadcast/publishFeaturedSheet.helpers.ts __tests__/components/publishFeaturedSheet.helpers.test.ts
git commit -m "feat(client): publish sheet prefill + vibe warning helpers"
```

---

## Task 7: PublishFeaturedSheet Component

**Files:**
- Create: `src/components/broadcast/PublishFeaturedSheet.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/broadcast/PublishFeaturedSheet.tsx`:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, Space, TypeScale, AMGlow } from '../../tokens/design-tokens';
import {
  DAYS_ORDERED,
  buildSlotPrefill,
  shouldWarnVibeMismatch,
  type SlotPrefill,
} from './publishFeaturedSheet.helpers';
import {
  dayOfWeekFor,
  type SlotKey,
  type DayOfWeek,
} from '../../config/tonightOnOnay';
import type { Manifest } from '../../engines/BroadcastPlayer.types';
import type { PublishFeaturedRequest } from '../../engines/BroadcastCurationClient';

type Selection =
  | { kind: 'none' }
  | { kind: 'free'; title: string; description: string }
  | { kind: 'slot'; slot: SlotKey; prefill: SlotPrefill; titleOverride?: string; descOverride?: string };

interface Props {
  visible: boolean;
  /** The vibe the current Ask ONAY session was curated under — used for
   *  the soft vibe-mismatch warning when publishing into a slot. */
  sessionVibe?: Manifest['vibe'];
  /** Default free-form values when the curator picks "Free-form." */
  defaultTitle?: string;
  defaultDescription?: string;
  defaultVibe: Manifest['vibe'];
  defaultLength: Manifest['length'];
  /** Curator's local today — passed in so tests can inject a fixed date. */
  today?: DayOfWeek;
  publishing: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (req: Omit<PublishFeaturedRequest, 'tracks' | 'artworkUrl'>) => void;
}

export function PublishFeaturedSheet(props: Props) {
  const today = props.today ?? dayOfWeekFor(new Date());
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const [morningDay, setMorningDay] = useState<DayOfWeek>(today);
  const [eveningDay, setEveningDay] = useState<DayOfWeek>(today);

  useEffect(() => {
    if (!props.visible) {
      setSelection({ kind: 'none' });
      setMorningDay(today);
      setEveningDay(today);
    }
  }, [props.visible, today]);

  const morningPrefill = useMemo(() => buildSlotPrefill('morning', morningDay), [morningDay]);
  const eveningPrefill = useMemo(() => buildSlotPrefill('evening', eveningDay), [eveningDay]);

  const pick = (next: Selection) => {
    Haptics.selectionAsync().catch(() => {});
    setSelection(next);
  };

  const canSubmit =
    selection.kind === 'slot'
      ? true
      : selection.kind === 'free' && selection.title.trim().length > 0;

  const submit = () => {
    if (!canSubmit || props.publishing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (selection.kind === 'free') {
      const slug = `${Date.now()}-${selection.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
      props.onSubmit({
        id: slug,
        title: selection.title.trim(),
        description: (selection.description ?? '').trim() || 'picked records, not algorithms.',
        vibe: props.defaultVibe,
        length: props.defaultLength,
      });
      return;
    }
    if (selection.kind === 'slot') {
      const p = selection.prefill;
      props.onSubmit({
        id: p.id,
        slot: p.slot,
        themeDay: p.themeDay,
        title: (selection.titleOverride ?? p.title).trim() || p.title,
        description: (selection.descOverride ?? p.description).trim() || p.description,
        vibe: p.vibe,
        length: p.length,
      });
    }
  };

  const ctaLabel =
    selection.kind === 'free' ? 'PUBLISH AS FEATURED'
    : selection.kind === 'slot' ? `PUBLISH AS TONIGHT'S ${selection.slot.toUpperCase()}`
    : 'CHOOSE A SLOT';

  return (
    <Modal visible={props.visible} animationType="slide" transparent={false} onRequestClose={props.onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable
            onPress={props.onClose}
            accessibilityRole="button"
            accessibilityLabel="Close publish sheet"
            style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.closeGlyph}>×</Text>
          </Pressable>
          <View style={styles.headerRight}>
            <Text style={styles.headerLabel}>PUBLISH AS FEATURED</Text>
            <View style={styles.headerRule} />
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <FreeFormTile
            selected={selection.kind === 'free'}
            title={selection.kind === 'free' ? selection.title : (props.defaultTitle ?? '')}
            description={selection.kind === 'free' ? selection.description : (props.defaultDescription ?? '')}
            onSelect={() => pick({
              kind: 'free',
              title: props.defaultTitle ?? '',
              description: props.defaultDescription ?? '',
            })}
            onTitleChange={(t) =>
              selection.kind === 'free' && setSelection({ ...selection, title: t })
            }
            onDescriptionChange={(d) =>
              selection.kind === 'free' && setSelection({ ...selection, description: d })
            }
          />

          <SlotTile
            slot="morning"
            today={today}
            day={morningDay}
            prefill={morningPrefill}
            selected={selection.kind === 'slot' && selection.slot === 'morning'}
            titleOverride={selection.kind === 'slot' && selection.slot === 'morning' ? selection.titleOverride : undefined}
            descOverride={selection.kind === 'slot' && selection.slot === 'morning' ? selection.descOverride : undefined}
            onSelect={() => pick({ kind: 'slot', slot: 'morning', prefill: morningPrefill })}
            onDayChange={(d) => {
              setMorningDay(d);
              if (selection.kind === 'slot' && selection.slot === 'morning') {
                pick({ kind: 'slot', slot: 'morning', prefill: buildSlotPrefill('morning', d) });
              }
            }}
            onTitleChange={(t) =>
              selection.kind === 'slot' && selection.slot === 'morning' &&
              setSelection({ ...selection, titleOverride: t })
            }
            onDescChange={(d) =>
              selection.kind === 'slot' && selection.slot === 'morning' &&
              setSelection({ ...selection, descOverride: d })
            }
          />

          <SlotTile
            slot="evening"
            today={today}
            day={eveningDay}
            prefill={eveningPrefill}
            selected={selection.kind === 'slot' && selection.slot === 'evening'}
            titleOverride={selection.kind === 'slot' && selection.slot === 'evening' ? selection.titleOverride : undefined}
            descOverride={selection.kind === 'slot' && selection.slot === 'evening' ? selection.descOverride : undefined}
            onSelect={() => pick({ kind: 'slot', slot: 'evening', prefill: eveningPrefill })}
            onDayChange={(d) => {
              setEveningDay(d);
              if (selection.kind === 'slot' && selection.slot === 'evening') {
                pick({ kind: 'slot', slot: 'evening', prefill: buildSlotPrefill('evening', d) });
              }
            }}
            onTitleChange={(t) =>
              selection.kind === 'slot' && selection.slot === 'evening' &&
              setSelection({ ...selection, titleOverride: t })
            }
            onDescChange={(d) =>
              selection.kind === 'slot' && selection.slot === 'evening' &&
              setSelection({ ...selection, descOverride: d })
            }
          />

          {selection.kind === 'slot' &&
            shouldWarnVibeMismatch(props.sessionVibe, selection.prefill.vibe) && (
              <Text style={styles.warning}>
                This slot's vibe is <Text style={styles.warningEm}>{selection.prefill.vibe}</Text>.
                {' '}I'll re-voice the commentary for the slot angle.
              </Text>
          )}

          {props.error ? <Text style={styles.errorBand}>{props.error}</Text> : null}
        </ScrollView>

        <Pressable
          disabled={!canSubmit || props.publishing}
          onPress={submit}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          style={({ pressed }) => [
            styles.cta,
            (!canSubmit || props.publishing) && styles.ctaDisabled,
            pressed && canSubmit && !props.publishing && { opacity: 0.85 },
          ]}
        >
          {props.publishing
            ? (<><ActivityIndicator color={AM.bg} /><Text style={styles.ctaLabel}>  BAKING…</Text></>)
            : <Text style={styles.ctaLabel}>{ctaLabel}</Text>}
        </Pressable>
      </View>
    </Modal>
  );
}

// ─────────────────────────── Tiles ───────────────────────────────────

interface FreeFormTileProps {
  selected: boolean;
  title: string;
  description: string;
  onSelect: () => void;
  onTitleChange: (t: string) => void;
  onDescriptionChange: (d: string) => void;
}

function FreeFormTile(p: FreeFormTileProps) {
  return (
    <Pressable
      onPress={p.onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected: p.selected }}
      style={[styles.tile, p.selected && styles.tileSelected]}
    >
      <Text style={styles.tileEyebrow}>FREE-FORM</Text>
      <Text style={styles.tileTitle}>Name your own drop</Text>
      <Text style={styles.tileBody}>Standalone featured broadcast — not a Morning or Evening slot.</Text>
      {p.selected && (
        <View style={styles.editBlock}>
          <Text style={styles.fieldLabel}>TITLE</Text>
          <TextInput
            value={p.title}
            onChangeText={p.onTitleChange}
            placeholder="e.g. Post-rain dispatch"
            placeholderTextColor={AM.inkDim}
            maxLength={120}
            style={styles.input}
          />
          <Text style={styles.fieldLabel}>DESCRIPTION</Text>
          <TextInput
            value={p.description}
            onChangeText={p.onDescriptionChange}
            placeholder="one warm sentence"
            placeholderTextColor={AM.inkDim}
            maxLength={400}
            multiline
            style={[styles.input, styles.inputMulti]}
          />
        </View>
      )}
    </Pressable>
  );
}

interface SlotTileProps {
  slot: SlotKey;
  today: DayOfWeek;
  day: DayOfWeek;
  prefill: SlotPrefill;
  selected: boolean;
  titleOverride?: string;
  descOverride?: string;
  onSelect: () => void;
  onDayChange: (d: DayOfWeek) => void;
  onTitleChange: (t: string) => void;
  onDescChange: (d: string) => void;
}

function SlotTile(p: SlotTileProps) {
  return (
    <Pressable
      onPress={p.onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected: p.selected }}
      style={[styles.tile, p.selected && styles.tileSelected]}
    >
      <Text style={styles.tileEyebrow}>
        {p.slot.toUpperCase()} · {p.day.toUpperCase()}
      </Text>
      <Text style={styles.tileTitle}>{p.prefill.title}</Text>
      <Text style={styles.tileBody}>{p.prefill.description}</Text>
      <Text style={styles.vibeChip}>{p.prefill.vibe.toUpperCase()} · {p.prefill.length.toUpperCase()}</Text>

      {p.selected && (
        <View style={styles.editBlock}>
          <Text style={styles.fieldLabel}>DAY</Text>
          <View style={styles.dayRow}>
            {DAYS_ORDERED.map(d => {
              const isActive = d === p.day;
              const isToday = d === p.today;
              return (
                <Pressable
                  key={d}
                  onPress={() => p.onDayChange(d)}
                  accessibilityRole="button"
                  accessibilityLabel={`Set theme day ${d}`}
                  style={({ pressed }) => [
                    styles.dayChip,
                    isActive && styles.dayChipActive,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={[styles.dayChipText, isActive && styles.dayChipTextActive]}>
                    {d.toUpperCase()}
                  </Text>
                  {isToday && !isActive ? <View style={styles.dayDot} /> : null}
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>TITLE</Text>
          <TextInput
            value={p.titleOverride ?? p.prefill.title}
            onChangeText={p.onTitleChange}
            maxLength={120}
            style={styles.input}
          />
          <Text style={styles.fieldLabel}>DESCRIPTION</Text>
          <TextInput
            value={p.descOverride ?? p.prefill.description}
            onChangeText={p.onDescChange}
            maxLength={400}
            multiline
            style={[styles.input, styles.inputMulti]}
          />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: AM.bg },
  header: {
    paddingTop: Space.s20, paddingHorizontal: Space.s16, paddingBottom: Space.s12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  close: { padding: Space.s8 },
  closeGlyph: { color: AM.ink, fontSize: TypeScale.s26, fontFamily: Fonts.display },
  headerRight: { alignItems: 'flex-end' },
  headerLabel: { color: AM.amber, fontFamily: Fonts.mono, fontSize: TypeScale.s10, letterSpacing: 2.5 },
  headerRule: { width: 40, height: 2, backgroundColor: AM.amber, marginTop: 4 },

  body: { paddingHorizontal: Space.s16, paddingBottom: Space.s40 },

  tile: {
    marginTop: Space.s14,
    paddingVertical: Space.s14, paddingHorizontal: Space.s14,
    borderLeftWidth: 2, borderLeftColor: AM.amber,
    backgroundColor: AM.bgDeep,
  },
  tileSelected: { ...AMGlow.cta, borderLeftColor: AM.amber, backgroundColor: '#111'  },
  tileEyebrow: { color: AM.amber, fontFamily: Fonts.mono, fontSize: TypeScale.s10, letterSpacing: 2.5 },
  tileTitle: { marginTop: 6, color: AM.ink, fontFamily: Fonts.display, fontSize: TypeScale.s22, letterSpacing: 0.3 },
  tileBody: { marginTop: 6, color: AM.inkMid, fontFamily: Fonts.serif, fontSize: TypeScale.s13, lineHeight: TypeScale.s13 * 1.45 },
  vibeChip: { marginTop: Space.s10, color: AM.amberDim, fontFamily: Fonts.mono, fontSize: TypeScale.s9, letterSpacing: 2 },

  editBlock: { marginTop: Space.s14, borderTopWidth: 1, borderTopColor: AM.rule, paddingTop: Space.s12 },
  fieldLabel: { color: AM.amber, fontFamily: Fonts.mono, fontSize: TypeScale.s9, letterSpacing: 2, marginTop: Space.s10 },
  input: {
    marginTop: 4, color: AM.ink, fontFamily: Fonts.serif, fontSize: TypeScale.s14,
    borderBottomWidth: 1, borderBottomColor: AM.rule, paddingVertical: Space.s6,
  },
  inputMulti: { minHeight: 60, textAlignVertical: 'top' },

  dayRow: { flexDirection: 'row', gap: Space.s6, marginTop: 6, flexWrap: 'wrap' },
  dayChip: {
    paddingHorizontal: Space.s8, paddingVertical: 4,
    borderWidth: 1, borderColor: AM.rule, minWidth: 42, alignItems: 'center',
  },
  dayChipActive: { borderColor: AM.amber, backgroundColor: AM.amberFaint },
  dayChipText: { color: AM.inkMid, fontFamily: Fonts.mono, fontSize: TypeScale.s9, letterSpacing: 2 },
  dayChipTextActive: { color: AM.amber },
  dayDot: {
    width: 3, height: 3, borderRadius: 1.5, backgroundColor: AM.amber,
    position: 'absolute', bottom: 2, alignSelf: 'center',
  },

  warning: {
    marginTop: Space.s14,
    color: AM.inkMid, fontFamily: Fonts.serif, fontStyle: 'italic',
    fontSize: TypeScale.s13, lineHeight: TypeScale.s13 * 1.5,
  },
  warningEm: { color: AM.amber, fontStyle: 'italic' },
  errorBand: {
    marginTop: Space.s14,
    color: AM.oxblood, fontFamily: Fonts.mono, fontSize: TypeScale.s10, letterSpacing: 2,
  },

  cta: {
    margin: Space.s16,
    paddingVertical: Space.s16,
    backgroundColor: AM.amber,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
    ...AMGlow.cta,
  },
  ctaDisabled: { backgroundColor: AM.amberDim, opacity: 0.4, shadowOpacity: 0 },
  ctaLabel: { color: AM.bg, fontFamily: Fonts.mono, fontSize: TypeScale.s12, letterSpacing: 3 },
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/broadcast/PublishFeaturedSheet.tsx
git commit -m "feat(client): PublishFeaturedSheet component"
```

---

## Task 8: AskOnayScreen — Wire Sheet, Remove Alert.prompt

**Files:**
- Modify: `src/screens/curate/AskOnayScreen.tsx`

- [ ] **Step 1: Replace handlePublishFeatured with sheet state**

In `src/screens/curate/AskOnayScreen.tsx`:

Add near the top of the file (alongside other imports):

```ts
import { PublishFeaturedSheet } from '../../components/broadcast/PublishFeaturedSheet';
import type { PublishFeaturedRequest } from '../../engines/BroadcastCurationClient';
```

Inside `AskOnayScreen`, alongside the existing `publishing` state, add:

```ts
const [publishSheetFor, setPublishSheetFor] = useState<CuratedPlaylist | null>(null);
const [publishError, setPublishError] = useState<string | null>(null);
```

Replace the entire `handlePublishFeatured` callback (lines ~300-351) with:

```ts
const handlePublishFeatured = useCallback((playlist: CuratedPlaylist) => {
  setPublishError(null);
  setPublishSheetFor(playlist);
}, []);

const handlePublishSubmit = useCallback(async (
  partial: Omit<PublishFeaturedRequest, 'tracks' | 'artworkUrl'>,
) => {
  const playlist = publishSheetFor;
  if (!playlist || publishing) return;
  setPublishing(true);
  setPublishError(null);
  try {
    const client = new BroadcastCurationClient();
    await client.publishFeatured({
      ...partial,
      artworkUrl: playlist.tracks[0]?.artworkUrl,
      tracks: playlist.tracks.map(t => ({
        id: t.id,
        title: t.title,
        artistName: t.artistName,
        albumTitle: t.albumTitle ?? '',
        duration: t.duration ?? 180,
        artworkUrl: t.artworkUrl,
        genreNames: t.genreNames,
      })),
    });
    setPublishSheetFor(null);
    Alert.alert('Published', `"${partial.title}" is now on Tonight on ONAY.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Publish failed.';
    setPublishError(msg);
  } finally {
    setPublishing(false);
  }
}, [publishSheetFor, publishing]);
```

Find the JSX block that renders `<KeyboardAvoidingView>` (the screen root) and just before it closes, add the sheet:

```tsx
{publishSheetFor && (
  <PublishFeaturedSheet
    visible={!!publishSheetFor}
    sessionVibe={publishSheetFor.suggestedVibe}
    defaultTitle={publishSheetFor.playlistTitle}
    defaultDescription={publishSheetFor.playlistDescription}
    defaultVibe={publishSheetFor.suggestedVibe}
    defaultLength={
      publishSheetFor.trackIds.length >= 15 ? 'long'
      : publishSheetFor.trackIds.length >= 9 ? 'standard'
      : 'quick'
    }
    publishing={publishing}
    error={publishError}
    onClose={() => { setPublishSheetFor(null); setPublishError(null); }}
    onSubmit={handlePublishSubmit}
  />
)}
```

- [ ] **Step 2: Type-check + run existing tests**

Run: `npx tsc --noEmit && npm test`
Expected: PASS (no tests touch AskOnayScreen specifically; we're just confirming no regressions).

- [ ] **Step 3: Commit**

```bash
git add src/screens/curate/AskOnayScreen.tsx
git commit -m "feat(client): wire PublishFeaturedSheet into AskOnayScreen"
```

---

## Task 9: SlotPlaceholderCard Component

**Files:**
- Create: `src/components/broadcast/SlotPlaceholderCard.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/broadcast/SlotPlaceholderCard.tsx`:

```tsx
import { StyleSheet, Text, View } from 'react-native';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import { Halftone } from '../crate/Halftone';

interface Props {
  slotLabel: 'MORNING' | 'EVENING';
}

/** Matches the outer shape of FeaturedBroadcastCard so the twin-slot
 *  stack stays visually consistent whether baked or not. */
export function SlotPlaceholderCard({ slotLabel }: Props) {
  return (
    <View style={styles.wrap} accessible accessibilityLabel={`Tonight's ${slotLabel.toLowerCase()} coming up`}>
      <View style={styles.plate}>
        <Halftone opacity={0.3} />
        <View style={styles.plateRow}>
          <Text style={styles.plateLabel}>TONIGHT ON ONAY</Text>
          <Text style={styles.plateStamp}>{slotLabel}</Text>
        </View>
      </View>
      <View style={styles.card}>
        <View style={styles.meta}>
          <Text style={styles.title}>COMING UP</Text>
          <Text style={styles.tagline}>ONAY is between tracks.</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: Space.s14, opacity: 0.55 },
  plate: {
    backgroundColor: AM.oxblood,
    paddingVertical: 6, paddingHorizontal: 10, overflow: 'hidden',
  },
  plateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  plateLabel: { fontFamily: Fonts.mono, fontSize: TypeScale.s9, color: AM.cream, letterSpacing: 3 },
  plateStamp:  { fontFamily: Fonts.mono, fontSize: TypeScale.s9, color: AM.cream, letterSpacing: 2, opacity: 0.85 },

  card: {
    borderWidth: 1, borderTopWidth: 0, borderColor: AM.oxblood,
    paddingVertical: Space.s20, paddingHorizontal: Space.s14,
    minHeight: 120, justifyContent: 'center',
  },
  meta: {},
  title:   { fontFamily: Fonts.display, fontSize: TypeScale.s22, color: AM.inkMid, letterSpacing: 0.3 },
  tagline: { marginTop: 6, fontFamily: Fonts.serif, fontStyle: 'italic', fontSize: TypeScale.s12, color: AM.inkMid },
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/broadcast/SlotPlaceholderCard.tsx
git commit -m "feat(client): SlotPlaceholderCard for empty Tonight-on-ONAY slots"
```

---

## Task 10: FeaturedBroadcastCard — Slot Label Prop

**Files:**
- Modify: `src/components/broadcast/FeaturedBroadcastCard.tsx`

- [ ] **Step 1: Add slotLabel prop**

In `src/components/broadcast/FeaturedBroadcastCard.tsx`:

Update the `Props` interface:

```ts
interface Props {
  broadcast: FeaturedBroadcast;
  onPress: () => void;
  stamp?: string;
  tagline?: string;
  /** When set, replaces the default "TONIGHT" stamp and bumps letter-spacing.
   *  Used by the twin-slot home layout to distinguish morning vs evening. */
  slotLabel?: string;
}
```

Update the function signature and the `stamp` usage. Replace:

```tsx
export function FeaturedBroadcastCard({ broadcast, onPress, stamp = 'TONIGHT', tagline }: Props) {
```

with:

```tsx
export function FeaturedBroadcastCard({ broadcast, onPress, stamp = 'TONIGHT', tagline, slotLabel }: Props) {
  const displayStamp = slotLabel ?? stamp;
```

Then replace `{stamp.toUpperCase()}` in the JSX with `{displayStamp.toUpperCase()}`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/broadcast/FeaturedBroadcastCard.tsx
git commit -m "feat(client): FeaturedBroadcastCard slotLabel prop"
```

---

## Task 11: HomeBroadcastScreen — Twin-Slot Layout

**Files:**
- Modify: `src/screens/home/HomeBroadcastScreen.tsx`

- [ ] **Step 1: Import new pieces and derive slot cards**

In `src/screens/home/HomeBroadcastScreen.tsx`:

Add imports:

```ts
import { SlotPlaceholderCard } from '../../components/broadcast/SlotPlaceholderCard';
```

Find where the featured broadcasts list is produced (search for `hero` + `rest` — likely derived from the `broadcasts` array via `.slice()` or similar). Replace the derivation with:

```ts
const morningCard = broadcasts.find(b => b.slot === 'morning') ?? null;
const eveningCard = broadcasts.find(b => b.slot === 'evening') ?? null;
const legacyCards = broadcasts.filter(b => !b.slot);
const lead = morningCard ?? eveningCard ?? null;
```

- [ ] **Step 2: Replace the hero + rail JSX**

Replace the block starting with `{/* TONIGHT ON ONAY hero */}` (line ~292) through the end of the `{rest.length > 0 && ...}` rail (around line ~325) with:

```tsx
{/* TONIGHT ON ONAY — twin-slot stack */}
{morningCard ? (
  <FeaturedBroadcastCard
    broadcast={morningCard}
    onPress={() => playFeatured(morningCard)}
    tagline={morningCard.description}
    slotLabel="MORNING"
  />
) : (
  <SlotPlaceholderCard slotLabel="MORNING" />
)}

{eveningCard ? (
  <FeaturedBroadcastCard
    broadcast={eveningCard}
    onPress={() => playFeatured(eveningCard)}
    tagline={eveningCard.description}
    slotLabel="EVENING"
  />
) : (
  <SlotPlaceholderCard slotLabel="EVENING" />
)}

{legacyCards.length > 0 && (
  <>
    <Text style={styles.moreLabel}>MORE FROM ONAY</Text>
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
      snapToInterval={162}
      decelerationRate="fast"
      snapToAlignment="start"
    >
      {legacyCards.map(fb => (
        <FeaturedRailCard key={fb.id} broadcast={fb} onPress={() => playFeatured(fb)} />
      ))}
    </ScrollView>
  </>
)}
```

- [ ] **Step 3: Update the liner-notes derivation**

Find the existing `LinerNotes` block that referenced `hero`. Replace `hero?.description` with `lead?.description` in both places.

- [ ] **Step 4: Add the new `moreLabel` style**

In the `StyleSheet.create({ ... })` block near the bottom, add:

```ts
moreLabel: {
  marginTop: Space.s22,
  marginBottom: Space.s6,
  color: AM.amber,
  fontFamily: Fonts.mono,
  fontSize: TypeScale.s9,
  letterSpacing: 2.5,
},
```

(Confirm `AM`, `Fonts`, `TypeScale`, `Space` are already imported at the top. If any are missing, add them to the existing `design-tokens` import.)

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/screens/home/HomeBroadcastScreen.tsx
git commit -m "feat(client): HomeBroadcastScreen twin-slot layout + More from ONAY rail"
```

---

## Task 12: Full Test Pass + Manual Regression

**Files:**
- Run: full server + client test suites; exercise the device flow.

- [ ] **Step 1: Run the full server test suite**

Run: `cd server && npm test`
Expected: PASS — all pre-existing + ~9 new tests.

- [ ] **Step 2: Run the client test suite**

Run: `npm test`
Expected: PASS — all pre-existing + ~6 new tests.

- [ ] **Step 3: Start the dev server + open in Expo**

Run (two terminals):
- `cd server && npm run dev`
- `EXPO_PUBLIC_API_URL=http://<LAN-IP>:3001 npx expo start`

Device manual checks:

- [ ] **Check A — Home empty state.** If the registry has no slot records, both slot cards render as `SlotPlaceholderCard` ("COMING UP"). Legacy "More from ONAY" row is hidden when there are no legacy records.
- [ ] **Check B — Ask ONAY free-form still works.** Curate → Publish → pick Free-form → enter title/description → Publish. Record shows up under "More from ONAY" rail (no slot).
- [ ] **Check C — Ask ONAY Morning slot publish.** Curate → Publish → pick Tonight's Morning → confirm without overriding → Publish. Home screen Morning card replaces the placeholder, shows `MORNING` label, correct title/description.
- [ ] **Check D — Slot day override.** Publish → Tonight's Evening → switch day to a non-today chip → title/description/vibe chip update. Publish — registry record shows `themeDay` equal to the overridden day.
- [ ] **Check E — Re-bake replaces.** Publish Morning twice. Registry has exactly one Morning record with the newer `createdAt`.
- [ ] **Check F — Vibe-mismatch warning.** Curate with a playlist whose `suggestedVibe === 'party'`. Open the sheet, pick Tonight's Morning (vibe `morning`). Warning band shows. Publishing still succeeds; the baked broadcast's manifest uses the slot's `morning` vibe.
- [ ] **Check G — Reserved id blocked.** Hit `POST /broadcast/featured/publish` with curl and `{"id":"slot_morning", ...no slot field...}`. Server returns 400 with the reserved-id error.

- [ ] **Step 4: Final commit if anything was tweaked during manual pass**

```bash
# Only if you made any small adjustments during the manual pass.
git add -p
git commit -m "polish: tonight-on-onay manual-regression fixes"
```

---

## Self-Review Notes

- All spec sections have tasks:
  - Theme Library → Tasks 1, 2
  - Data Model → Task 3
  - Publish schema + route → Task 4
  - `GET /broadcast/featured` ordering → Task 3 (`list()` ordering change)
  - `BroadcastCurationClient` type parity → Task 5
  - `PublishFeaturedSheet` helpers → Task 6
  - `PublishFeaturedSheet` UI → Task 7
  - `AskOnayScreen` wiring → Task 8
  - `SlotPlaceholderCard` → Task 9
  - `FeaturedBroadcastCard` `slotLabel` → Task 10
  - `HomeBroadcastScreen` twin-slot → Task 11
  - Testing (server + client + manual) → Tasks 1, 3, 4, 6 (inline) + Task 12 (manual pass)

- Reserved-id guard (`^slot_`) for free-form publishes is implemented in Task 4's `superRefine` and tested in Task 4 step 1.

- Client `dayOfWeekFor(Date)` helper is introduced in Task 2 so Task 7 can consume it without extending the spec.

- Design tokens used match the live codebase (`AM`, `Fonts`, `TypeScale`, `Space`, `AMGlow`) rather than the spec's aspirational `Colors.accent`/`Surface.container` names — functionally equivalent, but grounded in real exports.
