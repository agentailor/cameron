-- Baseline schema for Cameron AI, in lowercase snake_case (Postgres convention).
--
-- Written to be safe on a FRESH database (a new clone / a fresh compose volume) and
-- idempotent on a database that already has these tables (e.g. a local DB that was
-- upgraded in place from the Prisma-era template). Hence the IF NOT EXISTS guards.
--
-- The LangGraph PostgresSaver checkpointer creates its own tables separately and is
-- not represented here.

DO $$ BEGIN
  CREATE TYPE "public"."mcp_server_type" AS ENUM('stdio', 'http');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mcp_server" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "mcp_server_type" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"command" text,
	"args" jsonb,
	"env" jsonb,
	"url" text,
	"headers" jsonb,
	"requires_auth" boolean DEFAULT false,
	"auth_tokens" json,
	"client_info" json,
	"code_verifier" varchar,
	"oauth_status" varchar,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thread" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_server_name_key" ON "mcp_server" USING btree ("name");
