/**
 * Godot's 3D built-in Variant types — `Vector3` and `Transform`.
 *
 * The 3D sibling of `variant.ts`, and it exists separately for the same reason
 * `node-3d.ts` does: a Godot game is 2D or 3D, and a port that deletes the half
 * it does not use should be deleting whole files.
 *
 * ## The measurement, and the part the report could not print until it was fixed
 *
 * `gd-analyze report packages/gd-analyze/test/fixtures/squash-the-creeps` prints
 * ten built-in rows over 28 reads: `Vector3` `ZERO` (4), `UP` (5), `FORWARD`
 * (1), `x` (5), `y` (5), `z` (4), `normalized` (1), `dot` (1), `rotated` (1),
 * and `Transform.origin` (1). Three of those — `normalized` (`Player.gd:30`),
 * `dot` (`:58`) and `rotated` (`Mob.gd:27`) — appeared in NO table at all until
 * the analyzer learned the 3D Variant family: `var direction = Vector3.ZERO`
 * degraded to a game value at its first read and took every later access with
 * it, silently. That is why this file's surface is exactly ten members and not
 * the seven a reader of the old report would have built.
 *
 * ## A `Vector3` is a PLAIN FROZEN RECORD, not a `THREE.Vector3`
 *
 * Godot's `Vector3` is a VALUE: `var here = $Player.transform.origin` copies,
 * and arithmetic returns new vectors rather than mutating. `THREE.Vector3` is
 * the opposite — a mutable object whose methods write in place, and the one a
 * node hands back (`object.position`) is the LIVE handle that moves the node.
 * Handing a port that where GDScript wrote a `Vector3` would turn a plain read
 * into an alias that keeps changing, which is exactly the bug class the value
 * semantics exist to prevent (`variant.ts` records the same trade for Pixi's
 * `ObservablePoint`).
 *
 * So a `Vector3` here is `{ x, y, z }` — three's own `Vector3Like`, which every
 * three setter accepts (`object.position.copy(vec3(1, 2, 3))` works). Nothing
 * is wrapped: the return path is a plain object three's API already takes, and
 * `spatial.ts`'s `getTranslation` is what hands one back from a live node.
 *
 * ## The operators, which are members of nothing
 *
 * `add3`/`sub3`/`mul3` are GDScript OPERATORS rather than members, so no member
 * table can requisition them, and TypeScript has no operator overloading — so
 * an emitter has no way to write `a + b` over records. Each is cited to the
 * line that makes it:
 *
 *   - {@link add3}  `Player.gd:31`  `translation + direction`
 *   - {@link mul3}  `Mob.gd:25`     `Vector3.FORWARD * random_speed`
 *   - {@link equals3} `Player.gd:28` `if direction != Vector3.ZERO`
 *   - {@link sub3}  no measured caller — it ships because `add3` without it is
 *     a vector kit that fails on the first `a - b` an emitter meets, and the
 *     two are four lines that cannot disagree. `variant.ts`'s `sub` records the
 *     same reason.
 *
 * {@link equals3} is the one of these a port CANNOT do without and would never
 * notice missing. Because a `Vector3` here is a frozen RECORD, `a !== b` in
 * TypeScript compares references and is therefore always true — so a translated
 * `if direction != Vector3.ZERO` would take the moving branch on a standing
 * character, every frame, with nothing wrong-looking anywhere in the output.
 * Godot compares componentwise; so does this.
 *
 * Nothing else is written on spec: no `angle_to`, no `distance_to`, no
 * `LEFT`/`RIGHT`/`BACK`/`DOWN`, because no measured fixture reaches for them
 * and a vector library written ahead of its callers is the surface that stops
 * telling the truth about what is shipped. Every member that arrived after
 * this header was written arrived the same way — {@link cross3} from
 * `platformer-3d`'s facing frame, {@link isZeroApprox3} from
 * `platformer-3d-godot4`'s gravity guard, {@link VECTOR3_ONE} from
 * `starter-kit-fps` `player.gd:185` — with the fixture line that requisitioned
 * it cited on the function.
 */

