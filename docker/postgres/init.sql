-- Papéis da aplicação. Nenhum tem BYPASSRLS nem é dono das tabelas, para que as
-- políticas de RLS valham. Migrations rodam com o papel postgres.
--   app         API e workers; só enxerga o tenant definido por `app.tenant_id`.
--   app_ingest  webhook e identificação do remetente (mensagem ainda sem tenant);
--               permissões mínimas, concedidas na migration.
-- Idempotente: pode ser reaplicado em um banco já existente
-- (psql -U postgres -d app -f docker/postgres/init.sql). Os testes de integração
-- usam este mesmo arquivo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app') THEN
    CREATE ROLE app LOGIN PASSWORD 'app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_ingest') THEN
    CREATE ROLE app_ingest LOGIN PASSWORD 'app_ingest' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE app TO app, app_ingest;
GRANT USAGE ON SCHEMA public TO app, app_ingest;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app;
