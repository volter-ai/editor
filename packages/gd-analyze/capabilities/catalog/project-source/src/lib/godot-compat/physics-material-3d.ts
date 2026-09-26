/** Runtime PhysicsMaterial override projection onto retained native Rapier 3D colliders. */
import { CoefficientCombineRule } from '@dimforge/rapier3d-compat';
import { GodotPhysicsMaterial } from './physics-material';

interface MaterialCollider3D {
  friction(): number;
  setFriction(value: number): void;
  frictionCombineRule(): CoefficientCombineRule;
  setFrictionCombineRule(value: CoefficientCombineRule): void;
  restitution(): number;
  setRestitution(value: number): void;
  restitutionCombineRule(): CoefficientCombineRule;
  setRestitutionCombineRule(value: CoefficientCombineRule): void;
}

export interface PhysicsMaterialBody3D {
  numColliders(): number;
  collider(index: number): MaterialCollider3D;
}

interface NativeMaterialState {
  readonly collider: MaterialCollider3D;
  readonly friction: number;
  readonly frictionRule: CoefficientCombineRule;
  readonly restitution: number;
  readonly restitutionRule: CoefficientCombineRule;
}

interface MaterialBinding3D {
  material: GodotPhysicsMaterial | null;
  readonly authored: readonly NativeMaterialState[];
  release: (() => void) | undefined;
}

const MATERIALS = new WeakMap<object, MaterialBinding3D>();

function bindingOf(body: PhysicsMaterialBody3D): MaterialBinding3D {
  let binding = MATERIALS.get(body);
  if (binding !== undefined) return binding;
  const authored: NativeMaterialState[] = [];
  for (let index = 0; index < body.numColliders(); index += 1) {
    const collider = body.collider(index);
    authored.push({
      collider,
      friction: collider.friction(),
      frictionRule: collider.frictionCombineRule(),
      restitution: collider.restitution(),
      restitutionRule: collider.restitutionCombineRule(),
    });
  }
  if (authored.length === 0) {
    throw new Error('RigidBody.physics_material_override requires a native body with colliders.');
  }
  binding = { material: null, authored, release: undefined };
  MATERIALS.set(body, binding);
  return binding;
}

function apply(binding: MaterialBinding3D): void {
  const material = binding.material;
  if (material === null) {
    for (const source of binding.authored) {
      source.collider.setFriction(source.friction);
      source.collider.setFrictionCombineRule(source.frictionRule);
      source.collider.setRestitution(source.restitution);
      source.collider.setRestitutionCombineRule(source.restitutionRule);
    }
    return;
  }
  const friction = material.computedFriction();
  const bounce = material.computedBounce();
  if (!Number.isFinite(friction) || !Number.isFinite(bounce) || bounce < 0) {
    throw new Error(
      'RigidBody.physics_material_override cannot project absorbent/negative bounce into Rapier restitution.',
    );
  }
  for (const source of binding.authored) {
    source.collider.setFriction(Math.abs(friction));
    source.collider.setFrictionCombineRule(
      friction < 0 ? CoefficientCombineRule.Max : CoefficientCombineRule.Min,
    );
    source.collider.setRestitution(bounce);
    source.collider.setRestitutionCombineRule(CoefficientCombineRule.Max);
  }
}

export function setPhysicsMaterialOverride3D(
  body: PhysicsMaterialBody3D,
  material: GodotPhysicsMaterial | null,
): void {
  if (material !== null && !(material instanceof GodotPhysicsMaterial)) {
    throw new TypeError('RigidBody.physics_material_override requires PhysicsMaterial or null.');
  }
  const binding = bindingOf(body);
  binding.release?.();
  binding.material = material;
  apply(binding);
  binding.release = material?.onChanged(() => apply(binding));
}

export function getPhysicsMaterialOverride3D(body: PhysicsMaterialBody3D): GodotPhysicsMaterial | null {
  return MATERIALS.get(body)?.material ?? null;
}

export function releasePhysicsMaterialOverride3D(body: PhysicsMaterialBody3D): void {
  const binding = MATERIALS.get(body);
  if (binding === undefined) return;
  binding.release?.();
  binding.material = null;
  apply(binding);
  MATERIALS.delete(body);
}
