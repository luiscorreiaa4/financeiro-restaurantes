CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"unit_choice" text NOT NULL,
	"format" text NOT NULL,
	"content" text NOT NULL,
	"filters" jsonb NOT NULL,
	"status" text NOT NULL,
	"row_count" integer,
	"file_size" integer,
	"file_key" text,
	"error_code" text,
	"client_request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"file_deleted_at" timestamp with time zone,
	CONSTRAINT "exports_format_check" CHECK (format in ('xlsx', 'csv')),
	CONSTRAINT "exports_content_check" CHECK (content in ('entries', 'full')),
	CONSTRAINT "exports_status_check" CHECK (status in ('queued', 'generating', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "exports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exports_client_request_unique" ON "exports" USING btree ("tenant_id","requested_by","client_request_id");--> statement-breakpoint
CREATE INDEX "exports_user_created_idx" ON "exports" USING btree ("tenant_id","requested_by","created_at" desc);--> statement-breakpoint
CREATE POLICY "exports_tenant_isolation" ON "exports" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Parte que o drizzle-kit não gera: FORCE RLS e permissões (mesmo padrão da 0001 e da 0002).
ALTER TABLE "exports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- O papel `app` lê, cria e atualiza a situação do pedido, nunca apaga: o arquivo expira, a linha fica.
REVOKE ALL ON "exports" FROM app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "exports" TO app;
