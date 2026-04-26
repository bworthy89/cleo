import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import {
  AuthRequiredError,
  LIKED_TRACKS_CAP,
  type LikedTrack,
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
  const collectionRef = db.collection(likesCollectionPath(uid));
  const docRef = collectionRef.doc(input.id);

  // Pre-transaction reads. count() is an aggregation, and ordered queries
  // inside a transaction require transaction.get(query) which RN Firebase
  // doesn't support. The cap is therefore a *soft* cap — at most one
  // over/under by one between commits. The next write self-corrects.
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
    if (snap.exists()) {
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
  return docRef.onSnapshot(
    (snap) => {
      if (!snap.exists()) {
        callback({ exists: false, track: null });
        return;
      }
      const data = snap.data() as {
        id: string;
        title: string;
        artistName: string;
        albumTitle: string;
        artworkUrl: string | null;
        // null while a local pending write is awaiting server confirmation —
        // serverTimestamp() resolves to null in the local cache snapshot.
        savedAt: { toDate: () => Date } | null;
      };
      callback({
        exists: true,
        track: {
          id: data.id,
          title: data.title,
          artistName: data.artistName,
          albumTitle: data.albumTitle,
          artworkUrl: data.artworkUrl,
          savedAt: data.savedAt?.toDate() ?? new Date(),
        },
      });
    },
    (error) => {
      console.warn('[LikedTracksService] subscribeToOne error', error);
      callback({ exists: false, track: null });
    },
  );
}

export function subscribeToList(
  callback: (tracks: LikedTrack[]) => void,
): () => void {
  const uid = auth().currentUser?.uid;
  if (!uid) {
    callback([]);
    return () => {};
  }
  const collectionRef = firestore()
    .collection(likesCollectionPath(uid))
    .orderBy('savedAt', 'desc');
  return collectionRef.onSnapshot(
    (snap) => {
      const tracks: LikedTrack[] = snap.docs.map((doc) => {
        const data = doc.data() as {
          id: string;
          title: string;
          artistName: string;
          albumTitle: string;
          artworkUrl: string | null;
          savedAt: { toDate: () => Date } | null;
        };
        return {
          id: data.id,
          title: data.title,
          artistName: data.artistName,
          albumTitle: data.albumTitle,
          artworkUrl: data.artworkUrl,
          savedAt: data.savedAt?.toDate() ?? new Date(),
        };
      });
      callback(tracks);
    },
    (error) => {
      console.warn('[LikedTracksService] subscribeToList error', error);
      callback([]);
    },
  );
}
