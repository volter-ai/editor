/** Reuse directional shadow maps only while every caster is declared mount-static. */

import type * as THREE from 'three';
import { activeFrozenBatches, type FrozenBatch } from './freeze';

export interface FrozenDirectionalShadowController {
  update(): void;
  dispose(): void;
}

function belongsTo(node: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let cursor: THREE.Object3D | null = node; cursor !== null; cursor = cursor.parent) {
    if (cursor === ancestor) return true;
  }
  return false;
}

function matrixChanged(
  node: THREE.Object3D,
  snapshots: Map<THREE.Object3D, THREE.Matrix4>,
): boolean {
  node.updateWorldMatrix(true, false);
  const previous = snapshots.get(node);
  if (previous?.equals(node.matrixWorld)) return false;
  if (previous === undefined) snapshots.set(node, node.matrixWorld.clone());
  else previous.copy(node.matrixWorld);
  return true;
}

function projectionChanged(
  camera: THREE.Camera,
  snapshots: Map<THREE.Camera, THREE.Matrix4>,
): boolean {
  const projectable = camera as THREE.Camera & { updateProjectionMatrix?: () => void };
  projectable.updateProjectionMatrix?.();
  const previous = snapshots.get(camera);
  if (previous?.equals(camera.projectionMatrix)) return false;
  if (previous === undefined) snapshots.set(camera, camera.projectionMatrix.clone());
  else previous.copy(camera.projectionMatrix);
  return true;
}

function collectDirectionalShadowLights(
  root: THREE.Object3D,
  lights: Set<THREE.DirectionalLight>,
): void {
  root.traverseVisible((node) => {
    const light = node as THREE.DirectionalLight;
    if (light.isDirectionalLight && light.castShadow) lights.add(light);
  });
}

function inspectOutsideFrozen(
  node: THREE.Object3D,
  frozenRoots: ReadonlySet<THREE.Object3D>,
  lights: Set<THREE.DirectionalLight>,
): boolean {
  if (!node.visible || frozenRoots.has(node)) return false;
  const light = node as THREE.DirectionalLight;
  if (light.isDirectionalLight && light.castShadow) lights.add(light);
  let caster = (node as THREE.Mesh).isMesh === true && (node as THREE.Mesh).castShadow;
  for (const child of node.children) {
    caster = inspectOutsideFrozen(child, frozenRoots, lights) || caster;
  }
  return caster;
}

function sceneBatches(scene: THREE.Object3D): readonly FrozenBatch[] {
  return activeFrozenBatches().filter((batch) => belongsTo(batch.root, scene));
}

interface ShadowControllerState {
  readonly objectMatrices: Map<THREE.Object3D, THREE.Matrix4>;
  readonly cameraProjections: Map<THREE.Camera, THREE.Matrix4>;
  readonly controlledLights: Set<THREE.DirectionalLight>;
  readonly frozenLights: Set<THREE.DirectionalLight>;
  previousBatches: Set<FrozenBatch>;
  hadOutsideCaster: boolean;
}

function batchesChanged(batches: readonly FrozenBatch[], previous: ReadonlySet<FrozenBatch>) {
  return batches.length !== previous.size || batches.some((batch) => !previous.has(batch));
}

function updateLight(
  light: THREE.DirectionalLight,
  external: boolean,
  staticInputChanged: boolean,
  state: ShadowControllerState,
): void {
  state.controlledLights.add(light);
  if (external) {
    light.shadow.autoUpdate = true;
    light.shadow.needsUpdate = true;
    return;
  }
  // Snapshot every input on the first invalidation. A short-circuit expression here would
  // discover one previously unseen input per frame and redraw the same initial map four times.
  const lightMoved = matrixChanged(light, state.objectMatrices);
  const targetMoved = matrixChanged(light.target, state.objectMatrices);
  const projectionMoved = projectionChanged(light.shadow.camera, state.cameraProjections);
  light.shadow.autoUpdate = false;
  if (staticInputChanged || lightMoved || targetMoved || projectionMoved) {
    light.shadow.needsUpdate = true;
  }
}

function updateController(scene: THREE.Object3D, state: ShadowControllerState): void {
  const batches = sceneBatches(scene);
  const roots = new Set(batches.map((batch) => batch.root));
  const batchSetChanged = batchesChanged(batches, state.previousBatches);
  state.previousBatches = new Set(batches);

  if (batchSetChanged) {
    state.frozenLights.clear();
    for (const root of roots) collectDirectionalShadowLights(root, state.frozenLights);
  }
  const nextLights = new Set(state.frozenLights);
  const outsideCaster = inspectOutsideFrozen(scene, roots, nextLights);
  const external = batches.length === 0 || outsideCaster;
  let staticInputChanged = batchSetChanged || external !== state.hadOutsideCaster;
  state.hadOutsideCaster = external;
  for (const root of roots) {
    staticInputChanged = matrixChanged(root, state.objectMatrices) || staticInputChanged;
  }
  for (const light of nextLights) updateLight(light, external, staticInputChanged, state);

  for (const light of state.controlledLights) {
    if (nextLights.has(light)) continue;
    light.shadow.autoUpdate = true;
    light.shadow.needsUpdate = true;
    state.controlledLights.delete(light);
  }
}

/**
 * Three redraws every directional shadow map every frame by default. A mounted `Frozen` subtree
 * promises that its descendants do not change, so a scene whose ENTIRE caster set is covered by
 * those declarations can reuse its depth map until a wrapper, light, target, or shadow camera
 * changes. A caster anywhere outside a Frozen root immediately restores Three's ordinary
 * per-frame path; reactive content is never guessed to be static.
 */
export function createFrozenDirectionalShadowController(
  scene: THREE.Object3D,
): FrozenDirectionalShadowController {
  const state: ShadowControllerState = {
    objectMatrices: new Map(),
    cameraProjections: new Map(),
    controlledLights: new Set(),
    frozenLights: new Set(),
    previousBatches: new Set(),
    hadOutsideCaster: true,
  };

  return {
    update(): void {
      updateController(scene, state);
    },
    dispose(): void {
      for (const light of state.controlledLights) {
        light.shadow.autoUpdate = true;
        light.shadow.needsUpdate = true;
      }
      state.controlledLights.clear();
      state.frozenLights.clear();
      state.objectMatrices.clear();
      state.cameraProjections.clear();
      state.previousBatches.clear();
    },
  };
}
