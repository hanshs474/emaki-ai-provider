import type {
  Experimental_VideoModelV4 as VideoModelV4,
  ImageModelV4,
  ImageModelV4CallOptions,
  ImageModelV4Result,
} from '@ai-sdk/provider';

type VideoModelV4CallOptions = Parameters<NonNullable<VideoModelV4['doGenerate']>>[0];
type VideoModelV4Result = Awaited<ReturnType<NonNullable<VideoModelV4['doGenerate']>>>;

/**
 * emaki provider for the Vercel AI SDK.
 *
 * emaki (https://emaki.ai) is the Japanese-language AI video generator for
 * Seedance 2.5 and Seedance 2.0.
 *
 *   import { experimental_generateVideo as generateVideo, generateImage } from 'ai';
 *   import { emaki } from 'emaki-ai-provider';
 *
 *   const { video } = await generateVideo({ model: emaki.video(), prompt: 'a paper boat drifting down a rain gutter' });
 *   const { image } = await generateImage({ model: emaki.image(), prompt: 'a paper-cut mountain range at dusk' });
 *
 * Set `apiKey` or EMAKI_API_KEY; create a key at https://emaki.ai/settings/apikeys.
 * Runs cost credits on your emaki account, the same price as on the website.
 */

export interface EmakiProviderSettings {
  /** Key from https://emaki.ai/settings/apikeys. Defaults to EMAKI_API_KEY. */
  apiKey?: string;
  /** Service root, for a test or a proxy. */
  baseURL?: string;
  /** Custom fetch implementation. */
  fetch?: typeof fetch;
  /** Poll interval in milliseconds. Default 5 seconds. */
  pollIntervalMs?: number;
  /** Deadline for one run in milliseconds. Default 15 minutes. */
  timeoutMs?: number;
}

export interface EmakiProvider {
  /** `seedance_2_5` by default; also `seedance_2`, `seedance_2_fast`, `seedance_2_mini`, `minimax_h3`, `veo_3_1`. */
  video(modelId?: string): VideoModelV4;
  videoModel(modelId?: string): VideoModelV4;
  /** `nano_banana_2_lite` by default (the cheapest); also `nano_banana_2`, `seedream_5_lite`, `gpt_image_2`. */
  image(modelId?: string): ImageModelV4;
  imageModel(modelId?: string): ImageModelV4;
}

export const VIDEO_MODELS = ['seedance_2_5', 'seedance_2', 'seedance_2_fast', 'seedance_2_mini', 'minimax_h3', 'veo_3_1'] as const;
export const IMAGE_MODELS = ['nano_banana_2_lite', 'nano_banana_2', 'seedream_5_lite', 'gpt_image_2'] as const;

const VIDEO_MODEL = 'seedance_2_5';
const IMAGE_MODEL = 'nano_banana_2_lite';
const KEYS_URL = 'https://emaki.ai/settings/apikeys';

/**
 * auth: key missing or wrong · quota: out of credits · plan: model needs a purchase ·
 * busy: another run on this account is generating · rejected: content filter or cooldown ·
 * failed: the run was accepted but failed · timeout · other
 */
export type EmakiErrorReason = 'auth' | 'quota' | 'plan' | 'busy' | 'rejected' | 'failed' | 'timeout' | 'other';

export class EmakiError extends Error {
  constructor(public reason: EmakiErrorReason, message: string, public status?: number, public code?: string) {
    super(`emaki: ${message}`);
    this.name = 'EmakiError';
  }
}

/** Map an HTTP error response to the reason that says what to do next. */
export function classify(status: number, code?: unknown): EmakiErrorReason {
  if (status === 401) return 'auth';
  if (status === 402) return 'quota';
  if (status === 403) return 'plan';
  if (status === 409) return 'busy';
  if (code === 'content_cooldown' || code === 'content_blocked') return 'rejected';
  return 'other';
}

class Client {
  constructor(private readonly settings: EmakiProviderSettings) {}

  private key(): string {
    const k = this.settings.apiKey || (typeof process !== 'undefined' ? process.env.EMAKI_API_KEY : undefined);
    if (!k) throw new EmakiError('auth', `an API key is required; create one at ${KEYS_URL}`);
    return k;
  }

