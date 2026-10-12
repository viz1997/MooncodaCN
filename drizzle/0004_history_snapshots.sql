-- 效果图历史快照：每次 destructive 写入前自动归档
-- 右栏"效果图历史"侧边栏的数据源

CREATE TYPE "public"."prompt_order_history_trigger" AS ENUM(
  'regenerate_single',
  'regenerate_all',
  'failed_reupload',
  'restore'
);--> statement-breakpoint

CREATE TABLE "prompt_order_history" (
  "id" text PRIMARY KEY NOT NULL,
  "order_id" text NOT NULL,
  "round" integer NOT NULL,
  "trigger" "prompt_order_history_trigger" NOT NULL,
  "image_idx" integer,
  "candidate_idx" integer DEFAULT 0 NOT NULL,
  "candidates" text NOT NULL,
  "selections" text,
  "uploaded_images" text NOT NULL,
  "template_id" text NOT NULL,
  "candidate_count" integer NOT NULL,
  "image_count" integer NOT NULL,
  "size" text NOT NULL,
  "generated_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "prompt_order_history" ADD CONSTRAINT "prompt_order_history_order_id_prompt_order_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."prompt_order"("id") ON DELETE cascade;--> statement-breakpoint

CREATE UNIQUE INDEX "poh_order_round_unique" ON "prompt_order_history" USING btree ("order_id","round");--> statement-breakpoint

CREATE INDEX "poh_order_created_at_idx" ON "prompt_order_history" USING btree ("order_id","created_at");