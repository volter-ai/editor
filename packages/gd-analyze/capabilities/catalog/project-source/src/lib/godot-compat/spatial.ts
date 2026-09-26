/**
 * `Spatial` — Godot's 3D transform node, as functions over `THREE.Object3D`.
 *
 * The 3D counterpart of `node.ts`, and the same rule holds: **there is no
 * `Spatial` class here and there must never be one.** The world node IS the
 * entity (CLAUDE.md), and a `THREE.Object3D` already has a name, a parent,
 * children, a transform and a visibility flag. These are functions that take
 * the `Object3D` and hand the `Object3D` back.
 *
 * ## The two conventions that agree, and the two that do not
 *
 * This is the whole reason the file has a header. Godot 3 and three are both
 * **Y-up, right-handed, -Z forward** spaces using **radians**, so most of a 3D
 * port needs no conversion at all — `Vector3.UP` is `(0, 1, 0)` in both and
 * `Vector3.FORWARD` is `(0, 0, -1)` in both (`variant-3d.ts`). Two things
 * genuinely differ, and each is converted here rather than left to a port:
 *
 * 1. **Euler order.** `Spatial.rotation` is Godot's YXZ triple ("first Z, then
 *    X, then Y", i.e. `M = Ry·Rx·Rz`). `THREE.Euler`'s DEFAULT order is `XYZ`,
 *    a different matrix from the same three numbers. {@link getRotation} and
 *    {@link setRotation} therefore always name the order `'YXZ'` — read or
 *    written any other way, a 45° yaw combined with any pitch lands somewhere
 *    else, and it looks like a physics bug rather than a units bug.
 * 2. **Which axis `look_at` aims.** Godot's `look_at` points the node's **-Z**
 *    at the target, uniformly, for every `Spatial`. `THREE.Object3D.lookAt`
 *    points -Z at the target for a CAMERA or a LIGHT and **+Z** for everything
 *    else (it swaps the eye/target arguments in that branch). So calling three's
 *    method for a translated `look_at` on a mesh yields the exact 180° error —
 *    `Player.gd:31` aims the player's pivot at where it is walking, and the
 *    character would moonwalk. {@link lookAt} builds the matrix itself, with
 *    `Matrix4.lookAt(eye, target, up)`'s own convention, which IS Godot's.
 *
 * ## Global vs local, stated because Godot's `look_at` mixes them
 *
 * `translation`, `rotation` and `transform` are Godot's LOCAL transform, and
 * they map onto `object.position`, `object.rotation` and the object's own
 * local matrix one-for-one. `look_at`/`look_at_from_position` are GLOBAL — they
 * take a world-space target and orient the node's world basis — so both convert
 * the result back through the parent, exactly as three's own `lookAt` does. A
 * node whose parent is untransformed (which is every case in
 * `squash-the-creeps`) sees no difference; a node under a rotated parent sees
 * the right answer instead of a plausible one.
 *
 * `rotate_y` is Godot's `rotate(Vector3.UP, angle)`, which acts in the PARENT'S
 * space (Godot has `rotate_object_local` for the other one) and leaves the
 * origin alone. That is a pre-multiply of the local quaternion, which is also
 * what three's `rotateOnWorldAxis` does — the name says world, the code says
 * parent, and this file spells the operation out rather than depending on which
 * one a reader believes.
 *
 * ## `set_as_toplevel(true)`: three has this natively
 *
 * Godot's `Spatial::set_as_toplevel(true)` does two things at the moment it is
 * enabled, and both are measured in
 * `gd-analyze/test/ground-truth/godot36-transform.json#setAsToplevel`: it BAKES
 * the node's live global transform into its local, and thereafter it composes no
 * ancestor at all — `get_global_transform()` returns the local one. What it does
 * NOT touch is the scene tree: `get_parent()` still returns the authored parent.
 *
 * That is exactly `Object3D.matrixWorldAutoUpdate = false` (three r144+). A node
 * with the flag off is SKIPPED by its parent's `updateMatrixWorld` propagation —
 * `matrixWorld` becomes the caller's to write — while staying parented where it
 * was. So the translated node is mounted where the `.tscn` parents it, like
 * every other node, and {@link seedToplevelTransform3D} performs Godot's bake
 * and takes ownership of the matrix. After that its `position`/`quaternion`/
 * `scale` ARE world-valued, which is what "local IS global" means — so every
 * accessor below is the plain local one, with no special case to get wrong, and
 * `getParent3D` is `node.parent` because the node never left.
 *
 * The one thing ownership costs is that three no longer picks the node's own
 * writes up either: {@link syncToplevelTransform3D} is that half, run from the
 * owning scene's frame walk and from {@link getGlobalTransform}, so a script
 * that moves the node (`follow_camera.gd` writes one every physics step) is
 * seen by the renderer and by the next reader.
 *
 * ## Resource ownership
 *
 * **Owns:** nothing. Four module-scoped scratch objects exist so a per-frame
 * `look_at` does not allocate; they are written and read within one call and
 * never escape (three's own `Object3D` methods keep the same kind). **Shares:**
 * the `Object3D`, which is the scene's. **Teardown:** none.
 */

import {
  Euler,
  Frustum,
  Matrix4,
  type Object3D,
  type OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3 as ThreeVector3,
  type Vector2Like,
  type Vector3Like,
} from 'three';
import { quaternion, type GodotQuaternion } from './quaternion';
import { registerGodotObjectIdentity } from './object';
import { inheritedSubViewportOf } from './viewport';
import { type Transform, transform3, type Vector3, vec3 } from './variant-3d';

/** Godot's own `Math_PI / 180.0` pair (`core/math/math_defs.h`), spelled once so a
 *  `rotation_degrees` round trip cannot drift between the getter and the setter. */
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;

// Scratch. Never escapes a call; see this module's header.
const _matrix = new Matrix4();
const _worldMatrix = new Matrix4();
const _euler = new Euler(0, 0, 0, 'YXZ');
const _quaternion = new Quaternion();
const _position = new ThreeVector3();
const _target = new ThreeVector3();
const _up = new ThreeVector3();
const _globalOrigin = new ThreeVector3();
const _globalBasis = new Quaternion();
const _parentBasis = new Quaternion();
const _objectLocalAxis = new ThreeVector3();
const _worldScale = new ThreeVector3();
const _parentWorldScale = new ThreeVector3();

