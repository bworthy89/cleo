import 'dotenv/config';
import * as path from 'path';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { segmentRouter } from './routes/segment';
import { voiceRouter } from './routes/voice';
import { enrichmentRouter } from './routes/enrichment';
import { musicbrainzRouter } from './routes/musicbrainz';
import { curationRouter } from './routes/curation';
import { createBroadcastRouter } from './routes/broadcast';
import { createFeaturedRouter } from './routes/featured';
import { requireAuth } from './middleware/auth';
import { llmProvider } from './providers/llm';
import { ttsProvider } from './providers/tts';
import { LocalFilesystemStorage } from './services/storage/ObjectStorage';
import { BroadcastStore } from './services/broadcast/BroadcastStore';
import { BroadcastOrchestrator } from './services/broadcast/BroadcastOrchestrator';
import { FeaturedBroadcastRegistry } from './services/broadcast/FeaturedBroadcastRegistry';
import { EnrichmentCache } from './services/enrichment/EnrichmentCache';
import { BackgroundEnricher } from './services/enrichment/BackgroundEnricher';
import { DefaultEnrichmentFetcher } from './services/enrichment/DefaultEnrichmentFetcher';

const app = express();
const PORT = process.env.PORT || 3001;

// Trust reverse proxy for rate limiting and IP detection
app.set('trust proxy', 1);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
}));
app.use(express.json({ limit: '1mb' }));

// Log all incoming requests
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

// Rate limit by user UID (set by requireAuth) rather than IP,
// so users behind shared NAT/VPN aren't blocked by one heavy user.
const keyByUser = (req: any) => req.uid ?? req.ip;

// AI generation routes (LLM + TTS): each track needs ~4-8 requests
// (segment + TTS + eject pre-gen + mid-song drops + retries).
// Scope is enforced via `skip` because the router-level app.use(mw, router)
// pattern would otherwise run this on every request regardless of path.
const GENERATION_PATHS = /^\/(generate-segment|synthesize-voice|curate-playlist|broadcast\/create)(\/|$)/;
const generationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: keyByUser,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !GENERATION_PATHS.test(req.path),
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

// Health check — detailed provider info only for authenticated requests
app.get('/health', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // Authenticated request — return detailed provider info
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
  } else {
    // Unauthenticated — minimal response
    res.json({ status: 'ok' });
  }
});

// Broadcast subsystem — pre-baked episode pipeline
const broadcastCacheDir = path.resolve(__dirname, '../.broadcast-cache');
const broadcastStorage = new LocalFilesystemStorage(
  broadcastCacheDir,
  `${process.env.BROADCAST_ASSET_BASE_URL ?? 'http://localhost:3001'}/broadcast-asset`,
);
const broadcastStore = new BroadcastStore();

// Enrichment cache + background worker — fills Genius/MusicBrainz metadata
// for tracks seen during bakes so future sequencer calls have richer context.
const enrichmentCache = new EnrichmentCache(
  path.resolve(__dirname, '../.enrichment-cache/tracks.json'),
);
const backgroundEnricher = new BackgroundEnricher(
  enrichmentCache, new DefaultEnrichmentFetcher(),
);

async function bootstrap(): Promise<void> {
  await enrichmentCache.load();

  const broadcastOrchestrator = new BroadcastOrchestrator(
    llmProvider, ttsProvider, broadcastStorage, broadcastStore,
    enrichmentCache, backgroundEnricher,
  );

  // Auth-protected API routes
  app.use(requireAuth, generationLimiter, segmentRouter);
  app.use(requireAuth, generationLimiter, voiceRouter);
  app.use(requireAuth, enrichmentLimiter, enrichmentRouter);
  app.use(requireAuth, enrichmentLimiter, musicbrainzRouter);
  app.use(requireAuth, generationLimiter, curationRouter);
  // Broadcast router: auth for all, generation limiter only on POST /broadcast/create
  // (manifest polls + segment fetches are cheap and should NOT count against the LLM budget).
  app.use(requireAuth, createBroadcastRouter(broadcastOrchestrator, broadcastStore, generationLimiter));

  // Featured broadcasts (ONAY-curated, shared across users)
  const featuredRegistry = new FeaturedBroadcastRegistry(
    path.resolve(__dirname, '../featured-broadcasts/registry.json'),
  );
  featuredRegistry.load().catch(err => console.error('[featured] registry load failed', err));
  app.use(requireAuth, createFeaturedRouter(featuredRegistry, broadcastOrchestrator, generationLimiter));

  // Static asset serving for broadcast audio (dev only — production uses signed URLs)
  app.use('/broadcast-asset', requireAuth, (req, res, next) => {
    try {
      const abs = broadcastStorage.getAbsolutePath(req.path.replace(/^\/+/, ''));
      res.sendFile(abs, (err) => { if (err) next(err); });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'invalid asset path';
      res.status(400).json({ error: msg });
    }
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Cleo server running on 0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('[bootstrap] failed to start server', err);
  process.exit(1);
});
