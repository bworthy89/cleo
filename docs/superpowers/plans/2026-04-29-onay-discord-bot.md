# The Producer — ONAY Booth Discord Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement v1 of "The Producer" — the ONAY-branded Discord bot defined in `docs/superpowers/specs/2026-04-29-onay-discord-bot-design.md` — owning onboarding, application review, vote tally, bug-thread forwarding to GitHub, and the weekly vibe-pitch digest.

**Architecture:** Long-lived Node process running on the same Hostinger VPS as `cleo-broadcast`, registered as PM2 app `cleo-discord-bot`. Single TypeScript codebase under `server/src/discord-bot/`, one handler file per feature. State persisted as atomic-write JSON files under `server/.bot-state/`. Outbound calls only: Discord gateway WebSocket inbound, GitHub REST outbound. No new HTTP listener for v1.

**Tech Stack:** TypeScript (strict, ES2022, CommonJS) · `discord.js` v14 · `@octokit/rest` + `@octokit/plugin-throttling` · `node-cron` · `zod` (existing) · Jest + ts-jest (existing) · PM2

---

## File structure

**Created (new):**
- `server/src/discord-bot/index.ts` — gateway client, intent setup, event-router dispatch boundary
- `server/src/discord-bot/start-bot.ts` — PM2 entry point (calls `index.ts` bootstrap)
- `server/src/discord-bot/config.ts` — Zod env parsing + guild ID resolution
- `server/src/discord-bot/state.ts` — `BotStateStore` (atomic-write JSON files)
- `server/src/discord-bot/copy.ts` — all user-facing strings
- `server/src/discord-bot/github.ts` — Octokit wrapper (retry, label management, issue create)
- `server/src/discord-bot/handlers/onboarding.ts`
- `server/src/discord-bot/handlers/applicationReview.ts`
- `server/src/discord-bot/handlers/voteTally.ts`
- `server/src/discord-bot/handlers/bugForwarder.ts`
- `server/src/discord-bot/handlers/vibeDigest.ts`
- `server/__tests__/discord-bot/state.test.ts`
- `server/__tests__/discord-bot/config.test.ts`
- `server/__tests__/discord-bot/github.test.ts`
- `server/__tests__/discord-bot/handlers/onboarding.test.ts`
- `server/__tests__/discord-bot/handlers/applicationReview.test.ts`
- `server/__tests__/discord-bot/handlers/voteTally.test.ts`
- `server/__tests__/discord-bot/handlers/bugForwarder.test.ts`
- `server/__tests__/discord-bot/handlers/vibeDigest.test.ts`
- `server/__tests__/discord-bot/integration.test.ts`

**Modified:**
- `server/package.json` — add deps
- `server/.gitignore` — add `.bot-state/`
- `server/.env.example` — append Discord/GitHub keys
- `server/__tests__/setup.ts` — add Discord/GitHub test env vars
- `server/ecosystem.config.cjs` — add `cleo-discord-bot` app entry
- `server/DEPLOY.md` — append manual setup checklist + smoke-test checklist

---

## Working conventions

- **Logging.** Tagged `console.log` / `console.error` matching the existing server (`[bot:onboarding]`, `[bot:bugForwarder]`, etc.). No `pino` / `winston`.
- **Imports.** Tests use relative paths (`../../src/...`); the codebase doesn't use the `@/` alias in tests despite the tsconfig declaring it.
- **Test running.** `cd server && npm test -- <pattern>` for a single file, `npm test` for full suite.
- **Build.** `cd server && npm run build` produces `dist/discord-bot/start-bot.js` (the PM2 entry point).
- **Commits.** Every task ends with a commit. Use the existing message style (`feat(bot):`, `chore(bot):`, `test(bot):`).

---

## Task 1: Foundation — deps, scaffolding, gitignore, env stubs

**Files:**
- Modify: `server/package.json`
- Modify: `server/.gitignore`
- Modify: `server/.env.example`
- Modify: `server/__tests__/setup.ts`
- Create (empty/placeholder): `server/src/discord-bot/index.ts`, `server/src/discord-bot/start-bot.ts`, `server/.bot-state/.gitkeep`

This task installs deps and lays down the empty shell so subsequent tasks have somewhere to write code and tests can resolve env vars.

- [ ] **Step 1: Install runtime deps**

```bash
cd server && npm install --save discord.js@^14.16.0 @octokit/rest@^21.0.0 @octokit/plugin-throttling@^9.3.0 node-cron@^3.0.3
```

- [ ] **Step 2: Install dev deps**

```bash
cd server && npm install --save-dev @types/node-cron@^3.0.11 nock@^13.5.0
```

- [ ] **Step 3: Append `.bot-state/` to `server/.gitignore`**

Add this line just below the existing `.broadcast-cache/` entry:

```
.bot-state/
```

- [ ] **Step 4: Append bot env keys to `server/.env.example`**

Append this block to the end of the file:

```env

# ---- Discord bot (The Producer) ----
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_TESTFLIGHT_URL=
DISCORD_CHANNEL_START_HERE=
DISCORD_CHANNEL_APPLY=
DISCORD_CHANNEL_BUG_REPORTS=
DISCORD_CHANNEL_TONIGHT_ON_ONAY=
DISCORD_CHANNEL_VIBE_REQUESTS=
DISCORD_CHANNEL_WELCOME=
DISCORD_ROLE_PRODUCER=
DISCORD_ROLE_ON_AIR=
DISCORD_ROLE_CHARTER_LISTENER=
DISCORD_START_HERE_MESSAGE_ID=
DISCORD_START_HERE_EMOJI=📻
DISCORD_TIMEZONE=America/New_York

GITHUB_TOKEN=
GITHUB_BUG_REPO=bworthy89/cleo
GITHUB_BUG_LABEL=tester-report
```

- [ ] **Step 5: Append bot test env vars to `server/__tests__/setup.ts`**

Append:

```ts
process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
process.env.DISCORD_GUILD_ID = '111';
process.env.DISCORD_TESTFLIGHT_URL = 'https://testflight.apple.com/join/TEST';
process.env.DISCORD_CHANNEL_START_HERE = '201';
process.env.DISCORD_CHANNEL_APPLY = '202';
process.env.DISCORD_CHANNEL_BUG_REPORTS = '203';
process.env.DISCORD_CHANNEL_TONIGHT_ON_ONAY = '204';
process.env.DISCORD_CHANNEL_VIBE_REQUESTS = '205';
process.env.DISCORD_CHANNEL_WELCOME = '206';
process.env.DISCORD_ROLE_PRODUCER = '301';
process.env.DISCORD_ROLE_ON_AIR = '302';
process.env.DISCORD_ROLE_CHARTER_LISTENER = '303';
process.env.DISCORD_START_HERE_MESSAGE_ID = '401';
process.env.DISCORD_START_HERE_EMOJI = '📻';
process.env.DISCORD_TIMEZONE = 'America/New_York';
process.env.GITHUB_TOKEN = 'test-github-token';
process.env.GITHUB_BUG_REPO = 'bworthy89/cleo';
process.env.GITHUB_BUG_LABEL = 'tester-report';
```

- [ ] **Step 6: Create skeleton source files so `npm run build` succeeds**

`server/src/discord-bot/index.ts`:

```ts
export async function start(): Promise<void> {
  throw new Error('not implemented');
}
```

`server/src/discord-bot/start-bot.ts`:

```ts
import { start } from './index';

start().catch((err) => {
  console.error('[bot:bootstrap] fatal', err);
  process.exit(1);
});
```

`server/.bot-state/.gitkeep` — empty file.

- [ ] **Step 7: Verify build passes**

Run: `cd server && npm run build`
Expected: clean exit, `dist/discord-bot/start-bot.js` exists.

- [ ] **Step 8: Verify tests still pass**

