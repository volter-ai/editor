/**
 * `PathFollow2D` consumes the exact cached point order of its parent's shared
 * mutable `Curve2D` Resource. Curve mutation and replacement rebuild the native
 * Three line path before the follower is sampled again.
 *
 * ## The lookup is `THREE.CurvePath`'s
 *
 * The polyline is a `CurvePath` of `LineCurve`s, and three owns every piece of
 * machinery this file used to hand-roll: `getCurveLengths()` is the cumulative
 * arc-length table, `getLength()` the total, and `getPoint(u)` the segment
 * lookup plus the lerp inside it — for a path of LINES that is exact
 * arc-length parameterisation, because `CurvePath.getPoint` divides `u` by the
 * cumulative table before handing the remainder to the owning segment. (It is
 * `getPoint`, not `getPointAt`: `getPointAt` re-maps `u` through
 * `getUtoTmapping`'s RESAMPLED table, which on an already-arc-length
 * parameterisation is a second approximation of the identity.)
 *
 * Each `LineCurve` carries `arcLengthDivisions = 1`, because a line's arc
 * length IS its chord: three's default 200 resamples a straight segment into
 * 200 chord additions, which allocates 201 vectors per segment and — measured
 * over 2000 random segments — lands up to 6.3e-13 away from the exact
 * distance. One division is the exact chord.
 *
 * **This is the one three import on the 2D side of this folder** (`node.ts`,
 * `variant.ts`, `physics-2d.ts` and the rest are Pixi-only). It is a math
 * import — `Curve`/`CurvePath`/`LineCurve` reach no renderer — and three is
 * already this capability's declared dependency; the alternative was keeping
 * the table, the scan and the lerp that the rung audit condemns. A port that
 * deletes the 3D half whole still keeps this file, and still keeps three for it.
 *
 * ## `offset` semantics, stated because Godot's are specific
 *
 * - `offset` is in PIXELS of arc length from the start of the path, not a 0..1
 *   ratio (that is `unit_offset`).
 * - It WRAPS when `loop` is true, which is Godot's default — `randi()` produces
 *   a huge integer and the pilot relies entirely on the wrap to turn it into a
 *   border position.
 * - `rotate` is true by default, so the follower's `rotation` tracks the
 *   tangent. Reading `.rotation` right after writing `.offset` is exactly what
 *   `Main.gd:38` does.
 * - The tangent is the OWNING segment's own direction, and at an exact corner
 *   the owner is the segment the offset leaves ALONG, not the one it arrived
 *   on. That is Godot's answer too: `PathFollow2D::_update_transform` aims at a
 *   point `lookahead` (4 px) FURTHER along the curve, which at a corner is the
 *   outgoing segment. It is deliberately not `CurvePath.getTangent`, whose
 *   centred finite difference straddles a corner and reports the bisector —
 *   45° instead of 90° on the pilot's rectangle.
 *
 * The follower owns the current native `CurvePath`, shares its parent's
 * `Curve2D`, and disconnects both the Path2D and Curve2D observers on release.
 */

import { Container, type PointData } from 'pixi.js';
import { CurvePath, LineCurve, Vector2 as ThreeVector2 } from 'three';
import {
  bindGodotCanvasNode2DApi,
  registerCanvasNodeRelease,
  setPosition,
  setRotation,
} from './node';
import { registerGodotObjectIdentity } from './object';
import { type Vector2, vec2 } from './vector2';
import {
  getPath2DCurve,
  observeGodotCurve2D,
  observeGodotPath2D,
  type GodotCurve2D,
} from './curve-2d';

/** A follower bound to one baked path. */
export interface PathFollow2D {
  /** The node this follower moves — the `PathFollow2D` in the translated tree. */
  readonly node: Container;
  /** `path_follow.offset` — arc length in pixels from the path's start. */
  readonly offset: number;
  /** Total baked length, in pixels. */
  readonly length: number;
  /** Authored `loop`, retained even while the parent curve is empty. */
  readonly loop: boolean;
  /** Godot 3 `rotate` / Godot 4 `rotates`. */
  readonly rotate: boolean;
  /** Authored baked-curve interpolation mode. */
  readonly cubicInterp?: boolean;
  /** Godot 3 tangent lookahead, in pixels. */
  readonly lookahead?: number;
  /** Tangent-space horizontal offset. */
  readonly hOffset: number;
  /** Tangent-space vertical offset. */
  readonly vOffset: number;
  /**
   * `path_follow.offset = value` — `Main.gd:35`.
   *
   * Writes the follower node's `position` and (unless `rotate` was disabled)
   * its `rotation`, so the two reads that follow are ordinary `Node2D`
   * accessors.
   */
  setOffset(value: number): void;
  release?(): void;
}

