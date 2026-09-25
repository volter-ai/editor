/**
 * Selection fallback: eight CORNER BRACKETS on an entity's world AABB.
 *
 * Renderable geometry receives the native silhouette in
 * `selection-outline.ts`. These brackets remain for cameras, lights,
 * audio sources and empty transforms: objects with no pixels for a silhouette
 * effect to find. At each AABB corner, three short arms run back along the
 * box's own edges, preserving an extent cue without drawing a full wire box.
 *
 * Drawn with three's fat-line addons (`LineSegments2` + `LineSegmentsGeometry`
 * + `LineMaterial`) so the stroke is a real screen-space width rather than the
 * driver's 1px `gl.LINES`, which is the other half of why the old box vanished.
 * The screen-space width needs `LineMaterial.resolution`; nothing here or in
 * the viewport sets it, because `LineSegments2.onBeforeRender` already pushes
 * the live renderer viewport into that uniform on every draw. A second writer
 * would only be a stale one.
 *
 * The Bounds DIAGNOSTIC (`helperVisibility.bounds`) deliberately keeps the
 * plain full twelve-edge box on every entity: that view is about density, and
 * brackets on everything would be noise.
 */

import { liveMixerFor } from '@volter/editor-threejs/animation/live-mixers';
import {
  contentBoundsInFrame,
  contentWorldBounds,
} from '@volter/editor-threejs/viewport/content-bounds';
import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

/** Stroke width in CSS pixels (`LineMaterial` screen-space units). */
export const SELECTION_BRACKET_LINEWIDTH = 3;

/**
 * How far the cage stands OFF the entity, as a fraction of each axis extent.
 *
 * Owner ask (2026-08-11): "the corner highlights are exactly ON the model. I
 * frequently do not see it." Drawn on the exact AABB, a bracket on anything
 * box-shaped is coplanar with the surface it is supposed to be marking — it
 * z-fights, it takes the object's own shading, and on a flat face it simply
 * disappears into the edge it lies along. The cage has to float clear of the
 * silhouette to read as a separate thing.
 */
export const BRACKET_STANDOFF_FRACTION = 0.05;

/** World-unit floor for that stand-off, so a tiny prop still gets clearance. */
export const BRACKET_STANDOFF_MIN = 0.03;

/** World-unit ceiling, so a terrain-scale box does not float meters away. */
export const BRACKET_STANDOFF_MAX = 0.6;

/** Arm length as a fraction of that axis's box extent. */
export const BRACKET_ARM_FRACTION = 0.15;

/** World-unit floor, so a small prop still shows a bracket rather than a dot. */
export const BRACKET_ARM_MIN = 0.08;

/** World-unit ceiling, so a terrain-scale box does not draw multi-meter arms. */
export const BRACKET_ARM_MAX = 3;

/**
 * Hard cap as a fraction of the extent. Without it the clamped MIN would make
 * arms from opposite corners meet on a small box — which is a full box outline
 * again, i.e. exactly the shape we are moving away from.
 */
export const BRACKET_ARM_EXTENT_CAP = 0.45;

/**
 * Non-zero floor so a flat box (a ground plane's zero Y extent) still yields a
 * real direction vector. `LineMaterial` normalizes the segment direction, so a
 * genuinely zero-length segment is a NaN in the vertex shader.
 */
const BRACKET_ARM_EPSILON = 1e-3;

/** Eight corners × three arms. */
export const BRACKET_SEGMENT_COUNT = 24;

/** Six floats per segment (start xyz, end xyz). */
const FLOATS_PER_SEGMENT = 6;

/** The eight AABB corners as min(0)/max(1) picks per axis. */
const BOX_CORNERS: readonly (readonly [0 | 1, 0 | 1, 0 | 1])[] = [
  [0, 0, 0],
  [0, 0, 1],
  [0, 1, 0],
  [0, 1, 1],
  [1, 0, 0],
  [1, 0, 1],
  [1, 1, 0],
  [1, 1, 1],
];

/** Arm length for one axis, given that axis's extent of the world AABB. */
export function bracketArmLength(extent: number): number {
  const scaled = THREE.MathUtils.clamp(
    extent * BRACKET_ARM_FRACTION,
    BRACKET_ARM_MIN,
    BRACKET_ARM_MAX,
  );
  return Math.max(Math.min(scaled, extent * BRACKET_ARM_EXTENT_CAP), BRACKET_ARM_EPSILON);
}

/** Clearance for one axis, given that axis's extent of the world AABB. */
export function bracketStandoff(extent: number): number {
  return THREE.MathUtils.clamp(
    extent * BRACKET_STANDOFF_FRACTION,
    BRACKET_STANDOFF_MIN,
    BRACKET_STANDOFF_MAX,
  );
}

/**
 * Write the 24 bracket segments for `box` into `out` (length
 * `BRACKET_SEGMENT_COUNT * 6`). Positions are world-space; the holder object
 * stays at the identity transform.
 */
