-- Store amounts in major units (12.50) instead of minor units (1250), so every tool and every
-- SQL result speaks the same unit (#43). numeric is exact, so no float drift.
ALTER TABLE "transaction" ADD COLUMN "amount" numeric(14, 2);--> statement-breakpoint
UPDATE "transaction" SET "amount" = "amount_minor" / 100.0;--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "amount" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" DROP COLUMN "amount_minor";
