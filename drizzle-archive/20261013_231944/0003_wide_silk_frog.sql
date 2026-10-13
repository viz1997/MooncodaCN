CREATE TYPE "public"."prompt_scene" AS ENUM('generate_2d', 'generate_3d', 'translate', 'stylize', 'enhance', 'custom');--> statement-breakpoint
ALTER TABLE "product_effect" ADD COLUMN "scene" "prompt_scene" DEFAULT 'generate_2d' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_effect" ADD COLUMN "versions" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "product_effect" ADD COLUMN "usage_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_effect" ADD COLUMN "success_rate" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_effect" ADD COLUMN "avg_duration" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_effect" ADD COLUMN "product_line_ids" json DEFAULT '[]'::json NOT NULL;