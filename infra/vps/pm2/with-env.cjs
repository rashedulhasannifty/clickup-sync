#!/usr/bin/env node
'use strict';

/**
 * Run a one-off command with the production environment loaded:
 *
 *   node /srv/clickup-sync/shared/with-env.cjs <env-file> <command> [args...]
 *
 * Used for `prisma migrate deploy`, the admin seed and ops scripts — anything that must see the
 * same env PM2 gives the apps, parsed the same way (env-file.cjs). Never `source` the file in a
 * shell: MAIL_FROM contains `<` and `>`, and a password may contain `$`.
 *
 * Variables already set in the calling environment WIN over the file, so a one-off override
 * (e.g. SEED_ADMIN_EMAIL for the first seed) can be passed without editing shared/.env.
 * Secrets are passed through the environment, never on the command line, so they stay out of `ps`.
 */
const { spawnSync } = require('node:child_process');
const { readEnvFile } = require('./env-file.cjs');

const [file, command, ...args] = process.argv.slice(2);
if (!file || !command) {
  process.stderr.write('usage: with-env.cjs <env-file> <command> [args...]\n');
  process.exit(2);
}

const result = spawnSync(command, args, {
  stdio: 'inherit',
  env: { ...readEnvFile(file), ...process.env },
});

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
