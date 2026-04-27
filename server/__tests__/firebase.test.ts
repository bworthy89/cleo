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
    expect((admin as unknown as { initializeApp: jest.Mock }).initializeApp).toHaveBeenCalledTimes(1);
  });

  it('skips init if admin.apps already populated', () => {
    (admin as unknown as { apps: unknown[] }).apps = [{}];
    let firestoreFn!: typeof import('@/firebase').firestore;
    jest.isolateModules(() => {
      firestoreFn = require('@/firebase').firestore;
    });
    firestoreFn();
    expect((admin as unknown as { initializeApp: jest.Mock }).initializeApp).not.toHaveBeenCalled();
  });
});
