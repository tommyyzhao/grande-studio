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

	/** Start playback of a loaded asset from current position. If no assetId given, resumes the current asset. */
	play(assetId?: string): Promise<void>;
	/** Pause playback, preserving position */
	pause(): Promise<void>;
	/** Stop playback, reset position to 0 */
	stop(): void;
	/** Seek to a position in seconds */
	seek(timeSec: number): void;

	/** Current playback position in seconds (computed from AudioContext.currentTime) */
	readonly currentTime: number;
	/** Whether the engine is currently playing */
	readonly isPlaying: boolean;
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

	// Playback state
	let sourceNode: AudioBufferSourceNode | null = null;
	let activeAssetId: string | null = null;
	let playing = false;
	let playbackOffset = 0; // position in audio file where playback was started
	let playbackStartedAt = 0; // ctx.currentTime when playback was started

	function getContext(): AudioContext {
		if (!context) {
			context = factory.create();
		}
		return context;
	}

	function getCurrentTime(): number {
		if (playing && context) {
			const elapsed = context.currentTime - playbackStartedAt;
			return playbackOffset + elapsed;
		}
		return playbackOffset;
	}

	function stopSource(): void {
		if (sourceNode) {
			sourceNode.onended = null; // prevent callback from firing on intentional stop
			try {
				sourceNode.stop();
			} catch {
				// Already stopped
			}
			sourceNode.disconnect();
			sourceNode = null;
		}
	}

	function scheduleSource(ctx: AudioContext, buffer: AudioBuffer, offset: number): void {
		sourceNode = ctx.createBufferSource();
		sourceNode.buffer = buffer;
		sourceNode.connect(ctx.destination);
		sourceNode.start(0, offset);
		playbackStartedAt = ctx.currentTime;

		sourceNode.onended = () => {
			if (playing) {
				playing = false;
				playbackOffset = 0;
				sourceNode = null;
			}
		};
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
		if (activeAssetId === assetId) {
			stop();
		}
		buffers.delete(assetId);
	}

	async function dispose(): Promise<void> {
		stop();
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

	async function play(assetId?: string): Promise<void> {
		const targetId = assetId ?? activeAssetId;
		if (!targetId) {
			throw new Error('No asset specified for playback');
		}

		const buffer = buffers.get(targetId);
		if (!buffer) {
			throw new Error(`Asset not loaded: ${targetId}`);
		}

		// If switching from one asset to another, reset offset
		if (activeAssetId !== null && targetId !== activeAssetId) {
			playbackOffset = 0;
		}

		const ctx = getContext();
		if (ctx.state === 'suspended') {
			await ctx.resume();
		}

		stopSource();

		const offset = Math.min(Math.max(0, playbackOffset), buffer.duration);
		playbackOffset = offset;
		activeAssetId = targetId;
		playing = true;

		scheduleSource(ctx, buffer, offset);
	}

	async function pause(): Promise<void> {
		if (!playing || !context) return;

		// Capture current position before stopping
		playbackOffset = getCurrentTime();
		playing = false;

		stopSource();
		await context.suspend();
	}

	function stop(): void {
		stopSource();
		playing = false;
		playbackOffset = 0;
	}

	function seek(timeSec: number): void {
		const clampedTime = Math.max(0, timeSec);

		if (playing && activeAssetId && context) {
			const buffer = buffers.get(activeAssetId);
			if (buffer) {
				const offset = Math.min(clampedTime, buffer.duration);
				playbackOffset = offset;
				stopSource();
				scheduleSource(context, buffer, offset);
				return;
			}
		}

		// Not playing or no active buffer — just update offset
		playbackOffset = clampedTime;
	}

	return {
		loadAsset,
		unloadAsset,
		dispose,
		getContext,
		hasAsset,
		getBuffer,
		resume,
		suspend,
		play,
		pause,
		stop,
		seek,
		get currentTime() {
			return getCurrentTime();
		},
		get isPlaying() {
			return playing;
		}
	};
}
