CREATE TABLE "audio_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_model" text,
	"provider_job_id" text,
	"title" text NOT NULL,
	"prompt" text,
	"lyrics" text,
	"structure_tags_json" jsonb,
	"input_asset_ids_json" jsonb,
	"r2_object_key" text,
	"duration_sec" numeric,
	"format" text,
	"sample_rate" integer,
	"bit_depth" integer,
	"status" text DEFAULT 'created' NOT NULL,
	"error_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audio_assets" ADD CONSTRAINT "audio_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audio_assets_owner_id_idx" ON "audio_assets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "audio_assets_project_id_idx" ON "audio_assets" USING btree ("project_id");