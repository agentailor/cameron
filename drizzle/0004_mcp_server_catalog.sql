CREATE TABLE "mcp_server_catalog" (
	"server_id" text PRIMARY KEY NOT NULL,
	"tools_hash" text NOT NULL,
	"tools" jsonb NOT NULL,
	"tool_count" integer NOT NULL,
	"schema_tokens" integer NOT NULL,
	"summary" text NOT NULL,
	"summary_source" text NOT NULL,
	"refreshed_at" timestamp(3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_server_catalog" ADD CONSTRAINT "mcp_server_catalog_server_id_mcp_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_server"("id") ON DELETE cascade ON UPDATE no action;