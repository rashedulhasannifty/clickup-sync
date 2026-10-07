import { BadGatewayException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { DocumentStorage, DocumentsS3Config, StoredObject } from './document-storage';

/** Reached when the documents env vars are unset. Every route is guarded first, so this is a backstop. */
export class DisabledDocumentStorage implements DocumentStorage {
  readonly enabled = false;
  private fail(): never {
    throw new ServiceUnavailableException('Employee documents are not configured on this server.');
  }
  put(): Promise<void> { return this.fail(); }
  getStream(): Promise<StoredObject> { return this.fail(); }
  delete(): Promise<void> { return this.fail(); }
}

/** S3-compatible object storage (MinIO in dev and prod). Credentials are never logged. */
export class S3DocumentStorage implements DocumentStorage {
  readonly enabled = true;
  private readonly logger = new Logger(S3DocumentStorage.name);
  private readonly client: S3Client;

  constructor(private readonly cfg: DocumentsS3Config) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // Recent SDKs add CRC checksums to every request by default; S3-compatible stores that
      // predate them (older MinIO) reject the trailer. Only checksum when an operation requires it.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentLength: body.length, ContentType: contentType }),
      );
    } catch (e) {
      throw this.toHttpError(e, 'put');
    }
  }

  async getStream(key: string): Promise<StoredObject> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      if (!res.Body) throw new NotFoundException('The file is missing from storage.');
      // In Node the SDK body is an IncomingMessage (a Readable).
      return { stream: res.Body as Readable, contentLength: res.ContentLength ?? null };
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      throw this.toHttpError(e, 'get');
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    } catch (e) {
      throw this.toHttpError(e, 'delete');
    }
  }

  /** Generic messages only: the raw SDK error can carry the request id, endpoint and key. */
  private toHttpError(e: unknown, op: string): Error {
    const name = e instanceof Error ? e.name : 'Unknown';
    const status = e instanceof S3ServiceException ? e.$metadata?.httpStatusCode : undefined;
    this.logger.warn(`S3 ${op} failed: ${name}${status ? ` (HTTP ${status})` : ''}`);
    if (name === 'NoSuchKey' || status === 404) return new NotFoundException('The file is missing from storage.');
    return new BadGatewayException('Document storage is unavailable. Try again in a minute.');
  }
}
