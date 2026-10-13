CREATE TYPE "public"."agent_credit_txn_type" AS ENUM('topup', 'debit');--> statement-breakpoint
CREATE TYPE "public"."canvas_remote_capability" AS ENUM('image', 'video', 'audio', 'text', 'image-to-3d', 'multi-image-to-3d');--> statement-breakpoint
CREATE TYPE "public"."canvas_remote_job_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."credits_balance_status" AS ENUM('active', 'frozen');--> statement-breakpoint
CREATE TYPE "public"."credits_batch_source" AS ENUM('purchase', 'subscription', 'bonus', 'refund');--> statement-breakpoint
CREATE TYPE "public"."credits_batch_status" AS ENUM('active', 'consumed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."credits_transaction_type" AS ENUM('purchase', 'consumption', 'monthly_grant', 'registration_bonus', 'admin_grant', 'expiration', 'refund');--> statement-breakpoint
CREATE TYPE "public"."external_api_key_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."generation_mode" AS ENUM('text_to_image', 'image_to_image', 'image_editing', 'inpainting', 'upscaling');--> statement-breakpoint
CREATE TYPE "public"."image_job_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."photo_source" AS ENUM('upload', 'generation');--> statement-breakpoint
CREATE TYPE "public"."product_effect_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."prompt_order_history_trigger" AS ENUM('regenerate_single', 'regenerate_all', 'failed_reupload', 'restore');--> statement-breakpoint
CREATE TYPE "public"."prompt_order_platform" AS ENUM('taobao', 'douyin', 'xiaohongshu', 'kol', 'partner');--> statement-breakpoint
CREATE TYPE "public"."prompt_order_status" AS ENUM('PENDING', 'GENERATING', 'CANDIDATES_READY', 'SELECTED', 'CANCELLED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."prompt_scene" AS ENUM('generate_2d', 'generate_3d', 'translate', 'stylize', 'enhance', 'custom');--> statement-breakpoint
CREATE TYPE "public"."ticket_category" AS ENUM('billing', 'technical', 'bug', 'feature', 'other');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'in_progress', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"phone" text,
	"email" text,
	"remark" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"image_gen_token" text,
	"credit_balance" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_image_gen_token_unique" UNIQUE("image_gen_token")
);
--> statement-breakpoint
CREATE TABLE "agent_credit_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"type" "agent_credit_txn_type" NOT NULL,
	"amount" integer NOT NULL,
	"order_id" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_prompt_template" (
	"agent_id" text NOT NULL,
	"prompt_template_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_prompt_template_agent_id_prompt_template_id_pk" PRIMARY KEY("agent_id","prompt_template_id")
);
--> statement-breakpoint
CREATE TABLE "canvas_remote_job" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"capability" "canvas_remote_capability" NOT NULL,
	"mode" text NOT NULL,
	"payload" json NOT NULL,
	"status" "canvas_remote_job_status" DEFAULT 'pending' NOT NULL,
	"result" json,
	"error" text,
	"credits_consumed" integer,
	"transaction_id" text,
	"provider_job_id" text,
	"inngest_event_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "credits_balance" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"total_earned" integer DEFAULT 0 NOT NULL,
	"total_spent" integer DEFAULT 0 NOT NULL,
	"status" "credits_balance_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credits_balance_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "credits_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount" integer NOT NULL,
	"remaining" integer NOT NULL,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"status" "credits_batch_status" DEFAULT 'active' NOT NULL,
	"source_type" "credits_batch_source" NOT NULL,
	"source_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credits_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "credits_transaction_type" NOT NULL,
	"amount" integer NOT NULL,
	"debit_account" text NOT NULL,
	"credit_account" text NOT NULL,
	"description" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"status" "external_api_key_status" DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"monthly_quota" integer DEFAULT 100 NOT NULL,
	"monthly_calls" integer DEFAULT 0 NOT NULL,
	"monthly_calls_reset_at" timestamp DEFAULT now() NOT NULL,
	"total_calls" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"allowed_masks" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "image_job" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"photo_id" text,
	"mask_id" text,
	"model" text NOT NULL,
	"mode" "generation_mode" NOT NULL,
	"prompt" text NOT NULL,
	"negative_prompt" text,
	"image_url" text,
	"size" text DEFAULT '1024x1024' NOT NULL,
	"batch_size" integer DEFAULT 1 NOT NULL,
	"seed" integer,
	"guidance_scale" integer,
	"num_inference_steps" integer,
	"status" "image_job_status" DEFAULT 'pending' NOT NULL,
	"result_urls" json DEFAULT '[]'::json NOT NULL,
	"revised_prompt" text,
	"error_msg" text,
	"generate_duration" integer,
	"cost" integer,
	"currency" text,
	"credits_consumed" integer,
	"task_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscriber" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"is_subscribed" boolean DEFAULT true NOT NULL,
	"subscribed_at" timestamp DEFAULT now() NOT NULL,
	"unsubscribed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_subscriber_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "photo" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source" "photo_source" DEFAULT 'upload' NOT NULL,
	"image_job_id" text,
	"prompt" text,
	"model" text,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"thumbnail_url" text,
	"md5" text,
	"width" integer,
	"height" integer,
	"format" text,
	"file_size" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preview_share" (
	"id" text PRIMARY KEY NOT NULL,
	"order_no" text NOT NULL,
	"token" text NOT NULL,
	"template_id" text NOT NULL,
	"reference_image_url" text NOT NULL,
	"demo_preview_url" text NOT NULL,
	"candidates" text NOT NULL,
	"selected_cell" integer,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"credits_breakdown" text,
	"product_type_code" text,
	"product_size" text,
	"accessory_code" text,
	"engraving_text" text,
	"engraving_exposed" boolean,
	"leather_color" text,
	"leather_exposed" boolean,
	"pvc_protection" boolean,
	"remarks" text,
	"platform" text,
	"platform_order_no" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" text,
	"linked_order_id" text,
	"confirmed_at" timestamp,
	"confirmed_by_ip" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"uploaded_images" text,
	"images_per_upload" integer DEFAULT 1 NOT NULL,
	"upload_count" integer DEFAULT 1 NOT NULL,
	"uploaded_at" timestamp,
	"generated_at" timestamp,
	"selections" text,
	"selected_index" integer,
	"selected_at" timestamp,
	"selected_batch_count" integer DEFAULT 0 NOT NULL,
	"generation_task" text,
	"error_message" text,
	"cancelled_at" timestamp,
	"credits_locked" integer DEFAULT 0 NOT NULL,
	"credits_locked_at" timestamp,
	"regenerate_limit" integer DEFAULT 3 NOT NULL,
	"used_regenerate_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "preview_share_order_no_unique" UNIQUE("order_no"),
	CONSTRAINT "preview_share_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "product_effect" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT '其他' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"preview_url" text NOT NULL,
	"prompt" text NOT NULL,
	"variables" json DEFAULT '[]'::json NOT NULL,
	"model" text DEFAULT 'qwen' NOT NULL,
	"config" json DEFAULT '{"style":"custom"}'::json NOT NULL,
	"scene" "prompt_scene" DEFAULT 'generate_2d' NOT NULL,
	"prompt_template_id" text,
	"versions" json DEFAULT '[]'::json NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"status" "product_effect_status" DEFAULT 'active' NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"success_rate" integer DEFAULT 0 NOT NULL,
	"avg_duration" integer DEFAULT 0 NOT NULL,
	"author" text DEFAULT 'admin' NOT NULL,
	"product_line_ids" json DEFAULT '[]'::json NOT NULL,
	"product_type_code" text,
	"allowed_sizes" text,
	"allowed_accessories" text,
	"allowed_capabilities" text,
	"allowed_colors" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_line" (
	"product_line_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cover_url" text DEFAULT '' NOT NULL,
	"spec" text DEFAULT '' NOT NULL,
	"pricing" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_order" (
	"id" text PRIMARY KEY NOT NULL,
	"order_no" text NOT NULL,
	"template_id" text NOT NULL,
	"recipient_name" text DEFAULT '' NOT NULL,
	"platform" text,
	"platform_order_no" text,
	"token" text NOT NULL,
	"status" "prompt_order_status" DEFAULT 'PENDING' NOT NULL,
	"uploaded_images" text,
	"upload_count" integer DEFAULT 1 NOT NULL,
	"images_per_upload" integer DEFAULT 3 NOT NULL,
	"regenerate_limit" integer DEFAULT 5 NOT NULL,
	"candidates" text,
	"selected_index" integer,
	"selections" text,
	"error_message" text,
	"credits_charged" integer,
	"credits_breakdown" text,
	"product_type_code" text,
	"product_size" text,
	"accessory_code" text,
	"engraving_text" text,
	"engraving_exposed" boolean,
	"leather_color" text,
	"leather_exposed" boolean,
	"pvc_protection" boolean,
	"remarks" text,
	"agent_id" text,
	"generation_task" text,
	"uploaded_at" timestamp,
	"generated_at" timestamp,
	"selected_at" timestamp,
	"cancelled_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_order_order_no_unique" UNIQUE("order_no"),
	CONSTRAINT "prompt_order_token_unique" UNIQUE("token")
);
--> statement-breakpoint
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
);
--> statement-breakpoint
CREATE TABLE "prompt_template" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"prompt" text NOT NULL,
	"variables" json DEFAULT '[]'::json NOT NULL,
	"model" text DEFAULT 'qwen',
	"price" integer DEFAULT 0 NOT NULL,
	"size" text DEFAULT '1024x1024' NOT NULL,
	"candidate_count" integer DEFAULT 4 NOT NULL,
	"cover_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"output_mode" text DEFAULT 'grid' NOT NULL,
	"product_type_code" text,
	"allowed_sizes" text,
	"allowed_accessories" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_template_price" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"spec_key" text NOT NULL,
	"price_delta" integer DEFAULT 0 NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"price_id" text NOT NULL,
	"status" text DEFAULT 'incomplete' NOT NULL,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_subscription_id_unique" UNIQUE("subscription_id")
);
--> statement-breakpoint
CREATE TABLE "ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subject" text NOT NULL,
	"category" "ticket_category" DEFAULT 'other' NOT NULL,
	"priority" "ticket_priority" DEFAULT 'medium' NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_message" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"is_admin_response" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"banned_reason" text,
	"needs_verification" boolean DEFAULT false NOT NULL,
	"customer_id" text,
	"agent_id" text,
	"phone_number" text,
	"phone_number_verified" boolean DEFAULT false NOT NULL,
	"wechat_openid" text,
	"wechat_unionid" text,
	"medusa_customer_id" text,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_customer_id_unique" UNIQUE("customer_id"),
	CONSTRAINT "user_phone_number_unique" UNIQUE("phone_number"),
	CONSTRAINT "user_wechat_openid_unique" UNIQUE("wechat_openid")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credit_transaction" ADD CONSTRAINT "agent_credit_transaction_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credit_transaction" ADD CONSTRAINT "agent_credit_transaction_order_id_prompt_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."prompt_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_prompt_template" ADD CONSTRAINT "agent_prompt_template_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_prompt_template" ADD CONSTRAINT "agent_prompt_template_prompt_template_id_prompt_template_id_fk" FOREIGN KEY ("prompt_template_id") REFERENCES "public"."prompt_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_remote_job" ADD CONSTRAINT "canvas_remote_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits_balance" ADD CONSTRAINT "credits_balance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits_batch" ADD CONSTRAINT "credits_batch_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits_transaction" ADD CONSTRAINT "credits_transaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_api_key" ADD CONSTRAINT "external_api_key_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_job" ADD CONSTRAINT "image_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_job" ADD CONSTRAINT "image_job_photo_id_photo_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photo"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_image_job_id_image_job_id_fk" FOREIGN KEY ("image_job_id") REFERENCES "public"."image_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_share" ADD CONSTRAINT "preview_share_template_id_prompt_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."prompt_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_share" ADD CONSTRAINT "preview_share_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_order" ADD CONSTRAINT "prompt_order_template_id_prompt_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."prompt_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_order" ADD CONSTRAINT "prompt_order_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_order" ADD CONSTRAINT "prompt_order_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_order_history" ADD CONSTRAINT "prompt_order_history_order_id_prompt_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."prompt_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_template_price" ADD CONSTRAINT "prompt_template_price_template_id_prompt_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."prompt_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_message" ADD CONSTRAINT "ticket_message_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_message" ADD CONSTRAINT "ticket_message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "act_agent_created_idx" ON "agent_credit_transaction" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "act_order_idx" ON "agent_credit_transaction" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "apt_agent_idx" ON "agent_prompt_template" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "apt_template_idx" ON "agent_prompt_template" USING btree ("prompt_template_id");--> statement-breakpoint
