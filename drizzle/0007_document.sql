CREATE TABLE "document" (
	"id" text PRIMARY KEY NOT NULL,
	"file_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"mime_type" text NOT NULL,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "document_content_hash_key" ON "document" USING btree ("content_hash");