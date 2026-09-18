#!/usr/bin/env bash
#
# Runs ON THE VPS as the deploy user. Invoked over SSH by .github/workflows/deploy.yml with the
# git SHA being deployed. Expects:
#   $APP_ROOT/tmp/<sha>.src.tar.gz   `git archive` of that commit
#   $APP_ROOT/shared/.env.incoming   env rendered by the workflow from GitHub secrets
#
# Contract: this script either leaves the new release serving traffic, or leaves the previous
# one serving traffic. A failure before the symlink flip (unpack, build, datastores, migrations)
# never touches what is live.
#
# Why the release is built HERE and not in CI: npm workspaces have no `pnpm deploy`-style prune,
# and `prisma migrate deploy` needs the prisma CLI + prisma.config.ts loader, which are
# devDependencies. A CI-built release would be the full ~800MB tree, built on the runner's Node
# rather than the box's. Building on the box ships ~2MB of source and matches the runtime exactly.
#
# Migrations run BEFORE the new code, so every migration must be compatible with the release
# currently serving — and they are forward-only, so a rollback restores code, not schema.

set -euo pipefail

readonly APP_ROOT="${APP_ROOT:-/srv/clickup-sync}"
readonly KEEP_RELEASES=3 # each release is ~800MB (full node_modules)

