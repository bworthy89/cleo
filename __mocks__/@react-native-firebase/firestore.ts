type DocSnapshot = {
  id: string;
  exists: () => boolean;
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
    exists: () => data !== undefined,
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
  let orderDirection: 'asc' | 'desc' = 'asc';
  const ref: Record<string, unknown> = {
    _path: path,
    doc: jest.fn((id: string) => {
      apiSpy.doc(`${path}/${id}`);
      return makeDocRef(`${path}/${id}`);
    }),
    orderBy: jest.fn((_field: string, direction: 'asc' | 'desc' = 'asc') => {
      orderDirection = direction;
      return ref;
    }),
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
        return orderDirection === 'desc' ? bSaved - aSaved : aSaved - bSaved;
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
      docs.sort((a, b) => {
        const aSaved = (a.data() as { savedAt?: { toMillis?: () => number } } | undefined)?.savedAt?.toMillis?.() ?? 0;
        const bSaved = (b.data() as { savedAt?: { toMillis?: () => number } } | undefined)?.savedAt?.toMillis?.() ?? 0;
        return bSaved - aSaved;
      });
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

export function __deleteDoc(path: string) {
  stores.delete(path);
}

export function __getApiSpies() {
  return apiSpy;
}

export function __getRunTransaction() {
  return firestoreInstance.runTransaction;
}
