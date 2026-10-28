CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"inbound_message_id" uuid,
	"wa_message_id" text NOT NULL,
	"to_wa_id" text NOT NULL,
	"purpose" text NOT NULL,
	"text" text NOT NULL,
	"replied_to_wa_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbound_messages_wa_message_id_unique" UNIQUE("wa_message_id"),
	CONSTRAINT "outbound_messages_purpose_check" CHECK (purpose in ('confirmation', 'question', 'help', 'notice'))
);
--> statement-breakpoint
ALTER TABLE "outbound_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_opt_ins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"inbound_message_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_opt_ins_tenant_user_unique" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "whatsapp_opt_ins_source_check" CHECK (source in ('first_message'))
);
--> statement-breakpoint
ALTER TABLE "whatsapp_opt_ins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_inbound_message_id_inbound_messages_id_fk" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."inbound_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_tenant_inbound_fk" FOREIGN KEY ("tenant_id","inbound_message_id") REFERENCES "public"."inbound_messages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_opt_ins" ADD CONSTRAINT "whatsapp_opt_ins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_opt_ins" ADD CONSTRAINT "whatsapp_opt_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_opt_ins" ADD CONSTRAINT "whatsapp_opt_ins_inbound_message_fk" FOREIGN KEY ("tenant_id","inbound_message_id") REFERENCES "public"."inbound_messages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbound_messages_tenant_created_idx" ON "outbound_messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "outbound_messages_to_created_idx" ON "outbound_messages" USING btree ("to_wa_id","created_at");--> statement-breakpoint
CREATE POLICY "outbound_messages_tenant_isolation" ON "outbound_messages" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "outbound_messages_ingest_select" ON "outbound_messages" AS PERMISSIVE FOR SELECT TO "app_ingest" USING (true);--> statement-breakpoint
CREATE POLICY "outbound_messages_ingest_insert" ON "outbound_messages" AS PERMISSIVE FOR INSERT TO "app_ingest" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "whatsapp_opt_ins_tenant_select" ON "whatsapp_opt_ins" AS PERMISSIVE FOR SELECT TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "whatsapp_opt_ins_tenant_insert" ON "whatsapp_opt_ins" AS PERMISSIVE FOR INSERT TO "app" WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Parte que o drizzle-kit não gera: FORCE RLS e permissões (mesmo padrão da 0001 e da 0002).
ALTER TABLE "outbound_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_opt_ins" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Históricos: o papel `app` lê e acrescenta, nunca altera nem apaga.
REVOKE UPDATE, DELETE ON "outbound_messages", "whatsapp_opt_ins" FROM app;--> statement-breakpoint
-- A resposta a um número ainda sem tenant é gravada e lida pelo papel de ingestão.
GRANT SELECT, INSERT ON "outbound_messages" TO app_ingest;
