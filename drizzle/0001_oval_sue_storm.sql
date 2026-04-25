CREATE TABLE "arrangement_clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"start_time_sec" numeric DEFAULT '0' NOT NULL,
	"trim_start_sec" numeric DEFAULT '0' NOT NULL,
	"trim_end_sec" numeric,
	"clip_duration_sec" numeric NOT NULL,
	"gain_db" numeric DEFAULT '0' NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"soloed" boolean DEFAULT false NOT NULL,
	"layer_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "take_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"parent_asset_id" uuid NOT NULL,
	"child_asset_id" uuid NOT NULL,
	"branch_type" text NOT NULL,
	"branch_prompt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "take_edges_no_self_edge" CHECK ("take_edges"."parent_asset_id" <> "take_edges"."child_asset_id")
);
--> statement-breakpoint
ALTER TABLE "arrangement_clips" ADD CONSTRAINT "arrangement_clips_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangement_clips" ADD CONSTRAINT "arrangement_clips_asset_id_audio_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."audio_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "take_edges" ADD CONSTRAINT "take_edges_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "take_edges" ADD CONSTRAINT "take_edges_parent_asset_id_audio_assets_id_fk" FOREIGN KEY ("parent_asset_id") REFERENCES "public"."audio_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "take_edges" ADD CONSTRAINT "take_edges_child_asset_id_audio_assets_id_fk" FOREIGN KEY ("child_asset_id") REFERENCES "public"."audio_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arrangement_clips_owner_id_idx" ON "arrangement_clips" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "arrangement_clips_project_id_idx" ON "arrangement_clips" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "arrangement_clips_asset_id_idx" ON "arrangement_clips" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "take_edges_owner_id_idx" ON "take_edges" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "take_edges_project_id_idx" ON "take_edges" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "take_edges_parent_asset_id_idx" ON "take_edges" USING btree ("parent_asset_id");--> statement-breakpoint
CREATE INDEX "take_edges_child_asset_id_idx" ON "take_edges" USING btree ("child_asset_id");