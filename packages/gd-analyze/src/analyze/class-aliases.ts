/**
 * Cross-generation Godot class and member identities.
 *
 * This neutral table sits below both API analysis and translation. Each pair is a spelling alias,
 * never a behavioral adapter; reshaped APIs remain explicit translation concerns.
 */
import type { GodotMajor } from './api-dump';

/**
 * Godot 4 class name → the Godot 3 spelling this package's emitter tables are keyed by.
 *
 * Every row is a pure RENAME: the class means the same thing, authors the same properties this
 * emitter reads, and reaches the same backend. Verified against the pinned
 * `vendor/extension-api/godot-4.7-extension_api.json` and `godot-3.6.2-api.json` — a row exists
 * here only when BOTH dumps declare the pair and the Godot 4 class's `base_class` chain is the
 * Godot 3 one renamed.
 *
 * Nodes and resources are one table because the rule is one rule. A `.tscn` names both in the same
 * `type=` position (`[node type="MeshInstance3D"]`, `[sub_resource type="BoxShape3D"]`) and this
 * emitter looks both up by name.
 */
export const GODOT_4_TO_3_CLASS: Readonly<Record<string, string>> = {
  // --- 2D scene classes: Godot 4 made the sprite's dimensionality explicit --------------------
  Sprite2D: 'Sprite',
  AnimatedSprite2D: 'AnimatedSprite',
  // The node is the same GPU emitter Godot 3 calls `Particles2D`; its process-material property
  // bag is a reshape and is normalized separately by `translate/particles.ts`.
  GPUParticles2D: 'Particles2D',

  // --- 3D scene classes: Godot 4 suffixed the whole 3D half of the tree ------------------------
  Node3D: 'Spatial',
  Marker3D: 'Position3D',
  Path3D: 'Path',
  PathFollow3D: 'PathFollow',
  Area3D: 'Area',
  StaticBody3D: 'StaticBody',
  CharacterBody3D: 'KinematicBody',
  RigidBody3D: 'RigidBody',
  PhysicsBody3D: 'PhysicsBody',
  CollisionObject3D: 'CollisionObject',
  CollisionShape3D: 'CollisionShape',
  CollisionPolygon3D: 'CollisionPolygon',
  MeshInstance3D: 'MeshInstance',
  MultiMeshInstance3D: 'MultiMeshInstance',
  Camera3D: 'Camera',
  XRCamera3D: 'ARVRCamera',
  XRController3D: 'ARVRController',
  XROrigin3D: 'ARVROrigin',
  Light3D: 'Light',
  DirectionalLight3D: 'DirectionalLight',
  // Same Light subclass and the same range/attenuation/shadow surface in both pinned dumps.
  // Godot 4 only made the dimensionality explicit in the class name.
  OmniLight3D: 'OmniLight',
  SpotLight3D: 'SpotLight',
  RayCast3D: 'RayCast',
  SpringArm3D: 'SpringArm',
  VehicleBody3D: 'VehicleBody',
  VehicleWheel3D: 'VehicleWheel',
  PinJoint3D: 'PinJoint',
  HingeJoint3D: 'HingeJoint',
  SliderJoint3D: 'SliderJoint',
  ConeTwistJoint3D: 'ConeTwistJoint',
  Generic6DOFJoint3D: 'Generic6DOFJoint',
  Skeleton3D: 'Skeleton',
  CPUParticles3D: 'CPUParticles',
  // `GPUParticles3D` → `Particles` is a rename at the NODE: both dumps declare the pair, the 4.x
  // base chain is the 3.x one renamed (`GeometryInstance3D`/`GeometryInstance`), and every property
  // 3.6.2's `Particles` declares is declared by 4.7's `GPUParticles3D` under the same name and
  // type. What is NOT a rename is where the emission PARAMETERS live — see
  // `translate/data/particles-dialect.ts`, which owns that reshape and is why
  // `ParticleProcessMaterial` is deliberately absent from this table.
  GPUParticles3D: 'Particles',
  // Godot 4 renamed the notifier pair for what they DO rather than for the 2D/3D split, so these
  // two are the only 3D renames whose new name is not the old one plus a suffix.
  VisibleOnScreenNotifier3D: 'VisibilityNotifier',
  VisibleOnScreenEnabler3D: 'VisibilityEnabler',

  // --- 3D resources authored as `.tscn` sub-resources ------------------------------------------
  BoxShape3D: 'BoxShape',
  SphereShape3D: 'SphereShape',
  CapsuleShape3D: 'CapsuleShape',
  CylinderShape3D: 'CylinderShape',
  ConcavePolygonShape3D: 'ConcavePolygonShape',
  ConvexPolygonShape3D: 'ConvexPolygonShape',
  // Godot 4 renamed the material AND its default; the KEY MAP is a separate question this row does
  // not answer (`translate/data/spatial-material.ts` owns which authored keys mean what, and refuses an
  // unknown one by name in either dialect).
  StandardMaterial3D: 'SpatialMaterial',
  BoxMesh: 'CubeMesh',
  // The particle colour ramp's texture wrapper. Both dumps declare the same surface (`gradient`,
  // `width`, `use_hdr`) and NEITHER name appears in the other's dump, which is the pair being a
  // rename rather than two classes. Its sibling `CurveTexture` keeps its 3.x name and therefore
  // earns no row — but Godot 4 ADDED a `texture_mode` to it, which `particles-dialect.ts` refuses.
  GradientTexture1D: 'GradientTexture',

  // --- Variant / server types a script reaches --------------------------------------------------
  Transform3D: 'Transform',
  World3D: 'World',
  PhysicsServer3D: 'PhysicsServer',
  PhysicsDirectBodyState3D: 'PhysicsDirectBodyState',
  PhysicsDirectBodyState2D: 'Physics2DDirectBodyState',
  PhysicsDirectSpaceState3D: 'PhysicsDirectSpaceState',
  PhysicsShapeQueryParameters3D: 'PhysicsShapeQueryParameters',
  PhysicsDirectSpaceState2D: 'Physics2DDirectSpaceState',
  PhysicsShapeQueryParameters2D: 'Physics2DShapeQueryParameters',
  PhysicsServer2D: 'Physics2DServer',
  PhysicsTestMotionResult2D: 'Physics2DTestMotionResult',
  CharacterBody2D: 'KinematicBody2D',
  KinematicCollision3D: 'KinematicCollision',
};

