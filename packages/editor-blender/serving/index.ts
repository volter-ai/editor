/**
 * `@volter/editor-blender`'s server half (`package.json#volter.serving`, the project-serving door in
 * `@volter/editor-sdk/session/project-serving`): the routes the Blender in the tab reads and
 * writes through.
 */

import type { ProjectServingModule } from '@volter/editor-sdk/session/project-serving';
import { blenderRoutesPlugin } from './blender-routes';
import { BLENDER_WALI_ARTIFACT, BLENDER_WASM_FILES, blenderWasmStatus } from './blender-wasm-artifact';

export const servingPlugins: ProjectServingModule['servingPlugins'] = (services) => [blenderRoutesPlugin(services)];

/**
 * The engine's bytes a LIMITED VIEW ships (docs/LIMITED-VIEW.md): fixed for a build, so the view
 * records what the session answers here and serves it at the same URL. The routes that touch the
 * project are the page's (`view/blender-view-routes.ts`). The substrate skew's browser modules
 * (`/__editor/blender-wasm/wali/…`) are not listed: they are named only at run time.
 */
export const viewSnapshotRoutes: NonNullable<ProjectServingModule['viewSnapshotRoutes']> = async () => {
  const base = '/__editor/blender-wasm';
  const status = await blenderWasmStatus();
  if (!status.available) return [`${base}/status`];
  if (status.skew === 'wali') return [`${base}/status`, `${base}/runtime.idx`, `${base}/runtime.bin`, `${base}/${BLENDER_WALI_ARTIFACT}`];
  return [`${base}/status`, ...BLENDER_WASM_FILES.map((file) => `${base}/${file}`)];
};
