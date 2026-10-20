#!/usr/bin/env bash
# Copy Render's environment for the AWS prod stack:
#   backend  -> infra/.env.prod-secrets (gitignored, owner-only) for put-secrets.sh
#   frontend -> infra/.env.prod (gitignored) with the public VITE_* build values for deploy.sh
# Prints only variable NAMES, never values.
# Needs a Render API key: Render dashboard -> Account Settings -> API Keys.
# Usage: RENDER_API_KEY=... infra/scripts/export-render-env.sh
set -euo pipefail
: "${RENDER_API_KEY:?create one in Render > Account Settings > API Keys}"
BE_SERVICE=${BE_SERVICE:-srv-d92gsueq1p3s73fp9tk0} # quiet-eyes-growth_DEV_BE
FE_SERVICE=${FE_SERVICE:-srv-d92gqnbtqb8s73ff94fg} # quiet-eyes-growth_DEV_FE
INFRA=$(cd "$(dirname "$0")/.." && pwd)

render_env() {
  curl -fsS -H "Authorization: Bearer $RENDER_API_KEY" -H 'Accept: application/json' \
    "https://api.render.com/v1/services/$1/env-vars?limit=100"
}

# Backend: skip what the CDK stack provides, what RDS or the task role replaces, and what the code no longer reads.
SKIP='^(DATABASE_URL|DIRECT_URL|PORT|NODE_ENV|ROLE|TRUST_PROXY_HOPS|FRONTEND_URL|SERVER_BASE_URL|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_REGION|AWS_S3_BUCKET|AWS_S3_REGION|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)$'
umask 077
render_env "$BE_SERVICE" \
  | jq -r --arg skip "$SKIP" '.[].envVar | select(.key | test($skip) | not) | "\(.key)=\(.value)"' \
  > "$INFRA/.env.prod-secrets"

# Frontend: public build values only. On AWS the API URL is the relative /api, and the
# browser no longer talks to Supabase.
render_env "$FE_SERVICE" \
  | jq -r '.[].envVar | select(.key | startswith("VITE_"))
      | select(.key | test("^VITE_(API_URL|API_BASE_URL|SERVER_URL|SUPABASE_.*)$") | not)
      | "\(.key)=\(.value)"' \
  > "$INFRA/.env.prod"

echo "backend: $(grep -c . "$INFRA/.env.prod-secrets") variables -> infra/.env.prod-secrets"
cut -d= -f1 "$INFRA/.env.prod-secrets" | sort | sed 's/^/  /'
echo "frontend: $(grep -c . "$INFRA/.env.prod") variables -> infra/.env.prod"
cut -d= -f1 "$INFRA/.env.prod" | sort | sed 's/^/  /'
