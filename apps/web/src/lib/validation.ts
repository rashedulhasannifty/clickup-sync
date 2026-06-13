// Lightweight client-side validators. Intentionally permissive — the backend
// is the source of truth; these just give users a fast, specific message.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True if `value` looks like a valid email address. */
export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}
