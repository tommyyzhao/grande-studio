// Drizzle ORM schema definitions
import {
	pgTable,
	uuid,
	text,
	timestamp,
	jsonb,
	numeric,
	integer,
	boolean,
	index,
	check
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── projects ───────────────────────────────────────────────────────────────
export const projects = pgTable('projects', {
	id: uuid('id').primaryKey().defaultRandom(),
	ownerId: uuid('owner_id').notNull(),
	title: text('title').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	deletedAt: timestamp('deleted_at', { withTimezone: true })
});

// ─── audio_assets ───────────────────────────────────────────────────────────
export const sourceTypeEnum = ['generated', 'uploaded', 'imported', 'rendered_export'] as const;
export type SourceType = (typeof sourceTypeEnum)[number];

export const providerEnum = ['minimax', 'elevenlabs', 'stability', 'local_upload', 'browser_render'] as const;
export type Provider = (typeof providerEnum)[number];

export const assetStatusEnum = [
	'created',
	'queued',
	'generating',
	'receiving_audio',
	'persisting',
	'ready',
	'failed',
	'deleted'
] as const;
export type AssetStatus = (typeof assetStatusEnum)[number];

export const audioAssets = pgTable(
	'audio_assets',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		ownerId: uuid('owner_id').notNull(),
		sourceType: text('source_type').notNull().$type<SourceType>(),
		provider: text('provider').notNull().$type<Provider>(),
		providerModel: text('provider_model'),
		providerJobId: text('provider_job_id'),
		title: text('title').notNull(),
		prompt: text('prompt'),
		lyrics: text('lyrics'),
		structureTagsJson: jsonb('structure_tags_json'),
		inputAssetIdsJson: jsonb('input_asset_ids_json'),
		r2ObjectKey: text('r2_object_key'),
		durationSec: numeric('duration_sec'),
		format: text('format'),
		sampleRate: integer('sample_rate'),
		bitDepth: integer('bit_depth'),
		status: text('status').notNull().$type<AssetStatus>().default('created'),
		errorJson: jsonb('error_json'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(table) => [
		index('audio_assets_owner_id_idx').on(table.ownerId),
		index('audio_assets_project_id_idx').on(table.projectId)
	]
);

// ─── arrangement_clips ─────────────────────────────────────────────────────
export const arrangementClips = pgTable(
	'arrangement_clips',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		ownerId: uuid('owner_id').notNull(),
		assetId: uuid('asset_id')
			.notNull()
			.references(() => audioAssets.id),
		startTimeSec: numeric('start_time_sec').notNull().default('0'),
		trimStartSec: numeric('trim_start_sec').notNull().default('0'),
		trimEndSec: numeric('trim_end_sec'),
		clipDurationSec: numeric('clip_duration_sec').notNull(),
		gainDb: numeric('gain_db').notNull().default('0'),
		muted: boolean('muted').notNull().default(false),
		soloed: boolean('soloed').notNull().default(false),
		layerOrder: integer('layer_order').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(table) => [
		index('arrangement_clips_owner_id_idx').on(table.ownerId),
		index('arrangement_clips_project_id_idx').on(table.projectId),
		index('arrangement_clips_asset_id_idx').on(table.assetId)
	]
);

// ─── generation_jobs ──────────────────────────────────────────────────────
export const jobTypeEnum = ['text_to_music', 'instrumental', 'cover_restyle'] as const;
export type JobType = (typeof jobTypeEnum)[number];

export const jobStatusEnum = [
	'created',
	'queued',
	'generating',
	'receiving_audio',
	'persisting',
	'succeeded',
	'failed',
	'cancelled'
] as const;
export type JobStatus = (typeof jobStatusEnum)[number];

export const generationJobs = pgTable(
	'generation_jobs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		ownerId: uuid('owner_id').notNull(),
		provider: text('provider').notNull().$type<Provider>(),
		providerModel: text('provider_model'),
		jobType: text('job_type').notNull().$type<JobType>(),
		status: text('status').notNull().$type<JobStatus>().default('created'),
		requestJson: jsonb('request_json').notNull(),
		responseJson: jsonb('response_json'),
		errorJson: jsonb('error_json'),
		errorCode: text('error_code'),
		quotaReservationId: uuid('quota_reservation_id'),
		resultingAssetId: uuid('resulting_asset_id').references(() => audioAssets.id),
		idempotencyKey: text('idempotency_key').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('generation_jobs_owner_id_idx').on(table.ownerId),
		index('generation_jobs_project_id_idx').on(table.projectId),
		index('generation_jobs_resulting_asset_id_idx').on(table.resultingAssetId),
		index('generation_jobs_idempotency_key_idx').on(table.idempotencyKey)
	]
);

// ─── quota_reservations ───────────────────────────────────────────────────
export const quotaStatusEnum = ['reserved', 'committed', 'released', 'expired'] as const;
export type QuotaStatus = (typeof quotaStatusEnum)[number];

export const quotaReservations = pgTable(
	'quota_reservations',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		ownerId: uuid('owner_id').notNull(),
		generationJobId: uuid('generation_job_id').references(() => generationJobs.id),
		idempotencyKey: text('idempotency_key').notNull(),
		unitsReserved: integer('units_reserved').notNull(),
		status: text('status').notNull().$type<QuotaStatus>().default('reserved'),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('quota_reservations_owner_id_idx').on(table.ownerId),
		index('quota_reservations_idempotency_key_idx').on(table.idempotencyKey)
	]
);

