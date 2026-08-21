export interface StoredObject {
  key: string;
  sizeBytes: number;
  contentType: string;
}

/**
 * Abstraction de stockage. En développement, les fichiers vivent sur disque;
 * en production, dans un bucket compatible S3. Les services ne manipulent que
 * des CLÉS, jamais des chemins absolus — c'est ce qui rend les deux modes
 * interchangeables.
 */
export interface StorageDriver {
  readonly id: string;
  put(key: string, data: Buffer, contentType: string): Promise<StoredObject>;
  putStream(key: string, stream: NodeJS.ReadableStream, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** URL consultable par le navigateur (route locale ou URL signée S3). */
  url(key: string): Promise<string>;
  /**
   * Chemin local exploitable par FFmpeg. Le driver S3 télécharge dans un cache
   * temporaire: FFmpeg a besoin d'un fichier, pas d'une URL.
   */
  localPath(key: string): Promise<string>;
  size(key: string): Promise<number>;
}
