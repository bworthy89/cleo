import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { segmentRouter } from './routes/segment';
import { voiceRouter } from './routes/voice';
import { videoRouter } from './routes/video';
import { enrichmentRouter } from './routes/enrichment';
import { musicbrainzRouter } from './routes/musicbrainz';
import { requireAuth } from './middleware/auth';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Log all incoming requests
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

// Tighter limit for AI generation routes (Gemini + ElevenLabs)
const generationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// Enrichment routes have their own server-side rate limiting (1100ms/req)
// so only need a generous global cap to prevent abuse
const enrichmentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// Health check — no auth required
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Auth-protected API routes — enrichment gets a higher rate limit
app.use(requireAuth, generationLimiter, segmentRouter);
app.use(requireAuth, generationLimiter, voiceRouter);
app.use(requireAuth, videoRouter);
app.use(requireAuth, enrichmentLimiter, enrichmentRouter);
app.use(requireAuth, enrichmentLimiter, musicbrainzRouter);

app.listen(PORT, () => {
  console.log(`Cleo server running on port ${PORT}`);
});
