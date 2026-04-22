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
import { createAdminRouter } from './routes/admin';
import { requireAuth } from './middleware/auth';
import { llmProvider } from './providers/llm';
import { ttsProvider } from './providers/tts';
import { createStorage } from './services/storage/createStorage';
import { BroadcastStore } from './services/broadcast/BroadcastStore';
import { BroadcastOrchestrator } from './services/broadcast/BroadcastOrchestrator';
import { FeaturedBroadcastRegistry } from './services/broadcast/FeaturedBroadcastRegistry';
import { EnrichmentCache } from './services/enrichment/EnrichmentCache';
import { BackgroundEnricher } from './services/enrichment/BackgroundEnricher';
import { DefaultEnrichmentFetcher } from './services/enrichment/DefaultEnrichmentFetcher';
import { ReccoBeatsFetcher } from './services/enrichment/fetchers/ReccoBeatsFetcher';
import { DeezerFeaturesFetcher } from './services/enrichment/fetchers/DeezerFeaturesFetcher';
import { FeatureFetchChain } from './services/broadcast/FeatureFetchChain';
import { gracefulShutdown } from './shutdown';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

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

// Broadcast subsystem — pre-baked episode pipeline.
// STORAGE_BACKEND env selects between local filesystem (dev) and R2 (prod).
const broadcastStorage = createStorage({
  ...process.env,
  BROADCAST_CACHE_DIR: process.env.BROADCAST_CACHE_DIR
    ?? path.resolve(__dirname, '../.broadcast-cache'),
});
const broadcastStore = new BroadcastStore();

// Enrichment cache + background worker — fills Genius/MusicBrainz metadata
// for tracks seen during bakes so future sequencer calls have richer context.
const enrichmentCache = new EnrichmentCache(
  path.resolve(__dirname, '../.enrichment-cache/tracks.json'),
);

async function bootstrap(): Promise<void> {
  await enrichmentCache.load();

  // Feature-fetch chain for the deterministic sequencer. ReccoBeats is the
  // primary tier (ISRC-only); Deezer fills partial-BPM fallbacks; Last.fm
  // tag reads come from the enrichment cache's moodTags field (populated by
  // BackgroundEnricher's fetchLastFm stage). No network calls on the Last.fm
  // adapter itself — reuse of the cached tags keeps bake latency flat.
  const recco = new ReccoBeatsFetcher();
  const deezer = new DeezerFeaturesFetcher();
  const lastFmTags = {
    async get(title: string, artist: string): Promise<string[]> {
      const rec = enrichmentCache.get(title, artist);
      return rec?.moodTags ?? [];
    },
  };
  const featureFetchChain = new FeatureFetchChain({ recco, deezer, lastFmTags });

  const backgroundEnricher = new BackgroundEnricher(
    enrichmentCache, new DefaultEnrichmentFetcher(), featureFetchChain,
  );

  const broadcastOrchestrator = new BroadcastOrchestrator(
    llmProvider, ttsProvider, broadcastStorage, broadcastStore,
    enrichmentCache, backgroundEnricher, featureFetchChain,
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

  // Admin surface — curator-gated log tail + richer status. Log dir matches
  // ecosystem.config.cjs's out_file/error_file (cwd-relative `logs/`).
  app.use(requireAuth, createAdminRouter({
    store: broadcastStore,
    orch: broadcastOrchestrator,
    llm: llmProvider,
    tts: ttsProvider,
    logDir: process.env.LOG_DIR,
  }));

  // Static asset serving for broadcast audio — only when the storage backend
  // serves bytes from a local path (dev). Remote backends (R2) embed the URL
  // directly in the manifest and skip this route.
  if (broadcastStorage.getAbsolutePath) {
    const getAbsolutePath = broadcastStorage.getAbsolutePath.bind(broadcastStorage);
    app.use('/broadcast-asset', requireAuth, (req: any, res, next) => {
      try {
        const relPath = req.path.replace(/^\/+/, '');
        // Asset keys are always `broadcast/<id>/segment/<slot>/v<n>.mp3`.
        // Enforce the same ownership gate as GET /broadcast/:id/manifest so
        // an authenticated user can't stream another user's segments by
        // guessing (or exfiltrating) a broadcastId.
        const match = relPath.match(/^broadcast\/([^/]+)\//);
        if (!match) return res.status(404).json({ error: 'not found' });
        const manifest = broadcastStore.get(match[1]);
        if (!manifest) return res.status(404).json({ error: 'not found' });
        if (manifest.userId !== 'curator' && manifest.userId !== req.uid) {
          return res.status(404).json({ error: 'not found' });
        }
        const abs = getAbsolutePath(relPath);
        res.sendFile(abs, (err) => { if (err) next(err); });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'invalid asset path';
        res.status(400).json({ error: msg });
      }
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Cleo server running on 0.0.0.0:${PORT}`);
  });

  // PM2 sends SIGINT on `pm2 restart`, SIGTERM on `pm2 stop`. Drain HTTP
  // connections so in-flight bakes finish before the process exits.
  const shutdown = async (signal: string) => {
    console.log(`[shutdown] received ${signal}, draining...`);
    await gracefulShutdown(server, [], { timeoutMs: 10_000 });
    console.log('[shutdown] done');
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[bootstrap] failed to start server', err);
  process.exit(1);
});
