CREATE TABLE "fiscal_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"access_key" text NOT NULL,
	"inbound_message_id" uuid NOT NULL,
	"source" text NOT NULL,
	"needs_recheck" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_documents_tenant_key_unique" UNIQUE("tenant_id","access_key"),
	CONSTRAINT "fiscal_documents_key_check" CHECK ("fiscal_documents"."access_key" ~ '^[0-9]{44}$'),
	CONSTRAINT "fiscal_documents_source_check" CHECK (source in ('qrcode_sefaz', 'ai_reading'))
);
--> statement-breakpoint
ALTER TABLE "fiscal_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_inbound_message_fk" FOREIGN KEY ("tenant_id","inbound_message_id") REFERENCES "public"."inbound_messages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fiscal_documents_tenant_created_idx" ON "fiscal_documents" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE POLICY "fiscal_documents_tenant_isolation" ON "fiscal_documents" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Parte que o drizzle-kit não gera: FORCE RLS e permissões (mesmo padrão da 0002 e da 0003).
ALTER TABLE "fiscal_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Nada é apagado de verdade (regra 4): o papel `app` pode marcar `needs_recheck`, nunca apagar.
REVOKE DELETE ON "fiscal_documents" FROM app;
