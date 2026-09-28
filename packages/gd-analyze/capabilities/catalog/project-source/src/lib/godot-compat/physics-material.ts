/**
 * @godot-class PhysicsMaterial
 * @role BINDING
 *
 * Godot 4.7's `PhysicsMaterial` resource (`scene/resources/physics_material.{h,cpp}`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a mutable record of its properties, shared by
 * reference, which a body's `physics_material_override` and a GridMap's `physics_material` read
 * (their friction and bounce are the Rapier colliders' friction and restitution).
 */

import { CoefficientCombineRule, type Collider } from '@dimforge/rapier3d-compat';

export interface PhysicsMaterial {
  friction: number;
  rough: boolean;
  bounce: number;
  absorbent: boolean;
}

/**
 * A material of friction 1, bounce 0 (`physics_material.h:40`).
 *
 * @godot PhysicsMaterial (protocol)
 * @source scene/resources/physics_material.h:40
 */
export function construct(): PhysicsMaterial {
  return { friction: 1, rough: false, bounce: 0, absorbent: false };
}

/**
 * The material as a Rapier collider's surface. Godot signs its coefficients so that one rule per
 * pair can read them: a rough material's friction is negative (`computed_friction`,
 * `physics_material.h:56`) so that it wins the pair's `abs(min(a, b))`, and an absorbent material's
 * bounce is negative (`computed_bounce`, `physics_material.h:66`) so that it takes from the pair's
 * sum clamped to [0, 1] (`combine_friction`, `combine_bounce`, `godot_body_pair_3d.cpp:255`).
 * Rapier's coefficients are never negative (a negative friction makes its solver's velocities NaN,
 * and the next step panics); each collider instead names how a pair combines them, the higher rule
 * winning (Average < Min < Multiply < Max). So a smooth material's friction combines by Min, and
 * when either side is rough the pair takes the larger friction (Max) where Godot takes the rough
 * side's; bounce is clamped to [0, 1] and the pair takes the larger (Max) where Godot adds and
 * clamps; an absorbent material only drops its own bounce, since Rapier's rules cannot subtract.
 * A coefficient that is not finite is Godot's default (friction 1, bounce 0), never handed on.
 *
 * @godot PhysicsMaterial (protocol)
 * @source modules/godot_physics_3d/godot_body_pair_3d.cpp:255,259
 */
export function godot_physics_material_surface(self: PhysicsMaterial): {
  readonly friction: number;
  readonly frictionCombineRule: CoefficientCombineRule;
  readonly restitution: number;
  readonly restitutionCombineRule: CoefficientCombineRule;
} {
  const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);
  return {
    friction: Math.abs(finite(self.friction, 1)),
    frictionCombineRule: self.rough ? CoefficientCombineRule.Max : CoefficientCombineRule.Min,
    restitution: self.absorbent ? 0 : Math.min(Math.max(finite(self.bounce, 0), 0), 1),
    restitutionCombineRule: self.absorbent ? CoefficientCombineRule.Min : CoefficientCombineRule.Max,
  };
}

/**
 * Sets a Rapier collider's surface to the material's.
 *
 * @godot PhysicsMaterial (protocol)
 * @source modules/godot_physics_3d/godot_body_pair_3d.cpp:255,259
 */
export function godot_physics_material_apply(self: PhysicsMaterial, collider: Collider): void {
  const surface = godot_physics_material_surface(self);
  collider.setFriction(surface.friction);
  collider.setFrictionCombineRule(surface.frictionCombineRule);
  collider.setRestitution(surface.restitution);
  collider.setRestitutionCombineRule(surface.restitutionCombineRule);
}

/**
 * @godot PhysicsMaterial.set_friction
 * @source scene/resources/physics_material.cpp:56
 */
export function set_friction(self: PhysicsMaterial, friction: number): void {
  self.friction = Math.fround(friction);
}

/**
 * @godot PhysicsMaterial.get_friction
 * @source scene/resources/physics_material.h:50
 */
export function get_friction(self: PhysicsMaterial): number {
  return self.friction;
}

/**
 * @godot PhysicsMaterial.set_rough
 * @source scene/resources/physics_material.cpp:61
 */
export function set_rough(self: PhysicsMaterial, rough: boolean): void {
  self.rough = rough;
}

/**
 * @godot PhysicsMaterial.is_rough
 * @source scene/resources/physics_material.h:53
 */
export function is_rough(self: PhysicsMaterial): boolean {
  return self.rough;
}

/**
 * @godot PhysicsMaterial.set_bounce
 * @source scene/resources/physics_material.cpp:66
 */
export function set_bounce(self: PhysicsMaterial, bounce: number): void {
  self.bounce = Math.fround(bounce);
}

/**
 * @godot PhysicsMaterial.get_bounce
 * @source scene/resources/physics_material.h:60
 */
export function get_bounce(self: PhysicsMaterial): number {
  return self.bounce;
}

/**
 * @godot PhysicsMaterial.set_absorbent
 * @source scene/resources/physics_material.cpp:71
 */
export function set_absorbent(self: PhysicsMaterial, absorbent: boolean): void {
  self.absorbent = absorbent;
}

/**
 * @godot PhysicsMaterial.is_absorbent
 * @source scene/resources/physics_material.h:63
 */
export function is_absorbent(self: PhysicsMaterial): boolean {
  return self.absorbent;
}

/**
 * A PhysicsMaterial of the properties a scene states, by their Godot names (a declared body's
 * `userData.physics_material_override`, a GridMap's `physicsMaterial` prop); an unknown one fails
 * by name.
 *
 * @godot PhysicsMaterial (protocol)
 * @source scene/resources/physics_material.h:36
 */
export function godot_physics_material_of(data: Readonly<Record<string, unknown>> = {}): PhysicsMaterial {
  const material = construct();
  for (const [key, value] of Object.entries(data)) {
    if (key === 'friction') set_friction(material, Number(value));
    else if (key === 'bounce') set_bounce(material, Number(value));
    else if (key === 'rough') set_rough(material, Boolean(value));
    else if (key === 'absorbent') set_absorbent(material, Boolean(value));
    else throw new Error(`godot-compat: PhysicsMaterial has no property ${key}.`);
  }
  return material;
}
