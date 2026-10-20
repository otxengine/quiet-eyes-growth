#!/usr/bin/env bash
# Copy the Render backend's environment into infra/.env.prod-secrets (gitignored, owner-only)
# for put-secrets.sh, and print only the variable NAMES, for secrets.prod.txt.
# Needs a Render API key: Render dashboard -> Account Settings -> API Keys.
# Usage: RENDER_API_KEY=... infra/scripts/export-render-env.sh
set -euo pipefail
: "${RENDER_API_KEY:?create one in Render > Account Settings > API Keys}"
SERVICE=${SERVICE:-srv-d92gsueq1p3s73fp9tk0} # quiet-eyes-growth_DEV_BE
INFRA=$(cd "$(dirname "$0")/.." && pwd)
OUT="$INFRA/.env.prod-secrets"

# Provided by the CDK stack, replaced by RDS or the task role, or removed from the code.
SKIP='^(DATABASE_URL|DIRECT_URL|PORT|NODE_ENV|ROLE|TRUST_PROXY_HOPS|FRONTEND_URL|SERVER_BASE_URL|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_REGION|AWS_S3_BUCKET|AWS_S3_REGION|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)$'

umask 077
curl -fsS -H "Authorization: Bearer $RENDER_API_KEY" -H 'Accept: application/json' \
  "https://api.render.com/v1/services/$SERVICE/env-vars?limit=100" \
  | jq -r --arg skip "$SKIP" '.[].envVar | select(.key | test($skip) | not) | "\(.key)=\(.value)"' > "$OUT"

echo "wrote $(grep -c . "$OUT") variables to $OUT (values not shown). Names:"
cut -d= -f1 "$OUT" | sort
