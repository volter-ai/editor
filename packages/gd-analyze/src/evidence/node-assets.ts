/**
 * Vite asset imports (`import url from 'pkg/file.wasm?url'`) under Node, for the evidence harness:
 * a `?url` specifier resolves to a module whose default export is the file's URL, as Vite's asset
 * import is. Registered in the evidence process, and by `NODE_MOUNT_IMPORTS` in every Node process
 * a proof spawns to mount emitted code. Compat never fetches such a URL in Node: the harness hands
 * over what the page would fetch (`godot_image_webp_module`) first.
 */
import { registerHooks } from 'node:module';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-expect-error: the loader is plain ESM beside this module, shared with spawned processes.
import { resolve } from './node-asset-loader.mjs';

/**
 * The `node` arguments that load TypeScript and then this hook in a spawned process: the hook must
 * be registered after tsx's, so it sees the `?url` specifier first.
 */
export const NODE_MOUNT_IMPORTS: readonly string[] = [
  '--import',
  'tsx',
  '--import',
  pathToFileURL(path.join(import.meta.dirname, 'node-asset-hook.mjs')).href,
  // The editor's callsite props on every compat component a mount renders (node-callsite-stamp.mjs).
  '--import',
  pathToFileURL(path.join(import.meta.dirname, 'node-callsite-stamp.mjs')).href,
];

let registered = false;

/** Registers the `?url` resolve hook in this process. */
export function registerNodeAssetImports(): void {
  if (registered) return;
  registered = true;
  registerHooks({ resolve });
}
