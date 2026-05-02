import 'dotenv/config';
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.2'),
    release: process.env.SENTRY_RELEASE,
  });
}

import * as fs from 'fs';
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
import { createPublicHealthRouter } from './routes/health';
import { createWeatherRouter } from './routes/weather';
import { createLastFmRouter } from './routes/lastfm';
import { requireAuth } from './middleware/auth';
import { WeatherProvider } from './providers/weather/WeatherProvider';
import { LastFmClient } from './services/lastfm/LastFmClient';
import { firestore as adminFirestore } from './firebase';
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
import { CuratorPublishBudget, makeCuratorPublishBudgetMiddleware } from './services/curator/CuratorPublishBudget';
import { Db } from './services/db/Db';
import { EventRecorder } from './services/events/EventRecorder';

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

// Weather geocode hits OWM's free tier (60 calls/min globally). Per-user
// cap protects the shared OWM quota from a single account picking cities
// in a tight loop. Hint fetches at bake time aren't routed through HTTP
// so they don't consume this budget.
const weatherLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: keyByUser,
  standardHeaders: true,
  legacyHeaders: false,
});

// Last.fm scrobble routes: per-uid budget so shared NAT/VPN users don't
// eat each other's quota. 60 req/min is generous for now-playing + scrobble
// patterns (1 now-playing + 1 scrobble per track = ~2 req per song).
const scrobbleLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as unknown as { uid?: string }).uid ?? req.ip ?? 'anon',
});

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[env] ${name}="${raw}" is not a positive integer; using default ${fallback}`);
    return fallback;
  }
  return n;
}

// WeatherProvider is optional — null when OPENWEATHER_API_KEY is unset.
// The orchestrator skips weather injection entirely when the provider is
// missing, so first-launch deploys without the key still work.
const weatherProvider = process.env.OPENWEATHER_API_KEY
  ? new WeatherProvider({ apiKey: process.env.OPENWEATHER_API_KEY })
  : undefined;
if (!weatherProvider) {
  console.warn('[env] OPENWEATHER_API_KEY unset; weather hints disabled');
}

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

// One SQLite file holds every state store the broadcast server keeps
// (broadcasts, slots, enrichment, featured, curator publishes, app_events).
// WAL mode + boot-time crashed-bake sweep happen inside the Db constructor.
const dbPath = process.env.SQLITE_DB_PATH
  ?? path.resolve(__dirname, '../.broadcast-cache/cleo.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Db(dbPath);
console.log(`[boot] sqlite db opened at ${dbPath}`);

const curatorPublishBudget = new CuratorPublishBudget({
  db,
  capPerWindow: parsePositiveInt(process.env.CURATOR_PUBLISH_CAP, 3, 'CURATOR_PUBLISH_CAP'),
  windowMs: parsePositiveInt(
    process.env.CURATOR_PUBLISH_WINDOW_MS,
    24 * 60 * 60 * 1000,
    'CURATOR_PUBLISH_WINDOW_MS',
  ),
});
const curatorPublishBudgetMiddleware = makeCuratorPublishBudgetMiddleware(curatorPublishBudget);

const broadcastStore = new BroadcastStore(db);

// Enrichment cache + background worker — fills Genius/MusicBrainz metadata
// for tracks seen during bakes so future sequencer calls have richer context.
const enrichmentCache = new EnrichmentCache(db);

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

  const eventRecorder = new EventRecorder(db);
  const broadcastOrchestrator = new BroadcastOrchestrator(
    llmProvider, ttsProvider, broadcastStorage, broadcastStore,
    enrichmentCache, backgroundEnricher, featureFetchChain,
    undefined, weatherProvider, eventRecorder,
  );

  // Public health endpoint — unauthenticated, synthesizes TTS + bake-queue status.
  // Mounted before requireAuth so the in-app status banner can read it without a JWT.
  app.use(createPublicHealthRouter({
    getTtsStatus: () => ttsProvider.getStatus(),
    getInFlightCount: () => broadcastOrchestrator.inFlightCount,
  }));

  // Admin surface — mounted FIRST so /admin/* is claimed by adminRouter's
  // own gate (X-Admin-Token or Firebase+curator) before the global
  // requireAuth middleware on the other routers below would fire on every
  // path and 401 on missing Bearer. The `/admin` path prefix also keeps
  // adminRouter from running on non-admin requests.
  app.use('/admin', createAdminRouter({
    store: broadcastStore,
    orch: broadcastOrchestrator,
    llm: llmProvider,
    tts: ttsProvider,
    logDir: process.env.LOG_DIR,
  }));

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
  const featuredRegistry = new FeaturedBroadcastRegistry(db);
  featuredRegistry.load().catch(err => console.error('[featured] registry load failed', err));
  // createFeaturedRouter args: registry, orchestrator, bakeLimiter, publishBudget.
  // Both middlewares are RequestHandler | undefined so TS won't catch a swap.
  app.use(requireAuth, createFeaturedRouter(
    featuredRegistry,
    broadcastOrchestrator,
    generationLimiter,
    curatorPublishBudgetMiddleware,
    eventRecorder,
  ));

  // Weather service router — mounted under auth only when the provider is configured
  if (weatherProvider) {
    app.use(requireAuth, weatherLimiter, createWeatherRouter(weatherProvider));
  }

  // Last.fm scrobble router — only mounted when both API credentials are present.
  // Missing creds in dev simply disables the routes rather than crashing the server.
  if (process.env.LASTFM_API_KEY && process.env.LASTFM_API_SECRET) {
    const lastFmClient = new LastFmClient({
      apiKey: process.env.LASTFM_API_KEY,
      apiSecret: process.env.LASTFM_API_SECRET,
    });
    app.use(requireAuth, scrobbleLimiter, createLastFmRouter({
      client: lastFmClient,
      firestore: adminFirestore(),
      apiKey: process.env.LASTFM_API_KEY,
      callbackUrl: 'cleo://lastfm-callback',
    }));
  } else {
    console.warn('[lastfm] LASTFM_API_KEY or LASTFM_API_SECRET unset — scrobble routes disabled');
  }

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

  // Sentry error handler — must come AFTER all routes but BEFORE app.listen
  // so route handlers that throw or call next(err) get captured. Without
  // this, 5xx errors are swallowed by Express's default 500 handler and
  // never reach Sentry.
  Sentry.setupExpressErrorHandler(app);

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
