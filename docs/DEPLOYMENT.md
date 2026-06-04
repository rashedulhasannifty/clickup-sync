# Deployment — Ubuntu server with Docker Compose + Caddy

This guide deploys the whole stack on a single Ubuntu server using Docker Compose:

```
                 Internet
                    │  443 (HTTPS)
            ┌───────▼────────┐
            │     Caddy      │  automatic Let's Encrypt TLS
            └───────┬────────┘
                    │  api:3000 (internal network only)
            ┌───────▼────────┐
            │   api (NestJS) │  dashboard at "/", API + webhooks at "/api"
            └───┬────────┬───┘
       postgres │        │ redis        (internal network only — not exposed to host)
        ┌───────▼──┐  ┌──▼───────┐
        │ postgres │  │  redis   │
        └──────────┘  └──────────┘
```

Everything runs from `docker-compose.prod.yml`. Postgres and Redis are **not** published to the host (only Caddy publishes 80/443), so they can't be reached from outside the server.

> **Note on verification:** the Docker image build in this guide was authored but **not** run on the development machine (no Docker daemon there). Run `docker compose -f docker-compose.prod.yml build` on the server and watch it complete before relying on it — the npm-workspaces web build is the step most worth eyeballing.

---

## 0. What you need before starting

- An Ubuntu server (22.04 / 24.04) with a public IP and root/sudo access.
- A **domain name** (e.g. `clickup-sync.example.com`) — required, because ClickUp webhooks only work over valid HTTPS.
- A ClickUp **Workspace Owner/Admin service-account API token** (`pk_…`). A normal member token cannot write time entries on behalf of other assignees.
- Your ClickUp **Team ID** (default in this repo: `3450636`).

---

## 1. Prepare the server (one time)

SSH in, then install Docker and configure the firewall.

```bash
# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER     # then log out and back in so the group applies

# Firewall: allow SSH + HTTP/HTTPS only
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

> ⚠️ Docker publishes container ports via iptables rules that **bypass ufw**. This stack only publishes 80/443 (Caddy); Postgres and Redis are internal-only, so they stay private. Do not add `ports:` mappings for postgres/redis in production.

### DNS

Create an **A record** for your domain pointing at the server's public IP:

```
clickup-sync.example.com.   A   <server-public-ip>
```

Confirm it resolves before continuing (Caddy can't issue a certificate until it does):

```bash
dig +short clickup-sync.example.com
```

---

## 2. Get the code and configure `.env`

```bash
git clone <your-repo-url> clickup-sync
cd clickup-sync
cp .env.example .env
```

Generate secrets:

```bash
openssl rand -hex 32    # use for ADMIN_API_KEY  (must be >= 32 chars)
openssl rand -hex 24    # use for POSTGRES_PASSWORD
```

Edit `.env`. Minimum production set:

```env
NODE_ENV=production
PORT=3000

# Internal service names + internal port 5432 (NOT localhost:5433).
# The password here MUST equal POSTGRES_PASSWORD below.
DATABASE_URL=postgresql://clickup:<POSTGRES_PASSWORD>@postgres:5432/clickup_sync?schema=public
REDIS_URL=redis://redis:6379

# ClickUp connection — optional at boot; configurable from the dashboard later.
CLICKUP_API_TOKEN=
CLICKUP_TEAM_ID=3450636
CLICKUP_WEBHOOK_ENDPOINT=https://clickup-sync.example.com/api/webhooks/clickup
CLICKUP_WEBHOOK_SECRET=            # usually set from the dashboard (Register webhook)
CLICKUP_WEBHOOK_EVENTS=taskCreated,taskUpdated,taskDeleted,taskTimeTrackedUpdated,taskStatusUpdated
CLICKUP_AGENCY_USER_ID=3584055

ADMIN_API_KEY=<openssl rand -hex 32 output>
# Encrypts settings secrets at rest. REQUIRED in production.
APP_ENCRYPTION_KEY=<openssl rand -hex 32 output>

# Production deploy vars (used by docker-compose.prod.yml / Caddy)
DOMAIN=clickup-sync.example.com
POSTGRES_PASSWORD=<openssl rand -hex 24 output>
```

> **Two places, one password:** `POSTGRES_PASSWORD` initialises the Postgres container, and the same value must appear inside `DATABASE_URL`. If they differ, the API can't connect.

> ⚠️ **Boot gate:** when `NODE_ENV=production`, the app **refuses to start** unless `APP_ENCRYPTION_KEY` (≥ 32 chars) **and** `ADMIN_API_KEY` (≥ 32 chars) are set (enforced in `src/config/env.validation.ts`). The ClickUp token/team/webhook are **not** required at boot — set them from the dashboard (Settings → Connection) after first launch, or seed `.env` as in Step 3.

---

## 3. Configure ClickUp & register the webhook

The ClickUp token, team ID, webhook URL, and signing secret live in the database and are managed from the dashboard. Pick one option.

### Option A (recommended) — from the dashboard, after the stack is up

1. Open `https://<domain>/`, enter your `ADMIN_API_KEY`.
2. **Settings → Connection**: enter the API token, Team ID, and webhook Endpoint URL → **Save changes** → **Test connection**.
3. Click **Register webhook** — it creates the webhook in ClickUp and stores the signing secret **encrypted** in the DB. No `.env` edit, no restart.

