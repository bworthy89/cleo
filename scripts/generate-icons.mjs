// Renders the Analog Midnight wordmark icon via headless Chrome, then syncs
// the rendered PNGs into the bare-workflow iOS asset catalog so EAS cloud
// builds ship the current artwork.
//
// Run with:
//   node scripts/generate-icons.mjs        # render + sync (default)
//   node scripts/generate-icons.mjs --sync-only  # skip render, just copy
//                                                 # existing assets into ios/
//
// Outputs:
//   assets/icon.png         — 1024×1024 iOS master
//   assets/splash-icon.png  — same master, used by Expo's splash screen
//   ios/ONAY/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png
//   ios/ONAY/Images.xcassets/SplashScreenLegacy.imageset/image.png
//   ios/ONAY/Images.xcassets/SplashScreenLegacy.imageset/image@2x.png
//   ios/ONAY/Images.xcassets/SplashScreenLegacy.imageset/image@3x.png
//
// Why the sync step: ios/ is tracked in git (bare workflow), so `expo
// prebuild` no longer runs on EAS — nothing copies assets/icon.png into
// the asset catalog automatically. Without this sync, the committed icon
// stays frozen at whatever was there at initial prebuild and new artwork
// silently fails to ship.
//
// Source HTML:
//   scripts/icons/master.html — Fraunces italic 300 "onay" on #0A0807
//                               with an SVG feTurbulence grain overlay.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { copyFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const masterHtml = resolve(here, 'icons/master.html');
const iconOut   = resolve(repoRoot, 'assets/icon.png');
const splashOut = resolve(repoRoot, 'assets/splash-icon.png');

const iosAppIcon = resolve(
  repoRoot,
  'ios/ONAY/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png',
);
const iosSplashImages = [
  resolve(repoRoot, 'ios/ONAY/Images.xcassets/SplashScreenLegacy.imageset/image.png'),
  resolve(repoRoot, 'ios/ONAY/Images.xcassets/SplashScreenLegacy.imageset/image@2x.png'),
  resolve(repoRoot, 'ios/ONAY/Images.xcassets/SplashScreenLegacy.imageset/image@3x.png'),
];

const syncOnly = process.argv.includes('--sync-only');

async function renderTile(browser, htmlPath, outPath) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 1024, deviceScaleFactor: 1 });
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });
  // Force-load the italic face — Google Fonts variable font descriptors
  // report "normal" style but check() against "italic 300 340px" passes.
  await page.evaluate(async () => {
    await document.fonts.load('italic 300 340px Fraunces');
    await document.fonts.ready;
  });
  await page.screenshot({
    path: outPath,
    omitBackground: false,
    clip: { x: 0, y: 0, width: 1024, height: 1024 },
  });
  await page.close();
  console.log(`wrote ${outPath}`);
}

if (!syncOnly) {
  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    await renderTile(browser, masterHtml, iconOut);
    // Splash reuses the master. Expo centers it on splash.backgroundColor,
    // so app.json's splash bg should match the tile bg (#0A0807).
    await copyFile(iconOut, splashOut);
    console.log(`wrote ${splashOut}`);
  } finally {
    await browser.close();
  }
}

// Sync into the iOS asset catalog so EAS cloud builds pick up the current art.
await copyFile(iconOut, iosAppIcon);
console.log(`synced ${iosAppIcon}`);
for (const target of iosSplashImages) {
  await copyFile(splashOut, target);
  console.log(`synced ${target}`);
}
