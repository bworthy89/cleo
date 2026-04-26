import express from 'express';
import request from 'supertest';
import { createWeatherRouter } from '@/routes/weather';
import type { WeatherProvider } from '@/providers/weather/WeatherProvider';

const authStub = (uid: string): express.RequestHandler =>
  (req, _res, next) => { (req as unknown as { uid: string }).uid = uid; next(); };

const buildApp = (provider: Pick<WeatherProvider, 'geocode'>) => {
  const app = express();
  app.use(express.json());
  app.use(authStub('uid-1'));
  app.use(createWeatherRouter(provider as WeatherProvider));
  return app;
};

describe('POST /weather/geocode', () => {
  it('returns candidates from the provider', async () => {
    const provider = {
      geocode: jest.fn(async () => [
        { name: 'Brooklyn', state: 'New York', country: 'US', lat: 40.65, lon: -73.95 },
      ]),
    };
    const app = buildApp(provider);
    const res = await request(app).post('/weather/geocode').send({ q: 'Brooklyn' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      candidates: [
        { name: 'Brooklyn', state: 'New York', country: 'US', lat: 40.65, lon: -73.95 },
      ],
    });
    expect(provider.geocode).toHaveBeenCalledWith('Brooklyn');
  });

  it('returns 400 on missing/empty query', async () => {
    const provider = { geocode: jest.fn() };
    const app = buildApp(provider);
    const res = await request(app).post('/weather/geocode').send({ q: '' });
    expect(res.status).toBe(400);
    expect(provider.geocode).not.toHaveBeenCalled();
  });
});
