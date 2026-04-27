import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLocalDb, createNeonDb } from '$lib/server/db';
import { audioAssets, generationJobs } from '$lib/server/db/schema';
import type { JobType } from '$lib/server/db/schema';
import { withRLS } from '$lib/server/db/rls';
import {
	validateMusicRequest,
	type MusicRequestInput,
	type MusicRequestMode
} from '$lib/providers/minimax/validateMusicRequest';
import {
	createQuotaService,
	createDrizzleQuotaRepository,
	DAILY_LIMIT,
	TEMP_SESSION_LIMIT
} from '$lib/services/quota';
import { getEffectiveUserId, isTempSession } from '$lib/server/effective-user';
import { getEnv } from '$lib/server/env';
import { inngest } from '$lib/server/inngest/client';

interface GenerateRequestBody {
	projectId: string;
	prompt: string;
	mode: MusicRequestMode;
	lyrics?: string;
	instrumental?: boolean;
	lyricsOptimizer?: boolean;
	structureTags?: string[];
	sourceAssetId?: string;
	idempotencyKey: string;
}

function modeToJobType(mode: MusicRequestMode): JobType {
	switch (mode) {
		case 'text_to_music':
			return 'text_to_music';
		case 'instrumental':
			return 'instrumental';
		case 'cover_restyle':
			return 'cover_restyle';
	}
}

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	const env = getEnv(event);
	// 1. Validate session (authenticated user OR temp session)
	const userId = getEffectiveUserId(locals);
	if (!userId) {
		error(401, { message: 'Session required. Please sign in or refresh the page.' });
	}

	const isTemp = isTempSession(locals);

	// 2. Parse JSON request body
	let body: GenerateRequestBody;
	try {
		body = await request.json();
	} catch {
		error(400, { message: 'Invalid JSON request body.' });
	}

	const {
		projectId,
		prompt,
		mode,
		lyrics,
		instrumental,
		lyricsOptimizer,
		structureTags,
		sourceAssetId,
		idempotencyKey
	} = body;

	if (!projectId || typeof projectId !== 'string') {
		error(400, { message: 'Missing required field: projectId' });
	}

	if (!idempotencyKey || typeof idempotencyKey !== 'string') {
		error(400, { message: 'Missing required field: idempotencyKey' });
	}

	if (!mode || !['text_to_music', 'instrumental', 'cover_restyle'].includes(mode)) {
		error(400, { message: "Missing or invalid field: mode. Must be 'text_to_music', 'instrumental', or 'cover_restyle'." });
	}

	// 3. Validate through MiniMax validator
	const validationInput: MusicRequestInput = {
		mode,
		prompt: prompt ?? '',
		lyrics,
		instrumental: instrumental ?? (mode === 'instrumental'),
		lyricsOptimizer,
		structureTags,
		sourceAssetId
	};

	const validation = validateMusicRequest(validationInput);

	if (!validation.valid) {
		error(400, {
			message: `Validation failed: ${validation.errors.map((e) => e.message).join('; ')}`
		});
	}

	// 4. Set up DB and check quota
	const dbUrl = env.DATABASE_URL;
	const db = dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);

	const limit = isTemp ? TEMP_SESSION_LIMIT : DAILY_LIMIT;

	{
		const quotaRepo = createDrizzleQuotaRepository(db);
		const quotaService = createQuotaService(quotaRepo);

		const usage = await quotaService.checkDailyUsage(userId);
		if (usage >= limit) {
			if (isTemp) {
				error(429, {
					message: `Session generation limit reached (${TEMP_SESSION_LIMIT}/${TEMP_SESSION_LIMIT}). Sign up to get more generations.`
				});
			} else {
				error(429, {
					message: `Daily generation limit reached (${DAILY_LIMIT}/${DAILY_LIMIT}). Resets at midnight UTC.`
				});
			}
		}
	}

	// 5. Create asset, job, and quota reservation within RLS transaction
	const jobType = modeToJobType(mode);

	const result = await withRLS(db, userId, async (tx) => {
		// Create audio_asset row with status='created'
		const [asset] = await tx
			.insert(audioAssets)
			.values({
				projectId,
				ownerId: userId,
				sourceType: 'generated',
				provider: 'minimax',
				providerModel: 'music-01',
				title: prompt.slice(0, 80) || 'Untitled',
				prompt,
				lyrics: lyrics ?? null,
				structureTagsJson: structureTags?.length ? structureTags : null,
				inputAssetIdsJson: sourceAssetId ? [sourceAssetId] : null,
				status: 'created'
			})
			.returning({ id: audioAssets.id });

		const assetId = asset.id;

		// Create generation_job row with status='created'
		const requestPayload = {
			mode,
			prompt,
			lyrics,
			instrumental: instrumental ?? (mode === 'instrumental'),
			lyricsOptimizer,
			structureTags,
			sourceAssetId
		};

		const [job] = await tx
			.insert(generationJobs)
			.values({
				projectId,
				ownerId: userId,
				provider: 'minimax',
				providerModel: 'music-01',
				jobType,
				status: 'created',
				requestJson: requestPayload,
				resultingAssetId: assetId,
				idempotencyKey
			})
			.returning({ id: generationJobs.id });

		const jobId = job.id;

		return { assetId, jobId };
	});

	// 6. Create quota reservation
	let quotaReservationId: string | undefined;
	{
		const quotaRepo = createDrizzleQuotaRepository(db);
		const quotaService = createQuotaService(quotaRepo);
		const quotaResult = await quotaService.reserveQuota(userId, result.jobId, idempotencyKey);
		if (!quotaResult.ok) {
			error(500, { message: `Failed to reserve quota: ${quotaResult.error}` });
		}
		quotaReservationId = quotaResult.reservation.id;
	}

	// 7. Send Inngest event to trigger generation workflow
	await inngest.send({
		name: 'generation/requested',
		data: {
			jobId: result.jobId,
			assetId: result.assetId,
			projectId,
			ownerId: userId,
			provider: 'minimax',
			jobType,
			idempotencyKey,
			quotaReservationId: quotaReservationId ?? null
		}
	});

	// 8. Return job and asset IDs
	return json(
		{
			jobId: result.jobId,
			assetId: result.assetId,
			warnings: validation.warnings.length > 0 ? validation.warnings : undefined
		},
		{ status: 201 }
	);
};