export function writeBracketSegments(box: THREE.Box3, out: Float32Array, edges = false): void {
  const { min, max } = box;
  // `edges`: every arm runs half its edge, so the arms from opposite corners meet and the cage is
  // the full twelve-edge box (Godot's selection box, `editors/3d/selection_box_color`).
  const arm = (extent: number) => (edges ? Math.max(extent / 2, BRACKET_ARM_EPSILON) : bracketArmLength(extent));
  const ax = arm(max.x - min.x);
  const ay = arm(max.y - min.y);
  const az = arm(max.z - min.z);

  let i = 0;
  for (const [cx, cy, cz] of BOX_CORNERS) {
    const x = cx === 0 ? min.x : max.x;
    const y = cy === 0 ? min.y : max.y;
    const z = cz === 0 ? min.z : max.z;
    // Arms run INWARD along their edge, so a bracket always sits on the box
    // rather than sticking out past the corner.
    const dx = cx === 0 ? ax : -ax;
    const dy = cy === 0 ? ay : -ay;
    const dz = cz === 0 ? az : -az;
    // X arm
    out[i++] = x;
    out[i++] = y;
    out[i++] = z;
    out[i++] = x + dx;
    out[i++] = y;
    out[i++] = z;
    // Y arm
    out[i++] = x;
    out[i++] = y;
    out[i++] = z;
    out[i++] = x;
    out[i++] = y + dy;
    out[i++] = z;
    // Z arm
    out[i++] = x;
    out[i++] = y;
    out[i++] = z;
    out[i++] = x;
    out[i++] = y;
    out[i++] = z + dz;
  }
}

export interface SelectionBracketsOptions {
  /** Renderer-ready current palette accent. */
  readonly color: number;
  /** Draw the full box instead of corner brackets (the look's `density.viewport.selectionBox`). */
  readonly edges?: boolean;
  /** Stroke width in CSS px; the editor's own is {@link SELECTION_BRACKET_LINEWIDTH}. */
  readonly lineWidth?: number;
  /** Measure the box along the world's axes (the editor's own, Unity's bounds) or the object's
   *  own, so it turns with the object (Godot's) — `density.viewport.selectionBoxFrame`. */
  readonly frame?: 'world' | 'object';
  /**
   * Edge length of a fixed-size cube centered on the entity's world position,
   * used instead of a computed AABB. This is the degenerate-geometry path —
   * cameras, lights and audio sources own no renderable geometry, so the bounds
   * walk returns an empty or meaningless box.
   */
  readonly fixedSize?: number;
}

/**
 * Corner brackets for one entity, recomputed in place when its bounds are
 * invalidated.
 *
 * A bounds refresh costs one `contentWorldBounds` walk plus 144 writes into the
 * already-allocated instance buffer. Static selections retain that result;
 * root motion and vertex animation invalidate it. Nothing reallocates after
 * construction.
 */
export class SelectionBrackets extends LineSegments2 {
  /** The entity object this bracket set is glued to. */
  readonly entityObject: THREE.Object3D;

  private readonly _fixedSize: number | undefined;
  private readonly _edges: boolean;
  private readonly _objectFrame: boolean;
  private readonly _toObject = new THREE.Matrix4();
  private readonly _point = new THREE.Vector3();
  private readonly _axisX = new THREE.Vector3();
  private readonly _axisY = new THREE.Vector3();
  private readonly _axisZ = new THREE.Vector3();
  private readonly _scale = new THREE.Vector3();
  private readonly _positions = new Float32Array(BRACKET_SEGMENT_COUNT * FLOATS_PER_SEGMENT);
  private readonly _box = new THREE.Box3();
  private readonly _worldPos = new THREE.Vector3();
  private readonly _fixedExtent = new THREE.Vector3();
  private readonly _standoff = new THREE.Vector3();
  private readonly _lastRootMatrix = new Float32Array(16);
  private readonly _requiresContinuousBounds: boolean;

