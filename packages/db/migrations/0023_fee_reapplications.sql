CREATE TABLE "fee_reapplications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"fee_percent_bp" integer NOT NULL,
	"fee_fixed_cents" bigint NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error_code" text,
	"matched" integer,
	"updated" integer,
	"skipped" integer,
	"created_by" uuid NOT NULL,
	"client_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "fee_reapplications_target_kind_check" CHECK (target_kind in ('payment_method', 'sales_channel')),
	CONSTRAINT "fee_reapplications_status_check" CHECK (status in ('queued', 'running', 'done', 'failed')),
	CONSTRAINT "fee_reapplications_period_check" CHECK ("fee_reapplications"."to_date" >= "fee_reapplications"."from_date"),
	CONSTRAINT "fee_reapplications_period_max_check" CHECK ("fee_reapplications"."to_date" - "fee_reapplications"."from_date" <= 366),
	CONSTRAINT "fee_reapplications_fee_check" CHECK ("fee_reapplications"."fee_percent_bp" between 0 and 10000 and "fee_reapplications"."fee_fixed_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fee_reapplications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fee_reapplications" ADD CONSTRAINT "fee_reapplications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_reapplications" ADD CONSTRAINT "fee_reapplications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_reapplications_client_request_unique" ON "fee_reapplications" USING btree ("tenant_id","created_by","client_request_id") WHERE "fee_reapplications"."client_request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_reapplications_active_target_unique" ON "fee_reapplications" USING btree ("tenant_id","target_kind","target_id") WHERE "fee_reapplications"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "fee_reapplications_target_created_idx" ON "fee_reapplications" USING btree ("tenant_id","target_kind","target_id","created_at" desc);--> statement-breakpoint
CREATE POLICY "fee_reapplications_tenant_isolation" ON "fee_reapplications" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Parte que o drizzle-kit não gera: FORCE RLS e permissões (mesmo padrão da 0001 e da 0021).
ALTER TABLE "fee_reapplications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- O papel `app` lê, cria e atualiza a situação, nunca apaga: a linha fica como registro.
REVOKE ALL ON "fee_reapplications" FROM app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "fee_reapplications" TO app;