/** What {@link createPathFollow2D} needs. */
export interface CreatePathFollow2DOptions {
  /** The node whose `position`/`rotation` the follower writes. */
  readonly node: Container;
  /**
   * The baked path, in the PARENT'S coordinate space — the same space the
   * follower's `position` is written in, which is what `Path2D`/`PathFollow2D`
   * parenting means in Godot.
   */
  readonly points: readonly PointData[];
  /** Godot's `loop`. Default true, as in Godot: `offset` wraps past the end. */
  readonly loop?: boolean;
  /** Godot's `rotate`. Default true: `rotation` tracks the path tangent. */
  readonly rotate?: boolean;
  /** Godot's tangent-space horizontal offset. */
  readonly hOffset?: number;
  /** Godot's tangent-space vertical offset. */
  readonly vOffset?: number;
}

/** Where an offset lands, and which way the path points there. */
interface Sample {
  readonly position: Vector2;
  readonly rotation: number;
}

/**
 * Build a follower.
 *
 * @throws if the path has fewer than two points or zero total length. The
 * parent-aware factories below do not call this sampler for an empty curve:
 * Godot leaves the follower's existing transform unchanged until the curve has
 * a nonzero baked length.
 */
export function createPathFollow2D(options: CreatePathFollow2DOptions): PathFollow2D {
  const { node, points } = options;
  if (points.length < 2) {
    throw new Error(
      `godot-compat: PathFollow2D needs at least two baked points, got ${points.length}. A ` +
        'translated Path2D bakes its Curve2D into the polyline it also draws with.',
    );
  }

  const curve = new CurvePath<ThreeVector2>();
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as PointData;
    const b = points[i] as PointData;
    const segment = new LineCurve(new ThreeVector2(a.x, a.y), new ThreeVector2(b.x, b.y));
    // A line's arc length IS its chord — see the module header.
    segment.arcLengthDivisions = 1;
    curve.add(segment);
  }
  // three's own cumulative table, and its last entry.
  const cumulative = curve.getCurveLengths();
  const total = curve.getLength();
  if (total === 0) {
    throw new Error(
      'godot-compat: PathFollow2D was given a zero-length path (every point is the same). ' +
        'Godot parks the follower at the origin; no offset means anything on it.',
    );
  }

  const loop = options.loop !== false;
  const rotate = options.rotate !== false;
  const hOffset = options.hOffset ?? 0;
  const vOffset = options.vOffset ?? 0;

  function sampleAt(rawOffset: number): Sample {
    // Godot's own wrap: `offset` modulo the total length, kept positive. This
    // is what turns `randi()` — a 32-bit integer with no relation to the path —
    // into a point on the border.
    const distance = loop
      ? ((rawOffset % total) + total) % total
      : Math.min(Math.max(rawOffset, 0), total);

    // Position: three's own arc-length lookup over the whole path.
    const point = curve.getPoint(distance / total);

    // Rotation: the tangent of the segment this offset is ON. Godot's own
    // lookahead makes a corner belong to the segment it leaves along, which is
    // the first whose cumulative END exceeds the distance; the last segment
    // owns the far end.
    let index = 0;
    while (index < cumulative.length - 1 && (cumulative[index] as number) <= distance) index += 1;
    const tangent = (curve.curves[index] as LineCurve).getTangent(0);

    const tangentX = tangent.x;
    const tangentY = tangent.y;
    const position = rotate
      ? vec2(point.x + tangentX * hOffset - tangentY * vOffset, point.y + tangentY * hOffset + tangentX * vOffset)
      : vec2(point.x + hOffset, point.y + vOffset);
    return {
      position,
      rotation: Math.atan2(tangent.y, tangent.x),
    };
  }

  let offset = 0;
  const follower: PathFollow2D = {
    node,
    get offset(): number {
      return offset;
    },
    get length(): number {
      return total;
    },
    loop,
    rotate,
    hOffset,
    vOffset,
    setOffset(value): void {
      offset = value;
      const sample = sampleAt(value);
      setPosition(node, sample.position);
      if (rotate) setRotation(node, sample.rotation);
    },
  };

  // Seed the node at offset 0, so a follower read before it is written reports
  // the start of the path rather than wherever the .tscn left the node.
  follower.setOffset(0);
  return follower;
}

