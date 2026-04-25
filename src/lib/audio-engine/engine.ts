/**
 * Headless audio engine — all AudioContext and buffer management lives here.
 * Svelte components never directly instantiate AudioContext.
 */

/** Clip configuration for bulk arrangement setup */
export interface ArrangementClipState {
	clipId: string;
	assetId: string;
	startTimeSec: number;
	trimStartSec: number;
	trimEndSec: number | null;
	clipDurationSec: number;
	gainDb: number;
	muted: boolean;
	soloed: boolean;
	layerOrder: number;
}

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

	/** Set the start offset for a clip on the transport timeline (seconds) */
	setClipStartOffset(clipId: string, startTimeSec: number): void;
	/** Set the trim region within the source audio buffer */
	setClipTrim(clipId: string, trimStartSec: number, trimEndSec: number | null): void;
	/** Associate a clip with a loaded audio asset */
	setClipAssetId(clipId: string, assetId: string): void;

	/** Set the total playback duration for a clip (enables looping when > trimmed audio length) */
	setClipLoop(clipId: string, clipDurationSec: number): void;

	/** Configure all clips for playback in one call (replaces existing clips) */
	setArrangement(clips: ArrangementClipState[]): void;
	/** Remove a single clip from the arrangement */
	removeClip(clipId: string): void;
	/** Arrangement duration = max(clip.startTimeSec + effectiveDuration) across all clips */
	readonly arrangementDuration: number;
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

	// Arrangement end timer
	let arrangementEndTimer: ReturnType<typeof setTimeout> | null = null;

	function clearEndTimer(): void {
		if (arrangementEndTimer !== null) {
			clearTimeout(arrangementEndTimer);
			arrangementEndTimer = null;
		}
	}

	// Per-clip mixing state
	interface ClipMixState {
		gainDb: number;
		muted: boolean;
		soloed: boolean;
		gainNode: GainNode | null;
		connectedToDestination: boolean;
		startTimeSec: number;
		trimStartSec: number;
		trimEndSec: number | null;
		assetId: string | null;
		sourceNodes: AudioBufferSourceNode[];
		clipDurationSec: number | null;
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
				connectedToDestination: false,
				startTimeSec: 0,
				trimStartSec: 0,
				trimEndSec: null,
				assetId: null,
				sourceNodes: [],
				clipDurationSec: null
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

	function scheduleClipSource(
		ctx: AudioContext,
		clipId: string,
		clip: ClipMixState,
		transportTime: number
	): void {
		if (!clip.assetId) return;
		const buffer = buffers.get(clip.assetId);
		if (!buffer) return;

		const trimStart = clip.trimStartSec;
		const trimEnd = clip.trimEndSec ?? buffer.duration;
		const trimmedDuration = Math.max(0, trimEnd - trimStart);

		if (trimmedDuration <= 0) return;

		// Effective clip duration: clipDurationSec overrides trimmedDuration
		const effectiveDuration = clip.clipDurationSec !== null
			? Math.max(0, clip.clipDurationSec)
			: trimmedDuration;

		if (effectiveDuration <= 0) return;

		const clipEndTime = clip.startTimeSec + effectiveDuration;

		// Skip clips that have already ended relative to transport
		if (clipEndTime <= transportTime) return;

		const gainNode = ensureGainNode(clip);
		clip.sourceNodes = [];

		if (effectiveDuration <= trimmedDuration) {
			// No looping — play once (possibly shorter than trimmed region)
			let whenOnCtx: number;
			let bufferOffset: number;
			let playDuration: number;

			if (clip.startTimeSec >= transportTime) {
				whenOnCtx = ctx.currentTime + (clip.startTimeSec - transportTime);
				bufferOffset = trimStart;
				playDuration = effectiveDuration;
			} else {
				const elapsed = transportTime - clip.startTimeSec;
				whenOnCtx = ctx.currentTime;
				bufferOffset = trimStart + elapsed;
				playDuration = effectiveDuration - elapsed;
			}

			if (playDuration <= 0) return;

			const source = ctx.createBufferSource();
			source.buffer = buffer;
			source.connect(gainNode);
			source.start(whenOnCtx, bufferOffset, playDuration);
			clip.sourceNodes.push(source);
		} else {
			// Looping — schedule multiple source nodes to cover clipDurationSec
			const elapsedInClip = Math.max(0, transportTime - clip.startTimeSec);
			let remaining = effectiveDuration - elapsedInClip;

			// Figure out which loop iteration and position we're in
			let loopOffset = elapsedInClip % trimmedDuration;
			let timeOnCtx = clip.startTimeSec >= transportTime
				? ctx.currentTime + (clip.startTimeSec - transportTime)
				: ctx.currentTime;

			while (remaining > 0) {
				const playDuration = Math.min(trimmedDuration - loopOffset, remaining);

				if (playDuration <= 0) break;

				const source = ctx.createBufferSource();
				source.buffer = buffer;
				source.connect(gainNode);
				source.start(timeOnCtx, trimStart + loopOffset, playDuration);
				clip.sourceNodes.push(source);

				timeOnCtx += playDuration;
				remaining -= playDuration;
				loopOffset = 0; // subsequent iterations always start from trimStart
			}
		}
	}

	function stopAllClipSources(): void {
		for (const clip of clips.values()) {
			for (const node of clip.sourceNodes) {
				node.onended = null;
				try {
					node.stop();
				} catch {
					// Already stopped
				}
				node.disconnect();
			}
			clip.sourceNodes = [];
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
		clearEndTimer();
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
		// Arrangement mode: when no explicit assetId and clips with loaded buffers exist,
		// prefer arrangement playback (transport bar calls play() without args)
		if (!assetId) {
			const clipsWithAssets = Array.from(clips.entries()).filter(
				([, c]) => c.assetId !== null && buffers.has(c.assetId!)
			);

			if (clipsWithAssets.length > 0) {
				const ctx = getContext();
				if (ctx.state === 'suspended') {
					await ctx.resume();
				}

				// Stop any single-asset source before entering arrangement mode
				stopSource();
				activeAssetId = null;
				stopAllClipSources();
				clearEndTimer();

				const transportTime = playbackOffset;
				for (const [clipId, clip] of clipsWithAssets) {
					scheduleClipSource(ctx, clipId, clip, transportTime);
				}
				updateAllClipRouting();

				playing = true;
				playbackStartedAt = ctx.currentTime;

				// Schedule transport auto-stop at arrangement end
				const duration = getArrangementDuration();
				const remaining = duration - transportTime;
				if (remaining > 0) {
					arrangementEndTimer = setTimeout(() => {
						arrangementEndTimer = null;
						if (playing) {
							stopAllClipSources();
							playing = false;
							playbackOffset = 0;
						}
					}, remaining * 1000);
				}
				return;
			}
		}

		// Single-asset mode
		const targetId = assetId ?? activeAssetId;

		if (targetId) {
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
			// Stop any arrangement playback when entering single-asset mode
			stopAllClipSources();
			clearEndTimer();

			const offset = Math.min(Math.max(0, playbackOffset), buffer.duration);
			playbackOffset = offset;
			activeAssetId = targetId;
			playing = true;

			scheduleSource(ctx, buffer, offset);
			return;
		}

		throw new Error('No asset specified for playback');
	}

	async function pause(): Promise<void> {
		if (!playing || !context) return;

		// Capture current position before stopping
		playbackOffset = getCurrentTime();
		playing = false;

		clearEndTimer();
		stopSource();
		stopAllClipSources();
		await context.suspend();
	}

	function stop(): void {
		clearEndTimer();
		stopSource();
		stopAllClipSources();
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

	function setClipStartOffset(clipId: string, startTimeSec: number): void {
		const clip = getOrCreateClipState(clipId);
		clip.startTimeSec = Math.max(0, startTimeSec);
	}

	function setClipTrim(clipId: string, trimStartSec: number, trimEndSec: number | null): void {
		const clip = getOrCreateClipState(clipId);
		clip.trimStartSec = Math.max(0, trimStartSec);
		clip.trimEndSec = trimEndSec !== null ? Math.max(0, trimEndSec) : null;
	}

	function setClipAssetId(clipId: string, assetId: string): void {
		const clip = getOrCreateClipState(clipId);
		clip.assetId = assetId;
	}

	function setClipLoop(clipId: string, clipDurationSec: number): void {
		const clip = getOrCreateClipState(clipId);
		clip.clipDurationSec = Math.max(0, clipDurationSec);
	}

	function getArrangementDuration(): number {
		let maxEnd = 0;
		for (const clip of clips.values()) {
			if (clip.assetId === null) continue;
			let effectiveDuration: number;
			if (clip.clipDurationSec !== null) {
				effectiveDuration = clip.clipDurationSec;
			} else {
				const buffer = buffers.get(clip.assetId);
				if (!buffer) continue;
				const trimEnd = clip.trimEndSec ?? buffer.duration;
				effectiveDuration = Math.max(0, trimEnd - clip.trimStartSec);
			}
			const endTime = clip.startTimeSec + effectiveDuration;
			if (endTime > maxEnd) maxEnd = endTime;
		}
		return maxEnd;
	}

	function setArrangement(newClips: ArrangementClipState[]): void {
		// Stop playback and clean up existing clips
		stopAllClipSources();
		clearEndTimer();
		for (const clip of clips.values()) {
			if (clip.gainNode) {
				clip.gainNode.disconnect();
			}
		}
		clips.clear();

		// Set up new clips
		for (const c of newClips) {
			const state: ClipMixState = {
				gainDb: c.gainDb,
				muted: c.muted,
				soloed: c.soloed,
				gainNode: null,
				connectedToDestination: false,
				startTimeSec: c.startTimeSec,
				trimStartSec: c.trimStartSec,
				trimEndSec: c.trimEndSec,
				assetId: c.assetId,
				sourceNodes: [],
				clipDurationSec: c.clipDurationSec
			};
			clips.set(c.clipId, state);
		}
	}

	function removeClip(clipId: string): void {
		const clip = clips.get(clipId);
		if (!clip) return;

		// Stop source nodes for this clip
		for (const node of clip.sourceNodes) {
			node.onended = null;
			try {
				node.stop();
			} catch {
				// Already stopped
			}
			node.disconnect();
		}
		clip.sourceNodes = [];

		// Disconnect gain node
		if (clip.gainNode) {
			clip.gainNode.disconnect();
		}

		clips.delete(clipId);
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
		setClipSolo,
		setClipStartOffset,
		setClipTrim,
		setClipAssetId,
		setClipLoop,
		setArrangement,
		removeClip,
		get arrangementDuration() {
			return getArrangementDuration();
		}
	};
}
