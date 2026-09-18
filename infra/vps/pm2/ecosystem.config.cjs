'use strict';

/**
 * PM2 process definitions for clickup-sync on the shared BDIX VPS.
 *
 * Lives in /srv/clickup-sync/shared/ (not inside a release): PM2 keeps the path, and release
 * directories get pruned. env-file.cjs / with-env.cjs are the same literal .env reader timetrack
 * uses (no dotenv: an unquoted `#` in a generated secret would be silently truncated).
 *
 * ONE instance each, on purpose:
 * - web: @nestjs/throttler keeps counters in process memory; N instances = N x every limit.
 *   Cluster mode with one instance still gives a zero-downtime `pm2 reload`.
 * - worker: ROLE=worker runs the BullMQ processors AND the cron scheduler. Two copies would
 *   double-fire scheduled backfills. Fork mode, one process.
 *
 * Port 3200 is closed publicly by UFW; 3000/3001/3100/4000/8100/9100 are other
 * apps on this box. Caddy (log.niftyitsolution.com block) is the sole public entrypoint.
 */

const path = require('node:path');
const { readEnvFile } = require('./env-file.cjs');

const APP_ROOT = process.env.APP_ROOT || '/srv/clickup-sync';
const CURRENT = path.join(APP_ROOT, 'current');
const sharedEnv = readEnvFile(path.join(APP_ROOT, 'shared', '.env'));
const APP_VERSION = process.env.APP_VERSION || 'unknown';

module.exports = {
  apps: [
    {
      name: 'clickup-sync-web',
      cwd: CURRENT,
      script: 'dist/main.js',
      exec_mode: 'cluster',
      instances: 1,
      max_memory_restart: '768M',
      node_args: '--max-old-space-size=512',
      kill_timeout: 15000,
      listen_timeout: 30000,
      env: { ...sharedEnv, NODE_ENV: 'production', ROLE: 'web', PORT: '3200', APP_VERSION },
    },
    {
      name: 'clickup-sync-worker',
      cwd: CURRENT,
      script: 'dist/main.js',
      exec_mode: 'fork',
      instances: 1,
      // Backfills are the heavy path.
      max_memory_restart: '1024M',
      node_args: '--max-old-space-size=768',
      // Let an active BullMQ job finish on SIGINT.
      kill_timeout: 30000,
      env: { ...sharedEnv, NODE_ENV: 'production', ROLE: 'worker', APP_VERSION },
    },
  ],
};