/**
 * `spatial.set_as_toplevel(true)`, at the moment Godot enables it.
 *
 * Godot's own implementation is `set_transform(get_global_transform())`: the
 * node's LIVE global transform, composed through the whole authored chain
 * INCLUDING whatever transform the instancing scene placed this scene under,
 * becomes its local — after which nothing composes onto it. So the value is not
 * statically knowable at emission: a `player.tscn` camera authored at
 * `Target/Camera` bakes wherever the `stage.tscn` `Player` instance stands.
 *
 * With the node left where the `.tscn` parents it, that live global is simply
 * its own `matrixWorld`, so this reads it, writes it back as the node's own
 * transform, and hands `matrixWorld` over by turning three's propagation off.
 * From here on the node's `position`/`quaternion`/`scale` are world-valued and
 * {@link syncToplevelTransform3D} is what carries a write into `matrixWorld`.
 *
 * Called once, from the owning scene's `attachNodes` — the first moment the
 * committed tree is real. Idempotent: running it again re-bakes the same
 * transform onto itself, because after the first call `matrixWorld` already IS
 * the node's own transform.
 */
export function seedToplevelTransform3D(node: Object3D): void {
  // `updateWorldMatrix(true, false)` refreshes the ancestors and this node's own
  // `matrix` first, so the composed value is current even on the very first
  // frame. It is a no-op for the world matrix itself once the flag is off,
  // which is why the flag is set AFTER the read.
  node.updateWorldMatrix(true, false);
  node.matrixWorld.decompose(node.position, node.quaternion, node.scale);
  node.matrixWorldAutoUpdate = false;
  node.updateMatrix();
}

/**
 * The other half of {@link seedToplevelTransform3D}: carry the node's own
 * (world-valued) transform into the `matrixWorld` it now owns.
 *
 * three skips a `matrixWorldAutoUpdate = false` node in BOTH directions — it
 * composes no ancestor onto it, and it also never picks the node's own
 * `position`/`quaternion` writes up. Godot recomposes a toplevel node's global
 * from its local on every frame it is processed; this is that recomposition,
 * and with nothing to compose it is one `updateMatrix` and one `copy`.
 *
 * Called from the owning scene's frame walk (so the renderer sees a moved node)
 * and from {@link getGlobalTransform} (so a script that reads back what it just
 * wrote is not one frame behind).
 */
export function syncToplevelTransform3D(node: Object3D): void {
  node.updateMatrix();
  node.matrixWorld.copy(node.matrix);
}

/**
 * True when this node's OWN transform is already its world transform — it owns
 * its `matrixWorld` and three composes no ancestor onto it.
 *
 * Read off three's own flag rather than a mark of ours, because the flag IS the
 * fact: {@link seedToplevelTransform3D} is the only thing in this lane that
 * turns it off, and turning it off is exactly what makes the two spaces one.
 *
 * The LOCAL accessors need no such test — local and world being the same thing
 * is what removes the branch. The three functions that consult it are the ones
 * that take a WORLD value and would otherwise convert it through the parent:
 * {@link lookAt}, {@link lookAtFromPosition} and {@link setGlobalTransform3D}.
 */
function ownsWorldTransform(node: Object3D): boolean {
  return node.matrixWorldAutoUpdate === false;
}

/**
 * Bring `node.matrixWorld` up to date before READING it.
 *
 * three's own `updateWorldMatrix` refreshes the ancestors and this node's
 * `matrix`, and then — for a node that owns its world matrix — deliberately
 * leaves `matrixWorld` alone. So a reader has to finish the job, or it answers
 * with whatever the last frame-walk sync left there. That is not hypothetical:
 * `follow_camera.gd` writes a world position and then asks {@link lookAt} which
 * way to face FROM it, within one call.
 */
function refreshWorldMatrix(node: Object3D): void {
  node.updateWorldMatrix(true, false);
  if (ownsWorldTransform(node)) syncToplevelTransform3D(node);
}

/** `spatial.translation` — the LOCAL position, as a `Vector3` VALUE.
 *  `Main.gd:27`, `mob_spawn_location.translation`. */
export function getTranslation(node: Object3D): Vector3 {
  return vec3(node.position.x, node.position.y, node.position.z);
}

/** `spatial.translation = v`. */
export function setTranslation(node: Object3D, value: Vector3Like): void {
  node.position.set(value.x, value.y, value.z);
}

/** `spatial.rotation` — the LOCAL Euler triple in RADIANS, Godot's YXZ order.
 *  `Mob.gd:27`, `rotation.y`; `Player.gd:63`, `$Pivot.rotation.x`. */
export function getRotation(node: Object3D): Vector3 {
  _euler.setFromQuaternion(node.quaternion, 'YXZ');
  return vec3(_euler.x, _euler.y, _euler.z);
}

/** `spatial.rotation = v` — RADIANS, YXZ. See this module's header for why the
 *  order is named at every call rather than left to three's `XYZ` default. */
export function setRotation(node: Object3D, value: Vector3Like): void {
  _euler.set(value.x, value.y, value.z, 'YXZ');
  _quaternion.setFromEuler(_euler);
  node.quaternion.copy(_quaternion);
}

/** `Spatial.global_rotation` — world Euler radians in Godot's YXZ order. */
export function getGlobalRotation(node: Object3D): Vector3 {
  refreshWorldMatrix(node);
  node.getWorldQuaternion(_globalBasis);
  _euler.setFromQuaternion(_globalBasis, 'YXZ');
  return vec3(_euler.x, _euler.y, _euler.z);
}

