ALTER TABLE "sessions" ADD COLUMN "keep_connected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Normaliza e-mails já gravados (banco de desenvolvimento com dados) antes do CHECK. Se dois
-- usuários só diferirem por caixa ou espaços, o UPDATE fere "users_email_unique" e a migration
-- PARA de propósito: resolva a duplicidade à mão (um dos dois e-mails) e rode de novo.
UPDATE "users" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized_check" CHECK ("users"."email" = lower(btrim("users"."email")));