import type { Vector3Like } from 'three';

/**
 * Godot's `Vector3` — a plain, frozen `{ x, y, z }`.
 *
 * Frozen because it is a VALUE; see this module's header. Every function in
 * `spatial.ts` takes a `Vector3Like`, so a frozen record and a live
 * `THREE.Vector3` both go in without a conversion at the call site.
 */
export type Vector3 = Readonly<Vector3Like>;

/** `Vector3(x, y, z)`. */
export function vec3(x: number, y: number, z: number): Vector3 {
  return Object.freeze({ x, y, z });
}

/** `Vector3(from)` — Godot 4's value-copy constructor, including a `Vector3i` source. */
export function copy3(from: Vector3Like): Vector3 {
  return vec3(from.x, from.y, from.z);
}

const integerVector3Component = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new TypeError('godot-compat: Vector3i requires finite numeric components.');
  }
  return Math.trunc(numeric);
};

/** `Vector3i()` / `Vector3i(from)` / `Vector3i(x, y, z)`, including float-vector conversion. */
export function godotVector3iNew(...args: readonly unknown[]): Vector3 {
  if (args.length === 0) return vec3(0, 0, 0);
  if (args.length === 1) {
    const value = args[0];
    if (typeof value !== 'object' || value === null) {
      throw new TypeError('godot-compat: Vector3i(value) requires a Vector3/Vector3i value.');
    }
    return vec3(
      integerVector3Component(Reflect.get(value, 'x')),
      integerVector3Component(Reflect.get(value, 'y')),
      integerVector3Component(Reflect.get(value, 'z')),
    );
  }
  if (args.length !== 3) {
    throw new TypeError(`godot-compat: Vector3i accepts 0, 1, or 3 arguments; received ${args.length}.`);
  }
  return vec3(
    integerVector3Component(args[0]),
    integerVector3Component(args[1]),
    integerVector3Component(args[2]),
  );
}

/** `Vector3.ZERO` — `Player.gd:14`, `:18`; `Mob.gd:11`. A single frozen
 *  instance: it is a constant, and nothing can mutate it into a non-zero one. */
export const VECTOR3_ZERO: Vector3 = vec3(0, 0, 0);

/** Godot 4 `Vector3i.ZERO`; a distinct frozen integer-vector constant identity. */
export const VECTOR3I_ZERO: Vector3 = vec3(0, 0, 0);

/** `Vector3.UP` — `(0, 1, 0)`. Godot 3 and three are both Y-up, so this is the
 *  same triple in both. */
export const VECTOR3_UP: Vector3 = vec3(0, 1, 0);

/**
 * `Vector3.FORWARD` — `(0, 0, -1)`, `Mob.gd:25`.
 *
 * Godot 3 and three agree here too, and it is worth stating because it is the
 * one convention a 3D port would silently get backwards: both are RIGHT-handed
 * Y-up spaces in which forward is NEGATIVE Z (Godot's `Vector3.FORWARD` is
 * `(0, 0, -1)`, and a three camera looks down its own -Z). No sign flips
 * anywhere in this file or in `spatial.ts` — see `spatial.ts`'s header for the
 * two conventions that genuinely DO differ.
 */
export const VECTOR3_FORWARD: Vector3 = vec3(0, 0, -1);

/** `Vector3.ONE` — `(1, 1, 1)`. `starter-kit-fps` `player.gd:185` scales the
 *  muzzle flash by `Vector3.ONE * randf_range(0.40, 0.75)`. The same frozen
 *  singleton {@link VECTOR3_ZERO} is: a constant, and nothing can mutate it. */
export const VECTOR3_ONE: Vector3 = vec3(1, 1, 1);

