import { NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
import type { DocumentStorage, StoredObject } from '../document-storage';

/** Test-only DocumentStorage backed by a Map. */
export class InMemoryDocumentStorage implements DocumentStorage {
  readonly enabled = true;
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  /** Set to make the next put() fail, to exercise cleanup paths. */
  failNextPut = false;

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error('boom');
    }
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }

  async getStream(key: string): Promise<StoredObject> {
    const o = this.objects.get(key);
    if (!o) throw new NotFoundException('The file is missing from storage.');
    return { stream: Readable.from([o.body]), contentLength: o.body.length };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
