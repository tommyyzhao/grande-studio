<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import {
		MINIMAX_MAX_LYRICS_LENGTH,
		SUPPORTED_STRUCTURE_TAGS
	} from '$lib/providers/minimax/validateMusicRequest';

	interface Props {
		projectId: string | null;
		onGenerated?: (result: {
			jobId: string;
			assetId: string;
			prompt: string;
			lyrics: string | null;
			parentAssetId: string | null;
			branchType: 'prompt_variation' | 'cover_restyle' | null;
		}) => void;
	}

	let { projectId, onGenerated }: Props = $props();

	// ─── Variation mode (prefilled from parent asset) ────────────────────
	let parentAssetId = $state<string | null>(null);
	let variationBannerVisible = $derived(parentAssetId !== null);

	/**
	 * Prefill the generate panel with prompt/lyrics from a parent asset.
	 * Called externally when the user clicks "Create variation" on a block.
	 */
	export function prefill(prefillPrompt: string | null, prefillLyrics: string | null, parentId: string) {
		panelMode = 'generate';
		prompt = prefillPrompt ?? '';
		lyrics = prefillLyrics ?? '';
		instrumental = false;
		parentAssetId = parentId;
		errorMessage = '';
	}

	function clearVariationMode() {
		parentAssetId = null;
	}

	// ─── Cover from existing block (pre-selected source, no upload) ─────
	let coverSourceTitle = $state<string | null>(null);

	/**
	 * Switch to cover/re-style mode with an existing R2-backed asset as source.
	 * Called externally when the user clicks "Cover / Re-style" on a ready block.
	 */
	export function prefillCover(assetId: string, assetTitle: string, prefillPrompt?: string | null, prefillLyrics?: string | null) {
		panelMode = 'cover_restyle';
		sourceAssetId = assetId;
		coverSourceTitle = assetTitle;
		uploadedFile = null;
		uploadError = '';
		uploadProgress = 0;
		prompt = prefillPrompt ?? '';
		lyrics = prefillLyrics ?? '';
		instrumental = false;
		parentAssetId = assetId;
		errorMessage = '';
	}

	function clearCoverSource() {
		coverSourceTitle = null;
		sourceAssetId = null;
		parentAssetId = null;
	}

	// ─── Panel mode ──────────────────────────────────────────────────────
	type PanelMode = 'generate' | 'cover_restyle';
	let panelMode = $state<PanelMode>('generate');

	// ─── Form state ──────────────────────────────────────────────────────
	let prompt = $state('');
	let instrumental = $state(false);
	let lyrics = $state('');
	let submitting = $state(false);
	let errorMessage = $state('');
	let lastResult: { jobId: string; assetId: string } | null = $state(null);
	let lyricsRef = $state<HTMLTextAreaElement | null>(null);

	// ─── File upload state ───────────────────────────────────────────────
	let uploadedFile = $state<File | null>(null);
	let uploading = $state(false);
	let uploadProgress = $state(0);
	let uploadError = $state('');
	let sourceAssetId = $state<string | null>(null);
	let fileInputRef = $state<HTMLInputElement | null>(null);

	const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
	const ACCEPTED_FORMATS = '.mp3,.wav,.m4a,.flac';
	const ACCEPTED_MIME_TYPES = [
		'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave',
		'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac',
		'audio/flac', 'audio/x-flac'
	];

	let promptEmpty = $derived(!prompt.trim());
	let lyricsLength = $derived(lyrics.length);
	let lyricsOverLimit = $derived(lyricsLength > MINIMAX_MAX_LYRICS_LENGTH);

	// ─── Structure tag extraction & warnings ─────────────────────────────
	function extractBracketedTags(text: string): string[] {
		const matches = text.match(/\[[^\]]+\]/g);
		return matches ?? [];
	}

	let embeddedTags = $derived(extractBracketedTags(lyrics));

	let unsupportedTagWarnings = $derived.by(() => {
		const warnings: string[] = [];
		for (const tag of embeddedTags) {
			if (
				!SUPPORTED_STRUCTURE_TAGS.includes(
					tag as (typeof SUPPORTED_STRUCTURE_TAGS)[number]
				)
			) {
				warnings.push(`Unsupported structure tag: ${tag}`);
			}
		}
		return warnings;
	});

	let structureTags = $derived(
		embeddedTags.filter((tag) =>
			SUPPORTED_STRUCTURE_TAGS.includes(
				tag as (typeof SUPPORTED_STRUCTURE_TAGS)[number]
			)
		)
	);

	// ─── Client-side validation ──────────────────────────────────────────
	let validationError = $derived.by(() => {
		if (panelMode === 'generate') {
			if (instrumental && lyrics.trim().length > 0) {
				return 'Lyrics cannot be provided when instrumental mode is enabled. Clear the lyrics or disable instrumental mode.';
			}
		}
		if (panelMode === 'cover_restyle' && !sourceAssetId && !uploading) {
			return 'Upload a source audio file for Cover / Re-style';
		}
		if (lyricsOverLimit) {
			return `Lyrics exceed maximum length of ${MINIMAX_MAX_LYRICS_LENGTH} characters (current: ${lyricsLength})`;
		}
		return '';
	});

	let canSubmit = $derived.by(() => {
		if (promptEmpty || submitting || !projectId) return false;
		if (panelMode === 'generate' && validationError) return false;
		if (panelMode === 'cover_restyle') {
			if (!sourceAssetId || uploading) return false;
			if (lyricsOverLimit) return false;
		}
		return true;
	});

	// ─── Tag insertion ───────────────────────────────────────────────────
	function insertTag(tag: string) {
		if (!lyricsRef) return;

		const start = lyricsRef.selectionStart ?? lyrics.length;
		const end = lyricsRef.selectionEnd ?? start;

		const before = lyrics.slice(0, start);
		const after = lyrics.slice(end);

		// Add newline before tag if not at start and previous char isn't a newline
		const needsNewlineBefore = before.length > 0 && !before.endsWith('\n');
		// Add newline after tag so cursor is on a new line ready for lyrics
		const insertText = (needsNewlineBefore ? '\n' : '') + tag + '\n';

		lyrics = before + insertText + after;

		// Restore focus and set cursor after the inserted tag
		const newCursorPos = start + insertText.length;
		// Use tick to wait for Svelte to update the textarea value
		requestAnimationFrame(() => {
			if (lyricsRef) {
				lyricsRef.focus();
				lyricsRef.selectionStart = newCursorPos;
				lyricsRef.selectionEnd = newCursorPos;
			}
		});
	}

	// ─── File upload handler ─────────────────────────────────────────────
	function validateFile(file: File): string | null {
		if (file.size > MAX_FILE_SIZE) {
			const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
			return `File too large (${sizeMB}MB). Maximum allowed size is 50MB.`;
		}
		if (file.size === 0) {
			return 'File is empty.';
		}
		// Check MIME type or extension fallback
		const ext = file.name.toLowerCase().split('.').pop() ?? '';
		const validMime = ACCEPTED_MIME_TYPES.includes(file.type);
		const validExt = ['mp3', 'wav', 'm4a', 'flac'].includes(ext);
		if (!validMime && !validExt) {
			return `Unsupported file type. Accepted formats: MP3, WAV, M4A, FLAC.`;
		}
		return null;
	}

	async function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !projectId) return;

		// Validate client-side
		const fileError = validateFile(file);
		if (fileError) {
			uploadError = fileError;
			input.value = '';
			return;
		}

		uploadError = '';
		uploadedFile = file;
		sourceAssetId = null;
		uploading = true;
		uploadProgress = 0;

		try {
			const formData = new FormData();
			formData.append('file', file);
			formData.append('projectId', projectId);

			// Use XMLHttpRequest for progress tracking
			const result = await new Promise<{ assetId: string }>((resolve, reject) => {
				const xhr = new XMLHttpRequest();
				xhr.open('POST', '/api/upload');

				xhr.upload.onprogress = (event) => {
					if (event.lengthComputable) {
						uploadProgress = Math.round((event.loaded / event.total) * 100);
					}
				};

				xhr.onload = () => {
					if (xhr.status >= 200 && xhr.status < 300) {
						try {
							resolve(JSON.parse(xhr.responseText));
						} catch {
							reject(new Error('Invalid response from server'));
						}
					} else {
						try {
							const data = JSON.parse(xhr.responseText);
							reject(new Error(data.message ?? `Upload failed (${xhr.status})`));
						} catch {
							reject(new Error(`Upload failed (${xhr.status})`));
						}
					}
				};

				xhr.onerror = () => reject(new Error('Network error during upload'));
				xhr.send(formData);
			});

			sourceAssetId = result.assetId;
			uploadProgress = 100;
		} catch (err) {
			uploadError = err instanceof Error ? err.message : 'Upload failed. Please try again.';
			uploadedFile = null;
			sourceAssetId = null;
		} finally {
			uploading = false;
		}
	}

	function clearUploadedFile() {
		uploadedFile = null;
		sourceAssetId = null;
		uploadError = '';
		uploadProgress = 0;
		if (fileInputRef) fileInputRef.value = '';
	}

	// ─── Submit handler ──────────────────────────────────────────────────
	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!canSubmit) return;

		submitting = true;
		errorMessage = '';
		lastResult = null;

		try {
			const idempotencyKey = crypto.randomUUID();
			const trimmedLyrics = lyrics.trim();

			let mode: 'text_to_music' | 'instrumental' | 'cover_restyle';
			if (panelMode === 'cover_restyle') {
				mode = 'cover_restyle';
			} else {
				mode = instrumental ? 'instrumental' : 'text_to_music';
			}

			const res = await fetch('/api/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					projectId,
					prompt: prompt.trim(),
					mode,
					instrumental: panelMode === 'generate' ? instrumental : false,
					lyrics: trimmedLyrics || undefined,
					lyricsOptimizer: panelMode === 'generate' && !instrumental && !trimmedLyrics,
					structureTags: structureTags.length > 0 ? structureTags : undefined,
					sourceAssetId: panelMode === 'cover_restyle' ? sourceAssetId : undefined,
					idempotencyKey
				})
			});

			if (!res.ok) {
				const data = await res.json().catch(() => null);
				const msg =
					data?.message ?? `Generation failed (${res.status})`;
				errorMessage = msg;
				return;
			}

			const data = await res.json();
			lastResult = { jobId: data.jobId, assetId: data.assetId };

			// Notify parent so block list can add a queued block immediately
			const submittedPrompt = prompt.trim();
			const submittedLyrics = lyrics.trim() || null;
			const submittedParentAssetId = parentAssetId;
			const submittedBranchType = panelMode === 'cover_restyle'
				? 'cover_restyle' as const
				: parentAssetId ? 'prompt_variation' as const : null;
			onGenerated?.({
				jobId: data.jobId,
				assetId: data.assetId,
				prompt: submittedPrompt,
				lyrics: submittedLyrics,
				parentAssetId: submittedParentAssetId,
				branchType: submittedBranchType
			});

			prompt = '';
			lyrics = '';
			instrumental = false;
			parentAssetId = null;
			if (panelMode === 'cover_restyle') {
				clearUploadedFile();
				coverSourceTitle = null;
			}
		} catch (err) {
			errorMessage = 'Network error. Please try again.';
		} finally {
			submitting = false;
		}
	}
