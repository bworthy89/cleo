import { S3Client } from '@aws-sdk/client-s3';
import { LocalFilesystemStorage, type ObjectStorage } from './ObjectStorage';
import { R2ObjectStorage, S3RequestUploader } from './R2ObjectStorage';

type Env = Record<string, string | undefined>;

export function createStorage(env: Env): ObjectStorage {
  const backend = (env.STORAGE_BACKEND ?? 'local').toLowerCase();

  if (backend === 'local') {
    return createLocalStorage(env);
  }
  if (backend === 'r2') {
    return createR2Storage(env);
  }
  throw new Error(`unknown storage backend: ${env.STORAGE_BACKEND}`);
}

function createLocalStorage(env: Env): LocalFilesystemStorage {
  const cacheDir = env.BROADCAST_CACHE_DIR;
  if (!cacheDir) {
    throw new Error('BROADCAST_CACHE_DIR is required for local storage backend');
  }
  const baseUrl = `${env.BROADCAST_ASSET_BASE_URL ?? 'http://localhost:3001'}/broadcast-asset`;
  return new LocalFilesystemStorage(cacheDir, baseUrl);
}

function createR2Storage(env: Env): R2ObjectStorage {
  const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
  for (const name of required) {
    if (!env[name]) {
      throw new Error(`${name} is required for r2 storage backend`);
    }
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });
  const uploader = new S3RequestUploader({ client, bucket: env.R2_BUCKET! });
  return new R2ObjectStorage({
    uploader,
    publicBaseUrl: env.R2_PUBLIC_BASE_URL || undefined,
  });
}