/** Replace the world rotation while preserving world position and local scale. */
export function setGlobalRotation(node: Object3D, value: Vector3Like): void {
  if (![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new TypeError('Spatial.global_rotation requires a finite Vector3.');
  }
  _euler.set(value.x, value.y, value.z, 'YXZ');
  _globalBasis.setFromEuler(_euler);
  const parent = node.parent;
  if (parent === null || ownsWorldTransform(node)) node.quaternion.copy(_globalBasis);
  else {
    parent.updateWorldMatrix(true, false);
    node.quaternion.copy(parent.getWorldQuaternion(_parentBasis).invert()).multiply(_globalBasis);
  }
}

/** `Node3D.quaternion` — an independent Godot value copied from Three's local rotation. */
export function getNode3DQuaternion(node: Object3D): GodotQuaternion {
  return quaternion(node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w);
}

/** `Node3D.quaternion = value` — replace local rotation while retaining translation and scale. */
export function setNode3DQuaternion(node: Object3D, value: GodotQuaternion): void {
  const { x, y, z, w } = value;
  if (![x, y, z, w].every(Number.isFinite)) {
    throw new TypeError('Node3D.quaternion requires four finite components.');
  }
  node.quaternion.set(x, y, z, w).normalize();
}

/**
 * `node_3d.rotation_degrees` — the SAME local Euler triple {@link getRotation} returns, in
 * DEGREES.
 *
 * `starter-kit-3d-platformer` `view.gd:21`/`:30` reads and writes the camera rig in degrees and
 * clamps the pitch to `[-80, -10]`, which only reads as a pitch clamp in this unit. Godot's
 * property is a pure unit conversion over the same storage (`Node3D::get_rotation_degrees()` is
 * `get_rotation() * (180 / Pi)`), so it shares this file's YXZ order and its quaternion round trip
 * rather than keeping a second Euler.
 */
export function getRotationDegrees(node: Object3D): Vector3 {
  const radians = getRotation(node);
  return vec3(
    radians.x * RADIANS_TO_DEGREES,
    radians.y * RADIANS_TO_DEGREES,
    radians.z * RADIANS_TO_DEGREES,
  );
}

/** `node_3d.rotation_degrees = v` — see {@link getRotationDegrees}. */
export function setRotationDegrees(node: Object3D, value: Vector3Like): void {
  setRotation(node, {
    x: value.x * DEGREES_TO_RADIANS,
    y: value.y * DEGREES_TO_RADIANS,
    z: value.z * DEGREES_TO_RADIANS,
  });
}

/**
 * `node_3d.scale` — the LOCAL scale, as a `Vector3` VALUE.
 *
 * `starter-kit-3d-platformer` `player.gd:63`/`:68`/`:149` and `platform_falling.gd:7`/`:21` squash
 * and stretch a model by writing this every frame. A VALUE for the reason {@link getTranslation}
 * copies: a GDScript property read hands back a copy, and `node.scale` is a live `THREE.Vector3`
 * whose caller would otherwise be holding the node's own storage.
 *
 * Godot 4 keeps `scale` on the same `Transform3D` basis as rotation, so a NON-UNIFORM scale on a
 * ROTATED node is stored sheared and read back through the same Gram-Schmidt recompose
 * `basis.ts`'s `orthonormalized` runs; three stores position/quaternion/scale separately and takes
 * no such round trip. Nothing measured hits the difference — every write here is on an unrotated
 * model node — and it is stated rather than silently assumed away.
 */
export function getScale(node: Object3D): Vector3 {
  return vec3(node.scale.x, node.scale.y, node.scale.z);
}

/** `node_3d.scale = v`. */
export function setScale(node: Object3D, value: Vector3Like): void {
  node.scale.set(value.x, value.y, value.z);
}

/** `Spatial.global_scale` — detached world scale carried by Three's composed transform. */
export function getGlobalScale(node: Object3D): Vector3 {
  refreshWorldMatrix(node);
  node.getWorldScale(_worldScale);
  return vec3(_worldScale.x, _worldScale.y, _worldScale.z);
}

/** Replace world scale while preserving the node's local position and rotation. */
export function setGlobalScale(node: Object3D, value: Vector3Like): void {
  if (![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new TypeError('Spatial.global_scale requires a finite Vector3.');
  }
  const parent = node.parent;
  if (parent === null || ownsWorldTransform(node)) {
    node.scale.set(value.x, value.y, value.z);
    return;
  }
  parent.updateWorldMatrix(true, false);
  parent.getWorldScale(_parentWorldScale);
  if (_parentWorldScale.x === 0 || _parentWorldScale.y === 0 || _parentWorldScale.z === 0) {
    throw new Error('Spatial.global_scale cannot be assigned below a zero-scale parent.');
  }
  node.scale.set(
    value.x / _parentWorldScale.x,
    value.y / _parentWorldScale.y,
    value.z / _parentWorldScale.z,
  );
}

/** `spatial.transform` — the LOCAL transform as a VALUE.
 *  `Main.gd:26`, `$Player.transform.origin`. */
/**
 * `node_3d.basis` — the LOCAL rotation/scale matrix, as the three COLUMN
 * vectors {@link getTransform} already reports.
 *
 * `starter-kit-fps` `player.gd:72` reads `basis.inverse()` off the player
 * itself. The property is the `basis` half of `transform`; there is no second
 * storage.
 */
export function getBasis(node: Object3D): Transform['basis'] {
  return getTransform(node).basis;
}

export function getTransform(node: Object3D): Transform {
  // For a `set_as_toplevel(true)` node (`follow_camera.gd:69` reads one) this
  // IS `get_global_transform()`, with no branch: the seed made its own
  // transform world-valued, which is exactly what Godot's flag means.
  node.updateMatrix();
  const m = node.matrix.elements;
  return transform3(
    [
      vec3(m[0] as number, m[1] as number, m[2] as number),
      vec3(m[4] as number, m[5] as number, m[6] as number),
      vec3(m[8] as number, m[9] as number, m[10] as number),
    ],
    vec3(m[12] as number, m[13] as number, m[14] as number),
  );
}

/** `spatial.transform = t`. Decomposed onto the node, because three drives a
 *  node from position/quaternion/scale and would overwrite a matrix written
 *  directly on the next `updateMatrix()`. */
export function setTransform(node: Object3D, value: Transform): void {
  const [x, y, z] = value.basis;
  // `follow_camera.gd:71` writes this back on a top-level node, where Godot's
  // local IS the global — so the write is a WORLD write, not one into whatever
  // space the hoist parent happens to be in.
  _matrix.set(
    x.x,
    y.x,
    z.x,
    value.origin.x,
    x.y,
    y.y,
    z.y,
    value.origin.y,
    x.z,
    y.z,
    z.z,
    value.origin.z,
    0,
    0,
    0,
    1,
  );
  _matrix.decompose(node.position, node.quaternion, node.scale);
}

/**
 * `spatial.get_global_transform()` — the WORLD transform, basis + origin
 * (`follow_camera.gd:31-32`, `player.gd:47`, `:119-120`).
 *
 * Where `getTransform` reads the node's LOCAL matrix, this reads `matrixWorld`
 * — three's `parent.matrixWorld · local`, composed up the whole chain, which is
 * exactly Godot's global transform. `test/ground-truth/godot36-transform.json`'s
 * `parentChain` measures a child under a rotated, translated parent and this
 * returns the same basis columns and origin. The basis is the world matrix's
 * three COLUMNS, the same layout `getTransform` and `basis.ts` use.
 */
export function getGlobalTransform(node: Object3D): Transform {
  refreshWorldMatrix(node);
  const m = node.matrixWorld.elements;
  return transform3(
    [
      vec3(m[0] as number, m[1] as number, m[2] as number),
      vec3(m[4] as number, m[5] as number, m[6] as number),
      vec3(m[8] as number, m[9] as number, m[10] as number),
    ],
    vec3(m[12] as number, m[13] as number, m[14] as number),
  );
}

/** `Node3D.global_basis` — the world transform's basis without its origin. */
export function getGlobalBasis(node: Object3D): Transform['basis'] {
  return getGlobalTransform(node).basis;
}

/** Assign a complete Godot world transform, including basis scale, through Three's parent-local
 *  storage. This is the property setter for `Node3D.global_transform`. */
export function setGlobalTransform(node: Object3D, value: Transform): void {
  const [x, y, z] = value.basis;
  _worldMatrix.set(
    x.x,
    y.x,
    z.x,
    value.origin.x,
    x.y,
    y.y,
    z.y,
    value.origin.y,
    x.z,
    y.z,
    z.z,
    value.origin.z,
    0,
    0,
    0,
    1,
  );
  const parent = node.parent;
  if (parent === null || ownsWorldTransform(node)) {
    _worldMatrix.decompose(node.position, node.quaternion, node.scale);
    return;
  }
  parent.updateWorldMatrix(true, false);
  _matrix.copy(parent.matrixWorld).invert().multiply(_worldMatrix);
  _matrix.decompose(node.position, node.quaternion, node.scale);
}

/**
 * `node_3d.global_position` — Godot 4's WORLD-space origin, read as a `Vector3`
 * VALUE (`platformer-3d-godot4` `player.gd:39`, `if global_position.y < -12`).
 *
 * A genuine Godot 4 ADDITION rather than a rename: Godot 3 has
 * `global_transform` and no `global_position` at all. The read is the origin
 * column of the same world matrix {@link getGlobalTransform} reports, through
 * the same refresh — so a script that reads it in the frame it moved the node
 * is not one frame behind.
 */
export function getGlobalPosition(node: Object3D): Vector3 {
  refreshWorldMatrix(node);
  const m = node.matrixWorld.elements;
  return vec3(m[12] as number, m[13] as number, m[14] as number);
}

/**
 * `node_3d.global_position = v` — `player.gd:41` teleports the player home by
 * writing its local `position`, and this is the world-space sibling of that.
 *
 * The WRITE is not the read inverted, which is why the property needed both
 * halves before it could be claimed: Godot sets the node's global ORIGIN and
 * leaves its global BASIS alone, so the local position has to be recomposed
 * against the parent's world matrix. That is exactly what
 * {@link setGlobalTransform3D} already does for a physics body's write-back
 * (`parent.worldToLocal`, or the value itself for a node that owns its world
 * matrix), and leaving `basis` off keeps the node's orientation — a local
 * quaternion under an unchanged parent is an unchanged global basis, which is
 * Godot's guarantee here.
 */
export function setGlobalPosition(node: Object3D, value: Vector3Like): void {
  setGlobalTransform3D(node, value);
}

/** Transform a local point through the node's current world transform. */
export function spatialToGlobal(node: Object3D, value: Vector3Like): Vector3 {
  refreshWorldMatrix(node);
  _position.set(value.x, value.y, value.z).applyMatrix4(node.matrixWorld);
  return vec3(_position.x, _position.y, _position.z);
}

/** Transform a world point through the inverse of the retained node's live world matrix. */
export function spatialToLocal(node: Object3D, value: Vector3Like): Vector3 {
  refreshWorldMatrix(node);
  _position.set(value.x, value.y, value.z);
  node.worldToLocal(_position);
  return vec3(_position.x, _position.y, _position.z);
}

/** Translate in world axes while preserving the node's complete world basis. */
export function globalTranslateSpatial(node: Object3D, offset: Vector3Like): void {
  const position = getGlobalPosition(node);
  setGlobalPosition(node, vec3(position.x + offset.x, position.y + offset.y, position.z + offset.z));
}

/**
 * `spatial.look_at(target, up, use_model_front = false)` — `Player.gd:31`,
 * `$Pivot.look_at(translation + direction, Vector3.UP)`.
 *
 * Orients the node so its **-Z** points at the world-space `target` (Godot's
 * default, and NOT `THREE.Object3D.lookAt`'s for a non-camera; see this
 * module's header). Godot 4's trailing `use_model_front` aims **+Z** instead
 * — `starter-kit-fps` always passes `true`.
 *
 * @throws if `target` is the node's own position, or if `up` is parallel to the
 * direction to it. Godot pushes an error and leaves the basis unchanged, which
 * in a port reads as "the character sometimes stops turning"; the degenerate
 * basis this would otherwise build is worse — it propagates `NaN` into every
 * child transform.
 */
export function lookAt(
  node: Object3D,
  target: Vector3Like,
  up: Vector3Like,
  useModelFront = false,
): void {
  refreshWorldMatrix(node);
  _position.setFromMatrixPosition(node.matrixWorld);
  _target.set(target.x, target.y, target.z);
  _up.set(up.x, up.y, up.z);

  const direction = _target.clone().sub(_position);
  if (direction.lengthSq() === 0) {
    throw new Error(
      "godot-compat: Spatial.look_at() was given the node's own position as the target, so " +
        'there is no direction to face. Godot reports the same error and leaves the basis alone.',
    );
  }
  if (direction.clone().cross(_up).lengthSq() === 0) {
    throw new Error(
      "godot-compat: Spatial.look_at()'s up vector is parallel to the direction to the target, " +
        'so the resulting basis is degenerate. Godot reports the same error; pass an up vector ' +
        'that is not along the line of sight.',
    );
  }

  // Matrix4.lookAt(eye, target, up) puts +Z along (eye - target), so -Z points
  // AT the target — Godot's default, and the branch three itself takes for
  // a camera. Godot 4's trailing `use_model_front` (starter-kit-fps
  // enemy.gd:21, player.gd:217, always `true`) wants the opposite: +Z at the
  // target. Swapping eye/target is that flip — lookAt(target, position) puts
  // +Z along (target - position).
  if (useModelFront) {
    _matrix.lookAt(_target, _position, _up);
  } else {
    _matrix.lookAt(_position, _target, _up);
  }
  _quaternion.setFromRotationMatrix(_matrix);

  // World -> parent. `look_at` is a global operation and `node.quaternion` is
  // local, so an untransformed parent (every case in the measured fixture) is
  // the identity here and a rotated one is corrected rather than ignored.
  const parent = node.parent;
  if (parent !== null && !ownsWorldTransform(node)) {
    parent.updateWorldMatrix(true, false);
    node.quaternion.copy(
      parent.getWorldQuaternion(new Quaternion()).invert().multiply(_quaternion),
    );
  } else {
    node.quaternion.copy(_quaternion);
  }
}

/**
 * `spatial.look_at_from_position(position, target, up)` — `Mob.gd:20`, which is
 * how every mob is aimed at the player as it spawns.
 *
 * Godot's own implementation is exactly this: move there in GLOBAL space, then
 * `look_at`. The position write goes through the parent for the same reason the
 * orientation does.
 */
export function lookAtFromPosition(
  node: Object3D,
  position: Vector3Like,
  target: Vector3Like,
  up: Vector3Like,
  useModelFront = false,
): void {
  _position.set(position.x, position.y, position.z);
  const parent = node.parent;
  if (parent !== null && !ownsWorldTransform(node)) {
    parent.updateWorldMatrix(true, false);
    node.position.copy(parent.worldToLocal(_position.clone()));
  } else {
    node.position.copy(_position);
  }
  lookAt(node, target, up, useModelFront);
}

/**
 * `spatial.global_transform = …` — write a GLOBAL origin (and, for a body that
 * tumbles, a global basis) onto a node whose own `position`/`quaternion` are
 * LOCAL.
 *
 * This is the write-back half of a native physics body. Godot's physics server
 * sets a body's **global** transform, and Rapier's `translation()`/`rotation()`
 * are world-space too, while `Object3D.position`/`.quaternion` are relative to
 * the parent. The two are the same numbers only when the parent is the
 * identity — which is every body in a flat scene and NOT a body-rooted scene
 * the level places under a positioned group (`platformer-3d`'s `stage.tscn`
 * parents its four `Enemy` instances under an `Enemies` Spatial at
 * `(-16, -6, -12)`). Writing world straight into local there offsets the node
 * by the parent's own transform every frame: it renders somewhere the physics
 * is not, and every `RayCast`/`Area` reading the node's world matrix asks about
 * empty space.
 *
 * Rotation is optional because a character body is swept flat by its controller
 * and only translates; a dynamic body translates AND tumbles.
 */
export function setGlobalTransform3D(
  node: Object3D,
  origin: Vector3Like,
  basis?: { readonly x: number; readonly y: number; readonly z: number; readonly w: number },
): void {
  const parent = node.parent;
  if (parent === null || ownsWorldTransform(node)) {
    node.position.set(origin.x, origin.y, origin.z);
    if (basis !== undefined) node.quaternion.set(basis.x, basis.y, basis.z, basis.w);
    return;
  }
  parent.updateWorldMatrix(true, false);
  node.position.copy(parent.worldToLocal(_globalOrigin.set(origin.x, origin.y, origin.z)));
  if (basis === undefined) return;
  node.quaternion
    .copy(parent.getWorldQuaternion(_parentBasis).invert())
    .multiply(_globalBasis.set(basis.x, basis.y, basis.z, basis.w));
}

/**
 * `spatial.rotate_y(angle)` — `Mob.gd:21`,
 * `rotate_y(rand_range(-PI / 4, PI / 4))`.
 *
 * Rotates about the PARENT'S Y axis by `angle` radians and leaves the origin
 * alone, which is Godot's `rotate(Vector3.UP, angle)`. See this module's header
 * for why that is a pre-multiply rather than three's `rotateY`, which turns
 * about the node's OWN Y and gives a different answer the moment the node is
 * already pitched.
 */
export function rotateY(node: Object3D, angle: number): void {
  _quaternion.setFromAxisAngle(_up.set(0, 1, 0), angle);
  node.quaternion.premultiply(_quaternion);
}

/** `Spatial.rotate_object_local(axis, angle)` over Three's own local-axis quaternion mutation. */
export function rotateObjectLocal(node: Object3D, axis: Vector3Like, angle: number): void {
  _objectLocalAxis.set(axis.x, axis.y, axis.z);
  if (_objectLocalAxis.lengthSq() === 0) throw new Error('Spatial.rotate_object_local axis must be non-zero.');
  node.rotateOnAxis(_objectLocalAxis.normalize(), angle);
}

export function rotateX(node: Object3D, angle: number): void {
  if (!Number.isFinite(angle)) throw new TypeError('Spatial.rotate_x requires a finite angle.');
  node.rotateX(angle);
}

/** `Spatial.rotate(axis, angle)` rotates the local basis around a parent-space axis. */
export function rotateSpatial(node: Object3D, axis: Vector3Like, angle: number): void {
  if (![axis.x, axis.y, axis.z, angle].every(Number.isFinite)) {
    throw new TypeError('Spatial.rotate requires a finite Vector3 axis and angle.');
  }
  _objectLocalAxis.set(axis.x, axis.y, axis.z);
  if (_objectLocalAxis.lengthSq() === 0) {
    throw new Error('Spatial.rotate axis must be non-zero.');
  }
  _quaternion.setFromAxisAngle(_objectLocalAxis.normalize(), angle);
  node.quaternion.premultiply(_quaternion);
}

export function translateSpatial(node: Object3D, offset: Vector3Like): void {
  if (![offset.x, offset.y, offset.z].every(Number.isFinite)) {
    throw new TypeError('Spatial.translate requires a finite Vector3.');
  }
  _objectLocalAxis.set(offset.x, offset.y, offset.z).applyQuaternion(node.quaternion);
  node.position.add(_objectLocalAxis);
}

/** `Spatial.translate_object_local` is the retained node's local-basis translation. */
export function translateObjectLocal(node: Object3D, offset: Vector3Like): void {
  translateSpatial(node, offset);
}

const _projectOrigin = new ThreeVector3();
const _projectDir = new ThreeVector3();
const _projectPoint = new ThreeVector3();
export type GodotProjectionCamera = PerspectiveCamera | OrthographicCamera;

/**
 * `Camera.new()` / `Camera3D.new()` — a real Three perspective camera carrying Godot's
 * source defaults. The live viewport provider owns its projection immediately and keeps doing so
 * after the camera is parented beneath a SubViewport.
 */
export function createGodotCamera3D(
  major: 3 | 4,
  mainViewportSize: () => Vector2Like,
): PerspectiveCamera {
  const fov = major === 3 ? 70 : 75;
  const far = major === 3 ? 100 : 4000;
  const camera = new PerspectiveCamera(fov, 1, 0.05, far);
  registerGodotObjectIdentity(camera, major === 3 ? 'Camera' : 'Camera3D');
  camera.layers.mask = 0x000f_ffff;
  bindGodotCamera3D(camera, {
    major,
    fov,
    keepAspect: 1,
    size: 1,
    projection: 0,
    frustumOffset: { x: 0, y: 0 },
    hOffset: 0,
    vOffset: 0,
  });
  bindGodotCameraViewportFromTree(camera, mainViewportSize);
  return camera;
}

interface GodotCameraProjectionState {
  major?: 3 | 4;
  fov: number;
  keepAspect: 0 | 1;
  size: number;
  projection?: 0 | 1 | 2;
  frustumOffset?: Vector2Like;
  hOffset?: number;
  vOffset?: number;
}

const CAMERA_PROJECTIONS = new WeakMap<GodotProjectionCamera, GodotCameraProjectionState>();
interface GodotCameraViewportBinding {
  readonly size: () => Vector2Like;
  width: number;
  height: number;
}
const CAMERA_VIEWPORT_SIZE = new WeakMap<GodotProjectionCamera, GodotCameraViewportBinding>();

export function bindGodotCamera3D(
  camera: GodotProjectionCamera,
  config: GodotCameraProjectionState,
): void {
  CAMERA_PROJECTIONS.set(camera, { ...config });
}

export function bindGodotCameraViewportSize(
  camera: GodotProjectionCamera,
  size: () => Vector2Like,
): void {
  CAMERA_VIEWPORT_SIZE.set(camera, { size, width: Number.NaN, height: Number.NaN });
  updateGodotCameraProjection(camera);
}

/**
 * Seat a retained Camera3D in its actual viewport before `_ready`. The provider walks the live
 * ancestry on every read because a PackedScene may be reparented between SubViewports at runtime.
 */
export function bindGodotCameraViewportFromTree(
  camera: GodotProjectionCamera,
  mainViewportSize: () => Vector2Like,
): void {
  bindGodotCameraViewportSize(
    camera,
    () => inheritedSubViewportOf(camera)?.size ?? mainViewportSize(),
  );
}

function cameraProjection(camera: GodotProjectionCamera): GodotCameraProjectionState {
  const held = CAMERA_PROJECTIONS.get(camera);
  if (held !== undefined) return held;
  const fallback: GodotCameraProjectionState = {
    fov: 'isPerspectiveCamera' in camera ? (camera as PerspectiveCamera).fov : 70,
    keepAspect: 1 as const,
    size:
      'isOrthographicCamera' in camera
        ? (camera as OrthographicCamera).top - (camera as OrthographicCamera).bottom
        : 1,
    projection: 'isOrthographicCamera' in camera ? 1 : 0,
    frustumOffset: { x: 0, y: 0 },
    hOffset: 0,
    vOffset: 0,
  };
  CAMERA_PROJECTIONS.set(camera, fallback);
  return fallback;
}

function assertViewport(size: Vector2Like, member: string): void {
  if (size.x > 0 && size.y > 0) return;
  throw new Error(`godot-compat: Camera3D.${member} requires a nonzero Viewport size.`);
}

function cameraViewportSize(camera: GodotProjectionCamera, member: string): Vector2Like {
  const binding = CAMERA_VIEWPORT_SIZE.get(camera);
  if (binding === undefined) {
    throw new Error(
      `godot-compat: Camera3D.${member} reached a Camera that is not bound to its Viewport.`,
    );
  }
  const size = binding.size();
  assertViewport(size, member);
  if (binding.width !== size.x || binding.height !== size.y) {
    applyGodotCameraProjection(camera, size);
    binding.width = size.x;
    binding.height = size.y;
  }
  return size;
}

function applyGodotCameraProjection(camera: GodotProjectionCamera, size: Vector2Like): void {
  const state = cameraProjection(camera);
  const aspect = size.x / size.y;
  const projection = state.projection ?? ('isOrthographicCamera' in camera ? 1 : 0);
  if (projection === 0) {
    const verticalFov = state.keepAspect === 0
      ? 2 * Math.atan(Math.tan((state.fov * Math.PI) / 360) / aspect)
      : (state.fov * Math.PI) / 180;
    const halfHeight = Math.tan(verticalFov / 2) * camera.near;
    camera.projectionMatrix.makePerspective(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, camera.near, camera.far);
  } else if (projection === 1) {
    const halfHeight = state.keepAspect === 0 ? state.size / (2 * aspect) : state.size / 2;
    camera.projectionMatrix.makeOrthographic(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, camera.near, camera.far);
  } else {
    const offset = state.frustumOffset ?? { x: 0, y: 0 };
    const halfHeight = state.size / 2;
    camera.projectionMatrix.makePerspective(
      -halfHeight * aspect + offset.x, halfHeight * aspect + offset.x,
      halfHeight + offset.y, -halfHeight + offset.y, camera.near, camera.far,
    );
  }
  const horizontal = state.hOffset ?? 0;
  const vertical = state.vOffset ?? 0;
  if (horizontal !== 0 || vertical !== 0) {
    const elements = camera.projectionMatrix.elements;
    elements[8] = (elements[8] ?? 0) + horizontal;
    elements[9] = (elements[9] ?? 0) + vertical;
  }
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

export function getGodotCameraProjection(camera: GodotProjectionCamera): 0 | 1 | 2 {
  return cameraProjection(camera).projection ?? ('isOrthographicCamera' in camera ? 1 : 0);
}

export function setGodotCameraProjection(camera: GodotProjectionCamera, value: number): void {
  if (value !== 0 && value !== 1 && value !== 2) {
    throw new RangeError('Camera.projection must be PERSPECTIVE, ORTHOGONAL, or FRUSTUM.');
  }
  cameraProjection(camera).projection = value;
  updateGodotCameraProjection(camera);
}

export function setGodotCameraPerspective(
  camera: GodotProjectionCamera,
  fov: number,
  near: number,
  far: number,
): void {
  setGodotCameraProjection(camera, 0);
  setGodotCameraFov(camera, fov);
  setGodotCameraNear(camera, near);
  setGodotCameraFar(camera, far);
}

export function setGodotCameraOrthogonal(
  camera: GodotProjectionCamera,
  size: number,
  near: number,
  far: number,
): void {
  setGodotCameraProjection(camera, 1);
  setGodotCameraSize(camera, size);
  setGodotCameraNear(camera, near);
  setGodotCameraFar(camera, far);
}

export function setGodotCameraFrustum(
  camera: GodotProjectionCamera,
  size: number,
  offset: Vector2Like,
  near: number,
  far: number,
): void {
  setGodotCameraProjection(camera, 2);
  setGodotCameraSize(camera, size);
  setGodotCameraFrustumOffset(camera, offset);
  setGodotCameraNear(camera, near);
  setGodotCameraFar(camera, far);
}

export function getGodotCameraHorizontalOffset(camera: GodotProjectionCamera): number {
  return cameraProjection(camera).hOffset ?? 0;
}

export function setGodotCameraHorizontalOffset(camera: GodotProjectionCamera, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError('Camera3D.h_offset requires finite float.');
  cameraProjection(camera).hOffset = value;
  updateGodotCameraProjection(camera);
}

export function getGodotCameraVerticalOffset(camera: GodotProjectionCamera): number {
  return cameraProjection(camera).vOffset ?? 0;
}

export function setGodotCameraVerticalOffset(camera: GodotProjectionCamera, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError('Camera3D.v_offset requires finite float.');
  cameraProjection(camera).vOffset = value;
  updateGodotCameraProjection(camera);
}

const _cameraFrustum = new Frustum();
const _cameraProjectionView = new Matrix4();
export function isGodotCameraPositionInFrustum(camera: GodotProjectionCamera, world: Vector3Like): boolean {
  if (![world?.x, world?.y, world?.z].every(Number.isFinite)) {
    throw new TypeError('Camera.is_position_in_frustum requires a finite Vector3.');
  }
  syncGodotCameraProjection(camera);
  camera.updateWorldMatrix(true, false);
  _cameraProjectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _cameraFrustum.setFromProjectionMatrix(_cameraProjectionView);
  return _cameraFrustum.containsPoint(_projectPoint.set(world.x, world.y, world.z));
}

export function updateGodotCameraProjection(camera: GodotProjectionCamera): void {
  const binding = CAMERA_VIEWPORT_SIZE.get(camera);
  if (binding === undefined) {
    throw new Error('godot-compat: Camera3D projection changed before its Viewport was bound.');
  }
  const size = binding.size();
  assertViewport(size, 'projection');
  applyGodotCameraProjection(camera, size);
  binding.width = size.x;
  binding.height = size.y;
}

/** Refresh the native projection when this camera's live Viewport dimensions changed. */
export function syncGodotCameraProjection(camera: GodotProjectionCamera): void {
  cameraViewportSize(camera, 'projection');
}

export function getGodotCameraFov(camera: GodotProjectionCamera): number {
  return cameraProjection(camera).fov;
}

export function setGodotCameraFov(camera: GodotProjectionCamera, value: number): void {
  if (!Number.isFinite(value) || value < 1 || value > 179) {
    throw new RangeError(`Camera3D.fov must be within [1, 179]; received ${String(value)}.`);
  }
  cameraProjection(camera).fov = value;
  updateGodotCameraProjection(camera);
}

export function getGodotCameraNear(camera: GodotProjectionCamera): number { return camera.near; }
export function setGodotCameraNear(camera: GodotProjectionCamera, value: number): void {
  camera.near = value;
  updateGodotCameraProjection(camera);
}
export function getGodotCameraFar(camera: GodotProjectionCamera): number { return camera.far; }
export function setGodotCameraFar(camera: GodotProjectionCamera, value: number): void {
  camera.far = value;
  updateGodotCameraProjection(camera);
}
export function getGodotCameraKeepAspect(camera: GodotProjectionCamera): 0 | 1 {
  return cameraProjection(camera).keepAspect;
}
export function setGodotCameraKeepAspect(
  camera: GodotProjectionCamera,
  value: number,
): void {
  if (value !== 0 && value !== 1) throw new RangeError(`Camera3D.keep_aspect=${value} is invalid.`);
  cameraProjection(camera).keepAspect = value;
  updateGodotCameraProjection(camera);
}

export function getGodotCameraFrustumOffset(camera: GodotProjectionCamera): Vector2Like {
  const offset = cameraProjection(camera).frustumOffset ?? { x: 0, y: 0 };
  return { x: offset.x, y: offset.y };
}

export function setGodotCameraFrustumOffset(
  camera: GodotProjectionCamera,
  value: Vector2Like,
): void {
  if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y)) {
    throw new TypeError('Camera3D.frustum_offset requires a finite Vector2.');
  }
  cameraProjection(camera).frustumOffset = { x: value.x, y: value.y };
  updateGodotCameraProjection(camera);
}

export function getGodotCameraSize(camera: GodotProjectionCamera): number {
  return cameraProjection(camera).size;
}

export function setGodotCameraSize(camera: GodotProjectionCamera, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`Camera3D.size must be positive; received ${String(value)}.`);
  }
  cameraProjection(camera).size = value;
  updateGodotCameraProjection(camera);
}