  constructor(entityObject: THREE.Object3D, options: SelectionBracketsOptions) {
    const geometry = new LineSegmentsGeometry();
    const material = new LineMaterial({
      color: options.color,
      linewidth: options.lineWidth ?? SELECTION_BRACKET_LINEWIDTH,
      // Screen-space width: a bracket must read the same on a 0.2m prop and a
      // 200m terrain chunk.
      worldUnits: false,
      alphaToCoverage: true,
      toneMapped: false,
      // DRAW THROUGH. A depth-tested cage is hidden by the very object it
      // marks the moment the two touch, and by anything standing in front of
      // it — so the one question this shape exists to answer, "where is my
      // selection", goes unanswered exactly when the scene is busy enough for
      // the reader to be asking. Selection is chrome about the scene, not
      // geometry in it, and chrome is never occluded.
      depthTest: false,
      depthWrite: false,
    });
    super(geometry, material);
    this.entityObject = entityObject;
    this._fixedSize = options.fixedSize;
    this._edges = options.edges === true;
    this._objectFrame = options.frame === 'object';
    // A static hierarchy's world bounds do not change because the camera did.
    // Detect the cases whose vertices can move without an editor transform
    // notification; those keep the old every-frame bounds refresh. Ordinary
    // terrain/building groups instead refresh only when their root transform
    // changes (and `_syncBoxHelpers` reconstructs them after source/store
    // changes), avoiding one recursive Box3 walk per selected subtree per RAF.
    let requiresContinuousBounds = false;
    entityObject.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (
        (child as THREE.SkinnedMesh).isSkinnedMesh ||
        (Array.isArray(mesh.morphTargetInfluences) && mesh.morphTargetInfluences.length > 0) ||
        // A mixer the game's own code made animates it (the served animation stamp,
        // `@volter/editor-threejs/animation/live-mixers`).
        liveMixerFor(child) !== null
      ) {
        requiresContinuousBounds = true;
      }
    });
    this._requiresContinuousBounds = requiresContinuousBounds;
    // Drawn after the scene so the un-depth-tested cage lands on top of it.
    // Left below the transform gizmo, which owns the foreground while a drag
    // is live.
    this.renderOrder = 1;
    // Positions are world-space and may be rewritten immediately before a
    // draw, so the geometry's own bounds can be stale; culling 24 instanced
    // quads buys nothing worth that risk.
    this.frustumCulled = false;
    geometry.setPositions(this._positions);
    this.update();
  }

  setColor(color: number): void {
    (this.material as LineMaterial).color.setHex(color);
  }

  /**
   * Cheap RAF path. Static selected subtrees retain their already-computed
   * world AABB until their root moves; animated vertex data still refreshes
   * continuously. Call {@link update} to force a refresh after an out-of-band
   * descendant mutation.
   */
  updateIfNeeded(): void {
    this.entityObject.updateWorldMatrix(true, false);
    const matrix = this.entityObject.matrixWorld.elements;
    let rootChanged = false;
    for (let index = 0; index < matrix.length; index++) {
      if (matrix[index] !== this._lastRootMatrix[index]) {
        rootChanged = true;
        break;
      }
    }
    if (rootChanged || this._requiresContinuousBounds) this.update();
  }

  /** Recompute the AABB and reposition the arms. Safe to call every frame. */
  update(): void {
    this.entityObject.updateWorldMatrix(true, false);
    // A frame with a zero axis cannot be inverted: such an object is boxed along the world's.
    const objectFrame =
      this._objectFrame &&
      this._fixedSize === undefined &&
      Math.abs(this.entityObject.matrixWorld.determinant()) > 1e-30;
    this.entityObject.matrixWorld.extractBasis(this._axisX, this._axisY, this._axisZ);
    const scale = objectFrame
      ? this._scale.set(this._axisX.length(), this._axisY.length(), this._axisZ.length())
      : this._scale.set(1, 1, 1);
    if (this._fixedSize !== undefined) {
      this.entityObject.getWorldPosition(this._worldPos);
      this._fixedExtent.setScalar(this._fixedSize);
      this._box.setFromCenterAndSize(this._worldPos, this._fixedExtent);
    } else {
      // Content only — a built-internal child (a world-space particle renderer
      // at identity, a pooled batch) would otherwise drag the cage off to
      // wherever its machinery lives. See `content-bounds.ts`.
      if (objectFrame) {
        this._toObject.copy(this.entityObject.matrixWorld).invert();
        contentBoundsInFrame(this.entityObject, this._toObject, this._box);
      } else {
        contentWorldBounds(this.entityObject, this._box);
      }
      if (this._box.isEmpty()) return;
    }
    // Stand the cage off the silhouette. Per-axis, so a flat object (a ground
    // plane, a wall panel) gains real clearance on the axis it has no extent
    // in rather than staying welded to its own face.
    // The stand-off is a WORLD distance; a box in the object's frame is measured in the object's
    // units, so it is taken through the object's scale on each axis and back.
    this._box.getSize(this._standoff).multiply(scale);
    this._standoff.set(
      bracketStandoff(this._standoff.x),
      bracketStandoff(this._standoff.y),
      bracketStandoff(this._standoff.z),
    ).divide(scale);
    this._box.expandByVector(this._standoff);
    writeBracketSegments(this._box, this._positions, this._edges);
    // A box in the object's frame is written there and carried out to the world by the object.
    if (objectFrame) {
      const matrix = this.entityObject.matrixWorld;
      for (let index = 0; index < this._positions.length; index += 3) {
        this._point
          .set(this._positions[index]!, this._positions[index + 1]!, this._positions[index + 2]!)
          .applyMatrix4(matrix);
        this._positions[index] = this._point.x;
        this._positions[index + 1] = this._point.y;
        this._positions[index + 2] = this._point.z;
      }
    }
    const start = this.geometry.getAttribute('instanceStart');
    // Both instanceStart and instanceEnd are views onto the one interleaved
    // buffer that owns `_positions`; flagging either one uploads all of it.
    if (start) (start as THREE.InterleavedBufferAttribute).data.needsUpdate = true;
    this._lastRootMatrix.set(this.entityObject.matrixWorld.elements);
  }

  /** Release GPU resources. Mirrors the viewport's BoxHelper dispose path. */
  dispose(): void {
    this.geometry.dispose();
    (this.material as LineMaterial).dispose();
  }
}
