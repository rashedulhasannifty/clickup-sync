#!/usr/bin/env node
/**
 * Convert an AWS IAM secret access key into an SES SMTP password.
 *
 * The SES SMTP password is NOT the raw IAM secret key — it is derived from it
 * via a chained HMAC-SHA256 (the SigV4 key-derivation scheme) with a version
 * byte prepended. The result is deterministic: same secret + same region always
 * produces the same password.
 *
 * Usage:
 *   node scripts/ses-smtp-password.js <SECRET_ACCESS_KEY> [region]
 *
 * Example:
 *   node scripts/ses-smtp-password.js AfQp...XxGD ap-southeast-1
 */
const crypto = require('crypto');

function hmac(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest(); // raw Buffer
}

function deriveSmtpPassword(secretAccessKey, region) {
  const date = '11111111';
  const service = 'ses';
  const terminal = 'aws4_request';
  const message = 'SendRawEmail';
  const version = 0x04;

  let sig = hmac('AWS4' + secretAccessKey, date);
  sig = hmac(sig, region);
  sig = hmac(sig, service);
  sig = hmac(sig, terminal);
  sig = hmac(sig, message);

  return Buffer.concat([Buffer.from([version]), sig]).toString('base64');
}

const [, , secret, region = 'ap-southeast-1'] = process.argv;
if (!secret) {
  console.error('Usage: node scripts/ses-smtp-password.js <SECRET_ACCESS_KEY> [region]');
  process.exit(1);
}
console.log(deriveSmtpPassword(secret, region));