export function getGodotCameraCullMask(camera: GodotProjectionCamera): number {
  return camera.layers.mask >>> 0;
}

export function setGodotCameraCullMask(camera: GodotProjectionCamera, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError('Camera3D.cull_mask requires an unsigned 32-bit integer.');
  }
  camera.layers.mask = value | 0;
}

export function setGodotCameraCullMaskValue(
  camera: GodotProjectionCamera,
  layerNumber: number,
  enabled: boolean,
): void {
  if (!Number.isSafeInteger(layerNumber) || layerNumber < 1 || layerNumber > 20) {
    throw new RangeError('Camera3D cull layer number must be in [1, 20].');
  }
  if (typeof enabled !== 'boolean') throw new TypeError('Camera3D cull layer value requires bool.');
  const bit = 1 << (layerNumber - 1);
  camera.layers.mask = enabled ? camera.layers.mask | bit : camera.layers.mask & ~bit;
}

export function getGodotCameraCullMaskValue(
  camera: GodotProjectionCamera,
  layerNumber: number,
): boolean {
  if (!Number.isSafeInteger(layerNumber) || layerNumber < 1 || layerNumber > 20) {
    throw new RangeError('Camera3D cull layer number must be in [1, 20].');
  }
  return (camera.layers.mask & (1 << (layerNumber - 1))) !== 0;
}

