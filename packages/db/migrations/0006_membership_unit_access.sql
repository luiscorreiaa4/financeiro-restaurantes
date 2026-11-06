CREATE TABLE "membership_units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_units_membership_unit_unique" UNIQUE("membership_id","unit_id")
);
--> statement-breakpoint
ALTER TABLE "membership_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_role_check";--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_unit_fk";
--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "permissions" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "all_units" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "default_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "panel_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "invited_by" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
-- Backfill (DE-22): converte `unit_id` em TODAS ou lista de uma unidade, sem perder acesso.
-- `unit_id` sai na 0007, só depois de conferida a conversão.
UPDATE "memberships" SET "all_units" = true WHERE "unit_id" IS NULL;--> statement-breakpoint
UPDATE "memberships" SET "default_unit_id" = "unit_id" WHERE "unit_id" IS NOT NULL;--> statement-breakpoint
UPDATE "memberships" SET "status" = 'deactivated' WHERE "deactivated_at" IS NOT NULL;--> statement-breakpoint
-- Permissões passam de objeto (`{}`) a lista de valores do enum.
UPDATE "memberships" SET "permissions" = '[]'::jsonb WHERE jsonb_typeof("permissions") <> 'array';--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "membership_units" ADD CONSTRAINT "membership_units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_units" ADD CONSTRAINT "membership_units_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_units" ADD CONSTRAINT "membership_units_unit_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_default_unit_fk" FOREIGN KEY ("tenant_id","default_unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_status_check" CHECK (status in ('invited', 'active', 'deactivated'));--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_permissions_check" CHECK (jsonb_typeof(permissions) = 'array' and permissions <@ '["VER_FOLHA","EXPORTAR_DADOS","RECEBER_RESUMO_SEMANAL","CONSULTAR_RELATORIOS_WHATSAPP"]'::jsonb);--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_check" CHECK (role in ('owner', 'manager', 'staff', 'accountant'));--> statement-breakpoint
CREATE POLICY "membership_units_tenant_isolation" ON "membership_units" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "membership_units_ingest_select" ON "membership_units" AS PERMISSIVE FOR SELECT TO "app_ingest" USING (true);--> statement-breakpoint
INSERT INTO "membership_units" ("id", "tenant_id", "membership_id", "unit_id")
-- id UUID v7 (convenção do projeto): 48 bits de milissegundos + versão 7, sobre um uuid aleatório.
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid, "tenant_id", "id", "unit_id" FROM "memberships" WHERE "unit_id" IS NOT NULL;--> statement-breakpoint
-- Parte que o drizzle-kit não gera: FORCE RLS e permissões (padrão da 0001 a 0003).
ALTER TABLE "membership_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "membership_units" TO app_ingest;
