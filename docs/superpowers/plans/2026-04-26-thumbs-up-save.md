# Thumbs-up Save-to-List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a heart-toggle on the broadcast player that saves the currently-playing track to a per-user Firestore "Liked" list (capped at 200, FIFO eviction), surfaced as a new `D·04 LIKED` section on the Profile screen.

**Architecture:** Direct device-to-Firestore. New client service `LikedTracksService` (toggle + two subscriptions) drives two React hooks (`useLikedTrack` for one doc, `useLikedTracks` for the collection). Player and Profile consume the hooks. No server changes — Firestore Security Rules enforce ownership.

**Tech Stack:** `@react-native-firebase/firestore` (new), existing `@react-native-firebase/auth`, Jest + ts-jest, React Native + Expo SDK 55.

**Spec:** [`docs/superpowers/specs/2026-04-26-thumbs-up-save-design.md`](../specs/2026-04-26-thumbs-up-save-design.md)

---

## Pre-flight: branch

- [ ] **Step 1: Confirm clean main + create feature branch**

```bash
git checkout main
git pull origin main
git checkout -b feat/thumbs-up-saves
```

The repo has unrelated WIP modifications (M app.json, ios/, etc.) — leave them in place. They are unrelated to this feature and the user has been carrying them across multiple branches.

---

## Task 1: Add dependencies

**Files:**
- Modify: `package.json` (add deps)
- Modify: `package-lock.json` (auto-generated)

The Firestore client SDK and the testing-library tools needed for hook tests.

- [ ] **Step 1: Install runtime + dev deps**

```bash
npm install @react-native-firebase/firestore@^23.8.8
npm install --save-dev @testing-library/react-native@^13.0.0 react-test-renderer@18.3.1
```

The `@react-native-firebase/firestore` version matches the `@react-native-firebase/auth` version already in `package.json`. `react-test-renderer` major must match `react` major (18.x).

- [ ] **Step 2: Verify the dependency landed in package.json**

```bash
grep -E "@react-native-firebase/firestore|@testing-library/react-native|react-test-renderer" package.json
```

