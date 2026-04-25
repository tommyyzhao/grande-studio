CREATE TABLE "export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"export_type" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"snapshot_version" integer DEFAULT 1 NOT NULL,
	"arrangement_snapshot_json" jsonb,
	"r2_object_key" text,
	"error_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_model" text,
	"job_type" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"request_json" jsonb NOT NULL,
	"response_json" jsonb,
	"error_json" jsonb,
	"error_code" text,
	"quota_reservation_id" uuid,
	"resulting_asset_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"generation_job_id" uuid,
	"provider" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"generation_job_id" uuid,
	"idempotency_key" text NOT NULL,
	"units_reserved" integer NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_resulting_asset_id_audio_assets_id_fk" FOREIGN KEY ("resulting_asset_id") REFERENCES "public"."audio_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_jobs_owner_id_idx" ON "export_jobs" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "export_jobs_project_id_idx" ON "export_jobs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_owner_id_idx" ON "generation_jobs" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_project_id_idx" ON "generation_jobs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_resulting_asset_id_idx" ON "generation_jobs" USING btree ("resulting_asset_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_idempotency_key_idx" ON "generation_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "provider_events_owner_id_idx" ON "provider_events" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "provider_events_generation_job_id_idx" ON "provider_events" USING btree ("generation_job_id");--> statement-breakpoint
CREATE INDEX "quota_reservations_owner_id_idx" ON "quota_reservations" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "quota_reservations_idempotency_key_idx" ON "quota_reservations" USING btree ("idempotency_key");