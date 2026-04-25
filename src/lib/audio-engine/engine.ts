/**
 * Headless audio engine — all AudioContext and buffer management lives here.
 * Svelte components never directly instantiate AudioContext.
 */

export interface AudioEngine {
	/** Load audio from URL, decode to AudioBuffer, store by assetId */
	loadAsset(assetId: string, url: string): Promise<void>;
	/** Remove stored buffer for assetId */
	unloadAsset(assetId: string): void;
	/** Close AudioContext and clear all buffers */
	dispose(): Promise<void>;
	/** Get or lazily create the AudioContext (call from user gesture to satisfy autoplay policy) */
	getContext(): AudioContext;
	/** Check if an asset buffer is loaded */
	hasAsset(assetId: string): boolean;
	/** Get the decoded AudioBuffer for an asset (null if not loaded) */
	getBuffer(assetId: string): AudioBuffer | null;
	/** Resume AudioContext if suspended */
	resume(): Promise<void>;
	/** Suspend AudioContext */
	suspend(): Promise<void>;
}

/** Injectable factory so tests can provide a mock AudioContext */
export interface AudioContextFactory {
	create(): AudioContext;
}

const defaultFactory: AudioContextFactory = {
	create: () => new AudioContext()
};

export function createAudioEngine(contextFactory?: AudioContextFactory): AudioEngine {
	let context: AudioContext | null = null;
	const buffers = new Map<string, AudioBuffer>();
	const factory = contextFactory ?? defaultFactory;

	function getContext(): AudioContext {
		if (!context) {
			context = factory.create();
		}
		return context;
	}

	async function loadAsset(assetId: string, url: string): Promise<void> {
		const ctx = getContext();
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`);
		}
		const arrayBuffer = await response.arrayBuffer();
		const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
		buffers.set(assetId, audioBuffer);
	}

	function unloadAsset(assetId: string): void {
		buffers.delete(assetId);
	}

	async function dispose(): Promise<void> {
		buffers.clear();
		if (context) {
			await context.close();
			context = null;
		}
	}

	function hasAsset(assetId: string): boolean {
		return buffers.has(assetId);
	}

	function getBuffer(assetId: string): AudioBuffer | null {
		return buffers.get(assetId) ?? null;
	}

	async function resume(): Promise<void> {
		if (context && context.state === 'suspended') {
			await context.resume();
		}
	}

	async function suspend(): Promise<void> {
		if (context && context.state === 'running') {
			await context.suspend();
		}
	}

	return {
		loadAsset,
		unloadAsset,
		dispose,
		getContext,
		hasAsset,
		getBuffer,
		resume,
		suspend
	};
}
