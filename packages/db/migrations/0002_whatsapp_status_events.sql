CREATE TABLE "whatsapp_status_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"wa_message_id" text NOT NULL,
	"status" text NOT NULL,
	"recipient_id" text,
	"error_code" integer,
	"error_title" text,
	"error_detail" text,
	"occurred_at" timestamp with time zone,
	"raw" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_status_events_message_status_unique" UNIQUE("wa_message_id","status")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_status_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_status_events" ADD CONSTRAINT "whatsapp_status_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_status_events_tenant_received_idx" ON "whatsapp_status_events" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE INDEX "whatsapp_status_events_error_idx" ON "whatsapp_status_events" USING btree ("error_code");--> statement-breakpoint
CREATE POLICY "whatsapp_status_events_tenant_select" ON "whatsapp_status_events" AS PERMISSIVE FOR SELECT TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "whatsapp_status_events_tenant_insert" ON "whatsapp_status_events" AS PERMISSIVE FOR INSERT TO "app" WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "whatsapp_status_events_ingest_select" ON "whatsapp_status_events" AS PERMISSIVE FOR SELECT TO "app_ingest" USING (true);--> statement-breakpoint
CREATE POLICY "whatsapp_status_events_ingest_insert" ON "whatsapp_status_events" AS PERMISSIVE FOR INSERT TO "app_ingest" WITH CHECK (true);--> statement-breakpoint
-- Parte que o drizzle-kit não gera: FORCE RLS e permissões (mesmo padrão da 0001).
ALTER TABLE "whatsapp_status_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Histórico de entrega: o papel `app` lê e acrescenta, nunca altera nem apaga.
REVOKE UPDATE, DELETE ON "whatsapp_status_events" FROM app;--> statement-breakpoint
-- O webhook só grava e lê eventos de status.
GRANT SELECT, INSERT ON "whatsapp_status_events" TO app_ingest;