/** Bind one PathFollow2D to the shared mutable Curve2D Resource owned by its Path2D parent. */
export function createPathFollow2DFromCurve(options: {
  readonly node: Container;
  readonly curve: GodotCurve2D;
  readonly major?: 3 | 4;
  readonly loop?: boolean;
  readonly rotate?: boolean;
  readonly cubicInterp?: boolean;
  readonly lookahead?: number;
  readonly hOffset?: number;
  readonly vOffset?: number;
}): PathFollow2D {
  let offset = 0;
  let length = 0;
  const loop = options.loop ?? true;
  const rotate = options.rotate ?? true;
  const cubicInterp = options.cubicInterp ?? true;
  const lookahead = options.lookahead ?? 4;
  const hOffset = options.hOffset ?? 0;
  const vOffset = options.vOffset ?? 0;
  const apply = (): void => {
    length = options.curve.get_baked_length();
    // Godot returns before touching either transform component on an empty baked curve.
    if (length === 0) return;
    const position = options.curve.interpolate_baked(offset, cubicInterp);
    if (!rotate) {
      setPosition(options.node, vec2(position.x + hOffset, position.y + vOffset));
      return;
    }
    if (options.major === 4) {
      throw new Error(
        'godot-compat: Godot 4 PathFollow2D.rotates requires Curve2D.sample_baked_with_rotation forward-vector cache semantics.',
      );
    }
    let ahead = offset + lookahead;
    if (loop && ahead >= length && options.curve.get_point_count() > 0) {
      const start = options.curve.get_point_position(0);
      const end = options.curve.get_point_position(options.curve.get_point_count() - 1);
      if (start.x === end.x && start.y === end.y) ahead = ((ahead % length) + length) % length;
    }
    const aheadPosition = options.curve.interpolate_baked(ahead, cubicInterp);
    let tangentX = aheadPosition.x - position.x;
    let tangentY = aheadPosition.y - position.y;
    if (tangentX === 0 && tangentY === 0) {
      const behind = options.curve.interpolate_baked(offset - lookahead, cubicInterp);
      tangentX = position.x - behind.x;
      tangentY = position.y - behind.y;
    }
    const magnitude = Math.hypot(tangentX, tangentY);
    if (magnitude !== 0) {
      tangentX /= magnitude;
      tangentY /= magnitude;
    }
    setPosition(
      options.node,
      vec2(
        position.x + tangentX * hOffset - tangentY * vOffset,
        position.y + tangentY * hOffset + tangentX * vOffset,
      ),
    );
    setRotation(options.node, Math.atan2(tangentY, tangentX));
  };
  const release = observeGodotCurve2D(options.curve, apply);
  apply();
  return {
    node: options.node,
    get offset() { return offset; },
    get length() { return length; },
    loop,
    rotate,
    cubicInterp,
    lookahead,
    hOffset,
    vOffset,
    setOffset(value): void {
      if (!Number.isFinite(value)) throw new TypeError('PathFollow2D.offset must be finite.');
      length = options.curve.get_baked_length();
      if (length > 0) {
        if (loop) {
          offset = ((value % length) + length) % length;
          if (value !== 0 && offset === 0) offset = length;
        } else {
          offset = Math.min(Math.max(value, 0), length);
        }
      } else {
        offset = value;
      }
      apply();
    },
    release,
  };
}

/** Bind a follower to the current Curve2D identity of a retained Path2D. */
export function createPathFollow2DFromPath(options: {
  readonly node: Container;
  readonly path: Container;
  readonly major?: 3 | 4;
  readonly loop?: boolean;
  readonly rotate?: boolean;
  readonly cubicInterp?: boolean;
  readonly lookahead?: number;
  readonly hOffset?: number;
  readonly vOffset?: number;
}): PathFollow2D {
  let offset = 0;
  let current: PathFollow2D | null = null;
  const rebuild = (): void => {
    current?.release?.();
    current = null;
    const curve = getPath2DCurve(options.path);
    if (curve === null) return;
    current = createPathFollow2DFromCurve({
      node: options.node,
      curve,
      ...(options.major === undefined ? {} : { major: options.major }),
      ...(options.loop === undefined ? {} : { loop: options.loop }),
      ...(options.rotate === undefined ? {} : { rotate: options.rotate }),
      ...(options.cubicInterp === undefined ? {} : { cubicInterp: options.cubicInterp }),
      ...(options.lookahead === undefined ? {} : { lookahead: options.lookahead }),
      ...(options.hOffset === undefined ? {} : { hOffset: options.hOffset }),
      ...(options.vOffset === undefined ? {} : { vOffset: options.vOffset }),
    });
    current.setOffset(offset);
    offset = current.offset;
  };
  const releasePath = observeGodotPath2D(options.path, rebuild);
  rebuild();
  return {
    node: options.node,
    get offset() { return offset; },
    get length() { return current?.length ?? 0; },
    loop: options.loop ?? true,
    rotate: options.rotate ?? true,
    cubicInterp: options.cubicInterp ?? true,
    lookahead: options.lookahead ?? 4,
    hOffset: options.hOffset ?? 0,
    vOffset: options.vOffset ?? 0,
    setOffset(value): void {
      if (!Number.isFinite(value)) throw new TypeError('PathFollow2D.offset must be finite.');
      if (current === null) offset = value;
      else {
        current.setOffset(value);
        offset = current.offset;
      }
    },
    release(): void {
      releasePath();
      current?.release?.();
      current = null;
    },
  };
}

