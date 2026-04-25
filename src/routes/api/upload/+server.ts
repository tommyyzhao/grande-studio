import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { createLocalDb, createNeonDb } from '$lib/server/db';
import { audioAssets } from '$lib/server/db/schema';
import { withRLS } from '$lib/server/db/rls';
import { createR2StorageService, buildObjectKey } from '$lib/services/r2-storage';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const ALLOWED_MIME_TYPES: Record<string, string> = {
	'audio/mpeg': 'mp3',
	'audio/mp3': 'mp3',
	'audio/wav': 'wav',
	'audio/x-wav': 'wav',
	'audio/wave': 'wav',
	'audio/mp4': 'm4a',
	'audio/x-m4a': 'm4a',
	'audio/m4a': 'm4a',
	'audio/aac': 'm4a',
	'audio/flac': 'flac',
	'audio/x-flac': 'flac'
};

const ALLOWED_EXTENSIONS: Record<string, string> = {
	mp3: 'mp3',
	wav: 'wav',
	m4a: 'm4a',
	flac: 'flac'
};

function getExtensionFromFilename(filename: string): string | null {
	const parts = filename.toLowerCase().split('.');
	if (parts.length < 2) return null;
	const ext = parts[parts.length - 1];
	return ALLOWED_EXTENSIONS[ext] ?? null;
}

function resolveExtension(mimeType: string, filename: string): string | null {
	const fromMime = ALLOWED_MIME_TYPES[mimeType.toLowerCase()];
	if (fromMime) return fromMime;
	return getExtensionFromFilename(filename);
}

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	// 1. Validate session
	if (!locals.user) {
		error(401, { message: 'Authentication required. Please sign in to upload files.' });
	}

	const userId = locals.user.id;

	// 2. Parse multipart form data
	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		error(400, { message: 'Invalid form data. Expected multipart/form-data.' });
	}

	const file = formData.get('file');
	const projectId = formData.get('projectId');

	if (!projectId || typeof projectId !== 'string') {
		error(400, { message: 'Missing required field: projectId' });
	}

	if (!file || !(file instanceof File)) {
		error(400, { message: 'Missing required field: file' });
	}

	// 3. Validate file size
	if (file.size > MAX_FILE_SIZE) {
		const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
		error(400, {
			message: `File too large (${sizeMB}MB). Maximum allowed size is 50MB.`
		});
	}

	if (file.size === 0) {
		error(400, { message: 'File is empty.' });
	}

	// 4. Validate file type
	const ext = resolveExtension(file.type, file.name);
	if (!ext) {
		error(400, {
			message: `Unsupported file type: "${file.type || 'unknown'}". Accepted formats: MP3, WAV, M4A, FLAC.`
		});
	}

	// 5. Read file bytes
	const bytes = new Uint8Array(await file.arrayBuffer());

	// 6. Set up DB and R2
	const dbUrl = process.env.DATABASE_URL ?? '';
	const db = dbUrl.includes('neon.tech') ? createNeonDb(dbUrl) : createLocalDb(dbUrl);

	const bucket = platform?.env?.AUDIO_BUCKET;
	const signingSecret = process.env.R2_SIGNING_SECRET ?? '';
	const baseUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:5173';

	if (!bucket) {
		console.warn('R2 bucket binding not available — skipping file upload to R2.');
	}

	// 7. Create asset and upload to R2 within RLS transaction
	const contentType = file.type || `audio/${ext}`;
	const title = file.name.replace(/\.[^.]+$/, '') || 'Uploaded Audio';

	const result = await withRLS(db, userId, async (tx) => {
		// Create audio_asset row
		const [asset] = await tx
			.insert(audioAssets)
			.values({
				projectId,
				ownerId: userId,
				sourceType: 'uploaded',
				provider: 'local_upload',
				title,
				status: 'ready',
				format: ext,
				r2ObjectKey: ''
			})
			.returning({ id: audioAssets.id });

		const assetId = asset.id;
		const objectKey = buildObjectKey(userId, projectId, assetId, ext);

		// Upload to R2 if bucket is available
		if (bucket) {
			const r2 = createR2StorageService(bucket, signingSecret, baseUrl);
			await r2.uploadAudio(objectKey, bytes, contentType);
		}

		// Update asset with the final r2_object_key
		await tx
			.update(audioAssets)
			.set({ r2ObjectKey: objectKey, updatedAt: new Date() })
			.where(eq(audioAssets.id, assetId));

		return { assetId, objectKey };
	});

	return json({ assetId: result.assetId }, { status: 201 });
};
