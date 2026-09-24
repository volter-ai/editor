import type * as THREE from 'three';
import { BatchedRenderer } from 'three.quarks';
import { farDepthTexture } from '../render/soft-particle-depth';

export interface ParticlesContext {
  batchedRenderer: BatchedRenderer;
}

/**
 * Creates the three.quarks BatchedRenderer for GPU particle systems.
 *
 * three.quarks renders all particle systems in a single draw call via instancing.
 * Add particle systems to the batchedRenderer, not directly to the scene.
 *
 * Usage:
 *   const particles = setupParticles(scene);
 *   // In render loop: particles.batchedRenderer.update(dt);
 */
export function setupParticles(scene: THREE.Scene): ParticlesContext {
  const batchedRenderer = new BatchedRenderer();
  // Seed the soft-particle depth sampler BEFORE any batch exists, so every
  // batch this renderer later builds inherits it (`BatchedRenderer.addSystem`
  // applies `this.depthTexture` to each new batch). A `softParticles` batch
  // whose `depthTexture` uniform is still `null` samples black and multiplies
  // every particle away; the far-depth default makes that same batch render
  // exactly as an unfaded one until a real depth pass supplies the scene's own.
  // See `render/soft-particle-depth.ts`.
  batchedRenderer.setDepthTexture(farDepthTexture());
  scene.add(batchedRenderer);

  return { batchedRenderer };
}
