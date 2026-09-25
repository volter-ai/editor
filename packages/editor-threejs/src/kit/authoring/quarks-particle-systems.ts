import type * as THREE from 'three';
import type { ParticleSystem } from 'three.quarks';

/** Native three.quarks systems owned by ParticleEmitter nodes in this graph.
 * Detection is structural because a project can bring its own compatible
 * three.quarks module instance; `instanceof` would make that ordinary case
 * disappear across package boundaries. */
export function quarksParticleSystems(root: THREE.Object3D): ParticleSystem[] {
  const systems: ParticleSystem[] = [];
  const seen = new Set<ParticleSystem>();
  root.traverse((object) => {
    if (object.type !== 'ParticleEmitter') return;
    const system = (object as THREE.Object3D & { system?: ParticleSystem }).system;
    if (!system || typeof system.getRendererSettings !== 'function' || seen.has(system)) return;
    seen.add(system);
    systems.push(system);
  });
  return systems;
}
