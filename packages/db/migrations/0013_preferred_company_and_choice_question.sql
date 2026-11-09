ALTER TABLE "pending_questions" ADD COLUMN "kind" text DEFAULT 'clarify' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "preferred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pending_questions" ADD CONSTRAINT "pending_questions_kind_check" CHECK (kind in ('clarify', 'choice'));