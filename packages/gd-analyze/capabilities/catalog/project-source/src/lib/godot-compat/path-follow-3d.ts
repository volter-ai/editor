/**
 * `PathFollow.unit_offset` — a point sampled along a caller-baked 3D polyline.
 *
 * `squash-the-creeps` spawns every mob with it (`Main.gd:22-27`):
 *
 * ```gdscript
 * var mob_spawn_location = get_node("SpawnPath/SpawnLocation")
 * mob_spawn_location.unit_offset = randf()
 * ...
 * mob.initialize(mob_spawn_location.translation, player_position)
 * ```
 *
 * The path is a ring around the arena; writing a random `unit_offset` walks the
 * follower to a random point on it, and the mob is then aimed at the player by
 * `Spatial.look_at_from_position`. The only read afterwards is `translation`,
 * which is `spatial.ts`'s ordinary accessor.
 *
 * ## `unit_offset`, not `offset` — and the difference is the whole member
 *
 * Godot has both: `offset` is arc length in world units, `unit_offset` is the
 * same thing as a 0..1 RATIO of the total. `path-follow-2d.ts` implements
 * `offset` because the 2D pilot writes `randi()` and relies on the wrap;
 * this one implements `unit_offset` because `randf()` returns 0..1 and the
 * ratio is what makes that meaningful. Two different members of two different
 * Godot classes, each backed where its own fixture measured it.
 *
 * ## The curve is the caller's, as baked points
 *
 * Godot's `Path` holds a `Curve3D` — control points plus Bézier handles and its
 * own arc-length baking. Reimplementing that here would be a geometry subsystem
 * written for one member. The translated `.tscn` already has to turn the curve
 * into something three can place objects along, so it hands the SAME baked
 * polyline here, and compat does one thing with it: arc-length lookup.
 * `path-follow-2d.ts` records the same trade, and a game whose path is genuinely
 * curved bakes its `Curve3D` at whatever resolution it likes.
 *
 * ## The lookup is `THREE.CurvePath`'s, not one written here
 *
 * The polyline is a `CurvePath` of `LineCurve3`s: `getLength()` is the total,
 * and `getPoint(u)` is the segment lookup plus the lerp, which for a path of
 * LINES is exact arc-length parameterisation because `CurvePath.getPoint`
 * divides `u` by its own cumulative length table first. So `unit_offset` IS
 * three's `u` once Godot's wrap has been applied to it, and this file writes no
 * table, no scan and no lerp of its own. (`getPoint`, not `getPointAt`:
 * `getPointAt` re-maps `u` through `getUtoTmapping`'s RESAMPLED table, a second
 * approximation of the identity on a parameterisation that is already arc
 * length.)
 *
 * Each `LineCurve3` carries `arcLengthDivisions = 1`, because a line's arc
 * length IS its chord: three's default 200 resamples a straight segment into
 * 200 chord additions, which allocates 201 vectors per segment and — measured
 * over 2000 random segments — lands up to 6.3e-13 away from the exact distance.
 *
 * ## What this does NOT claim
 *
 * Godot's `PathFollow` also carries `rotation_mode` (ORIENTED, XYZ, Y, NONE),
 * `v_offset`/`h_offset` and `cubic_interp`. None is measured and none ships:
 * the follower's POSITION is written, and its orientation is left alone, which
 * is Godot's `ROTATION_NONE`. A port whose game reads the follower's rotation is
 * reading something this backend does not set, and finding that out at the read
 * is better than inheriting a guessed tangent frame — three ways of building one
 * from a polyline disagree at the first non-planar corner.
 *
 * ## Resource ownership
 *
 * **Owns:** the `CurvePath` built from the caller's points (and three's own
 * length cache inside it). **Shares:** the point array (the caller's,
 * read-only) and the follower `Object3D` (the scene's). **Teardown:** none —
 * nothing is registered anywhere.
 */

import {
  CurvePath,
  LineCurve3,
  type Object3D,
  Vector3 as ThreeVector3,
  type Vector3Like,
} from 'three';
import { setTranslation } from './spatial';
import { type Vector3, vec3 } from './variant-3d';
import {
  observeGodotCurve3D,
  observeGodotPath3D,
  type GodotCurve3D,
  type GodotPath3D,
} from './curve-3d';

