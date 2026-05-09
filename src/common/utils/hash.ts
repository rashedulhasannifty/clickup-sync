import { createHash } from 'node:crypto';
export function sha256(input: unknown): string {
  return createHash('sha256').update(typeof input === 'string' ? input : JSON.stringify(input)).digest('hex');
}
