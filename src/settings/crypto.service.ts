import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // GCM standard nonce length
const TAG_LEN = 16;

/**
 * Parse APP_ENCRYPTION_KEY into a 32-byte key.
 * Accepts: 64 hex chars, base64 that decodes to 32 bytes, or a raw 32-char string.
 */
function parseKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const b = Buffer.from(raw, 'base64');
    if (b.length === 32) return b;
  } catch {
    /* not base64 */
  }
  if (Buffer.byteLength(raw, 'utf8') === 32) return Buffer.from(raw, 'utf8');
  return null;
}

/** True when `raw` parses to a usable 32-byte key. Shared with env validation. */
export function isValidEncryptionKey(raw: string | undefined): boolean {
  return parseKey(raw) !== null;
}

/**
 * AES-256-GCM encryption for settings secrets (ClickUp API token, webhook secret)
 * stored at rest in Postgres. The key comes from APP_ENCRYPTION_KEY and never
 * touches the database. Ciphertext format: base64(iv | authTag | ciphertext).
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly key: Buffer | null;

  constructor() {
    this.key = parseKey(process.env.APP_ENCRYPTION_KEY);
    if (!this.key && process.env.APP_ENCRYPTION_KEY) {
      this.logger.warn(
        'APP_ENCRYPTION_KEY is set but is not a valid 32-byte key (expected 64 hex chars or base64-encoded 32 bytes). Secret encryption is disabled.',
      );
    }
  }

  /** True when a usable key is configured. When false, secret settings fall back to env. */
  get isEnabled(): boolean {
    return this.key !== null;
  }

  encrypt(plain: string): string {
    if (!this.key) {
      throw new Error(
        'Encryption key not configured (APP_ENCRYPTION_KEY). Cannot store secret settings in the database.',
      );
    }
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGO, this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }

  decrypt(blob: string): string {
    if (!this.key) {
      throw new Error('Encryption key not configured (APP_ENCRYPTION_KEY).');
    }
    const buf = Buffer.from(blob, 'base64');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }
}
