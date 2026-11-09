CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"email_hash" text,
	"event" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_audit_event_check" CHECK (event in ('otp_sent', 'login', 'login_failed', 'password_locked', 'logout'))
);
--> statement-breakpoint
ALTER TABLE "auth_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "phone_e164" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_password_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_audit" ADD CONSTRAINT "auth_audit_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE POLICY "memberships_auth_select" ON "memberships" AS PERMISSIVE FOR SELECT TO "app_auth" USING (true);--> statement-breakpoint
CREATE POLICY "users_auth_select" ON "users" AS PERMISSIVE FOR SELECT TO "app_auth" USING (true);--> statement-breakpoint
CREATE POLICY "users_auth_update" ON "users" AS PERMISSIVE FOR UPDATE TO "app_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "accounts_auth" ON "accounts" AS PERMISSIVE FOR ALL TO "app_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "auth_audit_auth_select" ON "auth_audit" AS PERMISSIVE FOR SELECT TO "app_auth" USING (true);--> statement-breakpoint
CREATE POLICY "auth_audit_auth_insert" ON "auth_audit" AS PERMISSIVE FOR INSERT TO "app_auth" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "sessions_auth" ON "sessions" AS PERMISSIVE FOR ALL TO "app_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "verifications_auth" ON "verifications" AS PERMISSIVE FOR ALL TO "app_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
-- Parte que o drizzle-kit não gera: FORCE RLS e permissões (padrão da 0001 a 0003 e da 0010).
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "verifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_audit" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- O `ALTER DEFAULT PRIVILEGES` do init.sql dá tudo ao `app` em tabela nova: tira das tabelas de login.
REVOKE ALL ON "sessions", "accounts", "verifications", "auth_audit" FROM app, app_ingest;--> statement-breakpoint
-- Papel `app_auth` (login): só o que o Better Auth precisa, sem `app.tenant_id`.
GRANT SELECT, INSERT, UPDATE, DELETE ON "sessions", "accounts", "verifications" TO app_auth;--> statement-breakpoint
GRANT SELECT, INSERT ON "auth_audit" TO app_auth;--> statement-breakpoint
GRANT SELECT, UPDATE ON "users" TO app_auth;--> statement-breakpoint
GRANT SELECT ON "memberships" TO app_auth;
