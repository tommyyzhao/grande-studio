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
		destination: {},
		sampleRate: 44100,
		_mockBuffer: mockBuffer,
		_sourceNodes: sourceNodes,
		_setCurrentTime(t: number) {
			_currentTime = t;
		}
	};

	return ctx as unknown as AudioContext & {
		_mockBuffer: AudioBuffer;
		_sourceNodes: MockSourceNode[];
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
});
