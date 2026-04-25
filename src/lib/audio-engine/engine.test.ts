import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAudioEngine, type AudioEngine, type AudioContextFactory } from './engine';

// --- Mock helpers ---

function createMockAudioBuffer(duration = 5.0, sampleRate = 44100): AudioBuffer {
	return {
		duration,
		sampleRate,
		length: Math.floor(duration * sampleRate),
		numberOfChannels: 2,
		getChannelData: vi.fn(() => new Float32Array(Math.floor(duration * sampleRate))),
		copyFromChannel: vi.fn(),
		copyToChannel: vi.fn()
	} as unknown as AudioBuffer;
}

interface MockGainNode {
	gain: { value: number };
	connect: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
}

function createMockGainNode(): MockGainNode {
	return {
		gain: { value: 1 },
		connect: vi.fn(),
		disconnect: vi.fn()
	};
}

interface MockSourceNode {
	buffer: AudioBuffer | null;
	connect: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
	start: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
	onended: (() => void) | null;
	_triggerEnded(): void;
}

function createMockSourceNode(): MockSourceNode {
	const node: MockSourceNode = {
		buffer: null,
		connect: vi.fn(() => node),
		disconnect: vi.fn(),
		start: vi.fn(),
		stop: vi.fn(),
		onended: null,
		_triggerEnded() {
			if (node.onended) node.onended();
		}
	};
	return node;
}

function createMockAudioContext() {
	let _state: AudioContextState = 'running';
	let _currentTime = 0;
	const mockBuffer = createMockAudioBuffer();
	const sourceNodes: MockSourceNode[] = [];
	const gainNodes: MockGainNode[] = [];

	const ctx = {
		get state() {
			return _state;
		},
		get currentTime() {
			return _currentTime;
		},
		close: vi.fn(async () => {
			_state = 'closed';
		}),
		resume: vi.fn(async () => {
			_state = 'running';
		}),
		suspend: vi.fn(async () => {
			_state = 'suspended';
		}),
		decodeAudioData: vi.fn(async () => mockBuffer),
		createBufferSource: vi.fn(() => {
			const node = createMockSourceNode();
			sourceNodes.push(node);
			return node as unknown as AudioBufferSourceNode;
		}),
		createGain: vi.fn(() => {
			const node = createMockGainNode();
			gainNodes.push(node);
			return node as unknown as GainNode;
		}),
		destination: {},
		sampleRate: 44100,
		_mockBuffer: mockBuffer,
		_sourceNodes: sourceNodes,
		_gainNodes: gainNodes,
		_setCurrentTime(t: number) {
			_currentTime = t;
		}
	};

	return ctx as unknown as AudioContext & {
		_mockBuffer: AudioBuffer;
		_sourceNodes: MockSourceNode[];
		_gainNodes: MockGainNode[];
		_setCurrentTime: (t: number) => void;
	};
}

function createMockContextFactory() {
	const mockContext = createMockAudioContext();
	const factory: AudioContextFactory = {
		create: vi.fn(() => mockContext as unknown as AudioContext)
	};
	return { factory, mockContext };
}

// --- Tests ---

