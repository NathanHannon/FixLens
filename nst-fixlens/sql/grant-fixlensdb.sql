-- Run as doadmin, connected to the database containing schema.sql.
-- The fixlensdb role must already exist (create it in the DO console).
-- Keeps ownership with doadmin; fixlensdb is the API runtime identity.
BEGIN;

DO $$
BEGIN
  IF current_user <> 'doadmin' THEN
    RAISE EXCEPTION 'Run grant-fixlensdb.sql as doadmin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fixlensdb') THEN
    RAISE EXCEPTION 'Create the fixlensdb database user before running this script';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO fixlensdb', current_database());
END;
$$;

GRANT USAGE ON SCHEMA public TO fixlensdb;
GRANT SELECT ON TABLE public.users, public.capture_deltas TO fixlensdb;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.problems, public.captures, public.measurements, public.reports
  TO fixlensdb;
GRANT USAGE ON TYPE public.problem_category, public.problem_status, public.urgency
  TO fixlensdb;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO fixlensdb;

-- UUID domain IDs need no sequence privileges. These grants cover any
-- existing serial/identity sequences and future ones created by doadmin.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fixlensdb;
ALTER DEFAULT PRIVILEGES FOR ROLE doadmin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fixlensdb;
ALTER DEFAULT PRIVILEGES FOR ROLE doadmin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO fixlensdb;
ALTER DEFAULT PRIVILEGES FOR ROLE doadmin IN SCHEMA public
  GRANT USAGE ON TYPES TO fixlensdb;

COMMIT;
