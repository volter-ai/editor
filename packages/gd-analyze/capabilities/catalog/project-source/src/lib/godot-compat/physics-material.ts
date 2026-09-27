/**
 * @godot-class PhysicsMaterial
 * @role BINDING
 *
 * Godot 4.7's `PhysicsMaterial` resource (`scene/resources/physics_material.{h,cpp}`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a mutable record of its properties, shared by
 * reference, which a body's `physics_material_override` reads (`collision-object-3d.ts` hands its
 * friction and bounce to the body's Rapier colliders).
 */

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
 * `rough ? -friction : friction` (`physics_material.h:55`).
 *
 * @godot PhysicsMaterial (protocol)
 * @source scene/resources/physics_material.h:55
 */
export function godot_physics_material_computed(self: PhysicsMaterial): { readonly friction: number; readonly bounce: number } {
  return { friction: self.rough ? -self.friction : self.friction, bounce: self.absorbent ? -self.bounce : self.bounce };
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
 * `userData.physics_material_override`); an unknown one fails by name.
 *
 * @godot PhysicsMaterial (protocol)
 * @source scene/resources/physics_material.h:36
 */
export function godot_physics_material_of(data: Readonly<Record<string, unknown>>): PhysicsMaterial {
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
