#!/bin/sh
set -e
echo "readiness test 13: deliberate startup failure, revert this commit" >&2; exit 1
# On ECS the RDS credentials arrive as separate env vars from Secrets Manager; Prisma wants one URL.
# The generated password excludes URL-reserved characters, so no encoding is needed.
if [ -z "$DATABASE_URL" ] && [ -n "$DB_HOST" ]; then
  export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT:-5432}/${DB_NAME}?sslmode=require"
fi
export DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"
exec "$@"
