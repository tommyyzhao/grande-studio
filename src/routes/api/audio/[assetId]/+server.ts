import { error } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { createLocalDb, createNeonDb } from '$lib/server/db';
import { audioAssets } from '$lib/server/db/schema';
import { withRLS } from '$lib/server/db/rls';
import { createR2StorageService } from '$lib/services/r2-storage';

function getDb() {
	const dbUrl = process.env.DATABASE_URL ?? '';
	return dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);
}

/**
 * GET /api/audio/[assetId]
 * Redirects to a signed R2 URL for the audio asset.
 * Requires authentication and asset ownership (enforced by RLS).
 */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user) {
		error(401, { message: 'Authentication required.' });
	}

	const { assetId } = params;
	const db = getDb();

	const [asset] = await withRLS(db, locals.user.id, async (tx) => {
		return tx
			.select({ r2ObjectKey: audioAssets.r2ObjectKey, status: audioAssets.status })
			.from(audioAssets)
			.where(and(eq(audioAssets.id, assetId), eq(audioAssets.status, 'ready')))
			.limit(1);
	});

	if (!asset || !asset.r2ObjectKey) {
		error(404, { message: 'Audio asset not found.' });
	}

	const bucket = platform?.env?.AUDIO_BUCKET;
	const signingSecret = process.env.R2_SIGNING_SECRET ?? '';
	const baseUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:5173';

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
