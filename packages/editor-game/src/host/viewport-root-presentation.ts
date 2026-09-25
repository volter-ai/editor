import type { ViewportRoot } from '@volter/editor-sdk/host';
import { stampMountedAuthoringIds } from './authoring/mounted-authoring';
import type { EditorShellStore } from '@volter/editor-threejs/kit/editor-shell-store';
import { stampThreeIdentities } from '@volter/editor-threejs/kit/projection/three';

/**
 * The Three viewport's PRESENTER — what `the world root's stage` binds as
 * `host.viewport.presentRoots` (`viewport-door.ts`). The lane that mounted
 * the roots sees only the returned presentation handle. Native Three scene
 * adoption, identity stamping, and restoration stay here, beside the
 * viewport surface that understands them. A composition with no Three root
 * simply has no subject for this viewport to present.
 */
export function presentThreeRoots(
  store: Pick<EditorShellStore, 'enterPlayScene' | 'releaseAdoptedScene'>,
  roots: readonly ViewportRoot[],
): { readonly worldId: string; dispose(): void } | null {
  const world = roots.find((candidate) => candidate.mounted.kind === 'three');
  if (!world || world.mounted.kind !== 'three') return null;
  const scene = world.mounted.scene;
  const mountedAuthoring = world.mounted.authoring;
  if (mountedAuthoring) stampMountedAuthoringIds(scene, mountedAuthoring);
  stampThreeIdentities(scene, liveWorldId(world.id));
  store.enterPlayScene(scene, world.mounted.rendererConfig);
  let disposed = false;
  return {
    worldId: world.id,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      store.releaseAdoptedScene(scene);
    },
  };
}

/** The id namespace minted ids carry. The fallback supports legacy sessions
 * that predate manifest root identity. */
export function liveWorldId(worldId: string | null): string {
  return worldId ?? 'main';
}
