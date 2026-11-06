CREATE TABLE "tax_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"regime" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"components" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rules_regime_valid_from_unique" UNIQUE("regime","valid_from"),
	CONSTRAINT "tax_rules_regime_check" CHECK (regime in ('mei', 'simples_nacional', 'lucro_presumido', 'lucro_real')),
	CONSTRAINT "tax_rules_period_check" CHECK ("tax_rules"."valid_to" is null or "tax_rules"."valid_to" >= "tax_rules"."valid_from"),
	CONSTRAINT "tax_rules_components_check" CHECK (jsonb_typeof("tax_rules"."components") = 'array')
);
--> statement-breakpoint
ALTER TABLE "tax_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"regime" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_settings_tenant_valid_from_unique" UNIQUE("tenant_id","valid_from"),
	CONSTRAINT "tax_settings_regime_check" CHECK (regime in ('mei', 'simples_nacional', 'lucro_presumido', 'lucro_real', 'not_sure')),
	CONSTRAINT "tax_settings_enabled_regime_check" CHECK (not "tax_settings"."enabled" or "tax_settings"."regime" <> 'not_sure'),
	CONSTRAINT "tax_settings_params_check" CHECK (jsonb_typeof("tax_settings"."params") = 'object')
);
--> statement-breakpoint
ALTER TABLE "tax_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tax_settings" ADD CONSTRAINT "tax_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_settings" ADD CONSTRAINT "tax_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tax_rules_read" ON "tax_rules" AS PERMISSIVE FOR SELECT TO "app" USING (true);--> statement-breakpoint
CREATE POLICY "tax_settings_tenant_isolation" ON "tax_settings" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Parte que o drizzle-kit não gera: FORCE RLS e permissões (padrão da 0001 a 0003).
ALTER TABLE "tax_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tax_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Tabela global do sistema (RF39.R4): o papel `app` só lê; regra nova entra por migration ou seed.
REVOKE INSERT, UPDATE, DELETE ON "tax_rules" FROM app;
