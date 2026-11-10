ALTER TABLE "tenants" DROP CONSTRAINT "tenants_cnpj_check";--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_cnpj_check" CHECK ("tenants"."cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$');