<!-- src/routes/+page.svelte -->
<script lang="ts">
	import JSZip from 'jszip';
	import { slide, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { ministral } from '$lib/ministral';

	// UI State
	let status = 'Ready to initialize';
	let progress = 0;
	let isModelReady = false;
	let isProcessing = false;
	let isDownloading = false;
	let dragActive = false;

	// Data State
	let prompt = 'Describe this image';
	let results: Array<{ fileName: string; imageSrc: string; response: string }> = [];

	// DOM Elements
	let fileInput: HTMLInputElement;

	// --- 1. Model Loader Logic ---

	async function loadModel() {
		if (ministral.isLoaded || isDownloading) return;

		isDownloading = true;

		try {
			await ministral.load((msg, p) => {
				status = msg;
				progress = p;
			});
			isModelReady = true;
			status = 'Model loaded successfully.';
		} catch (e) {
			status = 'Error loading model: ' + e;
			isDownloading = false;
			console.error(e);
		}
	}

	// --- 2. File Handling (Dropzone & Input) ---

	function triggerFileInput() {
		fileInput.click();
	}

	function handleDrag(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (e.type === 'dragenter' || e.type === 'dragover') {
			dragActive = true;
		} else if (e.type === 'dragleave') {
			dragActive = false;
		}
	}

	async function handleDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragActive = false;

		if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
			await processFile(e.dataTransfer.files[0]);
		}
	}

	async function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (file) {
			await processFile(file);
		}
	}

	async function processFile(file: File) {
		if (!file.name.endsWith('.zip')) {
			status = 'Please upload a valid .zip file';
			return;
		}

		try {
			const zip = new JSZip();
			const zipData = await zip.loadAsync(file);
			// Reset results
			results = [];
			const imagePromises: Promise<void>[] = [];

			zipData.forEach((relativePath, zipEntry) => {
				// Filter for images and ignore MACOSX artifacts
				const isImage =
					/\.(jpg|jpeg|png|gif|webp)$/i.test(relativePath) && !/^__MACOSX|\/\._/.test(relativePath);

				if (isImage && !zipEntry.dir) {
					imagePromises.push(
						zipEntry.async('blob').then((blob) => {
							return new Promise<void>((resolve) => {
								const reader = new FileReader();
								reader.onload = (evt) => {
									const imageSrc = evt.target?.result as string;
									results.push({
										fileName: relativePath.split('/').pop() || relativePath,
										imageSrc,
										response: ''
									});
									results = results; // trigger reactivity
									resolve();
								};
								reader.readAsDataURL(blob);
							});
						})
					);
				}
			});

			await Promise.all(imagePromises);
			status = `Loaded ${results.length} images ready for analysis.`;
		} catch (e) {
			status = 'Error parsing zip file: ' + e;
			console.error(e);
		}
	}

	// --- 3. Inference Logic ---

	async function runInference() {
		if (!results.length || !isModelReady) return;

		isProcessing = true;

		try {
			for (let i = 0; i < results.length; i++) {
				const result = results[i];
				const img = new Image();
				img.src = result.imageSrc;

				await new Promise<void>((resolve) => {
					img.onload = async () => {
						try {
							await ministral.generate(img, prompt, (updatedText) => {
								results[i].response = updatedText;
								results = results; // trigger reactivity
							});
						} catch (e) {
							results[i].response = 'Error: ' + e;
							results = results;
						}
						resolve();
					};
				});
			}
			status = 'Processing complete.';
		} catch (e) {
			status = 'Error during batch processing: ' + e;
		} finally {
			isProcessing = false;
		}
	}

	// --- 4. Export Logic ---

	function downloadCSV() {
		if (!results.length) return;

		const escapeCSV = (str: string) => {
			if (str.includes(',') || str.includes('"') || str.includes('\n')) {
				return `"${str.replace(/"/g, '""')}"`;
			}
			return str;
		};

		const headers = ['File Name', 'Response'];
		const csvRows = [
			headers.join(','),
			...results.map((r) => `${escapeCSV(r.fileName)},${escapeCSV(r.response)}`)
		];

		const csvContent = csvRows.join('\n');
		const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);

		const link = document.createElement('a');
		link.href = url;
		link.download = `vision-results-${new Date().getTime()}.csv`;
		link.click();

		URL.revokeObjectURL(url);
	}
