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

	/** Set the gain for a clip's GainNode (dB, 0 = unity gain) */
	setClipGain(clipId: string, gainDb: number): void;
	/** Set the mute state for a clip (disconnects/reconnects audio path) */
	setClipMute(clipId: string, muted: boolean): void;
	/** Set the solo state for a clip */
	setClipSolo(clipId: string, soloed: boolean): void;
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

	// Per-clip mixing state
	interface ClipMixState {
		gainDb: number;
		muted: boolean;
		soloed: boolean;
		gainNode: GainNode | null;
		connectedToDestination: boolean;
	}
	const clips = new Map<string, ClipMixState>();

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

	function dbToLinear(db: number): number {
		return Math.pow(10, db / 20);
	}

	function getOrCreateClipState(clipId: string): ClipMixState {
		let clip = clips.get(clipId);
		if (!clip) {
			clip = {
				gainDb: 0,
				muted: false,
				soloed: false,
				gainNode: null,
				connectedToDestination: false
			};
			clips.set(clipId, clip);
		}
		return clip;
	}

	function ensureGainNode(clip: ClipMixState): GainNode {
		if (!clip.gainNode) {
			const ctx = getContext();
			clip.gainNode = ctx.createGain();
			clip.gainNode.gain.value = dbToLinear(clip.gainDb);
		}
		return clip.gainNode;
	}

	function updateAllClipRouting(): void {
		if (!context) return;
		const dest = context.destination;
		const anySoloed = Array.from(clips.values()).some(c => c.soloed);
		for (const clip of clips.values()) {
			if (!clip.gainNode) continue;
			const shouldBeConnected = anySoloed ? clip.soloed : !clip.muted;
			if (shouldBeConnected && !clip.connectedToDestination) {
				clip.gainNode.connect(dest);
				clip.connectedToDestination = true;
			} else if (!shouldBeConnected && clip.connectedToDestination) {
				clip.gainNode.disconnect();
				clip.connectedToDestination = false;
			}
		}
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
		for (const clip of clips.values()) {
			if (clip.gainNode) {
				clip.gainNode.disconnect();
			}
		}
		clips.clear();
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

	function setClipGain(clipId: string, gainDb: number): void {
		const clip = getOrCreateClipState(clipId);
		clip.gainDb = gainDb;
		const gainNode = ensureGainNode(clip);
		gainNode.gain.value = dbToLinear(gainDb);
		updateAllClipRouting();
	}

	function setClipMute(clipId: string, muted: boolean): void {
		const clip = getOrCreateClipState(clipId);
		clip.muted = muted;
		ensureGainNode(clip);
		updateAllClipRouting();
	}

	function setClipSolo(clipId: string, soloed: boolean): void {
		const clip = getOrCreateClipState(clipId);
		clip.soloed = soloed;
		ensureGainNode(clip);
		updateAllClipRouting();
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
		},
		setClipGain,
		setClipMute,
		setClipSolo
	};
}
