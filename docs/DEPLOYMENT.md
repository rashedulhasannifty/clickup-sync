# Deployment — BDIX VPS (PM2 + host Caddy)

Production (`https://log.niftyitsolution.com`) runs on the shared BDIX VPS, next to Toastie,
TimeTrack and ChineseShop, using the same pattern as TimeTrack:

```
            Internet ── Cloudflare (proxied) ── 443
                                                 │
                              ┌──────────────────▼──────────────────┐
                              │ host Caddy (systemd, shared by all  │
                              │ apps on the box, owns 80/443, TLS)  │
                              └──────────────────┬──────────────────┘
                                                 │ 127.0.0.1:3200
     PM2 (user deploy) ┌─────────────────────────▼─┐   ┌──────────────────────────┐
                       │ clickup-sync-web          │   │ clickup-sync-worker      │
                       │ ROLE=web: SPA at /,       │   │ ROLE=worker: BullMQ      │
                       │ API + webhooks at /api    │   │ processors + cron        │
                       └─────────────┬─────────────┘   └────────────┬─────────────┘
                                     │  loopback only                │
     Docker (root, systemd)   ┌──────▼──────────────┐   ┌────────────▼────────────┐
     clickup-sync-datastores  │ Postgres 127.0.0.1: │   │ Redis 127.0.0.1:6380    │
                              │ 5433                │   │ (noeviction, AOF)       │
                              └─────────────────────┘   └─────────────────────────┘
```

Only the stateful services run in Docker. The `deploy` user has no Docker access on purpose (the
docker group is root-equivalent); it can only `sudo systemctl start clickup-sync-datastores`.

| Thing | Where |
|---|---|
| Releases | `/srv/clickup-sync/releases/<sha>`, `current` → live one (last 3 kept) |
| Runtime env | `/srv/clickup-sync/shared/.env` (rendered by CI from GitHub secrets) |
| PM2 config | `/srv/clickup-sync/shared/ecosystem.config.cjs` (from `infra/vps/pm2/`) |
| Datastores | `/opt/clickup-sync/` (from `infra/vps/datastores/`), unit `clickup-sync-datastores.service` |
| Caddy | `log.niftyitsolution.com` block in `/etc/caddy/Caddyfile` (from `infra/vps/caddy/`) |

Everything under `infra/vps/` is the versioned copy of what lives on the box.

---

## Continuous deployment

Every push to `main` runs `.github/workflows/deploy.yml`:

1. **quality** — `npm ci`, `prisma generate`, lint, unit tests, backend + dashboard build.
2. **e2e** — e2e suite against real Postgres + Redis.
3. **deploy** (only if both pass):
   - renders `shared/.env.incoming` from GitHub secrets and pipes it over SSH;
   - uploads `git archive` of the commit (~2 MB) and `infra/vps/remote-deploy.sh`;
   - runs `remote-deploy.sh <sha>` on the box as `deploy`.

`remote-deploy.sh` either leaves the new release serving, or the previous one:

1. **Preflight** — refuses to redeploy the live SHA; compares the incoming env with the live one,
   prints which keys change, and **refuses if `APP_ENCRYPTION_KEY` would change** (stored ClickUp
   and Xero secrets would become undecryptable). Override with `ALLOW_ENCRYPTION_KEY_CHANGE=1`.
2. **Build on the box** — `npm ci`, `prisma generate`, `build`, `build:web` in the new release dir,
   then asserts the release shape (incl. the Prisma schema engine).
   Built here rather than in CI because npm workspaces can't prune to a production tree and
   migrations need the dev-only prisma CLI; building on the box also matches its Node exactly.
