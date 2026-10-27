-- Close the Supabase Data API (PostgREST) to the anon/authenticated roles.
-- RLS with no policies = those roles see and change nothing. The backend (postgres,
-- table owner) and the Deno agents (service_role) both have BYPASSRLS, so they're unaffected.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and not rowsecurity loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- RLS doesn't apply to TRUNCATE (or TRIGGER/REFERENCES), so drop those from the API roles.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- Tables the backend creates later (startup DDL, Prisma) must not reopen the hole:
-- stop granting them to the API roles by default.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
