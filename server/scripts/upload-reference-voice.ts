/**
 * One-off utility: upload a local audio file to Replicate's Files API and
 * print the resulting public URL. Use that URL as CHATTERBOX_REFERENCE_AUDIO_URL
 * in the local server .env so the Chatterbox provider can pass it to every
 * prediction request.
 *
 *   npx tsx scripts/upload-reference-voice.ts <local-path>
 *
 * Requires REPLICATE_API_TOKEN in the environment (.env is auto-loaded).
 */
import 'dotenv/config';
import { promises as fs } from 'fs';
import * as path from 'path';

async function main(): Promise<void> {
  const [, , localPath] = process.argv;
  if (!localPath) {
    console.error('Usage: npx tsx scripts/upload-reference-voice.ts <local-path>');
    process.exit(1);
  }
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    console.error('Missing REPLICATE_API_TOKEN in .env');
    process.exit(1);
  }

  const bytes = await fs.readFile(localPath);
  const filename = path.basename(localPath);

  const form = new FormData();
  form.append('content', new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' }), filename);

  const res = await fetch('https://api.replicate.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Upload failed: ${res.status} ${body.slice(0, 300)}`);
    process.exit(1);
  }
  const data = await res.json() as { id?: string; urls?: { get?: string } };
  const url = data.urls?.get;
  if (!url) {
    console.error(`Upload succeeded but no URL returned: ${JSON.stringify(data)}`);
    process.exit(1);
  }

  console.log(`Uploaded ${filename} (${bytes.byteLength} bytes)`);
  console.log(`Replicate file URL: ${url}`);
  console.log('');
  console.log('Add this line to server/.env:');
  console.log(`CHATTERBOX_REFERENCE_AUDIO_URL=${url}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
