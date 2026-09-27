import type {
  ToolContributionProps,
  ToolObject3DPreviewSource,
} from '@volter/editor-sdk/contributions';
import { type ComponentType, useCallback, useSyncExternalStore } from 'react';
import type { BuilderState } from './builder-state';

/**
 * The wiring every parametric-asset Builder document repeats: subscribe to the
 * lib's builder state, rebuild on the params that actually affect the mesh, and
 * hand the raw native graph to the editor-owned `Object3DAuthoring` surface.
 *
 * This is a plain helper with explicit inputs and outputs — NOT a registry, base
 * class, or generator kind. Each lib still owns its own contribution file and
 * its own `vgaiTools` entry; the file just shrinks to the handful of facts that
 * are genuinely its own (what to build, what it is called, and where its
 * source lives).
 */
export interface BuilderDocumentConfig<T extends object> {
  /** The shared store this document and its Generator inspector both read. */
  state: BuilderState<T>;
  /** Build the native graph for a state snapshot. */
  build: (state: T) => ToolObject3DPreviewSource;
  /** Title shown on the workspace document. */
  displayName: string;
  /** Project-relative path of the build source, for the document's source link. */
  sourcePath: string;
  cameraDirection: readonly [number, number, number];
  /**
   * Which state fields rebuild the preview. Defaults to the whole snapshot.
   * Libs whose state also carries fields the BUILD ignores (bake-only inputs,
   * for instance) narrow it here so typing in those fields is not a rebuild.
   * The returned array's length must be stable across renders.
   */
  rebuildOn?: (state: T) => readonly unknown[];
}

/** Build the default-export component for a Builder workspace document. */
export function createBuilderDocument<T extends object>(
  config: BuilderDocumentConfig<T>,
): ComponentType<ToolContributionProps> {
  return function BuilderDocument({ active, documentId, surfaces }: ToolContributionProps) {
    const state = useSyncExternalStore(
      config.state.subscribe,
      config.state.getSnapshot,
      config.state.getSnapshot,
    );
    const build = useCallback(
      () => config.build(state),
      config.rebuildOn ? [...config.rebuildOn(state)] : [state],
    );
    if (!documentId) return <div>This contribution must be opened as a workspace document.</div>;
    const Object3DAuthoring = surfaces.Object3DAuthoring;
    return (
      <Object3DAuthoring
        active={active ?? true}
        build={build}
        cameraDirection={config.cameraDirection}
        displayName={config.displayName}
        documentId={documentId}
        sourcePath={config.sourcePath}
      />
    );
  };
}