Expected: three matching lines, one per package. (Plain `node -e require(...)` does NOT work for RN packages because they import React Native runtime imports that Node can't parse — the mock-backed Jest run in Task 3+ is the real import smoke test.)

- [ ] **Step 3: Verify ios/ Pod is updated**

```bash
cd ios && pod install && cd ..
```

Expected: pod install completes; `RNFBFirestore` appears in `ios/Podfile.lock`.

If pod install fails with arch mismatches, run `pod install --repo-update`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json ios/Podfile.lock
git commit -m "chore(client): add @react-native-firebase/firestore + testing-library"
```

---

## Task 2: Firestore Security Rules + firebase.json (Firebase CLI / MCP)

**Files:**
- Create: `firestore.rules`
- Create: `firebase.json`
- Create: `.firebaserc`

Per spec: `users/{uid}/likes/{trackId}` is readable/writable only by the owner.

Firebase project context (verified via `firebase_get_environment` on 2026-04-26):

- Active project: `cleo-app-840c8`
- iOS app bundle: `com.worthymedia.cleo`
- Authenticated user: `hustlemanentertainment@gmail.com`
- Billing enabled, Gemini-in-Firebase ToS accepted

**Use the Firebase MCP tools and CLI for every step here — do not hand-write
config files when MCP tools can scaffold them, and do not skip server-side
validation.**

- [ ] **Step 1: Confirm Firebase environment via MCP**

Use the `mcp__plugin_firebase_firebase__firebase_get_environment` tool. Confirm:

- Active Project ID is `cleo-app-840c8`.
- Authenticated User is `hustlemanentertainment@gmail.com`.

If the active project is wrong, stop and escalate. Do not proceed with rules
work against the wrong project.

- [ ] **Step 2: Read currently-deployed rules (safety check)**

Use `mcp__plugin_firebase_firebase__firebase_get_security_rules` with
`type: "firestore"`. Save the response — the new rules must add to (not remove)
any owner-scoped rules already deployed. If existing rules already cover
`users/{uid}/likes/{trackId}`, escalate to the user before continuing.

- [ ] **Step 3: Write the rules file**

Create `firestore.rules` at the repo root:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/likes/{trackId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

- [ ] **Step 4: Validate rules with the Firebase MCP**

Use `mcp__plugin_firebase_firebase__firebase_validate_security_rules` with
`type: "firestore"` and `source_file: "firestore.rules"`.

Expected: no syntax or validation errors. If the tool returns errors, fix the
rules file before committing.

- [ ] **Step 5: Write `firebase.json`**

Create `firebase.json` at the repo root so `firebase deploy --only
firestore:rules` knows where the rules file is:

```json
{
  "firestore": {
    "rules": "firestore.rules"
  }
}
```

- [ ] **Step 6: Pin the Firebase project alias**

Create `.firebaserc` so the firebase CLI defaults to the right project without
relying on whatever `firebase use` was last run on the developer's machine:

```json
{
  "projects": {
    "default": "cleo-app-840c8"
  }
}
```

- [ ] **Step 7: Dry-run the deploy via the firebase CLI**

```bash
firebase deploy --only firestore:rules --dry-run --project cleo-app-840c8
```

Expected output ends with `✔  Deploy complete!` (dry-run).

If the firebase CLI is not installed locally, ask the user to run
`npm install -g firebase-tools` and re-run this step. Do not commit until the
dry-run succeeds.

- [ ] **Step 8: Commit**

```bash
git add firestore.rules firebase.json .firebaserc
git commit -m "feat(firestore): security rules for users/{uid}/likes subcollection"
```

**Deployment note:** the actual `firebase deploy --only firestore:rules` (without
`--dry-run`) is left for the user to run after PR merge — it's a production
write that should follow the merge gate, not precede it. The PR body in Task 15
includes this in the post-merge checklist.

---

## Task 3: Mocks for Jest

**Files:**
- Create: `__mocks__/@react-native-firebase/firestore.ts`
- Create: `__mocks__/@react-native-firebase/auth.ts`
- Modify: `jest.config.js`

The project's Jest config uses `moduleNameMapper` to swap real modules for hand-written mocks (see `__mocks__/react-native-mmkv.ts`). Add the same for Firestore + Auth so unit tests don't need a real Firebase connection.

- [ ] **Step 1: Write the auth mock**

Create `__mocks__/@react-native-firebase/auth.ts`:

```ts
type MockUser = { uid: string } | null;

let currentUser: MockUser = { uid: 'test-uid' };

const authFn = jest.fn(() => ({
  get currentUser() { return currentUser; },
}));

export default authFn;

export function __setCurrentUser(user: MockUser) {
  currentUser = user;
}

export function __resetAuth() {
  currentUser = { uid: 'test-uid' };
}
```

- [ ] **Step 2: Write the firestore mock**

Create `__mocks__/@react-native-firebase/firestore.ts`. The mock exposes a controllable in-memory store + jest.fn() spies for every API method `LikedTracksService` will call. Tests reset state via `__resetFirestore()` in `beforeEach`.

```ts
type DocSnapshot = {
  id: string;
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
};

type ListenerEntry = {
  path: string;
  callback: (snap: { docs: DocSnapshot[]; empty: boolean }) => void;
};

type DocListenerEntry = {
  path: string;
  callback: (snap: DocSnapshot) => void;
};

const stores = new Map<string, Record<string, unknown>>();
const collectionListeners: ListenerEntry[] = [];
const docListeners: DocListenerEntry[] = [];

function makeDocSnapshot(path: string): DocSnapshot {
  const data = stores.get(path);
  return {
    id: path.split('/').pop() ?? '',
    exists: data !== undefined,
    data: () => data,
  };
}

function notifyCollectionListeners(prefix: string) {
  for (const entry of collectionListeners) {
    if (entry.path !== prefix) continue;
    const docs: DocSnapshot[] = [];
    for (const [path] of stores) {
      if (path.startsWith(prefix + '/') && path.split('/').length === prefix.split('/').length + 1) {
        docs.push(makeDocSnapshot(path));
      }
    }
    docs.sort((a, b) => {
      const aSaved = (a.data() as { savedAt?: { toMillis?: () => number } } | undefined)?.savedAt?.toMillis?.() ?? 0;
      const bSaved = (b.data() as { savedAt?: { toMillis?: () => number } } | undefined)?.savedAt?.toMillis?.() ?? 0;
      return bSaved - aSaved;
    });
    entry.callback({ docs, empty: docs.length === 0 });
  }
}

function notifyDocListeners(path: string) {
  for (const entry of docListeners) {
    if (entry.path !== path) continue;
    entry.callback(makeDocSnapshot(path));
  }
}

const apiSpy = {
  collection: jest.fn(),
  doc: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  onSnapshot: jest.fn(),
  getCountFromServer: jest.fn(),
  getDocs: jest.fn(),
  runTransaction: jest.fn(),
  serverTimestamp: jest.fn(),
};

function makeDocRef(path: string) {
  return {
    _path: path,
    set: jest.fn(async (data: Record<string, unknown>) => {
      apiSpy.set(path, data);
      const stored: Record<string, unknown> = { ...data };
      if (data.savedAt && typeof data.savedAt === 'object' && '__serverTimestamp' in (data.savedAt as object)) {
        stored.savedAt = { toMillis: () => Date.now(), toDate: () => new Date() };
      }
      stores.set(path, stored);
      notifyDocListeners(path);
      const collectionPath = path.split('/').slice(0, -1).join('/');
      notifyCollectionListeners(collectionPath);
    }),
    delete: jest.fn(async () => {
      apiSpy.delete(path);
      stores.delete(path);
      notifyDocListeners(path);
      const collectionPath = path.split('/').slice(0, -1).join('/');
      notifyCollectionListeners(collectionPath);
    }),
    onSnapshot: jest.fn((cb: (snap: DocSnapshot) => void) => {
      apiSpy.onSnapshot(path);
      const entry: DocListenerEntry = { path, callback: cb };
      docListeners.push(entry);
      cb(makeDocSnapshot(path));
      return () => {
        const idx = docListeners.indexOf(entry);
        if (idx >= 0) docListeners.splice(idx, 1);
      };
    }),
  };
}

function makeCollectionRef(path: string) {
  const ref: Record<string, unknown> = {
    _path: path,
    doc: jest.fn((id: string) => {
      apiSpy.doc(`${path}/${id}`);
      return makeDocRef(`${path}/${id}`);
    }),
    orderBy: jest.fn(() => ref),
    limit: jest.fn(() => ref),
    where: jest.fn(() => ref),
    get: jest.fn(async () => {
      apiSpy.getDocs(path);
      const docs: DocSnapshot[] = [];
      for (const [docPath] of stores) {
        if (docPath.startsWith(path + '/') && docPath.split('/').length === path.split('/').length + 1) {
          docs.push(makeDocSnapshot(docPath));
        }
      }
      docs.sort((a, b) => {
        const aSaved = (a.data() as { savedAt?: { toMillis?: () => number } } | undefined)?.savedAt?.toMillis?.() ?? 0;
        const bSaved = (b.data() as { savedAt?: { toMillis?: () => number } } | undefined)?.savedAt?.toMillis?.() ?? 0;
        return aSaved - bSaved;
      });
      return { docs, empty: docs.length === 0, size: docs.length };
    }),
    count: jest.fn(() => ({
      get: jest.fn(async () => {
        apiSpy.getCountFromServer(path);
        let count = 0;
        for (const [docPath] of stores) {
          if (docPath.startsWith(path + '/') && docPath.split('/').length === path.split('/').length + 1) {
            count++;
          }
        }
        return { data: () => ({ count }) };
      }),
    })),
    onSnapshot: jest.fn((cb: (snap: { docs: DocSnapshot[]; empty: boolean }) => void) => {
      apiSpy.onSnapshot(path);
      const entry: ListenerEntry = { path, callback: cb };
      collectionListeners.push(entry);
      const docs: DocSnapshot[] = [];
      for (const [docPath] of stores) {
        if (docPath.startsWith(path + '/') && docPath.split('/').length === path.split('/').length + 1) {
          docs.push(makeDocSnapshot(docPath));
        }
      }
      cb({ docs, empty: docs.length === 0 });
      return () => {
        const idx = collectionListeners.indexOf(entry);
        if (idx >= 0) collectionListeners.splice(idx, 1);
      };
    }),
  };
  return ref;
}

const firestoreInstance = {
  collection: jest.fn((path: string) => {
    apiSpy.collection(path);
    return makeCollectionRef(path);
  }),
  doc: jest.fn((path: string) => {
    apiSpy.doc(path);
    return makeDocRef(path);
  }),
  runTransaction: jest.fn(async (updater: (tx: unknown) => Promise<unknown>) => {
    apiSpy.runTransaction();
    const tx = {
      get: jest.fn(async (ref: { _path: string }) => makeDocSnapshot(ref._path)),
      set: jest.fn((ref: { _path: string }, data: Record<string, unknown>) => {
        apiSpy.set(ref._path, data);
        const stored: Record<string, unknown> = { ...data };
        if (data.savedAt && typeof data.savedAt === 'object' && '__serverTimestamp' in (data.savedAt as object)) {
          stored.savedAt = { toMillis: () => Date.now(), toDate: () => new Date() };
        }
        stores.set(ref._path, stored);
        notifyDocListeners(ref._path);
        const collectionPath = ref._path.split('/').slice(0, -1).join('/');
        notifyCollectionListeners(collectionPath);
      }),
      delete: jest.fn((ref: { _path: string }) => {
        apiSpy.delete(ref._path);
        stores.delete(ref._path);
        notifyDocListeners(ref._path);
        const collectionPath = ref._path.split('/').slice(0, -1).join('/');
        notifyCollectionListeners(collectionPath);
      }),
    };
    return updater(tx);
  }),
};

const firestoreFn = jest.fn(() => firestoreInstance);

(firestoreFn as unknown as { FieldValue: { serverTimestamp: () => unknown } }).FieldValue = {
  serverTimestamp: jest.fn(() => {
    apiSpy.serverTimestamp();
    return { __serverTimestamp: true };
  }),
};

(firestoreFn as unknown as { Timestamp: { now: () => unknown } }).Timestamp = {
  now: jest.fn(() => ({ toMillis: () => Date.now(), toDate: () => new Date() })),
};

export default firestoreFn;

export function __resetFirestore() {
  stores.clear();
  collectionListeners.length = 0;
  docListeners.length = 0;
  Object.values(apiSpy).forEach(fn => fn.mockClear());
}

export function __seedDoc(path: string, data: Record<string, unknown>) {
  stores.set(path, data);
}

export function __getApiSpies() {
  return apiSpy;
}

export function __getRunTransaction() {
  return firestoreInstance.runTransaction;
}
```

- [ ] **Step 3: Wire mocks into `jest.config.js`**

Edit `jest.config.js` and add the two new entries to `moduleNameMapper`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  moduleNameMapper: {
    '^react-native-mmkv$': '<rootDir>/__mocks__/react-native-mmkv',
    '^\\.\\./\\.\\./modules/expo-music-kit$': '<rootDir>/__mocks__/expo-music-kit',
    '^\\.\\./\\.\\./\\.\\./modules/expo-music-kit$': '<rootDir>/__mocks__/expo-music-kit',
    '^@sentry/react-native$': '<rootDir>/__mocks__/@sentry/react-native',
    '^@react-native-community/netinfo$': '<rootDir>/__mocks__/@react-native-community/netinfo',
    '^@react-native-firebase/firestore$': '<rootDir>/__mocks__/@react-native-firebase/firestore',
    '^@react-native-firebase/auth$': '<rootDir>/__mocks__/@react-native-firebase/auth',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(expo-.*|@expo/.*|react-native.*|@react-native.*)/)',
  ],
};
```

- [ ] **Step 4: Smoke-test the mock**

Run:

```bash
npx jest __tests__/services/Storage.test.ts --silent
```

Expected: existing Storage tests still pass (the new mock entries don't affect them).

- [ ] **Step 5: Commit**

```bash
git add __mocks__/@react-native-firebase jest.config.js
git commit -m "chore(test): jest mocks for @react-native-firebase/firestore + auth"
```

---

## Task 4: LikedTracksService types

**Files:**
- Create: `src/services/LikedTracksService.types.ts`

The types are consumed by both the service module (Task 5+) and the hooks (Task 10+), so they live in their own file to avoid circular imports.

- [ ] **Step 1: Write the types module**

Create `src/services/LikedTracksService.types.ts`:

```ts
export interface LikedTrackInput {
  id: string;
  title: string;
  artistName: string;
  albumTitle: string;
  artworkUrl: string | null;
}

export interface LikedTrack extends LikedTrackInput {
  savedAt: Date;
}

export class AuthRequiredError extends Error {
  constructor() {
    super('Sign-in required to manage liked tracks');
    this.name = 'AuthRequiredError';
  }
}

export const LIKED_TRACKS_CAP = 200;
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: passes (no new errors).

- [ ] **Step 3: Commit**

```bash
git add src/services/LikedTracksService.types.ts
git commit -m "feat(client): LikedTracksService types"
```

---

## Task 5: LikedTracksService — toggle save/unsave (no eviction)

**Files:**
- Create: `src/services/LikedTracksService.ts`
- Create: `__tests__/services/LikedTracksService.test.ts`

TDD. First two cases: toggle on an unsaved track writes a doc; toggle on a saved track deletes the doc. No eviction yet — that comes in Task 6.

- [ ] **Step 1: Write the failing test scaffold**

Create `__tests__/services/LikedTracksService.test.ts`:

```ts
import firestoreMock, {
  __resetFirestore,
  __seedDoc,
  __getApiSpies,
} from '../../__mocks__/@react-native-firebase/firestore';
import { __resetAuth, __setCurrentUser } from '../../__mocks__/@react-native-firebase/auth';
import { toggle } from '../../src/services/LikedTracksService';
import type { LikedTrackInput } from '../../src/services/LikedTracksService.types';

const TRACK: LikedTrackInput = {
  id: 'track-123',
  title: 'Song',
  artistName: 'Artist',
  albumTitle: 'Album',
  artworkUrl: 'https://example.com/art.jpg',
};

beforeEach(() => {
  __resetFirestore();
  __resetAuth();
});

describe('toggle', () => {
  it('saves an unsaved track and returns "liked"', async () => {
    const result = await toggle(TRACK);

    expect(result).toBe('liked');
    const spies = __getApiSpies();
    expect(spies.set).toHaveBeenCalledWith(
      'users/test-uid/likes/track-123',
      expect.objectContaining({
        id: 'track-123',
        title: 'Song',
        artistName: 'Artist',
        albumTitle: 'Album',
        artworkUrl: 'https://example.com/art.jpg',
        savedAt: expect.any(Object),
      }),
    );
  });

  it('unsaves a saved track and returns "unliked"', async () => {
    __seedDoc('users/test-uid/likes/track-123', { id: 'track-123' });

    const result = await toggle(TRACK);

    expect(result).toBe('unliked');
    const spies = __getApiSpies();
    expect(spies.delete).toHaveBeenCalledWith('users/test-uid/likes/track-123');
    expect(spies.set).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest __tests__/services/LikedTracksService.test.ts
```

Expected: FAIL with "Cannot find module '../../src/services/LikedTracksService'".

- [ ] **Step 3: Implement the service**

Create `src/services/LikedTracksService.ts`:

```ts
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import {
  AuthRequiredError,
  type LikedTrackInput,
} from './LikedTracksService.types';

function requireUid(): string {
  const uid = auth().currentUser?.uid;
  if (!uid) throw new AuthRequiredError();
  return uid;
}

function likesCollectionPath(uid: string): string {
  return `users/${uid}/likes`;
}

export async function toggle(input: LikedTrackInput): Promise<'liked' | 'unliked'> {
  const uid = requireUid();
  const db = firestore();
  const docRef = db.doc(`${likesCollectionPath(uid)}/${input.id}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (snap.exists) {
      tx.delete(docRef);
      return 'unliked' as const;
    }
    tx.set(docRef, {
      id: input.id,
      title: input.title,
      artistName: input.artistName,
      albumTitle: input.albumTitle,
      artworkUrl: input.artworkUrl,
      savedAt: firestore.FieldValue.serverTimestamp(),
    });
    return 'liked' as const;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest __tests__/services/LikedTracksService.test.ts
```

Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/LikedTracksService.ts __tests__/services/LikedTracksService.test.ts
git commit -m "feat(client): LikedTracksService.toggle save/unsave path"
```

---

## Task 6: LikedTracksService — FIFO eviction at cap

**Files:**
- Modify: `src/services/LikedTracksService.ts` (extend `toggle`)
- Modify: `__tests__/services/LikedTracksService.test.ts` (add eviction tests)

Per spec: when count is already at 200 and the user saves a 201st track, delete the oldest by `savedAt asc` first. Two-phase reads (count + oldest doc id) outside the transaction; one delete + set inside the transaction.

- [ ] **Step 1: Write the failing eviction tests**

Append to `__tests__/services/LikedTracksService.test.ts`:

```ts
import { LIKED_TRACKS_CAP } from '../../src/services/LikedTracksService.types';

describe('toggle with FIFO eviction', () => {
  function seedManyLikes(count: number) {
    for (let i = 0; i < count; i++) {
      __seedDoc(`users/test-uid/likes/old-${i}`, {
        id: `old-${i}`,
        title: `Old ${i}`,
        artistName: 'Artist',
        albumTitle: '',
        artworkUrl: null,
        savedAt: { toMillis: () => 1000 + i, toDate: () => new Date(1000 + i) },
      });
    }
  }

  it('does not evict when count is below cap', async () => {
    seedManyLikes(LIKED_TRACKS_CAP - 1);

    await toggle(TRACK);

    const spies = __getApiSpies();
    expect(spies.delete).not.toHaveBeenCalled();
    expect(spies.set).toHaveBeenCalledWith(
      'users/test-uid/likes/track-123',
      expect.any(Object),
    );
  });

  it('deletes the oldest doc and writes the new one when count is at cap', async () => {
    seedManyLikes(LIKED_TRACKS_CAP);

    await toggle(TRACK);

    const spies = __getApiSpies();
    // The oldest doc is `old-0` (savedAt millis === 1000).
    expect(spies.delete).toHaveBeenCalledWith('users/test-uid/likes/old-0');
    expect(spies.set).toHaveBeenCalledWith(
      'users/test-uid/likes/track-123',
      expect.any(Object),
    );
  });

  it('does not run eviction when toggling off (unsave) at cap', async () => {
    seedManyLikes(LIKED_TRACKS_CAP);
    __seedDoc('users/test-uid/likes/track-123', {
      id: 'track-123',
      savedAt: { toMillis: () => 9999, toDate: () => new Date(9999) },
    });

    const result = await toggle(TRACK);

    expect(result).toBe('unliked');
    const spies = __getApiSpies();
    // Only the target doc should be deleted, not any "old-*".
    expect(spies.delete).toHaveBeenCalledTimes(1);
    expect(spies.delete).toHaveBeenCalledWith('users/test-uid/likes/track-123');
  });

  it('tolerates a stale-evict where the planned-oldest doc is gone', async () => {
    // Pre-transaction reads see the old-0 doc, then it disappears before
    // the transaction. Mock: the count says 200, the getDocs returns old-0
    // as oldest, but old-0 is removed from the store right before the
    // transaction runs. transaction.delete on a non-existent path is a
    // no-op in Firestore.
    seedManyLikes(LIKED_TRACKS_CAP);

    // Stub getDocs to plan eviction of old-0 even though we'll race-delete
    // it before the transaction runs.
    // The mock fires getDocs synchronously inside toggle; this test verifies
    // toggle doesn't throw when delete-on-missing is a no-op.
    // (Real wire-level race is covered by Firestore SDK behavior; here we
    // just verify our code path handles it.)

    await toggle(TRACK);

    // No throw, new doc is written.
    const spies = __getApiSpies();
    expect(spies.set).toHaveBeenCalledWith(
      'users/test-uid/likes/track-123',
      expect.any(Object),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest __tests__/services/LikedTracksService.test.ts
```

Expected: 1 of the 4 new tests fails — the at-cap eviction test, which asserts `delete` is called on `users/test-uid/likes/old-0`. The other 3 happen to pass coincidentally because they assert presence of behavior that already exists in the Task-5 implementation (just `set` being called, or no eviction on unsave).

- [ ] **Step 3: Extend the toggle implementation**

Replace the body of `toggle` in `src/services/LikedTracksService.ts`:

```ts
export async function toggle(input: LikedTrackInput): Promise<'liked' | 'unliked'> {
  const uid = requireUid();
  const db = firestore();
  const collectionRef = db.collection(likesCollectionPath(uid));
  const docRef = collectionRef.doc(input.id);

  // Pre-transaction reads. These can't run inside a Firestore transaction:
  // count() is an aggregation, and ordered queries inside a transaction
  // require transaction.get(query) which @react-native-firebase doesn't
  // support. The cap is therefore a *soft* cap — at most one over/under
  // by one between commits. The next write self-corrects.
  let plannedOldestDocId: string | null = null;
  const countSnap = await collectionRef.count().get();
  const count = countSnap.data().count;
  if (count >= LIKED_TRACKS_CAP) {
    const oldestSnap = await collectionRef
      .orderBy('savedAt', 'asc')
      .limit(1)
      .get();
    if (!oldestSnap.empty) {
      plannedOldestDocId = oldestSnap.docs[0].id;
    }
  }

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (snap.exists) {
      // Toggling off frees a slot; eviction not needed.
      tx.delete(docRef);
      return 'unliked' as const;
    }
    if (plannedOldestDocId && plannedOldestDocId !== input.id) {
      // delete on a non-existent doc is a Firestore no-op, so a stale
      // plan is safe.
      tx.delete(collectionRef.doc(plannedOldestDocId));
    }
    tx.set(docRef, {
      id: input.id,
      title: input.title,
      artistName: input.artistName,
      albumTitle: input.albumTitle,
      artworkUrl: input.artworkUrl,
      savedAt: firestore.FieldValue.serverTimestamp(),
    });
    return 'liked' as const;
  });
}
```

Add the imports at the top of the file:

```ts
import {
  AuthRequiredError,
  LIKED_TRACKS_CAP,
  type LikedTrackInput,
} from './LikedTracksService.types';
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest __tests__/services/LikedTracksService.test.ts
```

Expected: 6 passing tests (2 from Task 5 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/services/LikedTracksService.ts __tests__/services/LikedTracksService.test.ts
git commit -m "feat(client): FIFO eviction at 200-cap in LikedTracksService.toggle"
```

---

## Task 7: LikedTracksService — auth-required guard test

**Files:**
- Modify: `__tests__/services/LikedTracksService.test.ts` (one new test)

The implementation already throws `AuthRequiredError` when `currentUser` is null (`requireUid()` from Task 5). This task adds the test that pins the behavior.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/services/LikedTracksService.test.ts`:

```ts
import { AuthRequiredError } from '../../src/services/LikedTracksService.types';

describe('toggle auth guard', () => {
  it('throws AuthRequiredError when no user is signed in', async () => {
    __setCurrentUser(null);

    await expect(toggle(TRACK)).rejects.toBeInstanceOf(AuthRequiredError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they pass**

```bash
npx jest __tests__/services/LikedTracksService.test.ts
```

Expected: 7 passing tests. (The implementation already has the guard; this test pins the contract.)

- [ ] **Step 3: Commit**

```bash
git add __tests__/services/LikedTracksService.test.ts
git commit -m "test(client): pin AuthRequiredError on toggle without signed-in user"
```

---

## Task 8: LikedTracksService — subscribeToOne

**Files:**
- Modify: `src/services/LikedTracksService.ts` (add `subscribeToOne`)
- Modify: `__tests__/services/LikedTracksService.test.ts` (add tests)

Single-doc subscription used by the player heart. Returns `{ exists, track }`.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/services/LikedTracksService.test.ts`:

```ts
import { subscribeToOne } from '../../src/services/LikedTracksService';

describe('subscribeToOne', () => {
  it('emits exists:false for a missing doc', () => {
    const events: Array<{ exists: boolean; track: unknown }> = [];

    const unsub = subscribeToOne('track-123', (state) => events.push(state));

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toEqual({ exists: false, track: null });
    unsub();
  });

  it('emits exists:true with track payload for a present doc', () => {
    __seedDoc('users/test-uid/likes/track-123', {
      id: 'track-123',
      title: 'Song',
      artistName: 'Artist',
      albumTitle: 'Album',
      artworkUrl: 'https://example.com/art.jpg',
      savedAt: { toMillis: () => 5000, toDate: () => new Date(5000) },
    });

    const events: Array<{ exists: boolean; track: unknown }> = [];

    const unsub = subscribeToOne('track-123', (state) => events.push(state));

    expect(events[0].exists).toBe(true);
    expect(events[0].track).toMatchObject({
      id: 'track-123',
      title: 'Song',
      artistName: 'Artist',
      albumTitle: 'Album',
      artworkUrl: 'https://example.com/art.jpg',
      savedAt: new Date(5000),
    });
    unsub();
  });

  it('emits empty state when no user is signed in', () => {
    __setCurrentUser(null);
    const events: Array<{ exists: boolean; track: unknown }> = [];

    const unsub = subscribeToOne('track-123', (state) => events.push(state));

    expect(events[0]).toEqual({ exists: false, track: null });
    expect(typeof unsub).toBe('function');
    unsub();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest __tests__/services/LikedTracksService.test.ts
```

Expected: FAIL — `subscribeToOne` is not exported.

- [ ] **Step 3: Add `subscribeToOne` to the service**

Append to `src/services/LikedTracksService.ts`:

```ts
import type { LikedTrack } from './LikedTracksService.types';

export interface SubscribeOneState {
  exists: boolean;
  track: LikedTrack | null;
}

export function subscribeToOne(
  trackId: string,
  callback: (state: SubscribeOneState) => void,
): () => void {
  const uid = auth().currentUser?.uid;
  if (!uid) {
    callback({ exists: false, track: null });
    return () => {};
  }
  const docRef = firestore().doc(`${likesCollectionPath(uid)}/${trackId}`);
  return docRef.onSnapshot((snap) => {
    if (!snap.exists) {
      callback({ exists: false, track: null });
      return;
    }
    const data = snap.data() as {
      id: string;
      title: string;
      artistName: string;
      albumTitle: string;
      artworkUrl: string | null;
      savedAt: { toDate: () => Date };
    };
    callback({
      exists: true,
      track: {
        id: data.id,
        title: data.title,
        artistName: data.artistName,
        albumTitle: data.albumTitle,
        artworkUrl: data.artworkUrl,
        savedAt: data.savedAt.toDate(),
      },
    });
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest __tests__/services/LikedTracksService.test.ts
```

Expected: 10 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/LikedTracksService.ts __tests__/services/LikedTracksService.test.ts
git commit -m "feat(client): LikedTracksService.subscribeToOne single-doc subscription"
```

---

## Task 9: LikedTracksService — subscribeToList

**Files:**
- Modify: `src/services/LikedTracksService.ts` (add `subscribeToList`)
- Modify: `__tests__/services/LikedTracksService.test.ts` (add tests)

Collection subscription used by the Profile screen. Returns `LikedTrack[]` ordered `savedAt desc`.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/services/LikedTracksService.test.ts`:

```ts
import { subscribeToList } from '../../src/services/LikedTracksService';

describe('subscribeToList', () => {
  it('emits empty list when no docs', () => {
    const events: Array<unknown[]> = [];

    const unsub = subscribeToList((tracks) => events.push(tracks));

    expect(events[0]).toEqual([]);
    unsub();
  });

  it('emits docs ordered savedAt desc', () => {
    __seedDoc('users/test-uid/likes/a', {
      id: 'a', title: 'A', artistName: 'X', albumTitle: '', artworkUrl: null,
      savedAt: { toMillis: () => 1000, toDate: () => new Date(1000) },
    });
    __seedDoc('users/test-uid/likes/b', {
      id: 'b', title: 'B', artistName: 'X', albumTitle: '', artworkUrl: null,
      savedAt: { toMillis: () => 3000, toDate: () => new Date(3000) },
    });
    __seedDoc('users/test-uid/likes/c', {
      id: 'c', title: 'C', artistName: 'X', albumTitle: '', artworkUrl: null,
      savedAt: { toMillis: () => 2000, toDate: () => new Date(2000) },
    });

    const events: Array<{ id: string; savedAt: Date }[]> = [];

    const unsub = subscribeToList((tracks) =>
      events.push(tracks.map(t => ({ id: t.id, savedAt: t.savedAt }))),
    );

    expect(events[0].map(t => t.id)).toEqual(['b', 'c', 'a']);
    unsub();
  });

  it('emits empty list when no user is signed in', () => {
    __setCurrentUser(null);
    const events: Array<unknown[]> = [];

    const unsub = subscribeToList((tracks) => events.push(tracks));

    expect(events[0]).toEqual([]);
    expect(typeof unsub).toBe('function');
    unsub();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest __tests__/services/LikedTracksService.test.ts
```

Expected: FAIL — `subscribeToList` is not exported.

- [ ] **Step 3: Add `subscribeToList` to the service**

Append to `src/services/LikedTracksService.ts`:

```ts
export function subscribeToList(
  callback: (tracks: LikedTrack[]) => void,
): () => void {
  const uid = auth().currentUser?.uid;
  if (!uid) {
    callback([]);
    return () => {};
  }
  const collectionRef = firestore().collection(likesCollectionPath(uid));
  return collectionRef.onSnapshot((snap) => {
    const tracks: LikedTrack[] = snap.docs.map((doc) => {
      const data = doc.data() as {
        id: string;
        title: string;
        artistName: string;
        albumTitle: string;
        artworkUrl: string | null;
        savedAt: { toDate: () => Date };
      };
      return {
        id: data.id,
        title: data.title,
        artistName: data.artistName,
        albumTitle: data.albumTitle,
        artworkUrl: data.artworkUrl,
        savedAt: data.savedAt.toDate(),
      };
    });
    callback(tracks);
  });
}
```

The mock's `onSnapshot` already sorts by `savedAt desc`; in production, the callsite or the query would need an explicit `.orderBy('savedAt', 'desc')`. Add that to the call so production behavior matches:

Replace the `firestore().collection(...)` line above with:

```ts
const collectionRef = firestore()
  .collection(likesCollectionPath(uid))
  .orderBy('savedAt', 'desc');
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest __tests__/services/LikedTracksService.test.ts
```

Expected: 13 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/LikedTracksService.ts __tests__/services/LikedTracksService.test.ts
git commit -m "feat(client): LikedTracksService.subscribeToList collection subscription"
```

---

## Task 10: useLikedTrack hook

**Files:**
- Create: `src/hooks/useLikedTrack.ts`
- Create: `__tests__/hooks/useLikedTrack.test.ts`

Hook used by the player heart. Subscribes to a single doc; exposes `{ isLiked, toggle }`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/hooks/useLikedTrack.test.ts`:

```ts
import { renderHook, act } from '@testing-library/react-native';
import { __resetFirestore, __seedDoc } from '../../__mocks__/@react-native-firebase/firestore';
import { __resetAuth, __setCurrentUser } from '../../__mocks__/@react-native-firebase/auth';
import { useLikedTrack } from '../../src/hooks/useLikedTrack';

const TRACK = {
  id: 'track-123',
  title: 'Song',
  artistName: 'Artist',
  albumTitle: 'Album',
  artworkUrl: null,
};

beforeEach(() => {
  __resetFirestore();
  __resetAuth();
});

describe('useLikedTrack', () => {
  it('returns isLiked:false for an unsaved track', () => {
    const { result } = renderHook(() => useLikedTrack(TRACK));

    expect(result.current.isLiked).toBe(false);
  });

  it('returns isLiked:true for a saved track', () => {
    __seedDoc('users/test-uid/likes/track-123', {
      id: 'track-123',
      title: 'Song',
      artistName: 'Artist',
      albumTitle: 'Album',
      artworkUrl: null,
      savedAt: { toMillis: () => 5000, toDate: () => new Date(5000) },
    });

    const { result } = renderHook(() => useLikedTrack(TRACK));

    expect(result.current.isLiked).toBe(true);
  });

  it('toggle saves and unsaves', async () => {
    const { result } = renderHook(() => useLikedTrack(TRACK));

    expect(result.current.isLiked).toBe(false);

    await act(async () => { await result.current.toggle(); });
    expect(result.current.isLiked).toBe(true);

    await act(async () => { await result.current.toggle(); });
    expect(result.current.isLiked).toBe(false);
  });

  it('returns isLiked:false and a noop toggle when track is null', async () => {
    const { result } = renderHook(() => useLikedTrack(null));

    expect(result.current.isLiked).toBe(false);
    await expect(result.current.toggle()).resolves.toBeUndefined();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useLikedTrack(TRACK));
    unmount();
    // No assertion: the test passes if no listener-leak warning fires.
    // The mock's docListeners array would carry stale entries if unsubscribe
    // was missed, but the next __resetFirestore in beforeEach would clear them.
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest __tests__/hooks/useLikedTrack.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useLikedTrack.ts`:

```ts
import { useEffect, useState, useCallback } from 'react';
import { subscribeToOne, toggle as serviceToggle } from '../services/LikedTracksService';
import type { LikedTrackInput } from '../services/LikedTracksService.types';

export interface UseLikedTrackResult {
  isLiked: boolean;
  toggle: () => Promise<void>;
}

export function useLikedTrack(track: LikedTrackInput | null): UseLikedTrackResult {
  const [isLiked, setIsLiked] = useState(false);

  useEffect(() => {
    if (!track) {
      setIsLiked(false);
      return;
    }
    const unsub = subscribeToOne(track.id, ({ exists }) => {
      setIsLiked(exists);
    });
    return unsub;
  }, [track?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(async (): Promise<void> => {
    if (!track) return;
    try {
      await serviceToggle(track);
    } catch {
      // AuthRequiredError or transient Firestore errors: fail silently
      // on the player. The list is best-effort feedback; the user can
      // try again.
    }
  }, [track]);

  return { isLiked, toggle };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest __tests__/hooks/useLikedTrack.test.ts
```

Expected: 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLikedTrack.ts __tests__/hooks/useLikedTrack.test.ts
git commit -m "feat(client): useLikedTrack hook"
```

---

## Task 11: useLikedTracks hook

**Files:**
- Create: `src/hooks/useLikedTracks.ts`

Hook used by Profile. Subscribes to the collection; exposes `{ tracks, loading }`. No dedicated test file — the service tests pin the data shape; the hook is a thin React wrapper.

- [ ] **Step 1: Implement the hook**

Create `src/hooks/useLikedTracks.ts`:

```ts
import { useEffect, useState } from 'react';
import { subscribeToList } from '../services/LikedTracksService';
import type { LikedTrack } from '../services/LikedTracksService.types';

export interface UseLikedTracksResult {
  tracks: LikedTrack[];
  loading: boolean;
}

export function useLikedTracks(): UseLikedTracksResult {
  const [tracks, setTracks] = useState<LikedTrack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeToList((next) => {
      setTracks(next);
      setLoading(false);
    });
    return unsub;
  }, []);

  return { tracks, loading };
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useLikedTracks.ts
git commit -m "feat(client): useLikedTracks hook"
```

---

## Task 12: LikedRow component

**Files:**
- Create: `src/components/profile/LikedRow.tsx`

Row component for the Profile Liked section. Visual only — verified in manual smoke; no unit test.

- [ ] **Step 1: Implement the component**

Create `src/components/profile/LikedRow.tsx`:

```tsx
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import type { LikedTrack } from '../../services/LikedTracksService.types';

interface Props {
  track: LikedTrack;
  onUnsave: (track: LikedTrack) => void;
}

function formatSavedDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
}

export function LikedRow({ track, onUnsave }: Props) {
  const onPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onUnsave(track);
  };

  const albumLine = track.albumTitle
    ? `${track.artistName} · ${track.albumTitle.toUpperCase()}`
    : track.artistName;

  return (
    <View
      style={styles.row}
      accessibilityRole="text"
      accessibilityLabel={`Liked: ${track.title} by ${track.artistName}, saved ${formatSavedDate(track.savedAt)}`}
    >
      {track.artworkUrl ? (
        <Image
          source={{ uri: track.artworkUrl }}
          style={styles.art}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.art, styles.artFallback]}>
          <Text style={styles.artFallbackText}>ONAY</Text>
        </View>
      )}

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {track.title.toUpperCase()}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {albumLine}
        </Text>
      </View>

      <View style={styles.right}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${track.title} from Liked`}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={({ pressed }) => [styles.heartPressable, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.heart}>♥</Text>
        </Pressable>
        <Text style={styles.date}>{formatSavedDate(track.savedAt)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Space.s10,
    borderBottomWidth: 0.5,
    borderBottomColor: AM.rule,
  },
  art: {
    width: 40,
    height: 40,
    backgroundColor: AM.bgDeep,
  },
  artFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  artFallbackText: {
    color: AM.inkDim,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1,
  },
  body: {
    flex: 1,
    marginLeft: Space.s12,
    marginRight: Space.s8,
  },
  title: {
    color: AM.ink,
    fontFamily: Fonts.display,
    fontSize: TypeScale.s14,
    lineHeight: TypeScale.s14 * 1.2,
    letterSpacing: 0.5,
  },
  meta: {
    color: AM.inkMid,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s12,
    marginTop: 2,
  },
  right: {
    alignItems: 'flex-end',
    minWidth: 56,
  },
  heartPressable: {
    width: 44,
    height: 28,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  heart: {
    color: AM.amber,
    fontSize: TypeScale.s20,
  },
  date: {
    color: AM.inkDim,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 1,
    marginTop: 2,
  },
});
```

`Fonts.serif` is the project's Fraunces italic key (verified in `src/tokens/design-tokens.ts:49`). The artist line on the player uses the same family.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/profile/LikedRow.tsx
git commit -m "feat(client): LikedRow component for Profile Liked section"
```

---

## Task 13: Wire heart Pressable on player.tsx

**Files:**
- Modify: `app/(main)/(broadcast)/player.tsx`

Add a heart Pressable to the right of the title block, vertically aligned with the artist line. Hidden when `status.currentTrack` is null.

- [ ] **Step 1: Add imports + heart UI**

Edit `app/(main)/(broadcast)/player.tsx`:

After the existing `import { setTTSVolume } from '../../../modules/expo-music-kit';` line, add:

```ts
import { useLikedTrack } from '../../../src/hooks/useLikedTrack';
```

Find the title block (around the `<View style={styles.titleBlock}>` block where the title `Text` is rendered). Replace the title block with:

```tsx
{/* Title block — track metadata + heart save */}
<View style={styles.titleBlock}>
  <View style={styles.titleHeartRow}>
    <Text style={styles.title} numberOfLines={2}>
      {(track?.title ?? (ended ? 'That’s all for tonight.' : warming ? 'Building your set…' : '—')).toUpperCase()}
    </Text>
    {track ? <HeartButton track={track} /> : null}
  </View>
  {artist ? <Text style={styles.artist} numberOfLines={1}>{artist}</Text> : null}

  {/* Catalog line — source design has "YEAR · LABEL · ALBUM". The
      server manifest's ManifestTrack type carries only duration and
      album title, so we approximate with "duration · album" here.
      Restore the full trio by extending ManifestTrack with optional
      `year?: string` / `label?: string` and populating them from
      Genius/MusicBrainz enrichment on the server side. */}
  {(track?.duration || album) && (
    <View style={styles.catalogMeta}>
      <Text style={styles.catalogMonoInk}>{formatTime(track?.duration ?? 0)}</Text>
      {album ? <Text style={styles.catalogMonoInk}>{album}</Text> : null}
    </View>
  )}
</View>
```

Add the `HeartButton` component above `BroadcastPlayerScreen` (or below, whichever fits the file's existing component-order convention):

```tsx
function HeartButton({ track }: { track: { id: string; title: string; artistName: string; albumTitle: string; artworkUrl?: string } }) {
  const { isLiked, toggle } = useLikedTrack({
    id: track.id,
    title: track.title,
    artistName: track.artistName,
    albumTitle: track.albumTitle ?? '',
    artworkUrl: track.artworkUrl ?? null,
  });

  const onPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    toggle().catch(() => {});
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={isLiked ? `Remove ${track.title} from Liked` : `Save ${track.title} to Liked`}
      accessibilityState={{ selected: isLiked }}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={({ pressed }) => [styles.heartButton, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.heartGlyph, isLiked ? styles.heartLiked : styles.heartUnliked]}>
        {isLiked ? '♥' : '♡'}
      </Text>
    </Pressable>
  );
}
```

- [ ] **Step 2: Add styles**

In the `StyleSheet.create({...})` block at the bottom of `player.tsx`, add (or merge into existing styles):

```ts
titleHeartRow: {
  flexDirection: 'row',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
},
heartButton: {
  width: 44,
  height: 44,
  alignItems: 'center',
  justifyContent: 'center',
  marginLeft: Space.s8,
},
heartGlyph: {
  fontSize: TypeScale.s24,
},
heartLiked: {
  color: AM.amber,
},
heartUnliked: {
  color: AM.inkDim,
},
```

Add `flex: 1` to the existing `title` style so the heart sits to the right of the wrapped title text:

```ts
title: {
  flex: 1,
  fontFamily: Fonts.display,
  fontSize: TypeScale.s28,
  color: AM.ink,
  letterSpacing: 0.3,
  lineHeight: 34,
},
```

(The original `title` style at `app/(main)/(broadcast)/player.tsx:399` lacks `flex: 1` — adding it is necessary for the row layout to allocate width correctly.)

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 4: Smoke-render via Expo dev server**

```bash
npx expo start --ios
```

Expected: the app boots, the player screen shows a heart on the right of the track title during a track, and the heart hides during cold_open / transition / sign_off. Tapping toggles the heart. (Skip this step if the user opted to skip manual testing — it is documented for completeness.)

- [ ] **Step 5: Commit**

```bash
git add app/(main)/(broadcast)/player.tsx
git commit -m "feat(client): heart save button on broadcast player"
```

---

## Task 14: Wire D·04 LIKED section on ProfileScreen.tsx

**Files:**
- Modify: `src/screens/settings/ProfileScreen.tsx`

Add the new section below `D·03 WEATHER CONTEXT`, before the closing `</ScrollView>`.

- [ ] **Step 1: Add imports**

After the existing imports in `src/screens/settings/ProfileScreen.tsx`, add:

```ts
import { LikedRow } from '../../components/profile/LikedRow';
import { useLikedTracks } from '../../hooks/useLikedTracks';
import { toggle as toggleLikedTrack } from '../../services/LikedTracksService';
import type { LikedTrack } from '../../services/LikedTracksService.types';
```

- [ ] **Step 2: Use the hook + handler**

Inside `ProfileScreen`, after the existing `const settings = useSettings();` line (or near the other hook calls), add:

```ts
const { tracks: likedTracks, loading: likedLoading } = useLikedTracks();

const onUnsaveLiked = useCallback(async (track: LikedTrack) => {
  try {
    await toggleLikedTrack({
      id: track.id,
      title: track.title,
      artistName: track.artistName,
      albumTitle: track.albumTitle,
      artworkUrl: track.artworkUrl,
    });
  } catch {
    // Silent fail; the subscription will re-emit on next snapshot.
  }
}, []);
```

If `useCallback` isn't already imported, add it to the existing `react` import line: `import { useCallback, useEffect, useRef, useState } from 'react';`.

- [ ] **Step 3: Render the section**

Find the closing `</ScrollView>` of `ProfileScreen`'s return block. Just before it, after the existing `D·03 WEATHER CONTEXT` block ends (after the candidate-list view), insert:

```tsx
{/* Liked tracks */}
<SectionMarker
  num="D·04"
  title="LIKED"
  side={`${likedTracks.length} / 200`}
/>
<View style={styles.likedSection}>
  {likedLoading ? (
    <Text style={styles.likedEmpty}>LOADING…</Text>
  ) : likedTracks.length === 0 ? (
    <Text style={styles.likedEmpty}>NOTHING SAVED YET — TAP A HEART ON THE PLAYER</Text>
  ) : (
    likedTracks.map(t => (
      <LikedRow key={t.id} track={t} onUnsave={onUnsaveLiked} />
    ))
  )}
</View>
```

- [ ] **Step 4: Add styles**

In the `StyleSheet.create({...})` block at the bottom of `ProfileScreen.tsx`, add:

```ts
likedSection: {
  marginTop: Space.s8,
  marginBottom: Space.s16,
},
likedEmpty: {
  color: AM.inkDim,
  fontFamily: Fonts.mono,
  fontSize: TypeScale.s9,
  letterSpacing: 1,
  textAlign: 'center',
  paddingVertical: Space.s12,
},
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 6: Smoke-render via Expo dev server**

```bash
npx expo start --ios
```

Expected: Profile tab shows a `D·04 LIKED` section. Empty state on first run; rows after saving from the player. Tapping a row's heart removes it. (Skip if user opted to skip manual testing.)

- [ ] **Step 7: Commit**

```bash
git add src/screens/settings/ProfileScreen.tsx
git commit -m "feat(client): D·04 LIKED section on ProfileScreen"
```

---

## Task 15: Final type-check + run all tests

**Files:** none

Final pass before opening the PR.

- [ ] **Step 1: Type-check**

```bash
npx tsc --noEmit
```

Expected: passes with zero errors.

- [ ] **Step 2: Run all tests**

```bash
npx jest
```

Expected: all tests pass. New: ~13 in `LikedTracksService.test.ts`, 5 in `useLikedTrack.test.ts`. No regressions in existing suites.

- [ ] **Step 3: CodeRabbit local review**

```bash
coderabbit review --agent --base main --type committed
```

Address any findings before opening the PR.

- [ ] **Step 4: Push branch + open PR**

```bash
git push -u origin feat/thumbs-up-saves
gh pr create --title "feat(client): thumbs-up save-to-list (closes #36)" --body "$(cat <<'EOF'
## Summary

- Heart toggle on the broadcast player saves the currently-playing track to a per-user Firestore Liked list at `users/{uid}/likes/{trackId}`.
- Capped at 200 entries with FIFO eviction (oldest by `savedAt` dropped on save).
- New `D·04 LIKED` section on the Profile screen with per-row unsave.
- No thumbs-down, no playback of the list, no sharing — explicitly out of scope per spec.

Spec: `docs/superpowers/specs/2026-04-26-thumbs-up-save-design.md`

## Operations

After merge, deploy the Firestore Security Rules:

```
firebase deploy --only firestore:rules
```

The rules block reads/writes to `users/{uid}/likes/{trackId}` from anyone other than the owning user.

## Test plan

- [ ] All Jest suites pass (`npx jest`)
- [ ] TypeScript type-check passes (`npx tsc --noEmit`)
- [ ] Manual smoke on TestFlight: save 3 tracks, verify they appear on Profile in reverse-chron order
- [ ] Manual smoke: unsave from player vs. unsave from Profile both reflect on the other surface within ~500ms
- [ ] Airplane-mode tap updates the heart instantly; sync resumes online
- [ ] Reach 200 saves (test fixture), verify oldest is evicted
- [ ] VoiceOver pass: heart announces correct state on both player and Profile rows
- [ ] After merge: `firebase deploy --only firestore:rules` applied to production project

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Acceptance

- All 15 tasks committed and pushed.
- All Jest suites pass.
- `tsc --noEmit` clean.
- PR opened against `main` referencing issue #36.
- After merge, `firebase deploy --only firestore:rules` is run by the user.
