import { error } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { createLocalDb, createNeonDb } from '$lib/server/db';
import { audioAssets } from '$lib/server/db/schema';
import { withRLS } from '$lib/server/db/rls';
import { getEffectiveUserId } from '$lib/server/effective-user';
import { getEnv } from '$lib/server/env';

/** Sanitize a string for use as a filename */
function sanitizeFilename(name: string): string {
	return name
		.replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
		.replace(/\s+/g, '_')
		.trim()
		.slice(0, 200) || 'untitled';
}

/** Map audio format to MIME content type */
function formatToContentType(format: string | null): string {
	switch (format?.toLowerCase()) {
		case 'mp3':
			return 'audio/mpeg';
		case 'wav':
			return 'audio/wav';
		case 'flac':
			return 'audio/flac';
		case 'm4a':
			return 'audio/mp4';
		default:
			return 'application/octet-stream';
	}
}

/**
 * GET /api/download/[assetId]
 * Serves the audio file from R2 with Content-Disposition: attachment for download.
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
			.select({
				r2ObjectKey: audioAssets.r2ObjectKey,
				status: audioAssets.status,
				title: audioAssets.title,
				format: audioAssets.format
			})
			.from(audioAssets)
			.where(and(eq(audioAssets.id, assetId), eq(audioAssets.status, 'ready')))
			.limit(1);
	});

	if (!asset || !asset.r2ObjectKey) {
		error(404, { message: 'Audio asset not found.' });
	}

	const bucket = env.AUDIO_BUCKET;
	if (!bucket) {
		error(503, { message: 'Audio storage not available.' });
	}

	const object = await bucket.get(asset.r2ObjectKey);
	if (!object) {
		error(404, { message: 'Audio file not found in storage.' });
	}

	const ext = asset.format?.toLowerCase() || 'mp3';
	const filename = `${sanitizeFilename(asset.title)}.${ext}`;
	const contentType = formatToContentType(asset.format);
	const bytes = await object.arrayBuffer();

	return new Response(bytes, {
		status: 200,
		headers: {
			'Content-Type': contentType,
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Content-Length': String(bytes.byteLength),
			'Cache-Control': 'private, no-cache'
		}
	});
};
