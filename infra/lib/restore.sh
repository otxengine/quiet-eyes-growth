set -eu
# One-off copy of the Supabase public schema into RDS (run by scripts/restore-db.sh).
# MODE=schema copies structure only; MODE=full copies structure and data. Safe to re-run:
# the target public schema is dropped and recreated each time.
MODE="${MODE:-full}"
export PGPASSWORD="$DB_PASSWORD"
TARGET="host=$DB_HOST port=$DB_PORT dbname=$DB_NAME user=$DB_USER sslmode=require"
FLAGS="--schema=public --no-owner --no-privileges --format=custom"
if [ "$MODE" = "schema" ]; then FLAGS="$FLAGS --schema-only"; fi

# The stored URL is Prisma-style (?pgbouncer=true&... on the 6543 transaction pooler);
# libpq rejects those params and pg_dump needs a session, so drop the query string
# and use Supabase's session pooler port instead.
SOURCE="$(printf '%s' "${SOURCE_DATABASE_URL%%\?*}" | sed 's/:6543\//:5432\//')?sslmode=require"

echo "[restore] dumping source ($MODE)"
pg_dump "$SOURCE" $FLAGS --file=/tmp/db.dump
ls -lh /tmp/db.dump

echo "[restore] resetting target"
# Extensions live in their own schema (as on Supabase) so dropping public does not remove them.
psql "$TARGET" -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
DROP SCHEMA IF EXISTS public CASCADE;
SQL
pg_restore -l /tmp/db.dump | grep -q ' SCHEMA - public ' || psql "$TARGET" -v ON_ERROR_STOP=1 -c 'CREATE SCHEMA public'

echo "[restore] restoring"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TARGET" /tmp/db.dump
psql "$TARGET" -v ON_ERROR_STOP=1 \
  -c "ALTER DATABASE \"$DB_NAME\" SET search_path = \"\$user\", public, extensions" \
  -c 'ANALYZE'

echo "[restore] exact row counts"
psql "$TARGET" -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT format('select %L || ''='' || count(*) from public.%I', tablename, tablename)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
\gexec
SQL
echo "[restore] done"
