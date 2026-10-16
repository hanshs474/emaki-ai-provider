import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateImage } from 'ai';
import { createEmaki, EmakiError } from './dist/index.js';

function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined, auth: init?.headers?.Authorization });
    const path = new URL(url).pathname;
    const r = routes[path];
    if (!r) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    const [status, json] = typeof r === 'function' ? r() : r;
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  };
  f.calls = calls;
  return f;
}

test('video: seedance_2_5 default, maps options, polls to completed', async () => {
  let polls = 0;
  const fetch = fakeFetch({
    '/api/video/ai': [200, { success: true, data: { id: 'v1', status: 'generating' } }],
    '/api/video/status': () => (++polls < 2
      ? [200, { success: true, data: { id: 'v1', status: 'generating' } }]
      : [200, { success: true, data: { id: 'v1', status: 'completed', videoUrl: 'https://cdn.emaki.ai/v.mp4' } }]),
  });
  const emaki = createEmaki({ apiKey: 'sk', fetch, pollIntervalMs: 1 });
  const out = await emaki.video().doGenerate({
    prompt: 'a fox', n: 1, duration: 6, resolution: '1280x720', aspectRatio: '9:16',
    image: { type: 'url', url: 'https://example.com/first.png' },
  });
  assert.equal(out.videos[0].url, 'https://cdn.emaki.ai/v.mp4');
  const submit = fetch.calls[0];
  assert.equal(submit.body.model, 'seedance_2_5');
  assert.equal(submit.body.parameters.duration, 6);
  assert.equal(submit.body.parameters.resolution, '720p');
  assert.equal(submit.body.parameters.aspect_ratio, '9:16');
  assert.equal(submit.body.parameters.image, 'https://example.com/first.png');
  assert.equal(submit.auth, 'Bearer sk');
});

test('image: nano_banana_2_lite default, downloads bytes', async () => {
  const fetch = fakeFetch({
    '/api/video/ai': [200, { success: true, data: { id: 'i1' } }],
    '/api/video/status': [200, { success: true, data: { id: 'i1', status: 'completed', videoUrl: 'https://cdn.emaki.ai/i.png' } }],
  });
  const emaki = createEmaki({ apiKey: 'sk', fetch, pollIntervalMs: 1 });
  const { image } = await generateImage({ model: emaki.image(), prompt: 'a boat', aspectRatio: '16:9' });
  assert.deepEqual([...image.uint8Array], [1, 2, 3]);
  assert.equal(fetch.calls[0].body.model, 'nano_banana_2_lite');
  assert.equal(fetch.calls[0].body.parameters.aspect_ratio, '16:9');
});

for (const [status, json, reason] of [
  [401, { error: 'Invalid API key' }, 'auth'],
  [402, { error: 'Insufficient credits' }, 'quota'],
  [403, { error: 'purchase required' }, 'plan'],
  [409, { error: 'Video generation is already in progress' }, 'busy'],
  [429, { error: 'cooldown', code: 'content_cooldown' }, 'rejected'],
  [400, { error: 'blocked', code: 'content_blocked' }, 'rejected'],
]) {
  test(`submit ${status} -> ${reason}`, async () => {
    const emaki = createEmaki({ apiKey: 'sk', fetch: fakeFetch({ '/api/video/ai': [status, json] }) });
    await assert.rejects(emaki.video().doGenerate({ prompt: 'x' }), (e) => {
      const err = e instanceof EmakiError ? e : e?.cause;
      return err instanceof EmakiError && err.reason === reason;
    });
  });
}

test('failed run carries failureCode', async () => {
  const emaki = createEmaki({ apiKey: 'sk', pollIntervalMs: 1, fetch: fakeFetch({
    '/api/video/ai': [200, { success: true, data: { id: 'v1' } }],
    '/api/video/status': [200, { success: true, data: { id: 'v1', status: 'failed', failureCode: 'provider_error' } }],
  }) });
  await assert.rejects(emaki.video().doGenerate({ prompt: 'x' }), (e) => e.reason === 'failed' && e.code === 'provider_error');
});
