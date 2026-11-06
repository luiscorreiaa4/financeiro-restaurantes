ALTER TABLE "categories" ADD COLUMN "requires_quantity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "support_words" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "type" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "aliases" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "is_default_card" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_channels" ADD COLUMN "type" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_channels" ADD COLUMN "aliases" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_channels" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "aliases" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "cnpj" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "uf" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "default_sales_channel_id" uuid;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_default_sales_channel_fk" FOREIGN KEY ("tenant_id","default_sales_channel_id") REFERENCES "public"."sales_channels"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_default_card_unique" ON "payment_methods" USING btree ("tenant_id") WHERE "payment_methods"."is_default_card";--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_status_check" CHECK (status in ('active', 'inactive'));--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_support_words_check" CHECK (coalesce(array_length("categories"."support_words", 1), 0) <= 30);--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_type_check" CHECK (type in ('cash', 'pix', 'debit', 'credit', 'voucher', 'boleto', 'transfer', 'other'));--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_status_check" CHECK (status in ('active', 'inactive'));--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_aliases_check" CHECK (coalesce(array_length("payment_methods"."aliases", 1), 0) <= 10);--> statement-breakpoint
ALTER TABLE "sales_channels" ADD CONSTRAINT "sales_channels_type_check" CHECK (type in ('dine_in', 'own_delivery', 'app', 'pickup', 'other'));--> statement-breakpoint
ALTER TABLE "sales_channels" ADD CONSTRAINT "sales_channels_status_check" CHECK (status in ('active', 'inactive'));--> statement-breakpoint
ALTER TABLE "sales_channels" ADD CONSTRAINT "sales_channels_aliases_check" CHECK (coalesce(array_length("sales_channels"."aliases", 1), 0) <= 10);--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_status_check" CHECK (status in ('active', 'inactive'));--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_aliases_check" CHECK (coalesce(array_length("units"."aliases", 1), 0) <= 5);--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_uf_check" CHECK (uf is null or uf in ('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'));--> statement-breakpoint
-- Backfill dos cadastros existentes (RF08, RF09; DE-19, P06 e P07 provisórias): o tipo vem do nome
-- que o seed de desenvolvimento e a E7 já usavam; canal com comissão passa a ser APLICATIVO.
UPDATE "payment_methods" SET "type" = CASE lower("name")
  WHEN 'dinheiro' THEN 'cash' WHEN 'pix' THEN 'pix' WHEN 'débito' THEN 'debit' WHEN 'debito' THEN 'debit'
  WHEN 'crédito' THEN 'credit' WHEN 'credito' THEN 'credit' WHEN 'voucher' THEN 'voucher'
  WHEN 'boleto' THEN 'boleto' WHEN 'transferência' THEN 'transfer' WHEN 'transferencia' THEN 'transfer'
  ELSE 'other' END;--> statement-breakpoint
UPDATE "sales_channels" SET "type" = CASE
  WHEN "fee_percent_bp" > 0 THEN 'app'
  WHEN lower("name") IN ('salão', 'salao') THEN 'dine_in'
  WHEN lower("name") IN ('delivery próprio', 'delivery proprio') THEN 'own_delivery'
  WHEN lower("name") = 'retirada' THEN 'pickup'
  ELSE 'other' END;--> statement-breakpoint
-- Forma de cartão padrão (RF12.R8): até aqui "cartão" valia a forma "Crédito"; vira a primeira de
-- tipo crédito de cada empresa.
UPDATE "payment_methods" SET "is_default_card" = true
WHERE "id" IN (SELECT DISTINCT ON ("tenant_id") "id" FROM "payment_methods"
               WHERE "type" = 'credit' ORDER BY "tenant_id", "created_at", "id");--> statement-breakpoint
-- Canal padrão da receita das unidades existentes: o Salão, quando a empresa o tem (RF04.R6).
UPDATE "units" u SET "default_sales_channel_id" = c."id"
FROM "sales_channels" c
WHERE c."tenant_id" = u."tenant_id" AND c."type" = 'dine_in';--> statement-breakpoint
-- Registros "Não informada" e "Não informado" em toda empresa (RF08, RF09); ids UUID v7.
INSERT INTO "payment_methods" ("id", "tenant_id", "name", "type")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid, t."id", 'Não informada', 'other' FROM "tenants" t
WHERE NOT EXISTS (SELECT 1 FROM "payment_methods" p WHERE p."tenant_id" = t."id" AND p."name" = 'Não informada');--> statement-breakpoint
INSERT INTO "sales_channels" ("id", "tenant_id", "name", "type")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid, t."id", 'Não informado', 'other' FROM "tenants" t
WHERE NOT EXISTS (SELECT 1 FROM "sales_channels" c WHERE c."tenant_id" = t."id" AND c."name" = 'Não informado');
