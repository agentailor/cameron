-- The role `run_sql` switches to (SET LOCAL ROLE): SELECT on the finance tables, nothing else.
-- Hand-written and idempotent. See docs/ARCHITECTURE.md ("What run_sql can read").
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cameron_analytics') THEN
    CREATE ROLE cameron_analytics NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO cameron_analytics;
--> statement-breakpoint
GRANT SELECT ON "transaction", category TO cameron_analytics;
--> statement-breakpoint
-- A non-superuser app user needs membership to SET ROLE; a superuser already can.
GRANT cameron_analytics TO CURRENT_USER;
--> statement-breakpoint
-- set_config('role', ...) is SET ROLE as a function: from inside one SELECT it would switch back
-- to the session user. Revoked from PUBLIC; the app user keeps it explicitly.
REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) TO CURRENT_USER;
--> statement-breakpoint
-- REVOKE by a non-owner only warns, so check the result instead of trusting it.
DO $$
BEGIN
  IF has_function_privilege('cameron_analytics', 'pg_catalog.set_config(text,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'cameron_analytics can still call set_config; run this migration as a superuser';
  END IF;
  IF has_table_privilege('cameron_analytics', 'public.mcp_server', 'SELECT') THEN
    RAISE EXCEPTION 'cameron_analytics can read mcp_server; check grants to PUBLIC';
  END IF;
END
$$;
