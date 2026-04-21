import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectStorage } from './ObjectStorage';

const DEFAULT_PRESIGN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Abstracts the S3 client calls so tests don't need real credentials or
 * network access. Production uses S3RequestUploader against Cloudflare R2.
 */
export interface R2Uploader {
  upload(key: string, bytes: Buffer, contentType: string): Promise<void>;
  sign(key: string, ttlSeconds: number): Promise<string>;
}

export interface R2ObjectStorageConfig {
  uploader: R2Uploader;
  publicBaseUrl?: string;
  presignTtlSeconds?: number;
}

export class R2ObjectStorage implements ObjectStorage {
  private readonly uploader: R2Uploader;
  private readonly publicBaseUrl?: string;
  private readonly presignTtlSeconds: number;

  constructor(config: R2ObjectStorageConfig) {
    this.uploader = config.uploader;
    this.publicBaseUrl = config.publicBaseUrl?.replace(/\/+$/, '');
    this.presignTtlSeconds = config.presignTtlSeconds ?? DEFAULT_PRESIGN_TTL_SECONDS;
  }

  async put(key: string, bytes: Buffer): Promise<string> {
    validateKey(key);
    await this.uploader.upload(key, bytes, 'audio/mpeg');
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl}/${key}`;
    }
    return this.uploader.sign(key, this.presignTtlSeconds);
  }
}

function validateKey(key: string): void {
  if (!key) throw new Error('invalid key: empty');
  if (key.startsWith('/')) throw new Error('invalid key: leading slash');
  if (key.includes('\\')) throw new Error('invalid key: backslash');
  const segments = key.split('/');
  if (segments.some((s) => s === '..' || s === '.')) {
    throw new Error('invalid key: relative segment');
  }
}

export interface S3UploaderConfig {
  client: S3Client;
  bucket: string;
}

/**
 * Production R2Uploader backed by the AWS S3 SDK. R2 is S3-compatible at the
 * wire level, so the same client works against Cloudflare with a custom
 * endpoint URL.
 */
export class S3RequestUploader implements R2Uploader {
  constructor(private readonly config: S3UploaderConfig) {}

  async upload(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.config.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  async sign(key: string, ttlSeconds: number): Promise<string> {
    const cmd = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });
    return getSignedUrl(this.config.client, cmd, { expiresIn: ttlSeconds });
  }
}
