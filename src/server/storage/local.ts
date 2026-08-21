import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { StorageDriver, StoredObject } from './types';

export class LocalStorageDriver implements StorageDriver {
  readonly id = 'local';
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  /**
   * Résout une clé en chemin absolu en refusant toute évasion du répertoire
   * racine: une clé vient parfois d'une entrée utilisateur.
   */
  private resolve(key: string): string {
    const normalized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    const full = path.resolve(this.root, normalized);
    if (!full.startsWith(this.root + path.sep) && full !== this.root) {
      throw new Error(`Clé de stockage invalide: ${key}`);
    }
    return full;
  }

  private async ensureDir(filePath: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
    const full = this.resolve(key);
    await this.ensureDir(full);
    await writeFile(full, data);
    return { key, sizeBytes: data.byteLength, contentType };
  }

  async putStream(
    key: string,
    stream: NodeJS.ReadableStream,
    contentType: string,
  ): Promise<StoredObject> {
    const full = this.resolve(key);
    await this.ensureDir(full);
    await pipeline(stream, createWriteStream(full));
    const info = await stat(full);
    return { key, sizeBytes: info.size, contentType };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async url(key: string): Promise<string> {
    return `/api/media/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async localPath(key: string): Promise<string> {
    return this.resolve(key);
  }

  async size(key: string): Promise<number> {
    const info = await stat(this.resolve(key));
    return info.size;
  }
}
