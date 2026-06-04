# ClickUp Sync — Full Setup & Deployment Guide

End-to-end guide: local development → production deployment on an Ubuntu server → automated CI/CD. Everything is in this one file.

**Contents**

1. [What this is & how it runs](#1-what-this-is--how-it-runs)
2. [Prerequisites](#2-prerequisites)
3. [Part A — Local development](#part-a--local-development)
4. [Part B — Production deploy (Docker Compose + Caddy)](#part-b--production-deploy-docker-compose--caddy)
5. [Part C — Register the ClickUp webhook](#part-c--register-the-clickup-webhook)
6. [Part D — First data load (backfill)](#part-d--first-data-load-backfill)
7. [Part E — CI/CD with GitHub Actions](#part-e--cicd-with-github-actions)
8. [Day-2 operations](#day-2-operations)
9. [Troubleshooting](#troubleshooting)
10. [Security checklist](#security-checklist)

---

## 1. What this is & how it runs

A NestJS service that syncs ClickUp tasks and tracked time into PostgreSQL, with a React dashboard. It uses Redis + BullMQ for queues and Prisma for the database.

A single Node process serves two things:

- **Dashboard** at `/` (static, built from `apps/web`)
- **API + webhooks** under `/api` — webhook is `POST /api/webhooks/clickup`, health is `GET /api/health`, Swagger is at `/docs`

Production architecture on one server:

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
       postgres │        │ redis        (internal only — never exposed to host)
        ┌───────▼──┐  ┌──▼───────┐
        │ postgres │  │  redis   │
        └──────────┘  └──────────┘
```

CI/CD: push to `main` → GitHub Actions runs tests + builds → pushes a Docker image to GHCR → SSHes to the server and pulls + restarts.

---

## 2. Prerequisites

- **An Ubuntu server** (22.04 / 24.04) with a public IP and sudo access.
- **A domain name** (e.g. `clickup-sync.example.com`) — required, because ClickUp webhooks only work over valid HTTPS.
- **A ClickUp service-account API token** — a **Workspace Owner/Admin** token (`pk_…`). A normal member token cannot write time entries on behalf of other assignees.
- **ClickUp Team ID** (default in this repo: `3450636`).
- For local dev: **Node.js ≥ 22**, **Docker** + Docker Compose.
- For CI/CD: the repo on **GitHub** (`rashedulhasansojib/clickup-sync`).

Generate the secrets you'll need now (keep them handy):

```bash
openssl rand -hex 32    # ADMIN_API_KEY (must be >= 32 chars)
openssl rand -hex 24    # POSTGRES_PASSWORD
```

---

## Part A — Local development

Run this on your laptop to develop/test before deploying.

```bash
git clone git@github.com:rashedulhasansojib/clickup-sync.git
cd clickup-sync
cp .env.example .env

npm install              # installs backend + web workspace deps
npm run dev:deps         # starts local Postgres (:5433) + Redis (:6379) via Docker
npm run prisma:generate  # generate the Prisma client
npm run prisma:deploy    # apply migrations to the local DB
```

Run the app (two options):

```bash
# Backend only:
npm run start:dev

# Backend + dashboard together (hot reload both):
npm run dev:all
```

Open:

- `http://localhost:3000/api/health` — should return `{"status":"ok",...}`
- `http://localhost:3000/docs` — Swagger UI
- The dashboard dev server prints its own URL (Vite, usually `http://localhost:5173`)

> The dev `.env` defaults work as-is for local Postgres/Redis. `NODE_ENV=development` relaxes the production boot gate (see Part B), so you don't need a webhook secret to run locally.

Quality checks:

```bash
npm run test       # 189 unit tests
npm run build      # compile backend
npm run build:web  # build dashboard
# NOTE: `npm run lint` currently fails (no root ESLint flat config) — see Troubleshooting.
```

---

## Part B — Production deploy (Docker Compose + Caddy)

### B.1 — Prepare the server (one time)

SSH into the server, install Docker, and lock the firewall to HTTP/HTTPS + SSH.

```bash
# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER     # then log out and back in so the group applies

# Firewall
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

> ⚠️ Docker publishes container ports via iptables rules that **bypass ufw**. This stack only publishes 80/443 (Caddy); Postgres and Redis are internal-only. Never add `ports:` for postgres/redis in production.

### B.2 — DNS

Create an **A record** for your domain pointing at the server's public IP:

```
clickup-sync.example.com.   A   <server-public-ip>
```

Verify it resolves (Caddy can't issue a TLS certificate until it does):

```bash
dig +short clickup-sync.example.com
```

### B.3 — Get the code and configure `.env`

```bash
git clone git@github.com:rashedulhasansojib/clickup-sync.git
cd clickup-sync
cp .env.example .env
nano .env
```

Minimum production values:

```env
NODE_ENV=production
PORT=3000

# Internal service names + internal port 5432 (NOT localhost:5433).
# The password here MUST equal POSTGRES_PASSWORD below.
DATABASE_URL=postgresql://clickup:<POSTGRES_PASSWORD>@postgres:5432/clickup_sync?schema=public
REDIS_URL=redis://redis:6379

# ClickUp connection — these can be left blank and configured later from the
# dashboard (Settings → Connection). They are only the initial fallback.
CLICKUP_API_TOKEN=
CLICKUP_TEAM_ID=3450636
CLICKUP_WEBHOOK_ENDPOINT=https://clickup-sync.example.com/api/webhooks/clickup
CLICKUP_WEBHOOK_SECRET=            # usually set from the dashboard (Register webhook)
CLICKUP_WEBHOOK_EVENTS=taskCreated,taskUpdated,taskDeleted,taskTimeTrackedUpdated,taskStatusUpdated
CLICKUP_AGENCY_USER_ID=3584055

ADMIN_API_KEY=<openssl rand -hex 32 output>
# Encrypts settings secrets (ClickUp token, webhook secret) at rest. REQUIRED in production.
APP_ENCRYPTION_KEY=<openssl rand -hex 32 output>

# Production deploy vars (used by docker-compose.prod.yml / Caddy)
DOMAIN=clickup-sync.example.com
POSTGRES_PASSWORD=<openssl rand -hex 24 output>
```

> **Two places, one password:** `POSTGRES_PASSWORD` initialises the Postgres container, and the *same value* must appear inside `DATABASE_URL`. If they differ, the API can't connect.

> ⚠️ **Production boot gate:** with `NODE_ENV=production`, the app **refuses to start** unless `APP_ENCRYPTION_KEY` (≥ 32 chars) **and** `ADMIN_API_KEY` (≥ 32 chars) are set (enforced in `src/config/env.validation.ts`). The ClickUp token/team/webhook are **not** required at boot — configure them from the dashboard after first launch.

### B.4 — ClickUp connection

You can configure ClickUp **entirely from the dashboard** after the stack is up (recommended): Settings → Connection → enter the API token + team ID → **Save**, then **Register webhook** (stores the signing secret encrypted, no restart). See Part C for that flow, or for the pre-boot `curl` alternative. You don't need to do anything here before starting.

### B.5 — Build and start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

This builds the image (backend **and** dashboard), starts Postgres/Redis, waits for them to be healthy, runs `prisma migrate deploy` (creates the schema), starts the API, and brings up Caddy (which provisions TLS on first request).

Watch it come up:

```bash
docker compose -f docker-compose.prod.yml logs -f api caddy
```

### B.6 — Verify

```bash
curl https://clickup-sync.example.com/api/health     # {"status":"ok",...}
curl -I https://clickup-sync.example.com/            # 200, HTML dashboard
```

In a browser:

- `https://clickup-sync.example.com/` → dashboard loads
- `https://clickup-sync.example.com/docs` → Swagger UI
- Paste your `ADMIN_API_KEY` in the dashboard when prompted (stored in the browser) to use admin features

---

## Part C — Configure ClickUp & register the webhook

The ClickUp token, team ID, webhook URL, and signing secret are stored in the database and managed from the dashboard. Pick one option.

### Option A (recommended) — configure from the dashboard

1. Open `https://clickup-sync.example.com/` and enter your `ADMIN_API_KEY` when prompted.
2. Go to **Settings → Connection**. Enter the **API token** (Workspace Owner/Admin, `pk_…`), the **Team / Workspace ID**, and the **webhook Endpoint URL** (`https://<domain>/api/webhooks/clickup`). Click **Save changes**.
3. Click **Test connection** to confirm the token + team are valid.
4. Click **Register webhook**. This creates the webhook in ClickUp and **stores the returned signing secret encrypted** in the database — no `.env` edit, no restart.

That's it — the secret persists in `app_settings`, so signature verification works immediately and survives restarts. (Requires `APP_ENCRYPTION_KEY` set on the server, which is already required in production.)

### Option B — register directly against ClickUp's API (pre-boot / CI/CD)

Use this when you'd rather seed the secret via env (e.g. before first boot, or in a fully scripted deploy). No running app needed:

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

ClickUp retries deliveries until the endpoint is live, so registering before the app is up is fine. Copy `webhook.secret` into `.env` as `CLICKUP_WEBHOOK_SECRET=…` and start the stack.

> Either way, incoming webhooks are rejected by signature verification until a secret exists (in the DB or env) — so register before relying on real-time sync. Under CI/CD, the app now boots fine without a secret, so you can simply use **Option A (dashboard)** after the first deploy.

---

## Part D — First data load (backfill)

Webhooks only capture changes from now on. To pull in existing tasks, trigger a backfill per space (spaces + lookback windows live in `src/config/clickup-spaces.config.ts`):

```bash
curl -s -X POST "https://clickup-sync.example.com/api/admin/backfill" \
  -H "x-admin-key: <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{ "spaceId": "3577824", "lookbackDays": 90 }'
```

`lookbackDays` is optional (defaults to the space's configured window). Only allowlisted spaces are accepted unless you pass `"allowUnknownSpaces": true`.

Default spaces:

| Space | ID | Default lookback |
|---|---:|---:|
| Digital Marketing | `3577824` | 90 days |
| R&D Apps | `3589129` | 20 days |
| Projects | `3525433` | 35 days |

---

## Part E — CI/CD with GitHub Actions

`.github/workflows/deploy.yml` deploys automatically on every push to `main`:

1. **quality** — `npm ci`, `prisma generate`, `test`, `build`, `build:web`. A failure stops the deploy. (`npm run lint` is excluded for now — no root ESLint config; see Troubleshooting.)
2. **build-and-push** — builds the Docker image and pushes it to GHCR as `ghcr.io/rashedulhasansojib/clickup-sync:latest` and `:<commit-sha>`.
3. **deploy** — copies `docker-compose.prod.yml` + `Caddyfile` to the server, then SSHes in, pulls the new image (pinned to the commit SHA), and restarts via `docker compose up -d`.

The server only **pulls** a prebuilt image — it never rebuilds — so deploys are fast and the server stays light. Migrations still run at container start.

### E.1 — One-time server setup for CD

On the server (in addition to Part B):

- Docker installed, and the deploy user is in the `docker` group: `sudo usermod -aG docker <user>`
- A deploy directory exists (this becomes `DEPLOY_PATH`) containing your production **`.env`** (with `ADMIN_API_KEY` + `APP_ENCRYPTION_KEY` set; ClickUp settings can be configured from the dashboard after the first deploy). The workflow keeps `docker-compose.prod.yml` and `Caddyfile` in sync there — you only maintain `.env`.
- An SSH keypair for the deploy user:
  ```bash
  ssh-keygen -t ed25519 -C "clickup-sync-deploy" -f deploy_key
  # Append deploy_key.pub to ~/.ssh/authorized_keys on the server (for the deploy user).
  # The PRIVATE key (deploy_key) goes into the SSH_KEY secret below.
  ```

### E.2 — GitHub repository secrets

In GitHub → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `SSH_HOST` | Server IP or hostname |
| `SSH_USER` | Deploy user (must be in the `docker` group) |
| `SSH_KEY` | Private SSH key (the `deploy_key` contents) |
| `SSH_PORT` | SSH port (e.g. `22`) |
| `DEPLOY_PATH` | Absolute path to the deploy dir, e.g. `/home/deploy/clickup-sync` |

`GITHUB_TOKEN` is provided automatically — it pushes to GHCR and is forwarded (job-scoped, ephemeral) into the SSH session to pull the image. **No long-lived registry credential lives on the server.** The GHCR package stays private and accessible via the repo's token.

### E.3 — First CD deploy

Make sure the server has Docker, the deploy user, `DEPLOY_PATH`, and `.env` ready (with the webhook secret registered via **Part C Option A**). Then push to `main` (or run the workflow manually from the **Actions** tab → **Deploy** → **Run workflow**). The pipeline handles compose/Caddyfile copy, image build/push, pull, and start.

> Watch the first run in the **Actions** tab — the deploy job (scp → ssh → GHCR pull → `compose up`) can only be fully verified on a real run with the secrets set.

---

## Day-2 operations

### Update / redeploy

- **With CI/CD:** just push to `main`. Done.
- **Manual (pull the latest image):**
  ```bash
  cd <DEPLOY_PATH>
  IMAGE_TAG=latest docker compose -f docker-compose.prod.yml pull api
  IMAGE_TAG=latest docker compose -f docker-compose.prod.yml up -d
  ```
- **Manual (build on the server from source):**
  ```bash
  git pull
  docker compose -f docker-compose.prod.yml up -d --build
  ```

Migrations run automatically on API start; `prisma migrate deploy` is idempotent.

### Rollback

Images are tagged per commit. Pin a previous SHA on the server:

```bash
cd <DEPLOY_PATH>
IMAGE_TAG=<previous-commit-sha> docker compose -f docker-compose.prod.yml up -d
```

### Logs & status

```bash
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml ps        # status + health
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

### Stop / restart

```bash
docker compose -f docker-compose.prod.yml restart api
docker compose -f docker-compose.prod.yml down       # stop (keeps data volumes)
```

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| API container restarts / exits immediately | Boot-gate failure. `logs api` shows `Invalid environment` — usually missing `APP_ENCRYPTION_KEY` or `ADMIN_API_KEY` < 32 chars (both required in production). |
| Saving the API token returns "APP_ENCRYPTION_KEY is not configured" | The encryption key isn't set on the server. Add `APP_ENCRYPTION_KEY=$(openssl rand -hex 32)` and restart, then save again. |
| `password authentication failed` for `clickup` | `POSTGRES_PASSWORD` and the password inside `DATABASE_URL` don't match. They must be identical. |
| Changed `POSTGRES_PASSWORD` but auth still fails | The Postgres volume was already initialised with the old password. Fresh box: `docker compose -f docker-compose.prod.yml down -v` (⚠️ deletes data), or `ALTER USER` inside the DB. |
| Caddy keeps retrying / no certificate | DNS A record not pointing at the server, or ports 80/443 blocked. Check `dig +short DOMAIN` and `ufw status`. |
| `502 Bad Gateway` from Caddy | API not healthy yet (still migrating/booting) or crashed. Check `logs api`. |
| Webhooks rejected (signature) | `CLICKUP_WEBHOOK_SECRET` doesn't match what ClickUp issued. Re-register (Part C) and update `.env`, then `up -d api`. |
| Dashboard 404 / blank at `/` | Image built without the web frontend. Rebuild with `--build`; confirm the Dockerfile `build` stage ran `npm run build:web` and the runner copied `apps/web/dist`. |
| `npm run lint` fails | **Known:** the backend has no root `eslint.config.js` (ESLint 10 requires a flat config). Only `apps/web` is configured. CI excludes lint. To enable: add a root flat config + `typescript-eslint`/`@eslint/js` to root devDeps, fix violations, then uncomment the step in `deploy.yml`. |
| CI fails at `npm ci` | Lockfile out of sync. Run `npm install` locally, commit the updated `package-lock.json`. |
| CD deploy can't pull image | Deploy job needs `packages: read` (set) and the GHCR package must belong to the repo (it does after the first push). Re-run after a successful `build-and-push`. |

---

## Security checklist

- [ ] `ADMIN_API_KEY` is a strong random value (≥ 32 chars), kept secret.
- [ ] `CLICKUP_API_TOKEN` is a dedicated service-account token, never committed.
- [ ] `.env` is not in git (it's git-ignored) and not baked into the image (`.dockerignore` excludes it).
- [ ] Postgres/Redis are internal-only (no `ports:` in `docker-compose.prod.yml`).
- [ ] HTTPS works (Caddy) before the ClickUp webhook is pointed at the domain.
- [ ] Webhook signature verification is active (secret set via dashboard Register webhook, or env).
- [ ] `APP_ENCRYPTION_KEY` is set (required in prod) and backed up — losing it makes stored secrets unrecoverable.
- [ ] SSH uses key-only auth; the deploy key is dedicated to this repo.
- [ ] Regular database backups are scheduled.
- [ ] Grafana (if connected) uses read-only database credentials.

