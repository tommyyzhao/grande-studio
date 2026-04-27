/**
 * Local filesystem implementation of R2BucketLike for development.
 * Stores files under .local-r2/ relative to project root.
 */
import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { R2BucketLike } from '$lib/services/r2-storage';

const LOCAL_R2_DIR = join(process.cwd(), '.local-r2');

export function createLocalR2Bucket(): R2BucketLike {
	return {
		async put(key, value, options) {
			const filePath = join(LOCAL_R2_DIR, key);
			await mkdir(dirname(filePath), { recursive: true });

			let buffer: Buffer;
			if (value instanceof ArrayBuffer) {
				buffer = Buffer.from(value);
			} else if (ArrayBuffer.isView(value)) {
				buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
			} else if (typeof value === 'string') {
				buffer = Buffer.from(value, 'utf-8');
			} else {
				// ReadableStream
				const chunks: Uint8Array[] = [];
				const reader = (value as ReadableStream<Uint8Array>).getReader();
				let done = false;
				while (!done) {
					const result = await reader.read();
					done = result.done;
					if (result.value) chunks.push(result.value);
				}
				buffer = Buffer.concat(chunks);
			}

			await writeFile(filePath, buffer);

			// Write metadata sidecar
			if (options?.httpMetadata?.contentType) {
				await writeFile(
					filePath + '.meta.json',
					JSON.stringify({ contentType: options.httpMetadata.contentType })
				);
			}
		},

		async get(key) {
			const filePath = join(LOCAL_R2_DIR, key);
			try {
				const data = await readFile(filePath);
				let contentType: string | undefined;
				try {
					const meta = JSON.parse(await readFile(filePath + '.meta.json', 'utf-8'));
					contentType = meta.contentType;
				} catch {
					// no metadata
				}
				return {
					arrayBuffer: () => Promise.resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
					httpMetadata: contentType ? { contentType } : undefined
				};
			} catch {
				return null;
			}
		},

		async delete(key) {
			const keys = Array.isArray(key) ? key : [key];
			for (const k of keys) {
				const filePath = join(LOCAL_R2_DIR, k);
				try {
					await unlink(filePath);
				} catch {
					// ignore
				}
				try {
					await unlink(filePath + '.meta.json');
				} catch {
					// ignore
				}
			}
		}
	};
}