(This requires `APP_ENCRYPTION_KEY` on the server, already required in production. You can do this after Step 4.)

### Option B — register directly against ClickUp's API (seed via env / scripted)

Use this to seed the secret into `.env` instead (e.g. fully scripted deploys). No app needed — run from anywhere, substituting your token, team ID, and domain:

```bash
curl -s -X POST "https://api.clickup.com/api/v2/team/3450636/webhook" \
  -H "Authorization: pk_your_service_account_token" \
  -H "Content-Type: application/json" \
  -d '{
    "endpoint": "https://clickup-sync.example.com/api/webhooks/clickup",
    "events": ["taskCreated","taskUpdated","taskDeleted","taskTimeTrackedUpdated","taskStatusUpdated"]
  }'
```

The response contains the secret:

```json
{ "id": "...", "webhook": { "id": "...", "secret": "abc123...", "endpoint": "...", "events": [...] } }
```

Copy `webhook.secret` into `.env`:

```env
CLICKUP_WEBHOOK_SECRET=abc123...
```

Then either set `CLICKUP_WEBHOOK_SECRET=abc123…` in `.env` before starting, or just proceed and use Option A from the dashboard once the app is up. (ClickUp retries deliveries until the endpoint is live, so registering before the app is up is fine.)

> Incoming webhooks are rejected by signature verification until a secret exists (DB or env) — register promptly. There is no production traffic during this window on a fresh deploy.

---

## 4. Build and start the stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

This builds the image (backend **and** dashboard), starts Postgres/Redis, waits for them to be healthy, runs `prisma migrate deploy` (creates the schema), starts the API, and brings up Caddy (which provisions TLS for your domain on first request).

Watch it come up:

```bash
docker compose -f docker-compose.prod.yml logs -f api caddy
```

Caddy's first TLS issuance takes a few seconds; if it loops, see Troubleshooting.

---

## 5. Verify

```bash
# Health (DB ping) — should return {"status":"ok",...}
curl https://clickup-sync.example.com/api/health

# Dashboard — should return the HTML shell
curl -I https://clickup-sync.example.com/
```

Then in a browser:

- Open `https://clickup-sync.example.com/` → the dashboard loads.
- Open `https://clickup-sync.example.com/docs` → Swagger UI.
- In the dashboard, paste your `ADMIN_API_KEY` when prompted (stored in the browser as `adminApiKey`) to use admin features.

Confirm webhook delivery: edit any task in ClickUp, then check it was ingested:

```bash
docker compose -f docker-compose.prod.yml logs --since 5m api | grep -i webhook
```

---

## 6. First data load (backfill)

Webhooks only capture changes from now on. To pull in existing tasks, trigger a backfill per space via the admin API (or the dashboard). Spaces and lookback windows are defined in `src/config/clickup-spaces.config.ts`:

```bash
curl -s -X POST "https://clickup-sync.example.com/api/admin/backfill" \
  -H "x-admin-key: <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{ "spaceId": "3577824", "lookbackDays": 90 }'
```

`lookbackDays` is optional — it defaults to the space's configured window. Only allowlisted spaces are accepted unless you pass `"allowUnknownSpaces": true`.

---

## Continuous deployment (GitHub Actions)

`.github/workflows/deploy.yml` deploys automatically on every push to `main`:

1. **quality** — `npm ci`, `prisma generate`, `test`, `build`, `build:web`. A failure here stops the deploy. (`npm run lint` is currently excluded — the backend has no root ESLint flat config, so it exits non-zero; add one and uncomment the step in `deploy.yml` to gate on it.)
2. **build-and-push** — builds the Docker image and pushes it to GHCR as `ghcr.io/rashedulhasansojib/clickup-sync:latest` and `:<commit-sha>`.
3. **deploy** — copies `docker-compose.prod.yml` + `Caddyfile` to the server, then SSHes in, pulls the new image (pinned to the commit SHA), and restarts via `docker compose up -d`.

The server is **not** rebuilt — it only pulls the prebuilt image, so deploys are fast and your server stays light. Migrations still run at container start (`prisma migrate deploy`, idempotent).

### One-time setup for CD

**On the server** (in addition to Steps 1–3 above):

