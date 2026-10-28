CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"parent_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"nature" text,
	"dre_group" text NOT NULL,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_scope_parent_name_unique" UNIQUE NULLS NOT DISTINCT("tenant_id","parent_id","name"),
	CONSTRAINT "categories_kind_check" CHECK (kind in ('revenue', 'expense', 'investment', 'deduction')),
	CONSTRAINT "categories_nature_check" CHECK (nature is null or nature in ('fixed', 'variable'))
);
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"fee_percent_bp" integer DEFAULT 0 NOT NULL,
	"fee_fixed_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_methods_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_methods_tenant_name_unique" UNIQUE("tenant_id","name"),
	CONSTRAINT "payment_methods_fee_percent_check" CHECK ("payment_methods"."fee_percent_bp" between 0 and 10000),
	CONSTRAINT "payment_methods_fee_fixed_check" CHECK ("payment_methods"."fee_fixed_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "payment_methods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"fee_percent_bp" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_channels_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "sales_channels_tenant_name_unique" UNIQUE("tenant_id","name"),
	CONSTRAINT "sales_channels_fee_percent_check" CHECK ("sales_channels"."fee_percent_bp" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "sales_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"document" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"type" text NOT NULL,
	"occurred_on" date NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(14, 3),
	"quantity_unit" text,
	"amount_cents" bigint NOT NULL,
	"fee_percent_bp" integer DEFAULT 0 NOT NULL,
	"fee_fixed_cents" bigint DEFAULT 0 NOT NULL,
	"fee_cents" bigint DEFAULT 0 NOT NULL,
	"net_cents" bigint NOT NULL,
	"category_id" uuid,
	"supplier_id" uuid,
	"payment_method_id" uuid,
	"sales_channel_id" uuid,
	"inbound_message_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"confirmation_wa_message_id" text,
	"ai_confidence" numeric(4, 3),
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "entries_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "entries_inbound_position_unique" UNIQUE("inbound_message_id","position"),
	CONSTRAINT "entries_type_check" CHECK (type in ('expense', 'revenue')),
	CONSTRAINT "entries_amount_check" CHECK ("entries"."amount_cents" > 0),
	CONSTRAINT "entries_fee_check" CHECK ("entries"."fee_cents" >= 0 and "entries"."fee_cents" <= "entries"."amount_cents"),
	CONSTRAINT "entries_net_check" CHECK ("entries"."net_cents" = "entries"."amount_cents" - "entries"."fee_cents"),
	CONSTRAINT "entries_fee_percent_check" CHECK ("entries"."fee_percent_bp" between 0 and 10000),
	CONSTRAINT "entries_fee_fixed_check" CHECK ("entries"."fee_fixed_cents" >= 0),
	CONSTRAINT "entries_quantity_check" CHECK ("entries"."quantity" is null or "entries"."quantity" > 0),
	CONSTRAINT "entries_confidence_check" CHECK ("entries"."ai_confidence" is null or "entries"."ai_confidence" between 0 and 1)
);
--> statement-breakpoint
ALTER TABLE "entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "entry_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"changed_by" uuid NOT NULL,
	"channel" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_versions_entry_version_unique" UNIQUE("entry_id","version"),
	CONSTRAINT "entry_versions_action_check" CHECK (action in ('create', 'update', 'delete')),
	CONSTRAINT "entry_versions_channel_check" CHECK (channel in ('whatsapp', 'web', 'import', 'system'))
);
--> statement-breakpoint
ALTER TABLE "entry_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbound_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid,
	"wa_message_id" text NOT NULL,
	"wa_id" text,
	"wa_user_id" text,
	"type" text NOT NULL,
	"text" text,
	"media_key" text,
	"transcription" text,
	"raw" jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_messages_wa_message_id_unique" UNIQUE("wa_message_id"),
	CONSTRAINT "inbound_messages_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "inbound_messages_type_check" CHECK (type in ('text', 'audio', 'image', 'unsupported')),
	CONSTRAINT "inbound_messages_status_check" CHECK (status in ('received', 'processing', 'needs_answer', 'processed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "inbound_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pending_questions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"inbound_message_id" uuid NOT NULL,
	"draft" jsonb NOT NULL,
	"question" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"inbound_message_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"audio_seconds" integer DEFAULT 0 NOT NULL,
	"cost_usd_micros" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"unit_id" uuid,
	"role" text NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_tenant_user_unique" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "memberships_role_check" CHECK (role in ('owner', 'manager', 'staff'))
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'trial' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "units_tenant_name_unique" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone_e164" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_e164_unique" UNIQUE("phone_e164")
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_channels" ADD CONSTRAINT "sales_channels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_unit_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_payment_method_fk" FOREIGN KEY ("tenant_id","payment_method_id") REFERENCES "public"."payment_methods"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_sales_channel_fk" FOREIGN KEY ("tenant_id","sales_channel_id") REFERENCES "public"."sales_channels"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_inbound_message_fk" FOREIGN KEY ("tenant_id","inbound_message_id") REFERENCES "public"."inbound_messages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_versions" ADD CONSTRAINT "entry_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_versions" ADD CONSTRAINT "entry_versions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_versions" ADD CONSTRAINT "entry_versions_entry_fk" FOREIGN KEY ("tenant_id","entry_id") REFERENCES "public"."entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_questions" ADD CONSTRAINT "pending_questions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_questions" ADD CONSTRAINT "pending_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_questions" ADD CONSTRAINT "pending_questions_inbound_message_fk" FOREIGN KEY ("tenant_id","inbound_message_id") REFERENCES "public"."inbound_messages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_inbound_message_fk" FOREIGN KEY ("tenant_id","inbound_message_id") REFERENCES "public"."inbound_messages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_unit_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_tenant_idx" ON "categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "suppliers_tenant_name_idx" ON "suppliers" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "entries_unit_date_idx" ON "entries" USING btree ("tenant_id","unit_id","occurred_on");--> statement-breakpoint
CREATE INDEX "entries_category_date_idx" ON "entries" USING btree ("tenant_id","category_id","occurred_on");--> statement-breakpoint
CREATE UNIQUE INDEX "entries_confirmation_idx" ON "entries" USING btree ("tenant_id","confirmation_wa_message_id") WHERE "entries"."confirmation_wa_message_id" is not null;--> statement-breakpoint
CREATE INDEX "entry_versions_tenant_entry_idx" ON "entry_versions" USING btree ("tenant_id","entry_id");--> statement-breakpoint
CREATE INDEX "inbound_messages_tenant_received_idx" ON "inbound_messages" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE INDEX "inbound_messages_status_idx" ON "inbound_messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pending_questions_tenant_user_idx" ON "pending_questions" USING btree ("tenant_id","user_id","expires_at");--> statement-breakpoint
CREATE INDEX "ai_usage_tenant_created_idx" ON "ai_usage" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_tenant_created_idx" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE POLICY "categories_read" ON "categories" AS PERMISSIVE FOR SELECT TO "app" USING (tenant_id is null or tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "categories_tenant_isolation" ON "categories" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "payment_methods_tenant_isolation" ON "payment_methods" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "sales_channels_tenant_isolation" ON "sales_channels" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "suppliers_tenant_isolation" ON "suppliers" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "entries_tenant_isolation" ON "entries" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "entry_versions_tenant_select" ON "entry_versions" AS PERMISSIVE FOR SELECT TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "entry_versions_tenant_insert" ON "entry_versions" AS PERMISSIVE FOR INSERT TO "app" WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "inbound_messages_tenant_isolation" ON "inbound_messages" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "inbound_messages_ingest_select" ON "inbound_messages" AS PERMISSIVE FOR SELECT TO "app_ingest" USING (true);--> statement-breakpoint
CREATE POLICY "inbound_messages_ingest_insert" ON "inbound_messages" AS PERMISSIVE FOR INSERT TO "app_ingest" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "inbound_messages_ingest_update" ON "inbound_messages" AS PERMISSIVE FOR UPDATE TO "app_ingest" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "pending_questions_tenant_isolation" ON "pending_questions" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "ai_usage_tenant_select" ON "ai_usage" AS PERMISSIVE FOR SELECT TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "ai_usage_tenant_insert" ON "ai_usage" AS PERMISSIVE FOR INSERT TO "app" WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "audit_log_tenant_select" ON "audit_log" AS PERMISSIVE FOR SELECT TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "audit_log_tenant_insert" ON "audit_log" AS PERMISSIVE FOR INSERT TO "app" WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "memberships_tenant_isolation" ON "memberships" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "memberships_ingest_select" ON "memberships" AS PERMISSIVE FOR SELECT TO "app_ingest" USING (true);--> statement-breakpoint
CREATE POLICY "tenants_self_select" ON "tenants" AS PERMISSIVE FOR SELECT TO "app" USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenants_ingest_select" ON "tenants" AS PERMISSIVE FOR SELECT TO "app_ingest" USING (true);--> statement-breakpoint
CREATE POLICY "units_tenant_isolation" ON "units" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "units_ingest_select" ON "units" AS PERMISSIVE FOR SELECT TO "app_ingest" USING (true);--> statement-breakpoint
CREATE POLICY "users_same_tenant_select" ON "users" AS PERMISSIVE FOR SELECT TO "app" USING (exists (
        select 1 from memberships m
        where m.user_id = users.id and m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
      ));--> statement-breakpoint
CREATE POLICY "users_ingest_select" ON "users" AS PERMISSIVE FOR SELECT TO "app_ingest" USING (true);