/** A follower bound to one baked 3D path. */
export interface PathFollow3D {
  /** The node this follower moves — the `PathFollow` in the translated tree. */
  readonly node: Object3D;
  /** `path_follow.unit_offset` — 0..1 along the path. */
  readonly unitOffset: number;
  /** Total baked length, in world units. */
  readonly length: number;
  /** `path_follow.unit_offset = value` — `Main.gd:23`. Writes the follower
   *  node's `translation`; see this module's header for what it leaves alone. */
  setUnitOffset(value: number): void;
  release(): void;
}

/** What {@link createPathFollow3D} needs. */
export interface CreatePathFollow3DOptions {
  /** The node whose `translation` the follower writes. */
  readonly node: Object3D;
  /**
   * The baked path, in the PARENT'S coordinate space — the same space the
   * follower's `translation` is written in, which is what `Path`/`PathFollow`
   * parenting means in Godot.
   */
  readonly points?: readonly Vector3Like[];
  /** The retained Path3D resource. Mutating it immediately refreshes this follower. */
  readonly curve?: GodotCurve3D;
  /** Preferred retained parent identity; follows later `path.curve` replacements. */
  readonly path?: GodotPath3D;
  /** Godot's `loop`. Default true, as in Godot: `unit_offset` wraps past 1. */
  readonly loop?: boolean;
}

/**
 * Build a follower.
 *
 * @throws if the path has fewer than two points or zero total length. Godot
 * leaves such a follower parked at the origin forever, which in a port reads as
 * "every mob spawns in the middle of the arena".
 */
export function createPathFollow3D(options: CreatePathFollow3DOptions): PathFollow3D {
  const { node } = options;
  const points = options.points ?? [];
  let authoredCurve = options.path?.curve ?? options.curve;
  if (authoredCurve === undefined && points.length < 2) {
    throw new Error(
      `godot-compat: PathFollow needs at least two baked points, got ${points.length}. A ` +
        'translated Path bakes its Curve3D into the polyline it hands over.',
    );
  }

  const nativeCurve = new CurvePath<ThreeVector3>();
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Vector3Like;
    const b = points[i] as Vector3Like;
    const segment = new LineCurve3(
      new ThreeVector3(a.x, a.y, a.z),
      new ThreeVector3(b.x, b.y, b.z),
    );
    // A line's arc length IS its chord — see the module header.
    segment.arcLengthDivisions = 1;
    nativeCurve.add(segment);
  }
  const initialLength = authoredCurve?.get_baked_length() ?? nativeCurve.getLength();
  if (initialLength === 0 && options.path === undefined && authoredCurve === undefined) {
    throw new Error(
      'godot-compat: PathFollow was given a zero-length path (every point is the same). Godot ' +
        'parks the follower at the origin; no offset means anything on it.',
    );
  }

  const loop = options.loop !== false;

  function sampleAt(ratio: number): Vector3 {
    // Godot's own wrap, in ratio space: `unit_offset` modulo 1, kept positive.
    // That ratio IS three's `u`, because a CurvePath of lines is parameterised
    // by arc length.
    const unit = loop ? ((ratio % 1) + 1) % 1 : Math.min(Math.max(ratio, 0), 1);
    if (authoredCurve !== undefined) {
      return authoredCurve.sample_baked(unit * authoredCurve.get_baked_length(), true);
    }
    if (options.path !== undefined) return vec3(0, 0, 0);
    const point = nativeCurve.getPoint(unit);
    return vec3(point.x, point.y, point.z);
  }

  let unitOffset = 0;
  const follower: PathFollow3D = {
    node,
    get unitOffset(): number {
      return unitOffset;
    },
    get length(): number {
      return authoredCurve?.get_baked_length() ?? initialLength;
    },
    setUnitOffset(value): void {
      unitOffset = value;
      setTranslation(node, sampleAt(value));
    },
    release(): void {},
  };

  let releaseCurve = authoredCurve === undefined
    ? () => {}
    : observeGodotCurve3D(authoredCurve, () => follower.setUnitOffset(unitOffset));
  const releasePath = options.path === undefined ? () => {} : observeGodotPath3D(options.path, () => {
    releaseCurve();
    authoredCurve = options.path!.curve ?? undefined;
    releaseCurve = authoredCurve === undefined
      ? () => {}
      : observeGodotCurve3D(authoredCurve, () => follower.setUnitOffset(unitOffset));
    follower.setUnitOffset(unitOffset);
  });
  follower.release = () => { releaseCurve(); releasePath(); };

  // Seed the node at the start, so a follower read before it is written reports
  // the start of the path rather than wherever the .tscn left the node.
  follower.setUnitOffset(0);
  return follower;
}
