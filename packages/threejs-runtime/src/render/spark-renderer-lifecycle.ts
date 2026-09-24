import type { SparkRenderer } from '@sparkjsdev/spark';
import type * as THREE from 'three';
import { hasUserData } from '../ecs/user-data';

const IDLE_POLL_MS = 16;
const MAX_IDLE_WAIT_MS = 3_000;
export const SPARK_DISCOVERY_INTERVAL_MS = 500;

/** Gate fallback discovery so ordinary non-splat scenes are never traversed every frame. */
export function shouldDiscoverGaussianSplat(lastCheckAt: number, now: number): boolean {
  return now - lastCheckAt >= SPARK_DISCOVERY_INTERVAL_MS;
}

/** True when a native scene currently contains at least one Gaussian payload. */
export function sceneHasGaussianSplat(scene: THREE.Object3D): boolean {
  let found = false;
  scene.traverse((object) => {
    if (!found && hasUserData(object, 'gaussianSplat')) found = true;
  });
  return found;
}

/**
 * Stop and dispose Spark after its asynchronous depth-sort worker is idle.
 *
 * SparkRenderer.dispose() rejects any worker calls still in flight. Spark's
 * automatic update path intentionally does not await those calls, so disposing
 * synchronously during an editor stop otherwise produces an unhandled
 * `Worker terminate` rejection. Disable future work immediately, then release
 * the renderer once the current sort has naturally settled.
 */
export function disposeSparkRendererWhenIdle(renderer: SparkRenderer): void {
  renderer.autoUpdate = false;
  renderer.sortDirty = false;

  if (renderer.updateTimeoutId !== -1) {
    clearTimeout(renderer.updateTimeoutId);
    renderer.updateTimeoutId = -1;
  }
  if (renderer.sortTimeoutId !== -1) {
    clearTimeout(renderer.sortTimeoutId);
    renderer.sortTimeoutId = -1;
  }

  let remainingIdleWaitMs = MAX_IDLE_WAIT_MS;
  const disposeWhenIdle = (): void => {
    if (renderer.sorting) {
      if (remainingIdleWaitMs > 0) {
        remainingIdleWaitMs -= IDLE_POLL_MS;
        setTimeout(disposeWhenIdle, IDLE_POLL_MS);
      } else {
        // A stuck upstream worker is safer to abandon than to turn a routine
        // editor stop into an unhandled rejection. Page teardown will reclaim
        // the worker; normal sorts complete in a few milliseconds.
        // biome-ignore lint/suspicious/noConsole: This rare upstream worker leak must degrade loudly.
        console.warn('SparkRenderer did not become idle; skipped worker termination.');
      }
      return;
    }
    renderer.dispose();
  };

  disposeWhenIdle();
}