/**
 * Bind after the translated Pixi tree has committed, mirroring Godot's
 * enter-tree parent lookup. A PathFollow2D whose parent is not a retained
 * Path2D is an authored hierarchy error and remains loud.
 */
export function createPathFollow2DFromParent(options: {
  readonly node: Container;
  readonly major?: 3 | 4;
  readonly loop?: boolean;
  readonly rotate?: boolean;
  readonly cubicInterp?: boolean;
  readonly lookahead?: number;
  readonly hOffset?: number;
  readonly vOffset?: number;
}): PathFollow2D {
  const path = options.node.parent;
  if (path === null) {
    throw new TypeError('godot-compat: PathFollow2D entered the tree without a Path2D parent.');
  }
  getPath2DCurve(path);
  return createPathFollow2DFromPath({ ...options, path });
}

export interface GodotPathFollow2DOptions {
  readonly path?: Container | null;
  readonly progress?: number;
  readonly progressRatio?: number;
  readonly loop?: boolean;
  readonly rotates?: boolean;
  readonly cubicInterp?: boolean;
  readonly hOffset?: number;
  readonly vOffset?: number;
}

export type GodotPathFollow2D = Container & {
  path: Container | null;
  progress: number;
  progress_ratio: number;
  offset: number;
  unit_offset: number;
  h_offset: number;
  v_offset: number;
  loop: boolean;
  rotates: boolean;
  rotate: boolean;
  cubic_interp: boolean;
  set_progress(value: number): void;
  get_progress(): number;
  set_progress_ratio(value: number): void;
  get_progress_ratio(): number;
  set_h_offset(value: number): void;
  get_h_offset(): number;
  set_v_offset(value: number): void;
  get_v_offset(): number;
  set_loop(value: boolean): void;
  has_loop(): boolean;
  set_rotates(value: boolean): void;
  is_rotating(): boolean;
  set_cubic_interpolation(value: boolean): void;
  get_cubic_interpolation(): boolean;
  set_path(value: Container | null): void;
  get_path(): Container | null;
};

interface NativePathFollow2DState {
  path: Container | null;
  progress: number;
  ratio: number;
  ratioDriven: boolean;
  hOffset: number;
  vOffset: number;
  loop: boolean;
  rotates: boolean;
  cubicInterp: boolean;
  follower: PathFollow2D | null;
  released: boolean;
}

const NATIVE_FOLLOWERS = new WeakMap<GodotPathFollow2D, NativePathFollow2DState>();

function finiteFollowNumber(member: string, value: number): number {
  if (!Number.isFinite(value)) throw new TypeError(`PathFollow2D.${member} must be finite.`);
  return value;
}

function boolFollowValue(member: string, value: boolean): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`PathFollow2D.${member} must be boolean.`);
  return value;
}

function applyNativeFollower(node: GodotPathFollow2D, state: NativePathFollow2DState): void {
  const follower = state.follower;
  if (follower === null) return;
  const distance = state.ratioDriven ? follower.length * state.ratio : state.progress;
  follower.setOffset(distance);
  state.progress = distance;
  state.ratio = follower.length === 0 ? 0 : distance / follower.length;
  node.position.set(node.position.x + state.hOffset, node.position.y + state.vOffset);
}

function rebuildNativeFollower(node: GodotPathFollow2D, state: NativePathFollow2DState): void {
  state.follower?.release?.();
  state.follower = state.path === null
    ? null
    : createPathFollow2DFromPath({
        node,
        path: state.path,
        loop: state.loop,
        rotate: state.rotates,
      });
  applyNativeFollower(node, state);
}

