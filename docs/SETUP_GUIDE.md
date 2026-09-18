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

Production runs on the shared BDIX VPS: the host Caddy terminates TLS and proxies to the app under
PM2 (`clickup-sync-web` + `clickup-sync-worker`), with Postgres and Redis in Docker on loopback.

CI/CD: push to `main` → GitHub Actions runs lint, tests and e2e → SSHes to the VPS, builds the
release there, migrates, flips, reloads PM2, smoke-tests, and rolls back on failure. Details:
`docs/DEPLOYMENT.md`.

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

## Part B — Production deploy

Production runs on the shared BDIX VPS (PM2 + host Caddy, Postgres/Redis in Docker) and is
deployed automatically on every push to `main`. The box setup, GitHub secrets, pipeline and
day-2 commands are all in **`docs/DEPLOYMENT.md`** — that file is the source of truth.

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

## Part E — CI/CD and day-2 operations

See **`docs/DEPLOYMENT.md`** (Continuous deployment, Day-2 operations, Troubleshooting).

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| API container restarts / exits immediately | Boot-gate failure. `logs api` shows `Invalid environment` — usually missing `APP_ENCRYPTION_KEY` or `ADMIN_API_KEY` < 32 chars (both required in production). |
| Saving the API token returns "APP_ENCRYPTION_KEY is not configured" | The encryption key isn't set on the server. Add `APP_ENCRYPTION_KEY=$(openssl rand -hex 32)` and restart, then save again. |
| `password authentication failed` for `clickup` | `POSTGRES_PASSWORD` and the password inside `DATABASE_URL` don't match. They must be identical. |
| Changed `POSTGRES_PASSWORD` but auth still fails | The Postgres volume was already initialised with the old password. Run `ALTER USER` inside the DB (see `docs/DEPLOYMENT.md`). |
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
- [ ] Postgres/Redis are published on 127.0.0.1 only (`infra/vps/datastores/`).
- [ ] HTTPS works (Caddy) before the ClickUp webhook is pointed at the domain.
- [ ] Webhook signature verification is active (secret set via dashboard Register webhook, or env).
- [ ] `APP_ENCRYPTION_KEY` is set (required in prod) and backed up — losing it makes stored secrets unrecoverable.
- [ ] SSH uses key-only auth; the deploy key is dedicated to this repo.
- [ ] Regular database backups are scheduled.
- [ ] Grafana (if connected) uses read-only database credentials.

