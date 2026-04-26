import { Router } from 'express';
import { z } from 'zod';
import type { WeatherProvider } from '../providers/weather/WeatherProvider';

const geocodeSchema = z.object({
  q: z.string().min(1).max(100),
});

export function createWeatherRouter(provider: WeatherProvider): Router {
  const router = Router();
  router.post('/weather/geocode', async (req, res) => {
    const parsed = geocodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
    }
    const candidates = await provider.geocode(parsed.data.q);
    return res.json({ candidates });
  });
  return router;
}
