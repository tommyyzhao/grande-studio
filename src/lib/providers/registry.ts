import type { ProviderRegistryEntry } from './types';

export const providerRegistry: readonly ProviderRegistryEntry[] = [
	{
		id: 'minimax',
		enabled: true,
		stub: false,
		displayName: 'MiniMax'
	},
	{
		id: 'elevenlabs',
		enabled: false,
		stub: true,
		displayName: 'ElevenLabs'
	},
	{
		id: 'stability',
		enabled: false,
		stub: true,
		displayName: 'Stability AI'
	}
] as const;

export function getProvider(id: string): ProviderRegistryEntry | undefined {
	return providerRegistry.find((entry) => entry.id === id);
}

export function getEnabledProviders(): ProviderRegistryEntry[] {
	return providerRegistry.filter((entry) => entry.enabled);
}
