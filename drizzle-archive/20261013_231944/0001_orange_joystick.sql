CREATE TYPE "public"."prompt_order_status" AS ENUM('PENDING', 'GENERATING', 'CANDIDATES_READY', 'SELECTED', 'CANCELLED', 'FAILED');--> statement-breakpoint
CREATE TABLE "prompt_order" (
	"id" text PRIMARY KEY NOT NULL,
	"order_no" text NOT NULL,
	"template_id" text NOT NULL,
	"recipient_name" text NOT NULL,
	"token" text NOT NULL,
	"status" "prompt_order_status" DEFAULT 'PENDING' NOT NULL,
	"uploaded_images" json,
	"upload_count" integer DEFAULT 1 NOT NULL,
	"candidates" json,
	"selected_index" integer,
	"selections" json,
	"error_message" text,
	"uploaded_at" timestamp,
	"generated_at" timestamp,
	"selected_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_order_order_no_unique" UNIQUE("order_no"),
	CONSTRAINT "prompt_order_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "prompt_template" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"prompt" text NOT NULL,
	"size" text DEFAULT '1024x1024' NOT NULL,
	"candidate_count" integer DEFAULT 4 NOT NULL,
	"cover_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prompt_order" ADD CONSTRAINT "prompt_order_template_id_prompt_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."prompt_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prompt_order_template_idx" ON "prompt_order" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "prompt_order_status_idx" ON "prompt_order" USING btree ("status");