/**
 * Design-space viewport when a project emits no `[display]` — `world.tsx`
 * `RESOLUTION` and `translate/project.ts` `GODOT_DEFAULT_WINDOW_SIZE`.
 * Not Godot 4's 1152×648 window default: that size against this project's
 * 1024×600 canvas computed the wrong NDC and picked the wrong cell.
 */
export const PROJECT_RAY_DEFAULT_VIEWPORT = { x: 1024, y: 600 } as const;

/**
 * `Camera3D.project_ray_origin(screen_point)` — dump: `(screen_point: Vector2) -> Vector3`.
 * For a perspective camera (this game's fov=20 Camera3D) the origin is the
 * camera's world position; the screen point does not move it.
 */
export function projectRayOrigin(
  camera: GodotProjectionCamera,
  screen: Vector2Like,
): Vector3 {
  const size = cameraViewportSize(camera, 'project_ray_origin');
  if (![screen?.x, screen?.y].every(Number.isFinite)) {
    throw new TypeError('Camera.project_ray_origin requires a finite Vector2 screen point.');
  }
  const state = cameraProjection(camera);
  const major = state.major;
  if (major !== 3 && major !== 4) {
    throw new Error('godot-compat: Camera.project_ray_origin requires a retained engine major.');
  }
  const projection = state.projection ?? ('isOrthographicCamera' in camera ? 1 : 0);
  camera.updateWorldMatrix(true, false);
  // Godot 4 offsets the origin only for ORTHOGONAL. Godot 3's source uses the same branch for
  // ORTHOGONAL and FRUSTUM; preserve that historical spelling instead of normalizing the majors.
  if (projection === 1 || (major === 3 && projection !== 0)) {
    const aspect = size.x / size.y;
    const verticalSize = state.keepAspect === 0 ? state.size / aspect : state.size;
    const horizontalSize = verticalSize * aspect;
    _projectOrigin.set(
      (screen.x / size.x) * horizontalSize - horizontalSize / 2,
      (1 - screen.y / size.y) * verticalSize - verticalSize / 2,
      -camera.near,
    ).applyMatrix4(camera.matrixWorld);
    return vec3(_projectOrigin.x, _projectOrigin.y, _projectOrigin.z);
  }
  camera.getWorldPosition(_projectOrigin);
  return vec3(_projectOrigin.x, _projectOrigin.y, _projectOrigin.z);
}

