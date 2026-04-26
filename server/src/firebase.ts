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
