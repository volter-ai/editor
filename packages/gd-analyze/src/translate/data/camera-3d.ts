/**
 * translate/data/camera-3d.ts — a `.tscn` Camera / Camera3D as a {@link Camera3DSpec}.
 *
 * Projection, keep-aspect, and the authored fov/size are meaning. Emit prints three's camera
 * constructor args from this spec.
 */
import type { GodotValue } from '../../read/godot-value';
import { TranslateError } from './model';

export const PROJECTION_PERSPECTIVE = 0;
export const PROJECTION_ORTHOGONAL = 1;
export const CAMERA_KEEP_WIDTH = 0;
export const CAMERA_KEEP_HEIGHT = 1;
export const GODOT_CAMERA_NEAR = 0.05;
export const GODOT3_CAMERA_FAR = 100;
export const GODOT3_CAMERA_FOV = 70;
export const GODOT4_CAMERA_FAR = 4000;
export const GODOT4_CAMERA_FOV = 75;
/** Backwards-compatible Godot 3 aliases retained by scene-module-3d's public data contract. */
export const GODOT_CAMERA_FAR = GODOT3_CAMERA_FAR;
export const GODOT_CAMERA_FOV = GODOT3_CAMERA_FOV;

export type Camera3DSpec =
  | {
      readonly kind: 'perspective';
      readonly keepWidth: boolean;
      readonly verticalFov: number;
      readonly near: number;
      readonly far: number;
    }
  | {
      readonly kind: 'orthographic';
      readonly keepWidth: boolean;
      readonly halfWidth: number;
      readonly halfHeight: number;
      readonly near: number;
      readonly far: number;
    };

function authoredNumber(
  at: string,
  props: Readonly<Record<string, GodotValue>>,
  name: string,
  fallback: number,
): number {
  const value = props[name];
  if (value === undefined) return fallback;
  if (value.kind === 'number' && Number.isFinite(value.value)) return value.value;
  throw new TranslateError(
    at,
    `Camera3D.${name} is authored as ${value.kind}, but Godot requires a finite number. ` +
      'Translation refuses instead of replacing an authored malformed value with the default.',
  );
}

export function readCamera3D(
  at: string,
  props: Readonly<Record<string, GodotValue>>,
  aspect: number,
  major: 3 | 4,
): Camera3DSpec {
  const kind = authoredNumber(at, props, 'projection', PROJECTION_PERSPECTIVE);
  const near = authoredNumber(at, props, 'near', GODOT_CAMERA_NEAR);
  const far = authoredNumber(at, props, 'far', major === 4 ? GODOT4_CAMERA_FAR : GODOT3_CAMERA_FAR);
  const keep = authoredNumber(at, props, 'keep_aspect', CAMERA_KEEP_HEIGHT);
  if (keep !== CAMERA_KEEP_HEIGHT && keep !== CAMERA_KEEP_WIDTH) {
    throw new TranslateError(
      at,
      `\`keep_aspect = ${keep}\`. Godot 3 has KEEP_WIDTH (0) and KEEP_HEIGHT (1) and ` +
        'nothing else, so there is no frustum this could mean; a silently ignored value would ' +
        'render a plausibly wrong field of view.',
    );
  }
  const keepWidth = keep === CAMERA_KEEP_WIDTH;
  if (kind === PROJECTION_ORTHOGONAL) {
    const authored = authoredNumber(at, props, 'size', 1);
    const halfHeight = keepWidth ? authored / (2 * aspect) : authored / 2;
    return {
      kind: 'orthographic',
      keepWidth,
      halfWidth: halfHeight * aspect,
      halfHeight,
      near,
      far,
    };
  }
  if (kind === PROJECTION_PERSPECTIVE) {
    const authored = authoredNumber(
      at,
      props,
      'fov',
      major === 4 ? GODOT4_CAMERA_FOV : GODOT3_CAMERA_FOV,
    );
    const vertical = keepWidth
      ? (2 * Math.atan(Math.tan((authored * Math.PI) / 360) / aspect) * 180) / Math.PI
      : authored;
    return { kind: 'perspective', keepWidth, verticalFov: vertical, near, far };
  }
  throw new TranslateError(
    at,
    `\`projection = ${kind}\`. Godot 3 has PERSPECTIVE (0), ORTHOGONAL (1) and FRUSTUM ` +
      '(2); the third is an off-axis frustum three has no constructor for, so it refuses ' +
      'rather than rendering a centred one that looks nearly right.',
  );
}