/**
 * Godot 4 member id → the Godot 3 member id, for the members whose NAME changed on top of their
 * class's.
 *
 * The class half is already handled by {@link GODOT_4_TO_3_CLASS}, so a row belongs here only
 * when the part after the dot moved too. Each is a pure rename of the same accessor — the Godot 4
 * dump declares the same type, the same arity and the same meaning.
 *
 * `Node3D.set_as_top_level` is here now, and the condition its previous absence named is what
 * changed. It was held out because "aliasing it would route a Godot 4 project into an
 * emitter-resolved rewrite nobody has taught the Godot 4 construct to" — TRUE while only ONE of the
 * construct's two halves keyed on a member id. The rewrite is two halves: the emitter's PLACEMENT
 * pass (`scene-module-3d.ts`'s `scriptEnablesToplevelStatically`, which reads the AST's bare callee
 * NAME) and the runtime call's rewrite to a no-op (`translate/code/`, keyed by member id). The name half
 * only ever knew `set_as_toplevel`, so a rename alone would have made the CALL vanish while the
 * node stayed composed under its ancestors — a silent wrong emission, exactly as stated. Both
 * halves now take the dialect's spelling for the major in hand, so the rename is the whole of what
 * was missing and the member is emitter-resolved in both dialects.
 */
export const GODOT_4_TO_3_MEMBER: Readonly<Record<string, string>> = {
  // Godot 4 made both the node's dimensionality and its SpriteFrames slot explicit.
  'AnimatedSprite2D.sprite_frames': 'AnimatedSprite.frames',
  // `Spatial.translation` (a Vector3 in the parent's space) → `Node3D.position`. Same property.
  'Node3D.position': 'Spatial.translation',
  // `Spatial.get_world()` → `Node3D.get_world_3d()`. Same call, same `World`/`World3D` return.
  'Node3D.get_world_3d': 'Spatial.get_world',
  // `PackedScene.instance()` → `.instantiate()`. Same call; `special: true` either way.
  'PackedScene.instantiate': 'PackedScene.instance',
  'PhysicsTestMotionResult2D.get_travel': 'Physics2DTestMotionResult.get_motion',
  'PhysicsTestMotionResult2D.get_remainder': 'Physics2DTestMotionResult.get_motion_remainder',
  'CharacterBody2D.get_slide_collision_count': 'KinematicBody2D.get_slide_count',
  'PhysicsServer2D.body_apply_central_force': 'Physics2DServer.body_add_central_force',
  'PhysicsServer2D.body_apply_torque': 'Physics2DServer.body_add_torque',
  'PhysicsDirectBodyState2D.apply_central_force': 'Physics2DDirectBodyState.add_central_force',
  'PhysicsDirectBodyState2D.apply_force': 'Physics2DDirectBodyState.add_force',
  'PhysicsDirectBodyState2D.apply_torque': 'Physics2DDirectBodyState.add_torque',
  // `Spatial.set_as_toplevel(enable)` → `Node3D.set_as_top_level(enable)`. Both dumps declare one
  // `bool enable` argument and a `void` return; Godot 4 additionally exposes it as the `top_level`
  // property (setter `set_as_top_level`, getter `is_set_as_top_level`), which the 3.x class does not
  // publish as a property but implements identically. No backend answers it in either dialect — the
  // emitter does, and this row is what lets the Godot 4 call reach the SAME rewrite.
  'Node3D.set_as_top_level': 'Spatial.set_as_toplevel',
  // `AnimationPlayer.playback_speed` → `AnimationPlayer.speed_scale`. The CLASS name did not change,
  // so this is the rare row whose whole content is the part after the dot — and the pinned dumps make
  // it the least ambiguous rename in this table: both declare the property as `float` over the SAME
  // C++ accessors, `get_speed_scale`/`set_speed_scale` (3.6.2 `AnimationPlayer.playback_speed:
  // get=get_speed_scale set=set_speed_scale`; 4.7 `AnimationPlayer.speed_scale: get=get_speed_scale
  // set=set_speed_scale`). Godot 4 renamed the exposed PROPERTY onto the accessor's own name and
  // nothing else moved, which is why `godot-compat`'s one pair (`getPlaybackSpeed`/`setPlaybackSpeed`
  // over the mixer's `timeScale`) answers both spellings and there is no second row in
  // `translate/surface.ts`. `starter-kit-3d-platformer`'s `player.gd:98`/`:100` write the Godot 4
  // spelling; `squash-the-creeps`' `Player.gd:32`/`:34` write the Godot 3 one.
  'AnimationPlayer.speed_scale': 'AnimationPlayer.playback_speed',
  // `rand_range(from, to)` → `randf_range(from, to)`. The LANGUAGE's own random draw, which Godot 4
  // renamed on the global namespace at the same time it renamed `RandomNumberGenerator`'s (the
  // sibling row in `translate/surface.ts` already carries the object-reached spelling). `@GDScript`
  // is THIS LANE's pseudo-class for a language global — `emitterClassOf` maps it to itself, so the
  // class half is identity and the whole content of this row is the part after the dot, like
  // `AnimationPlayer.speed_scale` above.
  //
  // EVIDENCE, and where it stops. The pinned 4.7 dump declares the Godot 4 half exactly:
  // `{"name": "randf_range", "return_type": "float", "category": "random", "is_vararg": false,
  // "arguments": [{"name": "from", "type": "float"}, {"name": "to", "type": "float"}]}` in
  // `utility_functions`. The pinned 3.6.2 dump models NO global namespace at all (it has no
  // `@GDScript`/`@GlobalScope` entry, so no `rand_range` row to cite) — the Godot 3 half rests on
  // godot-docs' `@GDScript.rand_range(float from, float to) -> float` and on the shipped
  // `platformer-3d`/`squash-the-creeps` fixtures that emit it. Both engines compute the same draw:
  // `Math::random(from, to)` over the default PRNG, which `godot-compat/random.ts`'s ONE `randRange`
  // is (`from + (to - from) * randf()`).
  '@GDScript.randf_range': '@GDScript.rand_range',
};
const GODOT_3_TO_4_CLASS: ReadonlyMap<string, string> = new Map(
  Object.entries(GODOT_4_TO_3_CLASS).map(([godot4, godot3]) => [godot3, godot4]),
);