CREATE INDEX "crj_user_created_idx" ON "canvas_remote_job" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "crj_status_idx" ON "canvas_remote_job" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "external_api_key_hash_unique" ON "external_api_key" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "external_api_key_status_idx" ON "external_api_key" USING btree ("status","deleted_at");--> statement-breakpoint
CREATE INDEX "preview_share_creator_created_idx" ON "preview_share" USING btree ("created_by","created_at" desc);--> statement-breakpoint
CREATE INDEX "preview_share_status_expires_idx" ON "preview_share" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "preview_share_linked_order_idx" ON "preview_share" USING btree ("linked_order_id");--> statement-breakpoint
CREATE INDEX "preview_share_uploads_idx" ON "preview_share" USING btree ("token","status");--> statement-breakpoint
CREATE INDEX "product_line_status_idx" ON "product_line" USING btree ("status");--> statement-breakpoint
CREATE INDEX "prompt_order_template_idx" ON "prompt_order" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "prompt_order_status_idx" ON "prompt_order" USING btree ("status");--> statement-breakpoint
CREATE INDEX "prompt_order_created_by_idx" ON "prompt_order" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "prompt_order_agent_id_idx" ON "prompt_order" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "prompt_order_cursor_idx" ON "prompt_order" USING btree ("created_by","created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "prompt_order_cursor_status_idx" ON "prompt_order" USING btree ("created_by","status","created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "prompt_order_admin_cursor_idx" ON "prompt_order" USING btree ("status","created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "prompt_order_admin_all_cursor_idx" ON "prompt_order" USING btree ("created_at" desc,"id" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "poh_order_round_unique" ON "prompt_order_history" USING btree ("order_id","round");--> statement-breakpoint
CREATE INDEX "poh_order_created_at_idx" ON "prompt_order_history" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "poh_order_trigger_image_idx_idx" ON "prompt_order_history" USING btree ("order_id","trigger","image_idx");--> statement-breakpoint
CREATE UNIQUE INDEX "ptp_template_spec_unique" ON "prompt_template_price" USING btree ("template_id","spec_key");--> statement-breakpoint
CREATE INDEX "ptp_template_idx" ON "prompt_template_price" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "user_agent_id_idx" ON "user" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "user_wechat_unionid_idx" ON "user" USING btree ("wechat_unionid");--> statement-breakpoint
CREATE INDEX "user_medusa_customer_id_idx" ON "user" USING btree ("medusa_customer_id");