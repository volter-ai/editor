import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export interface PhysicsContext {
  rapierWorld: RAPIER.World;
  eventQueue: RAPIER.EventQueue;
  debugMesh: THREE.LineSegments;
  debugEnabled: boolean;
}

/**
 * Creates the Rapier physics world and debug visualization.
 *
 * Call RAPIER.init() before this function.
 * This is direct Rapier setup — no abstraction. Edit freely.
 */
export function setupPhysics(
  rapier: typeof RAPIER,
  scene: THREE.Scene,
  gravity: { x: number; y: number; z: number } = { x: 0, y: -9.81, z: 0 },
): PhysicsContext {
  const rapierWorld = new rapier.World(gravity);
  const eventQueue = new rapier.EventQueue(true);

  // Debug visualization (toggled at runtime)
  const debugGeometry = new THREE.BufferGeometry();
  const debugMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, vertexColors: true });
  const debugMesh = new THREE.LineSegments(debugGeometry, debugMaterial);
  debugMesh.visible = false;
  scene.add(debugMesh);

  return {
    rapierWorld,
    eventQueue,
    debugMesh,
    debugEnabled: false,
  };
}

/**
 * Update the debug line visualization from Rapier's debug render data.
 * Call this each frame if debug is enabled.
 */
export function updatePhysicsDebug(rapierWorld: RAPIER.World, debugMesh: THREE.LineSegments) {
  const buffers = rapierWorld.debugRender();
  const geom = debugMesh.geometry;

  // Reuse the existing BufferAttributes whenever the vertex count is stable
  // (the common case). Allocating a new Float32Array + BufferAttribute every
  // frame orphaned a fresh GPU buffer each time. We only allocate when the
  // size actually changes.
  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (posAttr && posAttr.array.length === buffers.vertices.length) {
    (posAttr.array as Float32Array).set(buffers.vertices);
    posAttr.needsUpdate = true;
  } else {
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buffers.vertices), 3));
  }

  const colAttr = geom.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (colAttr && colAttr.array.length === buffers.colors.length) {
    (colAttr.array as Float32Array).set(buffers.colors);
    colAttr.needsUpdate = true;
  } else {
    geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(buffers.colors), 4));
  }
}
