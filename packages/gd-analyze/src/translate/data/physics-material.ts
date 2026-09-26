/**
 * translate/data/physics-material.ts — a Godot `PhysicsMaterial` sub-resource as the two surface
 * coefficients this lane carries onto a Rapier collider.
 *
 * The MEANING lives here (a pure function of a decoded sub-resource) and the PRINTING lives in
 * `emit/` — the same split `data/collider.ts` and `data/shape-dimensions.ts` already keep. Both
 * spellings of the property reach this one reader: a `CollisionObject` body carries
 * `physics_material_override`, and a `GridMap` — which fuses its own static tile body — carries
 * `physics_material` (godot 3.6 `grid_map.cpp`, and the 3.6.2 API dump this package vendors).
 */
import type { SubResource } from '../../read/godot-types';
import type { GodotValue } from '../../read/godot-value';
import { TranslateError } from './model';

/**
 * What a `PhysicsMaterial` says about a surface, in GODOT's own units and with Godot's own body
 * defaults when a node authors no material at all: `friction = 1.0`, `bounce = 0.0`, `rough` off.
 *
 * The two COEFFICIENTS reach a Rapier collider — `friction` as friction, `bounce` as restitution —
 * and the two differ on whether Godot's contact-pair COMBINE rule survives. `friction` carries
 * VERBATIM: Godot's `ABS(MIN(A, B))` (`servers/physics/body_pair_sw.cpp` `combine_friction`,
 * 3.6-stable lines 196-198) is Rapier's own `CoefficientCombineRule.Min`. `bounce` does not —
 * Godot's `CLAMP(A + B, 0, 1)` has no Rapier equivalent, so the seat names `Max` and the emitter
 * records a deviation note at the site.
 *
 * `rough` is neither: it is Godot's spelling of a combine-rule SWITCH, and it reaches a collider as
 * one (see {@link GodotSurface.rough}).
 */
export interface GodotSurface {
  readonly friction: number;
  readonly bounce: number;
  /**
   * `PhysicsMaterial.rough` — NOT a coefficient, and not a second friction number.
   *
   * Godot hands the physics server `computed_friction()`, which is `rough ? -friction : friction`
   * (`scene/resources/physics_material.h`, identically at 3.6-stable and 4.3-stable; the body that
   * hands it over is `physics_body.cpp:239` / `rigid_body_3d.cpp:657` + `static_body_3d.cpp:76`).
   * A negative operand is smaller than any ordinary coefficient, so the pair's `ABS(MIN(A, B))`
   * always picks the rough side and the `ABS` restores its magnitude: `rough` makes THIS material's
   * friction WIN the pair instead of losing to a smaller one.
   *
   * That is a different RULE, not a different number, which is why it cannot ride
   * {@link GodotSurface.friction} — and why every reader with no rule channel refuses it
   * ({@link refuseUncarriedRough}) rather than dropping it.
   */
  readonly rough: boolean;
}

/** The surface a node with NO `PhysicsMaterial` has — Godot's own body defaults, which are what a
 *  `CollisionObject` reports when nothing overrides it. */
export const GODOT_DEFAULT_SURFACE: GodotSurface = { friction: 1, bounce: 0, rough: false };

/**
 * Read a resolved `PhysicsMaterial` sub-resource, or Godot's own defaults for `undefined`.
 *
 * `bounce` reaches a collider as Rapier's RESTITUTION; what does NOT reach it is Godot's
 * contact-pair rule, which the emitter records as a deviation note wherever a non-zero bounce is
 * carried. `rough` is read as the combine-rule switch it is — see {@link GodotSurface.rough}.
 *
 * `absorbent` is the same shape on the OTHER coefficient (`computed_bounce()` returns `-bounce`),
 * and it still refuses by name because there is no rule to switch TO: Godot's bounce combine is a
 * clamped SUM, which Rapier's released rule set does not ship, so the seat is already naming `Max`
 * as an approximation and negating an operand of a rule nobody runs means nothing here.
 */
