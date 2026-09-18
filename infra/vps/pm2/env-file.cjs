'use strict';

/**
 * Minimal, literal .env reader shared by ecosystem.config.cjs and with-env.cjs.
 *
 * Deliberately NOT dotenv or `node --env-file`: both treat an unquoted `#` as the start of a
 * comment, and a generated secret can contain one — the value would be silently truncated and
 * the API would boot with the wrong password. Here a value is everything after the first `=`,
 * with one layer of matching quotes stripped (the deploy writes MAIL_FROM quoted).
 *
 * It also cannot depend on node_modules: this file lives in shared/, which outlives every
 * release directory.
 */
const fs = require('node:fs');

function readEnvFile(file) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing ${file}. The deploy writes it from GitHub secrets before reloading PM2; ` +
        'refusing to start with an incomplete environment.',
    );
  }

  const env = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

module.exports = { readEnvFile };
