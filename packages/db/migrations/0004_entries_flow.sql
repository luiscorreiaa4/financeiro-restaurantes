ALTER TABLE "entry_versions" DROP CONSTRAINT "entry_versions_action_check";--> statement-breakpoint
DROP INDEX "entries_confirmation_idx";--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "flags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_questions" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "cache_read_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "cache_write_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_messages_once_per_inbound_idx" ON "outbound_messages" USING btree ("inbound_message_id","purpose") WHERE "outbound_messages"."purpose" in ('confirmation', 'question');--> statement-breakpoint
CREATE UNIQUE INDEX "pending_questions_one_open_idx" ON "pending_questions" USING btree ("tenant_id","user_id") WHERE "pending_questions"."status" = 'open';--> statement-breakpoint
CREATE INDEX "entries_confirmation_idx" ON "entries" USING btree ("tenant_id","confirmation_wa_message_id") WHERE "entries"."confirmation_wa_message_id" is not null;--> statement-breakpoint
ALTER TABLE "entry_versions" ADD CONSTRAINT "entry_versions_action_check" CHECK (action in ('create', 'update', 'delete', 'restore'));--> statement-breakpoint
ALTER TABLE "pending_questions" ADD CONSTRAINT "pending_questions_status_check" CHECK (status in ('open', 'answered', 'cancelled', 'expired'));