- Docker installed, and the deploy user is in the `docker` group (`sudo usermod -aG docker <user>`).
- A deploy directory exists (this is `DEPLOY_PATH`) containing your production **`.env`** (with `ADMIN_API_KEY` + `APP_ENCRYPTION_KEY`; ClickUp settings can be configured from the dashboard after deploy). The workflow keeps `docker-compose.prod.yml` and `Caddyfile` there in sync for you — you only maintain `.env`.
- An SSH keypair for the deploy user: add the **public** key to `~/.ssh/authorized_keys` on the server; the **private** key goes into the `SSH_KEY` repo secret below.

**In GitHub** → repo **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `SSH_HOST` | Server IP or hostname |
| `SSH_USER` | Deploy user (must be in the `docker` group) |
| `SSH_KEY` | Private SSH key (PEM) for that user |
| `SSH_PORT` | SSH port (e.g. `22`) |
| `DEPLOY_PATH` | Absolute path to the deploy dir, e.g. `/home/deploy/clickup-sync` |

`GITHUB_TOKEN` is provided automatically — it's used to push to GHCR and is forwarded (job-scoped, ephemeral) into the SSH session to pull the image. No long-lived registry credential lives on the server. The GHCR package stays private and accessible via the repo's token.

> First-ever deploy: make sure the server has Docker, the deploy user, `DEPLOY_PATH`, and `.env` ready. The workflow handles everything else (compose/Caddyfile copy, image pull, start). The ClickUp webhook secret must already be in `.env` — and on a fresh box you must use **Step 3 Option A (curl registration)**, not Option B: Option B needs a running app, but under CD the app first boots *via* the pipeline and won't start without the secret.

### Rollback

Images are tagged per commit. To roll back, pin a previous SHA on the server:

```bash
cd <DEPLOY_PATH>
IMAGE_TAG=<previous-commit-sha> docker compose -f docker-compose.prod.yml up -d
```

## Day-2 operations

### Manual update / redeploy (without CI)

```bash
cd <DEPLOY_PATH>
IMAGE_TAG=latest docker compose -f docker-compose.prod.yml pull api
IMAGE_TAG=latest docker compose -f docker-compose.prod.yml up -d
```

Or, to build on the server from source instead of pulling:

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Migrations run automatically on API start; `prisma migrate deploy` is idempotent.

### Logs

```bash
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml ps        # status + health
```

### Restart / stop

```bash
docker compose -f docker-compose.prod.yml restart api
docker compose -f docker-compose.prod.yml down       # stop (keeps named volumes/data)
```

### Database backups

Data lives in the `postgres_data` volume. Dump regularly (cron it):

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U clickup clickup_sync | gzip > backup-$(date +%F).sql.gz
```

Restore:

```bash
gunzip -c backup-YYYY-MM-DD.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres psql -U clickup clickup_sync
```

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| API container restarts / exits immediately | Boot-gate failure. Check `logs api` for `Invalid environment` — usually missing `APP_ENCRYPTION_KEY` or `ADMIN_API_KEY` < 32 chars (both required in prod). |
| `password authentication failed` for `clickup` | `POSTGRES_PASSWORD` and the password inside `DATABASE_URL` don't match. They must be identical. |
| Changed `POSTGRES_PASSWORD` but auth still fails | The Postgres volume was already initialised with the old password. For a fresh box: `docker compose -f docker-compose.prod.yml down -v` (⚠️ deletes data), or `ALTER USER` inside the DB. |
| Caddy keeps retrying / no certificate | DNS A record not pointing at the server yet, or ports 80/443 blocked. Verify `dig +short DOMAIN` and `ufw status`. |
| `502 Bad Gateway` from Caddy | API not healthy yet (still migrating/booting) or crashed. Check `logs api`. |
| Webhooks rejected (signature) | `CLICKUP_WEBHOOK_SECRET` doesn't match the secret ClickUp issued. Re-register (Step 3) and update `.env`, then `up -d api`. |
| Dashboard 404 / blank at `/` | Image built without the web frontend. Rebuild with `--build`; confirm the Dockerfile `build` stage ran `npm run build:web` and the runner copied `apps/web/dist`. |

---

## Security checklist (before going live)

- [ ] `ADMIN_API_KEY` is a strong random value (≥ 32 chars) and kept secret.
- [ ] `CLICKUP_API_TOKEN` is a dedicated service-account token, never committed.
- [ ] `.env` is not in git (it's git-ignored) and not baked into the image (`.dockerignore` excludes it).
- [ ] Postgres/Redis are internal-only (no `ports:` in `docker-compose.prod.yml`).
- [ ] HTTPS is working (Caddy) before the ClickUp webhook is pointed at the domain.
- [ ] Webhook signature verification is active (secret set via dashboard Register webhook, or env).
- [ ] `APP_ENCRYPTION_KEY` is set (required in prod) and backed up — losing it makes stored secrets unrecoverable.
- [ ] Regular database backups are scheduled.
- [ ] (Recommended) Use a non-default ClickUp space allowlist review and least-privilege DB user for Grafana if you connect one.
