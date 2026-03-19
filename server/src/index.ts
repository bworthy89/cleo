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

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Health check — no auth required
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Auth-protected API routes
app.use(requireAuth, segmentRouter);
app.use(requireAuth, voiceRouter);
app.use(requireAuth, videoRouter);
app.use(requireAuth, enrichmentRouter);
app.use(requireAuth, musicbrainzRouter);

app.listen(PORT, () => {
  console.log(`Cleo server running on port ${PORT}`);
});
