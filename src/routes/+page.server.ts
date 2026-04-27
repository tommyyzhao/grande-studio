import type { PageServerLoad } from './$types';
import { createLocalDb, createNeonDb } from '$lib/server/db';
import { projects, audioAssets, generationJobs } from '$lib/server/db/schema';
import { withRLS } from '$lib/server/db/rls';
import { eq, isNull, and, desc } from 'drizzle-orm';
import {
	createQuotaService,
	createDrizzleQuotaRepository,
	DAILY_LIMIT,
	TEMP_SESSION_LIMIT
} from '$lib/services/quota';
import type { BlockAsset } from '$lib/types';
import { getEnv } from '$lib/server/env';

export const load: PageServerLoad = async (event) => {
	const { locals } = event;
	const env = getEnv(event);

	function getDb() {
		const dbUrl = env.DATABASE_URL;
		return dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);
	}
	const user = locals.user;
	const tempSessionId = locals.tempSessionId;

	// Determine effective user ID (authenticated user or temp session)
	const effectiveUserId = user?.id ?? tempSessionId;

	if (!effectiveUserId) {
		// No auth and no temp session — should not happen (hooks.server.ts always sets tempSessionId)
		return {
			project: null,
			quotaUsed: 0,
			quotaLimit: DAILY_LIMIT,
			assets: [] as BlockAsset[],
			isTemp: true
		};
	}

	const db = getDb();

	if (!user) {
		// ─── Temp user: create or find temp project ────────────────────────
		// Temp projects are stored in DB (required for FK constraints on assets/jobs)
		// but are ephemeral — the temp session cookie expires when browser closes.
		const existingProjects = await withRLS(db, effectiveUserId, async (tx) => {
			return tx
				.select()
				.from(projects)
				.where(and(eq(projects.ownerId, effectiveUserId), isNull(projects.deletedAt)))
				.limit(1);
		});

		let project: { id: string; title: string };

		if (existingProjects.length > 0) {
			project = { id: existingProjects[0].id, title: existingProjects[0].title };
		} else {
			const [created] = await withRLS(db, effectiveUserId, async (tx) => {
				return tx
					.insert(projects)
					.values({
						ownerId: effectiveUserId,
						title: 'Untitled Project'
					})
					.returning({ id: projects.id, title: projects.title });
			});
			project = created;
		}

		// Fetch existing audio assets for this temp project
		const assetRows = await withRLS(db, effectiveUserId, async (tx) => {
			return tx
				.select({
					id: audioAssets.id,
					title: audioAssets.title,
					prompt: audioAssets.prompt,
					lyrics: audioAssets.lyrics,
					durationSec: audioAssets.durationSec,
					provider: audioAssets.provider,
					format: audioAssets.format,
					status: audioAssets.status,
					createdAt: audioAssets.createdAt,
					r2ObjectKey: audioAssets.r2ObjectKey,
					jobId: generationJobs.id,
					errorCode: generationJobs.errorCode
				})
				.from(audioAssets)
				.leftJoin(generationJobs, eq(generationJobs.resultingAssetId, audioAssets.id))
				.where(
					and(
						eq(audioAssets.projectId, project.id),
						isNull(audioAssets.deletedAt)
					)
				)
				.orderBy(desc(audioAssets.createdAt));
		});

		const assets: BlockAsset[] = assetRows.map((row) => ({
			id: row.id,
			title: row.title,
			prompt: row.prompt,
			lyrics: row.lyrics,
			durationSec: row.durationSec ? Number(row.durationSec) : null,
			provider: row.provider,
			format: row.format,
			status: row.status,
			createdAt: row.createdAt.toISOString(),
			jobId: row.jobId ?? null,
			errorCode: row.errorCode ?? null
		}));

		// Check session-based quota for temp user
		const quotaRepo = createDrizzleQuotaRepository(db);
		const quotaService = createQuotaService(quotaRepo);
		const quotaUsed = await quotaService.checkDailyUsage(effectiveUserId);

		return {
			project,
			quotaUsed,
			quotaLimit: TEMP_SESSION_LIMIT,
			assets,
			isTemp: true
		};
	}

	// ─── Authenticated user: find or create project ───────────────────────
	const existingProjects = await withRLS(db, user.id, async (tx) => {
		return tx
			.select()
			.from(projects)
			.where(and(eq(projects.ownerId, user.id), isNull(projects.deletedAt)))
			.limit(1);
	});

	let project: { id: string; title: string };

	if (existingProjects.length > 0) {
		project = { id: existingProjects[0].id, title: existingProjects[0].title };
	} else {
		// Auto-create a default project on first authenticated visit
		const [created] = await withRLS(db, user.id, async (tx) => {
			return tx
				.insert(projects)
				.values({
					ownerId: user.id,
					title: 'My Project'
				})
				.returning({ id: projects.id, title: projects.title });
		});
		project = created;
	}

	// Fetch daily quota usage
	const quotaRepo = createDrizzleQuotaRepository(db);
	const quotaService = createQuotaService(quotaRepo);
	const quotaUsed = await quotaService.checkDailyUsage(user.id);

	// Fetch existing audio assets for this project (non-deleted, newest first)
	const assetRows = await withRLS(db, user.id, async (tx) => {
		return tx
			.select({
				id: audioAssets.id,
				title: audioAssets.title,
				prompt: audioAssets.prompt,
				lyrics: audioAssets.lyrics,
				durationSec: audioAssets.durationSec,
				provider: audioAssets.provider,
				format: audioAssets.format,
				status: audioAssets.status,
				createdAt: audioAssets.createdAt,
				r2ObjectKey: audioAssets.r2ObjectKey,
				jobId: generationJobs.id,
				errorCode: generationJobs.errorCode
			})
			.from(audioAssets)
			.leftJoin(generationJobs, eq(generationJobs.resultingAssetId, audioAssets.id))
			.where(
				and(
					eq(audioAssets.projectId, project.id),
					isNull(audioAssets.deletedAt)
				)
			)
			.orderBy(desc(audioAssets.createdAt));
	});

	const assets: BlockAsset[] = assetRows.map((row) => ({
		id: row.id,
		title: row.title,
		prompt: row.prompt,
		lyrics: row.lyrics,
		durationSec: row.durationSec ? Number(row.durationSec) : null,
		provider: row.provider,
		format: row.format,
		status: row.status,
		createdAt: row.createdAt.toISOString(),
		jobId: row.jobId ?? null,
		errorCode: row.errorCode ?? null
	}));

	return {
		project,
		quotaUsed,
		quotaLimit: DAILY_LIMIT,
		assets,
		isTemp: false
	};
};