// ─── export_jobs ──────────────────────────────────────────────────────────
export const exportTypeEnum = ['block_source', 'rough_mixdown'] as const;
export type ExportType = (typeof exportTypeEnum)[number];

export const exportStatusEnum = ['created', 'rendering_client', 'uploading', 'ready', 'failed'] as const;
export type ExportStatus = (typeof exportStatusEnum)[number];

export const exportJobs = pgTable(
	'export_jobs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		ownerId: uuid('owner_id').notNull(),
		exportType: text('export_type').notNull().$type<ExportType>(),
		status: text('status').notNull().$type<ExportStatus>().default('created'),
		snapshotVersion: integer('snapshot_version').notNull().default(1),
		arrangementSnapshotJson: jsonb('arrangement_snapshot_json'),
		r2ObjectKey: text('r2_object_key'),
		errorJson: jsonb('error_json'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('export_jobs_owner_id_idx').on(table.ownerId),
		index('export_jobs_project_id_idx').on(table.projectId)
	]
);

// ─── provider_events ─────────────────────────────────────────────────────
export const providerEvents = pgTable(
	'provider_events',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		ownerId: uuid('owner_id').notNull(),
		generationJobId: uuid('generation_job_id').references(() => generationJobs.id),
		provider: text('provider').notNull().$type<Provider>(),
		eventType: text('event_type').notNull(),
		payloadJson: jsonb('payload_json'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('provider_events_owner_id_idx').on(table.ownerId),
		index('provider_events_generation_job_id_idx').on(table.generationJobId)
	]
);

// ─── take_edges ────────────────────────────────────────────────────────────
export const branchTypeEnum = [
	'prompt_variation',
	'lyric_edit',
	'instrumental_variant',
	'cover_restyle',
	'reference_from_asset',
	'manual_duplicate',
	'other'
] as const;
export type BranchType = (typeof branchTypeEnum)[number];

export const takeEdges = pgTable(
	'take_edges',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id),
		ownerId: uuid('owner_id').notNull(),
		parentAssetId: uuid('parent_asset_id')
			.notNull()
			.references(() => audioAssets.id),
		childAssetId: uuid('child_asset_id')
			.notNull()
			.references(() => audioAssets.id),
		branchType: text('branch_type').notNull().$type<BranchType>(),
		branchPrompt: text('branch_prompt'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(table) => [
		index('take_edges_owner_id_idx').on(table.ownerId),
		index('take_edges_project_id_idx').on(table.projectId),
		index('take_edges_parent_asset_id_idx').on(table.parentAssetId),
		index('take_edges_child_asset_id_idx').on(table.childAssetId),
		check('take_edges_no_self_edge', sql`${table.parentAssetId} <> ${table.childAssetId}`)
	]
);