/**
 * `Camera3D.project_ray_normal(screen_point)` — dump: `(screen_point: Vector2) -> Vector3`.
 * Godot's screen origin is top-left, Y down. three's NDC is Y up.
 */
export function projectRayNormal(
  camera: GodotProjectionCamera,
  screen: Vector2Like,
): Vector3 {
  const viewport = cameraViewportSize(camera, 'project_ray_normal');
  if (![screen?.x, screen?.y].every(Number.isFinite)) {
    throw new TypeError('Camera.project_ray_normal requires a finite Vector2 screen point.');
  }
  const ndcX = (screen.x / viewport.x) * 2 - 1;
  const ndcY = 1 - (screen.y / viewport.y) * 2;
  const state = cameraProjection(camera);
  if (state.major !== 3 && state.major !== 4) {
    throw new Error('godot-compat: Camera.project_ray_normal requires a retained engine major.');
  }
  const projection = state.projection ?? ('isOrthographicCamera' in camera ? 1 : 0);
  camera.updateWorldMatrix(true, false);
  if (projection === 1) {
    camera.getWorldDirection(_projectDir).normalize();
    return vec3(_projectDir.x, _projectDir.y, _projectDir.z);
  }
  if (state.major === 3 && projection === 2) {
    const aspect = viewport.x / viewport.y;
    const verticalFov = state.keepAspect === 0
      ? 2 * Math.atan(Math.tan((state.fov * Math.PI) / 360) / aspect)
      : (state.fov * Math.PI) / 180;
    const halfHeight = Math.tan(verticalFov / 2) * camera.near;
    _projectDir
      .set(ndcX * halfHeight * aspect, ndcY * halfHeight, -camera.near)
      .transformDirection(camera.matrixWorld);
    return vec3(_projectDir.x, _projectDir.y, _projectDir.z);
  }
  // Camera3D::project_local_ray_normal uses Projection::get_viewport_half_extents(), whose
  // contract is the symmetric extents from the projection diagonal. It deliberately does not
  // apply an off-axis frustum's center offset.
  const projectionElements = camera.projectionMatrix.elements;
  const halfWidth = camera.near / projectionElements[0]!;
  const halfHeight = camera.near / projectionElements[5]!;
  _projectDir
    .set(ndcX * halfWidth, ndcY * halfHeight, -camera.near)
    .transformDirection(camera.matrixWorld);
  return vec3(_projectDir.x, _projectDir.y, _projectDir.z);
}

