import * as fs from 'fs/promises';
import * as path from 'path';

export interface ObjectStorage {
  put(key: string, bytes: Buffer): Promise<string>;
  getAbsolutePath(key: string): string;
}

export class LocalFilesystemStorage implements ObjectStorage {
  constructor(private readonly root: string, private readonly baseUrl: string) {}

  async put(key: string, bytes: Buffer): Promise<string> {
    const abs = this.getAbsolutePath(key);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, bytes);
    return `${this.baseUrl}/${key}`;
  }

  getAbsolutePath(key: string): string {
    const resolvedRoot = path.resolve(this.root);
    const resolvedKey = path.resolve(resolvedRoot, key);
    if (!resolvedKey.startsWith(resolvedRoot + path.sep) && resolvedKey !== resolvedRoot) {
      throw new Error('key escapes storage root');
    }
    return resolvedKey;
  }
}
