import type { Readable } from 'node:stream';

/** DI token for the active DocumentStorage. */
export const DOCUMENT_STORAGE = Symbol('DOCUMENT_STORAGE');

export interface StoredObject {
  stream: Readable;
  /** Length in bytes when the store reports it. */
  contentLength: number | null;
}

/**
 * Where document bytes live. The bucket is private: the app is the only reader and writer, so
 * there is no URL-signing here, by design. Implementations map their own errors to Nest HTTP
 * exceptions with generic messages (never the raw SDK error, which can carry request details).
 */
export interface DocumentStorage {
  /** False when the feature is not configured; every route answers 503 and no method is called. */
  readonly enabled: boolean;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Throws NotFoundException when the object is missing. */
  getStream(key: string): Promise<StoredObject>;
  /** Idempotent: deleting a missing object is not an error. */
  delete(key: string): Promise<void>;
}

export interface DocumentsS3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}
