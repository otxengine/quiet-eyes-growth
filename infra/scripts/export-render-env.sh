#!/usr/bin/env bash
# Copy Render's environment for the AWS prod stack:
#   backend  -> infra/.env.prod-secrets (gitignored, owner-only) for put-secrets.sh
#   frontend -> infra/.env.prod (gitignored) with the public VITE_* build values for deploy.sh
# Prints only variable NAMES, never values.
# Needs a Render API key (Render dashboard -> Account Settings -> API Keys).
# Usage: copy the key, then run infra/scripts/export-render-env.sh
#        (or set RENDER_API_KEY in the environment instead).
set -euo pipefail
RENDER_API_KEY=${RENDER_API_KEY:-$(pbpaste 2>/dev/null || true)}
RENDER_API_KEY=$(printf '%s' "$RENDER_API_KEY" | tr -d '[:space:]') # copy buttons often add a newline
# Only a Render key ever leaves this machine, never whatever else is on the clipboard.
case "$RENDER_API_KEY" in
  rnd_*) ;;
  *) echo "Copy a Render API key (starts with rnd_) to the clipboard first: Render > Account Settings > API Keys." >&2
     echo "(The clipboard held ${#RENDER_API_KEY} characters that don't start with rnd_; they were not sent anywhere.)" >&2
     exit 1 ;;
esac
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
# browser no longer talks to Supabase. Other lines already in .env.prod (ALERT_EMAIL) stay.
{
  grep -v '^VITE_' "$INFRA/.env.prod" 2>/dev/null || true
  render_env "$FE_SERVICE" \
    | jq -r '.[].envVar | select(.key | startswith("VITE_"))
        | select(.key | test("^VITE_(API_URL|API_BASE_URL|SERVER_URL|SUPABASE_.*)$") | not)
        | "\(.key)=\(.value)"'
} > "$INFRA/.env.prod.tmp" && mv "$INFRA/.env.prod.tmp" "$INFRA/.env.prod"

echo "backend: $(grep -c . "$INFRA/.env.prod-secrets") variables -> infra/.env.prod-secrets"
cut -d= -f1 "$INFRA/.env.prod-secrets" | sort | sed 's/^/  /'
echo "frontend: $(grep -c . "$INFRA/.env.prod") variables -> infra/.env.prod"
cut -d= -f1 "$INFRA/.env.prod" | sort | sed 's/^/  /'
