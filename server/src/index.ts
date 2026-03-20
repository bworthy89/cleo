import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { segmentRouter } from './routes/segment';
import { voiceRouter } from './routes/voice';
import { enrichmentRouter } from './routes/enrichment';
import { musicbrainzRouter } from './routes/musicbrainz';
import { requireAuth } from './middleware/auth';
import { llmProvider } from './providers/llm';
import { ttsProvider } from './providers/tts';

const app = express();
const PORT = process.env.PORT || 3001;

// Trust reverse proxy for rate limiting and IP detection
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Log all incoming requests
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

// Rate limit by user UID (set by requireAuth) rather than IP,
// so users behind shared NAT/VPN aren't blocked by one heavy user.
const keyByUser = (req: any) => req.uid ?? req.ip;

// Tighter limit for AI generation routes (LLM + TTS)
const generationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: keyByUser,
  standardHeaders: true,
  legacyHeaders: false,
});

// Enrichment routes have their own server-side rate limiting (1100ms/req)
// so only need a generous global cap to prevent abuse
const enrichmentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: keyByUser,
  standardHeaders: true,
  legacyHeaders: false,
});

// Health check with provider status — no auth required
app.get('/health', async (_req, res) => {
  const llmStatus = llmProvider.getStatus();
  const ttsStatus = ttsProvider.getStatus();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    providers: {
      llm: llmStatus,
      tts: ttsStatus,
    },
    timestamp: new Date().toISOString(),
  });
});

// Auth-protected API routes
app.use(requireAuth, generationLimiter, segmentRouter);
app.use(requireAuth, generationLimiter, voiceRouter);
app.use(requireAuth, enrichmentLimiter, enrichmentRouter);
app.use(requireAuth, enrichmentLimiter, musicbrainzRouter);

app.listen(PORT, () => {
  console.log(`Cleo server running on port ${PORT}`);
});
