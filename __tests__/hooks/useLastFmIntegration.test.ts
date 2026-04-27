import { renderHook, act } from '@testing-library/react-native';
import {
  __resetFirestore,
  __seedDoc,
  __deleteDoc,
} from '../../__mocks__/@react-native-firebase/firestore';
import { __resetAuth, __setCurrentUser } from '../../__mocks__/@react-native-firebase/auth';
import { useLastFmIntegration } from '../../src/hooks/useLastFmIntegration';

beforeEach(() => {
  __resetFirestore();
  __resetAuth();
});

describe('useLastFmIntegration', () => {
  it('returns disconnected state when no doc exists', () => {
    const { result } = renderHook(() => useLastFmIntegration());
    expect(result.current).toEqual({
      loading: false, status: 'disconnected', username: null,
    });
  });

  it('returns connected state when doc has needsReconnect=false', () => {
    __seedDoc('users/test-uid/integrations/lastfm', {
      sessionKey: 'SK', username: 'kari_w', needsReconnect: false,
    });
    const { result } = renderHook(() => useLastFmIntegration());
    expect(result.current).toEqual({
      loading: false, status: 'connected', username: 'kari_w',
    });
  });

  it('returns needs-reconnect state when needsReconnect=true', () => {
    __seedDoc('users/test-uid/integrations/lastfm', {
      sessionKey: 'SK', username: 'kari_w', needsReconnect: true,
    });
    const { result } = renderHook(() => useLastFmIntegration());
    expect(result.current).toEqual({
      loading: false, status: 'needs-reconnect', username: 'kari_w',
    });
  });

  it('updates when the doc changes (subscription)', () => {
    const { result } = renderHook(() => useLastFmIntegration());
    expect(result.current.status).toBe('disconnected');

    act(() => {
      __seedDoc('users/test-uid/integrations/lastfm', {
        sessionKey: 'SK', username: 'kari_w', needsReconnect: false,
      });
    });
    expect(result.current.status).toBe('connected');

    act(() => { __deleteDoc('users/test-uid/integrations/lastfm'); });
    expect(result.current.status).toBe('disconnected');
  });

  it('returns disconnected without subscribing when no user is authenticated', () => {
    __setCurrentUser(null);
    const { result } = renderHook(() => useLastFmIntegration());
    expect(result.current).toEqual({
      loading: false, status: 'disconnected', username: null,
    });
  });
});
