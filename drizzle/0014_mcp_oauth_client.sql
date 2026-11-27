ALTER TABLE "mcp_server" ADD COLUMN "oauth_state" varchar;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD COLUMN "oauth_client" json;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_server_oauth_state_key" ON "mcp_server" USING btree ("oauth_state");