</script>

<div class="min-h-screen bg-gray-50 font-sans text-gray-900 selection:bg-indigo-100">
	<div class="mx-auto max-w-7xl px-6 py-12">
		<!-- Header -->
		<header class="mb-10 text-center">
			<h1 class="text-2xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
				Mistral 3B Vision
			</h1>
			<p class="mt-4 text-lg font-medium text-gray-500">
				Local & private image analysis in your browser
			</p>
			<p class="font-medium text-gray-500">Works best in Google Chrome (desktop)</p>
		</header>

		<!-- SECTION: Model Loader (Slides away when ready) -->
		{#if !isModelReady}
			<section
				transition:slide={{ duration: 500, easing: cubicOut, axis: 'y' }}
				class="mx-auto mb-8 max-w-2xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
			>
				<div class="border-b border-gray-100 bg-gray-50/50 px-6 py-4">
					<h2 class="flex items-center gap-2 text-lg font-semibold text-gray-800">
						<span
							class="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs text-white"
							>1</span
						>
						Initialise Model
					</h2>
				</div>

				<div class="p-8 text-center">
					<p class="mb-6 text-gray-600">
						To begin, we need to download the Ministral-3B model (~3GB). This happens once and is
						stored in your browser cache.
					</p>

					{#if isDownloading}
						<div class="mx-auto mb-6 w-full max-w-md">
							<div
								class="mb-2 flex justify-between text-xs font-semibold tracking-wider text-gray-500 uppercase"
							>
								<span>Downloading</span>
								<span>{Math.round(progress)}%</span>
							</div>
							<div class="h-2 w-full overflow-hidden rounded-full bg-gray-100">
								<div
									class="h-full bg-indigo-600 transition-all duration-200 ease-linear"
									style="width: {progress}%"
								></div>
							</div>
							<p class="mt-3 font-mono text-xs text-gray-400">{status}</p>
						</div>
					{/if}

					<button
						on:click={loadModel}
						disabled={isDownloading}
						class="inline-flex cursor-pointer items-center justify-center rounded-xl bg-gray-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-black hover:shadow-md disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
					>
						{#if isDownloading}
							<svg
								class="mr-2 -ml-1 h-4 w-4 animate-spin text-gray-400"
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
							>
								<circle
									class="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									stroke-width="4"
								></circle>
								<path
									class="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
								></path>
							</svg>
							Loading Model...
						{:else}
							Download & Load Model
						{/if}
					</button>
				</div>
			</section>
		{:else}
			<!-- Small status badge when model is loaded -->
			<div
				transition:fade
				class="mb-8 flex items-center justify-center gap-2 rounded-full border border-green-200 bg-green-50 py-1.5 text-sm font-medium text-green-700"
			>
				<span class="relative flex h-2.5 w-2.5">
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"
					></span>
					<span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500"></span>
				</span>
				Model Ready
			</div>
		{/if}

		<!-- SECTION: Interaction (Only visible when loaded or fading in) -->
		<section
			class="rounded-2xl border border-gray-200 bg-white shadow-sm transition-opacity duration-500 {isModelReady
				? 'opacity-100'
				: 'pointer-events-none opacity-40 blur-sm filter'}"
		>
			<div class="border-b border-gray-100 px-6 py-5">
				<h2 class="text-xl font-bold tracking-tight text-gray-900">Batch Analysis</h2>
				<p class="text-sm text-gray-500">Upload images and define your prompt.</p>
			</div>

			<div class="p-6">
				<!-- Styled Dropzone -->
				<div class="space-y-6">
					<div>
						<label for="dropzone" class="mb-2 block text-sm font-medium text-gray-700"
							>Upload Images (ZIP)</label
						>
						<!-- svelte-ignore a11y-click-events-have-key-events -->
						<div
							role="button"
							tabindex="0"
							on:click={triggerFileInput}
							on:dragenter={handleDrag}
							on:dragleave={handleDrag}
							on:dragover={handleDrag}
							on:drop={handleDrop}
							class="group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 transition-all duration-200 ease-in-out
                            {dragActive
								? 'border-indigo-500 bg-indigo-50/50'
								: 'border-gray-300 bg-gray-50 hover:border-indigo-400 hover:bg-white'}"
						>
							<input
								id="zip-upload"
								type="file"
								accept=".zip"
								bind:this={fileInput}
								on:change={handleFileSelect}
								class="hidden"
								disabled={!isModelReady}
							/>
							<div
								class="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-gray-900/5 transition-transform group-hover:scale-110 group-hover:text-indigo-600"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
									stroke-width="1.5"
									stroke="currentColor"
									class="h-6 w-6 text-gray-500 group-hover:text-indigo-600"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
									/>
								</svg>
							</div>
							<div class="mt-4 flex text-sm text-gray-600">
								<span class="font-semibold text-indigo-600 hover:text-indigo-500"
									>Click to upload</span
								>
								<span class="pl-1">or drag and drop ZIP</span>
							</div>
							<p class="mt-1 text-xs text-gray-500">Supported images: JPG, PNG, GIF, WebP</p>
						</div>
					</div>

					<!-- Prompt Area -->
					<div>
						<label for="prompt" class="mb-2 block text-sm font-medium text-gray-700">Prompt</label>
						<div class="relative">
							<textarea
								id="prompt"
								bind:value={prompt}
								disabled={!isModelReady}
								rows="2"
								class="block w-full rounded-xl border border-gray-300 bg-white px-4 py-3 shadow-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 sm:text-sm"
								placeholder="E.g., Describe the main subject of this image in detail..."
							></textarea>
						</div>
					</div>

					<!-- Action Button -->
					<button
						on:click={runInference}
						disabled={!isModelReady || !results.length || isProcessing}
						class="w-full cursor-pointer rounded-xl bg-indigo-600 px-4 py-3.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
					>
						{#if isProcessing}
							<span class="flex items-center justify-center gap-2">
								<svg
									class="h-4 w-4 animate-spin text-white"
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
								>
									<circle
										class="opacity-25"
										cx="12"
										cy="12"
										r="10"
										stroke="currentColor"
										stroke-width="4"
									></circle>
									<path
										class="opacity-75"
										fill="currentColor"
										d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
									></path>
								</svg>
								Analysing {results.length} images...
							</span>
						{:else}
							Run Analysis
						{/if}
					</button>
				</div>

				<!-- Results Table -->
				{#if results.length > 0}
					<div class="animate-in fade-in slide-in-from-bottom-4 mt-10 duration-500">
						<div class="mb-4 flex items-center justify-between">
							<h3 class="text-base leading-6 font-semibold text-gray-900">
								Results <span class="ml-2 rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
									>{results.length}</span
								>
							</h3>
							<button
								on:click={downloadCSV}
								disabled={!results.some((r) => r.response)}
								class="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 20 20"
									fill="currentColor"
									class="h-4 w-4"
								>
									<path
										fill-rule="evenodd"
										d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm2.25 8.5a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zm0 3a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z"
										clip-rule="evenodd"
									/>
								</svg>
								Download CSV
							</button>
						</div>

						<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
							<table class="min-w-full divide-y divide-gray-200">
								<thead class="bg-gray-50">
									<tr>
										<th
											scope="col"
											class="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase"
											>Preview</th
										>
										<th
											scope="col"
											class="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase"
											>Filename</th
										>
										<th
											scope="col"
											class="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase"
											>Response</th
										>
									</tr>
								</thead>
								<tbody class="divide-y divide-gray-200 bg-white">
									{#each results as result}
										<tr class="transition-colors hover:bg-gray-50/50">
											<td class="px-6 py-4 whitespace-nowrap">
												<div class="h-24 w-24 overflow-hidden rounded-lg border border-gray-100">
													<img
														src={result.imageSrc}
														alt={result.fileName}
														class="h-full w-full object-cover"
													/>
												</div>
											</td>
											<td class="px-6 py-4 whitespace-nowrap">
												<span class="font-mono text-xs text-gray-500">{result.fileName}</span>
											</td>
											<td class="px-6 py-4 text-sm text-gray-700">
												{#if result.response}
													<p class="leading-relaxed">{result.response}</p>
												{:else if isProcessing}
													<span class="inline-flex items-center gap-2 text-gray-400">
														<span
															class="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 delay-0"
														></span>
														<span
															class="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 delay-150"
														></span>
														<span
															class="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 delay-300"
														></span>
													</span>
												{:else}
													<span class="text-xs text-gray-300 italic">Pending</span>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}
			</div>
		</section>
	</div>
</div>
