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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