const GODOT_3_TO_4_MEMBER: ReadonlyMap<string, string> = new Map(
  Object.entries(GODOT_4_TO_3_MEMBER).map(([godot4, godot3]) => [godot3, godot4]),
);

const MEMBER_NAME_ALIASES: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const aliases = new Map<string, Set<string>>();
  const add = (from: string, to: string): void => {
    const values = aliases.get(from) ?? new Set<string>();
    values.add(to);
    aliases.set(from, values);
  };
  for (const [godot4, godot3] of Object.entries(GODOT_4_TO_3_MEMBER)) {
    const name4 = splitMemberId(godot4).memberName;
    const name3 = splitMemberId(godot3).memberName;
    if (name4 === name3) continue;
    add(name4, name3);
    add(name3, name4);
  }
  return aliases;
})();

/** Return the spelling native to `major`, accepting either generation's authored spelling. */
export function classNameForMajor(className: string, major: GodotMajor): string {
  if (major === 4) return GODOT_3_TO_4_CLASS.get(className) ?? className;
  return GODOT_4_TO_3_CLASS[className] ?? className;
}

/**
 * Candidate spellings ordered from authored spelling to the dump-native alias. This is useful at
 * import boundaries where a project can contain scenes saved by both editor generations.
 */
export function classNameCandidates(className: string, major: GodotMajor): readonly string[] {
  const native = classNameForMajor(className, major);
  return native === className ? [className] : [className, native];
}

