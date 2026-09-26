/**
 * The engine's artifacts, kept by digest in the frame origin's Cache API, so
 * a warm open compiles from its own copy rather than the editor's server.
 *
 * A first open asks for them early (`prefetchBlenderArtifacts`), beside the
 * workbench's own start, rather than only once the Model document mounts:
 * through a tab's server 139 MB of engine took 3.6 s, all of it on the path
 * to the model's first read (measured 2026-09-26 in browser-substrate's tab).
 * Each file is fetched under a lock of its name, so the worker that starts
 * while a prefetch is under way waits for it and reads the cache, rather than
 * fetching the same bytes again beside it.
 */
import brotliReady from 'brotli-wasm';
import { artifactUrl, type BlenderArtifactStatus } from './blender-engine.mts';

const ARTIFACT_CACHE = 'volter-blender-artifacts';

/** One artifact, from the cache when this build's bytes are there, else fetched and kept. */
export async function cachedArtifact(file: string, digest: string | undefined): Promise<Response> {
  const url = artifactUrl(file);
  if (!digest || typeof caches === 'undefined') return fetch(url);
  const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
  return locks ? locks.request(`volter-blender-artifact:${file}`, () => fromCache(url, digest)) : fromCache(url, digest);
}

async function fromCache(url: string, digest: string): Promise<Response> {
  const key = `${url}?sha256=${digest}`;
  const cache = await caches.open(ARTIFACT_CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  // Stored Brotli, inflated here: through a tab's server the inflated bytes
  // were five times as many, and the server inflated them in JavaScript.
  const response = await fetch(`${url}?encoding=br`);
  if (!response.ok) return response;
  // One build's bytes per file: an older build's are dropped as this one lands.
  for (const old of await cache.keys()) if (old.url.startsWith(`${url}?sha256=`) && old.url !== key) await cache.delete(old);
  const body = response.headers.get('x-content-encoding') === 'br'
    ? new Blob([(await brotliReady).decompress(new Uint8Array(await response.arrayBuffer())) as Uint8Array<ArrayBuffer>])
    : await response.blob();
  const kept = new Response(body, { headers: { 'content-type': url.endsWith('.wasm') ? 'application/wasm' : response.headers.get('content-type') ?? 'application/octet-stream' } });
  await cache.put(key, kept.clone());
  return kept;
}

/**
 * The engine's two large artifacts, fetched into the cache now, in parallel.
 * Never throws: a prefetch that fails leaves the engine to fetch as before.
 */
export async function prefetchBlenderArtifacts(): Promise<void> {
  try {
    const answer = await fetch(artifactUrl('status'));
    if (!answer.ok) return;
    const status = (await answer.json()) as BlenderArtifactStatus;
    if (!status.available) return;
    const digests = status.digests ?? {};
    await Promise.all(['blender_browser.wasm', 'blender_browser.data'].map(async (file) => {
      const response = await cachedArtifact(file, digests[file]);
      // The body is the cache's copy; a response read from it must be consumed or cancelled.
      await response.body?.cancel();
    }));
  } catch { /* the engine fetches what is not cached */ }
}