/** Construct a native Godot 3/4 PathFollow2D node over a retained Path2D. */
export function createGodotPathFollow2D(options: GodotPathFollow2DOptions = {}): GodotPathFollow2D {
  const node = bindGodotCanvasNode2DApi(new Container()) as unknown as GodotPathFollow2D;
  const state: NativePathFollow2DState = {
    path: options.path ?? null,
    progress: finiteFollowNumber('progress', options.progress ?? 0),
    ratio: finiteFollowNumber('progress_ratio', options.progressRatio ?? 0),
    ratioDriven: options.progressRatio !== undefined,
    hOffset: finiteFollowNumber('h_offset', options.hOffset ?? 0),
    vOffset: finiteFollowNumber('v_offset', options.vOffset ?? 0),
    loop: options.loop ?? true,
    rotates: options.rotates ?? true,
    cubicInterp: options.cubicInterp ?? true,
    follower: null,
    released: false,
  };
  NATIVE_FOLLOWERS.set(node, state);

  const setProgress = (value: number): void => {
    state.progress = finiteFollowNumber('progress', value);
    state.ratioDriven = false;
    applyNativeFollower(node, state);
  };
  const setRatio = (value: number): void => {
    state.ratio = Math.min(1, Math.max(0, finiteFollowNumber('progress_ratio', value)));
    state.ratioDriven = true;
    applyNativeFollower(node, state);
  };
  const setHOffset = (value: number): void => {
    state.hOffset = finiteFollowNumber('h_offset', value);
    applyNativeFollower(node, state);
  };
  const setVOffset = (value: number): void => {
    state.vOffset = finiteFollowNumber('v_offset', value);
    applyNativeFollower(node, state);
  };
  const setLoop = (value: boolean): void => {
    const next = boolFollowValue('loop', value);
    if (next === state.loop) return;
    state.loop = next;
    rebuildNativeFollower(node, state);
  };
  const setRotates = (value: boolean): void => {
    const next = boolFollowValue('rotates', value);
    if (next === state.rotates) return;
    state.rotates = next;
    if (!next) setRotation(node, 0);
    rebuildNativeFollower(node, state);
  };
  const setCubicInterp = (value: boolean): void => {
    state.cubicInterp = boolFollowValue('cubic_interp', value);
  };
  const setPath = (value: Container | null): void => {
    if (value !== null) getPath2DCurve(value);
    if (value === state.path) return;
    state.path = value;
    rebuildNativeFollower(node, state);
  };

  Object.defineProperties(node, {
    path: { configurable: true, enumerable: true, get: () => state.path, set: setPath },
    progress: { configurable: true, enumerable: true, get: () => state.progress, set: setProgress },
    offset: { configurable: true, enumerable: true, get: () => state.progress, set: setProgress },
    progress_ratio: { configurable: true, enumerable: true, get: () => state.ratio, set: setRatio },
    unit_offset: { configurable: true, enumerable: true, get: () => state.ratio, set: setRatio },
    h_offset: { configurable: true, enumerable: true, get: () => state.hOffset, set: setHOffset },
    v_offset: { configurable: true, enumerable: true, get: () => state.vOffset, set: setVOffset },
    loop: { configurable: true, enumerable: true, get: () => state.loop, set: setLoop },
    rotates: { configurable: true, enumerable: true, get: () => state.rotates, set: setRotates },
    rotate: { configurable: true, enumerable: true, get: () => state.rotates, set: setRotates },
    cubic_interp: { configurable: true, enumerable: true, get: () => state.cubicInterp, set: setCubicInterp },
  });
  Object.assign(node, {
    set_progress: setProgress,
    get_progress: (): number => state.progress,
    set_progress_ratio: setRatio,
    get_progress_ratio: (): number => state.ratio,
    set_h_offset: setHOffset,
    get_h_offset: (): number => state.hOffset,
    set_v_offset: setVOffset,
    get_v_offset: (): number => state.vOffset,
    set_loop: setLoop,
    has_loop: (): boolean => state.loop,
    set_rotates: setRotates,
    is_rotating: (): boolean => state.rotates,
    set_cubic_interpolation: setCubicInterp,
    get_cubic_interpolation: (): boolean => state.cubicInterp,
    set_path: setPath,
    get_path: (): Container | null => state.path,
  });
  registerGodotObjectIdentity(node, 'PathFollow2D');
  registerCanvasNodeRelease(node, () => releaseGodotPathFollow2D(node));
  rebuildNativeFollower(node, state);
  return node;
}

export function releaseGodotPathFollow2D(node: GodotPathFollow2D): void {
  const state = NATIVE_FOLLOWERS.get(node);
  if (state === undefined || state.released) return;
  state.released = true;
  state.follower?.release?.();
  state.follower = null;
  state.path = null;
  NATIVE_FOLLOWERS.delete(node);
}