3. Swaps in the new `.env` (previous kept as `.env.prev`), refreshes the PM2 helper files.
4. Starts the datastores unit (no-op if running) and runs `prisma migrate deploy`.
5. Atomically flips `current`, `pm2 startOrReload --only clickup-sync-web,clickup-sync-worker`
   (never touches the other apps' processes).
6. **Smoke test** — `/api/health` reports ok, `/` returns 200, and both PM2 apps are online *from
   the new release dir*.
7. Pass → prune old releases. Fail → restore `.env.prev`, flip back, reload the previous release.

Failures before the flip (build, datastores, migrations) never touch what's live. Migrations are
forward-only: a rollback restores code, not schema, so keep migrations backward-compatible
(expand now, contract in a later deploy).

A deploy takes ~5 minutes; the web process reloads with zero downtime (cluster mode), the worker
restarts (finishing its active job, 30s grace).

**Manual deploy / re-deploy / rollback:** Actions → Deploy → *Run workflow*, choosing the branch
or ref. Rolling back = running it at the previous good commit (a SHA that is already live is
refused).

### GitHub secrets

| Secret | Value |
|---|---|
| `SSH_HOST` | `144.79.124.51` |
| `SSH_PORT` | `22` |
| `SSH_USER` | `deploy` |
| `SSH_KEY` | private key whose public half is in `/home/deploy/.ssh/authorized_keys` |
| `DEPLOY_PATH` | `/srv/clickup-sync` |
| `DATABASE_URL` | credentials + database name; host/port are rewritten to `127.0.0.1:5433` by the workflow, which also derives `POSTGRES_USER`/`POSTGRES_DB` from it |
| `POSTGRES_PASSWORD` | must equal the password inside `DATABASE_URL` |
| `APP_ENCRYPTION_KEY`, `ADMIN_API_KEY` | required in production (boot gate) |
| `APP_BASE_URL`, `ALLOWED_ORIGINS` | `https://log.niftyitsolution.com` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | invitation email |
| `WEBHOOK_AUTOHEAL_ENABLED` | optional; omitted from `.env` when unset |
| `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` | optional, both or neither |

`REDIS_URL` is fixed (`redis://127.0.0.1:6380`) and not a secret. `DOMAIN` and `REDIS_URL`
secrets are unused leftovers from the old AWS host.

To change a runtime setting: update the GitHub secret, then re-run the Deploy workflow. Editing
`shared/.env` by hand works until the next deploy overwrites it.

---

## One-time box setup (already done — for rebuilding the box)

As root on an Ubuntu host that already has Docker, Node 24, PM2 (`pm2-deploy` service), Caddy and
a `deploy` user:

```bash
# Datastores
mkdir -p /opt/clickup-sync
cp infra/vps/datastores/docker-compose.datastores.yml infra/vps/datastores/datastores-env.sh /opt/clickup-sync/
chmod 700 /opt/clickup-sync/datastores-env.sh
cp infra/vps/datastores/clickup-sync-datastores.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable clickup-sync-datastores   # starts after the first deploy writes .env

# App dirs
install -d -o deploy -g deploy /srv/clickup-sync /srv/clickup-sync/releases /srv/clickup-sync/tmp
install -d -m 700 -o deploy -g deploy /srv/clickup-sync/shared
cp infra/vps/pm2/*.cjs /srv/clickup-sync/shared/ && chown deploy:deploy /srv/clickup-sync/shared/*

# Let deploy start the datastores (and nothing else)
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl start clickup-sync-datastores.service' > /etc/sudoers.d/clickup-sync
chmod 440 /etc/sudoers.d/clickup-sync && visudo -c

# Caddy (back up first)
cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%Y%m%d-%H%M%S)
cat infra/vps/caddy/clickup-sync.caddy >> /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy
```

Then add the CI public key to `/home/deploy/.ssh/authorized_keys` and run the Deploy workflow.

**TLS behind Cloudflare:** the first certificate can't be issued while the record is proxied
(Cloudflare upgrades the HTTP challenge to HTTPS, and the origin has no cert yet → 525). Issue it
with the record on *DNS only*, then switch back to *Proxied*; renewals work while proxied because
Caddy answers the challenge over HTTPS once it has a certificate.

**ClickUp / Xero:** the ClickUp token, team, webhook URL and signing secret are stored encrypted in
the DB and managed from the dashboard (Settings → Connection → Register webhook). The Xero redirect
URI is `${APP_BASE_URL}/api/xero/callback`.

---

## Day-2 operations

As `deploy` on the box (`su - deploy` from root):

```bash
pm2 ls                                   # status (clickup-sync-web / clickup-sync-worker)
pm2 logs clickup-sync-web --lines 100
pm2 logs clickup-sync-worker --lines 100
pm2 reload clickup-sync-web              # zero-downtime restart
pm2 restart clickup-sync-worker
curl -s http://127.0.0.1:3200/api/health

# One-off script with the production env (e.g. the sub-projects backfill)
cd /srv/clickup-sync/current
node /srv/clickup-sync/shared/with-env.cjs /srv/clickup-sync/shared/.env \
  node dist/scripts/backfill-sub-projects.js --dry-run
```

As root:

```bash
systemctl status clickup-sync-datastores
docker compose --env-file /opt/clickup-sync/datastores.env \
  -f /opt/clickup-sync/docker-compose.datastores.yml ps
docker exec -it clickup-sync-postgres-1 psql -U clickup -d clickup_sync
```

### Database backups

```bash
docker exec clickup-sync-postgres-1 pg_dump -U clickup -d clickup_sync -Fc \
  > /root/clickup-sync-$(date +%F).dump
# restore into an empty database:
docker exec -i clickup-sync-postgres-1 pg_restore -U clickup -d clickup_sync --no-owner < file.dump
```

No scheduled backup exists yet — TimeTrack's `timetrack-backup.timer` is the model to copy.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Deploy fails at "Preflight" with `APP_ENCRYPTION_KEY would change` | The GitHub secret differs from the live key. Fix the secret; only override if you really are rotating the key (stored secrets must then be re-entered). |
| Deploy fails during build | Look at the job log; nothing live was touched. The half-built release dir is replaced on the next deploy. |
| Deploy rolled back after smoke test | The job log prints the last 30 PM2 log lines of each app. Usually a boot-gate env problem (`Invalid environment`). |
| 525 from Cloudflare | Caddy has no certificate for the host — see *TLS behind Cloudflare* above; `journalctl -u caddy`. |
| 502 from Cloudflare/Caddy | `clickup-sync-web` is down: `pm2 ls`, `pm2 logs clickup-sync-web`. |
| `password authentication failed` | `POSTGRES_PASSWORD` and the password in `DATABASE_URL` differ, or the volume was initialised with an older password (`ALTER USER` inside the DB). |
| SSH to the box suddenly refused | fail2ban banned your IP after failed password attempts. Use key auth with `BatchMode=yes`; bans lift after ~10 min. |

## Security checklist

- [ ] `ADMIN_API_KEY` ≥ 32 chars and `APP_ENCRYPTION_KEY` set; the encryption key is backed up.
- [ ] Postgres/Redis published on 127.0.0.1 only (Docker-published ports bypass UFW).
- [ ] UFW allows only 22/80/443; port 3200 is not exposed.
- [ ] CI deploys as `deploy` (no Docker, one sudo rule), never root.
- [ ] Webhook signature verification active (secret stored via dashboard Register webhook).
- [ ] Regular database backups scheduled.