/** Return the opposite generation's spelling when this name belongs to a known alias pair. */
export function alternateClassName(className: string): string | undefined {
  return GODOT_4_TO_3_CLASS[className] ?? GODOT_3_TO_4_CLASS.get(className);
}

/** Whether two authored spellings denote the same cross-generation engine class. */
export function equivalentClassNames(left: string, right: string): boolean {
  if (left === right) return true;
  return alternateClassName(left) === right;
}

export interface ClassMemberName {
  readonly className: string;
  readonly memberName: string;
}

function splitMemberId(memberId: string): ClassMemberName {
  const dot = memberId.indexOf('.');
  return dot === -1
    ? { className: memberId, memberName: '' }
    : { className: memberId.slice(0, dot), memberName: memberId.slice(dot + 1) };
}

/** Authored spelling followed by every pure cross-generation rename of that member name. */
export function memberNameCandidates(memberName: string): readonly string[] {
  return [memberName, ...(MEMBER_NAME_ALIASES.get(memberName) ?? [])];
}

/**
 * Resolve an authored member pair to the spelling declared by the selected engine generation.
 * Explicit property/method renames win; otherwise only the class half is canonicalized.
 */
export function classMemberForMajor(
  className: string,
  memberName: string,
  major: GodotMajor,
): ClassMemberName {
  const authoredId = `${className}.${memberName}`;
  const alternateOwner = alternateClassName(className);
  const alternateId =
    alternateOwner === undefined ? undefined : `${alternateOwner}.${memberName}`;
  const explicit =
    major === 4
      ? GODOT_3_TO_4_MEMBER.get(authoredId) ??
        (alternateId === undefined ? undefined : GODOT_3_TO_4_MEMBER.get(alternateId))
      : GODOT_4_TO_3_MEMBER[authoredId] ??
        (alternateId === undefined ? undefined : GODOT_4_TO_3_MEMBER[alternateId]);
  if (explicit !== undefined) return splitMemberId(explicit);
  return { className: classNameForMajor(className, major), memberName };
}

/**
 * Candidate member pairs ordered from authored spelling to dump-native spelling. Mixed-version
 * projects retain their source spelling for diagnostics while API adjudication sees the engine's
 * real declaration.
 */
export function classMemberCandidates(
  className: string,
  memberName: string,
  major: GodotMajor,
): readonly ClassMemberName[] {
  const native = classMemberForMajor(className, memberName, major);
  if (native.className === className && native.memberName === memberName) {
    return [{ className, memberName }];
  }
  return [{ className, memberName }, native];
}
