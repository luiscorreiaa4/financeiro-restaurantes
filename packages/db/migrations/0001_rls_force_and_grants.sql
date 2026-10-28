-- Parte que o drizzle-kit não gera: FORCE RLS, permissões por papel e um gatilho de escopo.
-- Papéis (`app`, `app_ingest`) são criados por docker/postgres/init.sql antes das migrations.

-- 1. FORCE ROW LEVEL SECURITY: vale também para o dono das tabelas que não for superusuário.
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppliers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_methods" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_channels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inbound_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entry_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pending_questions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_usage" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- 2. Papel `app`: nada é apagado de verdade (regra 4) e o histórico é só de acréscimo.
REVOKE UPDATE, DELETE ON "entry_versions", "ai_usage", "audit_log" FROM app;--> statement-breakpoint
REVOKE DELETE ON "entries", "inbound_messages" FROM app;--> statement-breakpoint
-- Tenants e pessoas são criados por rotinas administrativas, não pela aplicação.
REVOKE INSERT, UPDATE, DELETE ON "tenants", "users" FROM app;--> statement-breakpoint

-- 3. Papel `app_ingest`: webhook e identificação do remetente, com o mínimo necessário.
GRANT SELECT ON "tenants", "units", "users", "memberships" TO app_ingest;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "inbound_messages" TO app_ingest;--> statement-breakpoint

-- 4. Categoria do lançamento: do sistema (tenant nulo) ou do mesmo tenant. Uma FK composta
-- não serve porque as categorias do sistema não têm tenant. O gatilho roda com os direitos
-- de quem grava, então a RLS de `categories` também vale aqui.
CREATE FUNCTION enforce_entry_category_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM categories c
    WHERE c.id = NEW.category_id AND (c.tenant_id IS NULL OR c.tenant_id = NEW.tenant_id)
  ) THEN
    RAISE EXCEPTION 'category does not belong to the entry tenant' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER entries_category_scope
  BEFORE INSERT OR UPDATE OF category_id, tenant_id ON "entries"
  FOR EACH ROW EXECUTE FUNCTION enforce_entry_category_scope();
