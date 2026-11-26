CREATE TABLE "tool_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" text NOT NULL,
	"tool" text NOT NULL,
	"server_id" text,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_run" ADD COLUMN "granted_tools" text[];--> statement-breakpoint
ALTER TABLE "tool_grant" ADD CONSTRAINT "tool_grant_server_id_mcp_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tool_grant_key" ON "tool_grant" USING btree ("scope_kind","scope_id","tool");