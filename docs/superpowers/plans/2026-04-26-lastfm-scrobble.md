# Last.fm Scrobble Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User-facing per-account Last.fm scrobbling (#37). User connects their Last.fm account on ProfileScreen via OAuth; client emits `now-playing` + `scrobble` events from `BroadcastPlayer`; server signs and POSTs to Last.fm. Best-effort, online-only — no offline queue.

**Architecture:** Thin two-endpoint emission (Approach 1 from spec). `Scrobbler` engine class on the client tracks per-track elapsed time and fires the threshold event the moment cumulative play time crosses `min(0.5 × duration, 240s)`. Server-side `LastFmClient` owns the signed-request mechanic. `firebase-admin` SDK added to the server as a hard prereq for writing `users/{uid}/integrations/lastfm` Firestore docs (sessionKey + needsReconnect flag).

**Tech Stack:** Server — Express + TypeScript + ts-jest + supertest + zod + firebase-admin. Client — React Native + TypeScript + ts-jest + @react-native-firebase/{auth,firestore} + expo-web-browser + expo-linking.

**Spec:** `docs/superpowers/specs/2026-04-26-lastfm-scrobble-design.md`

---

## File map

**New (server)**
- `server/src/firebase.ts` — Firebase Admin SDK singleton; exports `firestore()` returning the Admin Firestore instance
- `server/src/services/lastfm/LastFmClient.ts` — signed-request mechanic + `getSession` / `updateNowPlaying` / `scrobble`
- `server/src/services/lastfm/types.ts` — `ScrobbleTrack`, `LastFmResult` shared types
- `server/src/routes/lastfm.ts` — five Express routes
- `server/__tests__/services/lastfm/LastFmClient.test.ts`
- `server/__tests__/routes/lastfm.test.ts`

**Modified (server)**
- `server/package.json` — add `firebase-admin`
- `server/src/index.ts` — mount router + add `scrobbleLimiter`
- `server/.env.example` — add `LASTFM_API_SECRET` + `GOOGLE_APPLICATION_CREDENTIALS`
- `server/.gitignore` — exclude `firebase-service-account.json`

**New (client)**
- `src/engines/Scrobbler.types.ts` — `ScrobblePayload`, `ScrobblerApi`
- `src/engines/Scrobbler.ts` — pure `Scrobbler` class
- `src/services/LastFmService.ts` — `authenticatedFetch`-backed HTTP wrapper
- `src/hooks/useLastFmIntegration.ts` — Firestore subscription hook
- `src/components/profile/LastFmRow.tsx` — three-state row component
- `__tests__/engines/Scrobbler.test.ts`
- `__tests__/services/LastFmService.test.ts`
- `__tests__/hooks/useLastFmIntegration.test.ts`

**Modified (client)**
- `src/engines/BroadcastPlayer.ts` — add optional `scrobbler` dep, three hook points (`runTrackAt`, elapsed-pump, `end`)
- `src/engines/BroadcastPlayer.singleton.ts` — wire production `Scrobbler`
- `src/screens/settings/ProfileScreen.tsx` — render `LastFmRow` above `LikedRow`, add OAuth handler

**Modified (Firebase)**
- `firestore.rules` — add `users/{uid}/integrations/{id}` rule

**Modified (docs)**
- `CLAUDE.md` — add scrobble flow + new env vars

---

## Task 1: Add firebase-admin SDK + singleton

**Files:**
- Modify: `server/package.json`
- Create: `server/src/firebase.ts`
- Create: `server/__tests__/firebase.test.ts`

- [ ] **Step 1: Install firebase-admin**

```bash
cd server && npm install firebase-admin
```

Expected: `firebase-admin` appears under `dependencies` in `server/package.json`.

- [ ] **Step 2: Write the failing test**

Create `server/__tests__/firebase.test.ts`:

```ts
jest.mock('firebase-admin', () => {
  const firestoreFn = jest.fn(() => ({ collection: jest.fn() }));
  return {
    __esModule: true,
    default: {
      apps: [],
      initializeApp: jest.fn(),
      credential: { applicationDefault: jest.fn(() => ({})) },
      firestore: firestoreFn,
    },
    apps: [],
    initializeApp: jest.fn(),
    credential: { applicationDefault: jest.fn(() => ({})) },
    firestore: firestoreFn,
  };
});

import admin from 'firebase-admin';
import { firestore } from '@/firebase';

describe('firebase admin singleton', () => {
  beforeEach(() => {
    (admin as unknown as { apps: unknown[] }).apps = [];
    jest.clearAllMocks();
  });

  it('initializes once on first firestore() call', () => {
    firestore();
    firestore();
    expect((admin as { initializeApp: jest.Mock }).initializeApp).toHaveBeenCalledTimes(1);
  });

  it('skips init if admin.apps already populated', () => {
    (admin as unknown as { apps: unknown[] }).apps = [{}];
    firestore();
    expect((admin as { initializeApp: jest.Mock }).initializeApp).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd server && npm test -- firebase.test.ts
```

Expected: FAIL with "Cannot find module '@/firebase'".

- [ ] **Step 4: Implement the singleton**

Create `server/src/firebase.ts`:

```ts
import admin from 'firebase-admin';

let initialized = false;

function ensureInit() {
  if (initialized) return;
  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }
  initialized = true;
}

export function firestore(): admin.firestore.Firestore {
  ensureInit();
  return admin.firestore();
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd server && npm test -- firebase.test.ts
```

Expected: PASS, both tests green.

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/package-lock.json server/src/firebase.ts server/__tests__/firebase.test.ts
git commit -m "feat(server): add firebase-admin singleton for #37 scrobble"
```

---

## Task 2: LastFmClient — signRequest

**Files:**
- Create: `server/src/services/lastfm/LastFmClient.ts`
- Create: `server/src/services/lastfm/types.ts`
- Create: `server/__tests__/services/lastfm/LastFmClient.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/services/lastfm/LastFmClient.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { LastFmClient } from '@/services/lastfm/LastFmClient';

describe('LastFmClient.signRequest', () => {
  it('sorts params alphabetically, concatenates key+value, appends secret, md5s the result', () => {
    const client = new LastFmClient({ apiKey: 'K', apiSecret: 'SEC' });

    const sig = client.signRequest({ method: 'm', foo: 'a', bar: 'b' });

    // alphabetical: bar, foo, method  →  bar+b + foo+a + method+m = "barbfooamethodm"
    // append secret: "barbfooamethodmSEC"
    const expected = createHash('md5').update('barbfooamethodmSEC').digest('hex');
    expect(sig).toBe(expected);
  });

  it('omits the api_sig key from the signed input even if present', () => {
    const client = new LastFmClient({ apiKey: 'K', apiSecret: 'SEC' });

    const sig = client.signRequest({ method: 'm', api_sig: 'should-be-ignored' });

    const expected = createHash('md5').update('methodmSEC').digest('hex');
    expect(sig).toBe(expected);
  });

  it('omits the format key from the signed input (Last.fm rule)', () => {
    const client = new LastFmClient({ apiKey: 'K', apiSecret: 'SEC' });

    const sig = client.signRequest({ method: 'm', format: 'json' });

    const expected = createHash('md5').update('methodmSEC').digest('hex');
    expect(sig).toBe(expected);
  });

  it('throws if constructed without apiKey or apiSecret', () => {
    expect(() => new LastFmClient({ apiKey: '', apiSecret: 'S' })).toThrow(/apiKey/);
    expect(() => new LastFmClient({ apiKey: 'K', apiSecret: '' })).toThrow(/apiSecret/);
  });
});
```

Also create `server/src/services/lastfm/types.ts` (referenced by later tasks; create now so types exist):

```ts
export interface ScrobbleTrack {
  title: string;
  artistName: string;
  albumTitle?: string;
  duration: number;        // seconds
  startedAt?: number;      // unix seconds — required for scrobble, omitted for now-playing
}

export type LastFmResult =
  | { ok: true }
  | { ok: false; errorCode: number; errorMessage: string };
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npm test -- LastFmClient.test.ts
```

Expected: FAIL with "Cannot find module '@/services/lastfm/LastFmClient'".

- [ ] **Step 3: Implement the LastFmClient skeleton + signRequest**

Create `server/src/services/lastfm/LastFmClient.ts`:

```ts
import { createHash } from 'node:crypto';

export interface LastFmClientDeps {
  apiKey: string;
  apiSecret: string;
  fetchImpl?: typeof fetch;
}

const SIGN_OMIT = new Set(['api_sig', 'format', 'callback']);

