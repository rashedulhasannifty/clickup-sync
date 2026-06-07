/*
 * E2E test runner with database isolation.
 *
 * The auth e2e suite calls `user.deleteMany()` (no filter) in beforeAll/afterAll,
 * because it has to start from an empty users table to exercise the "first signup
 * claims the org" flow. If that ran against the dev DATABASE_URL it would wipe the
 * developer's real login every time. This runner provisions a dedicated
 * `<db>_test` database on the same Postgres server and points the suite at it.
 *
 * The isolation hinges on dotenv's default `override: false`: the spec does
 * `import 'dotenv/config'`, but because we spawn jest with DATABASE_URL already
 * set in the environment, the spec's reload of .env does NOT clobber it.
 */
require('dotenv/config');
const { Client } = require('pg');
const { execSync, execFileSync } = require('node:child_process');
const path = require('node:path');

/** Swap the database name in a Postgres URL for `<name>_test`. */
function deriveTestUrl(base) {
  const u = new URL(base);
  const name = u.pathname.replace(/^\//, '') || 'postgres';
  u.pathname = '/' + name + '_test';
  return { testUrl: u.toString(), dbName: name + '_test' };
}

/** Same server/credentials, but the always-present `postgres` maintenance DB. */
function adminUrl(base) {
  const u = new URL(base);
  u.pathname = '/postgres';
  return u.toString();
}

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) {
    console.error('[e2e] DATABASE_URL is not set — cannot derive a test database.');
    process.exit(1);
  }

  const { testUrl, dbName } = deriveTestUrl(base);

  // 1. Create the test database if it doesn't exist (CREATE DATABASE can't run in a tx).
  const admin = new Client({ connectionString: adminUrl(base) });
  await admin.connect();
  const exists = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${dbName}"`);
    console.log(`[e2e] created database ${dbName}`);
  } else {
    console.log(`[e2e] database ${dbName} already exists`);
  }
  await admin.end();

  // 2. Apply committed migrations to the test database. npm run puts node_modules/.bin
  //    on PATH so `prisma` resolves; the env override makes prisma.config.ts target the
  //    test DB (its `import 'dotenv/config'` won't override an already-set DATABASE_URL).
  const childEnv = { ...process.env, DATABASE_URL: testUrl };
  console.log(`[e2e] applying migrations to ${dbName}...`);
  execSync('npm run prisma:deploy', { stdio: 'inherit', env: childEnv });

  // 3. Run the e2e suite against the test database. Forward any extra CLI args.
  const jestBin = require.resolve('jest/bin/jest');
  const args = [
    '--max-old-space-size=4096',
    jestBin,
    '--runInBand',
    '--config',
    path.join('test', 'jest-e2e.json'),
    ...process.argv.slice(2),
  ];
  execFileSync(process.execPath, args, { stdio: 'inherit', env: childEnv });
}

main().catch((e) => {
  // execFileSync throws on a non-zero child exit (e.g. failing tests); propagate it.
  if (typeof e.status === 'number') process.exit(e.status);
  console.error('[e2e] setup failed:', e.message);
  process.exit(1);
});
