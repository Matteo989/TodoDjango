import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { env } from '@/lib/env';
import { LocalStorageDriver } from './local';
import { S3StorageDriver } from './s3';
import type { StorageDriver } from './types';

export type { StorageDriver, StoredObject } from './types';

let cached: StorageDriver | null = null;

export function storage(): StorageDriver {
  if (cached) return cached;
  const e = env();
  cached =
    e.STORAGE_DRIVER === 's3'
      ? new S3StorageDriver({
          endpoint: e.S3_ENDPOINT,
          region: e.S3_REGION,
          bucket: e.S3_BUCKET,
          accessKey: e.S3_ACCESS_KEY,
          secretKey: e.S3_SECRET_KEY,
          forcePathStyle: e.S3_FORCE_PATH_STYLE !== 'false',
        })
      : new LocalStorageDriver(e.STORAGE_LOCAL_DIR);
  return cached;
}

/**
 * Clés de stockage: préfixées par workspace pour que l'isolation soit visible
 * dans l'arborescence, et suffixées d'un identifiant aléatoire pour qu'un
 * ré-upload du même nom n'écrase jamais un fichier déjà référencé.
 */
export function buildKey(
  workspaceId: string,
  category: 'assets' | 'thumbnails' | 'voice' | 'renders' | 'captions' | 'music' | 'proofs' | 'tmp',
  filename: string,
): string {
  const ext = path.extname(filename).toLowerCase().slice(0, 8);
  const base = path
    .basename(filename, path.extname(filename))
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .slice(0, 40);
  return `${workspaceId}/${category}/${base}-${randomUUID().slice(0, 8)}${ext}`;
}
