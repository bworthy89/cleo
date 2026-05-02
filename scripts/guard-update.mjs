// Pre-OTA-push guard + post-OTA Sentry source-map upload.
//
// Pre-push: refuses `eas update --branch production` when the working tree's
// runtimeVersion doesn't match the runtimeVersion the latest finished
// production EAS build shipped with — mismatch means native-bumping changes
// since the last build, and the OTA would land on a binary it doesn't match
// (= crash). `update:prod:noguard` exists as the emergency escape hatch.
//
// Post-update: when the eas update succeeds AND `SENTRY_AUTH_TOKEN` is set
// in the local env (read from `.env.local` or `.env`), runs
// `npx sentry-expo-upload-sourcemaps dist` to push the just-built JS bundle's
// sourcemaps to Sentry. Without this, OTA crashes report `<unknown>:0` and
// are effectively undebuggable. Soft failure: if the sourcemap upload fails,
// the OTA push still counts as success — but a warning prints loudly.
//
// Usage (from package.json scripts, not directly):
//   node scripts/guard-update.mjs --branch production --message "..."
//   node scripts/guard-update.mjs --branch production --rollout-percentage 25 --message "..."

import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const APP_JSON = resolve(ROOT, 'app.json');

// Load env vars from .env.local + .env so SENTRY_AUTH_TOKEN can live in
// .env.local (gitignored) like other Expo build-time secrets. Manual parse —
// tiny and zero deps. Existing process.env values win (don't overwrite shell-set).
function loadEnvFile(path) {
  try {
    const content = readFileSync(path, 'utf8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      const [, k, vRaw] = m;
      if (process.env[k] !== undefined) continue;
      const v = vRaw.replace(/^['"]|['"]$/g, '');
      process.env[k] = v;
    }
  } catch { /* file missing — fine */ }
}
loadEnvFile(resolve(ROOT, '.env.local'));
loadEnvFile(resolve(ROOT, '.env'));

async function readWorkingTreeRuntimeVersion() {
  const raw = await readFile(APP_JSON, 'utf8');
  const appJson = JSON.parse(raw);
  const rv = appJson.expo?.runtimeVersion;
  if (typeof rv !== 'string') {
    throw new Error(`app.json expo.runtimeVersion must be a literal string (got: ${JSON.stringify(rv)})`);
  }
  return rv;
}

function fetchLatestBuildRuntimeVersion() {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('eas', [
      'build:list',
      '--platform', 'ios',
      '--limit', '1',
      '--status', 'finished',
      '--non-interactive',
      '--json',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`eas build:list failed (exit ${code}): ${stderr.trim()}`));
        return;
      }
      try {
        const builds = JSON.parse(stdout);
        if (!Array.isArray(builds) || builds.length === 0) {
          resolvePromise(null);
          return;
        }
        resolvePromise(builds[0].runtimeVersion ?? null);
      } catch (err) {
        rejectPromise(new Error(`could not parse eas build:list output: ${err.message}`));
      }
    });
  });
}

function execEasUpdate(forwardArgs) {
  return new Promise((resolvePromise) => {
    const child = spawn('eas', ['update', ...forwardArgs], { stdio: 'inherit' });
    child.on('close', (code) => resolvePromise(code ?? 1));
  });
}

// Post-OTA: upload the JS bundle's sourcemaps to Sentry so OTA crashes
// land symbolicated. Soft failure — OTA already shipped, this is just
// crash-debugging hygiene.
function uploadOtaSourcemaps() {
  return new Promise((resolvePromise) => {
    if (!process.env.SENTRY_AUTH_TOKEN) {
      console.warn('[sentry] SENTRY_AUTH_TOKEN not set — skipping source-map upload.');
      console.warn('[sentry]   Set in .env.local (gitignored) to enable. Without it, OTA crashes will be unmapped.');
      resolvePromise(0);
      return;
    }
    console.log('[sentry] uploading OTA bundle source maps from dist/ ...');
    const child = spawn('npx', ['sentry-expo-upload-sourcemaps', 'dist'], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('close', (code) => {
      if (code !== 0) {
        console.warn(`[sentry] sourcemap upload exited ${code} — OTA shipped successfully but crashes from this bundle may not symbolicate. Investigate sentry-cli output above.`);
      } else {
        console.log('[sentry] sourcemaps uploaded.');
      }
      resolvePromise(code ?? 1);
    });
    child.on('error', (err) => {
      console.warn(`[sentry] failed to spawn sentry-expo-upload-sourcemaps: ${err.message}`);
      resolvePromise(0); // soft fail — don't block OTA success on this
    });
  });
}

async function main() {
  const forwardArgs = process.argv.slice(2);

  const workingTreeRV = await readWorkingTreeRuntimeVersion();
  console.log(`[guard] working tree runtimeVersion: ${workingTreeRV}`);

  let latestBuildRV;
  try {
    latestBuildRV = await fetchLatestBuildRuntimeVersion();
  } catch (err) {
    console.error(`[guard] could not query latest TF build: ${err.message}`);
    console.error('[guard] refusing to push without a runtime-version comparison. Pass --noguard scripts (update:prod:noguard) to override.');
    process.exit(1);
  }

  if (latestBuildRV === null) {
    console.warn('[guard] no finished production builds found. Allowing push (no comparison possible).');
  } else {
    console.log(`[guard] latest TF build runtimeVersion:   ${latestBuildRV}`);
    if (workingTreeRV !== latestBuildRV) {
      console.error(`\n[guard] runtime version mismatch: working tree=${workingTreeRV}, latest TF build=${latestBuildRV}.`);
      console.error('[guard] you have native-bumping changes since the last build.');
      console.error('[guard] run: npm run bump:build -- --release <patch|minor|major> && eas build --profile production --platform ios --non-interactive');
      console.error('[guard] or use update:prod:noguard if you really mean to push (rare).');
      process.exit(1);
    }
    console.log('[guard] match — safe to push.');
  }

  const exitCode = await execEasUpdate(forwardArgs);
  if (exitCode === 0) {
    // eas update succeeded — try to push sourcemaps. Result is informational
    // only; we exit with the original eas update exit code.
    await uploadOtaSourcemaps();
  } else {
    console.warn('[sentry] eas update failed — skipping sourcemap upload.');
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`[guard] error: ${err.message}`);
  process.exit(1);
});
