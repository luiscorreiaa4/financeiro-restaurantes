CREATE TABLE "signup_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"kind" text NOT NULL,
	"code_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"ip" text,
	"expires_at" timestamp with time zone NOT NULL,
	"receipt_hash" text,
	"receipt_expires_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signup_verifications_kind_check" CHECK (kind in ('code', 'notice')),
	CONSTRAINT "signup_verifications_code_hash_check" CHECK (("signup_verifications"."kind" = 'code') = ("signup_verifications"."code_hash" is not null)),
	CONSTRAINT "signup_verifications_email_normalized_check" CHECK ("signup_verifications"."email" = lower(btrim("signup_verifications"."email")))
);
--> statement-breakpoint
ALTER TABLE "signup_verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_audit" DROP CONSTRAINT "auth_audit_event_check";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "cnpj" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "segment" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "revenue_range" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "trial_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "privacy_version" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "dpa_version" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "terms_accepted_by" uuid;--> statement-breakpoint
CREATE INDEX "signup_verifications_email_created_idx" ON "signup_verifications" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "signup_verifications_ip_created_idx" ON "signup_verifications" USING btree ("ip","created_at");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_terms_accepted_by_users_id_fk" FOREIGN KEY ("terms_accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_cnpj_open_unique" ON "tenants" USING btree ("cnpj") WHERE "tenants"."cnpj" is not null and "tenants"."status" <> 'closed';--> statement-breakpoint
ALTER TABLE "auth_audit" ADD CONSTRAINT "auth_audit_event_check" CHECK (event in ('otp_sent', 'login', 'login_failed', 'password_locked', 'logout', 'signup_code_sent', 'signup_verified', 'signup_completed', 'company_created'));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_status_check" CHECK (status in ('active', 'read_only', 'canceled', 'closed'));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_segment_check" CHECK (segment in ('restaurant', 'bar', 'snack_bar', 'pizzeria', 'bakery', 'cafe', 'burger_joint', 'food_truck', 'other'));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_revenue_range_check" CHECK (revenue_range in ('up_to_30k', 'from_30k_to_100k', 'from_100k_to_300k', 'above_300k', 'prefer_not_to_say'));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_cnpj_check" CHECK ("tenants"."cnpj" ~ '^[0-9]{14}$');--> statement-breakpoint
CREATE POLICY "payment_methods_auth_insert" ON "payment_methods" AS PERMISSIVE FOR INSERT TO "app_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "sales_channels_auth_insert" ON "sales_channels" AS PERMISSIVE FOR INSERT TO "app_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tax_settings_auth_insert" ON "tax_settings" AS PERMISSIVE FOR INSERT TO "app_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "membership_units_auth_insert" ON "membership_units" AS PERMISSIVE FOR INSERT TO "app_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "memberships_auth_insert" ON "memberships" AS PERMISSIVE FOR INSERT TO "app_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenants_auth_insert" ON "tenants" AS PERMISSIVE FOR INSERT TO "app_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "units_auth_insert" ON "units" AS PERMISSIVE FOR INSERT TO "app_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "users_auth_insert" ON "users" AS PERMISSIVE FOR INSERT TO "app_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "signup_verifications_auth" ON "signup_verifications" AS PERMISSIVE FOR ALL TO "app_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
-- Parte que o drizzle-kit não gera: FORCE RLS e permissões (padrão da 0011_auth.sql).
ALTER TABLE "signup_verifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- O `ALTER DEFAULT PRIVILEGES` do init.sql dá tudo ao `app` em tabela nova: tira da tabela de cadastro.
REVOKE ALL ON "signup_verifications" FROM app, app_ingest;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "signup_verifications" TO app_auth;--> statement-breakpoint
-- Autocadastro (F1b, RF01): `app_auth` só INSERE a conta nova, sem SELECT novo nem RETURNING.
-- As chaves estrangeiras (inclusive as compostas, como units.default_sales_channel_id) são
-- checadas pelo dono das tabelas e ignoram RLS, então não pedem leitura ao `app_auth`.
GRANT INSERT ON "tenants", "users", "units", "memberships", "membership_units", "payment_methods", "sales_channels", "tax_settings" TO app_auth;
