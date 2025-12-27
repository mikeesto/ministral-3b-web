import {
	AutoProcessor,
	AutoModelForImageTextToText,
	RawImage,
	TextStreamer,
	type PreTrainedModel,
	type Processor,
	type ProgressInfo
} from '@huggingface/transformers';

const MODEL_ID = 'mistralai/Ministral-3-3B-Instruct-2512-ONNX';

export class MinistralEngine {
	private processor: Processor | null = null;
	private model: PreTrainedModel | null = null;
	public isLoaded = false;
	public isLoading = false;

	// Load the model and processor
	async load(onProgress?: (message: string, percentage: number) => void) {
		if (this.isLoaded) return;
		this.isLoading = true;

		// Track max progress to prevent UI jitter
		let maxProgress = 0;

		try {
			// 1. Load Processor
			onProgress?.('Initializing...', 5);
			this.processor = await AutoProcessor.from_pretrained(MODEL_ID);

			if (this.processor.image_processor) {
				this.processor.image_processor.size = { longest_edge: 480 };
			}

			// 2. Load Model
			onProgress?.('Preparing model...', 10);

			this.model = await AutoModelForImageTextToText.from_pretrained(MODEL_ID, {
				dtype: {
					embed_tokens: 'fp16',
					vision_encoder: 'q4',
					decoder_model_merged: 'q4f16'
				},
				device: 'webgpu',
				progress_callback: (info: ProgressInfo) => {
					// Only update UI for the actual download progress
					if (info.status === 'progress') {
						// The 'decoder' .onnx_data file is the huge ~3GB one.
						// We ignore the smaller files (like tokenizer.json) to prevent the bar jumping.
						if (info.file.includes('decoder') && info.file.endsWith('.onnx_data')) {
							const pct = info.loaded / info.total;

							// Map this file's progress (0-100%) to the UI's (10-100%)
							const currentProgress = 10 + pct * 90;

							// Prevent backward jumps
							if (currentProgress > maxProgress) {
								maxProgress = currentProgress;
								onProgress?.('Downloading weights (~3GB)...', maxProgress);
							}
						}
					}
				}
			});

			this.isLoaded = true;
			onProgress?.('Ready', 100);
		} catch (err) {
			console.error(err);
			throw err;
		} finally {
			this.isLoading = false;
		}
	}

	// Run inference on an image object (from file input)
	async generate(
		imageElement: HTMLImageElement,
		promptText: string,
		onToken: (text: string) => void
	) {
		if (!this.model || !this.processor) throw new Error('Model not loaded');

		// 1. Convert HTMLImageElement to RawImage via Canvas
		// This ensures the format matches what the ONNX runtime expects
		const canvas = document.createElement('canvas');
		canvas.width = imageElement.naturalWidth;
		canvas.height = imageElement.naturalHeight;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas context failed');

		ctx.drawImage(imageElement, 0, 0);
		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const rawImg = new RawImage(imageData.data, imageData.width, imageData.height, 4);

		// 2. Prepare Inputs
		const messages = [
			{
				role: 'system',
				content:
					'You are a helpful visual AI assistant. Respond concisely with text only, no markdown.'
			},
			{ role: 'user', content: `[IMG]\n${promptText}\n` }
		];

		const textInputs = this.processor.apply_chat_template(messages);

		const inputs = await this.processor(rawImg, textInputs, {
			add_special_tokens: false
		});

		// 3. Setup Streamer
		let generatedText = '';
		const streamer = new TextStreamer(this.processor.tokenizer!, {
			skip_prompt: true,
			skip_special_tokens: true,
			callback_function: (token: string) => {
				generatedText += token;
				onToken(generatedText);
			}
		});

		// 4. Generate
		await this.model.generate({
			...inputs,
			max_new_tokens: 512,
			do_sample: false,
			streamer,
			repetition_penalty: 1.2
		});

		return generatedText;
	}
}

// Singleton instance to prevent reloading during navigation
export const ministral = new MinistralEngine();
