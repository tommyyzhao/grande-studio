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
