CREATE POLICY "membership_units_auth_select" ON "membership_units" AS PERMISSIVE FOR SELECT TO "app_auth" USING (true);--> statement-breakpoint
CREATE POLICY "tenants_auth_select" ON "tenants" AS PERMISSIVE FOR SELECT TO "app_auth" USING (true);--> statement-breakpoint
CREATE POLICY "units_auth_select" ON "units" AS PERMISSIVE FOR SELECT TO "app_auth" USING (true);--> statement-breakpoint
-- Parte que o drizzle-kit não gera: permissões só de leitura (DD-31, contexto do painel).
-- `app_auth` lê só o que o painel precisa: nome e situação da empresa, e id/empresa/situação da
-- unidade. CNPJ, razão social e nome da unidade continuam fora do alcance (GRANT por coluna).
GRANT SELECT (id, name, status) ON "tenants" TO app_auth;--> statement-breakpoint
GRANT SELECT ON "membership_units" TO app_auth;--> statement-breakpoint
GRANT SELECT (id, tenant_id, status) ON "units" TO app_auth;
