import { error } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { createLocalDb, createNeonDb } from '$lib/server/db';
import { audioAssets } from '$lib/server/db/schema';
import { withRLS } from '$lib/server/db/rls';
import { createR2StorageService } from '$lib/services/r2-storage';
import { getEffectiveUserId } from '$lib/server/effective-user';
import { getEnv } from '$lib/server/env';

/**
 * GET /api/audio/[assetId]
 * Redirects to a signed R2 URL for the audio asset.
 * Requires session and asset ownership (enforced by RLS).
 */
export const GET: RequestHandler = async (event) => {
	const { params, locals } = event;
	const env = getEnv(event);
	const userId = getEffectiveUserId(locals);
	if (!userId) {
		error(401, { message: 'Session required.' });
	}

	const { assetId } = params;
	const dbUrl = env.DATABASE_URL;
	const db = dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);

	const [asset] = await withRLS(db, userId, async (tx) => {
		return tx
			.select({ r2ObjectKey: audioAssets.r2ObjectKey, status: audioAssets.status })
			.from(audioAssets)
			.where(and(eq(audioAssets.id, assetId), eq(audioAssets.status, 'ready')))
			.limit(1);
	});

	if (!asset || !asset.r2ObjectKey) {
		error(404, { message: 'Audio asset not found.' });
	}

	const bucket = env.AUDIO_BUCKET;
	const signingSecret = env.R2_SIGNING_SECRET;
	const baseUrl = env.BETTER_AUTH_URL;

	if (!bucket) {
		error(503, { message: 'Audio storage not available.' });
	}

	const r2 = createR2StorageService(bucket, signingSecret, baseUrl);
	const signedUrl = await r2.getSignedUrl(asset.r2ObjectKey);

	return new Response(null, {
		status: 302,
		headers: { Location: signedUrl }
	});
};
