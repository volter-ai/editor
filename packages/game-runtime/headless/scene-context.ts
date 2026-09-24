/**
 * Headless engine-context factory for Node-based tests.
 *
 * Builds the minimal context a physics test needs WITHOUT setup-renderer /
 * create-runtime — i.e. no WebGL. Real Rapier (WASM) and the real Three.js scene
 * graph run fine in Node; the GPU boundary lives only in setup-renderer.ts /
 * create-runtime.ts, which we intentionally never import.
 *
 * The Object3D IS the entity (Track A) — there is no bitecs world or VNode map.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { clearAssetCaches } from '@volter/threejs-runtime/asset-loaders';
import { createSystemRunner } from '@volter/game-runtime/core/system-runner';
import { createCollisionSystem } from '@volter/threejs-runtime/physics/collision-system';
import { createPhysicsRegistry } from '@volter/threejs-runtime/physics/physics-registry';
import * as THREE from 'three';

export interface TestSceneContext {
  scene: THREE.Scene;
  rapierWorld: RAPIER.World;
  rapier: typeof RAPIER;
  /** Object3D ↔ Rapier body/collider registry (+ collider→Object3D reverse index). */
  physics: ReturnType<typeof createPhysicsRegistry>;
  /** Phase-ordered system runner (real engine factory). Tick with systems.run(dt). */
  systems: ReturnType<typeof createSystemRunner>;
  /** Collision event dispatcher wired to the eventQueue below. */
  collisions: ReturnType<typeof createCollisionSystem>;
  /** Rapier event queue — pass to rapierWorld.step(eventQueue) to capture events. */
  eventQueue: RAPIER.EventQueue;
}

/**
 * Build a minimal engine context for headless tests.
 * Initializes Rapier (idempotent), a fresh physics world + registry, a Three.js
 * scene, a phase-ordered system runner, and a collision dispatcher.
 */
export async function makeSceneLoadContext(): Promise<TestSceneContext> {
  await RAPIER.init();
  const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  const scene = new THREE.Scene();
  const physics = createPhysicsRegistry();

  const systems = createSystemRunner();
  const eventQueue = new RAPIER.EventQueue(true);
  const collisions = createCollisionSystem(rapierWorld, eventQueue);

  return {
    scene,
    rapier: RAPIER,
    rapierWorld,
    physics,
    systems,
    collisions,
    eventQueue,
  };
}

/**
 * Tear down a context built by makeSceneLoadContext().
 * Clears module-level asset caches and frees the Rapier world + event queue so
 * cross-test state does not bleed.
 */
export function teardownSceneLoadContext(ctx: TestSceneContext): void {
  clearAssetCaches();
  ctx.physics.clear();
  ctx.eventQueue.free();
  ctx.rapierWorld.free();
}

/** Count rigid bodies currently present in a Rapier world. */
export function countRigidBodies(rapierWorld: RAPIER.World): number {
  let count = 0;
  rapierWorld.forEachRigidBody(() => {
    count++;
  });
  return count;
}

/** Collect every Object3D in a scene graph (including the scene root). */
export function collectObjects(scene: THREE.Object3D): THREE.Object3D[] {
  const all: THREE.Object3D[] = [];
  scene.traverse((obj) => all.push(obj));
  return all;
}

/**
 * Install a minimal `document.createElement('canvas')` stub for the Node test
 * environment (vitest `environment: 'node'`, no jsdom). three.quarks builds a
 * default radial-gradient sprite via a 2D canvas when a particle material has no
 * texture map; this lets `createParticleSystemFromData` run headlessly. No GPU /
 * real rasterization is involved — THREE.CanvasTexture just stores the canvas.
 * Idempotent; safe to call from multiple tests.
 */
export function installCanvasStub(): void {
  const g = globalThis as unknown as { document?: unknown };
  if (g.document) return;
  const ctx2d = {
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => {},
    fillStyle: '',
    // fillText/font/textAlign/textBaseline: needed by the editor's gizmo icon
    // sprites, which draw a text glyph onto
    // a 2D canvas. No real rasterization happens headlessly — this just lets
    // the call succeed.
    fillText: () => {},
    font: '',
    textAlign: '',
    textBaseline: '',
  };
  // Minimal HTMLImageElement-like stub so THREE.ImageLoader (used by
  // TextureLoader) can attach load/error listeners without a real DOM.
  const makeImage = () => ({
    addEventListener: () => {},
    removeEventListener: () => {},
    src: '',
    crossOrigin: null as string | null,
  });
  g.document = {
    createElement: (tag: string) =>
      tag === 'canvas' ? { width: 0, height: 0, getContext: () => ctx2d } : makeImage(),
    createElementNS: () => makeImage(),
  };
}