export function unprojectGodotCameraPosition(
  camera: GodotProjectionCamera,
  world: Vector3Like,
): { x: number; y: number } {
  const size = cameraViewportSize(camera, 'unproject_position');
  camera.updateMatrixWorld();
  _projectPoint.set(world.x, world.y, world.z).applyMatrix4(camera.matrixWorldInverse);
  if ('isPerspectiveCamera' in camera && _projectPoint.z === 0) return { x: 0, y: 0 };
  _projectPoint.set(world.x, world.y, world.z).project(camera);
  if (!Number.isFinite(_projectPoint.x) || !Number.isFinite(_projectPoint.y)) return { x: 0, y: 0 };
  return {
    x: (_projectPoint.x * 0.5 + 0.5) * size.x,
    y: (-_projectPoint.y * 0.5 + 0.5) * size.y,
  };
}

export function isGodotCameraPositionBehind(camera: GodotProjectionCamera, world: Vector3Like): boolean {
  camera.updateWorldMatrix(true, false);
  camera.getWorldPosition(_projectOrigin);
  camera.getWorldDirection(_projectDir).normalize();
  return _projectDir.dot(_projectPoint.set(world.x, world.y, world.z).sub(_projectOrigin)) < camera.near;
}

export function projectGodotCameraPosition(
  camera: GodotProjectionCamera,
  screen: Vector2Like,
  depth: number,
): Vector3 {
  const size = cameraViewportSize(camera, 'project_position');
  if (![screen?.x, screen?.y, depth].every(Number.isFinite)) {
    throw new TypeError('Camera.project_position requires a finite Vector2 and finite depth.');
  }
  const state = cameraProjection(camera);
  const major = state.major;
  if (major !== 3 && major !== 4) {
    throw new Error('godot-compat: Camera.project_position requires a retained engine major.');
  }
  const projection = state.projection ?? ('isOrthographicCamera' in camera ? 1 : 0);
  camera.updateWorldMatrix(true, false);
  if (depth === 0 && projection !== 1) {
    camera.getWorldPosition(_projectPoint);
    return vec3(_projectPoint.x, _projectPoint.y, _projectPoint.z);
  }
  const ndcX = (screen.x / size.x) * 2 - 1;
  const ndcY = 1 - (screen.y / size.y) * 2;
  if (major === 3 && projection === 2) {
    // Godot 3's Camera::project_position intentionally routes FRUSTUM through a centered
    // perspective CameraMatrix, ignoring frustum_offset. Godot 4 instead uses its real projection.
    const aspect = size.x / size.y;
    const verticalFov = state.keepAspect === 0
      ? 2 * Math.atan(Math.tan((state.fov * Math.PI) / 360) / aspect)
      : (state.fov * Math.PI) / 180;
    const halfHeight = Math.tan(verticalFov / 2) * depth;
    _projectPoint.set(ndcX * halfHeight * aspect, ndcY * halfHeight, -depth);
  } else {
    // Camera3D::project_position does not inverse-project this NDC. It intersects the requested
    // z slice with the projection's RIGHT and TOP planes to obtain one top-right extent, then
    // multiplies both NDC axes by that point. The projection-matrix formulas below are the same
    // intersections, including Godot 4's intentionally asymmetric result for an off-axis frustum.
    const projectionElements = camera.projectionMatrix.elements;
    const scaleX = projectionElements[0]!;
    const scaleY = projectionElements[5]!;
    if (Math.abs(scaleX) <= Number.EPSILON || Math.abs(scaleY) <= Number.EPSILON) {
      throw new Error('godot-compat: Camera.project_position has a degenerate projection matrix.');
    }
    const right = projection === 1
      ? (1 - projectionElements[12]!) / scaleX
      : (depth * (1 + projectionElements[8]!)) / scaleX;
    const top = projection === 1
      ? (1 - projectionElements[13]!) / scaleY
      : (depth * (1 + projectionElements[9]!)) / scaleY;
    _projectPoint.set(ndcX * right, ndcY * top, -depth);
  }
  _projectPoint.applyMatrix4(camera.matrixWorld);
  return vec3(_projectPoint.x, _projectPoint.y, _projectPoint.z);
}