readonly SHA="${1:?usage: remote-deploy.sh <git-sha>}"
readonly RELEASES="$APP_ROOT/releases"
readonly SHARED="$APP_ROOT/shared"
readonly CURRENT="$APP_ROOT/current"
readonly NEW_RELEASE="$RELEASES/$SHA"
readonly TARBALL="$APP_ROOT/tmp/$SHA.src.tar.gz"
readonly ENV_FILE="$SHARED/.env"
readonly ENV_INCOMING="$SHARED/.env.incoming"
readonly ENV_PREV="$SHARED/.env.prev"
readonly ECOSYSTEM="$SHARED/ecosystem.config.cjs"
readonly WITH_ENV=(node "$SHARED/with-env.cjs" "$ENV_FILE")
readonly APPS=(clickup-sync-web clickup-sync-worker)
readonly WEB_URL="http://127.0.0.1:3200"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mFAIL: %s\033[0m\n' "$*" >&2; }

PREVIOUS_RELEASE=""
if [ -L "$CURRENT" ]; then
  PREVIOUS_RELEASE="$(readlink -f "$CURRENT")"
fi
readonly PREVIOUS_RELEASE

# Set once the incoming env has replaced the live one; a failure after that must put it back,
# or the NEXT pm2 restart (a crash, a reboot) would pick up config that never passed a deploy.
ENV_SWAPPED=0
restore_env() {
  if [ "$ENV_SWAPPED" = 1 ] && [ -f "$ENV_PREV" ]; then
    cp -p "$ENV_PREV" "$ENV_FILE"
    ENV_SWAPPED=0
    log "Restored previous shared/.env"
  fi
}

# ------------------------------------------------------------- preflight ----

log "Preflight for $SHA"
[ -f "$TARBALL" ] || { fail "source tarball not found: $TARBALL"; exit 1; }
[ -f "$ENV_INCOMING" ] || { fail "$ENV_INCOMING missing — the workflow renders it"; exit 1; }
if [ "$NEW_RELEASE" = "$PREVIOUS_RELEASE" ]; then
  fail "$SHA is already the live release — re-running it would delete what is serving"
  exit 1
fi

# The stored ClickUp token, webhook secret and Xero refresh token are encrypted with
# APP_ENCRYPTION_KEY. A different key does not fail loudly — it turns them into undecryptable
# garbage. GitHub secrets are write-only, so this is the one place a mismatch can be caught.
if [ -f "$ENV_FILE" ]; then
  SHARED_DIR="$SHARED" node - "$ENV_FILE" "$ENV_INCOMING" <<'NODE'
const { readEnvFile } = require(process.env.SHARED_DIR + '/env-file.cjs');
const [cur, inc] = process.argv.slice(2).map(readEnvFile);
const keys = [...new Set([...Object.keys(cur), ...Object.keys(inc)])].sort();
const changed = keys.filter((k) => cur[k] !== inc[k]);
console.log(changed.length ? `  env keys changing: ${changed.join(', ')}` : '  env unchanged');
if (cur.APP_ENCRYPTION_KEY && cur.APP_ENCRYPTION_KEY !== inc.APP_ENCRYPTION_KEY &&
    process.env.ALLOW_ENCRYPTION_KEY_CHANGE !== '1') {
  console.error('  APP_ENCRYPTION_KEY would change: stored secrets would become unreadable.');
  console.error('  Fix the GitHub secret, or re-run with ALLOW_ENCRYPTION_KEY_CHANGE=1 if intended.');
  process.exit(1);
}
NODE
fi

# ---------------------------------------------------------- unpack + build ----

log "Unpacking $SHA"
rm -rf "$NEW_RELEASE"
mkdir -p "$NEW_RELEASE"
tar -xzf "$TARBALL" -C "$NEW_RELEASE"
rm -f "$TARBALL"
echo "$SHA" > "$NEW_RELEASE/VERSION"

log "Building (npm ci, prisma generate, backend, dashboard)"
(
  cd "$NEW_RELEASE"
  # NODE_ENV=production would make `npm ci` drop the devDependencies the build and migrations need.
  unset NODE_ENV
  npm ci --no-audit --no-fund --loglevel=error
  # prisma.config.ts resolves env('DATABASE_URL'); generate never connects.
  DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public" npm run prisma:generate
  npm run build
  npm run build:web
)

# Check the shape before anything live is touched. npm 11 skips install scripts by default, and
# the migration engine arrives via @prisma/engines — assert it rather than trust it.
for f in dist/main.js apps/web/dist/index.html node_modules/.bin/prisma prisma.config.ts \
  prisma/schema.prisma prisma/migrations infra/vps/pm2/ecosystem.config.cjs \
  infra/vps/pm2/env-file.cjs infra/vps/pm2/with-env.cjs; do
  [ -e "$NEW_RELEASE/$f" ] || { fail "release is missing $f"; exit 1; }
done
compgen -G "$NEW_RELEASE/node_modules/@prisma/engines/schema-engine-*" >/dev/null \
  || { fail "release is missing the Prisma schema engine binary"; exit 1; }

# ------------------------------------------------------------ config swap ----

# These must outlive any single release (PM2 keeps the ecosystem path).
cp "$NEW_RELEASE"/infra/vps/pm2/*.cjs "$SHARED/"

if [ -f "$ENV_FILE" ]; then cp -p "$ENV_FILE" "$ENV_PREV"; fi
mv "$ENV_INCOMING" "$ENV_FILE"
chmod 600 "$ENV_FILE"
ENV_SWAPPED=1
trap 'restore_env' ERR

# ------------------------------------------------------------ datastores ----

# Root-owned unit (infra/vps/datastores). No-op when running; otherwise blocks until healthy.
log "Ensuring datastores are up"
sudo -n /usr/bin/systemctl start clickup-sync-datastores.service

# ------------------------------------------------------------ migrations ----

log "Applying migrations"
(cd "$NEW_RELEASE" && "${WITH_ENV[@]}" node_modules/.bin/prisma migrate deploy --config ./prisma.config.ts)

trap - ERR

# ------------------------------------------------------------ flip + boot ----

# Atomic: `mv -T` on a symlink is a single rename(2). `ln -sfn` alone unlinks first.
log "Pointing current -> releases/$SHA"
ln -sfn "$NEW_RELEASE" "$CURRENT.tmp"
mv -Tf "$CURRENT.tmp" "$CURRENT"

boot() {
  export APP_VERSION="$1"
  # --only: this PM2 daemon also runs toastly and timetrack, which a deploy must never touch.
  pm2 startOrReload "$ECOSYSTEM" --only "$(IFS=,; echo "${APPS[*]}")" --update-env
  pm2 save --force >/dev/null 2>&1 || true
}

log "Reloading PM2"
boot "$SHA"

# ------------------------------------------------------------- smoke test ----

wait_for_health() {
  local attempts="${1:-60}" body
  for i in $(seq 1 "$attempts"); do
    body="$(curl -fsS --max-time 3 "$WEB_URL/api/health" 2>/dev/null || true)"
    case "$body" in
      *'"status":"ok"'*) log "API healthy after ${i}s: $body"; return 0 ;;
    esac
    sleep 1
  done
  fail "API not healthy at $WEB_URL/api/health after ${attempts}s (last: ${body:-no response})"
  return 1
}

# Every app is online AND running from the release we just shipped. Without the path check, a
# stale PM2 process still on the previous release passes every HTTP probe.
apps_on_release() {
  local want="$1"
  pm2 jlist | node -e '
    const fs = require("node:fs");
    const [want, ...names] = process.argv.slice(1);
    const list = JSON.parse(fs.readFileSync(0, "utf8"));
    let ok = true;
    for (const name of names) {
      const procs = list.filter((p) => p.name === name);
      if (procs.length === 0) { console.error(`  ${name}: not in pm2`); ok = false; continue; }
      for (const p of procs) {
        const cwd = fs.realpathSync(p.pm2_env.pm_cwd);
        const status = p.pm2_env.status;
        const onRelease = cwd === fs.realpathSync(want);
        console.log(`  ${name}: ${status} ${cwd}`);
        if (status !== "online" || !onRelease) ok = false;
      }
    }
    process.exit(ok ? 0 : 1);
  ' "$want" "${APPS[@]}"
}

smoke_test() {
  wait_for_health 60 || return 1

  local spa
  spa="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$WEB_URL/" || true)"
  [ "$spa" = "200" ] || { fail "dashboard returned HTTP $spa"; return 1; }

  # Let a worker that crashes on boot (bad env, unreachable Redis) show itself before judging.
  sleep 15
  apps_on_release "$NEW_RELEASE" || { fail "a PM2 app is not online on $SHA"; return 1; }
  return 0
}

# ---------------------------------------------------------------- verdict ----

if smoke_test; then
  log "Deploy OK — $SHA is live"

  live="$(readlink -f "$CURRENT")"
  # shellcheck disable=SC2012  # names are git SHAs: no spaces or newlines
  ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
    old="${old%/}"
    [ "$(readlink -f "$old")" = "$live" ] && continue
    log "Pruning $(basename "$old")"
    rm -rf "$old"
  done
  exit 0
fi

# ------------------------------------------------------------- rollback ----

fail "Smoke test failed for $SHA"
for app in "${APPS[@]}"; do
  pm2 logs "$app" --lines 30 --nostream 2>/dev/null || true
done

if [ -z "$PREVIOUS_RELEASE" ] || [ ! -d "$PREVIOUS_RELEASE" ]; then
  fail "No previous release to roll back to — leaving $SHA in place for inspection."
  exit 1
fi

log "Rolling back to $(basename "$PREVIOUS_RELEASE")"
restore_env
ln -sfn "$PREVIOUS_RELEASE" "$CURRENT.tmp"
mv -Tf "$CURRENT.tmp" "$CURRENT"
cp "$PREVIOUS_RELEASE"/infra/vps/pm2/*.cjs "$SHARED/" 2>/dev/null || true
boot "$(basename "$PREVIOUS_RELEASE")"

if wait_for_health 60; then
  fail "Rolled back to $(basename "$PREVIOUS_RELEASE"). The bad release is at $NEW_RELEASE."
else
  fail "ROLLBACK ALSO FAILED — site is down, manual intervention required."
fi
exit 1