export class LastFmClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: LastFmClientDeps) {
    if (!deps.apiKey) throw new Error('LastFmClient: apiKey required');
    if (!deps.apiSecret) throw new Error('LastFmClient: apiSecret required');
    this.apiKey = deps.apiKey;
    this.apiSecret = deps.apiSecret;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  signRequest(params: Record<string, string>): string {
    const keys = Object.keys(params).filter(k => !SIGN_OMIT.has(k)).sort();
    let concat = '';
    for (const k of keys) concat += k + params[k];
    concat += this.apiSecret;
    return createHash('md5').update(concat).digest('hex');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npm test -- LastFmClient.test.ts
```

Expected: PASS, all four signRequest tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/lastfm/LastFmClient.ts server/src/services/lastfm/types.ts server/__tests__/services/lastfm/LastFmClient.test.ts
git commit -m "feat(server): LastFmClient signRequest mechanic"
```

---

## Task 3: LastFmClient.getSession

**Files:**
- Modify: `server/src/services/lastfm/LastFmClient.ts`
- Modify: `server/__tests__/services/lastfm/LastFmClient.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `server/__tests__/services/lastfm/LastFmClient.test.ts`:

```ts
describe('LastFmClient.getSession', () => {
  it('POSTs auth.getSession with signed params and returns the session', async () => {
    const fetchImpl = jest.fn(async () => new Response(
      JSON.stringify({ session: { name: 'kari_w', key: 'SK_ABC' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const client = new LastFmClient({ apiKey: 'K', apiSecret: 'SEC', fetchImpl });

    const result = await client.getSession('OAUTH_TOKEN');

    expect(result).toEqual({ name: 'kari_w', key: 'SK_ABC' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ws.audioscrobbler.com/2.0/');
    expect(init.method).toBe('POST');
    const body = init.body as URLSearchParams;
    expect(body.get('method')).toBe('auth.getSession');
    expect(body.get('api_key')).toBe('K');
    expect(body.get('token')).toBe('OAUTH_TOKEN');
    expect(body.get('format')).toBe('json');
    expect(body.get('api_sig')).toMatch(/^[a-f0-9]{32}$/);
  });

  it('throws on Last.fm error response', async () => {
    const fetchImpl = jest.fn(async () => new Response(
      JSON.stringify({ error: 4, message: 'Authentication failed' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const client = new LastFmClient({ apiKey: 'K', apiSecret: 'SEC', fetchImpl });

    await expect(client.getSession('BAD_TOKEN')).rejects.toThrow(/Authentication failed/);
  });

  it('throws on HTTP non-200', async () => {
    const fetchImpl = jest.fn(async () => new Response('boom', { status: 500 }));
    const client = new LastFmClient({ apiKey: 'K', apiSecret: 'SEC', fetchImpl });

    await expect(client.getSession('T')).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npm test -- LastFmClient.test.ts
```

Expected: FAIL with "client.getSession is not a function".

- [ ] **Step 3: Implement getSession**

Append to `server/src/services/lastfm/LastFmClient.ts` inside the class (before the closing `}`):

```ts
  async getSession(token: string): Promise<{ key: string; name: string }> {
    const params: Record<string, string> = {
      method: 'auth.getSession',
      api_key: this.apiKey,
      token,
    };
    const sig = this.signRequest(params);
    const body = new URLSearchParams({ ...params, api_sig: sig, format: 'json' });

    const res = await this.fetchImpl('https://ws.audioscrobbler.com/2.0/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) throw new Error(`Last.fm getSession HTTP ${res.status}`);
    const data = await res.json() as
      | { session: { name: string; key: string } }
      | { error: number; message: string };

    if ('error' in data) {
      throw new Error(`Last.fm getSession failed: ${data.message} (code ${data.error})`);
    }
    return { name: data.session.name, key: data.session.key };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npm test -- LastFmClient.test.ts
```

Expected: PASS, all seven LastFmClient tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/lastfm/LastFmClient.ts server/__tests__/services/lastfm/LastFmClient.test.ts
git commit -m "feat(server): LastFmClient.getSession"
```

---

## Task 4: LastFmClient.updateNowPlaying + scrobble

**Files:**
- Modify: `server/src/services/lastfm/LastFmClient.ts`
- Modify: `server/__tests__/services/lastfm/LastFmClient.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `server/__tests__/services/lastfm/LastFmClient.test.ts`:

```ts
describe('LastFmClient.updateNowPlaying', () => {
  it('POSTs track.updateNowPlaying with signed params and sk', async () => {
    const fetchImpl = jest.fn(async () => new Response(
      JSON.stringify({ nowplaying: { artist: { '#text': 'Cher' }, track: { '#text': 'Believe' } } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const client = new LastFmClient({ apiKey: 'K', apiSecret: 'SEC', fetchImpl });

    const r = await client.updateNowPlaying('SK_XYZ', {
      title: 'Believe',
      artistName: 'Cher',
      albumTitle: 'Believe',
      duration: 240,
    });

    expect(r).toEqual({ ok: true });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = init.body as URLSearchParams;
    expect(body.get('method')).toBe('track.updateNowPlaying');
    expect(body.get('artist')).toBe('Cher');
    expect(body.get('track')).toBe('Believe');
    expect(body.get('album')).toBe('Believe');
    expect(body.get('duration')).toBe('240');
    expect(body.get('sk')).toBe('SK_XYZ');
  });

  it('returns { ok: false, errorCode: 9 } when session key invalid', async () => {
    const fetchImpl = jest.fn(async () => new Response(
      JSON.stringify({ error: 9, message: 'Invalid session key' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const client = new LastFmClient({ apiKey: 'K', apiSecret: 'SEC', fetchImpl });

    const r = await client.updateNowPlaying('STALE', {
      title: 'T', artistName: 'A', duration: 180,
    });

    expect(r).toEqual({ ok: false, errorCode: 9, errorMessage: 'Invalid session key' });
  });
});

describe('LastFmClient.scrobble', () => {
  it('POSTs track.scrobble with timestamp', async () => {
    const fetchImpl = jest.fn(async () => new Response(
      JSON.stringify({ scrobbles: { '@attr': { accepted: 1, ignored: 0 } } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const client = new LastFmClient({ apiKey: 'K', apiSecret: 'SEC', fetchImpl });

    const r = await client.scrobble('SK_XYZ', {
      title: 'Believe', artistName: 'Cher', albumTitle: 'Believe',
      duration: 240, startedAt: 1714200000,
    });

    expect(r).toEqual({ ok: true });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = init.body as URLSearchParams;
    expect(body.get('method')).toBe('track.scrobble');
    expect(body.get('timestamp')).toBe('1714200000');
  });

  it('throws on missing startedAt (programmer error, not user-recoverable)', async () => {
    const client = new LastFmClient({ apiKey: 'K', apiSecret: 'SEC', fetchImpl: jest.fn() });

    await expect(client.scrobble('SK', {
      title: 'T', artistName: 'A', duration: 180,
    })).rejects.toThrow(/startedAt/);
  });

  it('returns { ok: false, errorCode: 4 } sticky-auth condition', async () => {
    const fetchImpl = jest.fn(async () => new Response(
      JSON.stringify({ error: 4, message: 'Authentication Failed' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const client = new LastFmClient({ apiKey: 'K', apiSecret: 'SEC', fetchImpl });

    const r = await client.scrobble('SK', {
      title: 'T', artistName: 'A', duration: 180, startedAt: 1714200000,
    });

    expect(r).toEqual({ ok: false, errorCode: 4, errorMessage: 'Authentication Failed' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npm test -- LastFmClient.test.ts
```

Expected: FAIL with "client.updateNowPlaying is not a function".

- [ ] **Step 3: Implement both methods**

Append to `server/src/services/lastfm/LastFmClient.ts` inside the class:

```ts
  async updateNowPlaying(sessionKey: string, t: ScrobbleTrack): Promise<LastFmResult> {
    const params: Record<string, string> = {
      method: 'track.updateNowPlaying',
      api_key: this.apiKey,
      artist: t.artistName,
      track: t.title,
      duration: String(Math.round(t.duration)),
      sk: sessionKey,
    };
    if (t.albumTitle) params.album = t.albumTitle;
    return this.signedPost(params);
  }

  async scrobble(sessionKey: string, t: ScrobbleTrack): Promise<LastFmResult> {
    if (typeof t.startedAt !== 'number') {
      throw new Error('LastFmClient.scrobble: startedAt required');
    }
    const params: Record<string, string> = {
      method: 'track.scrobble',
      api_key: this.apiKey,
      artist: t.artistName,
      track: t.title,
      duration: String(Math.round(t.duration)),
      timestamp: String(t.startedAt),
      sk: sessionKey,
    };
    if (t.albumTitle) params.album = t.albumTitle;
    return this.signedPost(params);
  }

  private async signedPost(params: Record<string, string>): Promise<LastFmResult> {
    const sig = this.signRequest(params);
    const body = new URLSearchParams({ ...params, api_sig: sig, format: 'json' });
    const res = await this.fetchImpl('https://ws.audioscrobbler.com/2.0/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      return { ok: false, errorCode: -1, errorMessage: `HTTP ${res.status}` };
    }
    const data = await res.json() as { error?: number; message?: string };
    if (typeof data.error === 'number') {
      return { ok: false, errorCode: data.error, errorMessage: data.message ?? 'unknown' };
    }
    return { ok: true };
  }
```

Add the `ScrobbleTrack` / `LastFmResult` import at the top of the file:

```ts
import type { ScrobbleTrack, LastFmResult } from './types';
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npm test -- LastFmClient.test.ts
```

Expected: PASS, all twelve LastFmClient tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/lastfm/LastFmClient.ts server/__tests__/services/lastfm/LastFmClient.test.ts
git commit -m "feat(server): LastFmClient.updateNowPlaying + scrobble"
```

---

## Task 5: /lastfm/auth-url + /lastfm/connect routes

**Files:**
- Create: `server/src/routes/lastfm.ts`
- Create: `server/__tests__/routes/lastfm.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/routes/lastfm.test.ts`:

```ts
import express from 'express';
import request from 'supertest';
import { createLastFmRouter } from '@/routes/lastfm';
import type { LastFmClient } from '@/services/lastfm/LastFmClient';

const authStub = (uid: string): express.RequestHandler =>
  (req, _res, next) => { (req as unknown as { uid: string }).uid = uid; next(); };

interface MockFirestore {
  set: jest.Mock;
  delete: jest.Mock;
  update: jest.Mock;
}

const buildFirestore = (): MockFirestore => {
  const set = jest.fn(async () => {});
  const update = jest.fn(async () => {});
  const del = jest.fn(async () => {});
  return { set, update, delete: del };
};

const buildDb = (mock: MockFirestore) => ({
  collection: () => ({
    doc: () => ({
      set: mock.set,
      delete: mock.delete,
      update: mock.update,
      get: jest.fn(async () => ({ exists: false, data: () => undefined })),
    }),
  }),
});

const buildApp = (
  client: Partial<LastFmClient>,
  firestore: { collection: jest.Mock | (() => unknown) } = buildDb(buildFirestore()) as unknown as { collection: () => unknown },
) => {
  const app = express();
  app.use(express.json());
  app.use(authStub('uid-1'));
  app.use(createLastFmRouter({
    client: client as LastFmClient,
    firestore: firestore as unknown as FirebaseFirestore.Firestore,
    apiKey: 'K',
    callbackUrl: 'cleo://lastfm-callback',
  }));
  return app;
};

describe('POST /lastfm/auth-url', () => {
  it('returns the Last.fm authorize URL with api_key + cb', async () => {
    const app = buildApp({});
    const res = await request(app).post('/lastfm/auth-url').send();
    expect(res.status).toBe(200);
    expect(res.body.url).toBe(
      'https://www.last.fm/api/auth/?api_key=K&cb=cleo%3A%2F%2Flastfm-callback',
    );
  });
});

describe('POST /lastfm/connect', () => {
  it('exchanges token, writes Firestore doc, returns 204', async () => {
    const fs = buildFirestore();
    const client = {
      getSession: jest.fn(async () => ({ name: 'kari_w', key: 'SK_ABC' })),
    };
    const app = buildApp(client, buildDb(fs) as unknown as { collection: () => unknown });

    const res = await request(app).post('/lastfm/connect').send({ token: 'OAUTH_T' });

    expect(res.status).toBe(204);
    expect(client.getSession).toHaveBeenCalledWith('OAUTH_T');
    expect(fs.set).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'SK_ABC',
        username: 'kari_w',
        needsReconnect: false,
      }),
      { merge: true },
    );
  });

  it('rejects empty token (Zod 400)', async () => {
    const app = buildApp({ getSession: jest.fn() });
    const res = await request(app).post('/lastfm/connect').send({ token: '' });
    expect(res.status).toBe(400);
  });

  it('returns 502 if getSession throws', async () => {
    const client = { getSession: jest.fn(async () => { throw new Error('boom'); }) };
    const app = buildApp(client);
    const res = await request(app).post('/lastfm/connect').send({ token: 'T' });
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npm test -- routes/lastfm.test.ts
```

Expected: FAIL with "Cannot find module '@/routes/lastfm'".

- [ ] **Step 3: Implement the router with two routes**

Create `server/src/routes/lastfm.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import type { LastFmClient } from '../services/lastfm/LastFmClient';

export interface LastFmRouterDeps {
  client: LastFmClient;
  firestore: FirebaseFirestore.Firestore;
  apiKey: string;
  callbackUrl: string;
}

const integrationDoc = (firestore: FirebaseFirestore.Firestore, uid: string) =>
  firestore.collection('users').doc(uid).collection('integrations').doc('lastfm');

const connectSchema = z.object({
  token: z.string().trim().min(1).max(200),
});

export function createLastFmRouter(deps: LastFmRouterDeps): Router {
  const router = Router();

  router.post('/lastfm/auth-url', (_req, res) => {
    const url = `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(deps.apiKey)}&cb=${encodeURIComponent(deps.callbackUrl)}`;
    return res.json({ url });
  });

  router.post('/lastfm/connect', async (req, res) => {
    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
    }
    const uid = (req as unknown as { uid: string }).uid;
    try {
      const session = await deps.client.getSession(parsed.data.token);
      await integrationDoc(deps.firestore, uid).set({
        sessionKey: session.key,
        username: session.name,
        needsReconnect: false,
        connectedAt: new Date(),
      }, { merge: true });
      return res.status(204).end();
    } catch (err) {
      console.warn('[lastfm/connect] failed', err);
      return res.status(502).json({ error: 'last.fm exchange failed' });
    }
  });

  return router;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npm test -- routes/lastfm.test.ts
```

Expected: PASS, four tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/lastfm.ts server/__tests__/routes/lastfm.test.ts
git commit -m "feat(server): /lastfm/auth-url + /lastfm/connect"
```

---

## Task 6: /lastfm/disconnect route

**Files:**
- Modify: `server/src/routes/lastfm.ts`
- Modify: `server/__tests__/routes/lastfm.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `server/__tests__/routes/lastfm.test.ts`:

```ts
describe('POST /lastfm/disconnect', () => {
  it('deletes the integration doc and returns 204', async () => {
    const fs = buildFirestore();
    const app = buildApp({}, buildDb(fs) as unknown as { collection: () => unknown });
    const res = await request(app).post('/lastfm/disconnect').send();
    expect(res.status).toBe(204);
    expect(fs.delete).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npm test -- routes/lastfm.test.ts
```

Expected: FAIL with 404 (no route for `/lastfm/disconnect`).

- [ ] **Step 3: Add the disconnect route**

Add to `server/src/routes/lastfm.ts` inside `createLastFmRouter` before `return router;`:

```ts
  router.post('/lastfm/disconnect', async (req, res) => {
    const uid = (req as unknown as { uid: string }).uid;
    try {
      await integrationDoc(deps.firestore, uid).delete();
      return res.status(204).end();
    } catch (err) {
      console.warn('[lastfm/disconnect] failed', err);
      return res.status(500).json({ error: 'disconnect failed' });
    }
  });
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npm test -- routes/lastfm.test.ts
```

Expected: PASS, five tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/lastfm.ts server/__tests__/routes/lastfm.test.ts
git commit -m "feat(server): /lastfm/disconnect"
```

---

## Task 7: /lastfm/now-playing + /lastfm/scrobble + needsReconnect

**Files:**
- Modify: `server/src/routes/lastfm.ts`
- Modify: `server/__tests__/routes/lastfm.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `server/__tests__/routes/lastfm.test.ts`:

```ts
const buildDbWithSession = (fs: MockFirestore, sessionKey: string | null) => ({
  collection: () => ({
    doc: () => ({
      set: fs.set,
      delete: fs.delete,
      update: fs.update,
      get: jest.fn(async () => ({
        exists: sessionKey !== null,
        data: () => sessionKey === null ? undefined : { sessionKey, username: 'k' },
      })),
    }),
  }),
});

describe('POST /lastfm/now-playing', () => {
  it('reads sessionKey, calls updateNowPlaying, returns 204', async () => {
    const fs = buildFirestore();
    const client = {
      updateNowPlaying: jest.fn(async () => ({ ok: true as const })),
    };
    const app = buildApp(client, buildDbWithSession(fs, 'SK_OK') as unknown as { collection: () => unknown });

    const res = await request(app).post('/lastfm/now-playing').send({
      trackId: 'apple-1', title: 'Believe', artistName: 'Cher',
      albumTitle: 'Believe', duration: 240,
    });

    expect(res.status).toBe(204);
    expect(client.updateNowPlaying).toHaveBeenCalledWith('SK_OK', expect.objectContaining({
      title: 'Believe', artistName: 'Cher', albumTitle: 'Believe', duration: 240,
    }));
  });

  it('returns 412 if user has not connected (no doc)', async () => {
    const fs = buildFirestore();
    const client = { updateNowPlaying: jest.fn() };
    const app = buildApp(client, buildDbWithSession(fs, null) as unknown as { collection: () => unknown });

    const res = await request(app).post('/lastfm/now-playing').send({
      trackId: 'a', title: 'T', artistName: 'A', duration: 180,
    });

    expect(res.status).toBe(412);
    expect(client.updateNowPlaying).not.toHaveBeenCalled();
  });

  it('flips needsReconnect: true on Last.fm error code 9, returns 401', async () => {
    const fs = buildFirestore();
    const client = {
      updateNowPlaying: jest.fn(async () => ({
        ok: false as const, errorCode: 9, errorMessage: 'Invalid session key',
      })),
    };
    const app = buildApp(client, buildDbWithSession(fs, 'SK_STALE') as unknown as { collection: () => unknown });

    const res = await request(app).post('/lastfm/now-playing').send({
      trackId: 'a', title: 'T', artistName: 'A', duration: 180,
    });

    expect(res.status).toBe(401);
    expect(fs.update).toHaveBeenCalledWith({ needsReconnect: true });
  });

  it('flips needsReconnect on error code 4 too', async () => {
    const fs = buildFirestore();
    const client = {
      updateNowPlaying: jest.fn(async () => ({
        ok: false as const, errorCode: 4, errorMessage: 'Auth failed',
      })),
    };
    const app = buildApp(client, buildDbWithSession(fs, 'SK') as unknown as { collection: () => unknown });

    const res = await request(app).post('/lastfm/now-playing').send({
      trackId: 'a', title: 'T', artistName: 'A', duration: 180,
    });

    expect(res.status).toBe(401);
    expect(fs.update).toHaveBeenCalledWith({ needsReconnect: true });
  });

  it('returns 502 (no flag flip) on transient errors like code 16', async () => {
    const fs = buildFirestore();
    const client = {
      updateNowPlaying: jest.fn(async () => ({
        ok: false as const, errorCode: 16, errorMessage: 'temporarily unavailable',
      })),
    };
    const app = buildApp(client, buildDbWithSession(fs, 'SK') as unknown as { collection: () => unknown });

    const res = await request(app).post('/lastfm/now-playing').send({
      trackId: 'a', title: 'T', artistName: 'A', duration: 180,
    });

    expect(res.status).toBe(502);
    expect(fs.update).not.toHaveBeenCalled();
  });
});

describe('POST /lastfm/scrobble', () => {
  it('forwards startedAt to LastFmClient.scrobble', async () => {
    const fs = buildFirestore();
    const client = {
      scrobble: jest.fn(async () => ({ ok: true as const })),
    };
    const app = buildApp(client, buildDbWithSession(fs, 'SK') as unknown as { collection: () => unknown });

    const res = await request(app).post('/lastfm/scrobble').send({
      trackId: 'a', title: 'T', artistName: 'A', duration: 180,
      startedAt: 1714200000,
    });

    expect(res.status).toBe(204);
    expect(client.scrobble).toHaveBeenCalledWith('SK', expect.objectContaining({
      startedAt: 1714200000,
    }));
  });

  it('rejects scrobble without startedAt (Zod)', async () => {
    const fs = buildFirestore();
    const client = { scrobble: jest.fn() };
    const app = buildApp(client, buildDbWithSession(fs, 'SK') as unknown as { collection: () => unknown });

    const res = await request(app).post('/lastfm/scrobble').send({
      trackId: 'a', title: 'T', artistName: 'A', duration: 180,
    });

    expect(res.status).toBe(400);
    expect(client.scrobble).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npm test -- routes/lastfm.test.ts
```

Expected: FAIL — no `/lastfm/now-playing` or `/lastfm/scrobble` routes (404).

- [ ] **Step 3: Implement both routes**

Add to `server/src/routes/lastfm.ts`. First, add new schemas after `connectSchema`:

```ts
const trackBaseSchema = z.object({
  trackId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  artistName: z.string().trim().min(1).max(200),
  albumTitle: z.string().trim().max(200).optional(),
  duration: z.number().int().min(1).max(36000),
});

const nowPlayingSchema = trackBaseSchema;
const scrobbleSchema = trackBaseSchema.extend({
  startedAt: z.number().int().min(0).max(2_000_000_000),
});

const STICKY_AUTH_ERRORS = new Set([4, 9]);
```

Then add two routes inside `createLastFmRouter` before `return router;`:

```ts
  router.post('/lastfm/now-playing', async (req, res) => {
    const parsed = nowPlayingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
    }
    const uid = (req as unknown as { uid: string }).uid;
    const docRef = integrationDoc(deps.firestore, uid);
    const snap = await docRef.get();
    if (!snap.exists) {
      return res.status(412).json({ error: 'not connected' });
    }
    const sessionKey = (snap.data() as { sessionKey?: string } | undefined)?.sessionKey;
    if (!sessionKey) {
      return res.status(412).json({ error: 'not connected' });
    }
    const result = await deps.client.updateNowPlaying(sessionKey, parsed.data);
    if (result.ok) return res.status(204).end();
    if (STICKY_AUTH_ERRORS.has(result.errorCode)) {
      await docRef.update({ needsReconnect: true });
      return res.status(401).json({ error: 'last.fm session invalid', errorCode: result.errorCode });
    }
    return res.status(502).json({ error: 'last.fm error', errorCode: result.errorCode });
  });

  router.post('/lastfm/scrobble', async (req, res) => {
    const parsed = scrobbleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
    }
    const uid = (req as unknown as { uid: string }).uid;
    const docRef = integrationDoc(deps.firestore, uid);
    const snap = await docRef.get();
    if (!snap.exists) {
      return res.status(412).json({ error: 'not connected' });
    }
    const sessionKey = (snap.data() as { sessionKey?: string } | undefined)?.sessionKey;
    if (!sessionKey) {
      return res.status(412).json({ error: 'not connected' });
    }
    const result = await deps.client.scrobble(sessionKey, parsed.data);
    if (result.ok) return res.status(204).end();
    if (STICKY_AUTH_ERRORS.has(result.errorCode)) {
      await docRef.update({ needsReconnect: true });
      return res.status(401).json({ error: 'last.fm session invalid', errorCode: result.errorCode });
    }
    return res.status(502).json({ error: 'last.fm error', errorCode: result.errorCode });
  });
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npm test -- routes/lastfm.test.ts
```

Expected: PASS, all twelve route tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/lastfm.ts server/__tests__/routes/lastfm.test.ts
git commit -m "feat(server): /lastfm/now-playing + /lastfm/scrobble with needsReconnect"
```

---

## Task 8: Mount router in index.ts + scrobbleLimiter

**Files:**
- Modify: `server/src/index.ts`
- Modify: `server/.env.example`

- [ ] **Step 1: Add scrobbleLimiter and mount the router**

In `server/src/index.ts`, find the existing limiter definitions (around the existing `enrichmentLimiter`) and add a sibling `scrobbleLimiter`:

```ts
const scrobbleLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as unknown as { uid?: string }).uid ?? req.ip ?? 'anon',
});
```

Find where other auth-gated routers are mounted (around `app.use(requireAuth, enrichmentLimiter, enrichmentRouter);`). Add the imports at the top of the file:

```ts
import { firestore as adminFirestore } from './firebase';
import { LastFmClient } from './services/lastfm/LastFmClient';
import { createLastFmRouter } from './routes/lastfm';
```

Then add the router-mount block. Pattern matches the weather router (only mount if env present so missing config fails loud at boot but doesn't crash dev runs that don't use scrobble):

```ts
  if (process.env.LASTFM_API_KEY && process.env.LASTFM_API_SECRET) {
    const lastFmClient = new LastFmClient({
      apiKey: process.env.LASTFM_API_KEY,
      apiSecret: process.env.LASTFM_API_SECRET,
    });
    app.use(requireAuth, scrobbleLimiter, createLastFmRouter({
      client: lastFmClient,
      firestore: adminFirestore(),
      apiKey: process.env.LASTFM_API_KEY,
      callbackUrl: 'cleo://lastfm-callback',
    }));
  } else {
    console.warn('[lastfm] LASTFM_API_KEY or LASTFM_API_SECRET unset — scrobble routes disabled');
  }
```

- [ ] **Step 2: Update .env.example**

Append to `server/.env.example` (create lines that don't already exist):

```env
# Last.fm scrobble (#37) — separate from the enrichment LASTFM_API_KEY use.
# Both come from the same Last.fm API account at last.fm/api/account.
LASTFM_API_KEY=
LASTFM_API_SECRET=

# Firebase Admin SDK — points at the service account JSON downloaded
# from Firebase console (cleo-app-840c8 → Project Settings → Service accounts).
GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-service-account.json
```

- [ ] **Step 3: Run server tests to verify nothing broke**

```bash
cd server && npm test
```

Expected: PASS, full server suite green (pre-existing tests + new lastfm tests).

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts server/.env.example
git commit -m "feat(server): mount /lastfm router + scrobbleLimiter"
```

---

## Task 9: Firestore rules + .gitignore

**Files:**
- Modify: `firestore.rules`
- Modify: `server/.gitignore` (or root `.gitignore` — check which already excludes `server/.env`)

- [ ] **Step 1: Update firestore.rules**

Replace `firestore.rules` contents:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/likes/{trackId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /users/{uid}/integrations/{integrationId} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if false;  // server-only via Admin SDK
    }
  }
}
```

- [ ] **Step 2: Add gitignore entry**

Find which `.gitignore` excludes `server/.env`:

```bash
grep -rn "server/.env\|.env$" .gitignore server/.gitignore 2>/dev/null
```

In that same `.gitignore` file, add:

```
firebase-service-account.json
```

- [ ] **Step 3: Validate the rules locally**

```bash
firebase deploy --only firestore:rules --dry-run
```

Expected: dry-run succeeds, no rule errors. (If `firebase` CLI not authenticated, run `firebase login` first per the user's `feedback_firebase_cli` memory.)

- [ ] **Step 4: Commit**

```bash
git add firestore.rules .gitignore server/.gitignore
git commit -m "chore: firestore rules + gitignore for #37 scrobble"
```

---

## Task 10: Client Scrobbler types + class

**Files:**
- Create: `src/engines/Scrobbler.types.ts`
- Create: `src/engines/Scrobbler.ts`
- Create: `__tests__/engines/Scrobbler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/engines/Scrobbler.test.ts`:

```ts
import { Scrobbler } from '../../src/engines/Scrobbler';
import type { ScrobblerApi } from '../../src/engines/Scrobbler.types';
import type { ManifestTrack } from '../../src/engines/BroadcastPlayer.types';

const mkTrack = (over: Partial<ManifestTrack> = {}): ManifestTrack => ({
  id: 't1', title: 'T', artistName: 'A', albumTitle: 'AL', duration: 180,
  ...over,
});

const mkApi = (): jest.Mocked<ScrobblerApi> => ({
  nowPlaying: jest.fn(async () => {}),
  scrobble: jest.fn(async () => {}),
});

describe('Scrobbler', () => {
  describe('onTrackStarted', () => {
    it('fires nowPlaying with the track payload', () => {
      const api = mkApi();
      const s = new Scrobbler(api);
      s.onTrackStarted(mkTrack({ duration: 240 }));
      expect(api.nowPlaying).toHaveBeenCalledWith(expect.objectContaining({
        trackId: 't1', title: 'T', artistName: 'A', albumTitle: 'AL', duration: 240,
      }));
    });

    it('does not fire nowPlaying for tracks under 30s', () => {
      const api = mkApi();
      const s = new Scrobbler(api);
      s.onTrackStarted(mkTrack({ duration: 25 }));
      expect(api.nowPlaying).not.toHaveBeenCalled();
    });
  });

  describe('onElapsedTick threshold', () => {
    it.each([
      { dur: 60,   threshold: 30 },     // min(30, 240) = 30
      { dur: 180,  threshold: 90 },     // min(90, 240) = 90
      { dur: 600,  threshold: 240 },    // min(300, 240) = 240
      { dur: 4000, threshold: 240 },    // min(2000, 240) = 240
    ])('fires scrobble at exactly $threshold for a $dur s track', ({ dur, threshold }) => {
      const api = mkApi();
      const s = new Scrobbler(api);
      const track = mkTrack({ duration: dur });
      s.onTrackStarted(track);

      s.onElapsedTick(track, threshold - 1);
      expect(api.scrobble).not.toHaveBeenCalled();

      s.onElapsedTick(track, threshold);
      expect(api.scrobble).toHaveBeenCalledTimes(1);
    });

    it('fires scrobble at most once per track even with many ticks past threshold', () => {
      const api = mkApi();
      const s = new Scrobbler(api);
      const track = mkTrack({ duration: 60 });
      s.onTrackStarted(track);
      s.onElapsedTick(track, 30);
      s.onElapsedTick(track, 31);
      s.onElapsedTick(track, 50);
      expect(api.scrobble).toHaveBeenCalledTimes(1);
    });

    it('never fires scrobble for tracks under 30s no matter how long they tick', () => {
      const api = mkApi();
      const s = new Scrobbler(api);
      const track = mkTrack({ duration: 25 });
      s.onTrackStarted(track);
      s.onElapsedTick(track, 100);
      expect(api.scrobble).not.toHaveBeenCalled();
    });

    it('ignores ticks for a different track id (drift safety)', () => {
      const api = mkApi();
      const s = new Scrobbler(api);
      s.onTrackStarted(mkTrack({ id: 't1', duration: 60 }));
      s.onElapsedTick(mkTrack({ id: 't2', duration: 60 }), 100);
      expect(api.scrobble).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('clears track state so the next ticks are no-ops', () => {
      const api = mkApi();
      const s = new Scrobbler(api);
      s.onTrackStarted(mkTrack({ duration: 60 }));
      s.reset();
      s.onElapsedTick(mkTrack({ duration: 60 }), 100);
      expect(api.scrobble).not.toHaveBeenCalled();
    });
  });

  describe('startedAt timestamp', () => {
    it('passes unix-second timestamp to scrobble', () => {
      const api = mkApi();
      const s = new Scrobbler(api);
      const before = Math.floor(Date.now() / 1000);
      const track = mkTrack({ duration: 60 });
      s.onTrackStarted(track);
      s.onElapsedTick(track, 30);
      const after = Math.floor(Date.now() / 1000);
      const call = api.scrobble.mock.calls[0][0];
      expect(call.startedAt).toBeGreaterThanOrEqual(before);
      expect(call.startedAt).toBeLessThanOrEqual(after);
    });
  });

  describe('error tolerance', () => {
    it('swallows nowPlaying rejection', () => {
      const api = mkApi();
      api.nowPlaying.mockRejectedValueOnce(new Error('boom'));
      const s = new Scrobbler(api);
      expect(() => s.onTrackStarted(mkTrack({ duration: 60 }))).not.toThrow();
    });

    it('swallows scrobble rejection', () => {
      const api = mkApi();
      api.scrobble.mockRejectedValueOnce(new Error('boom'));
      const s = new Scrobbler(api);
      const track = mkTrack({ duration: 60 });
      s.onTrackStarted(track);
      expect(() => s.onElapsedTick(track, 30)).not.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- engines/Scrobbler.test.ts
```

Expected: FAIL with "Cannot find module '../../src/engines/Scrobbler'".

- [ ] **Step 3: Create types and implement**

Create `src/engines/Scrobbler.types.ts`:

```ts
export interface ScrobblePayload {
  trackId: string;
  title: string;
  artistName: string;
  albumTitle?: string;
  duration: number;
}

export interface ScrobbleEventPayload extends ScrobblePayload {
  startedAt: number;  // unix seconds
}

export interface ScrobblerApi {
  nowPlaying(p: ScrobblePayload): Promise<void>;
  scrobble(p: ScrobbleEventPayload): Promise<void>;
}
```

Create `src/engines/Scrobbler.ts`:

```ts
import type { ManifestTrack } from './BroadcastPlayer.types';
import type { ScrobblePayload, ScrobblerApi } from './Scrobbler.types';

const MIN_DURATION_S = 30;
const MAX_THRESHOLD_S = 240;

export class Scrobbler {
  private currentId: string | null = null;
  private startedAtMs = 0;
  private threshold = 0;
  private scrobbledThisTrack = false;

  constructor(private readonly api: ScrobblerApi) {}

  onTrackStarted(track: ManifestTrack): void {
    this.currentId = track.id;
    this.startedAtMs = Date.now();
    this.scrobbledThisTrack = false;

    if (track.duration < MIN_DURATION_S) {
      // Last.fm rule: tracks under 30s are never scrobbled.
      // Mark as already-scrobbled so the threshold tick is a no-op.
      this.scrobbledThisTrack = true;
      return;
    }
    this.threshold = Math.min(track.duration * 0.5, MAX_THRESHOLD_S);

    const payload: ScrobblePayload = {
      trackId: track.id,
      title: track.title,
      artistName: track.artistName,
      albumTitle: track.albumTitle,
      duration: track.duration,
    };
    this.api.nowPlaying(payload).catch(() => {});
  }

  onElapsedTick(track: ManifestTrack, elapsedSec: number): void {
    if (this.scrobbledThisTrack) return;
    if (track.id !== this.currentId) return;
    if (elapsedSec < this.threshold) return;

    this.scrobbledThisTrack = true;
    this.api.scrobble({
      trackId: track.id,
      title: track.title,
      artistName: track.artistName,
      albumTitle: track.albumTitle,
      duration: track.duration,
      startedAt: Math.floor(this.startedAtMs / 1000),
    }).catch(() => {});
  }

  reset(): void {
    this.currentId = null;
    this.scrobbledThisTrack = false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- engines/Scrobbler.test.ts
```

Expected: PASS, all Scrobbler tests green (including the table-driven threshold tests).

- [ ] **Step 5: Commit**

```bash
git add src/engines/Scrobbler.ts src/engines/Scrobbler.types.ts __tests__/engines/Scrobbler.test.ts
git commit -m "feat(client): Scrobbler engine class for #37"
```

---

## Task 11: Client LastFmService (HTTP wrapper)

**Files:**
- Create: `src/services/LastFmService.ts`
- Create: `__tests__/services/LastFmService.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/services/LastFmService.test.ts`:

```ts
import { fetchAuthUrl, connect, disconnect, nowPlaying, scrobble } from '../../src/services/LastFmService';

jest.mock('../../src/services/api', () => ({
  authenticatedFetch: jest.fn(),
}));

import { authenticatedFetch } from '../../src/services/api';

const mockFetch = authenticatedFetch as jest.Mock;

beforeEach(() => {
  mockFetch.mockReset();
});

const okJson = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json' },
});
const ok204 = () => new Response(null, { status: 204 });

describe('LastFmService', () => {
  it('fetchAuthUrl POSTs /lastfm/auth-url and returns url', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ url: 'https://www.last.fm/api/auth/?api_key=K&cb=cleo%3A%2F%2Flastfm-callback' }));
    const url = await fetchAuthUrl();
    expect(url).toContain('last.fm/api/auth');
    expect(mockFetch).toHaveBeenCalledWith('/lastfm/auth-url', expect.objectContaining({ method: 'POST' }));
  });

  it('connect POSTs /lastfm/connect with token', async () => {
    mockFetch.mockResolvedValueOnce(ok204());
    await connect('OAUTH_T');
    expect(mockFetch).toHaveBeenCalledWith('/lastfm/connect', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ token: 'OAUTH_T' }),
    }));
  });

  it('disconnect POSTs /lastfm/disconnect', async () => {
    mockFetch.mockResolvedValueOnce(ok204());
    await disconnect();
    expect(mockFetch).toHaveBeenCalledWith('/lastfm/disconnect', expect.objectContaining({ method: 'POST' }));
  });

  it('nowPlaying POSTs /lastfm/now-playing with payload', async () => {
    mockFetch.mockResolvedValueOnce(ok204());
    await nowPlaying({ trackId: 't', title: 'T', artistName: 'A', duration: 180 });
    expect(mockFetch).toHaveBeenCalledWith('/lastfm/now-playing', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ trackId: 't', title: 'T', artistName: 'A', duration: 180 }),
    }));
  });

  it('scrobble POSTs /lastfm/scrobble with startedAt', async () => {
    mockFetch.mockResolvedValueOnce(ok204());
    await scrobble({ trackId: 't', title: 'T', artistName: 'A', duration: 180, startedAt: 1714200000 });
    expect(mockFetch).toHaveBeenCalledWith('/lastfm/scrobble', expect.objectContaining({
      method: 'POST', body: expect.stringContaining('"startedAt":1714200000'),
    }));
  });

  it('connect throws on 5xx (caller decides what to do)', async () => {
    mockFetch.mockResolvedValueOnce(new Response('boom', { status: 502 }));
    await expect(connect('T')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- LastFmService.test.ts
```

Expected: FAIL with "Cannot find module '../../src/services/LastFmService'".

- [ ] **Step 3: Implement LastFmService**

Create `src/services/LastFmService.ts`:

```ts
import { authenticatedFetch } from './api';
import type { ScrobblePayload, ScrobbleEventPayload } from '../engines/Scrobbler.types';

async function postJson(path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method: 'POST' };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await authenticatedFetch(path, init);
  if (!res.ok && res.status !== 204) {
    throw new Error(`${path} → ${res.status}`);
  }
  return res;
}

export async function fetchAuthUrl(): Promise<string> {
  const res = await postJson('/lastfm/auth-url');
  const data = await res.json() as { url: string };
  return data.url;
}

export async function connect(token: string): Promise<void> {
  await postJson('/lastfm/connect', { token });
}

export async function disconnect(): Promise<void> {
  await postJson('/lastfm/disconnect');
}

export async function nowPlaying(p: ScrobblePayload): Promise<void> {
  await postJson('/lastfm/now-playing', p);
}

export async function scrobble(p: ScrobbleEventPayload): Promise<void> {
  await postJson('/lastfm/scrobble', p);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- LastFmService.test.ts
```

Expected: PASS, all six LastFmService tests green.

- [ ] **Step 5: Commit**

```bash
git add src/services/LastFmService.ts __tests__/services/LastFmService.test.ts
git commit -m "feat(client): LastFmService HTTP wrapper for #37"
```

---

## Task 12: Wire Scrobbler into BroadcastPlayer

**Files:**
- Modify: `src/engines/BroadcastPlayer.ts`
- Modify: `__tests__/engines/BroadcastPlayer.test.ts`

> **Why optional dep, not new positional arg:** `BroadcastPlayer` is constructed in 20+ existing test cases. Making `scrobbler` an optional positional dep with a no-op default means existing tests stay green without edits.

- [ ] **Step 1: Add a failing test**

Append to `__tests__/engines/BroadcastPlayer.test.ts` at the bottom of the outer describe block:

```ts
describe('Scrobbler integration', () => {
  it('calls scrobbler.onTrackStarted after music.play resolves; reset on end()', async () => {
    const deps = makeDeps();
    const scrobbler = {
      onTrackStarted: jest.fn(),
      onElapsedTick: jest.fn(),
      reset: jest.fn(),
    };
    const player = new BroadcastPlayer(
      deps.music, deps.native, deps.manifestClient, deps.stingers, scrobbler,
    );

    player.start(makeManifest(), ['https://cdn/seg0-v0.mp3']);

    // Drive the cold-open + first track through. Use a tight async loop —
    // the existing test file uses similar wait-for-state idioms.
    for (let i = 0; i < 200 && scrobbler.onTrackStarted.mock.calls.length === 0; i++) {
      await Promise.resolve();
    }

    expect(scrobbler.onTrackStarted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't0' }),
    );

    player.end();
    expect(scrobbler.reset).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- engines/BroadcastPlayer.test.ts
```

Expected: FAIL — `scrobbler.onTrackStarted` not called (no wiring yet).

- [ ] **Step 3: Add the optional scrobbler dep + 3 hook points**

In `src/engines/BroadcastPlayer.ts`:

(a) Add a type near the top of the file (before the class), or at the end of `BroadcastPlayer.types.ts` if you prefer co-locating types — pick whichever matches the file's pattern. For consistency with existing `MusicDeps` etc., add inline above the class:

```ts
export interface ScrobblerDeps {
  onTrackStarted(track: ManifestTrack): void;
  onElapsedTick(track: ManifestTrack, elapsedSec: number): void;
  reset(): void;
}

const NOOP_SCROBBLER: ScrobblerDeps = {
  onTrackStarted: () => {},
  onElapsedTick: () => {},
  reset: () => {},
};
```

(b) Update the constructor (around line 108) to accept the optional dep:

```ts
  constructor(
    private readonly music: MusicDeps,
    private readonly native: NativeDeps,
    private readonly manifestClient: ManifestDeps,
    private readonly stingers: StingerDeps,
    private readonly scrobbler: ScrobblerDeps = NOOP_SCROBBLER,
  ) {}
```

(c) Wire `onTrackStarted` in `runTrackAt` (around line 640). Locate this line:

```ts
console.log(`[BroadcastPlayer] music.play resolved for ${track.id}`);
```

Add immediately after it:

```ts
this.scrobbler.onTrackStarted(track);
```

(d) Wire `onElapsedTick` inside `startElapsedPump`. Search for the existing call to `setNowPlayingElapsed`:

```bash
grep -n "setNowPlayingElapsed" src/engines/BroadcastPlayer.ts
```

Find the line inside the per-second tick (look for the surrounding `setInterval` or async loop). After the existing `await this.music.setNowPlayingElapsed(elapsed, ...)` call, add:

```ts
const track = this.manifest?.tracks[this.currentTrackIndex];
if (track) this.scrobbler.onElapsedTick(track, elapsed);
```

(If a `track` variable is already available in that scope, just add the `this.scrobbler.onElapsedTick(track, elapsed);` line.)

(e) Wire `reset` in `end()`. Search for `currentTrackIndex = -1` near `end`:

```bash
grep -n "currentTrackIndex = -1\|^\s*end()" src/engines/BroadcastPlayer.ts
```

After the `this.currentTrackIndex = -1` line in `end()`, add:

```ts
this.scrobbler.reset();
```

- [ ] **Step 4: Run all engine tests to verify pass + no regressions**

```bash
npm test -- engines/
```

Expected: PASS, all engines/ tests green (including pre-existing BroadcastPlayer suite + the new Scrobbler integration test).

- [ ] **Step 5: Commit**

```bash
git add src/engines/BroadcastPlayer.ts __tests__/engines/BroadcastPlayer.test.ts
git commit -m "feat(client): wire Scrobbler hooks into BroadcastPlayer"
```

---

## Task 13: Wire production Scrobbler into singleton

**Files:**
- Modify: `src/engines/BroadcastPlayer.singleton.ts`

- [ ] **Step 1: Edit the singleton**

In `src/engines/BroadcastPlayer.singleton.ts`, add at the top imports:

```ts
import { Scrobbler } from './Scrobbler';
import * as LastFmService from '../services/LastFmService';
```

Replace the `export const broadcastPlayer = new BroadcastPlayer(` block to pass the scrobbler as a fifth arg:

```ts
const scrobbler = new Scrobbler({
  nowPlaying: (p) => LastFmService.nowPlaying(p),
  scrobble: (p) => LastFmService.scrobble(p),
});

export const broadcastPlayer = new BroadcastPlayer(
  {
    play: (ids?: string[]) => musicKitPlayer.play(ids),
    pause: () => musicKitPlayer.pause(),
    skip: () => musicKitPlayer.skip(),
    setUpcomingQueue: (ids: string[]) => musicKitPlayer.setUpcomingQueue(ids),
    onTrackChanged: (cb) => musicKitPlayer.onTrackChanged(cb),
    onPlaybackStateChanged: (cb) => musicKitPlayer.onPlaybackStateChanged(cb),
    getPlaybackStatus: () => musicKitPlayer.getPlaybackStatus(),
    getPlaybackTime: () => musicKitPlayer.getPlaybackTime(),
    setNowPlayingTrack:   (p) => musicKitPlayer.setNowPlayingTrack(p),
    setNowPlayingSegment: (p) => musicKitPlayer.setNowPlayingSegment(p),
    setNowPlayingElapsed: (e, p) => musicKitPlayer.setNowPlayingElapsed(e, p),
    clearNowPlaying:      ()  => musicKitPlayer.clearNowPlaying(),
    subscribeRemoteCommands: (h) => musicKitPlayer.subscribeRemoteCommands(h),
    startBroadcastLiveActivity:  (a, s) => musicKitPlayer.startBroadcastLiveActivity(a, s),
    updateBroadcastLiveActivity: (s)    => musicKitPlayer.updateBroadcastLiveActivity(s),
    endBroadcastLiveActivity:    ()     => musicKitPlayer.endBroadcastLiveActivity(),
  },
  {
    activateDuckingSession, deactivateDuckingSession, playAudioFromBase64,
    stopAudio, releaseAudioSession, setBroadcastActive,
  },
  new BroadcastManifestClient(),
  { getStinger, preloadStingers },
  scrobbler,
);
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/engines/BroadcastPlayer.singleton.ts
git commit -m "feat(client): wire production Scrobbler into BroadcastPlayer singleton"
```

---

## Task 14: useLastFmIntegration hook

**Files:**
- Create: `src/hooks/useLastFmIntegration.ts`
- Create: `__tests__/hooks/useLastFmIntegration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/hooks/useLastFmIntegration.test.ts`:

```ts
import { renderHook, act } from '@testing-library/react-hooks';
import {
  __resetFirestore,
  __seedDoc,
  __deleteDoc,
} from '../../__mocks__/@react-native-firebase/firestore';
import { __resetAuth } from '../../__mocks__/@react-native-firebase/auth';
import { useLastFmIntegration } from '../../src/hooks/useLastFmIntegration';

beforeEach(() => {
  __resetFirestore();
  __resetAuth();
});

describe('useLastFmIntegration', () => {
  it('returns disconnected state when no doc exists', async () => {
    const { result, waitForNextUpdate } = renderHook(() => useLastFmIntegration());
    await waitForNextUpdate();
    expect(result.current).toEqual({
      loading: false, status: 'disconnected', username: null,
    });
  });

  it('returns connected state when doc has needsReconnect=false', async () => {
    __seedDoc('users/test-uid/integrations/lastfm', {
      sessionKey: 'SK', username: 'kari_w', needsReconnect: false,
    });
    const { result, waitForNextUpdate } = renderHook(() => useLastFmIntegration());
    await waitForNextUpdate();
    expect(result.current).toEqual({
      loading: false, status: 'connected', username: 'kari_w',
    });
  });

  it('returns needs-reconnect state when needsReconnect=true', async () => {
    __seedDoc('users/test-uid/integrations/lastfm', {
      sessionKey: 'SK', username: 'kari_w', needsReconnect: true,
    });
    const { result, waitForNextUpdate } = renderHook(() => useLastFmIntegration());
    await waitForNextUpdate();
    expect(result.current).toEqual({
      loading: false, status: 'needs-reconnect', username: 'kari_w',
    });
  });

  it('updates when the doc changes (subscription)', async () => {
    const { result, waitForNextUpdate } = renderHook(() => useLastFmIntegration());
    await waitForNextUpdate();
    expect(result.current.status).toBe('disconnected');

    act(() => {
      __seedDoc('users/test-uid/integrations/lastfm', {
        sessionKey: 'SK', username: 'kari_w', needsReconnect: false,
      });
    });
    await waitForNextUpdate();
    expect(result.current.status).toBe('connected');

    act(() => { __deleteDoc('users/test-uid/integrations/lastfm'); });
    await waitForNextUpdate();
    expect(result.current.status).toBe('disconnected');
  });
});
```

> **Note:** if `@testing-library/react-hooks` isn't installed, install it as a dev dep first:
> ```bash
> npm install --save-dev @testing-library/react-hooks
> ```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- useLastFmIntegration.test.ts
```

Expected: FAIL with "Cannot find module '../../src/hooks/useLastFmIntegration'".

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useLastFmIntegration.ts`:

```ts
import { useEffect, useState } from 'react';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';

export type LastFmStatus = 'disconnected' | 'connected' | 'needs-reconnect';

export interface LastFmIntegrationState {
  loading: boolean;
  status: LastFmStatus;
  username: string | null;
}

const INITIAL: LastFmIntegrationState = {
  loading: true, status: 'disconnected', username: null,
};

export function useLastFmIntegration(): LastFmIntegrationState {
  const [state, setState] = useState<LastFmIntegrationState>(INITIAL);

  useEffect(() => {
    const uid = auth().currentUser?.uid;
    if (!uid) {
      setState({ loading: false, status: 'disconnected', username: null });
      return;
    }
    const ref = firestore().doc(`users/${uid}/integrations/lastfm`);
    const unsub = ref.onSnapshot(
      (snap) => {
        if (!snap.exists()) {
          setState({ loading: false, status: 'disconnected', username: null });
          return;
        }
        const data = snap.data() as {
          username?: string;
          needsReconnect?: boolean;
        } | undefined;
        const username = data?.username ?? null;
        const status: LastFmStatus = data?.needsReconnect ? 'needs-reconnect' : 'connected';
        setState({ loading: false, status, username });
      },
      (err) => {
        console.warn('[useLastFmIntegration] subscription error', err);
        setState({ loading: false, status: 'disconnected', username: null });
      },
    );
    return unsub;
  }, []);

  return state;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- useLastFmIntegration.test.ts
```

Expected: PASS, all four hook tests green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLastFmIntegration.ts __tests__/hooks/useLastFmIntegration.test.ts package.json package-lock.json
git commit -m "feat(client): useLastFmIntegration hook for #37"
```

---

## Task 15: LastFmRow component

**Files:**
- Create: `src/components/profile/LastFmRow.tsx`

> **Note:** No unit test for the component itself — it's pure presentation driven by props. The hook test (Task 14) covers the state derivation.

- [ ] **Step 1: Create the component**

Create `src/components/profile/LastFmRow.tsx`:

```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import type { LastFmStatus } from '../../hooks/useLastFmIntegration';

interface Props {
  status: LastFmStatus;
  username: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function LastFmRow({ status, username, onConnect, onDisconnect }: Props) {
  const handlePrimary = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (status === 'connected') {
      onDisconnect();
    } else {
      onConnect();
    }
  };

  const trailingLabel =
    status === 'connected' ? 'DISCONNECT' :
    status === 'needs-reconnect' ? 'RECONNECT' : 'CONNECT';

  const trailingColor =
    status === 'needs-reconnect' ? AM.amber :
    status === 'connected' ? AM.inkDim : AM.ink;

  return (
    <Pressable
      onPress={handlePrimary}
      accessibilityRole="button"
      accessibilityLabel={
        status === 'connected'
          ? `Last.fm connected as ${username ?? 'unknown'}. Tap to disconnect.`
          : status === 'needs-reconnect'
          ? `Last.fm needs reconnect. Tap to re-authorize.`
          : `Connect Last.fm to start scrobbling.`
      }
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.left}>
        {status === 'needs-reconnect' && <View style={styles.dot} />}
        <Text style={styles.kicker}>LAST.FM</Text>
      </View>

      <View style={styles.body}>
        {status === 'connected' || status === 'needs-reconnect' ? (
          <Text style={styles.username} numberOfLines={1}>
            connected as @{username ?? '—'}
          </Text>
        ) : (
          <Text style={styles.tagline} numberOfLines={1}>
            scrobble what ONAY plays
          </Text>
        )}
      </View>

      <Text style={[styles.trailing, { color: trailingColor }]}>{trailingLabel}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Space.s12,
    borderBottomWidth: 0.5,
    borderBottomColor: AM.rule,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 80,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: AM.amber,
    marginRight: Space.s6,
  },
  kicker: {
    color: AM.amberDim,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1.5,
  },
  body: {
    flex: 1,
    marginHorizontal: Space.s12,
  },
  username: {
    color: AM.ink,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s14,
  },
  tagline: {
    color: AM.inkMid,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s14,
  },
  trailing: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s11,
    letterSpacing: 1.2,
  },
});
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. (`Fonts.serif` resolves to `Fraunces_400Regular_Italic` per `src/tokens/design-tokens.ts:49`.)

- [ ] **Step 3: Commit**

```bash
git add src/components/profile/LastFmRow.tsx
git commit -m "feat(client): LastFmRow component for #37"
```

---

## Task 16: ProfileScreen integration + OAuth handler

**Files:**
- Modify: `src/screens/settings/ProfileScreen.tsx`

- [ ] **Step 1: Add the OAuth handler + render LastFmRow**

In `src/screens/settings/ProfileScreen.tsx`:

(a) Add imports near the top:

```ts
import * as WebBrowser from 'expo-web-browser';
import { LastFmRow } from '../../components/profile/LastFmRow';
import { useLastFmIntegration } from '../../hooks/useLastFmIntegration';
import * as LastFmService from '../../services/LastFmService';
```

(b) Inside `ProfileScreen`, add hook + handlers near the existing `useLikedTracks` block:

```ts
  const { status: lastFmStatus, username: lastFmUsername } = useLastFmIntegration();

  const onConnectLastFm = useCallback(async () => {
    try {
      const url = await LastFmService.fetchAuthUrl();
      const result = await WebBrowser.openAuthSessionAsync(url, 'cleo://lastfm-callback');
      if (result.type !== 'success' || !result.url) return;
      const cb = new URL(result.url);
      const token = cb.searchParams.get('token');
      if (!token) {
        Alert.alert('Last.fm', 'No token in callback. Try again.');
        return;
      }
      await LastFmService.connect(token);
    } catch (err) {
      Alert.alert('Last.fm', `Could not connect: ${(err as Error).message}`);
    }
  }, []);

  const onDisconnectLastFm = useCallback(async () => {
    try {
      await LastFmService.disconnect();
    } catch (err) {
      Alert.alert('Last.fm', `Could not disconnect: ${(err as Error).message}`);
    }
  }, []);
```

(c) Render `LastFmRow` above the liked-tracks section. Look for where `LikedRow`s are rendered (search for `<LikedRow`). Insert just above that block, inside the same `ScrollView` body and ideally inside a wrapping `View` with the same horizontal padding the surrounding rows use:

```tsx
  <LastFmRow
    status={lastFmStatus}
    username={lastFmUsername}
    onConnect={onConnectLastFm}
    onDisconnect={onDisconnectLastFm}
  />
```

If there's a `SectionMarker` for the liked tracks block, place `LastFmRow` *above* the marker so it visually belongs to the integrations area, not the liked-tracks area.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. If `URL` isn't available in the RN environment, replace with a regex parse:

```ts
const m = result.url.match(/[?&]token=([^&]+)/);
const token = m ? decodeURIComponent(m[1]) : null;
```

- [ ] **Step 3: Visual smoke test**

```bash
npm start
```

In the simulator, navigate to the ONAY tab (Profile). Verify:
- The `LASTFM` row renders above the liked tracks block, with the `CONNECT` trailing label
- Tapping `CONNECT` opens the in-app Safari modal at `last.fm/api/auth?...`
- (Cannot complete OAuth round-trip in the simulator without `LASTFM_API_KEY` provisioned on the dev server — that's part of manual verification in Task 18)

Per CLAUDE.md: "If you can't test the UI, say so explicitly rather than claiming success." If the dev server doesn't have `LASTFM_API_KEY` yet, just verify the row paints and the tap fires `LastFmService.fetchAuthUrl()` (visible in `console.log` from `authenticatedFetch`).

- [ ] **Step 4: Commit**

```bash
git add src/screens/settings/ProfileScreen.tsx
git commit -m "feat(client): ProfileScreen Last.fm row + OAuth handler"
```

---

## Task 17: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the env vars block**

In `CLAUDE.md`, find the `server/.env (gitignored)` env vars block. Add to it:

```env
LASTFM_API_KEY                            # NOTE: also used by enrichment LastFmFetcher;
LASTFM_API_SECRET                         # required for /lastfm/scrobble personal flow
GOOGLE_APPLICATION_CREDENTIALS            # path to firebase-admin service-account JSON
```

(Place near the existing `GENIUS_ACCESS_TOKEN` line — they're both third-party-API keys.)

- [ ] **Step 2: Add an integrations subsection**

In `CLAUDE.md`, find the `## The Pre-Baked Broadcast Pipeline` section. Add a new subsection at the end of that section:

```markdown
### Personal Last.fm scrobble (#37)

Distinct from the server-side `LastFmFetcher` enrichment use. Per-user OAuth
flow on `ProfileScreen` (CONNECT button → in-app Safari → `cleo://lastfm-callback`).
Session keys persisted to Firestore `users/{uid}/integrations/lastfm`; the
client never sees the sessionKey after OAuth.

Client emission (`src/engines/Scrobbler.ts`):
- `onTrackStarted(track)` after `music.play` resolves → `POST /lastfm/now-playing`
- `onElapsedTick(track, elapsed)` from the 1Hz pump fires `POST /lastfm/scrobble`
  the moment elapsed crosses `min(0.5 × duration, 240s)`. Tracks <30s never
  scrobble. Threshold-on-tick (not at-track-end) so app-kill mid-track still
  scrobbles.

Server signs requests via `LastFmClient` and POSTs to
`ws.audioscrobbler.com/2.0`. On Last.fm error code 4 or 9 (sticky auth
revocation), server flips `users/{uid}/integrations/lastfm.needsReconnect = true`
and the row swaps to "RECONNECT" via the Firestore subscription.

Best-effort, online-only — no offline queue. Adding `firebase-admin` for
server-side Firestore writes was a hard prereq.
```

- [ ] **Step 3: Add to the conventions list**

In `CLAUDE.md`, find the `## Important Conventions` list. Add a bullet near the
`MMKV for all local persistence` line:

```markdown
- **Last.fm session keys live in Firestore, never MMKV.** They're long-lived
  bearer tokens for a personal account. Server-only writes (Firestore rule
  `allow write: if false`); client subscribes via `useLastFmIntegration`.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): document #37 Last.fm scrobble flow + new env vars"
```

---

## Task 18: Manual verification + rollout

> **Not a code task.** This is a manual verification checklist. Run after Task 17 commits, before opening the PR.

- [ ] **Step 1: Provision Last.fm API account**

  - Sign in at `last.fm/api/account` (existing account if any, or new)
  - Generate API key + shared secret
  - Add to local `server/.env`:
    ```env
    LASTFM_API_KEY=<from console>
    LASTFM_API_SECRET=<from console>
    ```

- [ ] **Step 2: Provision firebase-admin service account locally**

  - Firebase console → `cleo-app-840c8` → Project Settings → Service accounts → Generate new private key
  - Save JSON to `server/firebase-service-account.json` (gitignored per Task 9)
  - Add to local `server/.env`:
    ```env
    GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json
    ```
  - Restart `cd server && npm run dev` — server log should show no `[lastfm] LASTFM_API_KEY... unset` warning

- [ ] **Step 3: Deploy Firestore rules to prod first**

  ```bash
  firebase deploy --only firestore:rules
  ```

  This must happen **before** the client ships, so the strict `allow write: if false` rule is live before any client tries to write to `users/{uid}/integrations/`.

- [ ] **Step 4: Local OAuth round-trip**

  - Run `npm start`, open in simulator
  - Profile tab → tap `CONNECT` on the LAST.FM row
  - In-app Safari opens last.fm authorize page
  - Log in, click "Yes, allow access"
  - Returns to app; row should flip to `connected as @<username> · DISCONNECT`
  - Verify Firestore: `users/<your-uid>/integrations/lastfm` exists with `sessionKey`, `username`, `needsReconnect: false`

- [ ] **Step 5: Scrobble end-to-end**

  - Build a 5-track broadcast (any vibe, quick length)
  - Listen to one full track (or set device clock forward to skip the wait)
  - Within 30s of the threshold crossing, refresh `last.fm/user/<your-username>` — the track should appear in "Recent listens"
  - Pause mid-second-track for 2 minutes, resume, finish — verify the second track also scrobbles (cumulative time, not wall clock)

- [ ] **Step 6: Revocation surface**

  - Visit `last.fm/settings/applications`, find ONAY, click "Revoke access"
  - Build another broadcast and start it. Within seconds of the first track passing the threshold, the row should flip to `RECONNECT` (amber)
  - No new scrobbles appear on Last.fm

- [ ] **Step 7: Reconnect**

  - Tap `RECONNECT` — re-runs the OAuth flow
  - Confirm row reverts to `connected as @<username>`
  - Subsequent tracks scrobble again

- [ ] **Step 8: Provision prod env on Hostinger VPS**

  Per `reference_server_infrastructure` memory: SSH `cleo@187.124.69.95`, edit the PM2 ecosystem env file or `.env`:

  ```env
  LASTFM_API_KEY=<same as dev>
  LASTFM_API_SECRET=<same as dev>
  GOOGLE_APPLICATION_CREDENTIALS=/home/cleo/cleo-broadcast/firebase-service-account.json
  ```

  Upload `firebase-service-account.json` (mode 600, owned by `cleo`) to that path. Restart: `pm2 restart cleo-broadcast`. Verify no warning in `pm2 logs cleo-broadcast`.

- [ ] **Step 9: TestFlight build**

  Per CLAUDE.md TestFlight runbook:
  1. Bump `CURRENT_PROJECT_VERSION` in `ios/ONAY.xcodeproj/project.pbxproj` (all 4 occurrences)
  2. Bump `ios.buildNumber` in `app.json` for parity
  3. `eas build --profile production --platform ios --non-interactive`
  4. `eas submit --profile production --platform ios --latest`

  Smoke-test on TestFlight: connect → broadcast → verify scrobble at `last.fm/user/<name>`.

- [ ] **Step 10: PR**

  Per `feedback_coderabbit_pre_pr` memory, run:

  ```bash
  coderabbit review --agent --base main --type committed
  ```

  Address any findings before opening the PR. Then:

  ```bash
  gh pr create --title "feat: Last.fm scrobble (closes #37)" --body "$(cat <<'EOF'
  ## Summary

  Per-user Last.fm scrobble integration with OAuth on ProfileScreen. Distinct from existing server-side enrichment use — separate per-user session keys in Firestore (server-only writes via firebase-admin), plus client emission from BroadcastPlayer at music.play resolve and at threshold crossing.

  Best-effort online-only, sticky `needsReconnect` surface on Last.fm error code 9.

  ## Test plan

  - [ ] Server: `cd server && npm test` (LastFmClient, routes, firebase singleton)
  - [ ] Client: `npm test` (Scrobbler, LastFmService, useLastFmIntegration)
  - [ ] OAuth: connect from ProfileScreen, verify Firestore doc
  - [ ] Scrobble: full track plays, appears at last.fm/user/<name> within 30s
  - [ ] Revocation: revoke at last.fm.com, verify row flips to RECONNECT
  - [ ] Reconnect: tap RECONNECT, verify subsequent scrobbles work

  Closes #37
  EOF
  )"
  ```

---

## Self-review notes

- [ ] **Spec coverage check** — every "Done when" item from #37:
  - Last.fm OAuth flow on Profile screen → Tasks 5, 11, 16
  - Per-user OAuth token written to Firestore (NOT MMKV) → Task 5 (Firestore set), Task 9 (rules)
  - Client emits "now playing" event when MusicKitPlayer.play resolves → Tasks 10 + 12
  - Client emits "scrobble" event past 50% / 4 minutes → Tasks 10 + 12 (threshold-on-tick)
  - Server-side worker consumes events and POSTs to Last.fm → Tasks 4, 7
  - Scrobbles visible in Last.fm account within 30s → Task 18 manual verification
  - Disconnect flow → Tasks 6 + 16

- [ ] **Type consistency** — `ScrobblePayload` (no startedAt) vs `ScrobbleEventPayload` (with startedAt) defined once in `Scrobbler.types.ts`, used identically in both `Scrobbler.ts` and `LastFmService.ts`. `ScrobbleTrack` is the server-side equivalent (slight name drift, intentional — different module, different concerns).

- [ ] **No placeholders** — every code block compiles as-is. The `Fonts.linerNotes` reference in Task 15 is the one spot that may need a fallback (noted in Step 2 of that task).

- [ ] **Order of operations** — server prereq (Task 1) comes first because everything else needs `firebase-admin`. Tests written before implementation in every applicable task. Singleton wiring (Task 13) intentionally separate from class hooks (Task 12) so the BroadcastPlayer test suite stays unit-pure.
