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

const buildDb = (mock: MockFirestore) => {
  const docShape: {
    set: jest.Mock;
    delete: jest.Mock;
    update: jest.Mock;
    get: jest.Mock;
    collection: () => { doc: () => typeof docShape };
  } = {
    set: mock.set,
    delete: mock.delete,
    update: mock.update,
    get: jest.fn(async () => ({ exists: false, data: () => undefined })),
    // Nested-collection support: doc().collection().doc() reuses the same shape
    collection: () => ({ doc: () => docShape }),
  };
  return {
    collection: () => ({ doc: () => docShape }),
  };
};

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

  it('returns 500 if Firestore set throws', async () => {
    const fs = buildFirestore();
    fs.set.mockRejectedValueOnce(new Error('firestore down'));
    const client = {
      getSession: jest.fn(async () => ({ name: 'kari_w', key: 'SK_ABC' })),
    };
    const app = buildApp(client, buildDb(fs) as unknown as { collection: () => unknown });

    const res = await request(app).post('/lastfm/connect').send({ token: 'OAUTH_T' });

    expect(res.status).toBe(500);
  });
});

describe('POST /lastfm/disconnect', () => {
  it('deletes the integration doc and returns 204', async () => {
    const fs = buildFirestore();
    const app = buildApp({}, buildDb(fs) as unknown as { collection: () => unknown });
    const res = await request(app).post('/lastfm/disconnect').send();
    expect(res.status).toBe(204);
    expect(fs.delete).toHaveBeenCalledTimes(1);
  });

  it('returns 500 if Firestore delete throws', async () => {
    const fs = buildFirestore();
    fs.delete.mockRejectedValueOnce(new Error('firestore down'));
    const app = buildApp({}, buildDb(fs) as unknown as { collection: () => unknown });
    const res = await request(app).post('/lastfm/disconnect').send();
    expect(res.status).toBe(500);
  });
});

const buildDbWithSession = (fs: MockFirestore, sessionKey: string | null) => {
  const integrationDocShape = {
    set: fs.set,
    delete: fs.delete,
    update: fs.update,
    get: jest.fn(async () => ({
      exists: sessionKey !== null,
      data: () => sessionKey === null ? undefined : { sessionKey, username: 'k' },
    })),
  };
  const userDocShape = {
    set: fs.set,
    delete: fs.delete,
    update: fs.update,
    get: jest.fn(async () => ({ exists: false, data: () => undefined })),
    collection: () => ({ doc: () => integrationDocShape }),
  };
  return {
    collection: () => ({ doc: () => userDocShape }),
  };
};

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

  it('returns 502 (no flag flip) on HTTP non-200 (errorCode -1)', async () => {
    const fs = buildFirestore();
    const client = {
      updateNowPlaying: jest.fn(async () => ({
        ok: false as const, errorCode: -1, errorMessage: 'HTTP 503',
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

  it('returns 502 (no flag flip) on HTTP non-200 (errorCode -1)', async () => {
    const fs = buildFirestore();
    const client = {
      scrobble: jest.fn(async () => ({
        ok: false as const, errorCode: -1, errorMessage: 'HTTP 503',
      })),
    };
    const app = buildApp(client, buildDbWithSession(fs, 'SK') as unknown as { collection: () => unknown });

    const res = await request(app).post('/lastfm/scrobble').send({
      trackId: 'a', title: 'T', artistName: 'A', duration: 180,
      startedAt: 1714200000,
    });

    expect(res.status).toBe(502);
    expect(fs.update).not.toHaveBeenCalled();
  });

  it('flips needsReconnect: true on Last.fm error code 9, returns 401', async () => {
    const fs = buildFirestore();
    const client = {
      scrobble: jest.fn(async () => ({
        ok: false as const, errorCode: 9, errorMessage: 'Invalid session key',
      })),
    };
    const app = buildApp(client, buildDbWithSession(fs, 'SK_STALE') as unknown as { collection: () => unknown });

    const res = await request(app).post('/lastfm/scrobble').send({
      trackId: 'a', title: 'T', artistName: 'A', duration: 180,
      startedAt: 1714200000,
    });

    expect(res.status).toBe(401);
    expect(fs.update).toHaveBeenCalledWith({ needsReconnect: true });
  });

  it('flips needsReconnect on error code 4 too', async () => {
    const fs = buildFirestore();
    const client = {
      scrobble: jest.fn(async () => ({
        ok: false as const, errorCode: 4, errorMessage: 'Auth failed',
      })),
    };
    const app = buildApp(client, buildDbWithSession(fs, 'SK') as unknown as { collection: () => unknown });

    const res = await request(app).post('/lastfm/scrobble').send({
      trackId: 'a', title: 'T', artistName: 'A', duration: 180,
      startedAt: 1714200000,
    });

    expect(res.status).toBe(401);
    expect(fs.update).toHaveBeenCalledWith({ needsReconnect: true });
  });
});
