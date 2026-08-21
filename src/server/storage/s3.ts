import { mkdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageDriver, StoredObject } from './types';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
}

export class S3StorageDriver implements StorageDriver {
  readonly id = 's3';
  private readonly client: S3Client;
  private readonly bucket: string;
  /** Les fichiers descendus pour FFmpeg vivent ici le temps du rendu. */
  private readonly cacheDir = path.join(os.tmpdir(), 'iavid-s3-cache');

  constructor(config: S3Config) {
    if (!config.bucket) throw new Error('S3_BUCKET est requis avec STORAGE_DRIVER=s3.');
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }),
    );
    return { key, sizeBytes: data.byteLength, contentType };
  }

  async putStream(
    key: string,
    stream: NodeJS.ReadableStream,
    contentType: string,
  ): Promise<StoredObject> {
    // S3 exige la taille du corps: on matérialise le flux avant l'envoi.
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    return this.put(key, Buffer.concat(chunks), contentType);
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = response.Body as NodeJS.ReadableStream | undefined;
    if (!body) throw new Error(`Objet S3 introuvable: ${key}`);
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    return Buffer.concat(chunks);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async url(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: 3600,
    });
  }

  async localPath(key: string): Promise<string> {
    const target = path.join(this.cacheDir, key);
    try {
      await stat(target);
      return target;
    } catch {
      // Absent du cache: on télécharge une fois puis on réutilise.
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await this.get(key));
    return target;
  }

  async size(key: string): Promise<number> {
    const response = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return response.ContentLength ?? 0;
  }
}
