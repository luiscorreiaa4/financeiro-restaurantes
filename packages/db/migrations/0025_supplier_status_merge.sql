DROP INDEX "suppliers_tenant_name_norm_unique";--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_merged_into_fk" FOREIGN KEY ("tenant_id","merged_into_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_tenant_document_unique" ON "suppliers" USING btree ("tenant_id","document") WHERE "suppliers"."document" is not null and "suppliers"."merged_into_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_tenant_name_norm_unique" ON "suppliers" USING btree ("tenant_id",lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g'))) WHERE "suppliers"."merged_into_id" is null;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_status_check" CHECK (status in ('active', 'inactive'));--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_origin_check" CHECK (origin in ('message', 'invoice', 'panel', 'import'));--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_aliases_check" CHECK (coalesce(array_length("suppliers"."aliases", 1), 0) <= 10);