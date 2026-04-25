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

function createMockAudioContext() {
	let _state: AudioContextState = 'running';
	const mockBuffer = createMockAudioBuffer();

	const ctx = {
		get state() {
			return _state;
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
		destination: {},
		currentTime: 0,
		sampleRate: 44100,
		_mockBuffer: mockBuffer
	};

	return ctx as unknown as AudioContext & { _mockBuffer: AudioBuffer };
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
	});
});