export function readPhysicsSurface(material: SubResource | undefined, at: string): GodotSurface {
  if (material === undefined) return GODOT_DEFAULT_SURFACE;
  const absorbent = material.properties['absorbent'];
  if (absorbent !== undefined && !isFlagOff(absorbent)) {
    throw new TranslateError(
      at,
      'a PhysicsMaterial that authors `absorbent`. Godot hands the server `computed_bounce()` — ' +
        '`-bounce` under that flag — and combines a contact pair as `CLAMP(A + B, 0, 1)`, so the ' +
        "flag SUBTRACTS the other body's bounce from this one's. Rapier's released rule set is " +
        'Average/Min/Multiply/Max with no clamped sum to negate, so there is no rule to switch ' +
        'to; this refuses by name rather than dropping a surface property the game authored on ' +
        'purpose.',
    );
  }
  const rough = material.properties['rough'];
  return {
    friction: coefficient(material, at, 'friction', GODOT_DEFAULT_SURFACE.friction),
    bounce: coefficient(material, at, 'bounce', GODOT_DEFAULT_SURFACE.bounce),
    rough: rough !== undefined && !isFlagOff(rough),
  };
}

/**
 * Refuse a `rough` on a path that has NO combine-rule channel to carry it on.
 *
 * The rule reaches Rapier through one collider-description call (`setFrictionCombineRule`), so a
 * CARRIER is a seat that builds a collider description. The two callers here are the ones that are
 * not:
 *
 *  - an INSTANCE re-stating `physics_material_override`, whose entire channel is the single
 *    `frictionOverride` NUMBER threaded into the child component's constructor — the same reason a
 *    re-stated `bounce` refuses one line away;
 *  - a `GridMap`'s fused static tile body, where the two majors do not even agree that the flag
 *    does anything: 3.6's `grid_map.cpp:352` hands the server `get_friction()` while 4.3's
 *    `grid_map.cpp:371` hands it `computed_friction()`, so an authored flag is INERT on a Godot 3
 *    level and live on a Godot 4 one. No fixture authors either, so both refuse rather than this
 *    lane picking a reading.
 *
 * `why` names the path, so the message sends the reader to the mechanism rather than to the flag.
 */
export function readGodot4DampMode(at: string, modeKey: string, mode: number): 'combine' | 'replace' {
  if (mode === 0) return 'combine';
  if (mode === 1) return 'replace';
  throw new TranslateError(at, `\`${modeKey}=${mode}\` is not Godot 4's Combine/Replace enum.`);
}

export function refuseInstanceBounce(at: string, bounce: number): void {
  if (bounce === 0) return;
  throw new TranslateError(
    at,
    'an INSTANCE that re-states `physics_material_override` with a non-zero `bounce`. The ' +
      'instancing channel carries `friction` only — an instanced scene builds its own ' +
      "colliders from its own root's surface, and the one override this lane threads into " +
      'that class is the friction prop. A bounce authored inside the instanced scene IS ' +
      'carried; re-stating one at the instance is unmeasured and refuses rather than being ' +
      'dropped.',
  );
}

export function refuseUncarriedRough(surface: GodotSurface, at: string, why: string): void {
  if (!surface.rough) return;
  throw new TranslateError(
    at,
    `a \`PhysicsMaterial.rough\` reaching ${why}. The flag SWITCHES Godot's friction pair rule ` +
      "rather than setting a coefficient (see `GodotSurface.rough`), and it reaches Rapier as a " +
      'collider-description combine rule — which this path has no channel for. A body that ' +
      'authors it on its OWN surface IS carried.',
  );
}

/** Godot's own "off" for a `PhysicsMaterial` flag. A `.tscn` serialises only NON-DEFAULT
 *  properties, so an authored flag is ON unless it re-states the default — but a document that
 *  does re-state it is saying the default, and this reads the value rather than the presence. */
function isFlagOff(value: GodotValue): boolean {
  return (value.kind === 'bool' && !value.value) || (value.kind === 'number' && value.value === 0);
}

/** One coefficient, or Godot's own default for a property the resource leaves unwritten — a
 *  `.tscn` serialises only NON-DEFAULT properties. A non-number is a document this lane cannot
 *  read and says so. */
function coefficient(
  material: SubResource,
  at: string,
  property: string,
  fallback: number,
): number {
  const authored = material.properties[property];
  if (authored === undefined) return fallback;
  if (authored.kind !== 'number') {
    throw new TranslateError(at, `a PhysicsMaterial whose \`${property}\` is not a number.`);
  }
  return authored.value;
}
