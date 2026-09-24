/**
 * Shared asset cache — URL-keyed, deduplicating loader for GLTF and JSON.
 *
 * Inspired by Unity's Resources.Load / Godot's load():
 *   assets.load<T>(url)  — async, returns Promise<T>, deduplicates concurrent loads
 *   assets.get<T>(url)   — sync, returns T, throws if not yet loaded
 *
 * GLTF files (.glb/.gltf) resolve to GLTFResult.
 * JSON files resolve to the parsed object (caller provides type via generic).
 *
 * Cache lives for the app lifetime — no dispose needed.
 */

import type { AssetCache, GLTFResult } from '@volter/editor-project/adapter/asset-cache';
import { gltfLoader, resolveUrl } from './loader';

export type { AssetCache, GLTFResult } from '@volter/editor-project/adapter/asset-cache';

export function createAssetCache(): AssetCache {
  const cache = new Map<string, Promise<unknown>>();
  const resolved = new Map<string, unknown>();
  // Use the shared, DRACO-wired GLTFLoader (A2 / CB2) — no second loader instance.
  // This cache keeps the parsed source GLTFResult (load/get semantics for gameplay
  // code); it does NOT clone. Callers that need disposal-safe clones use
  // asset-loaders `loadGLTF`, which clones + tags `__sharedGeometry`.

  function load<T = unknown>(url: string): Promise<T> {
    const existing = cache.get(url);
    if (existing) return existing as Promise<T>;

    let promise: Promise<unknown>;

    if (url.endsWith('.glb') || url.endsWith('.gltf')) {
      promise = new Promise<GLTFResult>((resolve, reject) => {
        gltfLoader.load(
          url,
          (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }),
          undefined,
          reject,
        );
      });
    } else if (url.endsWith('.json')) {
      promise = fetch(resolveUrl(url)).then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`);
        return r.json();
      });
    } else {
      throw new Error(`AssetCache: unsupported file type for "${url}"`);
    }

    const tracked = promise.then((value) => {
      resolved.set(url, value);
      return value;
    });

    cache.set(url, tracked);
    return tracked as Promise<T>;
  }

  function get<T = unknown>(url: string): T {
    if (!resolved.has(url)) {
      throw new Error(`AssetCache: "${url}" not loaded. Call load() first and await it.`);
    }
    return resolved.get(url) as T;
  }

  return { load, get };
}
