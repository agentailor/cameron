CREATE TYPE "public"."account" AS ENUM('CHECKING', 'SAVINGS', 'CREDIT', 'CASH');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('expense', 'income');--> statement-breakpoint
CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"color" text,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" timestamp(3) NOT NULL,
	"amount_minor" integer NOT NULL,
	"type" "transaction_type" NOT NULL,
	"note" text NOT NULL,
	"currency" text NOT NULL,
	"description" text,
	"merchant" text,
	"category_id" text,
	"account" "account" NOT NULL,
	"source" text NOT NULL,
	"external_id" text,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "category_name_key" ON "category" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_source_external_id_key" ON "transaction" USING btree ("source","external_id");