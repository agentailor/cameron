CREATE TABLE "task_run" (
	"id" text PRIMARY KEY NOT NULL,
	"task_name" text NOT NULL,
	"slot" timestamp(3) NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"pause_reason" text,
	"error" text,
	"thread_id" text,
	"started_at" timestamp(3) NOT NULL,
	"finished_at" timestamp(3)
);
--> statement-breakpoint
CREATE TABLE "task_setting" (
	"task_name" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"enabled_at" timestamp(3),
	"updated_at" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "task_run_slot_key" ON "task_run" USING btree ("task_name","slot");