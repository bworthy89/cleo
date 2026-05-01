// Atomic native-build prep. Bumps the four version sources that must stay
// in lockstep for the bare-workflow OTA pipeline to be safe:
//
//   1. ios/ONAY.xcodeproj/project.pbxproj — CURRENT_PROJECT_VERSION (4 occurrences)
//   2. app.json                            — expo.ios.buildNumber
//   3. app.json                            — expo.version
//   4. app.json                            — expo.runtimeVersion (must match expo.version)
//   5. ios/ONAY/Supporting/Expo.plist     — EXUpdatesRuntimeVersion (must match expo.runtimeVersion)
//
// Default mode bumps build number only (sources 1 and 2). Use this for
// TestFlight iteration where JS hasn't outgrown the native bundle.
//
//   node scripts/bump-build.mjs
//
// Release mode also bumps the version + runtime version (sources 3, 4, 5)
// using semver. Use this when the native bundle changed (added a dep,
// touched Swift, etc.) — the runtime version bump intentionally breaks
// the OTA chain to old binaries so users on the previous TestFlight don't
// receive a JS bundle their native code can't service.
//
//   node scripts/bump-build.mjs -- --release patch
//   node scripts/bump-build.mjs -- --release minor
//   node scripts/bump-build.mjs -- --release major
//
// Dry-run flag prints the planned bumps without writing:
//
//   node scripts/bump-build.mjs --dry-run
//
// At start, the script verifies all five sources are in sync and refuses
// to run if they aren't (means a previous bump was partial). Pass --force
// to bump anyway.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PBXPROJ = resolve(ROOT, 'ios/ONAY.xcodeproj/project.pbxproj');
const APP_JSON = resolve(ROOT, 'app.json');
const EXPO_PLIST = resolve(ROOT, 'ios/ONAY/Supporting/Expo.plist');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};

const releaseType = flagValue('--release');
const dryRun = flag('--dry-run');
const force = flag('--force');

if (releaseType && !['patch', 'minor', 'major'].includes(releaseType)) {
  console.error(`error: --release must be patch, minor, or major (got: ${releaseType})`);
  process.exit(1);
}

function bumpSemver(version, type) {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`expected MAJOR.MINOR.PATCH semver, got: ${version}`);
  }
  const [maj, min, pat] = parts;
  if (type === 'major') return `${maj + 1}.0.0`;
  if (type === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

async function readSources() {
  const [pbxprojRaw, appJsonRaw, plistRaw] = await Promise.all([
    readFile(PBXPROJ, 'utf8'),
    readFile(APP_JSON, 'utf8'),
    readFile(EXPO_PLIST, 'utf8'),
  ]);

  const pbxprojMatches = [...pbxprojRaw.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)];
  if (pbxprojMatches.length === 0) {
    throw new Error('no CURRENT_PROJECT_VERSION found in pbxproj');
  }
  const pbxprojBuilds = pbxprojMatches.map((m) => Number(m[1]));

  const appJson = JSON.parse(appJsonRaw);
  const appBuildNumber = Number(appJson.expo?.ios?.buildNumber);
  const appVersion = appJson.expo?.version;
  const appRuntimeVersion = appJson.expo?.runtimeVersion;

  const plistRuntimeMatch = plistRaw.match(/<key>EXUpdatesRuntimeVersion<\/key>\s*<string>([^<]*)<\/string>/);
  if (!plistRuntimeMatch) {
    throw new Error('EXUpdatesRuntimeVersion not found in Expo.plist');
  }
  const plistRuntimeVersion = plistRuntimeMatch[1];

  return {
    pbxprojRaw, appJsonRaw, plistRaw,
    pbxprojBuilds, appBuildNumber, appVersion, appRuntimeVersion, plistRuntimeVersion,
  };
}

function validate(s) {
  const errors = [];
  const uniqueBuilds = [...new Set(s.pbxprojBuilds)];
  if (uniqueBuilds.length !== 1) {
    errors.push(`pbxproj has mixed CURRENT_PROJECT_VERSION values: ${uniqueBuilds.join(', ')}`);
  }
  const pbxBuild = uniqueBuilds[0];
  if (pbxBuild !== s.appBuildNumber) {
    errors.push(`pbxproj build (${pbxBuild}) != app.json buildNumber (${s.appBuildNumber})`);
  }
  if (typeof s.appRuntimeVersion !== 'string') {
    errors.push(`app.json expo.runtimeVersion must be a literal string (got: ${JSON.stringify(s.appRuntimeVersion)}). Bare workflow doesn't support policy objects.`);
  }
  if (s.appVersion !== s.appRuntimeVersion) {
    errors.push(`app.json version (${s.appVersion}) != runtimeVersion (${s.appRuntimeVersion})`);
  }
  if (s.appRuntimeVersion !== s.plistRuntimeVersion) {
    errors.push(`app.json runtimeVersion (${s.appRuntimeVersion}) != Expo.plist EXUpdatesRuntimeVersion (${s.plistRuntimeVersion})`);
  }
  return { errors, pbxBuild };
}

async function main() {
  const s = await readSources();
  const { errors, pbxBuild } = validate(s);

  if (errors.length > 0) {
    console.error('version sources are out of sync:');
    errors.forEach((e) => console.error(`  - ${e}`));
    if (!force) {
      console.error('\nfix manually or pass --force to bump anyway.');
      process.exit(1);
    }
    console.error('\n--force set, proceeding despite drift.');
  }

  const newBuild = pbxBuild + 1;
  let newVersion = s.appVersion;
  if (releaseType) {
    newVersion = bumpSemver(s.appVersion, releaseType);
  }

  console.log(`build: ${pbxBuild} -> ${newBuild}`);
  if (releaseType) {
    console.log(`version + runtime: ${s.appVersion} -> ${newVersion} (--release ${releaseType})`);
    console.log(`  ↑ this BREAKS the OTA chain — old binaries on runtime ${s.appVersion} will not receive OTAs from this build.`);
  } else {
    console.log(`version + runtime: ${newVersion} (unchanged — OTA chain preserved)`);
  }

  if (dryRun) {
    console.log('\n--dry-run set, no files written.');
    return;
  }

  const newPbxproj = s.pbxprojRaw.replaceAll(
    `CURRENT_PROJECT_VERSION = ${pbxBuild};`,
    `CURRENT_PROJECT_VERSION = ${newBuild};`,
  );

  const appJson = JSON.parse(s.appJsonRaw);
  appJson.expo.ios.buildNumber = String(newBuild);
  if (releaseType) {
    appJson.expo.version = newVersion;
    appJson.expo.runtimeVersion = newVersion;
  }
  // Preserve trailing newline + 2-space indent (matches existing app.json style).
  const newAppJson = JSON.stringify(appJson, null, 2) + '\n';

  let newPlist = s.plistRaw;
  if (releaseType) {
    newPlist = s.plistRaw.replace(
      /(<key>EXUpdatesRuntimeVersion<\/key>\s*<string>)[^<]*(<\/string>)/,
      `$1${newVersion}$2`,
    );
  }

  await Promise.all([
    writeFile(PBXPROJ, newPbxproj),
    writeFile(APP_JSON, newAppJson),
    ...(releaseType ? [writeFile(EXPO_PLIST, newPlist)] : []),
  ]);

  console.log(`\nbumped. don't forget to commit + run \`eas build --profile production --platform ios\`.`);
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
