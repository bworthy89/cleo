const stores = new Map<string, Map<string, string>>();

export function createMMKV(config?: { id?: string }) {
  const id = config?.id ?? 'default';
  if (!stores.has(id)) stores.set(id, new Map());
  const store = stores.get(id)!;

  return {
    getString: (key: string) => store.get(key),
    set: (key: string, value: string) => { store.set(key, value); },
    delete: (key: string) => { store.delete(key); },
    remove: (key: string) => { store.delete(key); },
    contains: (key: string) => store.has(key),
    clearAll: () => { store.clear(); },
  };
}

export function __resetAllStores() {
  stores.forEach(s => s.clear());
}
