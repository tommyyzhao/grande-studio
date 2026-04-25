// Drizzle ORM schema definitions
import {
	pgTable,
	uuid,
	text,
	timestamp,
	jsonb,
	numeric,
	integer,
	index
} from 'drizzle-orm/pg-core';

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
