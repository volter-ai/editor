/** Runtime PhysicsMaterial override projection onto retained native Rapier 2D colliders. */
import { CoefficientCombineRule } from '@dimforge/rapier2d-compat';
import type { Container } from 'pixi.js';
import { registerCanvasNodeRelease } from './node';
import { shapeCastBody2DOf } from './physics-query-2d';
import type { GodotPhysicsMaterial } from './physics-material';

interface MaterialBinding {
  material: GodotPhysicsMaterial | null;
  release?: () => void;
  unregisterNodeRelease?: () => void;
}

const BINDINGS = new WeakMap<object, MaterialBinding>();

interface MaterialCollider2D {
  setRestitution(value: number): void;
  setRestitutionCombineRule(rule: CoefficientCombineRule): void;
}

interface MaterialBody2D {
  numColliders(): number;
  collider(index: number): MaterialCollider2D;
}

function materialBody2DOf(node: object): MaterialBody2D {
  const body = shapeCastBody2DOf(node);
  if (
    !('numColliders' in body) || typeof body.numColliders !== 'function' ||
    !('collider' in body) || typeof body.collider !== 'function'
  ) {
    throw new Error('PhysicsMaterial override requires a live retained Rapier body with colliders.');
  }
  return body as MaterialBody2D;
}

function apply(node: object, material: GodotPhysicsMaterial | null): void {
  const body = materialBody2DOf(node);
  const bounce = material?.computedBounce() ?? 0;
  if (!Number.isFinite(bounce) || bounce < 0) {
    throw new Error('PhysicsMaterial absorbent/negative bounce cannot be represented by Rapier restitution');
  }
  for (let index = 0; index < body.numColliders(); index += 1) {
    const collider = body.collider(index);
    collider.setRestitution(bounce);
    collider.setRestitutionCombineRule(CoefficientCombineRule.Max);
  }
}

export function setPhysicsMaterialOverride2D(
  node: Container,
  material: GodotPhysicsMaterial | null,
): void {
  const current = BINDINGS.get(node);
  current?.release?.();
  apply(node, material);
  const unregisterNodeRelease = current?.unregisterNodeRelease;
  const binding: MaterialBinding = {
    material,
    ...(unregisterNodeRelease === undefined ? {} : { unregisterNodeRelease }),
  };
  if (binding.unregisterNodeRelease === undefined) {
    binding.unregisterNodeRelease = registerCanvasNodeRelease(node, () => {
      BINDINGS.get(node)?.release?.();
      BINDINGS.delete(node);
    });
  }
  if (material !== null) binding.release = material.onChanged(() => apply(node, material));
  BINDINGS.set(node, binding);
}

export function getPhysicsMaterialOverride2D(node: object): GodotPhysicsMaterial | null {
  return BINDINGS.get(node)?.material ?? null;
}

export function releasePhysicsMaterialOverride2D(node: object): void {
  const binding = BINDINGS.get(node);
  binding?.release?.();
  binding?.unregisterNodeRelease?.();
  BINDINGS.delete(node);
}
