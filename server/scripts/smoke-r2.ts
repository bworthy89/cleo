import 'dotenv/config';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createStorage } from '../src/services/storage/createStorage';

async function main() {
  const env = { ...process.env, STORAGE_BACKEND: 'r2' };
  const storage = createStorage(env);

  const key = `smoke-test/${Date.now()}.mp3`;
  const payload = Buffer.from('ID3\x04\x00\x00\x00SMOKE-TEST');

  console.log(`[smoke] Uploading ${payload.length} bytes to key: ${key}`);
  const url = await storage.put(key, payload);
  console.log(`[smoke] Got URL: ${url}`);

  console.log('[smoke] Fetching URL back...');
  const resp = await fetch(url);
  if (!resp.ok) {
    console.error(`[smoke] FETCH FAILED: ${resp.status} ${resp.statusText}`);
    process.exit(1);
  }
  const roundTrip = Buffer.from(await resp.arrayBuffer());

  if (roundTrip.equals(payload)) {
    console.log(`[smoke] Round-trip bytes match (${roundTrip.length} bytes)`);
  } else {
    console.error(`[smoke] BYTES MISMATCH: sent ${payload.length}, got ${roundTrip.length}`);
    process.exit(1);
  }

  // Clean up the test object
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });
  await client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET!, Key: key }));
  console.log(`[smoke] Cleaned up test object`);

  console.log('[smoke] ✓ R2 storage is working end-to-end');
}

main().catch((err) => {
  console.error('[smoke] FAILED:', err);
  process.exit(1);
});
