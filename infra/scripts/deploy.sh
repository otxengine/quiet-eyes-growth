#!/usr/bin/env bash
# Deploy an environment from a clean checkout of a git ref, never from the working tree,
# so uncommitted work can't leak into a deploy. CDK asks for approval before any
# IAM or security-group change.
# Usage: [REF=<git-ref>] scripts/deploy.sh staging [extra cdk args, e.g. -c workerCount=1]
set -euo pipefail
ENV=${1:?usage: deploy.sh <env> [cdk args]}; shift
REF=${REF:-HEAD}
REGION=${AWS_REGION:-eu-central-1}
INFRA=$(cd "$(dirname "$0")/.." && pwd)
ROOT=$(git -C "$INFRA" rev-parse --show-toplevel)

# Public build-time values for this env (VITE_CLERK_PUBLISHABLE_KEY etc.). Not secrets.
if [ -f "$INFRA/.env.$ENV" ]; then set -a; . "$INFRA/.env.$ENV"; set +a; fi
: "${VITE_CLERK_PUBLISHABLE_KEY:?set it in infra/.env.$ENV}"

SRC=$(mktemp -d)/src
git -C "$ROOT" worktree add --detach "$SRC" "$REF" >/dev/null
trap 'git -C "$ROOT" worktree remove --force "$SRC"' EXIT
echo "deploying $(git -C "$SRC" log -1 --format='%h %s') to $ENV"

(cd "$SRC" && npm ci --no-audit --no-fund && VITE_API_URL=/api npm run build && bash scripts/scan-bundle-keys.sh dist)
(cd "$INFRA" && SRC_DIR="$SRC" AWS_REGION="$REGION" npx cdk deploy "Qe-$ENV" "$@")
