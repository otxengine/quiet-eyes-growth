#!/bin/sh
set -e
# On ECS the RDS credentials arrive as separate env vars from Secrets Manager; Prisma wants one URL.
# The generated password excludes URL-reserved characters, so no encoding is needed.
# sslaccept=strict makes Prisma verify the server certificate (against the RDS CA bundle) and its
# hostname; with sslmode=require alone it encrypts but accepts any certificate.
if [ -z "$DATABASE_URL" ] && [ -n "$DB_HOST" ]; then
  export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT:-5432}/${DB_NAME}?sslmode=require&sslcert=/app/rds-ca.pem&sslaccept=strict"
fi
export DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"
exec "$@"
