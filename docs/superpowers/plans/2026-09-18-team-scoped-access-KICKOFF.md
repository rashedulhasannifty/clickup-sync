# Team-scoped access — kickoff prompt

How to start implementing `2026-09-18-team-scoped-access.md` on any machine.

## 1. Setup (shell)

```bash
cd clickup-sync
git fetch origin
git checkout feat/team-scoped-access
npm install
npm run dev:deps
npm run prisma:deploy
```

`.env` needs a real `CLICKUP_API_TOKEN`, and the local database should have
synced tasks: the backfill (Task 5) and the sync performance check (Task 5
Step 4b) need real data.

## 2. PR 1: paste into Claude Code

> Execute the implementation plan at `docs/superpowers/plans/2026-09-18-team-scoped-access.md`. Read the spec it links (`docs/superpowers/specs/2026-09-18-team-scoped-access-design.md`) first.
>
> Use subagent-driven development: one subagent per task, review between tasks. Do **Tasks 1–14 only** (PR 1, backend scoping behind a feature flag that is off). Stop before Task 15 and report back.
>
> Important context:
> - Work on branch `feat/team-scoped-access`. Never push to `main`: pushing to `main` auto-deploys to production.
> - Two git remotes: `origin` = work repo `rashedulhasannifty/clickup-sync` (push here), `upstream` = personal fork. Always pass `-R rashedulhasannifty/clickup-sync` to `gh`.
> - One-off scripts must live under `src/scripts/` so they ship in `dist/`.
> - Prod host has 1.9 GB RAM. Don't skip the sync performance check in Task 5 Step 4b.
> - Run `npm run lint && npm run test && npm run build` before each commit.
> - Commit after each task. Push the branch when Task 14 is done, but don't open the PR until I review.

## 3. PR 2: after PR 1 is reviewed

Use the same prompt, replacing "Tasks 1–14" with **"Tasks 15–19"** and
"Stop before Task 15" with **"Stop after Task 19"**. Also run the web checks
(`cd apps/web && npm run lint && npm run build`) before each commit.
