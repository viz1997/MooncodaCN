CREATE TABLE "product_accessory_variant" (
	"id" text PRIMARY KEY NOT NULL,
	"product_type_code" text NOT NULL,
	"accessory_code" text NOT NULL,
	"variant_code" text NOT NULL,
	"name" text NOT NULL,
	"name_en" text NOT NULL,
	"swatch" text,
	"price_delta_cents" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prompt_template" ADD COLUMN "styles" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pav_uniq_idx" ON "product_accessory_variant" USING btree ("product_type_code","accessory_code","variant_code");--> statement-breakpoint
CREATE INDEX "pav_lookup_idx" ON "product_accessory_variant" USING btree ("product_type_code","accessory_code","is_active");