Run: `cd server && npm test`
Expected: existing suite still green (we haven't broken anything).

- [ ] **Step 9: Commit**

```bash
git add server/package.json server/package-lock.json server/.gitignore server/.env.example server/__tests__/setup.ts server/src/discord-bot/ server/.bot-state/.gitkeep
git commit -m "chore(bot): scaffold discord-bot — deps, env stubs, empty modules"
```

---

## Task 2: Config module (`config.ts`)

**Files:**
- Create: `server/src/discord-bot/config.ts`
- Test: `server/__tests__/discord-bot/config.test.ts`

The bot's first runtime concern: parse env vars into a typed config object on boot. Fail fast on missing/invalid values rather than running half-configured.

- [ ] **Step 1: Write the failing test**

`server/__tests__/discord-bot/config.test.ts`:

```ts
import { loadBotConfig } from '../../src/discord-bot/config';

describe('loadBotConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('parses a valid env into a typed config', () => {
    const cfg = loadBotConfig();
    expect(cfg.discord.botToken).toBe('test-bot-token');
    expect(cfg.discord.guildId).toBe('111');
    expect(cfg.discord.testFlightUrl).toBe('https://testflight.apple.com/join/TEST');
    expect(cfg.discord.channels.startHere).toBe('201');
    expect(cfg.discord.channels.welcome).toBe('206');
    expect(cfg.discord.roles.producer).toBe('301');
    expect(cfg.discord.startHereMessageId).toBe('401');
    expect(cfg.discord.startHereEmoji).toBe('📻');
    expect(cfg.discord.timezone).toBe('America/New_York');
    expect(cfg.github.token).toBe('test-github-token');
    expect(cfg.github.bugRepo).toBe('bworthy89/cleo');
    expect(cfg.github.bugLabel).toBe('tester-report');
  });

  it('throws a descriptive error when DISCORD_BOT_TOKEN is missing', () => {
    delete process.env.DISCORD_BOT_TOKEN;
    expect(() => loadBotConfig()).toThrow(/DISCORD_BOT_TOKEN/);
  });

  it('throws when GITHUB_BUG_REPO is not in owner/repo form', () => {
    process.env.GITHUB_BUG_REPO = 'not-a-slug';
    expect(() => loadBotConfig()).toThrow(/GITHUB_BUG_REPO/);
  });

  it('defaults DISCORD_START_HERE_EMOJI to 📻 when unset', () => {
    delete process.env.DISCORD_START_HERE_EMOJI;
    const cfg = loadBotConfig();
    expect(cfg.discord.startHereEmoji).toBe('📻');
  });
});
```

- [ ] **Step 2: Run the test, expect fail**

Run: `cd server && npm test -- config.test.ts`
Expected: FAIL — `Cannot find module '../../src/discord-bot/config'`.

- [ ] **Step 3: Implement `config.ts`**

```ts
import { z } from 'zod';

const RepoSlug = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'must be in "owner/repo" form');

const EnvSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_TESTFLIGHT_URL: z.string().url(),
  DISCORD_CHANNEL_START_HERE: z.string().min(1),
  DISCORD_CHANNEL_APPLY: z.string().min(1),
  DISCORD_CHANNEL_BUG_REPORTS: z.string().min(1),
  DISCORD_CHANNEL_TONIGHT_ON_ONAY: z.string().min(1),
  DISCORD_CHANNEL_VIBE_REQUESTS: z.string().min(1),
  DISCORD_CHANNEL_WELCOME: z.string().min(1),
  DISCORD_ROLE_PRODUCER: z.string().min(1),
  DISCORD_ROLE_ON_AIR: z.string().min(1),
  DISCORD_ROLE_CHARTER_LISTENER: z.string().min(1),
  DISCORD_START_HERE_MESSAGE_ID: z.string().min(1),
  DISCORD_START_HERE_EMOJI: z.string().min(1).default('📻'),
  DISCORD_TIMEZONE: z.string().min(1).default('America/New_York'),
  GITHUB_TOKEN: z.string().min(1),
  GITHUB_BUG_REPO: RepoSlug,
  GITHUB_BUG_LABEL: z.string().min(1).default('tester-report'),
});

export interface BotConfig {
  discord: {
    botToken: string;
    guildId: string;
    testFlightUrl: string;
    startHereMessageId: string;
    startHereEmoji: string;
    timezone: string;
    channels: {
      startHere: string;
      apply: string;
      bugReports: string;
      tonightOnOnay: string;
      vibeRequests: string;
      welcome: string;
    };
    roles: {
      producer: string;
      onAir: string;
      charterListener: string;
    };
  };
  github: {
    token: string;
    bugRepo: string; // "owner/repo"
    bugLabel: string;
  };
}

export function loadBotConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n  ');
    throw new Error(`[bot:config] invalid env:\n  ${issues}`);
  }
  const e = parsed.data;
  return {
    discord: {
      botToken: e.DISCORD_BOT_TOKEN,
      guildId: e.DISCORD_GUILD_ID,
      testFlightUrl: e.DISCORD_TESTFLIGHT_URL,
      startHereMessageId: e.DISCORD_START_HERE_MESSAGE_ID,
      startHereEmoji: e.DISCORD_START_HERE_EMOJI,
      timezone: e.DISCORD_TIMEZONE,
      channels: {
        startHere: e.DISCORD_CHANNEL_START_HERE,
        apply: e.DISCORD_CHANNEL_APPLY,
        bugReports: e.DISCORD_CHANNEL_BUG_REPORTS,
        tonightOnOnay: e.DISCORD_CHANNEL_TONIGHT_ON_ONAY,
        vibeRequests: e.DISCORD_CHANNEL_VIBE_REQUESTS,
        welcome: e.DISCORD_CHANNEL_WELCOME,
      },
      roles: {
        producer: e.DISCORD_ROLE_PRODUCER,
        onAir: e.DISCORD_ROLE_ON_AIR,
        charterListener: e.DISCORD_ROLE_CHARTER_LISTENER,
      },
    },
    github: {
      token: e.GITHUB_TOKEN,
      bugRepo: e.GITHUB_BUG_REPO,
      bugLabel: e.GITHUB_BUG_LABEL,
    },
  };
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `cd server && npm test -- config.test.ts`
Expected: PASS, all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add server/src/discord-bot/config.ts server/__tests__/discord-bot/config.test.ts
git commit -m "feat(bot): config module with Zod env parsing"
```

---

## Task 3: State store (`state.ts`)

**Files:**
- Create: `server/src/discord-bot/state.ts`
- Test: `server/__tests__/discord-bot/state.test.ts`

JSON files under `server/.bot-state/`. Atomic tmp+rename writes, in-memory cache, 50ms debounce. Mirrors the existing `EnrichmentCache` idiom but smaller.

- [ ] **Step 1: Write the failing test**

`server/__tests__/discord-bot/state.test.ts`:

```ts
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BotStateStore } from '../../src/discord-bot/state';

describe('BotStateStore', () => {
  let dir: string;
  let store: BotStateStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-state-'));
    store = new BotStateStore(dir);
  });

  afterEach(async () => {
    await store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns the default when the file does not exist', async () => {
    const value = await store.read<{ x: number }>('missing.json', { x: 0 });
    expect(value).toEqual({ x: 0 });
  });

  it('round-trips an object via write + read', async () => {
    await store.write('thing.json', { a: 1, b: 'two' });
    await store.flush();
    const back = await store.read('thing.json', {});
    expect(back).toEqual({ a: 1, b: 'two' });
  });

  it('persists to disk atomically (no .tmp left behind)', async () => {
    await store.write('atomic.json', { ok: true });
    await store.flush();
    const entries = await fs.readdir(dir);
    expect(entries).toContain('atomic.json');
    expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
  });

  it('coalesces a burst of writes via the debounce', async () => {
    const writeSpy = jest.spyOn(fs, 'writeFile');
    for (let i = 0; i < 5; i++) {
      await store.write('debounced.json', { i });
    }
    await store.flush();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    writeSpy.mockRestore();
  });

  it('returns the default on malformed JSON instead of throwing', async () => {
    await fs.writeFile(path.join(dir, 'broken.json'), '{ this: is not json');
    const value = await store.read<{ ok: boolean }>('broken.json', { ok: false });
    expect(value).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Run the test, expect fail**

Run: `cd server && npm test -- state.test.ts`
Expected: FAIL — `Cannot find module`.

- [ ] **Step 3: Implement `state.ts`**

```ts
import { promises as fs } from 'fs';
import * as path from 'path';

const DEBOUNCE_MS = 50;

export class BotStateStore {
  private cache = new Map<string, unknown>();
  private pending = new Map<string, NodeJS.Timeout>();

  constructor(private readonly dir: string) {}

  async read<T>(filename: string, defaultValue: T): Promise<T> {
    if (this.cache.has(filename)) return this.cache.get(filename) as T;
    const filePath = path.join(this.dir, filename);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as T;
      this.cache.set(filename, parsed);
      return parsed;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return defaultValue;
      console.error(`[bot:state] malformed json ${filename}, returning default`, err);
      return defaultValue;
    }
  }

  async write<T>(filename: string, value: T): Promise<void> {
    this.cache.set(filename, value);
    const existing = this.pending.get(filename);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.flushOne(filename).catch((err) => {
        console.error(`[bot:state] flush failed for ${filename}`, err);
      });
    }, DEBOUNCE_MS);
    this.pending.set(filename, timer);
  }

  async flush(): Promise<void> {
    const filenames = Array.from(this.pending.keys());
    for (const filename of filenames) {
      const t = this.pending.get(filename);
      if (t) clearTimeout(t);
      this.pending.delete(filename);
      await this.flushOne(filename);
    }
  }

  private async flushOne(filename: string): Promise<void> {
    if (!this.cache.has(filename)) return;
    await fs.mkdir(this.dir, { recursive: true });
    const filePath = path.join(this.dir, filename);
    const tmpPath = `${filePath}.tmp`;
    const value = this.cache.get(filename);
    await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf-8');
    await fs.rename(tmpPath, filePath);
    this.pending.delete(filename);
  }
}

export interface BugEntry {
  status: 'filed' | 'pendingManual';
  repo: string;
  issueNumber?: number;
  filedAt?: string;
  lastErrorAt?: string;
}

export type BugThreadIssueMap = Record<string, BugEntry>;

