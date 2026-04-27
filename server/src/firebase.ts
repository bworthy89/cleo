import admin from 'firebase-admin';

let initialized = false;

function ensureInit() {
  if (initialized) return;
  if (admin.apps.length === 0) {
    try {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    } catch (err) {
      throw new Error(
        `Firebase Admin initialization failed. Ensure GOOGLE_APPLICATION_CREDENTIALS is set to a valid service-account JSON path. Original: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  initialized = true;
}

export function firestore(): admin.firestore.Firestore {
  ensureInit();
  return admin.firestore();
}
