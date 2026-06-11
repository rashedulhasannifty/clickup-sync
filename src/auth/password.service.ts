import { Injectable } from '@nestjs/common';
import {
  randomBytes,
  scrypt as _scrypt,
  ScryptOptions,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

// promisify resolves to the no-options overload; cast to the full signature.
const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

const N = 16384; // CPU/memory cost
const r = 8;
const p = 1;
const KEYLEN = 64;
const SALT_LEN = 16;

@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    const salt = randomBytes(SALT_LEN);
    const derived = await scrypt(plain, salt, KEYLEN, { N, r, p });
    return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
  }

  async verify(plain: string, stored: string): Promise<boolean> {
    try {
      const parts = stored.split('$');
      if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
      const [, n, rr, pp, saltB64, hashB64] = parts;
      const salt = Buffer.from(saltB64, 'base64');
      const expected = Buffer.from(hashB64, 'base64');
      const derived = await scrypt(plain, salt, expected.length, {
        N: Number(n),
        r: Number(rr),
        p: Number(pp),
      });
      return derived.length === expected.length && timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }
}