export interface LastDigests {
  voteDigestAt?: string;
  vibeDigestAt?: string;
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `cd server && npm test -- state.test.ts`
Expected: PASS, all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add server/src/discord-bot/state.ts server/__tests__/discord-bot/state.test.ts
git commit -m "feat(bot): BotStateStore with atomic write + debounce"
```

---

## Task 4: Copy library (`copy.ts`)

**Files:**
- Create: `server/src/discord-bot/copy.ts`

Pure data — every user-facing string the bot emits, extracted from `docs/discord-beta-kit.md`. No tests; if a string is wrong the smoke test catches it.

- [ ] **Step 1: Implement `copy.ts`**

```ts
export const COPY = {
  approvalDM: (testFlightUrl: string): string => `Hey — you're in.

Welcome to the booth. You're one of the first people on Earth
to hear what ONAY sounds like, which means two things:

  → things will break. tell us when they do.
  → your taste is shaping the show. tell us what you think.

Your TestFlight link:
${testFlightUrl}

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

— The Producer`,

  waitlistDM: `Thanks for applying to the ONAY beta.

We're keeping the first wave small — like 25 people small —
to make sure the feedback loop stays tight. You're on the
waitlist for wave two, which we'll open in a few weeks.

Stay in the server if you want — #general and #vibe-requests
are open to everyone. The more we hear from you there, the
faster you move up the list.

— The Producer`,

  dmDisabledNudge: (userMention: string, link: string): string =>
    `${userMention} — couldn't DM you (DMs disabled). Your TestFlight link: ${link}`,

  notAuthorized: 'Only @Producer or @On-Air can review applications.',
  applicationPostMissing: "Couldn't find that application post (was it deleted?).",
  approvedFooter: (reviewerMention: string): string =>
    `\n\n✅ Approved by ${reviewerMention}`,
  waitlistedFooter: (reviewerMention: string): string =>
    `\n\n⏳ Waitlisted by ${reviewerMention}`,

  bugFiled: (repo: string, issueNumber: number): string =>
    `Filed → ${repo}#${issueNumber}`,
  bugFileFailed:
    "Couldn't file this one — Producer will pick it up manually.",
  bugTruncated: '\n\n…(truncated)',
  bugBodyFooter: (username: string, threadUrl: string): string =>
    `\n\n---\n_Filed from Discord by @${username} — [thread link](${threadUrl})_`,

  voteDigestHeader: '🎙 LAST NIGHT\'S VOTES',
  voteDigestRow: (excerpt: string, count: number, ship: boolean): string =>
    `• ${excerpt} — ${count} 🔥 — ${ship ? 'SHIP IT' : 'no ship'}`,

  vibeDigestHeader: '🔥 THIS WEEK\'S VIBE PITCHES',
  vibeDigestTopRow: (
    rank: number,
    count: number,
    author: string,
    excerpt: string,
    jumpUrl: string
  ): string =>
    `${rank}. ${count} 🔥 — @${author}: "${excerpt}" → ${jumpUrl}`,
  vibeDigestHonorableHeader: '\nHonorable mentions:',
  vibeDigestHonorableRow: (author: string, excerpt: string): string =>
    `• @${author}: "${excerpt}"`,
};
```

- [ ] **Step 2: Verify build**

Run: `cd server && npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add server/src/discord-bot/copy.ts
git commit -m "feat(bot): copy library extracted from discord-beta-kit"
```

---

## Task 5: GitHub wrapper (`github.ts`)

**Files:**
- Create: `server/src/discord-bot/github.ts`
- Test: `server/__tests__/discord-bot/github.test.ts`

Wraps Octokit. Single concern: create issues with retry-on-failure. The throttling plugin is wired in defensively so secondary rate limits don't 429-cascade.

- [ ] **Step 1: Write the failing test**

`server/__tests__/discord-bot/github.test.ts`:

```ts
import nock from 'nock';
import { GitHubClient } from '../../src/discord-bot/github';

const TOKEN = 'test-github-token';
const REPO = 'bworthy89/cleo';

describe('GitHubClient', () => {
  beforeEach(() => {
    nock.disableNetConnect();
  });
  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('creates an issue and returns the issue number', async () => {
    nock('https://api.github.com')
      .post(`/repos/${REPO}/issues`, (body) => {
        expect(body.title).toBe('Crash on bake');
        expect(body.body).toContain('Filed from Discord');
        expect(body.labels).toEqual(['crash', 'tester-report']);
        return true;
      })
      .reply(201, { number: 142, html_url: `https://github.com/${REPO}/issues/142` });

    const client = new GitHubClient({ token: TOKEN, repo: REPO });
    const result = await client.createIssue({
      title: 'Crash on bake',
      body: 'Steps...\n\n---\n_Filed from Discord by @kari — [thread](https://x)_',
      labels: ['crash', 'tester-report'],
    });
    expect(result.number).toBe(142);
  });

  it('retries on transient 5xx then succeeds', async () => {
    nock('https://api.github.com')
      .post(`/repos/${REPO}/issues`)
      .reply(500, { message: 'Server error' });
    nock('https://api.github.com')
      .post(`/repos/${REPO}/issues`)
      .reply(201, { number: 7, html_url: 'https://x' });

    const client = new GitHubClient({
      token: TOKEN,
      repo: REPO,
      retryDelaysMs: [10, 10, 10],
    });
    const result = await client.createIssue({ title: 't', body: 'b', labels: [] });
    expect(result.number).toBe(7);
  });

  it('throws after exhausting all retries', async () => {
    for (let i = 0; i < 3; i++) {
      nock('https://api.github.com')
        .post(`/repos/${REPO}/issues`)
        .reply(500, { message: 'Server error' });
    }

    const client = new GitHubClient({
      token: TOKEN,
      repo: REPO,
      retryDelaysMs: [5, 5, 5],
    });
    await expect(
      client.createIssue({ title: 't', body: 'b', labels: [] })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test, expect fail**

Run: `cd server && npm test -- github.test.ts`
Expected: FAIL — `Cannot find module`.

- [ ] **Step 3: Implement `github.ts`**

```ts
import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';

const ThrottledOctokit = Octokit.plugin(throttling);

export interface GitHubClientOptions {
  token: string;
  repo: string; // "owner/repo"
  retryDelaysMs?: number[]; // default [1000, 4000, 16000]
}

export interface CreateIssueInput {
  title: string;
  body: string;
  labels: string[];
}

export interface CreateIssueResult {
  number: number;
  htmlUrl: string;
}

const DEFAULT_RETRY_DELAYS = [1_000, 4_000, 16_000];

export class GitHubClient {
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repoName: string;
  private readonly retryDelaysMs: number[];

  constructor(opts: GitHubClientOptions) {
    const [owner, repoName] = opts.repo.split('/');
    if (!owner || !repoName) throw new Error(`bad repo slug: ${opts.repo}`);
    this.owner = owner;
    this.repoName = repoName;
    this.retryDelaysMs = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;
    this.octokit = new ThrottledOctokit({
      auth: opts.token,
      throttle: {
        onRateLimit: (retryAfter, options, _o, retryCount) => {
          if (retryCount < 1) return true;
          return false;
        },
        onSecondaryRateLimit: () => true,
      },
    });
  }

  async createIssue(input: CreateIssueInput): Promise<CreateIssueResult> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
      try {
        const res = await this.octokit.rest.issues.create({
          owner: this.owner,
          repo: this.repoName,
          title: input.title,
          body: input.body,
          labels: input.labels,
        });
        return { number: res.data.number, htmlUrl: res.data.html_url };
      } catch (err) {
        lastErr = err;
        if (attempt < this.retryDelaysMs.length) {
          await new Promise((r) => setTimeout(r, this.retryDelaysMs[attempt]));
        }
      }
    }
    throw lastErr;
  }
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `cd server && npm test -- github.test.ts`
Expected: PASS, all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add server/src/discord-bot/github.ts server/__tests__/discord-bot/github.test.ts
git commit -m "feat(bot): GitHubClient with retry on transient failure"
```

---

## Task 6: Onboarding handler (`handlers/onboarding.ts`)

**Files:**
- Create: `server/src/discord-bot/handlers/onboarding.ts`
- Test: `server/__tests__/discord-bot/handlers/onboarding.test.ts`

The handlers are pure functions that receive injected dependencies (Discord client surface + config + state). This makes them trivially testable without mocking `discord.js` itself — we pass in shapes that quack like the real client.

- [ ] **Step 1: Write the failing test**

`server/__tests__/discord-bot/handlers/onboarding.test.ts`:

```ts
import { handleStartHereReaction } from '../../../src/discord-bot/handlers/onboarding';
import type { BotConfig } from '../../../src/discord-bot/config';

const config: BotConfig = {
  discord: {
    botToken: 't',
    guildId: '111',
    testFlightUrl: 'https://tf/JOIN',
    startHereMessageId: '401',
    startHereEmoji: '📻',
    timezone: 'America/New_York',
    channels: {
      startHere: '201',
      apply: '202',
      bugReports: '203',
      tonightOnOnay: '204',
      vibeRequests: '205',
      welcome: '206',
    },
    roles: { producer: '301', onAir: '302', charterListener: '303' },
  },
  github: { token: 'g', bugRepo: 'a/b', bugLabel: 'tester-report' },
};

function makeMember(opts: { hasCharter: boolean; dmThrows?: boolean }) {
  const sent: string[] = [];
  const added: string[] = [];
  return {
    user: { id: 'u1', username: 'kari', toString: () => '<@u1>' },
    roles: {
      cache: new Map(opts.hasCharter ? [['303', {}]] : []),
      add: jest.fn().mockImplementation(async (roleId: string) => {
        added.push(roleId);
      }),
    },
    send: jest.fn().mockImplementation(async (content: string) => {
      if (opts.dmThrows) throw new Error('Cannot send messages to this user');
      sent.push(content);
    }),
    sent,
    added,
  };
}

describe('handleStartHereReaction', () => {
  function makeCtx(member: ReturnType<typeof makeMember>) {
    const welcomeSends: string[] = [];
    return {
      config,
      reaction: { messageId: '401', emoji: '📻' },
      reactor: { id: 'u1' },
      fetchMember: jest.fn().mockResolvedValue(member),
      sendInWelcome: jest.fn().mockImplementation(async (s: string) => {
        welcomeSends.push(s);
      }),
      welcomeSends,
    };
  }

  it('grants the role and DMs the TestFlight link', async () => {
    const member = makeMember({ hasCharter: false });
    const ctx = makeCtx(member);
    await handleStartHereReaction(ctx);
    expect(member.added).toEqual(['303']);
    expect(member.sent[0]).toContain('https://tf/JOIN');
    expect(member.sent[0]).toContain("you're in");
    expect(ctx.welcomeSends).toEqual([]);
  });

  it('no-ops when reactor already has @Charter Listener', async () => {
    const member = makeMember({ hasCharter: true });
    const ctx = makeCtx(member);
    await handleStartHereReaction(ctx);
    expect(member.added).toEqual([]);
    expect(member.sent).toEqual([]);
  });

  it('falls back to a #welcome nudge when DM is disabled', async () => {
    const member = makeMember({ hasCharter: false, dmThrows: true });
    const ctx = makeCtx(member);
    await handleStartHereReaction(ctx);
    expect(member.added).toEqual(['303']);
    expect(ctx.welcomeSends).toHaveLength(1);
    expect(ctx.welcomeSends[0]).toContain('https://tf/JOIN');
  });

  it('ignores reactions on other messages', async () => {
    const member = makeMember({ hasCharter: false });
    const ctx = makeCtx(member);
    ctx.reaction = { messageId: '999', emoji: '📻' };
    await handleStartHereReaction(ctx);
    expect(member.added).toEqual([]);
  });

  it('ignores reactions with the wrong emoji', async () => {
    const member = makeMember({ hasCharter: false });
    const ctx = makeCtx(member);
    ctx.reaction = { messageId: '401', emoji: '👍' };
    await handleStartHereReaction(ctx);
    expect(member.added).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test, expect fail**

Run: `cd server && npm test -- onboarding.test.ts`
Expected: FAIL — `Cannot find module`.

- [ ] **Step 3: Implement `handlers/onboarding.ts`**

```ts
import { COPY } from '../copy';
import type { BotConfig } from '../config';

export interface MemberLike {
  user: { id: string; username: string; toString(): string };
  roles: {
    cache: Map<string, unknown> | { has(id: string): boolean };
    add(roleId: string): Promise<unknown>;
  };
  send(content: string): Promise<unknown>;
}

export interface OnboardingContext {
  config: BotConfig;
  reaction: { messageId: string; emoji: string };
  reactor: { id: string };
  fetchMember(userId: string): Promise<MemberLike>;
  sendInWelcome(content: string): Promise<unknown>;
}

function memberHasRole(member: MemberLike, roleId: string): boolean {
  const cache = member.roles.cache;
  if (cache instanceof Map) return cache.has(roleId);
  return (cache as { has(id: string): boolean }).has(roleId);
}

export async function handleStartHereReaction(ctx: OnboardingContext): Promise<void> {
  const { config, reaction } = ctx;
  if (reaction.messageId !== config.discord.startHereMessageId) return;
  if (reaction.emoji !== config.discord.startHereEmoji) return;

  const member = await ctx.fetchMember(ctx.reactor.id);
  const charterRole = config.discord.roles.charterListener;
  if (memberHasRole(member, charterRole)) {
    console.log(`[bot:onboarding] event=already-charter actor=${ctx.reactor.id}`);
    return;
  }

  await member.roles.add(charterRole);
  console.log(`[bot:onboarding] event=role-granted actor=${ctx.reactor.id}`);

  const dm = COPY.approvalDM(config.discord.testFlightUrl);
  try {
    await member.send(dm);
    console.log(`[bot:onboarding] event=dm-sent actor=${ctx.reactor.id}`);
  } catch (err) {
    console.error(
      `[bot:onboarding] event=dm-failed actor=${ctx.reactor.id} fallback=welcome-nudge`,
      err
    );
    await ctx.sendInWelcome(
      COPY.dmDisabledNudge(member.user.toString(), config.discord.testFlightUrl)
    );
  }
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `cd server && npm test -- onboarding.test.ts`
Expected: PASS, all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add server/src/discord-bot/handlers/onboarding.ts server/__tests__/discord-bot/handlers/onboarding.test.ts
git commit -m "feat(bot): onboarding handler — role grant + TestFlight DM"
```

---

## Task 7: Application review handler (`handlers/applicationReview.ts`)

**Files:**
- Create: `server/src/discord-bot/handlers/applicationReview.ts`
- Test: `server/__tests__/discord-bot/handlers/applicationReview.test.ts`

Two entry points: a 📻 reaction by the post author attaches buttons; a button click by Producer/On-Air finalizes the decision.

- [ ] **Step 1: Write the failing test**

`server/__tests__/discord-bot/handlers/applicationReview.test.ts`:

```ts
import {
  handleApplyReaction,
  handleReviewButton,
  buildApproveCustomId,
  buildWaitlistCustomId,
  parseReviewCustomId,
} from '../../../src/discord-bot/handlers/applicationReview';
import type { BotConfig } from '../../../src/discord-bot/config';

const config: BotConfig = {
  discord: {
    botToken: 't',
    guildId: '111',
    testFlightUrl: 'https://tf/JOIN',
    startHereMessageId: '401',
    startHereEmoji: '📻',
    timezone: 'America/New_York',
    channels: {
      startHere: '201',
      apply: '202',
      bugReports: '203',
      tonightOnOnay: '204',
      vibeRequests: '205',
      welcome: '206',
    },
    roles: { producer: '301', onAir: '302', charterListener: '303' },
  },
  github: { token: 'g', bugRepo: 'a/b', bugLabel: 'tester-report' },
};

describe('parseReviewCustomId', () => {
  it('round-trips approve', () => {
    const id = buildApproveCustomId('m1', 'a1');
    expect(parseReviewCustomId(id)).toEqual({
      action: 'approve',
      messageId: 'm1',
      authorId: 'a1',
    });
  });
  it('round-trips waitlist', () => {
    const id = buildWaitlistCustomId('m2', 'a2');
    expect(parseReviewCustomId(id)).toEqual({
      action: 'waitlist',
      messageId: 'm2',
      authorId: 'a2',
    });
  });
  it('returns null for unrelated custom ids', () => {
    expect(parseReviewCustomId('something-else')).toBeNull();
  });
});

describe('handleApplyReaction', () => {
  function makeCtx(opts: {
    channelId: string;
    emoji: string;
    reactorId: string;
    authorId: string;
    alreadyHasButtons: boolean;
  }) {
    const replies: Array<{ components: unknown }> = [];
    return {
      config,
      reaction: { channelId: opts.channelId, emoji: opts.emoji },
      reactor: { id: opts.reactorId },
      message: {
        id: 'mApp',
        author: { id: opts.authorId },
        replies: opts.alreadyHasButtons
          ? [{ author: { bot: true }, components: [{}] }]
          : [],
        reply: jest.fn().mockImplementation(async (payload: unknown) => {
          replies.push(payload as { components: unknown });
        }),
      },
      replies,
    };
  }

  it('attaches buttons when the author 📻-reacts to their own post in #apply', async () => {
    const ctx = makeCtx({
      channelId: '202',
      emoji: '📻',
      reactorId: 'aX',
      authorId: 'aX',
      alreadyHasButtons: false,
    });
    await handleApplyReaction(ctx);
    expect(ctx.replies).toHaveLength(1);
    const rendered = JSON.stringify(ctx.replies[0]);
    expect(rendered).toContain('approve:mApp:aX');
    expect(rendered).toContain('waitlist:mApp:aX');
  });

  it('no-ops when reactor is not the author', async () => {
    const ctx = makeCtx({
      channelId: '202',
      emoji: '📻',
      reactorId: 'someoneElse',
      authorId: 'aX',
      alreadyHasButtons: false,
    });
    await handleApplyReaction(ctx);
    expect(ctx.replies).toHaveLength(0);
  });

  it('no-ops when buttons already exist', async () => {
    const ctx = makeCtx({
      channelId: '202',
      emoji: '📻',
      reactorId: 'aX',
      authorId: 'aX',
      alreadyHasButtons: true,
    });
    await handleApplyReaction(ctx);
    expect(ctx.replies).toHaveLength(0);
  });

  it('no-ops in other channels', async () => {
    const ctx = makeCtx({
      channelId: '999',
      emoji: '📻',
      reactorId: 'aX',
      authorId: 'aX',
      alreadyHasButtons: false,
    });
    await handleApplyReaction(ctx);
    expect(ctx.replies).toHaveLength(0);
  });
});

describe('handleReviewButton', () => {
  function makeCtx(opts: {
    customId: string;
    clickerHasProducer?: boolean;
    clickerHasOnAir?: boolean;
    appPostExists?: boolean;
    authorDmThrows?: boolean;
  }) {
    const ephemerals: string[] = [];
    const dms: string[] = [];
    const edits: Array<{ content?: string; components?: unknown[] }> = [];
    const roleAdds: string[] = [];
    const welcomeSends: string[] = [];

    return {
      config,
      interaction: {
        customId: opts.customId,
        memberRoles: new Map<string, unknown>([
          ...(opts.clickerHasProducer ? [['301' as const, {}]] : []),
          ...(opts.clickerHasOnAir ? [['302' as const, {}]] : []),
        ]),
        reviewer: { id: 'rev1', toString: () => '<@rev1>' },
        replyEphemeral: jest.fn().mockImplementation(async (s: string) => {
          ephemerals.push(s);
        }),
        editButtonsMessage: jest
          .fn()
          .mockImplementation(async (payload: { content?: string; components?: unknown[] }) => {
            edits.push(payload);
          }),
      },
      fetchAppMessage: jest.fn().mockImplementation(async () => {
        if (!opts.appPostExists) throw new Error('Unknown Message');
        return { id: 'mApp', content: 'application body' };
      }),
      fetchAuthorMember: jest.fn().mockResolvedValue({
        user: {
          id: 'aX',
          username: 'kari',
          toString: () => '<@aX>',
        },
        roles: {
          cache: new Map(),
          add: jest.fn().mockImplementation(async (roleId: string) => {
            roleAdds.push(roleId);
          }),
        },
        send: jest.fn().mockImplementation(async (s: string) => {
          if (opts.authorDmThrows) throw new Error('dm closed');
          dms.push(s);
        }),
      }),
      sendInWelcome: jest.fn().mockImplementation(async (s: string) => {
        welcomeSends.push(s);
      }),
      ephemerals,
      dms,
      edits,
      roleAdds,
      welcomeSends,
    };
  }

  it('rejects non-Producer non-OnAir clicks ephemerally', async () => {
    const ctx = makeCtx({
      customId: buildApproveCustomId('mApp', 'aX'),
      appPostExists: true,
    });
    await handleReviewButton(ctx);
    expect(ctx.ephemerals).toHaveLength(1);
    expect(ctx.ephemerals[0]).toContain('Producer');
    expect(ctx.roleAdds).toEqual([]);
  });

  it('approve grants role, DMs author, edits buttons message', async () => {
    const ctx = makeCtx({
      customId: buildApproveCustomId('mApp', 'aX'),
      clickerHasProducer: true,
      appPostExists: true,
    });
    await handleReviewButton(ctx);
    expect(ctx.roleAdds).toEqual(['303']);
    expect(ctx.dms).toHaveLength(1);
    expect(ctx.dms[0]).toContain('https://tf/JOIN');
    expect(ctx.edits).toHaveLength(1);
    expect(ctx.edits[0].components).toEqual([]);
    expect(ctx.edits[0].content).toContain('Approved by <@rev1>');
  });

  it('waitlist DMs author with the waitlist copy and edits buttons message', async () => {
    const ctx = makeCtx({
      customId: buildWaitlistCustomId('mApp', 'aX'),
      clickerHasOnAir: true,
      appPostExists: true,
    });
    await handleReviewButton(ctx);
    expect(ctx.roleAdds).toEqual([]);
    expect(ctx.dms).toHaveLength(1);
    expect(ctx.dms[0]).toContain('waitlist');
    expect(ctx.edits[0].content).toContain('Waitlisted by <@rev1>');
  });

  it('handles deleted application post by replying ephemerally', async () => {
    const ctx = makeCtx({
      customId: buildApproveCustomId('mApp', 'aX'),
      clickerHasProducer: true,
      appPostExists: false,
    });
    await handleReviewButton(ctx);
    expect(ctx.ephemerals).toHaveLength(1);
    expect(ctx.ephemerals[0]).toContain("Couldn't find");
    expect(ctx.roleAdds).toEqual([]);
  });

  it('falls back to #welcome nudge on approve when DM closed', async () => {
    const ctx = makeCtx({
      customId: buildApproveCustomId('mApp', 'aX'),
      clickerHasProducer: true,
      appPostExists: true,
      authorDmThrows: true,
    });
    await handleReviewButton(ctx);
    expect(ctx.roleAdds).toEqual(['303']);
    expect(ctx.welcomeSends).toHaveLength(1);
    expect(ctx.welcomeSends[0]).toContain('https://tf/JOIN');
  });
});
```

- [ ] **Step 2: Run the test, expect fail**

Run: `cd server && npm test -- applicationReview.test.ts`
Expected: FAIL — `Cannot find module`.

- [ ] **Step 3: Implement `handlers/applicationReview.ts`**

```ts
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { COPY } from '../copy';
import type { BotConfig } from '../config';
import type { MemberLike } from './onboarding';

export function buildApproveCustomId(messageId: string, authorId: string): string {
  return `approve:${messageId}:${authorId}`;
}
export function buildWaitlistCustomId(messageId: string, authorId: string): string {
  return `waitlist:${messageId}:${authorId}`;
}

export interface ParsedReviewCustomId {
  action: 'approve' | 'waitlist';
  messageId: string;
  authorId: string;
}
export function parseReviewCustomId(customId: string): ParsedReviewCustomId | null {
  const parts = customId.split(':');
  if (parts.length !== 3) return null;
  const [action, messageId, authorId] = parts;
  if (action !== 'approve' && action !== 'waitlist') return null;
  if (!messageId || !authorId) return null;
  return { action, messageId, authorId };
}

export interface ApplyReactionContext {
  config: BotConfig;
  reaction: { channelId: string; emoji: string };
  reactor: { id: string };
  message: {
    id: string;
    author: { id: string };
    replies: Array<{ author: { bot: boolean }; components: unknown[] }>;
    reply(payload: { components: unknown[] }): Promise<unknown>;
  };
}

export async function handleApplyReaction(ctx: ApplyReactionContext): Promise<void> {
  const { config, reaction, reactor, message } = ctx;
  if (reaction.channelId !== config.discord.channels.apply) return;
  if (reaction.emoji !== config.discord.startHereEmoji) return;
  if (reactor.id !== message.author.id) return;

  const alreadyAttached = message.replies.some(
    (r) => r.author.bot && Array.isArray(r.components) && r.components.length > 0
  );
  if (alreadyAttached) return;

  const approve = new ButtonBuilder()
    .setCustomId(buildApproveCustomId(message.id, message.author.id))
    .setLabel('Approve')
    .setStyle(ButtonStyle.Success);
  const waitlist = new ButtonBuilder()
    .setCustomId(buildWaitlistCustomId(message.id, message.author.id))
    .setLabel('Waitlist')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approve, waitlist);
  await message.reply({ components: [row] });
  console.log(`[bot:applicationReview] event=buttons-attached author=${message.author.id}`);
}

export interface ReviewButtonContext {
  config: BotConfig;
  interaction: {
    customId: string;
    memberRoles: Map<string, unknown> | { has(id: string): boolean };
    reviewer: { id: string; toString(): string };
    replyEphemeral(content: string): Promise<unknown>;
    editButtonsMessage(payload: { content?: string; components?: unknown[] }): Promise<unknown>;
  };
  fetchAppMessage(messageId: string): Promise<{ id: string; content: string }>;
  fetchAuthorMember(userId: string): Promise<MemberLike>;
  sendInWelcome(content: string): Promise<unknown>;
}

function rolesHas(roles: ReviewButtonContext['interaction']['memberRoles'], id: string): boolean {
  if (roles instanceof Map) return roles.has(id);
  return (roles as { has(id: string): boolean }).has(id);
}

export async function handleReviewButton(ctx: ReviewButtonContext): Promise<void> {
  const parsed = parseReviewCustomId(ctx.interaction.customId);
  if (!parsed) return;
  const { config, interaction } = ctx;

  const isAllowed =
    rolesHas(interaction.memberRoles, config.discord.roles.producer) ||
    rolesHas(interaction.memberRoles, config.discord.roles.onAir);
  if (!isAllowed) {
    await interaction.replyEphemeral(COPY.notAuthorized);
    return;
  }

  try {
    await ctx.fetchAppMessage(parsed.messageId);
  } catch {
    await interaction.replyEphemeral(COPY.applicationPostMissing);
    return;
  }

  const author = await ctx.fetchAuthorMember(parsed.authorId);

  if (parsed.action === 'approve') {
    await author.roles.add(config.discord.roles.charterListener);
    const dm = COPY.approvalDM(config.discord.testFlightUrl);
    try {
      await author.send(dm);
    } catch (err) {
      console.error(
        `[bot:applicationReview] event=dm-failed author=${parsed.authorId} fallback=welcome-nudge`,
        err
      );
      await ctx.sendInWelcome(
        COPY.dmDisabledNudge(author.user.toString(), config.discord.testFlightUrl)
      );
    }
    await interaction.editButtonsMessage({
      content: COPY.approvedFooter(interaction.reviewer.toString()),
      components: [],
    });
    console.log(
      `[bot:applicationReview] event=approved reviewer=${interaction.reviewer.id} author=${parsed.authorId}`
    );
  } else {
    try {
      await author.send(COPY.waitlistDM);
    } catch (err) {
      console.error(
        `[bot:applicationReview] event=waitlist-dm-failed author=${parsed.authorId}`,
        err
      );
    }
    await interaction.editButtonsMessage({
      content: COPY.waitlistedFooter(interaction.reviewer.toString()),
      components: [],
    });
    console.log(
      `[bot:applicationReview] event=waitlisted reviewer=${interaction.reviewer.id} author=${parsed.authorId}`
    );
  }
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `cd server && npm test -- applicationReview.test.ts`
Expected: PASS, all 9 cases.

- [ ] **Step 5: Commit**

```bash
git add server/src/discord-bot/handlers/applicationReview.ts server/__tests__/discord-bot/handlers/applicationReview.test.ts
git commit -m "feat(bot): application review — buttons + role/DM finalize"
```

---

## Task 8: Vote tally handler (`handlers/voteTally.ts`)

**Files:**
- Create: `server/src/discord-bot/handlers/voteTally.ts`
- Test: `server/__tests__/discord-bot/handlers/voteTally.test.ts`

Pure function: take a list of candidate messages with `🔥` reactor counts, produce a digest string. The cron wiring is wired in Task 11 (bootstrap), not here — the handler stays unit-testable without a clock.

- [ ] **Step 1: Write the failing test**

`server/__tests__/discord-bot/handlers/voteTally.test.ts`:

```ts
import {
  collectVoteCandidates,
  composeVoteDigest,
  SHIP_THRESHOLD,
} from '../../../src/discord-bot/handlers/voteTally';

interface TestMsg {
  id: string;
  authorId: string;
  content: string;
  fireReactors: string[]; // unique user ids who reacted with 🔥
}

describe('collectVoteCandidates', () => {
  it('keeps only Producer-role-authored messages containing 🎙', () => {
    const producers = new Set(['pro1', 'pro2']);
    const isProducer = (id: string) => producers.has(id);
    const messages: TestMsg[] = [
      { id: '1', authorId: 'pro1', content: '🎙 a candidate', fireReactors: [] },
      { id: '2', authorId: 'pro1', content: 'no glyph here', fireReactors: [] },
      { id: '3', authorId: 'tester', content: '🎙 not from producer', fireReactors: [] },
      { id: '4', authorId: 'pro2', content: '🎙 another', fireReactors: [] },
    ];
    const result = collectVoteCandidates(messages, isProducer);
    expect(result.map((m) => m.id)).toEqual(['1', '4']);
  });
});

describe('composeVoteDigest', () => {
  function cand(id: string, excerpt: string, count: number) {
    return {
      id,
      authorId: 'pro',
      content: `🎙 ${excerpt}\nrest`,
      fireReactors: Array.from({ length: count }, (_, i) => `u${id}-${i}`),
    };
  }

  it('marks SHIP IT when count >= threshold and no ship below', () => {
    const digest = composeVoteDigest([
      cand('1', 'Friday Jazz', SHIP_THRESHOLD),
      cand('2', 'Workout', SHIP_THRESHOLD - 1),
    ]);
    expect(digest).toContain("LAST NIGHT'S VOTES");
    expect(digest).toMatch(/Friday Jazz.*🔥 — SHIP IT/);
    expect(digest).toMatch(/Workout.*🔥 — no ship/);
  });

  it('returns null when there are no candidates', () => {
    expect(composeVoteDigest([])).toBeNull();
  });

  it('truncates excerpts to 80 chars', () => {
    const long = 'a'.repeat(120);
    const digest = composeVoteDigest([cand('1', long, 1)]);
    expect(digest).not.toBeNull();
    expect(digest!.includes('a'.repeat(81))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, expect fail**

Run: `cd server && npm test -- voteTally.test.ts`
Expected: FAIL — `Cannot find module`.

- [ ] **Step 3: Implement `handlers/voteTally.ts`**

```ts
import { COPY } from '../copy';

export const SHIP_THRESHOLD = 10;
export const CANDIDATE_GLYPH = '🎙';
export const EXCERPT_MAX = 80;

export interface VoteMessage {
  id: string;
  authorId: string;
  content: string;
  fireReactors: string[]; // unique reactor ids
}

export function collectVoteCandidates(
  messages: VoteMessage[],
  isProducer: (authorId: string) => boolean
): VoteMessage[] {
  return messages.filter(
    (m) => isProducer(m.authorId) && m.content.includes(CANDIDATE_GLYPH)
  );
}

function firstLineExcerpt(content: string, max: number): string {
  const firstLine = content.split('\n')[0] ?? '';
  const trimmed = firstLine.replace(CANDIDATE_GLYPH, '').trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function composeVoteDigest(candidates: VoteMessage[]): string | null {
  if (candidates.length === 0) return null;
  const rows = candidates.map((c) => {
    const count = new Set(c.fireReactors).size;
    const excerpt = firstLineExcerpt(c.content, EXCERPT_MAX);
    return COPY.voteDigestRow(excerpt, count, count >= SHIP_THRESHOLD);
  });
  return [COPY.voteDigestHeader, '', ...rows].join('\n');
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `cd server && npm test -- voteTally.test.ts`
Expected: PASS, all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add server/src/discord-bot/handlers/voteTally.ts server/__tests__/discord-bot/handlers/voteTally.test.ts
git commit -m "feat(bot): vote-tally digest composer"
```

---

## Task 9: Bug forwarder handler (`handlers/bugForwarder.ts`)

**Files:**
- Create: `server/src/discord-bot/handlers/bugForwarder.ts`
- Test: `server/__tests__/discord-bot/handlers/bugForwarder.test.ts`

Glues `GitHubClient` + `BotStateStore`. Idempotent against duplicate `threadCreate` events; safe fallback when GitHub is down.

- [ ] **Step 1: Write the failing test**

`server/__tests__/discord-bot/handlers/bugForwarder.test.ts`:

```ts
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BotStateStore } from '../../../src/discord-bot/state';
import {
  handleBugThreadCreate,
  mapTagsToLabels,
  truncateBody,
  MAX_TITLE,
  MAX_BODY,
} from '../../../src/discord-bot/handlers/bugForwarder';

const REPO = 'bworthy89/cleo';

function makeCtx(opts: {
  store: BotStateStore;
  threadId: string;
  channelId: string;
  title: string;
  starterText?: string;
  appliedTagNames?: string[];
  username?: string;
  threadUrl?: string;
  starterFails?: boolean;
  createIssueImpl?: jest.Mock;
}) {
  const replies: string[] = [];
  return {
    store: opts.store,
    config: {
      bugReportsChannelId: opts.channelId === 'BUGS' ? 'BUGS' : opts.channelId,
      githubBugRepo: REPO,
      githubBugLabel: 'tester-report',
    },
    thread: {
      id: opts.threadId,
      parentId: opts.channelId,
      name: opts.title,
      url: opts.threadUrl ?? 'https://discord/thread',
      appliedTagNames: opts.appliedTagNames ?? ['crash'],
      reply: jest.fn().mockImplementation(async (s: string) => {
        replies.push(s);
      }),
    },
    fetchStarterMessage: jest.fn().mockImplementation(async () => {
      if (opts.starterFails) throw new Error('not yet available');
      return {
        content: opts.starterText ?? 'something broke',
        author: { username: opts.username ?? 'kari' },
      };
    }),
    starterRetryDelaysMs: [10, 10, 10],
    createIssue:
      opts.createIssueImpl ??
      jest.fn().mockResolvedValue({ number: 142, htmlUrl: `https://github.com/${REPO}/issues/142` }),
    replies,
  };
}

describe('mapTagsToLabels', () => {
  it('maps recognized tags and drops unknowns; always adds tester-report', () => {
    expect(mapTagsToLabels(['crash', 'unknown', 'audio'], 'tester-report')).toEqual([
      'crash',
      'audio',
      'tester-report',
    ]);
    expect(mapTagsToLabels([], 'tester-report')).toEqual(['tester-report']);
  });
});

describe('truncateBody', () => {
  it('truncates oversized bodies and appends an ellipsis', () => {
    const body = 'x'.repeat(MAX_BODY + 1000);
    const out = truncateBody(body);
    expect(out.length).toBeLessThan(MAX_BODY + 1000);
    expect(out.endsWith('…(truncated)')).toBe(true);
  });
  it('leaves small bodies alone', () => {
    expect(truncateBody('short')).toBe('short');
  });
});

describe('handleBugThreadCreate', () => {
  let dir: string;
  let store: BotStateStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-bug-'));
    store = new BotStateStore(dir);
  });
  afterEach(async () => {
    await store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('creates a GitHub issue, replies with link, persists state', async () => {
    const ctx = makeCtx({ store, threadId: 't1', channelId: 'BUGS', title: 'crash' });
    await handleBugThreadCreate(ctx);

    expect(ctx.createIssue).toHaveBeenCalledTimes(1);
    expect(ctx.replies[0]).toBe(`Filed → ${REPO}#142`);

    await store.flush();
    const map = await store.read<Record<string, unknown>>(
      'bug-thread-issue-map.json',
      {}
    );
    expect(map['t1']).toMatchObject({ status: 'filed', issueNumber: 142, repo: REPO });
  });

  it('truncates titles longer than 200 chars', async () => {
    const longTitle = 't'.repeat(MAX_TITLE + 50);
    const ctx = makeCtx({ store, threadId: 't2', channelId: 'BUGS', title: longTitle });
    await handleBugThreadCreate(ctx);
    const args = ctx.createIssue.mock.calls[0][0];
    expect(args.title.length).toBe(MAX_TITLE);
  });

  it('skips re-firing when state already has a filed entry', async () => {
    await store.write('bug-thread-issue-map.json', {
      t3: { status: 'filed', issueNumber: 99, repo: REPO },
    });
    await store.flush();
    const ctx = makeCtx({ store, threadId: 't3', channelId: 'BUGS', title: 'whatever' });
    await handleBugThreadCreate(ctx);
    expect(ctx.createIssue).not.toHaveBeenCalled();
    expect(ctx.replies).toEqual([]);
  });

  it('skips re-firing when state has a pendingManual entry', async () => {
    await store.write('bug-thread-issue-map.json', {
      t4: { status: 'pendingManual', repo: REPO },
    });
    await store.flush();
    const ctx = makeCtx({ store, threadId: 't4', channelId: 'BUGS', title: 'whatever' });
    await handleBugThreadCreate(ctx);
    expect(ctx.createIssue).not.toHaveBeenCalled();
  });

  it('on GitHub failure, replies with manual-fallback copy and persists pendingManual', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('500'));
    const ctx = makeCtx({
      store,
      threadId: 't5',
      channelId: 'BUGS',
      title: 'fails',
      createIssueImpl: failing,
    });
    await handleBugThreadCreate(ctx);
    expect(ctx.replies[0]).toContain('Producer will pick it up manually');
    await store.flush();
    const map = await store.read<Record<string, unknown>>(
      'bug-thread-issue-map.json',
      {}
    );
    expect(map['t5']).toMatchObject({ status: 'pendingManual', repo: REPO });
  });

  it('ignores threadCreate in other channels', async () => {
    const ctx = makeCtx({ store, threadId: 't6', channelId: 'OTHER', title: 'x' });
    await handleBugThreadCreate(ctx);
    expect(ctx.createIssue).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test, expect fail**

Run: `cd server && npm test -- bugForwarder.test.ts`
Expected: FAIL — `Cannot find module`.

- [ ] **Step 3: Implement `handlers/bugForwarder.ts`**

```ts
import { COPY } from '../copy';
import type { BotStateStore, BugEntry, BugThreadIssueMap } from '../state';

export const MAX_TITLE = 200;
export const MAX_BODY = 60_000;

const RECOGNIZED_TAGS = new Set([
  'crash',
  'audio',
  'ui',
  'bake-failure',
  'onay-script',
  'auth',
  'other',
]);

export function mapTagsToLabels(tagNames: string[], constLabel: string): string[] {
  const recognized = tagNames.filter((t) => RECOGNIZED_TAGS.has(t));
  return [...recognized, constLabel];
}

export function truncateBody(body: string): string {
  if (body.length <= MAX_BODY) return body;
  return body.slice(0, MAX_BODY) + COPY.bugTruncated;
}

export interface BugForwarderContext {
  store: BotStateStore;
  config: {
    bugReportsChannelId: string;
    githubBugRepo: string;
    githubBugLabel: string;
  };
  thread: {
    id: string;
    parentId: string;
    name: string;
    url: string;
    appliedTagNames: string[];
    reply(content: string): Promise<unknown>;
  };
  fetchStarterMessage(): Promise<{ content: string; author: { username: string } }>;
  starterRetryDelaysMs: number[];
  createIssue(input: {
    title: string;
    body: string;
    labels: string[];
  }): Promise<{ number: number; htmlUrl: string }>;
}

async function fetchStarterWithRetry(
  ctx: BugForwarderContext
): Promise<{ content: string; author: { username: string } } | null> {
  for (let i = 0; i <= ctx.starterRetryDelaysMs.length; i++) {
    try {
      return await ctx.fetchStarterMessage();
    } catch {
      if (i < ctx.starterRetryDelaysMs.length) {
        await new Promise((r) => setTimeout(r, ctx.starterRetryDelaysMs[i]));
      }
    }
  }
  return null;
}

export async function handleBugThreadCreate(ctx: BugForwarderContext): Promise<void> {
  if (ctx.thread.parentId !== ctx.config.bugReportsChannelId) return;

  const map = await ctx.store.read<BugThreadIssueMap>('bug-thread-issue-map.json', {});
  if (map[ctx.thread.id]) {
    console.log(
      `[bot:bugForwarder] event=skip-duplicate thread=${ctx.thread.id} status=${map[ctx.thread.id].status}`
    );
    return;
  }

  const starter = await fetchStarterWithRetry(ctx);
  if (!starter) {
    console.error(`[bot:bugForwarder] event=starter-unavailable thread=${ctx.thread.id}`);
    return;
  }

  const title =
    ctx.thread.name.length > MAX_TITLE
      ? ctx.thread.name.slice(0, MAX_TITLE)
      : ctx.thread.name;
  const body = truncateBody(
    starter.content + COPY.bugBodyFooter(starter.author.username, ctx.thread.url)
  );
  const labels = mapTagsToLabels(ctx.thread.appliedTagNames, ctx.config.githubBugLabel);

  try {
    const issue = await ctx.createIssue({ title, body, labels });
    const entry: BugEntry = {
      status: 'filed',
      repo: ctx.config.githubBugRepo,
      issueNumber: issue.number,
      filedAt: new Date().toISOString(),
    };
    const next: BugThreadIssueMap = { ...map, [ctx.thread.id]: entry };
    await ctx.store.write('bug-thread-issue-map.json', next);
    await ctx.thread.reply(COPY.bugFiled(ctx.config.githubBugRepo, issue.number));
    console.log(
      `[bot:bugForwarder] event=filed thread=${ctx.thread.id} issue=${issue.number}`
    );
  } catch (err) {
    console.error(`[bot:bugForwarder] event=create-failed thread=${ctx.thread.id}`, err);
    const entry: BugEntry = {
      status: 'pendingManual',
      repo: ctx.config.githubBugRepo,
      lastErrorAt: new Date().toISOString(),
    };
    const next: BugThreadIssueMap = { ...map, [ctx.thread.id]: entry };
    await ctx.store.write('bug-thread-issue-map.json', next);
    await ctx.thread.reply(COPY.bugFileFailed);
  }
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `cd server && npm test -- bugForwarder.test.ts`
Expected: PASS, all 8 cases.

- [ ] **Step 5: Commit**

```bash
git add server/src/discord-bot/handlers/bugForwarder.ts server/__tests__/discord-bot/handlers/bugForwarder.test.ts
git commit -m "feat(bot): bug forwarder — thread→issue with idempotency + manual fallback"
```

---

## Task 10: Vibe-pitch digest handler (`handlers/vibeDigest.ts`)

**Files:**
- Create: `server/src/discord-bot/handlers/vibeDigest.ts`
- Test: `server/__tests__/discord-bot/handlers/vibeDigest.test.ts`

Same pattern as voteTally — composer is a pure function over `{ pitches, lastDigestAt }`. Cron wiring is in bootstrap.

- [ ] **Step 1: Write the failing test**

`server/__tests__/discord-bot/handlers/vibeDigest.test.ts`:

```ts
import {
  composeVibeDigest,
  type VibePitch,
  EXCERPT_MAX,
} from '../../../src/discord-bot/handlers/vibeDigest';

function pitch(opts: {
  id: string;
  author: string;
  excerpt: string;
  fires: number;
  createdAt: string;
}): VibePitch {
  return {
    id: opts.id,
    authorUsername: opts.author,
    content: opts.excerpt,
    jumpUrl: `https://discord/${opts.id}`,
    fireReactors: Array.from({ length: opts.fires }, (_, i) => `u${opts.id}-${i}`),
    createdAt: opts.createdAt,
  };
}

describe('composeVibeDigest', () => {
  it('returns null when no pitches received any 🔥', () => {
    const result = composeVibeDigest([
      pitch({ id: '1', author: 'a', excerpt: 'x', fires: 0, createdAt: '2026-04-01' }),
    ]);
    expect(result).toBeNull();
  });

  it('renders top 3 ranked + honorable mentions', () => {
    const pitches = [
      pitch({ id: '1', author: 'a', excerpt: 'rainy sunday', fires: 5, createdAt: '2026-04-22' }),
      pitch({ id: '2', author: 'b', excerpt: 'monday reset', fires: 9, createdAt: '2026-04-22' }),
      pitch({ id: '3', author: 'c', excerpt: 'late commute', fires: 7, createdAt: '2026-04-22' }),
      pitch({ id: '4', author: 'd', excerpt: 'studio day', fires: 2, createdAt: '2026-04-22' }),
      pitch({ id: '5', author: 'e', excerpt: 'no fires', fires: 0, createdAt: '2026-04-22' }),
    ];
    const out = composeVibeDigest(pitches);
    expect(out).not.toBeNull();
    expect(out!).toContain("THIS WEEK'S VIBE PITCHES");
    expect(out!.indexOf('monday reset')).toBeLessThan(out!.indexOf('late commute'));
    expect(out!.indexOf('late commute')).toBeLessThan(out!.indexOf('rainy sunday'));
    expect(out!).toContain('Honorable mentions');
    expect(out!).toContain('@d');
    expect(out!).not.toContain('@e'); // 0 fires excluded
  });

  it('ties break older first', () => {
    const pitches = [
      pitch({ id: 'newer', author: 'n', excerpt: 'newer', fires: 3, createdAt: '2026-04-25' }),
      pitch({ id: 'older', author: 'o', excerpt: 'older', fires: 3, createdAt: '2026-04-20' }),
    ];
    const out = composeVibeDigest(pitches);
    expect(out).not.toBeNull();
    expect(out!.indexOf('@o')).toBeLessThan(out!.indexOf('@n'));
  });

  it('truncates excerpts to EXCERPT_MAX', () => {
    const long = 'a'.repeat(EXCERPT_MAX + 200);
    const out = composeVibeDigest([
      pitch({ id: '1', author: 'a', excerpt: long, fires: 1, createdAt: '2026-04-22' }),
    ]);
    expect(out).not.toBeNull();
    expect(out!.includes('a'.repeat(EXCERPT_MAX + 1))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, expect fail**

Run: `cd server && npm test -- vibeDigest.test.ts`
Expected: FAIL — `Cannot find module`.

- [ ] **Step 3: Implement `handlers/vibeDigest.ts`**

```ts
import { COPY } from '../copy';

export const EXCERPT_MAX = 100;

export interface VibePitch {
  id: string;
  authorUsername: string;
  content: string;
  jumpUrl: string;
  fireReactors: string[];
  createdAt: string; // ISO
}

interface Scored {
  pitch: VibePitch;
  count: number;
}

function excerpt(content: string): string {
  const firstLine = content.split('\n')[0] ?? '';
  return firstLine.length > EXCERPT_MAX ? firstLine.slice(0, EXCERPT_MAX) : firstLine;
}

function rank(a: Scored, b: Scored): number {
  if (b.count !== a.count) return b.count - a.count;
  return a.pitch.createdAt.localeCompare(b.pitch.createdAt);
}

export function composeVibeDigest(pitches: VibePitch[]): string | null {
  const scored: Scored[] = pitches.map((p) => ({
    pitch: p,
    count: new Set(p.fireReactors).size,
  }));
  const withFires = scored.filter((s) => s.count > 0);
  if (withFires.length === 0) return null;

  const sorted = [...withFires].sort(rank);
  const top = sorted.slice(0, 3);
  const honorable = sorted.slice(3);

  const lines = [COPY.vibeDigestHeader, ''];
  top.forEach((s, i) => {
    lines.push(
      COPY.vibeDigestTopRow(
        i + 1,
        s.count,
        s.pitch.authorUsername,
        excerpt(s.pitch.content),
        s.pitch.jumpUrl
      )
    );
  });
  if (honorable.length > 0) {
    lines.push(COPY.vibeDigestHonorableHeader);
    honorable.forEach((s) => {
      lines.push(COPY.vibeDigestHonorableRow(s.pitch.authorUsername, excerpt(s.pitch.content)));
    });
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `cd server && npm test -- vibeDigest.test.ts`
Expected: PASS, all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add server/src/discord-bot/handlers/vibeDigest.ts server/__tests__/discord-bot/handlers/vibeDigest.test.ts
git commit -m "feat(bot): vibe-pitch digest composer"
```

---

## Task 11: Bootstrap (`index.ts`) — gateway client + dispatch + cron wiring

**Files:**
- Modify: `server/src/discord-bot/index.ts`

This is the wiring layer. It connects discord.js, instantiates handlers, registers gateway listeners, schedules crons, and starts the heartbeat. Pure integration glue — the unit-tested handlers do all the work.

The gateway client wiring is hard to unit-test cleanly without `discord.js` integration tests; we rely on the dev-guild smoke test (Task 13) for confidence here.

- [ ] **Step 1: Implement `index.ts`**

Replace `server/src/discord-bot/index.ts` with:

```ts
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Guild,
  type GuildMember,
  type TextChannel,
  type ForumChannel,
  type ThreadChannel,
  type Message,
  type Interaction,
  type ButtonInteraction,
  type MessageReaction,
  type User,
  type PartialMessageReaction,
  type PartialUser,
  type AnyThreadChannel,
} from 'discord.js';
import * as cron from 'node-cron';
import * as path from 'path';
import { loadBotConfig, type BotConfig } from './config';
import { BotStateStore, type LastDigests } from './state';
import { GitHubClient } from './github';
import { handleStartHereReaction } from './handlers/onboarding';
import {
  handleApplyReaction,
  handleReviewButton,
  parseReviewCustomId,
} from './handlers/applicationReview';
import {
  collectVoteCandidates,
  composeVoteDigest,
  type VoteMessage,
} from './handlers/voteTally';
import { handleBugThreadCreate } from './handlers/bugForwarder';
import { composeVibeDigest, type VibePitch } from './handlers/vibeDigest';

const HEARTBEAT_MS = 60_000;
const STATE_DIR = path.resolve(process.cwd(), '.bot-state');

export async function start(): Promise<void> {
  const config = loadBotConfig();
  const store = new BotStateStore(STATE_DIR);
  const github = new GitHubClient({ token: config.github.token, repo: config.github.bugRepo });

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });

  client.on(Events.Error, (err) => console.error('[bot:gateway] error', err));
  client.on(Events.ShardError, (err) => console.error('[bot:gateway] shard error', err));

  let guild: Guild | null = null;
  let lastEventAt = new Date().toISOString();

  client.on(Events.ClientReady, async () => {
    guild = await client.guilds.fetch(config.discord.guildId);
    console.log(
      `[bot:bootstrap] event=ready guild=${guild.id} members=${guild.memberCount ?? '?'}`
    );
    schedule(client, config, store, () => guild!);
    setInterval(() => {
      console.log(
        `[bot:heartbeat] members=${guild?.memberCount ?? '?'} ws=${client.ws.ping}ms lastEvent=${lastEventAt}`
      );
    }, HEARTBEAT_MS);
  });

  // -------- Reactions (onboarding + apply) --------
  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    lastEventAt = new Date().toISOString();
    try {
      const r = await ensureFullReaction(reaction);
      const u = await ensureFullUser(user);
      if (u.bot) return;
      await routeReaction(r, u, client, config, () => guild!);
    } catch (err) {
      console.error('[bot:reaction] dispatch failed', err);
    }
  });

  // -------- Interactions (review buttons) --------
  client.on(Events.InteractionCreate, async (interaction) => {
    lastEventAt = new Date().toISOString();
    try {
      if (!interaction.isButton()) return;
      const parsed = parseReviewCustomId(interaction.customId);
      if (!parsed) return;
      await routeReviewButton(interaction, client, config, () => guild!);
    } catch (err) {
      console.error('[bot:interaction] dispatch failed', err);
    }
  });

  // -------- Threads (bug forwarder) --------
  client.on(Events.ThreadCreate, async (thread, newlyCreated) => {
    lastEventAt = new Date().toISOString();
    if (!newlyCreated) return;
    try {
      await routeBugThread(thread, store, config, github, () => guild!);
    } catch (err) {
      console.error('[bot:thread] dispatch failed', err);
    }
  });

  await client.login(config.discord.botToken);
}

// ---------- routing ----------

async function ensureFullReaction(
  r: MessageReaction | PartialMessageReaction
): Promise<MessageReaction> {
  return r.partial ? await r.fetch() : r;
}
async function ensureFullUser(u: User | PartialUser): Promise<User> {
  return u.partial ? await u.fetch() : u;
}

async function routeReaction(
  reaction: MessageReaction,
  user: User,
  client: Client,
  config: BotConfig,
  getGuild: () => Guild
): Promise<void> {
  const emojiName = reaction.emoji.name ?? '';
  const channelId = reaction.message.channelId;

  if (reaction.message.id === config.discord.startHereMessageId) {
    const guild = getGuild();
    await handleStartHereReaction({
      config,
      reaction: { messageId: reaction.message.id, emoji: emojiName },
      reactor: { id: user.id },
      fetchMember: async (uid) => {
        const member = await guild.members.fetch(uid);
        return memberToLike(member);
      },
      sendInWelcome: async (content) => {
        const ch = (await client.channels.fetch(config.discord.channels.welcome)) as TextChannel;
        await ch.send(content);
      },
    });
    return;
  }

  if (channelId === config.discord.channels.apply) {
    const message = reaction.message.partial
      ? await reaction.message.fetch()
      : (reaction.message as Message);
    const repliesColl = await message.channel.messages.fetch({
      after: message.id,
      limit: 25,
    });
    const replies = Array.from(repliesColl.values()).filter(
      (m) => m.reference?.messageId === message.id
    );
    await handleApplyReaction({
      config,
      reaction: { channelId, emoji: emojiName },
      reactor: { id: user.id },
      message: {
        id: message.id,
        author: { id: message.author.id },
        replies: replies.map((m) => ({
          author: { bot: m.author.bot },
          components: m.components ?? [],
        })),
        reply: async (payload) => {
          await message.reply(payload as Parameters<Message['reply']>[0]);
        },
      },
    });
  }
}

async function routeReviewButton(
  interaction: ButtonInteraction,
  client: Client,
  config: BotConfig,
  getGuild: () => Guild
): Promise<void> {
  const guild = getGuild();
  const memberRoles = (interaction.member?.roles ?? null) as
    | { cache: Map<string, unknown> }
    | null;
  const cache = memberRoles?.cache ?? new Map<string, unknown>();
  const applyChannel = (await client.channels.fetch(
    config.discord.channels.apply
  )) as TextChannel;

  await interaction.deferUpdate();

  await handleReviewButton({
    config,
    interaction: {
      customId: interaction.customId,
      memberRoles: cache,
      reviewer: { id: interaction.user.id, toString: () => `<@${interaction.user.id}>` },
      replyEphemeral: async (content) => {
        await interaction.followUp({ content, ephemeral: true });
      },
      editButtonsMessage: async (payload) => {
        await interaction.editReply({ content: payload.content, components: [] });
      },
    },
    fetchAppMessage: async (messageId) => {
      const m = await applyChannel.messages.fetch(messageId);
      return { id: m.id, content: m.content };
    },
    fetchAuthorMember: async (uid) => {
      const member = await guild.members.fetch(uid);
      return memberToLike(member);
    },
    sendInWelcome: async (content) => {
      const ch = (await client.channels.fetch(
        config.discord.channels.welcome
      )) as TextChannel;
      await ch.send(content);
    },
  });
}

async function routeBugThread(
  thread: AnyThreadChannel,
  store: BotStateStore,
  config: BotConfig,
  github: GitHubClient,
  getGuild: () => Guild
): Promise<void> {
  if (thread.parentId !== config.discord.channels.bugReports) return;

  const tagNames: string[] = [];
  const parent = thread.parent as ForumChannel | null;
  if (parent && 'availableTags' in parent && Array.isArray(thread.appliedTags)) {
    for (const tagId of thread.appliedTags) {
      const tag = parent.availableTags.find((t) => t.id === tagId);
      if (tag) tagNames.push(tag.name);
    }
  }

  const threadUrl = `https://discord.com/channels/${getGuild().id}/${thread.id}`;

  await handleBugThreadCreate({
    store,
    config: {
      bugReportsChannelId: config.discord.channels.bugReports,
      githubBugRepo: config.github.bugRepo,
      githubBugLabel: config.github.bugLabel,
    },
    thread: {
      id: thread.id,
      parentId: thread.parentId ?? '',
      name: thread.name,
      url: threadUrl,
      appliedTagNames: tagNames,
      reply: async (s: string) => {
        await thread.send(s);
      },
    },
    fetchStarterMessage: async () => {
      const starter = await thread.fetchStarterMessage();
      if (!starter) throw new Error('starter message not yet available');
      return { content: starter.content, author: { username: starter.author.username } };
    },
    starterRetryDelaysMs: [1_000, 1_500, 2_500],
    createIssue: (input) => github.createIssue(input),
  });
}

// ---------- helpers ----------

function memberToLike(member: GuildMember) {
  return {
    user: {
      id: member.user.id,
      username: member.user.username,
      toString: () => `<@${member.user.id}>`,
    },
    roles: {
      cache: member.roles.cache,
      add: async (roleId: string) => {
        await member.roles.add(roleId);
      },
    },
    send: async (content: string) => {
      await member.send(content);
    },
  };
}

// ---------- cron wiring ----------

function schedule(
  client: Client,
  config: BotConfig,
  store: BotStateStore,
  getGuild: () => Guild
): void {
  cron.schedule(
    '0 0 * * *',
    () => {
      runVoteTally(client, config, store, getGuild).catch((err) =>
        console.error('[bot:voteTally] cron failed', err)
      );
    },
    { timezone: config.discord.timezone }
  );
  cron.schedule(
    '0 21 * * 0',
    () => {
      runVibeDigest(client, config, store, getGuild).catch((err) =>
        console.error('[bot:vibeDigest] cron failed', err)
      );
    },
    { timezone: config.discord.timezone }
  );
  console.log('[bot:bootstrap] event=cron-scheduled tz=' + config.discord.timezone);
}

async function runVoteTally(
  client: Client,
  config: BotConfig,
  store: BotStateStore,
  getGuild: () => Guild
): Promise<void> {
  const last = await store.read<LastDigests>('last-digests.json', {});
  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
  if (last.voteDigestAt && new Date(last.voteDigestAt).getTime() > sinceMs) {
    console.log('[bot:voteTally] event=already-ran-this-window');
    return;
  }
  const guild = getGuild();
  const channel = (await client.channels.fetch(config.discord.channels.tonightOnOnay)) as TextChannel;
  const messages = await channel.messages.fetch({ limit: 100 });

  const recent: VoteMessage[] = [];
  for (const m of messages.values()) {
    if (m.createdTimestamp < sinceMs) continue;
    const fireReaction = m.reactions.cache.find((r) => r.emoji.name === '🔥');
    let reactors: string[] = [];
    if (fireReaction) {
      const users = await fireReaction.users.fetch();
      reactors = users.filter((u) => !u.bot).map((u) => u.id);
    }
    recent.push({
      id: m.id,
      authorId: m.author.id,
      content: m.content,
      fireReactors: reactors,
    });
  }

  // Build the producer-id predicate by fetching members lazily, caching results.
  const producerCache = new Map<string, boolean>();
  const isProducer = async (uid: string): Promise<boolean> => {
    if (producerCache.has(uid)) return producerCache.get(uid)!;
    try {
      const member = await guild.members.fetch(uid);
      const has = member.roles.cache.has(config.discord.roles.producer);
      producerCache.set(uid, has);
      return has;
    } catch {
      producerCache.set(uid, false);
      return false;
    }
  };
  for (const c of recent) await isProducer(c.authorId);

  const candidates = collectVoteCandidates(recent, (id) => producerCache.get(id) === true);
  const digest = composeVoteDigest(candidates);
  if (!digest) {
    console.log('[bot:voteTally] event=empty-window');
    return;
  }
  await channel.send(digest);
  await store.write('last-digests.json', {
    ...last,
    voteDigestAt: new Date().toISOString(),
  });
  console.log('[bot:voteTally] event=posted candidates=' + candidates.length);
}

async function runVibeDigest(
  client: Client,
  config: BotConfig,
  store: BotStateStore,
  _getGuild: () => Guild
): Promise<void> {
  const last = await store.read<LastDigests>('last-digests.json', {});
  const sinceMs = last.vibeDigestAt
    ? new Date(last.vibeDigestAt).getTime()
    : Date.now() - 7 * 24 * 60 * 60 * 1000;
  const channel = (await client.channels.fetch(
    config.discord.channels.vibeRequests
  )) as TextChannel;

  const pitches: VibePitch[] = [];
  let before: string | undefined;
  for (let page = 0; page < 5; page++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;
    let crossedCutoff = false;
    for (const m of batch.values()) {
      if (m.createdTimestamp < sinceMs) {
        crossedCutoff = true;
        break;
      }
      if (m.author.bot) continue;
      const fireReaction = m.reactions.cache.find((r) => r.emoji.name === '🔥');
      let reactors: string[] = [];
      if (fireReaction) {
        const users = await fireReaction.users.fetch();
        reactors = users.filter((u) => !u.bot).map((u) => u.id);
      }
      pitches.push({
        id: m.id,
        authorUsername: m.author.username,
        content: m.content,
        jumpUrl: `https://discord.com/channels/${m.guildId ?? ''}/${m.channelId}/${m.id}`,
        fireReactors: reactors,
        createdAt: new Date(m.createdTimestamp).toISOString(),
      });
    }
    if (crossedCutoff) break;
    before = batch.last()?.id;
  }

  const digest = composeVibeDigest(pitches);
  if (!digest) {
    console.log('[bot:vibeDigest] event=empty-window');
    return;
  }
  await channel.send(digest);
  await store.write('last-digests.json', {
    ...last,
    vibeDigestAt: new Date().toISOString(),
  });
  console.log('[bot:vibeDigest] event=posted pitches=' + pitches.length);
}
```

- [ ] **Step 2: Run a typecheck**

Run: `cd server && npm run build`
Expected: clean exit, no TS errors.

- [ ] **Step 3: Run the full test suite to confirm nothing regressed**

Run: `cd server && npm test`
Expected: all tests pass (handler unit tests still green, no new tests in this task).

- [ ] **Step 4: Commit**

```bash
git add server/src/discord-bot/index.ts
git commit -m "feat(bot): bootstrap — gateway client, dispatch, cron wiring"
```

---

## Task 12: Integration test — state + bug forwarder restart safety

**Files:**
- Create: `server/__tests__/discord-bot/integration.test.ts`

The handler-level tests already cover individual logic. This integration test exists for one specific risk: restart safety. After a successful issue creation, can a re-fired `threadCreate` for the same thread be handled without a duplicate GitHub call?

- [ ] **Step 1: Write the test**

`server/__tests__/discord-bot/integration.test.ts`:

```ts
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import nock from 'nock';
import { BotStateStore } from '../../src/discord-bot/state';
import { GitHubClient } from '../../src/discord-bot/github';
import { handleBugThreadCreate } from '../../src/discord-bot/handlers/bugForwarder';

describe('integration: bug forwarder + state survives restart', () => {
  const REPO = 'bworthy89/cleo';
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-int-'));
    nock.disableNetConnect();
  });
  afterEach(async () => {
    nock.cleanAll();
    nock.enableNetConnect();
    await fs.rm(dir, { recursive: true, force: true });
  });

  function ctxFor(threadId: string, github: GitHubClient, store: BotStateStore) {
    const replies: string[] = [];
    return {
      store,
      config: {
        bugReportsChannelId: 'BUGS',
        githubBugRepo: REPO,
        githubBugLabel: 'tester-report',
      },
      thread: {
        id: threadId,
        parentId: 'BUGS',
        name: 'crash on bake',
        url: 'https://discord/thread',
        appliedTagNames: ['crash'],
        reply: jest.fn().mockImplementation(async (s: string) => {
          replies.push(s);
        }),
      },
      fetchStarterMessage: jest.fn().mockResolvedValue({
        content: 'it crashed',
        author: { username: 'kari' },
      }),
      starterRetryDelaysMs: [10],
      createIssue: (input: { title: string; body: string; labels: string[] }) =>
        github.createIssue(input),
      replies,
    };
  }

  it('re-fired threadCreate after restart does not double-create on GitHub', async () => {
    nock('https://api.github.com')
      .post(`/repos/${REPO}/issues`)
      .reply(201, { number: 42, html_url: `https://github.com/${REPO}/issues/42` });

    // First "process lifetime"
    const store1 = new BotStateStore(dir);
    const gh1 = new GitHubClient({ token: 'tk', repo: REPO, retryDelaysMs: [] });
    const ctx1 = ctxFor('threadX', gh1, store1);
    await handleBugThreadCreate(ctx1);
    expect(ctx1.replies[0]).toBe(`Filed → ${REPO}#42`);
    await store1.flush();

    // Second "process lifetime" — fresh store + GitHub mock, but state file persists
    nock('https://api.github.com')
      .post(`/repos/${REPO}/issues`)
      .reply(500); // would fail loudly if called

    const store2 = new BotStateStore(dir);
    const gh2 = new GitHubClient({ token: 'tk', repo: REPO, retryDelaysMs: [] });
    const ctx2 = ctxFor('threadX', gh2, store2);
    await handleBugThreadCreate(ctx2);
    expect(ctx2.replies).toEqual([]); // skipped silently
    expect(nock.pendingMocks()).toHaveLength(1); // 500 mock was never hit
  });
});
```

- [ ] **Step 2: Run the test, expect pass**

Run: `cd server && npm test -- integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/discord-bot/integration.test.ts
git commit -m "test(bot): integration — restart safety for bug forwarder"
```

---

## Task 13: PM2 + DEPLOY.md updates

**Files:**
- Modify: `server/ecosystem.config.cjs`
- Modify: `server/DEPLOY.md`

- [ ] **Step 1: Add `cleo-discord-bot` to `ecosystem.config.cjs`**

Replace the file with:

```js
module.exports = {
  apps: [
    {
      name: 'cleo-broadcast',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: '3102',
      },
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 15000,
    },
    {
      name: 'cleo-discord-bot',
      script: 'dist/discord-bot/start-bot.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/discord-bot-error.log',
      out_file: 'logs/discord-bot-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 10000,
    },
  ],
};
```

- [ ] **Step 2: Append to `server/DEPLOY.md`**

Add this section at the end of the file (or wherever runbook structure dictates):

```markdown

## Discord bot — The Producer

The `cleo-discord-bot` PM2 app runs alongside `cleo-broadcast`.

### One-time setup

1. **Create the Discord application.**
   - https://discord.com/developers → New Application → name "The Producer".
   - Bot tab → Reset Token → copy → `server/.env` as `DISCORD_BOT_TOKEN`.
   - Bot tab → enable **Server Members Intent** + **Message Content Intent**.
   - General Information → upload a desaturated/silhouette variant of the gold orb as the bot avatar.

2. **Invite the bot.**
   - OAuth2 → URL Generator. Scopes: `bot` + `applications.commands`. Permissions: `Manage Roles`, `Send Messages`, `Send Messages in Threads`, `Add Reactions`, `Read Message History`, `Use Application Commands`.
   - Open the generated URL → select **The ONAY Booth** → authorize.
   - In the booth, drag `@The Producer` *above* `@Charter Listener` in the role hierarchy.

3. **Capture IDs.** Discord Settings → Advanced → enable Developer Mode. Right-click each channel/role/the pinned `#start-here` post → Copy ID → paste into `server/.env`.

4. **Mint a fine-grained GitHub PAT.**
   - https://github.com/settings/tokens → Fine-grained PAT.
   - Repository access: **bworthy89/cleo only**.
   - Repository permissions: `Issues: read+write`, `Metadata: read`.
   - Copy → `server/.env` as `GITHUB_TOKEN`.
   - Pre-create the `tester-report` label on `bworthy89/cleo` (the bot will create it on first use otherwise).

### Deploy / update

```bash
ssh cleo@187.124.69.95
cd /home/cleo/cleo-broadcast
git pull
npm install
npm run build
pm2 start ecosystem.config.cjs --only cleo-discord-bot   # first time
# or
pm2 reload cleo-discord-bot                              # subsequent updates
pm2 logs cleo-discord-bot                                # watch for [bot:bootstrap] event=ready
```

### Smoke test on a private dev guild before flipping live

Create a "Booth Dev" guild that mirrors the channel/role layout. The bot can be invited to both;
flip `DISCORD_GUILD_ID` in `.env` to switch which it operates against. Walk this checklist
end-to-end on Booth Dev before pointing at production:

- [ ] React 📻 on the pinned `#start-here` post → role granted, DM received with TestFlight URL
- [ ] Post in `#apply` → 📻-react your own post → buttons appear → click Approve as a Producer-roled account → role granted, DM received, post footered
- [ ] Click an Approve button as a non-Producer account → ephemeral "not authorized" reply
- [ ] Open a thread in `#bug-reports` with the `crash` tag → bot replies with `Filed → bworthy89/cleo#N`, GitHub issue exists, `bug-thread-issue-map.json` shows `status: "filed"`
- [ ] Restart the bot (`pm2 restart cleo-discord-bot`); same thread does NOT generate a duplicate issue

### GitHub PAT renewal

Fine-grained PATs expire (max 1 year). Calendar a renewal reminder ~11 months out and repeat
step 4 of the one-time setup.
```

- [ ] **Step 3: Verify build + tests still green**

Run: `cd server && npm run build && npm test`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add server/ecosystem.config.cjs server/DEPLOY.md
git commit -m "chore(bot): register cleo-discord-bot in PM2 + deploy runbook"
```

---

## Done criteria

After Task 13:
- `cd server && npm test` passes (existing + bot tests).
- `cd server && npm run build` produces `dist/discord-bot/start-bot.js`.
- `server/.env.example` lists every Discord/GitHub key the bot needs.
- The full smoke checklist in `server/DEPLOY.md` runs clean on a private dev guild.

Phase 2 features (mod log, featured-broadcast announcer, EAS build watcher) are deliberately not in this plan — see §9 of the spec.
