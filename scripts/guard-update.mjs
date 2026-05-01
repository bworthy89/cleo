// Pre-OTA-push guard. Refuses `eas update --branch production` when the
// working tree's runtimeVersion doesn't match the runtimeVersion that the
// latest finished production EAS build shipped with — that mismatch means
// you've made a native-bumping change since the last build and the OTA
// would land on a binary it doesn't match (= crash).
//
// Wraps `eas update` so the guard can't be bypassed via npm script. Use
// `update:prod:noguard` if you genuinely need to push despite the warning
// (rare; usually the warning is right and you need a new EAS build first).
//
// Usage (from package.json scripts, not directly):
//   node scripts/guard-update.mjs --branch production --message "..."
//   node scripts/guard-update.mjs --branch production --rollout-percentage 25 --message "..."

import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const APP_JSON = resolve(ROOT, 'app.json');

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
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`[guard] error: ${err.message}`);
  process.exit(1);
});
