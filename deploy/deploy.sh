#!/usr/bin/env bash
# Zero-downtime-ish deploy on the VPS: run from the repo root.
#   ./deploy/deploy.sh            # deploy current branch
#   BRANCH=main ./deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
echo "→ updating $BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "→ installing"
pnpm install --frozen-lockfile

echo "→ database migrations"
pnpm db:generate
pnpm db:deploy

echo "→ building"
pnpm --filter @swellfi/api build
pnpm --filter @swellfi/web build

echo "→ reloading PM2"
# startOrReload also starts apps added to the file since the last deploy (e.g. the indexer).
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save

echo "→ health"
sleep 3
curl -fsS http://127.0.0.1:4000/api/health && echo