  private async post(path: string, body: unknown, headers?: Record<string, string | undefined>, signal?: AbortSignal): Promise<any> {
    const f = this.settings.fetch ?? fetch;
    const res = await f((this.settings.baseURL ?? 'https://emaki.ai') + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key()}`, ...(headers as Record<string, string>) },
      body: JSON.stringify(body ?? {}),
      signal,
    });
    let json: any = {};
    try {
      json = await res.json();
    } catch {
      // non-JSON error page; the status code still says what happened
    }
    if (res.status !== 200 || !json?.success) {
      const msg = String(json?.error ?? json?.message ?? `HTTP ${res.status}`);
      throw new EmakiError(classify(res.status, json?.code), msg, res.status, typeof json?.code === 'string' ? json.code : undefined);
    }
    return json.data ?? {};
  }

  /** Submit, then poll until the run has a file URL. */
  async run(model: string, prompt: string, parameters: Record<string, unknown>, headers: Record<string, string | undefined> | undefined, signal: AbortSignal | undefined): Promise<string> {
    const params = Object.fromEntries(Object.entries(parameters).filter(([, v]) => v !== undefined && v !== null));
    const submitted = await this.post('/api/video/ai', { prompt, model, parameters: params }, headers, signal);
    if (!submitted.id) throw new EmakiError('other', 'the service returned no id');

    const deadline = Date.now() + (this.settings.timeoutMs ?? 900_000);
    const every = this.settings.pollIntervalMs ?? 5_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, every));
      if (signal?.aborted) throw signal.reason ?? new Error('aborted');
      let d: any;
      try {
        d = await this.post('/api/video/status', { videoId: submitted.id }, headers, signal);
      } catch (e) {
        if (signal?.aborted || e instanceof EmakiError) throw e;
        continue; // a dropped poll is not a failed generation
      }
      if (d.status === 'completed' && d.videoUrl) return String(d.videoUrl);
      if (d.status === 'failed') {
        throw new EmakiError('failed', `the run failed (${d.failureCode ?? 'no failure code'})`, undefined, d.failureCode ?? undefined);
      }
    }
    throw new EmakiError('timeout', `deadline passed; run ${submitted.id} may still finish in your emaki library`);
  }

  async download(url: string, signal?: AbortSignal): Promise<Uint8Array> {
    const f = this.settings.fetch ?? fetch;
    return new Uint8Array(await (await f(url, { signal })).arrayBuffer());
  }
}

type ProviderOpts = Record<string, unknown>;

class EmakiImageModel implements ImageModelV4 {
  readonly specificationVersion = 'v4' as const;
  readonly provider = 'emaki';
  readonly maxImagesPerCall = 1;
  readonly supportsFileInputs = false;
  readonly supportsMaskInputs = false;

  constructor(readonly modelId: string, private readonly client: Client) {}

  async doGenerate(options: ImageModelV4CallOptions): Promise<ImageModelV4Result> {
    const warnings: ImageModelV4Result['warnings'] = [];
    if (options.size) warnings.push({ type: 'unsupported', feature: 'size', details: 'Use aspectRatio instead.' });
    if (options.seed !== undefined) warnings.push({ type: 'unsupported', feature: 'seed' });
    if (!options.prompt?.trim()) throw new EmakiError('other', 'prompt is required');

    const extra = (options.providerOptions?.emaki ?? {}) as ProviderOpts;
    const url = await this.client.run(this.modelId, options.prompt, { aspect_ratio: options.aspectRatio, ...extra }, options.headers, options.abortSignal);
    return {
      images: [await this.client.download(url, options.abortSignal)],
      warnings,
      providerMetadata: { emaki: { images: [{ url }] } },
      response: { timestamp: new Date(), modelId: this.modelId, headers: undefined },
    };
  }
}

/** "1280x720" -> "720p"; the API takes the short side. */
export function toResolution(r: string | undefined): string | undefined {
  if (!r) return undefined;
  const [w, h] = r.split('x').map(Number);
  return `${Math.min(w, h)}p`;
}

class EmakiVideoModel implements VideoModelV4 {
  readonly specificationVersion = 'v4' as const;
  readonly provider = 'emaki';
  readonly maxVideosPerCall = 1;

  constructor(readonly modelId: string, private readonly client: Client) {}

  async doGenerate(options: VideoModelV4CallOptions): Promise<VideoModelV4Result> {
    const warnings: VideoModelV4Result['warnings'] = [];
    if (options.seed !== undefined) warnings.push({ type: 'unsupported', feature: 'seed' });
    if (options.fps !== undefined) warnings.push({ type: 'unsupported', feature: 'fps' });
    if (!options.prompt?.trim()) throw new EmakiError('other', 'prompt is required');

    const urlOf = (f: any, name: string): string | undefined => {
      if (!f) return undefined;
      if (f.type === 'url') return f.url;
      warnings.push({ type: 'unsupported', feature: name, details: 'Pass the frame as a public https URL.' });
      return undefined;
    };
    const frames = options.frameImages ?? [];
    const first = urlOf(options.image ?? frames.find((x) => x.frameType === 'first_frame')?.image, 'image');
    const last = urlOf(frames.find((x) => x.frameType === 'last_frame')?.image, 'last_frame');
    const extra = (options.providerOptions?.emaki ?? {}) as ProviderOpts;
    const url = await this.client.run(this.modelId, options.prompt, {
      duration: options.duration,
      resolution: toResolution(options.resolution),
      aspect_ratio: options.aspectRatio,
      generate_audio: options.generateAudio,
      image: first,
      last_frame_image: last,
      ...extra,
    }, options.headers, options.abortSignal);
    return {
      videos: [{ type: 'url', url, mediaType: 'video/mp4' }],
      warnings,
      providerMetadata: { emaki: { videos: [{ url }] } },
      response: { timestamp: new Date(), modelId: this.modelId, headers: undefined },
    };
  }
}

export function createEmaki(settings: EmakiProviderSettings = {}): EmakiProvider {
  const client = new Client(settings);
  const video = (modelId: string = VIDEO_MODEL) => new EmakiVideoModel(modelId, client);
  const image = (modelId: string = IMAGE_MODEL) => new EmakiImageModel(modelId, client);
  return { video, videoModel: video, image, imageModel: image };
}

/** Default instance: reads EMAKI_API_KEY. */
export const emaki = createEmaki();
