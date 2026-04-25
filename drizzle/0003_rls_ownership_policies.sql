-- Enable Row Level Security on all user-owned tables
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audio_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "arrangement_clips" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "take_edges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "generation_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quota_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "export_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provider_events" ENABLE ROW LEVEL SECURITY;

-- ─── projects ───────────────────────────────────────────────────────────────
CREATE POLICY "projects_select" ON "projects"
  FOR SELECT USING (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "projects_insert" ON "projects"
  FOR INSERT WITH CHECK (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "projects_update" ON "projects"
  FOR UPDATE USING (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "projects_delete" ON "projects"
  FOR DELETE USING (owner_id = current_setting('app.user_id', true)::uuid);

-- ─── audio_assets ──────────────────────────────────────────────────────────
CREATE POLICY "audio_assets_select" ON "audio_assets"
  FOR SELECT USING (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "audio_assets_insert" ON "audio_assets"
  FOR INSERT WITH CHECK (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "audio_assets_update" ON "audio_assets"
  FOR UPDATE USING (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "audio_assets_delete" ON "audio_assets"
  FOR DELETE USING (owner_id = current_setting('app.user_id', true)::uuid);

-- ─── arrangement_clips ─────────────────────────────────────────────────────
CREATE POLICY "arrangement_clips_select" ON "arrangement_clips"
  FOR SELECT USING (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "arrangement_clips_insert" ON "arrangement_clips"
  FOR INSERT WITH CHECK (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "arrangement_clips_update" ON "arrangement_clips"
  FOR UPDATE USING (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "arrangement_clips_delete" ON "arrangement_clips"
  FOR DELETE USING (owner_id = current_setting('app.user_id', true)::uuid);

-- ─── take_edges ────────────────────────────────────────────────────────────
CREATE POLICY "take_edges_select" ON "take_edges"
  FOR SELECT USING (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "take_edges_insert" ON "take_edges"
  FOR INSERT WITH CHECK (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "take_edges_update" ON "take_edges"
  FOR UPDATE USING (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "take_edges_delete" ON "take_edges"
  FOR DELETE USING (owner_id = current_setting('app.user_id', true)::uuid);

-- ─── generation_jobs ───────────────────────────────────────────────────────
CREATE POLICY "generation_jobs_select" ON "generation_jobs"
  FOR SELECT USING (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "generation_jobs_insert" ON "generation_jobs"
  FOR INSERT WITH CHECK (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "generation_jobs_update" ON "generation_jobs"
  FOR UPDATE USING (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "generation_jobs_delete" ON "generation_jobs"
  FOR DELETE USING (owner_id = current_setting('app.user_id', true)::uuid);

-- ─── quota_reservations ────────────────────────────────────────────────────
CREATE POLICY "quota_reservations_select" ON "quota_reservations"
  FOR SELECT USING (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "quota_reservations_insert" ON "quota_reservations"
  FOR INSERT WITH CHECK (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "quota_reservations_update" ON "quota_reservations"
  FOR UPDATE USING (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "quota_reservations_delete" ON "quota_reservations"
  FOR DELETE USING (owner_id = current_setting('app.user_id', true)::uuid);

-- ─── export_jobs ───────────────────────────────────────────────────────────
CREATE POLICY "export_jobs_select" ON "export_jobs"
  FOR SELECT USING (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "export_jobs_insert" ON "export_jobs"
  FOR INSERT WITH CHECK (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "export_jobs_update" ON "export_jobs"
  FOR UPDATE USING (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "export_jobs_delete" ON "export_jobs"
  FOR DELETE USING (owner_id = current_setting('app.user_id', true)::uuid);

-- ─── provider_events ───────────────────────────────────────────────────────
CREATE POLICY "provider_events_select" ON "provider_events"
  FOR SELECT USING (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "provider_events_insert" ON "provider_events"
  FOR INSERT WITH CHECK (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "provider_events_update" ON "provider_events"
  FOR UPDATE USING (owner_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY "provider_events_delete" ON "provider_events"
  FOR DELETE USING (owner_id = current_setting('app.user_id', true)::uuid);
