/** A UI tool offers project roots to any playing stage. The caller lends a
 * container and one mount epoch shared with its world/script; Stop disposes it.
 * Neither the game context nor a product needs an overlay field. */
import type { ProjectMountEpoch } from '../session/project-module-url';
export interface MountedProjectPlayLayers {
  /** Entries whose dependency graph belongs to these layers. */
  readonly entries: readonly string[];
  dispose(): void;
}
export type ProjectPlayLayers = (options: {
  readonly projectRoot: string;
  readonly epoch: ProjectMountEpoch;
  readonly container: HTMLElement;
}) => Promise<MountedProjectPlayLayers>;
const key = Symbol.for('volter.project-play-layers');
const page = globalThis as typeof globalThis & { [key]?: ProjectPlayLayers };
export function projectPlayLayers(): ProjectPlayLayers | null { return page[key] ?? null; }
export function registerProjectPlayLayers(provider: ProjectPlayLayers): () => void {
  if (page[key]) throw new Error('A UI tool already offers project Play layers.');
  page[key] = provider;
  return () => { if (page[key] === provider) delete page[key]; };
}
