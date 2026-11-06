ALTER TABLE "entry_versions" DROP CONSTRAINT "entry_versions_channel_check";--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "paid_on" date;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "orders" integer;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "restorable_until" date;--> statement-breakpoint
-- Backfill (DD-02, DD-08): a data de pagamento dos lançamentos antigos é a de competência, e a
-- receita antiga sem canal vai para "Não informado" (criado se a empresa ainda não o tem).
UPDATE "entries" SET "paid_on" = "occurred_on" WHERE "paid_on" IS NULL;--> statement-breakpoint
ALTER TABLE "entries" ALTER COLUMN "paid_on" SET NOT NULL;--> statement-breakpoint
INSERT INTO "sales_channels" ("id", "tenant_id", "name", "type")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid, t."id", 'Não informado', 'other' FROM "tenants" t
WHERE EXISTS (SELECT 1 FROM "entries" e WHERE e."tenant_id" = t."id" AND e."type" = 'revenue' AND e."sales_channel_id" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "sales_channels" c WHERE c."tenant_id" = t."id" AND c."name" = 'Não informado');--> statement-breakpoint
UPDATE "entries" e SET "sales_channel_id" = c."id"
FROM "sales_channels" c
WHERE e."type" = 'revenue' AND e."sales_channel_id" IS NULL
  AND c."tenant_id" = e."tenant_id" AND c."name" = 'Não informado';--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_orders_check" CHECK ("entries"."orders" is null or ("entries"."orders" > 0 and "entries"."type" = 'revenue'));--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_revenue_channel_check" CHECK ("entries"."type" <> 'revenue' or "entries"."sales_channel_id" is not null);--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_delete_reason_check" CHECK ("entries"."delete_reason" is null or char_length("entries"."delete_reason") <= 200);--> statement-breakpoint
ALTER TABLE "entry_versions" ADD CONSTRAINT "entry_versions_channel_check" CHECK (channel in ('whatsapp', 'web', 'import', 'email', 'system'));