describe('AudioEngine', () => {
	let engine: AudioEngine;
	let mockContext: ReturnType<typeof createMockAudioContext>;
	let factory: AudioContextFactory;

	beforeEach(() => {
		const mock = createMockContextFactory();
		factory = mock.factory;
		mockContext = mock.mockContext;
		engine = createAudioEngine(factory);

		vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
			new Response(new ArrayBuffer(1024), { status: 200 })
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('AudioContext lifecycle', () => {
		it('does not create AudioContext until first use', () => {
			expect(factory.create).not.toHaveBeenCalled();
		});

		it('creates AudioContext lazily on getContext()', () => {
			engine.getContext();
			expect(factory.create).toHaveBeenCalledOnce();
		});

		it('returns the same AudioContext on repeated getContext() calls', () => {
			const ctx1 = engine.getContext();
			const ctx2 = engine.getContext();
			expect(ctx1).toBe(ctx2);
			expect(factory.create).toHaveBeenCalledOnce();
		});

		it('creates AudioContext implicitly on loadAsset', async () => {
			expect(factory.create).not.toHaveBeenCalled();
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			expect(factory.create).toHaveBeenCalledOnce();
		});

		it('resumes a suspended AudioContext', async () => {
			engine.getContext();
			await engine.suspend();
			expect(mockContext.state).toBe('suspended');
			await engine.resume();
			expect(mockContext.resume).toHaveBeenCalled();
			expect(mockContext.state).toBe('running');
		});

		it('suspends a running AudioContext', async () => {
			engine.getContext();
			await engine.suspend();
			expect(mockContext.suspend).toHaveBeenCalled();
			expect(mockContext.state).toBe('suspended');
		});

		it('resume is a no-op when no context exists', async () => {
			await engine.resume(); // should not throw
		});

		it('suspend is a no-op when no context exists', async () => {
			await engine.suspend(); // should not throw
		});

		it('resume is a no-op when already running', async () => {
			engine.getContext();
			await engine.resume();
			expect(mockContext.resume).not.toHaveBeenCalled();
		});

		it('suspend is a no-op when already suspended', async () => {
			engine.getContext();
			await engine.suspend();
			(mockContext.suspend as ReturnType<typeof vi.fn>).mockClear();
			await engine.suspend();
			expect(mockContext.suspend).not.toHaveBeenCalled();
		});

		it('closes AudioContext on dispose', async () => {
			engine.getContext();
			await engine.dispose();
			expect(mockContext.close).toHaveBeenCalledOnce();
		});

		it('dispose is safe without a context', async () => {
			await engine.dispose(); // should not throw
		});
	});

	describe('loadAsset', () => {
		it('fetches audio from URL and decodes to AudioBuffer', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/audio.mp3');
			expect(mockContext.decodeAudioData).toHaveBeenCalled();
			expect(engine.hasAsset('a1')).toBe(true);
		});

		it('stores the decoded buffer retrievable by assetId', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			expect(engine.getBuffer('a1')).toBe(mockContext._mockBuffer);
		});

		it('replaces existing buffer when loading same assetId', async () => {
			await engine.loadAsset('a1', 'https://example.com/v1.mp3');
			await engine.loadAsset('a1', 'https://example.com/v2.mp3');
			expect(engine.hasAsset('a1')).toBe(true);
			expect(globalThis.fetch).toHaveBeenCalledTimes(2);
		});

		it('loads multiple assets independently', async () => {
			await engine.loadAsset('a1', 'https://example.com/one.mp3');
			await engine.loadAsset('a2', 'https://example.com/two.mp3');
			expect(engine.hasAsset('a1')).toBe(true);
			expect(engine.hasAsset('a2')).toBe(true);
		});

		it('throws on HTTP error', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(null, { status: 404, statusText: 'Not Found' })
			);
			await expect(engine.loadAsset('a1', 'https://example.com/missing.mp3')).rejects.toThrow(
				'Failed to fetch audio: 404 Not Found'
			);
			expect(engine.hasAsset('a1')).toBe(false);
		});

		it('throws on network error', async () => {
			vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
			await expect(engine.loadAsset('a1', 'https://example.com/audio.mp3')).rejects.toThrow(
				'Failed to fetch'
			);
		});

		it('throws on decode failure', async () => {
			(mockContext.decodeAudioData as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
				new Error('Unable to decode audio data')
			);
			await expect(engine.loadAsset('a1', 'https://example.com/bad.mp3')).rejects.toThrow(
				'Unable to decode audio data'
			);
		});
	});

	describe('unloadAsset', () => {
		it('removes a loaded asset', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			engine.unloadAsset('a1');
			expect(engine.hasAsset('a1')).toBe(false);
			expect(engine.getBuffer('a1')).toBeNull();
		});

		it('is a no-op for unknown assetId', () => {
			engine.unloadAsset('nonexistent'); // should not throw
		});

		it('does not affect other loaded assets', async () => {
			await engine.loadAsset('a1', 'https://example.com/one.mp3');
			await engine.loadAsset('a2', 'https://example.com/two.mp3');
			engine.unloadAsset('a1');
			expect(engine.hasAsset('a1')).toBe(false);
			expect(engine.hasAsset('a2')).toBe(true);
		});
	});

	describe('hasAsset / getBuffer', () => {
		it('returns false / null for unloaded asset', () => {
			expect(engine.hasAsset('a1')).toBe(false);
			expect(engine.getBuffer('a1')).toBeNull();
		});

		it('returns true / buffer for loaded asset', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			expect(engine.hasAsset('a1')).toBe(true);
			expect(engine.getBuffer('a1')).not.toBeNull();
		});
	});

	describe('dispose', () => {
		it('clears all loaded buffers', async () => {
			await engine.loadAsset('a1', 'https://example.com/one.mp3');
			await engine.loadAsset('a2', 'https://example.com/two.mp3');
			await engine.dispose();
			expect(engine.hasAsset('a1')).toBe(false);
			expect(engine.hasAsset('a2')).toBe(false);
		});

		it('closes the AudioContext', async () => {
			engine.getContext();
			await engine.dispose();
			expect(mockContext.close).toHaveBeenCalledOnce();
		});

		it('allows creating a new context after dispose', async () => {
			engine.getContext();
			await engine.dispose();
			// After dispose the engine creates a fresh context on next getContext()
			const ctx = engine.getContext();
			expect(ctx).toBeDefined();
			expect(factory.create).toHaveBeenCalledTimes(2);
		});

		it('stops playback before disposing', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			await engine.play('a1');
			expect(engine.isPlaying).toBe(true);
			await engine.dispose();
			expect(engine.isPlaying).toBe(false);
		});
	});

	describe('play()', () => {
		it('starts playback of a loaded asset', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			await engine.play('a1');
			expect(engine.isPlaying).toBe(true);
		});

		it('creates an AudioBufferSourceNode connected to destination', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			await engine.play('a1');
			const nodes = mockContext._sourceNodes;
			expect(nodes.length).toBe(1);
			expect(nodes[0].buffer).toBe(mockContext._mockBuffer);
			expect(nodes[0].connect).toHaveBeenCalledWith(mockContext.destination);
			expect(nodes[0].start).toHaveBeenCalledWith(0, 0);
		});

		it('throws if no asset specified and no prior asset', async () => {
			await expect(engine.play()).rejects.toThrow('No asset specified for playback');
		});

		it('throws if asset not loaded', async () => {
			await expect(engine.play('nonexistent')).rejects.toThrow('Asset not loaded: nonexistent');
		});

		it('resumes suspended AudioContext', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			await engine.suspend();
			expect(mockContext.state).toBe('suspended');
			await engine.play('a1');
			expect(mockContext.resume).toHaveBeenCalled();
			expect(engine.isPlaying).toBe(true);
		});

		it('resumes same asset after pause when no assetId given', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			await engine.play('a1');
			await engine.pause();
			await engine.play(); // no assetId — should resume a1
			expect(engine.isPlaying).toBe(true);
		});

		it('stops current playback when switching assets', async () => {
			await engine.loadAsset('a1', 'https://example.com/one.mp3');
			await engine.loadAsset('a2', 'https://example.com/two.mp3');
			await engine.play('a1');
			const firstNode = mockContext._sourceNodes[0];
			await engine.play('a2');
			expect(firstNode.stop).toHaveBeenCalled();
			expect(firstNode.disconnect).toHaveBeenCalled();
			expect(mockContext._sourceNodes.length).toBe(2);
		});

		it('resets offset when switching to a different asset', async () => {
			await engine.loadAsset('a1', 'https://example.com/one.mp3');
			await engine.loadAsset('a2', 'https://example.com/two.mp3');
			await engine.play('a1');
			engine.seek(3.0);
			await engine.play('a2');
			expect(engine.currentTime).toBe(0);
		});
	});

	describe('pause()', () => {
		it('preserves playback position', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			mockContext._setCurrentTime(0);
			await engine.play('a1');
			// Simulate 2 seconds of playback
			mockContext._setCurrentTime(2);
			await engine.pause();
			expect(engine.currentTime).toBeCloseTo(2, 1);
			expect(engine.isPlaying).toBe(false);
		});

		it('suspends AudioContext', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			await engine.play('a1');
			await engine.pause();
			expect(mockContext.suspend).toHaveBeenCalled();
		});

		it('stops the source node', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			await engine.play('a1');
			const node = mockContext._sourceNodes[0];
			await engine.pause();
			expect(node.stop).toHaveBeenCalled();
			expect(node.disconnect).toHaveBeenCalled();
		});

		it('is a no-op when not playing', async () => {
			await engine.pause(); // should not throw
			expect(engine.isPlaying).toBe(false);
		});

		it('allows resuming from paused position', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			mockContext._setCurrentTime(0);
			await engine.play('a1');
			mockContext._setCurrentTime(2);
			await engine.pause();
			const pausedTime = engine.currentTime;

			// Resume — context.resume is called by play()
			mockContext._setCurrentTime(5); // time advanced while paused
			await engine.play();
			// The new source should start from the paused offset
			const lastNode = mockContext._sourceNodes[mockContext._sourceNodes.length - 1];
			expect(lastNode.start).toHaveBeenCalledWith(0, pausedTime);
		});
	});

	describe('stop()', () => {
		it('stops playback and resets position to 0', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			await engine.play('a1');
			mockContext._setCurrentTime(3);
			engine.stop();
			expect(engine.isPlaying).toBe(false);
			expect(engine.currentTime).toBe(0);
		});

		it('stops the source node', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			await engine.play('a1');
			const node = mockContext._sourceNodes[0];
			engine.stop();
			expect(node.stop).toHaveBeenCalled();
			expect(node.disconnect).toHaveBeenCalled();
		});

		it('is a no-op when not playing', () => {
			engine.stop(); // should not throw
			expect(engine.currentTime).toBe(0);
		});
	});

	describe('seek()', () => {
		it('sets playback position while paused', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			await engine.play('a1');
			await engine.pause();
			engine.seek(2.5);
			expect(engine.currentTime).toBeCloseTo(2.5, 1);
		});

		it('restarts playback from new position while playing', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			mockContext._setCurrentTime(0);
			await engine.play('a1');
			const firstNode = mockContext._sourceNodes[0];

			engine.seek(3.0);
			// First source should be stopped
			expect(firstNode.stop).toHaveBeenCalled();
			// New source should start at the seek position
			const secondNode = mockContext._sourceNodes[1];
			expect(secondNode.start).toHaveBeenCalledWith(0, 3.0);
			expect(engine.isPlaying).toBe(true);
		});

		it('clamps negative values to 0', () => {
			engine.seek(-5);
			expect(engine.currentTime).toBe(0);
		});

		it('clamps to buffer duration while playing', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			await engine.play('a1');
			engine.seek(100); // buffer duration is 5.0
			expect(engine.currentTime).toBeCloseTo(5.0, 1);
		});

		it('allows seeking before play sets the start position', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			engine.seek(1.5);
			await engine.play('a1');
			const node = mockContext._sourceNodes[0];
			expect(node.start).toHaveBeenCalledWith(0, 1.5);
		});
	});

	describe('currentTime', () => {
		it('is 0 initially', () => {
			expect(engine.currentTime).toBe(0);
		});

		it('reflects elapsed time during playback', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			mockContext._setCurrentTime(10);
			await engine.play('a1');
			// playbackStartedAt = 10, playbackOffset = 0
			mockContext._setCurrentTime(12.5);
			expect(engine.currentTime).toBeCloseTo(2.5, 1);
		});

		it('freezes when paused', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			mockContext._setCurrentTime(0);
			await engine.play('a1');
			mockContext._setCurrentTime(3);
			await engine.pause();
			const pausedTime = engine.currentTime;
			mockContext._setCurrentTime(100); // time passes while paused
			expect(engine.currentTime).toBe(pausedTime);
		});

		it('resets to 0 after stop', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			await engine.play('a1');
			mockContext._setCurrentTime(3);
			engine.stop();
			expect(engine.currentTime).toBe(0);
		});
	});

	describe('isPlaying', () => {
		it('is false initially', () => {
			expect(engine.isPlaying).toBe(false);
		});

		it('is true during playback', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			await engine.play('a1');
			expect(engine.isPlaying).toBe(true);
		});

		it('is false after pause', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			await engine.play('a1');
			await engine.pause();
			expect(engine.isPlaying).toBe(false);
		});

		it('is false after stop', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			await engine.play('a1');
			engine.stop();
			expect(engine.isPlaying).toBe(false);
		});

		it('becomes false when playback ends naturally', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			await engine.play('a1');
			expect(engine.isPlaying).toBe(true);
			// Simulate the source node's onended firing
			const node = mockContext._sourceNodes[0];
			node._triggerEnded();
			expect(engine.isPlaying).toBe(false);
			expect(engine.currentTime).toBe(0);
		});
	});

	describe('unloadAsset with playback', () => {
		it('stops playback if active asset is unloaded', async () => {
			await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			await engine.play('a1');
			expect(engine.isPlaying).toBe(true);
			engine.unloadAsset('a1');
			expect(engine.isPlaying).toBe(false);
			expect(engine.currentTime).toBe(0);
		});

		it('does not stop playback if a different asset is unloaded', async () => {
			await engine.loadAsset('a1', 'https://example.com/one.mp3');
			await engine.loadAsset('a2', 'https://example.com/two.mp3');
			await engine.play('a1');
			engine.unloadAsset('a2');
			expect(engine.isPlaying).toBe(true);
		});
	});

	describe('clip mixing', () => {
		/** Helper: returns true if connect calls outnumber disconnect calls */
		function isConnected(gainNode: MockGainNode): boolean {
			const connects = (gainNode.connect as ReturnType<typeof vi.fn>).mock.calls.length;
			const disconnects = (gainNode.disconnect as ReturnType<typeof vi.fn>).mock.calls.length;
			return connects > disconnects;
		}

		describe('setClipGain', () => {
			it('creates a GainNode for the clip', () => {
				engine.setClipGain('c1', 0);
				expect(mockContext.createGain).toHaveBeenCalledOnce();
				expect(mockContext._gainNodes.length).toBe(1);
			});

			it('sets gain to linear conversion of 0dB (= 1.0)', () => {
				engine.setClipGain('c1', 0);
				expect(mockContext._gainNodes[0].gain.value).toBeCloseTo(1.0, 5);
			});

			it('sets gain correctly for -6dB', () => {
				engine.setClipGain('c1', -6);
				expect(mockContext._gainNodes[0].gain.value).toBeCloseTo(Math.pow(10, -6 / 20), 3);
			});

			it('sets gain correctly for -12dB', () => {
				engine.setClipGain('c1', -12);
				expect(mockContext._gainNodes[0].gain.value).toBeCloseTo(Math.pow(10, -12 / 20), 3);
			});

			it('sets gain correctly for +6dB', () => {
				engine.setClipGain('c1', 6);
				expect(mockContext._gainNodes[0].gain.value).toBeCloseTo(Math.pow(10, 6 / 20), 3);
			});

			it('reuses GainNode when updating gain on same clip', () => {
				engine.setClipGain('c1', 0);
				engine.setClipGain('c1', -6);
				expect(mockContext.createGain).toHaveBeenCalledOnce();
				expect(mockContext._gainNodes[0].gain.value).toBeCloseTo(Math.pow(10, -6 / 20), 3);
			});

			it('creates separate GainNodes for different clips', () => {
				engine.setClipGain('c1', 0);
				engine.setClipGain('c2', -3);
				expect(mockContext.createGain).toHaveBeenCalledTimes(2);
				expect(mockContext._gainNodes.length).toBe(2);
			});

			it('connects GainNode to destination for unmuted clip', () => {
				engine.setClipGain('c1', 0);
				expect(mockContext._gainNodes[0].connect).toHaveBeenCalledWith(mockContext.destination);
			});
		});

		describe('setClipMute', () => {
			it('disconnects GainNode when muting', () => {
				engine.setClipGain('c1', 0);
				engine.setClipMute('c1', true);
				expect(mockContext._gainNodes[0].disconnect).toHaveBeenCalled();
				expect(isConnected(mockContext._gainNodes[0])).toBe(false);
			});

			it('reconnects GainNode when unmuting', () => {
				engine.setClipGain('c1', 0);
				engine.setClipMute('c1', true);
				engine.setClipMute('c1', false);
				expect(isConnected(mockContext._gainNodes[0])).toBe(true);
			});

			it('muting is idempotent (no extra disconnect calls)', () => {
				engine.setClipGain('c1', 0);
				engine.setClipMute('c1', true);
				const disconnectCount = (mockContext._gainNodes[0].disconnect as ReturnType<typeof vi.fn>).mock.calls.length;
				engine.setClipMute('c1', true);
				expect((mockContext._gainNodes[0].disconnect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(disconnectCount);
			});

			it('auto-creates clip state when muting unknown clip', () => {
				engine.setClipMute('c1', true);
				expect(mockContext.createGain).toHaveBeenCalledOnce();
				expect(isConnected(mockContext._gainNodes[0])).toBe(false);
			});

			it('does not affect other clips', () => {
				engine.setClipGain('c1', 0);
				engine.setClipGain('c2', 0);
				engine.setClipMute('c1', true);
				expect(isConnected(mockContext._gainNodes[0])).toBe(false);
				expect(isConnected(mockContext._gainNodes[1])).toBe(true);
			});
		});

		describe('setClipSolo', () => {
			it('with no solos, all unmuted clips are audible', () => {
				engine.setClipGain('c1', 0);
				engine.setClipGain('c2', 0);
				expect(isConnected(mockContext._gainNodes[0])).toBe(true);
				expect(isConnected(mockContext._gainNodes[1])).toBe(true);
			});

			it('soloing one clip disconnects non-soloed clips', () => {
				engine.setClipGain('c1', 0);
				engine.setClipGain('c2', 0);
				engine.setClipSolo('c1', true);
				expect(isConnected(mockContext._gainNodes[0])).toBe(true);
				expect(isConnected(mockContext._gainNodes[1])).toBe(false);
			});

			it('multiple soloed clips all play simultaneously', () => {
				engine.setClipGain('c1', 0);
				engine.setClipGain('c2', 0);
				engine.setClipGain('c3', 0);
				engine.setClipSolo('c1', true);
				engine.setClipSolo('c2', true);
				expect(isConnected(mockContext._gainNodes[0])).toBe(true);
				expect(isConnected(mockContext._gainNodes[1])).toBe(true);
				expect(isConnected(mockContext._gainNodes[2])).toBe(false);
			});

			it('soloed clip plays even if muted (solo overrides mute)', () => {
				engine.setClipGain('c1', 0);
				engine.setClipGain('c2', 0);
				engine.setClipMute('c1', true);
				expect(isConnected(mockContext._gainNodes[0])).toBe(false);
				engine.setClipSolo('c1', true);
				expect(isConnected(mockContext._gainNodes[0])).toBe(true);
			});

			it('clearing all solos restores prior mute states', () => {
				engine.setClipGain('c1', 0);
				engine.setClipGain('c2', 0);
				// Mute c1
				engine.setClipMute('c1', true);
				expect(isConnected(mockContext._gainNodes[0])).toBe(false);
				expect(isConnected(mockContext._gainNodes[1])).toBe(true);

				// Solo c2 — c1 disconnected (not soloed), c2 connected
				engine.setClipSolo('c2', true);
				expect(isConnected(mockContext._gainNodes[0])).toBe(false);
				expect(isConnected(mockContext._gainNodes[1])).toBe(true);

				// Clear solo on c2 — restores mute states
				engine.setClipSolo('c2', false);
				expect(isConnected(mockContext._gainNodes[0])).toBe(false); // still muted
				expect(isConnected(mockContext._gainNodes[1])).toBe(true);  // unmuted
			});

			it('mute state persists through solo cycle', () => {
				engine.setClipGain('c1', 0);
				engine.setClipGain('c2', 0);
				// Mute c1, solo c1 (overrides mute), then unsolo
				engine.setClipMute('c1', true);
				engine.setClipSolo('c1', true);
				expect(isConnected(mockContext._gainNodes[0])).toBe(true); // soloed wins
				engine.setClipSolo('c1', false);
				expect(isConnected(mockContext._gainNodes[0])).toBe(false); // mute restored
			});

			it('auto-creates clip state when soloing unknown clip', () => {
				engine.setClipSolo('c1', true);
				expect(mockContext.createGain).toHaveBeenCalledOnce();
				expect(isConnected(mockContext._gainNodes[0])).toBe(true);
			});
		});

		describe('each clip has its own GainNode', () => {
			it('clips have independent GainNodes with independent gain values', () => {
				engine.setClipGain('c1', 0);
				engine.setClipGain('c2', -6);
				engine.setClipGain('c3', 6);
				expect(mockContext._gainNodes.length).toBe(3);
				expect(mockContext._gainNodes[0].gain.value).toBeCloseTo(1.0, 3);
				expect(mockContext._gainNodes[1].gain.value).toBeCloseTo(Math.pow(10, -6 / 20), 3);
				expect(mockContext._gainNodes[2].gain.value).toBeCloseTo(Math.pow(10, 6 / 20), 3);
			});

			it('muting one clip does not affect other clips GainNode connections', () => {
				engine.setClipGain('c1', 0);
				engine.setClipGain('c2', 0);
				engine.setClipGain('c3', 0);
				engine.setClipMute('c2', true);
				expect(isConnected(mockContext._gainNodes[0])).toBe(true);
				expect(isConnected(mockContext._gainNodes[1])).toBe(false);
				expect(isConnected(mockContext._gainNodes[2])).toBe(true);
			});
		});

		describe('dispose cleans up clips', () => {
			it('disconnects all GainNodes and clears clip state on dispose', async () => {
				engine.setClipGain('c1', 0);
				engine.setClipGain('c2', -6);
				await engine.dispose();
				expect(mockContext._gainNodes[0].disconnect).toHaveBeenCalled();
				expect(mockContext._gainNodes[1].disconnect).toHaveBeenCalled();
			});
		});
	});

	describe('clip start offset and trim', () => {
		describe('setClipStartOffset', () => {
			it('stores start offset and auto-creates clip state', () => {
				engine.setClipStartOffset('c1', 2.5);
				// No error — clip state created with offset
			});

			it('clamps negative offset to 0', async () => {
				await engine.loadAsset('a1', 'https://example.com/audio.mp3');
				engine.setClipAssetId('c1', 'a1');
				engine.setClipStartOffset('c1', -3);
				mockContext._setCurrentTime(0);
				await engine.play();
				const source = mockContext._sourceNodes[0];
				// Negative offset clamped to 0, clip starts immediately
				expect(source.start).toHaveBeenCalledWith(0, 0, 5.0);
			});
		});

		describe('setClipTrim', () => {
			it('stores trim boundaries', async () => {
				await engine.loadAsset('a1', 'https://example.com/audio.mp3');
				engine.setClipAssetId('c1', 'a1');
				engine.setClipTrim('c1', 1.0, 4.0);
				mockContext._setCurrentTime(0);
				await engine.play();
				const source = mockContext._sourceNodes[0];
				expect(source.start).toHaveBeenCalledWith(0, 1.0, 3.0);
			});

			it('null trimEnd uses full buffer duration', async () => {
				await engine.loadAsset('a1', 'https://example.com/audio.mp3');
				engine.setClipAssetId('c1', 'a1');
				engine.setClipTrim('c1', 1.0, null);
				mockContext._setCurrentTime(0);
				await engine.play();
				const source = mockContext._sourceNodes[0];
				expect(source.start).toHaveBeenCalledWith(0, 1.0, 4.0);
			});

			it('clamps negative values to 0', async () => {
				await engine.loadAsset('a1', 'https://example.com/audio.mp3');
				engine.setClipAssetId('c1', 'a1');
				engine.setClipTrim('c1', -1, null);
				mockContext._setCurrentTime(0);
				await engine.play();
				const source = mockContext._sourceNodes[0];
				expect(source.start).toHaveBeenCalledWith(0, 0, 5.0);
			});
		});

		describe('setClipAssetId', () => {
			it('associates clip with loaded audio asset', async () => {
				await engine.loadAsset('a1', 'https://example.com/audio.mp3');
				engine.setClipAssetId('c1', 'a1');
				mockContext._setCurrentTime(0);
				await engine.play();
				expect(mockContext._sourceNodes.length).toBe(1);
			});

			it('clip without assetId is not scheduled', async () => {
				engine.setClipStartOffset('c1', 0);
				// c1 has no assetId — no clips to schedule, falls through to throw
				await expect(engine.play()).rejects.toThrow('No asset specified');
			});
		});

		describe('clip scheduling during play()', () => {
			beforeEach(async () => {
				await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			});

			it('schedules clip at offset 0 starting immediately', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipStartOffset('c1', 0);
				mockContext._setCurrentTime(0);
				await engine.play();

				const source = mockContext._sourceNodes[0];
				expect(source.buffer).toBe(mockContext._mockBuffer);
				expect(source.start).toHaveBeenCalledWith(0, 0, 5.0);
			});

			it('schedules clip at future offset on AudioContext timeline', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipStartOffset('c1', 2.0);
				mockContext._setCurrentTime(10);
				await engine.play();

				const source = mockContext._sourceNodes[0];
				// whenOnCtx = ctx.currentTime + (startTimeSec - transportTime) = 10 + 2 = 12
				expect(source.start).toHaveBeenCalledWith(12, 0, 5.0);
			});

			it('joins mid-clip when transport is past clip start', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipStartOffset('c1', 0);
				engine.seek(1.0);
				mockContext._setCurrentTime(10);
				await engine.play();

				const source = mockContext._sourceNodes[0];
				// elapsed = 1.0, bufferOffset = 0 + 1.0, playDuration = 5.0 - 1.0
				expect(source.start).toHaveBeenCalledWith(10, 1.0, 4.0);
			});

			it('skips clip whose end time is before transport position', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipStartOffset('c1', 0); // clip ends at 5.0
				engine.seek(6.0);
				mockContext._setCurrentTime(10);
				await engine.play();

				// Clip skipped — no source nodes created
				expect(mockContext._sourceNodes.length).toBe(0);
			});

			it('plays only the trimmed region of the buffer', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipTrim('c1', 1.0, 4.0);
				mockContext._setCurrentTime(0);
				await engine.play();

				const source = mockContext._sourceNodes[0];
				expect(source.start).toHaveBeenCalledWith(0, 1.0, 3.0);
			});

			it('trim and offset work together', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipStartOffset('c1', 2.0);
				engine.setClipTrim('c1', 1.0, 4.0);
				mockContext._setCurrentTime(10);
				await engine.play();

				const source = mockContext._sourceNodes[0];
				// whenOnCtx = 10 + 2 = 12, bufferOffset = 1.0, duration = 3.0
				expect(source.start).toHaveBeenCalledWith(12, 1.0, 3.0);
			});

			it('mid-clip with trim adjusts buffer offset correctly', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipStartOffset('c1', 0);
				engine.setClipTrim('c1', 1.0, 4.0); // 3s trimmed region
				engine.seek(1.5); // 1.5s into the clip
				mockContext._setCurrentTime(10);
				await engine.play();

				const source = mockContext._sourceNodes[0];
				// bufferOffset = trimStart + elapsed = 1.0 + 1.5 = 2.5
				// playDuration = 3.0 - 1.5 = 1.5
				expect(source.start).toHaveBeenCalledWith(10, 2.5, 1.5);
			});

			it('routes clip source through its GainNode', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipGain('c1', -6);
				mockContext._setCurrentTime(0);
				await engine.play();

				const source = mockContext._sourceNodes[0];
				expect(source.connect).toHaveBeenCalledWith(mockContext._gainNodes[0]);
			});

			it('creates GainNode for clip without prior gain/mute/solo setup', async () => {
				engine.setClipAssetId('c1', 'a1');
				mockContext._setCurrentTime(0);
				await engine.play();

				expect(mockContext.createGain).toHaveBeenCalledOnce();
				const source = mockContext._sourceNodes[0];
				expect(source.connect).toHaveBeenCalledWith(mockContext._gainNodes[0]);
			});

			it('stop() stops all clip source nodes', async () => {
				engine.setClipAssetId('c1', 'a1');
				mockContext._setCurrentTime(0);
				await engine.play();

				const source = mockContext._sourceNodes[0];
				engine.stop();
				expect(source.stop).toHaveBeenCalled();
				expect(source.disconnect).toHaveBeenCalled();
				expect(engine.isPlaying).toBe(false);
				expect(engine.currentTime).toBe(0);
			});

			it('pause() stops clip source nodes and preserves position', async () => {
				engine.setClipAssetId('c1', 'a1');
				mockContext._setCurrentTime(0);
				await engine.play();
				mockContext._setCurrentTime(2);
				await engine.pause();

				const source = mockContext._sourceNodes[0];
				expect(source.stop).toHaveBeenCalled();
				expect(engine.currentTime).toBeCloseTo(2, 1);
				expect(engine.isPlaying).toBe(false);
			});

			it('skips clips with unloaded asset buffers', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipAssetId('c2', 'unknown-asset');
				mockContext._setCurrentTime(0);
				await engine.play();

				// Only c1 should be scheduled
				expect(mockContext._sourceNodes.length).toBe(1);
			});

			it('schedules multiple clips at different offsets', async () => {
				await engine.loadAsset('a2', 'https://example.com/audio2.mp3');
				engine.setClipAssetId('c1', 'a1');
				engine.setClipStartOffset('c1', 0);
				engine.setClipAssetId('c2', 'a2');
				engine.setClipStartOffset('c2', 3.0);
				mockContext._setCurrentTime(10);
				await engine.play();

				expect(mockContext._sourceNodes.length).toBe(2);
				// c1 at offset 0: starts at ctx.currentTime = 10
				expect(mockContext._sourceNodes[0].start).toHaveBeenCalledWith(10, 0, 5.0);
				// c2 at offset 3.0: starts at 10 + 3 = 13
				expect(mockContext._sourceNodes[1].start).toHaveBeenCalledWith(13, 0, 5.0);
			});
		});

		describe('setClipLoop — drag-to-extend looping', () => {
			beforeEach(async () => {
				// Buffer duration is 5.0 seconds
				await engine.loadAsset('a1', 'https://example.com/audio.mp3');
			});

			it('stores clipDurationSec on clip state', () => {
				engine.setClipLoop('c1', 12.5);
				// No error — clip state created with clipDurationSec
			});

			it('clamps negative clipDurationSec to 0 — no source nodes scheduled', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipLoop('c1', -5);
				mockContext._setCurrentTime(0);
				await engine.play();
				// clipDurationSec=0 → effectiveDuration=0 → no source nodes
				expect(mockContext._sourceNodes.length).toBe(0);
			});

			it('no looping when clipDurationSec <= trimmed audio length', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipLoop('c1', 3.0); // shorter than 5.0 buffer
				mockContext._setCurrentTime(0);
				await engine.play();

				// Single source node, plays only 3.0 seconds
				expect(mockContext._sourceNodes.length).toBe(1);
				expect(mockContext._sourceNodes[0].start).toHaveBeenCalledWith(0, 0, 3.0);
			});

			it('no looping when clipDurationSec equals trimmed audio length', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipLoop('c1', 5.0); // exact buffer length
				mockContext._setCurrentTime(0);
				await engine.play();

				expect(mockContext._sourceNodes.length).toBe(1);
				expect(mockContext._sourceNodes[0].start).toHaveBeenCalledWith(0, 0, 5.0);
			});

			it('loops exactly 2x the trimmed region', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipLoop('c1', 10.0); // 2x 5.0
				mockContext._setCurrentTime(0);
				await engine.play();

				// Two source nodes, each playing full 5.0 buffer
				expect(mockContext._sourceNodes.length).toBe(2);
				expect(mockContext._sourceNodes[0].start).toHaveBeenCalledWith(0, 0, 5.0);
				expect(mockContext._sourceNodes[1].start).toHaveBeenCalledWith(5.0, 0, 5.0);
			});

			it('partial loop: 2.5x the trimmed region', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipLoop('c1', 12.5); // 2.5x 5.0
				mockContext._setCurrentTime(0);
				await engine.play();

				// 3 source nodes: full + full + 2.5s partial
				expect(mockContext._sourceNodes.length).toBe(3);
				expect(mockContext._sourceNodes[0].start).toHaveBeenCalledWith(0, 0, 5.0);
				expect(mockContext._sourceNodes[1].start).toHaveBeenCalledWith(5.0, 0, 5.0);
				expect(mockContext._sourceNodes[2].start).toHaveBeenCalledWith(10.0, 0, 2.5);
			});

			it('looping with trim region: repeats trimmed segment', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipTrim('c1', 1.0, 3.0); // 2.0s trimmed region
				engine.setClipLoop('c1', 5.0); // 2.5x the trimmed region
				mockContext._setCurrentTime(0);
				await engine.play();

				// 3 source nodes: 2.0 + 2.0 + 1.0 partial
				expect(mockContext._sourceNodes.length).toBe(3);
				expect(mockContext._sourceNodes[0].start).toHaveBeenCalledWith(0, 1.0, 2.0);
				expect(mockContext._sourceNodes[1].start).toHaveBeenCalledWith(2.0, 1.0, 2.0);
				expect(mockContext._sourceNodes[2].start).toHaveBeenCalledWith(4.0, 1.0, 1.0);
			});

			it('looping with start offset: loops start at offset', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipStartOffset('c1', 3.0);
				engine.setClipLoop('c1', 10.0); // 2x 5.0
				mockContext._setCurrentTime(10);
				await engine.play();

				// Clip starts at transport 3.0 → ctx time 10 + 3 = 13
				expect(mockContext._sourceNodes.length).toBe(2);
				expect(mockContext._sourceNodes[0].start).toHaveBeenCalledWith(13, 0, 5.0);
				expect(mockContext._sourceNodes[1].start).toHaveBeenCalledWith(18, 0, 5.0);
			});

			it('mid-clip join during first loop iteration', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipLoop('c1', 15.0); // 3x 5.0
				engine.seek(2.0); // 2s into the clip
				mockContext._setCurrentTime(10);
				await engine.play();

				// elapsedInClip = 2.0, loopOffset = 2.0 % 5.0 = 2.0
				// First: plays 3.0s (5.0 - 2.0) from buffer offset 2.0
				// Second: full 5.0s
				// Third: full 5.0s
				expect(mockContext._sourceNodes.length).toBe(3);
				expect(mockContext._sourceNodes[0].start).toHaveBeenCalledWith(10, 2.0, 3.0);
				expect(mockContext._sourceNodes[1].start).toHaveBeenCalledWith(13, 0, 5.0);
				expect(mockContext._sourceNodes[2].start).toHaveBeenCalledWith(18, 0, 5.0);
			});

			it('mid-clip join during second loop iteration', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipLoop('c1', 15.0); // 3x 5.0
				engine.seek(7.0); // 7s into the clip → 2nd iteration, 2.0 into buffer
				mockContext._setCurrentTime(10);
				await engine.play();

				// elapsedInClip = 7.0, loopOffset = 7.0 % 5.0 = 2.0, remaining = 15 - 7 = 8.0
				// First: plays 3.0s (5.0 - 2.0) from buffer offset 2.0
				// Second: full 5.0s
				expect(mockContext._sourceNodes.length).toBe(2);
				expect(mockContext._sourceNodes[0].start).toHaveBeenCalledWith(10, 2.0, 3.0);
				expect(mockContext._sourceNodes[1].start).toHaveBeenCalledWith(13, 0, 5.0);
			});

			it('mid-clip join during partial last loop', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipLoop('c1', 12.5); // 2.5x 5.0
				engine.seek(11.0); // 11s into the clip → 3rd iteration, 1.0 into buffer
				mockContext._setCurrentTime(10);
				await engine.play();

				// elapsedInClip = 11.0, loopOffset = 11.0 % 5.0 = 1.0, remaining = 12.5 - 11.0 = 1.5
				// Only 1.5s left from buffer offset 1.0
				expect(mockContext._sourceNodes.length).toBe(1);
				expect(mockContext._sourceNodes[0].start).toHaveBeenCalledWith(10, 1.0, 1.5);
			});

			it('skips looped clip that has fully ended', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipLoop('c1', 10.0);
				engine.seek(11.0); // past the clip end (10s)
				mockContext._setCurrentTime(10);
				await engine.play();

				// Clip already ended — no source nodes
				expect(mockContext._sourceNodes.length).toBe(0);
			});

			it('stop cleans up all loop source nodes', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipLoop('c1', 15.0); // 3 source nodes
				mockContext._setCurrentTime(0);
				await engine.play();

				expect(mockContext._sourceNodes.length).toBe(3);
				engine.stop();
				for (const node of mockContext._sourceNodes) {
					expect(node.stop).toHaveBeenCalled();
					expect(node.disconnect).toHaveBeenCalled();
				}
				expect(engine.isPlaying).toBe(false);
			});

			it('all loop sources connect through the clip GainNode', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipGain('c1', -6);
				engine.setClipLoop('c1', 10.0); // 2 source nodes
				mockContext._setCurrentTime(0);
				await engine.play();

				expect(mockContext._sourceNodes.length).toBe(2);
				for (const node of mockContext._sourceNodes) {
					expect(node.connect).toHaveBeenCalledWith(mockContext._gainNodes[0]);
				}
			});

			it('looping with trim and offset combined', async () => {
				engine.setClipAssetId('c1', 'a1');
				engine.setClipStartOffset('c1', 2.0);
				engine.setClipTrim('c1', 1.0, 3.0); // 2.0s trimmed region
				engine.setClipLoop('c1', 7.0); // 3.5x the 2.0s trimmed region
				mockContext._setCurrentTime(10);
				await engine.play();

				// Clip starts at transport 2.0, loops 2.0s regions for 7.0s total
				expect(mockContext._sourceNodes.length).toBe(4);
				expect(mockContext._sourceNodes[0].start).toHaveBeenCalledWith(12, 1.0, 2.0);
				expect(mockContext._sourceNodes[1].start).toHaveBeenCalledWith(14, 1.0, 2.0);
				expect(mockContext._sourceNodes[2].start).toHaveBeenCalledWith(16, 1.0, 2.0);
				expect(mockContext._sourceNodes[3].start).toHaveBeenCalledWith(18, 1.0, 1.0);
			});
		});
	});
});