/** `a + b` — `Player.gd:31`, `translation + direction`. */
export function add3(a: Vector3Like, b: Vector3Like): Vector3 {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

/** `a - b`. */
export function sub3(a: Vector3Like, b: Vector3Like): Vector3 {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** `v * scalar` — `Mob.gd:25`. Godot also multiplies two vectors
 *  componentwise; no measured fixture does, so only the scalar form ships. */
export function mul3(v: Vector3Like, scalar: number): Vector3 {
  return vec3(v.x * scalar, v.y * scalar, v.z * scalar);
}

/**
 * `v / scalar` — `starter-kit-fps` `player.gd:72` (`applied_velocity / 30`) and
 * `:148` (`Vector3(-yRot, -xRot, 0) / mouse_sensitivity`).
 *
 * Godot's `Vector3 / float` is component-wise. Only the scalar form ships,
 * matching {@link mul3}: the fixture never divides two vectors. `variant.ts`'s
 * {@link div} is the 2D sibling.
 */
export function div3(v: Vector3Like, scalar: number): Vector3 {
  return vec3(v.x / scalar, v.y / scalar, v.z / scalar);
}

/**
 * `-v` — GDScript's unary MINUS on a `Vector3`, an OPERATOR rather than a member (so no member
 * table can requisition it, exactly like {@link add3}/{@link sub3}). `player.gd` negates a vector
 * in three places — `-facing_mesh` (`:80`), `-facing_mesh.cross(Vector3.UP).normalized()` (`:80`)
 * and `-gravity.normalized()` (`:109`) — and TypeScript's `-` on a record is `NaN`, so the
 * translator spells the componentwise negation Godot's `Vector3::operator-()` performs.
 */
export function neg3(v: Vector3Like): Vector3 {
  return vec3(-v.x, -v.y, -v.z);
}

/**
 * `a == b` / `a != b` — `Player.gd:28`, `if direction != Vector3.ZERO`.
 *
 * EXACT componentwise equality, which is Godot's `Vector3::operator==`. Godot
 * has a separate `is_equal_approx` for the tolerant comparison, and conflating
 * the two would make a character with a rounding-error velocity read as
 * standing still. See this module's header for why a port cannot use `===`.
 */
export function equals3(a: Vector3Like, b: Vector3Like): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/** `v.length()`. */
export function length3(v: Vector3Like): number {
  return Math.hypot(v.x, v.y, v.z);
}

/**
 * Godot's `CMP_EPSILON` (`core/math/math_defs.h`), the tolerance every
 * `is_zero_approx`/`is_equal_approx` in the engine compares against. It is
 * `0.00001` for both build precisions, and the pinned Godot 4 dump this lane
 * adjudicates against declares `"precision": "single"`.
 */
const CMP_EPSILON = 0.00001;

/**
 * `v.is_zero_approx()` — `platformer-3d-godot4` `enemy.gd:27` and
 * `follow_camera.gd:83`.
 *
 * NOT {@link equals3} against {@link VECTOR3_ZERO}, and the difference is the
 * whole reason this member exists in the 4.x fixture where the 3.x one wrote
 * `g == Vector3.ZERO`: Godot's `Vector3::is_zero_approx()` is
 * `Math::is_zero_approx` per COMPONENT, i.e. `abs(c) < CMP_EPSILON`, where the
 * equality operator is exact. `enemy.gd`'s line guards the first frames in
 * which `get_total_gravity()` reports nothing, and a near-zero gravity vector —
 * exactly what those frames produce — is the case the two answers disagree on.
 */
export function isZeroApprox3(v: Vector3Like): boolean {
  return Math.abs(v.x) < CMP_EPSILON && Math.abs(v.y) < CMP_EPSILON && Math.abs(v.z) < CMP_EPSILON;
}

/**
 * `v.normalized()` — `Player.gd:30`, `direction = direction.normalized()`.
 *
 * Godot returns `Vector3.ZERO` for a zero-length vector rather than `NaN`s, and
 * so does this. `Player.gd` guards with `if direction != Vector3.ZERO` before
 * normalizing, but a port that drops the guard should get Godot's answer, not
 * a silently poisoned transform.
 */
export function normalized3(v: Vector3Like): Vector3 {
  if (![v.x, v.y, v.z].every(Number.isFinite)) return VECTOR3_ZERO;
  const len = length3(v);
  return len === 0 ? VECTOR3_ZERO : vec3(v.x / len, v.y / len, v.z / len);
}

/**
 * `v.limit_length(len)` — `starter-kit-3d-platformer` `view.gd:47`, which clamps a
 * two-axis camera input to a unit disc before scaling it by the rotation speed.
 *
 * The 3D half of `variant.ts`'s {@link limitLength}, and Godot writes them the same way: a CLAMP,
 * not a rescale. A vector already shorter than `len` comes back untouched and so does the zero
 * vector (Godot's own `l > 0` guard, which is what keeps a centred stick from producing `NaN`);
 * only a LONGER vector is scaled down to exactly `len`. Godot's `Vector3::limit_length` defaults
 * `len` to 1, which is the value that call site passes explicitly.
 */
export function limitLength3(v: Vector3Like, len: number): Vector3 {
  const l = length3(v);
  if (l > 0 && len < l) return vec3((v.x / l) * len, (v.y / l) * len, (v.z / l) * len);
  return vec3(v.x, v.y, v.z);
}

/**
 * `a.lerp(b, weight)` — `starter-kit-3d-platformer` `player.gd:43`/`:63`, `view.gd:29`/`:30`/`:32`,
 * `platform_falling.gd:7`. That game animates almost everything this way.
 *
 * Godot's `Vector3::lerp` is `a + (b - a) * weight` per component and it does NOT clamp the
 * weight: every one of those call sites passes `delta * k`, which exceeds 1 the moment a frame is
 * long enough, and Godot's own answer there is an overshoot rather than a stop. Clamping would be
 * a different (steadier) animation than the game has, so the un-clamped form is what ships.
 */
export function lerp3(a: Vector3Like, b: Vector3Like, weight: number): Vector3 {
  return vec3(a.x + (b.x - a.x) * weight, a.y + (b.y - a.y) * weight, a.z + (b.z - a.z) * weight);
}

/** `a.dot(b)` — `Player.gd:58`, `Vector3.UP.dot(collision.normal) > 0.1`, which
 *  is the whole "did I land on TOP of the mob" test. */
export function dot3(a: Vector3Like, b: Vector3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * `a.cross(b)` — `platformer-3d` `player.gd:80`
 * (`-facing_mesh.cross(Vector3.UP)`) and `:137` (`n.cross(current_gn)`), the
 * two places the player builds an orthonormal facing frame for its armature.
 *
 * The RIGHT-HANDED cross product, `(a.y·b.z − a.z·b.y, a.z·b.x − a.x·b.z,
 * a.x·b.y − a.y·b.x)`. This is HANDEDNESS-SENSITIVE — `a.cross(b) == −b.cross(a)`
 * — so the operand order is load-bearing and is preserved exactly as Godot
 * writes it. Godot 3.6's `Vector3::cross` (`core/math/vector3.h:118-124`) is
 * this formula verbatim, and it is identical to `THREE.Vector3.crossVectors`
 * (both are Y-up right-handed spaces), so no sign or axis is flipped in the
 * translation — `test/ground-truth/godot36-cross.json` pins the fixture's own
 * two calls against Godot 3.6 and `test/variant-3d.test.ts` also checks each
 * against the real `THREE.Vector3` to catch an operand swap.
 */
export function cross3(a: Vector3Like, b: Vector3Like): Vector3 {
  return vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

/**
 * `arr.append(value)` — `platformer-3d` `follow_camera.gd:21`,
 * `collision_exception.append(node.get_rid())`.
 *
 * Godot's `Array.append` MUTATES the array in place and returns nothing; a JS
 * array's `push` mutates in place too and its return (the new length) is
 * discarded in the statement position the fixture uses. Returning `void` keeps
 * the two behaviours identical — a caller that read `append`'s result in Godot
 * would read `null`, which is not something a translated expression can lean on.
 */
export function arrayAppend<T>(arr: T[], value: T): void {
  arr.push(value);
}

/** `arr.clear()` — builder.gd:142 `map.structures.clear()`. Dump: Array.clear() -> void. */
export function arrayClear<T>(arr: T[]): void {
  arr.length = 0;
}

/**
 * `v.rotated(axis, angle)` — `Mob.gd:27`,
 * `velocity.rotated(Vector3.UP, rotation.y)`.
 *
 * Rodrigues' rotation, counter-clockwise about `axis` looking down it toward
 * the origin — the right-handed sense Godot uses and three uses, so the formula
 * is written once and means the same thing in both.
 *
 * @throws if `axis` is not a unit vector, which is Godot's own precondition
 * (its `rotated` asserts `axis.is_normalized()`). A near-unit axis from a
 * normalized read is fine; a zero or scaled one silently changes the ANGLE as
 * well as the plane, which in a port reads as "the mobs fly off at random
 * speeds".
 */
export function rotated3(v: Vector3Like, axis: Vector3Like, angle: number): Vector3 {
  const lengthSquared = dot3(axis, axis);
  if (!(lengthSquared === 1 || Math.abs(lengthSquared - 1) < 0.001)) {
    throw new Error(
      `godot-compat: Vector3.rotated(axis, angle) needs a UNIT axis, got length-squared ${lengthSquared}. ` +
        "Godot asserts the same precondition; normalize the axis (or use one of variant-3d's " +
        'constants) rather than letting the length scale the rotation.',
    );
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = dot3(axis, v);
  return vec3(
    v.x * cos + (axis.y * v.z - axis.z * v.y) * sin + axis.x * dot * (1 - cos),
    v.y * cos + (axis.z * v.x - axis.x * v.z) * sin + axis.y * dot * (1 - cos),
    v.z * cos + (axis.x * v.y - axis.y * v.x) * sin + axis.z * dot * (1 - cos),
  );
}

/**
 * Godot's `Transform` — a 3x3 `basis` plus a `Vector3` `origin`.
 *
 * Only `origin` is measured (`Main.gd:26`, `$Player.transform.origin`), but a
 * `Transform` without its basis is not a `Transform`, and the one place that
 * builds one (`spatial.ts`'s `getTransform`) knows both halves for free.
 * `variant.ts`'s `Rect2` records the same trade.
 *
 * The basis is its three COLUMN vectors, which is how Godot's own
 * `Basis(x, y, z)` constructor and three's `Matrix4` both order them: column
 * `x` is where the local +X axis points, and so on.
 */
export interface Transform {
  readonly basis: readonly [Vector3, Vector3, Vector3];
  readonly origin: Vector3;
}

/** `Transform(basis, origin)`. */
export function transform3(
  basis: readonly [Vector3Like, Vector3Like, Vector3Like],
  origin: Vector3Like,
): Transform {
  return Object.freeze({
    basis: Object.freeze([
      vec3(basis[0].x, basis[0].y, basis[0].z),
      vec3(basis[1].x, basis[1].y, basis[1].z),
      vec3(basis[2].x, basis[2].y, basis[2].z),
    ]) as readonly [Vector3, Vector3, Vector3],
    origin: vec3(origin.x, origin.y, origin.z),
  });
}

/**
 * Godot's `Plane` — a frozen `{ normal, point }`, the 4.7 dump's constructor 4
 * (`normal: Vector3, point: Vector3`). starter-kit-city-builder `builder.gd:20`
 * is `Plane(Vector3.UP, Vector3.ZERO)` (the XZ ground, the dump's `PLANE_XZ`
 * constant) and `:53` is `plane.intersects_ray(from, dir)`.
 *
 * Stored as the constructor's own arguments rather than Godot's `(x,y,z,d)`
 * members: the dump names those members but does not say whether the equation
 * is `n·x = d` or `n·x + d = 0`, and a wrong `d` would still intersect. The
 * named pair does not need that convention.
 */
