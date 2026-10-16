# emaki-ai-provider

[emaki](https://emaki.ai/?utm_source=npm-ai-sdk&utm_medium=package) provider for the [Vercel AI SDK](https://ai-sdk.dev). Official SDK for emaki (emaki.ai), the Japanese-language AI video generator for Seedance 2.5 and Seedance 2.0: call [Seedance 2.5](https://emaki.ai/seedance-2-5) through `generateVideo`, and image models through `generateImage`, on one API key.

```bash
npm install emaki-ai-provider ai
export EMAKI_API_KEY=sk-...   # create one at https://emaki.ai/settings/apikeys
```

## Video

```ts
import { experimental_generateVideo as generateVideo } from 'ai';
import { emaki } from 'emaki-ai-provider';

const { video } = await generateVideo({
  model: emaki.video(),            // seedance_2_5
  prompt: 'a paper boat drifting down a rain gutter, low angle, morning light',
  duration: 5,
  resolution: '1280x720',
  aspectRatio: '16:9',
});
```

For [image to video](https://emaki.ai/image-to-video), pass the first frame as a public URL: `image: 'https://…/first.png'`. A `last_frame` entry in `frameImages` sets the closing frame. `generateAudio: false` turns the soundtrack off.

Other video ids: `seedance_2` ([Seedance 2.0](https://emaki.ai/seedance-2)), `seedance_2_fast`, `seedance_2_mini`, `minimax_h3`, `veo_3_1`. Seedance 2.5 takes 4 to 30 seconds at 480p, 720p or 1080p.

## Images

```ts
import { generateImage } from 'ai';

const { image } = await generateImage({
  model: emaki.image(),            // nano_banana_2_lite, the cheapest
  prompt: 'a paper-cut layered mountain range at dusk',
  aspectRatio: '16:9',
});
```

Other image ids: `nano_banana_2`, `seedream_5_lite`, `gpt_image_2`. Anything model-specific goes through `providerOptions: { emaki: { resolution: '2K' } }` and is passed on as is.

## Settings

```ts
import { createEmaki } from 'emaki-ai-provider';

const e = createEmaki({ apiKey: process.env.MY_KEY, timeoutMs: 20 * 60_000 });
```

Each run costs credits on your emaki account, the same price as on the website. Video takes minutes; the default timeout is 15 minutes. Finished clips can be sharpened with the [AI video upscaler](https://emaki.ai/video-upscaler).

Failures throw `EmakiError` with a `reason`: `auth` (key missing or wrong), `quota` (out of credits), `plan` (the model needs a purchase), `busy` (another run on the account is generating), `rejected` (the content filter refused; reword), `failed` (the run failed; `code` carries the failure code), `timeout`.

日本語での使い方は [シーダンス](https://emaki.ai/) へ。

MIT licensed. Made by [emaki](https://emaki.ai/?utm_source=npm-ai-sdk&utm_medium=package). Plain client without the AI SDK: [`emaki-ai`](https://www.npmjs.com/package/emaki-ai).
