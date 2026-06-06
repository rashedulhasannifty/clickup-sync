import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { sha256 } from '../common/utils/hash';

@Injectable()
export class TokenService {
  /** A random opaque token (kept only client-side) and its at-rest hash. */
  generate(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('hex');
    return { token, tokenHash: sha256(token) };
  }

  hash(token: string): string {
    return sha256(token);
  }

  expiryFromDays(days: number, from = new Date()): Date {
    return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  }
}
