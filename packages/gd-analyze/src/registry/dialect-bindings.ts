/**
 * Canonical binding identities shared by analysis, reporting, and lowering.
 *
 * Godot 4 renamed classes and members that still have the same executable
 * meaning as their Godot 3 counterparts.  Those names must converge before a
 * compat binding is selected, so this registry owns that identity policy.  It
 * does not emit code or interpret serialized scene/resource properties.
 *
 * A reshape is deliberately not an alias.  Keeping the authored Godot 4 id for
 * the members below makes an absent binding refuse by its real name instead of
 * silently selecting a Godot 3 call with different arguments or return shape.
 */

import type { GodotMajor } from '../analyze/api-dump';
import {
  GODOT_4_TO_3_CLASS as GODOT_4_CLASS_RENAMES,
  GODOT_4_TO_3_MEMBER as GODOT_4_MEMBER_RENAMES,
} from '../analyze/class-aliases';

export type { GodotMajor };

const GODOT_4_RESHAPED_MEMBERS: ReadonlySet<string> = new Set([
  'CharacterBody2D.move_and_slide',
  'CharacterBody2D.move_and_collide',
  'PhysicsServer2D.body_test_motion',
  'PhysicsServer2D.body_apply_impulse',
  'PhysicsServer2D.body_apply_force',
  'CharacterBody3D.move_and_slide',
  'PhysicsDirectSpaceState3D.intersect_ray',
  'PhysicsDirectSpaceState3D.intersect_point',
  'PhysicsDirectSpaceState2D.intersect_point',
]);

/** Canonical compat-registry class id for an authored dialect class name. */
export function emitterClassOf(className: string, major: GodotMajor): string {
  if (major !== 4) return className;
  return GODOT_4_CLASS_RENAMES[className] ?? className;
}

/** Canonical compat-registry member id for an authored dialect member id. */
export function emitterMemberOf(member: string, major: GodotMajor): string {
  if (major !== 4) return member;
  const named = GODOT_4_MEMBER_RENAMES[member];
  if (named !== undefined) return named;
  if (GODOT_4_RESHAPED_MEMBERS.has(member)) return member;
  const dot = member.indexOf('.');
  if (dot === -1) return emitterClassOf(member, major);
  const renamed = GODOT_4_CLASS_RENAMES[member.slice(0, dot)];
  return renamed === undefined ? member : `${renamed}${member.slice(dot)}`;
}

/** Complete Godot 4 class-alias census used by coverage reporting. */
export function godot4ClassRenames(): Readonly<Record<string, string>> {
  return GODOT_4_CLASS_RENAMES;
}

/** Complete Godot 4 member-alias census used by coverage reporting. */
export function godot4MemberRenames(): Readonly<Record<string, string>> {
  return GODOT_4_MEMBER_RENAMES;
}

/** Complete member-reshape census checked against both pinned API dumps. */
export function godot4ReshapedMembers(): ReadonlySet<string> {
  return GODOT_4_RESHAPED_MEMBERS;
}
