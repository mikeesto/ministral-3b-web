// src/lib/ministral.ts
import {
	AutoProcessor,
	AutoModelForImageTextToText,
	RawImage,
	TextStreamer,
	type PreTrainedModel,
	type Processor
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

		try {
			// 1. Load Processor
			onProgress?.('Loading processor...', 10);
			this.processor = await AutoProcessor.from_pretrained(MODEL_ID);

			// Set optimal image size for the processor (matches React app)
			// @ts-ignore - 'size' property exists on the image_processor
			if (this.processor.image_processor) {
				// @ts-ignore
				this.processor.image_processor.size = { longest_edge: 480 };
			}

			// 2. Load Model
			onProgress?.('Loading model (this may take a while)...', 20);

			this.model = await AutoModelForImageTextToText.from_pretrained(MODEL_ID, {
				dtype: {
					embed_tokens: 'fp16',
					vision_encoder: 'q4',
					decoder_model_merged: 'q4f16'
				},
				device: 'webgpu',
				progress_callback: (info: any) => {
					if (info.status === 'progress' && info.file.endsWith('.onnx_data')) {
						const p = 20 + (info.loaded / info.total) * 80;
						onProgress?.('Downloading model...', p);
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
			{ role: 'user', content: `[IMG]${promptText}` }
		];

		const textInputs = this.processor.apply_chat_template(messages);

		const inputs = await this.processor(rawImg, textInputs, {
			add_special_tokens: false
		});

		// 3. Setup Streamer
		let generatedText = '';
		const streamer = new TextStreamer(this.processor.tokenizer, {
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
