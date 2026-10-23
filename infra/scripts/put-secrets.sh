#!/usr/bin/env bash
# Copy secret values from a local env file into SSM Parameter Store (SecureString).
# Writes every name in secrets.<env>.txt, plus SOURCE_DATABASE_URL (used only by the restore
# task) when the file has it; it may already be in SSM.
# Usage: scripts/put-secrets.sh staging path/to/staging.env
set -euo pipefail
ENV=${1:?usage: put-secrets.sh <env> <env-file>}
FILE=${2:?usage: put-secrets.sh <env> <env-file>}
REGION=${AWS_REGION:-eu-central-1}
INFRA=$(cd "$(dirname "$0")/.." && pwd)

names=$(grep -vE '^[[:space:]]*(#|$)' "$INFRA/secrets.$ENV.txt")
if grep -q '^SOURCE_DATABASE_URL=' "$FILE"; then names="$names SOURCE_DATABASE_URL"; fi

missing=0
for name in $names; do
  value=$(grep -E "^$name=" "$FILE" | tail -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')
  if [ -z "$value" ]; then echo "MISSING  $name"; missing=$((missing + 1)); continue; fi
  aws ssm put-parameter --region "$REGION" --name "/qe/$ENV/$name" --type SecureString \
    --value "$value" --overwrite >/dev/null
  echo "set      /qe/$ENV/$name"
done
[ "$missing" -eq 0 ] || { echo "$missing missing: tasks will not start until they exist in SSM"; exit 1; }