</script>

<form onsubmit={handleSubmit} class="flex flex-col gap-3">
	<!-- ═══ Variation Banner ═══ -->
	{#if variationBannerVisible}
		<div class="flex items-center justify-between rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2">
			<span class="text-sm text-blue-700 dark:text-blue-400">Creating variation from parent block</span>
			<button
				type="button"
				class="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
				onclick={clearVariationMode}
			>
				Cancel
			</button>
		</div>
	{/if}

	<!-- ═══ Mode Toggle ═══ -->
	<div class="flex gap-1 rounded-lg border p-0.5">
		<button
			type="button"
			class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors {panelMode === 'generate' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}"
			onclick={() => { panelMode = 'generate'; errorMessage = ''; }}
			disabled={submitting}
		>
			Generate
		</button>
		<button
			type="button"
			class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors {panelMode === 'cover_restyle' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}"
			onclick={() => { panelMode = 'cover_restyle'; errorMessage = ''; }}
			disabled={submitting}
		>
			Cover / Re-style
		</button>
	</div>

	<!-- ═══ Prompt ═══ -->
	<div class="flex flex-col gap-1.5">
		<Label for="prompt-input">
			{panelMode === 'cover_restyle' ? 'Describe the style for the cover' : 'Describe the music you want to create'}
		</Label>
		<Textarea
			id="prompt-input"
			placeholder={panelMode === 'cover_restyle'
				? 'e.g. Acoustic folk version with gentle fingerpicking...'
				: 'e.g. A dreamy lo-fi hip hop beat with soft piano and vinyl crackle...'}
			bind:value={prompt}
			disabled={submitting}
			class="min-h-20 resize-none"
			rows={3}
		/>
	</div>

	<!-- ═══ Cover / Re-style: File Upload ═══ -->
	{#if panelMode === 'cover_restyle'}
		<div class="flex flex-col gap-1.5">
			<Label for="source-upload">Source audio file</Label>
			{#if sourceAssetId && coverSourceTitle}
				<!-- Pre-selected source from existing block -->
				<div class="bg-muted/50 flex items-center justify-between rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2">
					<div class="flex items-center gap-2 overflow-hidden">
						<span class="text-sm">&#9835;</span>
						<span class="truncate text-sm font-medium">{coverSourceTitle}</span>
						<span class="text-muted-foreground text-xs">(existing block)</span>
					</div>
					<button
						type="button"
						class="text-muted-foreground hover:text-foreground ml-2 shrink-0 text-sm"
						onclick={clearCoverSource}
						disabled={submitting}
					>
						Remove
					</button>
				</div>
			{:else if sourceAssetId && uploadedFile}
				<!-- Uploaded file display -->
				<div class="bg-muted/50 flex items-center justify-between rounded-md border px-3 py-2">
					<div class="flex items-center gap-2 overflow-hidden">
						<span class="text-muted-foreground text-sm">&#9835;</span>
						<span class="truncate text-sm">{uploadedFile.name}</span>
						<span class="text-muted-foreground text-xs">
							({(uploadedFile.size / (1024 * 1024)).toFixed(1)}MB)
						</span>
					</div>
					<button
						type="button"
						class="text-muted-foreground hover:text-foreground ml-2 shrink-0 text-sm"
						onclick={clearUploadedFile}
						disabled={submitting}
					>
						Remove
					</button>
				</div>
			{:else}
				<!-- File input -->
				<input
					id="source-upload"
					type="file"
					accept={ACCEPTED_FORMATS}
					onchange={handleFileSelect}
					bind:this={fileInputRef}
					disabled={submitting || uploading}
					class="text-muted-foreground file:bg-muted file:text-foreground file:hover:bg-muted/80 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-medium file:transition-colors"
				/>
				<p class="text-muted-foreground text-xs">
					Accepted formats: MP3, WAV, M4A, FLAC (max 50MB)
				</p>
			{/if}

			<!-- Upload progress -->
			{#if uploading}
				<div class="flex flex-col gap-1">
					<div class="bg-muted h-2 w-full overflow-hidden rounded-full">
						<div
							class="bg-primary h-full rounded-full transition-all duration-200"
							style="width: {uploadProgress}%"
						></div>
					</div>
					<span class="text-muted-foreground text-xs">Uploading... {uploadProgress}%</span>
				</div>
			{/if}

			{#if uploadError}
				<p class="text-destructive text-sm">{uploadError}</p>
			{/if}
		</div>
	{/if}

	<!-- ═══ Instrumental toggle (Generate mode only) ═══ -->
	{#if panelMode === 'generate'}
		<div class="flex items-center gap-2">
			<Switch
				id="instrumental-toggle"
				bind:checked={instrumental}
				disabled={submitting}
				size="sm"
			/>
			<Label for="instrumental-toggle" class="cursor-pointer text-sm font-medium">
				Instrumental only
			</Label>
		</div>
	{/if}

	<!-- ═══ Lyrics textarea ═══ -->
	<div class="flex flex-col gap-1.5">
		<Label for="lyrics-input" class={panelMode === 'generate' && instrumental ? 'text-muted-foreground' : ''}>
			Lyrics {panelMode === 'cover_restyle' ? '(optional)' : ''}
		</Label>
		{#if panelMode === 'generate' && instrumental}
			<p class="text-muted-foreground text-sm italic">
				Lyrics are not used in instrumental mode
			</p>
		{:else}
			<Textarea
				id="lyrics-input"
				placeholder={panelMode === 'cover_restyle'
					? 'Enter lyrics (optional in cover mode)'
					: 'Enter lyrics (optional — leave empty to auto-generate)'}
				bind:value={lyrics}
				bind:ref={lyricsRef}
				disabled={submitting}
				class="min-h-24 resize-y font-mono text-sm"
				rows={4}
			/>
			<!-- Structure tag palette -->
			<div class="flex flex-col gap-1.5">
				<span class="text-muted-foreground text-xs">Insert structure tag</span>
				<div class="flex flex-wrap gap-1">
					{#each SUPPORTED_STRUCTURE_TAGS as tag}
						<button
							type="button"
							class="bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground rounded-md border px-2 py-0.5 text-xs font-mono transition-colors disabled:opacity-50"
							disabled={submitting}
							onclick={() => insertTag(tag)}
						>
							{tag}
						</button>
					{/each}
				</div>
			</div>
			<div class="flex items-center justify-end gap-1">
				<span
					class="text-xs {lyricsOverLimit
						? 'text-destructive font-medium'
						: 'text-muted-foreground'}"
				>
					{lyricsLength} / {MINIMAX_MAX_LYRICS_LENGTH}
				</span>
			</div>
		{/if}
	</div>

	{#if unsupportedTagWarnings.length > 0}
		<div class="rounded-md border border-yellow-500/50 bg-yellow-500/10 px-3 py-2">
			{#each unsupportedTagWarnings as warning}
				<p class="text-sm text-yellow-700 dark:text-yellow-400">{warning}</p>
			{/each}
		</div>
	{/if}

	{#if validationError && !(panelMode === 'cover_restyle' && !sourceAssetId && !uploadError)}
		<p class="text-destructive text-sm">{validationError}</p>
	{/if}

	{#if errorMessage}
		<p class="text-destructive text-sm">{errorMessage}</p>
	{/if}

	<div class="flex items-center gap-2">
		<Button type="submit" disabled={!canSubmit} size="sm">
			{#if submitting}
				Generating...
			{:else if panelMode === 'cover_restyle'}
				Generate Cover
			{:else}
				Generate
			{/if}
		</Button>
	</div>
</form>
