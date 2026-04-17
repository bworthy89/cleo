import { createStorage } from '@/services/storage/createStorage';
import { LocalFilesystemStorage } from '@/services/storage/ObjectStorage';
import { R2ObjectStorage } from '@/services/storage/R2ObjectStorage';

const LOCAL_ENV = {
  BROADCAST_CACHE_DIR: '/tmp/test-cache',
  BROADCAST_ASSET_BASE_URL: 'http://localhost:3001',
};

const R2_ENV = {
  STORAGE_BACKEND: 'r2',
  R2_ACCOUNT_ID: 'acc123',
  R2_ACCESS_KEY_ID: 'key123',
  R2_SECRET_ACCESS_KEY: 'secret123',
  R2_BUCKET: 'bucket123',
};

describe('createStorage', () => {
  it('returns LocalFilesystemStorage when STORAGE_BACKEND is unset', () => {
    const storage = createStorage({ ...LOCAL_ENV });
    expect(storage).toBeInstanceOf(LocalFilesystemStorage);
  });

  it('returns LocalFilesystemStorage when STORAGE_BACKEND=local', () => {
    const storage = createStorage({ ...LOCAL_ENV, STORAGE_BACKEND: 'local' });
    expect(storage).toBeInstanceOf(LocalFilesystemStorage);
  });

  it('returns R2ObjectStorage when STORAGE_BACKEND=r2 and all creds are set', () => {
    const storage = createStorage(R2_ENV);
    expect(storage).toBeInstanceOf(R2ObjectStorage);
  });

  it('throws when STORAGE_BACKEND=r2 but R2_ACCOUNT_ID is missing', () => {
    const { R2_ACCOUNT_ID: _omit, ...rest } = R2_ENV;
    expect(() => createStorage(rest)).toThrow(/R2_ACCOUNT_ID/);
  });

  it('throws when STORAGE_BACKEND=r2 but R2_BUCKET is missing', () => {
    const { R2_BUCKET: _omit, ...rest } = R2_ENV;
    expect(() => createStorage(rest)).toThrow(/R2_BUCKET/);
  });

  it('throws when STORAGE_BACKEND=r2 but R2_ACCESS_KEY_ID is missing', () => {
    const { R2_ACCESS_KEY_ID: _omit, ...rest } = R2_ENV;
    expect(() => createStorage(rest)).toThrow(/R2_ACCESS_KEY_ID/);
  });

  it('throws when STORAGE_BACKEND=r2 but R2_SECRET_ACCESS_KEY is missing', () => {
    const { R2_SECRET_ACCESS_KEY: _omit, ...rest } = R2_ENV;
    expect(() => createStorage(rest)).toThrow(/R2_SECRET_ACCESS_KEY/);
  });

  it('throws on an unknown STORAGE_BACKEND value', () => {
    expect(() => createStorage({ STORAGE_BACKEND: 'azure' })).toThrow(/unknown storage backend/i);
  });

  it('throws when local backend is missing BROADCAST_CACHE_DIR', () => {
    expect(() => createStorage({
      STORAGE_BACKEND: 'local',
      BROADCAST_ASSET_BASE_URL: 'http://localhost:3001',
    })).toThrow(/BROADCAST_CACHE_DIR/);
  });
});
