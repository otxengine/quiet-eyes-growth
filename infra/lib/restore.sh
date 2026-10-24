set -eu
# One-off copy of the Supabase public schema into RDS (run by scripts/restore-db.sh).
# MODE=schema copies structure only; MODE=full copies structure and data. Safe to re-run:
# the target public schema is dropped and recreated each time. MODE=role only sets up the
# app's login (below), which the other modes also do at the end.
MODE="${MODE:-full}"
if [ "${ROLE_ONLY:-}" = "1" ] && [ "$MODE" != "role" ]; then
  echo "[restore] refused: this environment's task only allows MODE=role (it holds live data)" >&2
  exit 1
fi
export PGPASSWORD="$DB_PASSWORD"
printf '%s\n' "$RDS_CA" > /tmp/rds-ca.pem # RDS root CAs, so the target's certificate is verified
TARGET="host=$DB_HOST port=$DB_PORT dbname=$DB_NAME user=$DB_USER sslmode=verify-full sslrootcert=/tmp/rds-ca.pem"

# The app logs in as qe_app (password from the stack's AppDbSecret), not as this master user.
# qe_app owns every object in public, so the app's startup DDL still works, but it can't create
# roles or databases or touch other schemas. pg_restore --no-owner leaves everything owned by
# the master user, so this runs after every restore, in one transaction. Objects that belong to
# an extension or are part of another object (serial sequences, range constructors) follow their
# owner and are left alone.
app_role() {
  echo "[restore] app role qe_app"
  psql "$TARGET" --single-transaction -v ON_ERROR_STOP=1 -v pw="$APP_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE qe_app LOGIN PASSWORD %L', :'pw')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'qe_app') \gexec
ALTER ROLE qe_app LOGIN PASSWORD :'pw';
-- ALTER ... OWNER TO needs membership in the new owner (PostgreSQL 16+).
GRANT qe_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA extensions TO qe_app;
ALTER SCHEMA public OWNER TO qe_app;
DO $$
DECLARE stmt text;
BEGIN
  FOR stmt IN
    SELECT format('ALTER %s %s OWNER TO qe_app',
             CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
             c.oid::regclass)
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
      AND NOT EXISTS (SELECT FROM pg_depend d
                      WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                        AND (d.deptype = 'e' OR (c.relkind = 'S' AND d.deptype IN ('a', 'i'))))
    UNION ALL
    SELECT format('ALTER ROUTINE %s OWNER TO qe_app', p.oid::regprocedure)
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype IN ('i', 'e'))
    UNION ALL
    SELECT format('ALTER TYPE %s OWNER TO qe_app', t.oid::regtype)
    FROM pg_type t
    WHERE t.typnamespace = 'public'::regnamespace AND t.typtype IN ('e', 'd', 'r')
      AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype IN ('i', 'e'))
  LOOP
    EXECUTE stmt;
  END LOOP;
END $$;
SQL
}
if [ "$MODE" = "role" ]; then app_role; echo "[restore] done"; exit 0; fi
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
app_role

echo "[restore] exact row counts"
psql "$TARGET" -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT format('select %L || ''='' || count(*) from public.%I', tablename, tablename)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
\gexec
SQL
echo "[restore] done"
