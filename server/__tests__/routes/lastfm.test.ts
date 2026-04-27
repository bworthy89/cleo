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
