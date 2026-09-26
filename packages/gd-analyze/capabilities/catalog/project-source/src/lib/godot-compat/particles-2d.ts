/**
 * Godot 3 `Particles2D` / Godot 4 `GPUParticles2D` on one retained Pixi `Container` identity.
 *
 * The scene emitter serializes authored values and an authored-child factory. This module owns
 * allocation, stepping, dynamic property mutation, duplication and release. Renderer-owned
 * particle batches are never mistaken for Godot children by `Node.duplicate()`. Immutable Pixi
 * textures are borrowed; releasing an emitter never destroys them.
 */

import { Container, Particle, ParticleContainer, Rectangle, Texture } from 'pixi.js';
import {
  authoredCanvasChildren,
  GODOT_3_DUPLICATE_DEFAULT,
  markInternalCanvasChild,
  registerCanvasNodeDuplicateFactory,
  registerCanvasNodeRelease,
  releaseCanvasNodeBinding,
} from './node';
import { godotCanvasTransform2D } from './physics-2d';
import { registerGodotObjectIdentity } from './object';
import { bindGodotMaterial, duplicateGodotMaterial } from './material';
import { GodotGradient } from './gradient';
import { GodotCurve } from './curve';
import type { GodotCurveTexture, GodotGradientTexture1D } from './procedural-textures';
import { godotResourceEmitChanged } from './resource-io';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import {
  registerCanvasItemParticleMaterialConsumer,
  releaseCanvasItemMaterial,
  type GodotCanvasItemMaterialState,
} from './canvas-item-material';

export interface ParticleCurvePoint {
  readonly offset: number;
  readonly value: number;
  readonly leftTangent: number;
  readonly rightTangent: number;
}

export interface ParticleGradientStop {
  readonly offset: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface ParticleColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export type ParticleCurveResource =
  | readonly ParticleCurvePoint[]
  | GodotCurve
  | GodotCurveTexture;
export type ParticleGradientResource =
  | readonly ParticleGradientStop[]
  | GodotGradient
  | GodotGradientTexture1D;

function isCurveTexture(value: ParticleCurveResource): value is GodotCurveTexture {
  return !Array.isArray(value) && !(value instanceof GodotCurve) &&
    typeof (value as GodotCurveTexture).get_curve === 'function';
}

function isGradientTexture(value: ParticleGradientResource): value is GodotGradientTexture1D {
  return !Array.isArray(value) && !(value instanceof GodotGradient) &&
    typeof (value as GodotGradientTexture1D).get_gradient === 'function';
}

/** Mutable Resource state stored independently by `ParticlesMaterial.duplicate()`. */
export interface GodotParticlesMaterial2D {
  color: ParticleColor;
  direction_angle: number;
  spread: number;
  gravity: { x: number; y: number; z: number };
  initial_velocity: number;
  initial_velocity_random: number;
  /** Godot 4 range spellings, projected exactly onto the same max/random simulation state. */
  initial_velocity_min: number;
  initial_velocity_max: number;
  angle_min: number;
  angle_max: number;
  angular_velocity_min: number;
  angular_velocity_max: number;
  orbit_velocity_min: number;
  orbit_velocity_max: number;
  linear_accel_min: number;
  linear_accel_max: number;
  radial_accel_min: number;
  radial_accel_max: number;
  tangential_accel_min: number;
  tangential_accel_max: number;
  damping_min: number;
  damping_max: number;
  hue_variation_min: number;
  hue_variation_max: number;
  anim_speed_min: number;
  anim_speed_max: number;
  anim_offset_min: number;
  anim_offset_max: number;
  scale_min: number;
  scale_max: number;
  /** Godot 3 base scale; the retained random range remains `[scale * (1-random), scale]`. */
  scale: number;
  lifetime_randomness: number;
  particle_flag_align_y: boolean;
  particle_flag_disable_z: boolean;
  emission_shape: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  emission_shape_offset: { x: number; y: number; z: number };
  emission_shape_scale: { x: number; y: number; z: number };
  emission_sphere_radius: number;
  emission_box_extents: { x: number; y: number; z: number };
  emission_ring_inner_radius: number;
  emission_ring_radius: number;
  scale_curve?: ParticleCurveResource;
  angle_curve?: ParticleCurveResource;
  angular_velocity_curve?: ParticleCurveResource;
  orbit_velocity_curve?: ParticleCurveResource;
  linear_accel_curve?: ParticleCurveResource;
  radial_accel_curve?: ParticleCurveResource;
  tangential_accel_curve?: ParticleCurveResource;
  damping_curve?: ParticleCurveResource;
  hue_variation_curve?: ParticleCurveResource;
  anim_speed_curve?: ParticleCurveResource;
  anim_offset_curve?: ParticleCurveResource;
  color_ramp?: ParticleGradientResource;
  color_initial_ramp?: ParticleGradientResource;
  alpha_curve?: ParticleCurveResource;
  tint: number;
  alpha: number;
  duplicate(deep?: boolean): GodotParticlesMaterial2D;
}

export interface ParticlesMaterial2DOptions {
  readonly godotMajor?: 3 | 4;
  readonly directionAngle?: number;
  readonly spread?: number;
  readonly gravity?: { readonly x: number; readonly y: number; readonly z?: number };
  readonly initialVelocity?: number;
  readonly initialVelocityRandom?: number;
  readonly angleMin?: number;
  readonly angleMax?: number;
  readonly angularVelocityMin?: number;
  readonly angularVelocityMax?: number;
  readonly orbitVelocityMin?: number;
  readonly orbitVelocityMax?: number;
  readonly linearAccelMin?: number;
  readonly linearAccelMax?: number;
  readonly radialAccelMin?: number;
  readonly radialAccelMax?: number;
  readonly tangentialAccelMin?: number;
  readonly tangentialAccelMax?: number;
  readonly dampingMin?: number;
  readonly dampingMax?: number;
  readonly hueVariationMin?: number;
  readonly hueVariationMax?: number;
  readonly animSpeedMin?: number;
  readonly animSpeedMax?: number;
  readonly animOffsetMin?: number;
  readonly animOffsetMax?: number;
  readonly scaleMin?: number;
  readonly scaleMax?: number;
  readonly lifetimeRandomness?: number;
  readonly alignY?: boolean;
  readonly disableZ?: boolean;
  readonly emissionShape?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  readonly emissionShapeOffset?: { readonly x: number; readonly y: number; readonly z: number };
  readonly emissionShapeScale?: { readonly x: number; readonly y: number; readonly z: number };
  readonly emissionSphereRadius?: number;
  readonly emissionBoxExtents?: { readonly x: number; readonly y: number; readonly z: number };
  readonly emissionRingInnerRadius?: number;
  readonly emissionRingRadius?: number;
  readonly scaleCurve?: ParticleCurveResource;
  readonly angleCurve?: ParticleCurveResource;
  readonly angularVelocityCurve?: ParticleCurveResource;
  readonly orbitVelocityCurve?: ParticleCurveResource;
  readonly linearAccelCurve?: ParticleCurveResource;
  readonly radialAccelCurve?: ParticleCurveResource;
  readonly tangentialAccelCurve?: ParticleCurveResource;
  readonly dampingCurve?: ParticleCurveResource;
  readonly hueVariationCurve?: ParticleCurveResource;
  readonly animSpeedCurve?: ParticleCurveResource;
  readonly animOffsetCurve?: ParticleCurveResource;
  readonly colorRamp?: ParticleGradientResource;
  readonly colorInitialRamp?: ParticleGradientResource;
  readonly alphaCurve?: ParticleCurveResource;
  readonly color?: ParticleColor;
  readonly tint?: number;
  readonly alpha?: number;
}

function copyCurve(
  curve: ParticleCurveResource | undefined,
): ParticleCurveResource | undefined {
  return curve === undefined || curve instanceof GodotCurve || isCurveTexture(curve)
    ? curve
    : curve.map((point) => ({ ...point }));
}

function copyGradient(
  gradient: ParticleGradientResource | undefined,
): ParticleGradientResource | undefined {
  return gradient === undefined || gradient instanceof GodotGradient || isGradientTexture(gradient)
    ? gradient
    : gradient.map((stop) => ({ ...stop }));
}

const PARTICLE_MATERIALS = new WeakSet<object>();
const PARTICLE_MATERIAL_MAJORS = new WeakMap<object, 3 | 4>();

function finiteMaterialNumber(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new Error(`ParticlesMaterial.${name} must be finite`);
  return value;
}

function nonNegativeMaterialNumber(name: string, value: number): number {
  value = finiteMaterialNumber(name, value);
  if (value < 0) throw new Error(`ParticlesMaterial.${name} must be non-negative`);
  return value;
}

function unitMaterialNumber(name: string, value: number): number {
  value = finiteMaterialNumber(name, value);
  if (value < 0 || value > 1) throw new Error(`ParticlesMaterial.${name} must be within [0, 1]`);
  return value;
}

function orderedRange(name: string, min: number, max: number): readonly [number, number] {
  min = finiteMaterialNumber(`${name}_min`, min);
  max = finiteMaterialNumber(`${name}_max`, max);
  if (min > max) throw new Error(`ParticlesMaterial.${name}_min cannot exceed ${name}_max`);
  return [min, max];
}

function booleanParticleProperty(name: string, value: boolean): boolean {
  if (typeof value !== 'boolean') throw new Error(`Particles2D.${name} must be boolean`);
  return value;
}

function validateCurve(curve: ParticleCurveResource): ParticleCurveResource {
  if (curve instanceof GodotCurve || isCurveTexture(curve)) return curve;
  let previous = Number.NEGATIVE_INFINITY;
  for (const point of curve) {
    finiteMaterialNumber('scale_curve.offset', point.offset);
    finiteMaterialNumber('scale_curve.value', point.value);
    finiteMaterialNumber('scale_curve.left_tangent', point.leftTangent);
    finiteMaterialNumber('scale_curve.right_tangent', point.rightTangent);
    if (point.offset < previous) {
      throw new Error('ParticlesMaterial.scale_curve points must be ordered by offset');
    }
    previous = point.offset;
  }
  return curve;
}

function validateGradient(
  gradient: ParticleGradientResource,
): ParticleGradientResource {
  if (gradient instanceof GodotGradient || isGradientTexture(gradient)) return gradient;
  let previous = Number.NEGATIVE_INFINITY;
  for (const stop of gradient) {
    unitMaterialNumber('color_ramp.offset', stop.offset);
    unitMaterialNumber('color_ramp.r', stop.r);
    unitMaterialNumber('color_ramp.g', stop.g);
    unitMaterialNumber('color_ramp.b', stop.b);
    unitMaterialNumber('color_ramp.a', stop.a);
    if (stop.offset < previous) {
      throw new Error('ParticlesMaterial.color_ramp stops must be ordered by offset');
    }
    previous = stop.offset;
  }
  return gradient;
}

function materialVector2(
  name: string,
  value: { readonly x: number; readonly y: number },
): { x: number; y: number } {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`ParticlesMaterial.${name} must be a Vector2 value`);
  }
  return {
    x: finiteMaterialNumber(`${name}.x`, value.x),
    y: finiteMaterialNumber(`${name}.y`, value.y),
  };
}

function materialVector3(
  name: string,
  value: { readonly x: number; readonly y: number; readonly z: number },
): { x: number; y: number; z: number } {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`ParticlesMaterial.${name} must be a Vector3 value`);
  }
  return {
    x: nonNegativeMaterialNumber(`${name}.x`, value.x),
    y: nonNegativeMaterialNumber(`${name}.y`, value.y),
    z: nonNegativeMaterialNumber(`${name}.z`, value.z),
  };
}

function materialGravity(
  value: { readonly x: number; readonly y: number; readonly z?: number },
): { x: number; y: number; z: number } {
  if (typeof value !== 'object' || value === null) {
    throw new Error('ParticlesMaterial.gravity must be a Vector3 value');
  }
  return {
    x: finiteMaterialNumber('gravity.x', value.x),
    y: finiteMaterialNumber('gravity.y', value.y),
    z: finiteMaterialNumber('gravity.z', value.z ?? 0),
  };
}

function materialColor(value: ParticleColor): ParticleColor {
  if (typeof value !== 'object' || value === null ||
      ![value.r, value.g, value.b, value.a].every((channel) => Number.isFinite(channel))) {
    throw new TypeError('ParticleProcessMaterial.color requires finite Color channels.');
  }
  return { r: value.r, g: value.g, b: value.b, a: value.a };
}

/** Construct one source Resource identity. No renderer object is hidden behind it. */
function materialFromOptions(
  options: ParticlesMaterial2DOptions = {},
  copySubresources: boolean,
): GodotParticlesMaterial2D {
  const godotMajor = options.godotMajor ?? 3;
  let directionAngle = finiteMaterialNumber('direction_angle', options.directionAngle ?? 0);
  let spread = nonNegativeMaterialNumber('spread', options.spread ?? Math.PI / 4);
  if (spread > Math.PI) throw new Error('ParticlesMaterial.spread must be at most PI radians');
  let gravity = materialGravity(options.gravity ?? { x: 0, y: 98, z: 0 });
  let initialVelocity = nonNegativeMaterialNumber(
    'initial_velocity',
    options.initialVelocity ?? 0,
  );
  let initialVelocityRandom = unitMaterialNumber(
    'initial_velocity_random',
    options.initialVelocityRandom ?? 0,
  );
  let [angleMin, angleMax] = orderedRange('angle', options.angleMin ?? 0, options.angleMax ?? 0);
  let [angularVelocityMin, angularVelocityMax] = orderedRange(
    'angular_velocity', options.angularVelocityMin ?? 0, options.angularVelocityMax ?? 0,
  );
  let [orbitVelocityMin, orbitVelocityMax] = orderedRange(
    'orbit_velocity', options.orbitVelocityMin ?? 0, options.orbitVelocityMax ?? 0,
  );
  let [linearAccelMin, linearAccelMax] = orderedRange(
    'linear_accel', options.linearAccelMin ?? 0, options.linearAccelMax ?? 0,
  );
  let [radialAccelMin, radialAccelMax] = orderedRange(
    'radial_accel', options.radialAccelMin ?? 0, options.radialAccelMax ?? 0,
  );
  let [tangentialAccelMin, tangentialAccelMax] = orderedRange(
    'tangential_accel', options.tangentialAccelMin ?? 0, options.tangentialAccelMax ?? 0,
  );
  let [dampingMin, dampingMax] = orderedRange(
    'damping', options.dampingMin ?? 0, options.dampingMax ?? 0,
  );
  if (dampingMin < 0) throw new Error('ParticlesMaterial.damping_min must be non-negative');
  let [hueVariationMin, hueVariationMax] = orderedRange(
    'hue_variation', options.hueVariationMin ?? 0, options.hueVariationMax ?? 0,
  );
  if (hueVariationMin < -1 || hueVariationMax > 1) {
    throw new Error('ParticlesMaterial hue variation range must stay within [-1, 1]');
  }
  let [animSpeedMin, animSpeedMax] = orderedRange(
    'anim_speed', options.animSpeedMin ?? 0, options.animSpeedMax ?? 0,
  );
  let [animOffsetMin, animOffsetMax] = orderedRange(
    'anim_offset', options.animOffsetMin ?? 0, options.animOffsetMax ?? 0,
  );
  let scaleMin = nonNegativeMaterialNumber('scale_min', options.scaleMin ?? 1);
  let scaleMax = nonNegativeMaterialNumber('scale_max', options.scaleMax ?? 1);
  if (scaleMin > scaleMax) throw new Error('ParticlesMaterial.scale_min cannot exceed scale_max');
  const legacyScaleRandom = scaleMax === 0 ? 0 : 1 - scaleMin / scaleMax;
  let lifetimeRandomness = unitMaterialNumber(
    'lifetime_randomness', options.lifetimeRandomness ?? 0,
  );
  let alignY = booleanParticleProperty('particle_flag_align_y', options.alignY ?? false);
  let disableZ = booleanParticleProperty('particle_flag_disable_z', options.disableZ ?? true);
  if (!disableZ) {
    throw new Error(
      'ParticleProcessMaterial.particle_flag_disable_z=false cannot be projected onto a flat Pixi surface.',
    );
  }
  let emissionShape = options.emissionShape ?? 0;
  if (!Number.isSafeInteger(emissionShape) || emissionShape < 0 || emissionShape > 6) {
    throw new Error(`ParticlesMaterial.emission_shape ${emissionShape} is outside [0, 6]`);
  }
  let emissionSphereRadius = nonNegativeMaterialNumber(
    'emission_sphere_radius',
    options.emissionSphereRadius ?? 1,
  );
  let emissionBoxExtents = materialVector3(
    'emission_box_extents',
    options.emissionBoxExtents ?? { x: 1, y: 1, z: 1 },
  );
  let emissionShapeOffset = materialGravity(
    options.emissionShapeOffset ?? { x: 0, y: 0, z: 0 },
  );
  let emissionShapeScale = materialVector3(
    'emission_shape_scale', options.emissionShapeScale ?? { x: 1, y: 1, z: 1 },
  );
  let emissionRingInnerRadius = nonNegativeMaterialNumber(
    'emission_ring_inner_radius',
    options.emissionRingInnerRadius ?? 0,
  );
  let emissionRingRadius = nonNegativeMaterialNumber(
    'emission_ring_radius',
    options.emissionRingRadius ?? 1,
  );
  if (emissionRingInnerRadius > emissionRingRadius) {
    throw new Error('ParticlesMaterial.emission_ring_inner_radius cannot exceed ring radius');
  }
  let tint = options.tint ?? 0xffffff;
  if (!Number.isInteger(tint) || tint < 0 || tint > 0xffffff) {
    throw new Error('ParticlesMaterial.tint must be an RGB24 integer');
  }
  let alpha = unitMaterialNumber('alpha', options.alpha ?? 1);
  let color = materialColor(options.color ?? {
    r: ((tint >>> 16) & 0xff) / 255,
    g: ((tint >>> 8) & 0xff) / 255,
    b: (tint & 0xff) / 255,
    a: alpha,
  });
  let scaleCurve =
    options.scaleCurve === undefined
      ? undefined
      : validateCurve(
          copySubresources ? (copyCurve(options.scaleCurve) ?? []) : options.scaleCurve,
        );
  const curves = Object.fromEntries(
    ([
      ['angle_curve', options.angleCurve],
      ['angular_velocity_curve', options.angularVelocityCurve],
      ['orbit_velocity_curve', options.orbitVelocityCurve],
      ['linear_accel_curve', options.linearAccelCurve],
      ['radial_accel_curve', options.radialAccelCurve],
      ['tangential_accel_curve', options.tangentialAccelCurve],
      ['damping_curve', options.dampingCurve],
      ['hue_variation_curve', options.hueVariationCurve],
      ['anim_speed_curve', options.animSpeedCurve],
      ['anim_offset_curve', options.animOffsetCurve],
    ] as const).flatMap(([name, curve]) => curve === undefined
      ? []
      : [[name, validateCurve(copySubresources ? (copyCurve(curve) ?? []) : curve)]]),
  ) as Record<string, ParticleCurveResource>;
  let colorRamp =
    options.colorRamp === undefined
      ? undefined
      : validateGradient(
          copySubresources ? (copyGradient(options.colorRamp) ?? []) : options.colorRamp,
        );
  let colorInitialRamp = options.colorInitialRamp === undefined
    ? undefined
    : validateGradient(
        copySubresources ? (copyGradient(options.colorInitialRamp) ?? []) : options.colorInitialRamp,
      );
  let alphaCurve = options.alphaCurve === undefined
    ? undefined
    : validateCurve(
        copySubresources ? (copyCurve(options.alphaCurve) ?? []) : options.alphaCurve,
      );
  const material = {
    duplicate: (deep = false) => duplicateParticlesMaterial2D(material, deep),
  } as GodotParticlesMaterial2D;
  const property = <T>(name: string, get: () => T, set: (value: T) => void): void => {
    Object.defineProperty(material, name, {
      enumerable: true,
      get,
      set(value: T) {
        set(value);
        godotResourceEmitChanged(material);
      },
    });
  };
  property('direction_angle', () => directionAngle, (value) => {
    directionAngle = finiteMaterialNumber('direction_angle', value);
  });
  property('spread', () => spread, (value) => {
    spread = nonNegativeMaterialNumber('spread', value);
    if (spread > Math.PI) throw new Error('ParticlesMaterial.spread must be at most PI radians');
  });
  property('gravity', () => ({ ...gravity }), (value) => {
    gravity = materialGravity(value);
  });
  property('initial_velocity', () => initialVelocity, (value) => {
    initialVelocity = nonNegativeMaterialNumber('initial_velocity', value);
  });
  property('initial_velocity_random', () => initialVelocityRandom, (value) => {
    initialVelocityRandom = unitMaterialNumber('initial_velocity_random', value);
  });
  property('initial_velocity_min', () => initialVelocity * (1 - initialVelocityRandom), (value) => {
    const next = nonNegativeMaterialNumber('initial_velocity_min', value);
    if (next > initialVelocity) initialVelocity = next;
    initialVelocityRandom = initialVelocity === 0 ? 0 : 1 - next / initialVelocity;
  });
  property('initial_velocity_max', () => initialVelocity, (value) => {
    const next = nonNegativeMaterialNumber('initial_velocity_max', value);
    const previousMin = initialVelocity * (1 - initialVelocityRandom);
    initialVelocity = next;
    initialVelocityRandom = next === 0 ? 0 : 1 - Math.min(previousMin, next) / next;
  });
  const range = (
    name: string,
    getMin: () => number,
    setMin: (value: number) => void,
    getMax: () => number,
    setMax: (value: number) => void,
  ): void => {
    property(`${name}_min`, getMin, setMin);
    property(`${name}_max`, getMax, setMax);
  };
  range('angle', () => angleMin, (value) => {
    angleMin = finiteMaterialNumber('angle_min', value);
    if (angleMin > angleMax) angleMax = angleMin;
  }, () => angleMax, (value) => {
    angleMax = finiteMaterialNumber('angle_max', value);
    if (angleMax < angleMin) angleMin = angleMax;
  });
  range('angular_velocity', () => angularVelocityMin, (value) => {
    angularVelocityMin = finiteMaterialNumber('angular_velocity_min', value);
    if (angularVelocityMin > angularVelocityMax) angularVelocityMax = angularVelocityMin;
  }, () => angularVelocityMax, (value) => {
    angularVelocityMax = finiteMaterialNumber('angular_velocity_max', value);
    if (angularVelocityMax < angularVelocityMin) angularVelocityMin = angularVelocityMax;
  });
  range('orbit_velocity', () => orbitVelocityMin, (value) => {
    orbitVelocityMin = finiteMaterialNumber('orbit_velocity_min', value);
    if (orbitVelocityMin > orbitVelocityMax) orbitVelocityMax = orbitVelocityMin;
  }, () => orbitVelocityMax, (value) => {
    orbitVelocityMax = finiteMaterialNumber('orbit_velocity_max', value);
    if (orbitVelocityMax < orbitVelocityMin) orbitVelocityMin = orbitVelocityMax;
  });
  range('linear_accel', () => linearAccelMin, (value) => {
    linearAccelMin = finiteMaterialNumber('linear_accel_min', value);
    if (linearAccelMin > linearAccelMax) linearAccelMax = linearAccelMin;
  }, () => linearAccelMax, (value) => {
    linearAccelMax = finiteMaterialNumber('linear_accel_max', value);
    if (linearAccelMax < linearAccelMin) linearAccelMin = linearAccelMax;
  });
  range('radial_accel', () => radialAccelMin, (value) => {
    radialAccelMin = finiteMaterialNumber('radial_accel_min', value);
    if (radialAccelMin > radialAccelMax) radialAccelMax = radialAccelMin;
  }, () => radialAccelMax, (value) => {
    radialAccelMax = finiteMaterialNumber('radial_accel_max', value);
    if (radialAccelMax < radialAccelMin) radialAccelMin = radialAccelMax;
  });
  range('tangential_accel', () => tangentialAccelMin, (value) => {
    tangentialAccelMin = finiteMaterialNumber('tangential_accel_min', value);
    if (tangentialAccelMin > tangentialAccelMax) tangentialAccelMax = tangentialAccelMin;
  }, () => tangentialAccelMax, (value) => {
    tangentialAccelMax = finiteMaterialNumber('tangential_accel_max', value);
    if (tangentialAccelMax < tangentialAccelMin) tangentialAccelMin = tangentialAccelMax;
  });
  range('damping', () => dampingMin, (value) => {
    dampingMin = nonNegativeMaterialNumber('damping_min', value);
    if (dampingMin > dampingMax) dampingMax = dampingMin;
  }, () => dampingMax, (value) => {
    dampingMax = nonNegativeMaterialNumber('damping_max', value);
    if (dampingMax < dampingMin) dampingMin = dampingMax;
  });
  range('hue_variation', () => hueVariationMin, (value) => {
    hueVariationMin = finiteMaterialNumber('hue_variation_min', value);
    if (hueVariationMin < -1 || hueVariationMin > 1) {
      throw new Error('ParticlesMaterial.hue_variation_min must be within [-1, 1]');
    }
    if (hueVariationMin > hueVariationMax) hueVariationMax = hueVariationMin;
  }, () => hueVariationMax, (value) => {
    hueVariationMax = finiteMaterialNumber('hue_variation_max', value);
    if (hueVariationMax < -1 || hueVariationMax > 1) {
      throw new Error('ParticlesMaterial.hue_variation_max must be within [-1, 1]');
    }
    if (hueVariationMax < hueVariationMin) hueVariationMin = hueVariationMax;
  });
  range('anim_speed', () => animSpeedMin, (value) => {
    animSpeedMin = finiteMaterialNumber('anim_speed_min', value);
    if (animSpeedMin > animSpeedMax) animSpeedMax = animSpeedMin;
  }, () => animSpeedMax, (value) => {
    animSpeedMax = finiteMaterialNumber('anim_speed_max', value);
    if (animSpeedMax < animSpeedMin) animSpeedMin = animSpeedMax;
  });
  range('anim_offset', () => animOffsetMin, (value) => {
    animOffsetMin = finiteMaterialNumber('anim_offset_min', value);
    if (animOffsetMin > animOffsetMax) animOffsetMax = animOffsetMin;
  }, () => animOffsetMax, (value) => {
    animOffsetMax = finiteMaterialNumber('anim_offset_max', value);
    if (animOffsetMax < animOffsetMin) animOffsetMin = animOffsetMax;
  });
  property('scale_min', () => scaleMin, (value) => {
    const next = nonNegativeMaterialNumber('scale_min', value);
    scaleMin = next;
    if (scaleMin > scaleMax) scaleMax = scaleMin;
  });
  property('scale_max', () => scaleMax, (value) => {
    const next = nonNegativeMaterialNumber('scale_max', value);
    scaleMax = next;
    if (scaleMax < scaleMin) scaleMin = scaleMax;
  });
  property('scale', () => scaleMax, (value) => {
    const next = nonNegativeMaterialNumber('scale', value);
    scaleMax = next;
    scaleMin = next * (1 - legacyScaleRandom);
  });
  property('lifetime_randomness', () => lifetimeRandomness, (value) => {
    lifetimeRandomness = unitMaterialNumber('lifetime_randomness', value);
  });
  property('particle_flag_align_y', () => alignY, (value) => {
    alignY = booleanParticleProperty('particle_flag_align_y', value);
  });
  property('particle_flag_disable_z', () => disableZ, (value) => {
    const next = booleanParticleProperty('particle_flag_disable_z', value);
    if (!next) {
      throw new Error(
        'ParticleProcessMaterial.particle_flag_disable_z=false cannot be projected onto a flat Pixi surface.',
      );
    }
    disableZ = true;
  });
  property('emission_shape', () => emissionShape, (value) => {
    if (!Number.isSafeInteger(value) || value < 0 || value > 6) {
      throw new Error(`ParticlesMaterial.emission_shape ${value} is outside [0, 6]`);
    }
    emissionShape = value;
  });
  property('emission_sphere_radius', () => emissionSphereRadius, (value) => {
    emissionSphereRadius = nonNegativeMaterialNumber('emission_sphere_radius', value);
  });
  property('emission_box_extents', () => ({ ...emissionBoxExtents }), (value) => {
    emissionBoxExtents = materialVector3('emission_box_extents', value);
  });
  property('emission_shape_offset', () => ({ ...emissionShapeOffset }), (value) => {
    emissionShapeOffset = materialGravity(value);
  });
  property('emission_shape_scale', () => ({ ...emissionShapeScale }), (value) => {
    emissionShapeScale = materialVector3('emission_shape_scale', value);
  });
  property('emission_ring_inner_radius', () => emissionRingInnerRadius, (value) => {
    const next = nonNegativeMaterialNumber('emission_ring_inner_radius', value);
    if (next > emissionRingRadius) {
      throw new Error('ParticlesMaterial.emission_ring_inner_radius cannot exceed ring radius');
    }
    emissionRingInnerRadius = next;
  });
  property('emission_ring_radius', () => emissionRingRadius, (value) => {
    const next = nonNegativeMaterialNumber('emission_ring_radius', value);
    if (next < emissionRingInnerRadius) {
      throw new Error('ParticlesMaterial.emission_ring_radius cannot be below inner radius');
    }
    emissionRingRadius = next;
  });
  property('tint', () => tint, (value) => {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
      throw new Error('ParticlesMaterial.tint must be an RGB24 integer');
    }
    tint = value;
    color = {
      ...color,
      r: ((tint >>> 16) & 0xff) / 255,
      g: ((tint >>> 8) & 0xff) / 255,
      b: (tint & 0xff) / 255,
    };
  });
  property('alpha', () => alpha, (value) => {
    alpha = unitMaterialNumber('alpha', value);
    color = { ...color, a: alpha };
  });
  property('color', () => ({ ...color }), (value: ParticleColor) => {
    color = materialColor(value);
  });
  property('scale_curve', () => scaleCurve, (value) => {
    scaleCurve = value == null ? undefined : validateCurve(copyCurve(value) ?? []);
  });
  for (const name of [
    'angle_curve', 'angular_velocity_curve', 'orbit_velocity_curve', 'linear_accel_curve',
    'radial_accel_curve', 'tangential_accel_curve', 'damping_curve', 'hue_variation_curve',
    'anim_speed_curve', 'anim_offset_curve',
  ] as const) {
    property(name, () => curves[name], (value) => {
      if (value == null) delete curves[name];
      else curves[name] = validateCurve(copyCurve(value) ?? []);
    });
  }
  property('color_ramp', () => colorRamp, (value) => {
    colorRamp = value == null ? undefined : validateGradient(copyGradient(value) ?? []);
  });
  property('color_initial_ramp', () => colorInitialRamp, (value) => {
    colorInitialRamp = value == null ? undefined : validateGradient(copyGradient(value) ?? []);
  });
  property('alpha_curve', () => alphaCurve, (value) => {
    alphaCurve = value == null ? undefined : validateCurve(copyCurve(value) ?? []);
  });
  PARTICLE_MATERIALS.add(material);
  PARTICLE_MATERIAL_MAJORS.set(material, godotMajor);
  bindGodotMaterial(
    material,
    {},
    godotMajor === 4 ? 'ParticleProcessMaterial' : 'ParticlesMaterial',
    {
      createDuplicate: (source, subresources) => materialFromOptions(
        particleMaterialOptions(source),
        subresources,
      ),
    },
  );
  return material;
}

function particleMaterialOptions(source: GodotParticlesMaterial2D): ParticlesMaterial2DOptions {
  return {
    godotMajor: PARTICLE_MATERIAL_MAJORS.get(source) ?? 3,
    directionAngle: source.direction_angle,
    spread: source.spread,
    gravity: source.gravity,
    initialVelocity: source.initial_velocity,
    initialVelocityRandom: source.initial_velocity_random,
    angleMin: source.angle_min,
    angleMax: source.angle_max,
    angularVelocityMin: source.angular_velocity_min,
    angularVelocityMax: source.angular_velocity_max,
    orbitVelocityMin: source.orbit_velocity_min,
    orbitVelocityMax: source.orbit_velocity_max,
    linearAccelMin: source.linear_accel_min,
    linearAccelMax: source.linear_accel_max,
    radialAccelMin: source.radial_accel_min,
    radialAccelMax: source.radial_accel_max,
    tangentialAccelMin: source.tangential_accel_min,
    tangentialAccelMax: source.tangential_accel_max,
    dampingMin: source.damping_min,
    dampingMax: source.damping_max,
    hueVariationMin: source.hue_variation_min,
    hueVariationMax: source.hue_variation_max,
    animSpeedMin: source.anim_speed_min,
    animSpeedMax: source.anim_speed_max,
    animOffsetMin: source.anim_offset_min,
    animOffsetMax: source.anim_offset_max,
    scaleMin: source.scale_min,
    scaleMax: source.scale_max,
    lifetimeRandomness: source.lifetime_randomness,
    alignY: source.particle_flag_align_y,
    disableZ: source.particle_flag_disable_z,
    emissionShape: source.emission_shape,
    emissionShapeOffset: source.emission_shape_offset,
    emissionShapeScale: source.emission_shape_scale,
    emissionSphereRadius: source.emission_sphere_radius,
    emissionBoxExtents: source.emission_box_extents,
    emissionRingInnerRadius: source.emission_ring_inner_radius,
    emissionRingRadius: source.emission_ring_radius,
    ...(source.scale_curve === undefined ? {} : { scaleCurve: source.scale_curve }),
    ...(source.angle_curve === undefined ? {} : { angleCurve: source.angle_curve }),
    ...(source.angular_velocity_curve === undefined
      ? {}
      : { angularVelocityCurve: source.angular_velocity_curve }),
    ...(source.orbit_velocity_curve === undefined
      ? {}
      : { orbitVelocityCurve: source.orbit_velocity_curve }),
    ...(source.linear_accel_curve === undefined
      ? {}
      : { linearAccelCurve: source.linear_accel_curve }),
    ...(source.radial_accel_curve === undefined
      ? {}
      : { radialAccelCurve: source.radial_accel_curve }),
    ...(source.tangential_accel_curve === undefined
      ? {}
      : { tangentialAccelCurve: source.tangential_accel_curve }),
    ...(source.damping_curve === undefined ? {} : { dampingCurve: source.damping_curve }),
    ...(source.hue_variation_curve === undefined
      ? {}
      : { hueVariationCurve: source.hue_variation_curve }),
    ...(source.anim_speed_curve === undefined
      ? {}
      : { animSpeedCurve: source.anim_speed_curve }),
    ...(source.anim_offset_curve === undefined
      ? {}
      : { animOffsetCurve: source.anim_offset_curve }),
    ...(source.color_ramp === undefined ? {} : { colorRamp: source.color_ramp }),
    ...(source.color_initial_ramp === undefined
      ? {}
      : { colorInitialRamp: source.color_initial_ramp }),
    ...(source.alpha_curve === undefined ? {} : { alphaCurve: source.alpha_curve }),
    color: source.color,
    tint: source.tint,
    alpha: source.alpha,
  };
}

export function createParticlesMaterial2D(
  options: ParticlesMaterial2DOptions = {},
): GodotParticlesMaterial2D {
  return materialFromOptions(options, true);
}

export function setParticlesMaterialDirection2D(
  material: GodotParticlesMaterial2D,
  value: { readonly x: number; readonly y: number; readonly z?: number },
): void {
  requireParticleMaterial(material);
  const direction = materialVector2('direction', value);
  material.direction_angle = Math.atan2(direction.y, direction.x);
}

export function getParticlesMaterialDirection2D(
  material: GodotParticlesMaterial2D,
): { x: number; y: number; z: number } {
  requireParticleMaterial(material);
  return {
    x: Math.cos(material.direction_angle),
    y: Math.sin(material.direction_angle),
    z: 0,
  };
}

/** Godot Resource duplication: shallow shares nested curve/gradient resources; deep copies them. */
export function duplicateParticlesMaterial2D(
  source: GodotParticlesMaterial2D,
  deep = false,
): GodotParticlesMaterial2D {
  if (typeof deep !== 'boolean') {
    throw new Error('ParticlesMaterial.duplicate(deep) requires a boolean deep flag');
  }
  const godotMajor = PARTICLE_MATERIAL_MAJORS.get(source) ?? 3;
  return duplicateGodotMaterial(source, () => materialFromOptions({
    godotMajor,
    directionAngle: source.direction_angle,
    spread: source.spread,
    gravity: source.gravity,
    initialVelocity: source.initial_velocity,
    initialVelocityRandom: source.initial_velocity_random,
    angleMin: source.angle_min,
    angleMax: source.angle_max,
    angularVelocityMin: source.angular_velocity_min,
    angularVelocityMax: source.angular_velocity_max,
    orbitVelocityMin: source.orbit_velocity_min,
    orbitVelocityMax: source.orbit_velocity_max,
    linearAccelMin: source.linear_accel_min,
    linearAccelMax: source.linear_accel_max,
    radialAccelMin: source.radial_accel_min,
    radialAccelMax: source.radial_accel_max,
    tangentialAccelMin: source.tangential_accel_min,
    tangentialAccelMax: source.tangential_accel_max,
    dampingMin: source.damping_min,
    dampingMax: source.damping_max,
    hueVariationMin: source.hue_variation_min,
    hueVariationMax: source.hue_variation_max,
    animSpeedMin: source.anim_speed_min,
    animSpeedMax: source.anim_speed_max,
    animOffsetMin: source.anim_offset_min,
    animOffsetMax: source.anim_offset_max,
    scaleMin: source.scale_min,
    scaleMax: source.scale_max,
    lifetimeRandomness: source.lifetime_randomness,
    alignY: source.particle_flag_align_y,
    disableZ: source.particle_flag_disable_z,
    emissionShape: source.emission_shape,
    emissionShapeOffset: source.emission_shape_offset,
    emissionShapeScale: source.emission_shape_scale,
    emissionSphereRadius: source.emission_sphere_radius,
    emissionBoxExtents: source.emission_box_extents,
    emissionRingInnerRadius: source.emission_ring_inner_radius,
    emissionRingRadius: source.emission_ring_radius,
    ...(source.scale_curve === undefined ? {} : { scaleCurve: source.scale_curve }),
    ...(source.angle_curve === undefined ? {} : { angleCurve: source.angle_curve }),
    ...(source.angular_velocity_curve === undefined ? {} : { angularVelocityCurve: source.angular_velocity_curve }),
    ...(source.orbit_velocity_curve === undefined ? {} : { orbitVelocityCurve: source.orbit_velocity_curve }),
    ...(source.linear_accel_curve === undefined ? {} : { linearAccelCurve: source.linear_accel_curve }),
    ...(source.radial_accel_curve === undefined ? {} : { radialAccelCurve: source.radial_accel_curve }),
    ...(source.tangential_accel_curve === undefined ? {} : { tangentialAccelCurve: source.tangential_accel_curve }),
    ...(source.damping_curve === undefined ? {} : { dampingCurve: source.damping_curve }),
    ...(source.hue_variation_curve === undefined ? {} : { hueVariationCurve: source.hue_variation_curve }),
    ...(source.anim_speed_curve === undefined ? {} : { animSpeedCurve: source.anim_speed_curve }),
    ...(source.anim_offset_curve === undefined ? {} : { animOffsetCurve: source.anim_offset_curve }),
    ...(source.color_ramp === undefined ? {} : { colorRamp: source.color_ramp }),
    ...(source.color_initial_ramp === undefined ? {} : { colorInitialRamp: source.color_initial_ramp }),
    ...(source.alpha_curve === undefined ? {} : { alphaCurve: source.alpha_curve }),
    color: source.color,
    tint: source.tint,
    alpha: source.alpha,
  }, deep), deep, godotMajor === 4 ? 'ParticleProcessMaterial' : 'ParticlesMaterial');
}

const PROCESS_PARAMETER_NAMES = [
  'initial_velocity', 'angular_velocity', 'orbit_velocity', 'linear_accel', 'radial_accel',
  'tangential_accel', 'damping', 'angle', 'scale', 'hue_variation', 'anim_speed', 'anim_offset',
] as const;

const PROCESS_PARAMETER_CURVES = [
  undefined, 'angular_velocity_curve', 'orbit_velocity_curve', 'linear_accel_curve',
  'radial_accel_curve', 'tangential_accel_curve', 'damping_curve', 'angle_curve', 'scale_curve',
  'hue_variation_curve', 'anim_speed_curve', 'anim_offset_curve',
] as const;

function processParameterName(parameter: number): typeof PROCESS_PARAMETER_NAMES[number] {
  if (!Number.isSafeInteger(parameter) || parameter < 0 || parameter >= PROCESS_PARAMETER_NAMES.length) {
    throw new RangeError(
      `ParticleProcessMaterial parameter ${parameter} is not represented by the native 2D process owner.`,
    );
  }
  return PROCESS_PARAMETER_NAMES[parameter]!;
}

function requireParticleMaterial(value: unknown): asserts value is GodotParticlesMaterial2D {
  if (typeof value !== 'object' || value === null || !PARTICLE_MATERIALS.has(value)) {
    throw new TypeError('ParticleProcessMaterial operation requires a retained process material.');
  }
}

export function setParticleProcessMaterialParameter(
  material: GodotParticlesMaterial2D,
  parameter: number,
  value: { readonly x: number; readonly y: number },
): void {
  requireParticleMaterial(material);
  const name = processParameterName(parameter);
  const rangeValue = materialVector2(name, value);
  Reflect.set(material, `${name}_min`, rangeValue.x);
  Reflect.set(material, `${name}_max`, rangeValue.y);
}

export function getParticleProcessMaterialParameter(
  material: GodotParticlesMaterial2D,
  parameter: number,
): { x: number; y: number } {
  requireParticleMaterial(material);
  const name = processParameterName(parameter);
  return {
    x: Number(Reflect.get(material, `${name}_min`)),
    y: Number(Reflect.get(material, `${name}_max`)),
  };
}

export function setParticleProcessMaterialParameterMin(
  material: GodotParticlesMaterial2D,
  parameter: number,
  value: number,
): void {
  requireParticleMaterial(material);
  Reflect.set(material, `${processParameterName(parameter)}_min`, value);
}

export function getParticleProcessMaterialParameterMin(
  material: GodotParticlesMaterial2D,
  parameter: number,
): number {
  requireParticleMaterial(material);
  return Number(Reflect.get(material, `${processParameterName(parameter)}_min`));
}

export function setParticleProcessMaterialParameterMax(
  material: GodotParticlesMaterial2D,
  parameter: number,
  value: number,
): void {
  requireParticleMaterial(material);
  Reflect.set(material, `${processParameterName(parameter)}_max`, value);
}

export function getParticleProcessMaterialParameterMax(
  material: GodotParticlesMaterial2D,
  parameter: number,
): number {
  requireParticleMaterial(material);
  return Number(Reflect.get(material, `${processParameterName(parameter)}_max`));
}

export function setParticleProcessMaterialParameterCurve(
  material: GodotParticlesMaterial2D,
  parameter: number,
  curve: ParticleCurveResource | null,
): void {
  requireParticleMaterial(material);
  processParameterName(parameter);
  const property = PROCESS_PARAMETER_CURVES[parameter];
  if (property === undefined) {
    if (curve === null) return;
    throw new Error(`ParticleProcessMaterial parameter ${parameter} has no curve in Godot 4.`);
  }
  if (curve === null) delete material[property];
  else material[property] = curve;
}

export function getParticleProcessMaterialParameterCurve(
  material: GodotParticlesMaterial2D,
  parameter: number,
): ParticleCurveResource | null {
  requireParticleMaterial(material);
  processParameterName(parameter);
  const property = PROCESS_PARAMETER_CURVES[parameter];
  return property === undefined ? null : (material[property] ?? null);
}

export interface Particles2DOptions {
  readonly godotMajor?: 3 | 4;
  readonly godotClass?: 'Particles2D' | 'GPUParticles2D' | 'CPUParticles2D';
  readonly node: Container;
  /** Camera presentation is outside Godot's logical canvas coordinates. */
  readonly presentationRoot: Container;
  readonly amount?: number;
  readonly amountRatio?: number;
  readonly lifetime?: number;
  readonly speedScale?: number;
  readonly localCoords?: boolean;
  readonly emitting?: boolean;
  readonly oneShot?: boolean;
  readonly explosiveness?: number;
  readonly randomness?: number;
  readonly lifetimeRandomness?: number;
  readonly preprocess?: number;
  readonly fixedFps?: number;
  readonly fractionalDelta?: boolean;
  readonly drawOrder?: 0 | 1 | 2;
  readonly visibilityRect?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly texture?: Texture;
  readonly processMaterial: GodotParticlesMaterial2D;
  readonly cpuDirection?: CpuParticles2DVector2;
  readonly cpuColor?: CpuParticles2DColor;
  readonly cpuEmissionPoints?: readonly CpuParticles2DVector2[];
  readonly cpuEmissionNormals?: readonly CpuParticles2DVector2[];
  readonly cpuEmissionColors?: readonly CpuParticles2DColor[];
  readonly cpuColorRamp?: GodotGradient | null;
  readonly cpuColorInitialRamp?: GodotGradient | null;
  readonly cpuAlignY?: boolean;
  readonly cpuSplitScale?: boolean;
  readonly cpuScaleCurveX?: ParticleCurveResource;
  readonly cpuScaleCurveY?: ParticleCurveResource;
  readonly duplicateEnabled?: boolean;
  /** Reconstructs only authored Godot children, never renderer-owned particle sprites. */
  readonly duplicateAuthoredChildren?: () => readonly Container[];
  readonly registry: GodotParticles2DRegistry;
}

export type GodotParticles2DNode = Container & {
  amount: number;
  amount_ratio: number;
  lifetime: number;
  speed_scale: number;
  local_coords: boolean;
  emitting: boolean;
  one_shot: boolean;
  explosiveness: number;
  randomness: number;
  lifetime_randomness: number;
  preprocess: number;
  fixed_fps: number;
  fract_delta: boolean;
  interpolate: boolean;
  draw_order: number;
  visibility_rect: { x: number; y: number; width: number; height: number };
  texture: Texture;
  process_material: GodotParticlesMaterial2D;
  readonly finished: GodotSignal<readonly []>;
  restart(keep_seed?: boolean): void;
};

interface ParticleOrigin {
  x: number;
  y: number;
  cycle: number;
  age: number;
}

interface ParticleFrame {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  tint: number;
  alpha: number;
}

interface PixiParticleAtlasState {
  enabled: boolean;
  horizontalFrames: number;
  verticalFrames: number;
  loop: boolean;
}

interface Particles2DState {
  readonly godotMajor: 3 | 4;
  readonly godotClass: 'Particles2D' | 'GPUParticles2D' | 'CPUParticles2D';
  amount: number;
  amountRatio: number;
  lifetime: number;
  speedScale: number;
  localCoords: boolean;
  emitting: boolean;
  oneShot: boolean;
  explosiveness: number;
  randomness: number;
  lifetimeRandomness: number;
  preprocess: number;
  fixedFps: number;
  fractionalDelta: boolean;
  drawOrder: 0 | 1 | 2;
  visibilityRect: { x: number; y: number; width: number; height: number };
  fixedAccumulator: number;
  preprocessPending: boolean;
  texture: Texture;
  processMaterial: GodotParticlesMaterial2D;
  cpuDirection: CpuParticles2DVector2;
  cpuColor: CpuParticles2DColor;
  cpuEmissionPoints: CpuParticles2DVector2[];
  cpuEmissionNormals: CpuParticles2DVector2[];
  cpuEmissionColors: CpuParticles2DColor[];
  cpuColorRamp: GodotGradient | null;
  cpuColorInitialRamp: GodotGradient | null;
  cpuSplitScale: boolean;
  cpuScaleCurveX?: ParticleCurveResource;
  cpuScaleCurveY?: ParticleCurveResource;
  readonly renderer: ParticleContainer<Particle>;
  readonly presentationRoot: Container;
  particles: Particle[];
  origins: ParticleOrigin[];
  previousFrames: ParticleFrame[];
  currentFrames: ParticleFrame[];
  drawIndices: number[];
  appliedDrawOrder: -1 | 0 | 1 | 2;
  atlas: PixiParticleAtlasState;
  atlasTextures: Texture[];
  atlasTextureSource: Texture;
  atlasColumns: number;
  atlasRows: number;
  clock: number;
  emissionCutoff?: number;
  released: boolean;
  unregisterDuplicate: () => void;
  unregisterRelease: () => void;
  unregisterFrameStepper: () => void;
  unregisterCanvasMaterial: () => void;
  registry: GodotParticles2DRegistry;
  duplicateAuthoredChildren?: () => readonly Container[];
  duplicateEnabled: boolean;
  readonly finished: SignalHandle<readonly []>;
  finishedEmitted: boolean;
}

export interface CpuParticles2DVector2 {
  readonly x: number;
  readonly y: number;
}

export interface CpuParticles2DColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const PARTICLE_STATES = new WeakMap<Container, Particles2DState>();

function stateOf(node: Container): Particles2DState {
  const state = PARTICLE_STATES.get(node);
  if (state === undefined || state.released) {
    throw new Error('Particles2D state was read before bind or after release');
  }
  return state;
}

export function captureParticles2DRect(node: Container): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const state = stateOf(node);
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const particle of state.particles) {
    if (particle.alpha <= 0) continue;
    const textureWidth = particle.texture.orig.width * Math.abs(particle.scaleX);
    const textureHeight = particle.texture.orig.height * Math.abs(particle.scaleY);
    const cos = Math.abs(Math.cos(particle.rotation));
    const sin = Math.abs(Math.sin(particle.rotation));
    const halfWidth = (textureWidth * cos + textureHeight * sin) / 2;
    const halfHeight = (textureWidth * sin + textureHeight * cos) / 2;
    left = Math.min(left, particle.x - halfWidth);
    top = Math.min(top, particle.y - halfHeight);
    right = Math.max(right, particle.x + halfWidth);
    bottom = Math.max(bottom, particle.y + halfHeight);
  }
  return Number.isFinite(left)
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : { x: 0, y: 0, width: 0, height: 0 };
}

function cpuStateOf(node: Container): Particles2DState {
  const state = stateOf(node);
  if (state.godotClass !== 'CPUParticles2D') {
    throw new TypeError('CPUParticles2D runtime member requires a retained CPUParticles2D node.');
  }
  return state;
}

function cpuMaterialOf(node: Container): GodotParticlesMaterial2D {
  return cpuStateOf(node).processMaterial;
}

function cpuFinite(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`CPUParticles2D.${member} requires a finite number.`);
  return value;
}

function cpuPoint(value: CpuParticles2DVector2, member: string): CpuParticles2DVector2 {
  const point = { x: Number(value.x), y: Number(value.y) };
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`CPUParticles2D.${member} requires finite Vector2 components.`);
  }
  return point;
}

function cpuColor(value: CpuParticles2DColor, member: string): CpuParticles2DColor {
  const color = { r: Number(value.r), g: Number(value.g), b: Number(value.b), a: Number(value.a) };
  if (![color.r, color.g, color.b, color.a].every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 1)) {
    throw new RangeError(`CPUParticles2D.${member} requires finite color channels within [0, 1].`);
  }
  return color;
}

const CPU_PARTICLE_PARAMETER_PROPERTIES = [
  'initial_velocity', 'angular_velocity', 'orbit_velocity', 'linear_accel',
  'radial_accel', 'tangential_accel', 'damping', 'angle', 'scale',
  'hue_variation', 'anim_speed', 'anim_offset',
] as const;

function cpuParameterProperty(parameter: number, suffix: 'min' | 'max'): keyof GodotParticlesMaterial2D {
  if (!Number.isSafeInteger(parameter) || parameter < 0 || parameter >= CPU_PARTICLE_PARAMETER_PROPERTIES.length) {
    throw new RangeError(`CPUParticles2D parameter ${parameter} is outside [0, ${CPU_PARTICLE_PARAMETER_PROPERTIES.length - 1}].`);
  }
  return `${CPU_PARTICLE_PARAMETER_PROPERTIES[parameter]}_${suffix}` as keyof GodotParticlesMaterial2D;
}

export function setCpuParticles2DDirection(node: Container, value: CpuParticles2DVector2): void {
  const point = cpuPoint(value, 'direction');
  const state = cpuStateOf(node);
  const length = Math.hypot(point.x, point.y);
  state.cpuDirection = length === 0 ? point : { x: point.x / length, y: point.y / length };
  if (length !== 0) state.processMaterial.direction_angle = Math.atan2(point.y, point.x);
}

export function getCpuParticles2DDirection(node: Container): CpuParticles2DVector2 {
  return { ...cpuStateOf(node).cpuDirection };
}

export function setCpuParticles2DSpread(node: Container, degrees: number): void {
  const value = cpuFinite(degrees, 'spread');
  if (value < 0 || value > 180) throw new RangeError('CPUParticles2D.spread must be within [0, 180] degrees.');
  cpuMaterialOf(node).spread = value * Math.PI / 180;
}

export function getCpuParticles2DSpread(node: Container): number {
  return cpuMaterialOf(node).spread * 180 / Math.PI;
}

export function setCpuParticles2DGravity(node: Container, value: CpuParticles2DVector2): void {
  const point = cpuPoint(value, 'gravity');
  cpuMaterialOf(node).gravity = { x: point.x, y: point.y, z: 0 };
}

export function getCpuParticles2DGravity(node: Container): CpuParticles2DVector2 {
  const value = cpuMaterialOf(node).gravity;
  return { x: value.x, y: value.y };
}

export function setCpuParticles2DParameterMin(node: Container, parameter: number, value: number): void {
  Reflect.set(cpuMaterialOf(node), cpuParameterProperty(parameter, 'min'), cpuFinite(value, 'parameter minimum'));
}

export function getCpuParticles2DParameterMin(node: Container, parameter: number): number {
  return Number(Reflect.get(cpuMaterialOf(node), cpuParameterProperty(parameter, 'min')));
}

export function setCpuParticles2DParameterMax(node: Container, parameter: number, value: number): void {
  Reflect.set(cpuMaterialOf(node), cpuParameterProperty(parameter, 'max'), cpuFinite(value, 'parameter maximum'));
}

export function getCpuParticles2DParameterMax(node: Container, parameter: number): number {
  return Number(Reflect.get(cpuMaterialOf(node), cpuParameterProperty(parameter, 'max')));
}

export function setCpuParticles2DParameterCurve(
  node: Container,
  parameter: number,
  curve: ParticleCurveResource | null,
): void {
  cpuParameterProperty(parameter, 'min');
  const property = PROCESS_PARAMETER_CURVES[parameter];
  if (property === undefined) {
    if (curve === null) return;
    throw new Error(`CPUParticles2D parameter ${parameter} has no Curve property.`);
  }
  const material = cpuMaterialOf(node);
  if (curve === null) delete material[property];
  else material[property] = curve;
}

export function getCpuParticles2DParameterCurve(
  node: Container,
  parameter: number,
): ParticleCurveResource | null {
  cpuParameterProperty(parameter, 'min');
  const property = PROCESS_PARAMETER_CURVES[parameter];
  return property === undefined ? null : (cpuMaterialOf(node)[property] ?? null);
}

export function setCpuParticles2DColor(node: Container, value: CpuParticles2DColor): void {
  const channels = [Number(value.r), Number(value.g), Number(value.b), Number(value.a)];
  if (!channels.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 1)) {
    throw new RangeError('CPUParticles2D.color requires finite channels within [0, 1].');
  }
  const channel = (entry: number): number => Math.round(entry * 255);
  const state = cpuStateOf(node);
  state.cpuColor = { r: channels[0]!, g: channels[1]!, b: channels[2]!, a: channels[3]! };
  const material = state.processMaterial;
  material.tint = (channel(channels[0]!) << 16) | (channel(channels[1]!) << 8) | channel(channels[2]!);
  material.alpha = channels[3]!;
}

export function getCpuParticles2DColor(node: Container): CpuParticles2DColor {
  return { ...cpuStateOf(node).cpuColor };
}

export function setCpuParticles2DColorRamp(node: Container, value: GodotGradient | null): void {
  if (value !== null && !(value instanceof GodotGradient)) {
    throw new TypeError('CPUParticles2D.color_ramp requires a Gradient resource or null.');
  }
  cpuStateOf(node).cpuColorRamp = value;
}

export function getCpuParticles2DColorRamp(node: Container): GodotGradient | null {
  return cpuStateOf(node).cpuColorRamp;
}

export function setCpuParticles2DColorInitialRamp(
  node: Container,
  value: GodotGradient | null,
): void {
  if (value !== null && !(value instanceof GodotGradient)) {
    throw new TypeError('CPUParticles2D.color_initial_ramp requires a Gradient resource or null.');
  }
  cpuStateOf(node).cpuColorInitialRamp = value;
}

export function getCpuParticles2DColorInitialRamp(node: Container): GodotGradient | null {
  return cpuStateOf(node).cpuColorInitialRamp;
}

export function setCpuParticles2DSplitScale(node: Container, enabled: boolean): void {
  cpuStateOf(node).cpuSplitScale = booleanParticleProperty('split_scale', enabled);
}

export function getCpuParticles2DSplitScale(node: Container): boolean {
  return cpuStateOf(node).cpuSplitScale;
}

export function setCpuParticles2DScaleCurveX(
  node: Container,
  curve: ParticleCurveResource | null,
): void {
  const state = cpuStateOf(node);
  if (curve === null) delete state.cpuScaleCurveX;
  else state.cpuScaleCurveX = validateCurve(copyCurve(curve) ?? []);
}

export function getCpuParticles2DScaleCurveX(
  node: Container,
): ParticleCurveResource | null {
  return cpuStateOf(node).cpuScaleCurveX ?? null;
}

export function setCpuParticles2DScaleCurveY(
  node: Container,
  curve: ParticleCurveResource | null,
): void {
  const state = cpuStateOf(node);
  if (curve === null) delete state.cpuScaleCurveY;
  else state.cpuScaleCurveY = validateCurve(copyCurve(curve) ?? []);
}

export function getCpuParticles2DScaleCurveY(
  node: Container,
): ParticleCurveResource | null {
  return cpuStateOf(node).cpuScaleCurveY ?? null;
}

export function setCpuParticles2DEmissionSphereRadius(node: Container, value: number): void {
  cpuMaterialOf(node).emission_sphere_radius = cpuFinite(value, 'emission_sphere_radius');
}

export function getCpuParticles2DEmissionSphereRadius(node: Container): number {
  return cpuMaterialOf(node).emission_sphere_radius;
}

export function setCpuParticles2DEmissionRectExtents(node: Container, value: CpuParticles2DVector2): void {
  const point = cpuPoint(value, 'emission_rect_extents');
  if (point.x < 0 || point.y < 0) throw new RangeError('CPUParticles2D.emission_rect_extents must be non-negative.');
  cpuMaterialOf(node).emission_box_extents = { x: point.x, y: point.y, z: 0 };
}

export function getCpuParticles2DEmissionRectExtents(node: Container): CpuParticles2DVector2 {
  const value = cpuMaterialOf(node).emission_box_extents;
  return { x: value.x, y: value.y };
}

export function setCpuParticles2DEmissionShape(node: Container, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 6) {
    throw new RangeError('CPUParticles2D.emission_shape must be an integer in [0, 6].');
  }
  cpuMaterialOf(node).emission_shape = value as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function getCpuParticles2DEmissionShape(node: Container): number {
  return cpuMaterialOf(node).emission_shape;
}

export function setCpuParticles2DEmissionPoints(node: Container, value: readonly CpuParticles2DVector2[]): void {
  cpuStateOf(node).cpuEmissionPoints = value.map((point) => cpuPoint(point, 'emission_points'));
}

export function getCpuParticles2DEmissionPoints(node: Container): readonly CpuParticles2DVector2[] {
  return cpuStateOf(node).cpuEmissionPoints.map((point) => ({ ...point }));
}

export function setCpuParticles2DEmissionNormals(node: Container, value: readonly CpuParticles2DVector2[]): void {
  cpuStateOf(node).cpuEmissionNormals = value.map((point) => cpuPoint(point, 'emission_normals'));
}

export function getCpuParticles2DEmissionNormals(node: Container): readonly CpuParticles2DVector2[] {
  return cpuStateOf(node).cpuEmissionNormals.map((point) => ({ ...point }));
}

export function setCpuParticles2DEmissionColors(node: Container, value: readonly CpuParticles2DColor[]): void {
  cpuStateOf(node).cpuEmissionColors = value.map((color) => cpuColor(color, 'emission_colors'));
}

export function getCpuParticles2DEmissionColors(node: Container): readonly CpuParticles2DColor[] {
  return cpuStateOf(node).cpuEmissionColors.map((color) => ({ ...color }));
}

export function setCpuParticles2DEmissionRingInnerRadius(node: Container, value: number): void {
  cpuMaterialOf(node).emission_ring_inner_radius = cpuFinite(value, 'emission_ring_inner_radius');
}

export function getCpuParticles2DEmissionRingInnerRadius(node: Container): number {
  return cpuMaterialOf(node).emission_ring_inner_radius;
}

export function setCpuParticles2DEmissionRingRadius(node: Container, value: number): void {
  cpuMaterialOf(node).emission_ring_radius = cpuFinite(value, 'emission_ring_radius');
}

export function getCpuParticles2DEmissionRingRadius(node: Container): number {
  return cpuMaterialOf(node).emission_ring_radius;
}

function requireFiniteNonNegative(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Particles2D.${name} must be a finite non-negative number; received ${value}`);
  }
  return value;
}

function requirePositive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Particles2D.${name} must be finite and greater than zero; received ${value}`);
  }
  return value;
}

function requireUnit(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Particles2D.${name} must be finite and within [0, 1]; received ${value}`);
  }
  return value;
}

function destroyDerivedAtlasTextures(state: Particles2DState): void {
  for (const texture of state.atlasTextures) {
    if (texture !== state.atlasTextureSource) texture.destroy(false);
  }
  state.atlasTextures.length = 0;
}

/**
 * Project a Godot CanvasItemMaterial particle sheet onto native Pixi Texture identities. Pixi v8
 * particles carry a real Texture per instance, so animation changes UVs without sprites, filters,
 * shader mirrors, or a second renderer tree.
 */
function rebuildParticleAtlas(state: Particles2DState): void {
  destroyDerivedAtlasTextures(state);
  state.atlasTextureSource = state.texture;
  state.atlasColumns = state.atlas.enabled ? state.atlas.horizontalFrames : 1;
  state.atlasRows = state.atlas.enabled ? state.atlas.verticalFrames : 1;
  const frameCount = state.atlasColumns * state.atlasRows;
  if (frameCount === 1) {
    state.atlasTextures.push(state.texture);
  } else {
    const sourceFrame = state.texture.frame;
    const width = sourceFrame.width / state.atlasColumns;
    const height = sourceFrame.height / state.atlasRows;
    for (let row = 0; row < state.atlasRows; row += 1) {
      for (let column = 0; column < state.atlasColumns; column += 1) {
        state.atlasTextures.push(new Texture({
          source: state.texture.source,
          frame: new Rectangle(
            sourceFrame.x + column * width,
            sourceFrame.y + row * height,
            width,
            height,
          ),
        }));
      }
    }
  }
  state.renderer.texture = state.atlasTextures[0] ?? state.texture;
  for (const particle of state.particles) {
    particle.texture = state.atlasTextures[0] ?? state.texture;
  }
}

function consumeParticleCanvasMaterial(
  state: Particles2DState,
  material: Readonly<GodotCanvasItemMaterialState> | null,
): void {
  const next: PixiParticleAtlasState = {
    enabled: material?.particlesAnimation ?? false,
    horizontalFrames: material?.particlesAnimHFrames ?? 1,
    verticalFrames: material?.particlesAnimVFrames ?? 1,
    loop: material?.particlesAnimLoop ?? false,
  };
  if (
    state.atlas.enabled === next.enabled &&
    state.atlas.horizontalFrames === next.horizontalFrames &&
    state.atlas.verticalFrames === next.verticalFrames &&
    state.atlas.loop === next.loop
  ) return;
  state.atlas = next;
  rebuildParticleAtlas(state);
}

function particleAtlasTexture(
  state: Particles2DState,
  material: GodotParticlesMaterial2D,
  life: number,
  speedRandom: number,
  offsetRandom: number,
): Texture {
  if (!state.atlas.enabled || state.atlasTextures.length <= 1) return state.texture;
  const godotMajor = PARTICLE_MATERIAL_MAJORS.get(material) ?? 3;
  const speed = godotMajor === 3
    ? legacyCpuAnimationParameter(
        material.anim_speed_min,
        material.anim_speed_max,
        material.anim_speed_curve,
        life,
        speedRandom,
      )
    : ranged(material.anim_speed_min, material.anim_speed_max, speedRandom) *
      curveFactor(material.anim_speed_curve, life);
  const offset = godotMajor === 3
    ? legacyCpuAnimationParameter(
        material.anim_offset_min,
        material.anim_offset_max,
        material.anim_offset_curve,
        life,
        offsetRandom,
      )
    : ranged(material.anim_offset_min, material.anim_offset_max, offsetRandom) *
      curveFactor(material.anim_offset_curve, life);
  let progress = offset + speed * life;
  if (state.atlas.loop) progress = ((progress % 1) + 1) % 1;
  else progress = Math.max(0, Math.min(1, progress));
  const index = Math.min(
    state.atlasTextures.length - 1,
    Math.floor(progress * state.atlasTextures.length),
  );
  return state.atlasTextures[index] ?? state.texture;
}

/** Godot 3 CPUParticles2D adds its Curve sample to the authored base before randomness. */
function legacyCpuAnimationParameter(
  minimum: number,
  base: number,
  curve: ParticleCurveResource | undefined,
  life: number,
  random: number,
): number {
  const randomness = base === 0 ? 0 : Math.max(0, Math.min(1, 1 - minimum / base));
  const curveValue = curve === undefined ? 0 : sampleCurve(curve, life);
  return (base + curveValue) * (1 - randomness + randomness * random);
}

function resize(state: Particles2DState, amount: number): void {
  amount = Math.trunc(requireFiniteNonNegative('amount', amount));
  if (amount < 1) throw new Error(`Particles2D.amount must be at least 1; received ${amount}`);
  if (amount === state.amount && state.particles.length === amount) return;
  while (state.particles.length > amount) {
    const particle = state.particles.pop() as Particle;
    state.origins.pop();
    state.previousFrames.pop();
    state.currentFrames.pop();
    state.renderer.removeParticle(particle);
  }
  while (state.particles.length < amount) {
    const particle = new Particle(state.atlasTextures[0] ?? state.texture);
    particle.anchorX = 0.5;
    particle.anchorY = 0.5;
    particle.alpha = 0;
    state.particles.push(particle);
    state.origins.push({ x: 0, y: 0, cycle: -1, age: Number.NEGATIVE_INFINITY });
    const frame = particleFrame(particle);
    state.previousFrames.push({ ...frame });
    state.currentFrames.push(frame);
    state.renderer.addParticle(particle);
  }
  state.amount = amount;
  state.appliedDrawOrder = -1;
}

function copyDisplayState(source: Container, target: Container): void {
  target.label = source.label;
  target.position.copyFrom(source.position);
  target.scale.copyFrom(source.scale);
  target.pivot.copyFrom(source.pivot);
  target.skew.copyFrom(source.skew);
  target.rotation = source.rotation;
  target.alpha = source.alpha;
  target.visible = source.visible;
  target.renderable = source.renderable;
  target.zIndex = source.zIndex;
}

function particleFrame(particle: Particle): ParticleFrame {
  return {
    x: particle.x,
    y: particle.y,
    scaleX: particle.scaleX,
    scaleY: particle.scaleY,
    rotation: particle.rotation,
    tint: particle.tint,
    alpha: particle.alpha,
  };
}

function copyParticleFrame(target: ParticleFrame, source: ParticleFrame): void {
  target.x = source.x;
  target.y = source.y;
  target.scaleX = source.scaleX;
  target.scaleY = source.scaleY;
  target.rotation = source.rotation;
  target.tint = source.tint;
  target.alpha = source.alpha;
}

function captureCurrentFrames(state: Particles2DState): void {
  for (let index = 0; index < state.particles.length; index += 1) {
    copyParticleFrame(
      state.currentFrames[index] as ParticleFrame,
      particleFrame(state.particles[index] as Particle),
    );
  }
}

function beginFixedFrame(state: Particles2DState): void {
  for (let index = 0; index < state.currentFrames.length; index += 1) {
    copyParticleFrame(
      state.previousFrames[index] as ParticleFrame,
      state.currentFrames[index] as ParticleFrame,
    );
  }
}

function blendTint(left: number, right: number, weight: number): number {
  const channel = (shift: number): number => Math.round(
    ((left >> shift) & 0xff) + (((right >> shift) & 0xff) - ((left >> shift) & 0xff)) * weight,
  );
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function applyInterpolatedFrames(state: Particles2DState, weight: number): void {
  weight = Math.max(0, Math.min(1, weight));
  for (let index = 0; index < state.particles.length; index += 1) {
    const particle = state.particles[index] as Particle;
    const previous = state.previousFrames[index] as ParticleFrame;
    const current = state.currentFrames[index] as ParticleFrame;
    particle.x = previous.x + (current.x - previous.x) * weight;
    particle.y = previous.y + (current.y - previous.y) * weight;
    particle.scaleX = previous.scaleX + (current.scaleX - previous.scaleX) * weight;
    particle.scaleY = previous.scaleY + (current.scaleY - previous.scaleY) * weight;
    particle.rotation = previous.rotation + (current.rotation - previous.rotation) * weight;
    particle.tint = blendTint(previous.tint, current.tint, weight);
    particle.alpha = previous.alpha + (current.alpha - previous.alpha) * weight;
  }
}

function restartOneShot(state: Particles2DState): void {
  state.clock = 0;
  state.fixedAccumulator = 0;
  delete state.emissionCutoff;
  state.finishedEmitted = false;
  for (let i = 0; i < state.origins.length; i += 1) {
    (state.origins[i] as ParticleOrigin).cycle = -1;
    (state.origins[i] as ParticleOrigin).age = Number.NEGATIVE_INFINITY;
    (state.particles[i] as Particle).alpha = 0;
    (state.previousFrames[i] as ParticleFrame).alpha = 0;
    (state.currentFrames[i] as ParticleFrame).alpha = 0;
  }
}

function installProperties(node: GodotParticles2DNode, state: Particles2DState): void {
  const property = <K extends keyof GodotParticles2DNode>(
    name: K,
    get: () => GodotParticles2DNode[K],
    set: (value: GodotParticles2DNode[K]) => void,
  ): void => {
    Object.defineProperty(node, name, { configurable: true, enumerable: true, get, set });
  };
  property('amount', () => state.amount, (value) => resize(state, value));
  property('amount_ratio', () => state.amountRatio, (value) => {
    if (state.godotClass !== 'GPUParticles2D') {
      throw new TypeError('amount_ratio belongs to Godot 4 GPUParticles2D.');
    }
    state.amountRatio = requireUnit('amount_ratio', value);
  });
  property('lifetime', () => state.lifetime, (value) => {
    state.lifetime = requirePositive('lifetime', value);
  });
  property('speed_scale', () => state.speedScale, (value) => {
    state.speedScale = requireFiniteNonNegative('speed_scale', value);
  });
  property('local_coords', () => state.localCoords, (value) => {
    state.localCoords = booleanParticleProperty('local_coords', value);
  });
  property('emitting', () => state.emitting, (value) => {
    const next = booleanParticleProperty('emitting', value);
    if (state.emitting && !next) state.emissionCutoff = state.clock;
    if (!state.emitting && next) {
      // Godot 3.6 Particles2D::set_emitting restarts a one-shot only after its last cycle ended;
      // manually resuming an active cycle does not rewind it.
      if (state.oneShot && state.clock >= state.lifetime) restartOneShot(state);
      else delete state.emissionCutoff;
      state.preprocessPending = state.preprocess > 0;
    }
    state.emitting = next;
  });
  property('one_shot', () => state.oneShot, (value) => {
    const next = booleanParticleProperty('one_shot', value);
    state.oneShot = next;
    // Godot 3.6 Particles2D::set_one_shot restarts an emitting server only when one_shot is
    // disabled; enabling it changes the current cycle without rewinding.
    if (!next && state.emitting) restartOneShot(state);
  });
  property('explosiveness', () => state.explosiveness, (value) => {
    state.explosiveness = requireUnit('explosiveness', value);
  });
  property('randomness', () => state.randomness, (value) => {
    state.randomness = requireUnit('randomness', value);
  });
  property('lifetime_randomness', () => state.lifetimeRandomness, (value) => {
    state.lifetimeRandomness = requireUnit('lifetime_randomness', value);
  });
  property('preprocess', () => state.preprocess, (value) => {
    state.preprocess = requireFiniteNonNegative('preprocess', value);
    state.preprocessPending = state.preprocess > 0;
  });
  property('fixed_fps', () => state.fixedFps, (value) => {
    const next = Math.trunc(requireFiniteNonNegative('fixed_fps', value));
    state.fixedFps = next;
    state.fixedAccumulator = 0;
    captureCurrentFrames(state);
    beginFixedFrame(state);
  });
  const setFractionalDelta = (value: boolean): void => {
    const next = booleanParticleProperty(
      state.godotMajor === 4 ? 'interpolate' : 'fract_delta',
      value,
    );
    state.fractionalDelta = next;
  };
  property('fract_delta', () => state.fractionalDelta, setFractionalDelta);
  property('interpolate', () => state.fractionalDelta, setFractionalDelta);
  property('draw_order', () => state.drawOrder, (value) => {
    if (!Number.isInteger(value) || value < 0 || value > 2) {
      throw new Error(`Particles2D.draw_order ${value} is outside its 2D enum`);
    }
    if (state.godotMajor === 3 && value === 2) {
      throw new Error('Particles2D.DRAW_ORDER_VIEW_DEPTH is unavailable in a flat Pixi batch');
    }
    state.drawOrder = value as 0 | 1 | 2;
  });
  property('visibility_rect', () => ({ ...state.visibilityRect }), (value) => {
    if (typeof value !== 'object' || value === null) {
      throw new Error('Particles2D.visibility_rect must be a Rect2 value');
    }
    const next = {
      x: Number(value.x),
      y: Number(value.y),
      width: Number(value.width),
      height: Number(value.height),
    };
    if (!Object.values(next).every(Number.isFinite) || next.width < 0 || next.height < 0) {
      throw new Error('Particles2D.visibility_rect must be finite with non-negative dimensions');
    }
    state.visibilityRect = next;
    state.renderer.cullArea = new Rectangle(next.x, next.y, next.width, next.height);
  });
  property('texture', () => state.texture, (value) => {
    if (!(value instanceof Texture)) {
      throw new Error('Particles2D.texture accepts only a native Pixi Texture resource');
    }
    state.texture = value;
    rebuildParticleAtlas(state);
  });
  property('process_material', () => state.processMaterial, (value) => {
    if (!PARTICLE_MATERIALS.has(value)) {
      throw new Error('Particles2D.process_material accepts only a copied ParticlesMaterial resource');
    }
    if ((PARTICLE_MATERIAL_MAJORS.get(value) ?? 3) !== state.godotMajor) {
      throw new Error(
        `${state.godotMajor === 4 ? 'GPUParticles2D' : 'Particles2D'}.process_material refuses a ` +
          'particle material from the other Godot major dialect',
      );
    }
    state.processMaterial = value;
  });
  Object.defineProperty(node, 'finished', {
    configurable: true,
    enumerable: true,
    value: state.finished.signal,
  });
  Object.defineProperty(node, 'restart', {
    configurable: true,
    enumerable: false,
    value: (keepSeed?: boolean): void => {
      if (state.godotMajor === 3) {
        if (keepSeed !== undefined) {
          throw new Error('Particles2D.restart() in Godot 3 does not accept keep_seed');
        }
      } else if (keepSeed !== true) {
        if (keepSeed !== undefined && typeof keepSeed !== 'boolean') {
          throw new Error('GPUParticles2D.restart(keep_seed) requires bool');
        }
        throw new Error(
          'GPUParticles2D.restart(false) reseeds Godot renderer RNG; the deterministic Pixi ' +
            'particle carry cannot claim that observable seed transition. Pass true to retain seed.',
        );
      }
      restartOneShot(state);
      state.emitting = true;
      state.preprocessPending = state.preprocess > 0;
    },
  });
}

/** Bind runtime behavior to the existing Pixi world node. */
export function bindParticles2D(options: Particles2DOptions): GodotParticles2DNode {
  if (PARTICLE_STATES.has(options.node)) {
    throw new Error(`Particles2D ${options.node.label || '<unnamed>'} is already bound`);
  }
  const node = options.node as GodotParticles2DNode;
  if (!((options.texture ?? Texture.EMPTY) instanceof Texture)) {
    throw new Error('Particles2D.texture accepts only a native Pixi Texture resource');
  }
  if (!PARTICLE_MATERIALS.has(options.processMaterial)) {
    throw new Error('Particles2D.process_material accepts only a copied ParticlesMaterial resource');
  }
  if ((PARTICLE_MATERIAL_MAJORS.get(options.processMaterial) ?? 3) !== (options.godotMajor ?? 3)) {
    throw new Error('Particles2D process_material dialect does not match the particle node dialect');
  }
  if (options.cpuAlignY !== undefined) {
    options.processMaterial.particle_flag_align_y = booleanParticleProperty(
      'particle_flag_align_y', options.cpuAlignY,
    );
  }
  const renderer = markInternalCanvasChild(
    new ParticleContainer<Particle>({
      texture: options.texture ?? Texture.EMPTY,
      dynamicProperties: {
        position: true,
        vertex: true,
        color: true,
        uvs: true,
        rotation: true,
      },
    }),
  );
  node.addChild(renderer);
  const state: Particles2DState = {
    godotMajor: options.godotMajor ?? 3,
    godotClass: options.godotClass ?? ((options.godotMajor ?? 3) === 4 ? 'GPUParticles2D' : 'Particles2D'),
    amount: 0,
    amountRatio: requireUnit('amount_ratio', options.amountRatio ?? 1),
    lifetime: requirePositive('lifetime', options.lifetime ?? 1),
    speedScale: requireFiniteNonNegative('speed_scale', options.speedScale ?? 1),
    localCoords: booleanParticleProperty('local_coords', options.localCoords ?? true),
    emitting: booleanParticleProperty('emitting', options.emitting ?? true),
    oneShot: booleanParticleProperty('one_shot', options.oneShot ?? false),
    explosiveness: requireUnit('explosiveness', options.explosiveness ?? 0),
    randomness: requireUnit('randomness', options.randomness ?? 0),
    lifetimeRandomness: requireUnit('lifetime_randomness', options.lifetimeRandomness ?? 0),
    preprocess: requireFiniteNonNegative('preprocess', options.preprocess ?? 0),
    fixedFps: Math.trunc(requireFiniteNonNegative(
      'fixed_fps', options.fixedFps ?? ((options.godotMajor ?? 3) === 4 ? 30 : 0),
    )),
    fractionalDelta: booleanParticleProperty(
      (options.godotMajor ?? 3) === 4 ? 'interpolate' : 'fract_delta',
      options.fractionalDelta ?? true,
    ),
    drawOrder: options.drawOrder ?? 0,
    visibilityRect: { ...(options.visibilityRect ?? { x: -100, y: -100, width: 200, height: 200 }) },
    fixedAccumulator: 0,
    preprocessPending: (options.preprocess ?? 0) > 0,
    texture: options.texture ?? Texture.EMPTY,
    processMaterial: options.processMaterial,
    cpuDirection: options.cpuDirection === undefined
      ? { x: Math.cos(options.processMaterial.direction_angle), y: Math.sin(options.processMaterial.direction_angle) }
      : cpuPoint(options.cpuDirection, 'direction'),
    cpuColor: options.cpuColor ?? {
      r: ((options.processMaterial.tint >> 16) & 0xff) / 255,
      g: ((options.processMaterial.tint >> 8) & 0xff) / 255,
      b: (options.processMaterial.tint & 0xff) / 255,
      a: options.processMaterial.alpha,
    },
    cpuEmissionPoints: (options.cpuEmissionPoints ?? []).map((point) => cpuPoint(point, 'emission_points')),
    cpuEmissionNormals: (options.cpuEmissionNormals ?? []).map((point) => cpuPoint(point, 'emission_normals')),
    cpuEmissionColors: (options.cpuEmissionColors ?? []).map((color) => cpuColor(color, 'emission_colors')),
    cpuColorRamp: options.cpuColorRamp ?? null,
    cpuColorInitialRamp: options.cpuColorInitialRamp ?? null,
    cpuSplitScale: booleanParticleProperty('split_scale', options.cpuSplitScale ?? false),
    ...(options.cpuScaleCurveX === undefined
      ? {}
      : { cpuScaleCurveX: validateCurve(copyCurve(options.cpuScaleCurveX) ?? []) }),
    ...(options.cpuScaleCurveY === undefined
      ? {}
      : { cpuScaleCurveY: validateCurve(copyCurve(options.cpuScaleCurveY) ?? []) }),
    renderer,
    presentationRoot: options.presentationRoot,
    particles: [],
    origins: [],
    previousFrames: [],
    currentFrames: [],
    drawIndices: [],
    appliedDrawOrder: 0,
    atlas: { enabled: false, horizontalFrames: 1, verticalFrames: 1, loop: false },
    atlasTextures: [],
    atlasTextureSource: options.texture ?? Texture.EMPTY,
    atlasColumns: 1,
    atlasRows: 1,
    clock: 0,
    released: false,
    unregisterDuplicate: () => {},
    unregisterRelease: () => {},
    unregisterFrameStepper: () => {},
    unregisterCanvasMaterial: () => {},
    registry: options.registry,
    duplicateEnabled: options.duplicateEnabled ?? false,
    finished: createSignal<readonly []>(),
    finishedEmitted: false,
    ...(options.emitting === false ? { emissionCutoff: Number.NEGATIVE_INFINITY } : {}),
    ...(options.duplicateAuthoredChildren === undefined
      ? {}
      : { duplicateAuthoredChildren: options.duplicateAuthoredChildren }),
  };
  if (!Number.isInteger(state.drawOrder) || state.drawOrder < 0 || state.drawOrder > 2) {
    throw new Error(`Particles2D.draw_order ${state.drawOrder} is outside its 2D enum`);
  }
  if (state.godotMajor === 3 && state.drawOrder === 2) {
    throw new Error('Particles2D.DRAW_ORDER_VIEW_DEPTH is unavailable in a flat Pixi batch');
  }
  if (
    !Object.values(state.visibilityRect).every(Number.isFinite) ||
    state.visibilityRect.width < 0 || state.visibilityRect.height < 0
  ) {
    throw new Error('Particles2D.visibility_rect must be finite with non-negative dimensions');
  }
  renderer.cullArea = new Rectangle(
    state.visibilityRect.x,
    state.visibilityRect.y,
    state.visibilityRect.width,
    state.visibilityRect.height,
  );
  PARTICLE_STATES.set(node, state);
  registerGodotObjectIdentity(node, state.godotClass);
  rebuildParticleAtlas(state);
  state.unregisterCanvasMaterial = registerCanvasItemParticleMaterialConsumer(
    node,
    (material) => consumeParticleCanvasMaterial(state, material),
  );
  state.unregisterRelease = registerCanvasNodeRelease(node, () => releaseParticles2D(node));
  installProperties(node, state);
  resize(state, options.amount ?? 8);
  if (state.duplicateEnabled) {
    state.unregisterDuplicate = registerCanvasNodeDuplicateFactory(
      node,
      (flags) => duplicateParticles2D(node, flags),
    );
  }
  options.registry.add(node);
  return node;
}

/** Clone source storage state and authored children; Resource-valued properties remain shared. */
export function duplicateParticles2D(
  source: GodotParticles2DNode,
  flags = GODOT_3_DUPLICATE_DEFAULT,
): GodotParticles2DNode {
  if (flags !== GODOT_3_DUPLICATE_DEFAULT) {
    throw new Error(
      `Particles2D.duplicate(${flags}) refused: this source factory proves only Godot 3's ` +
        `default flags (${GODOT_3_DUPLICATE_DEFAULT}); custom signal/group/script selection is ` +
        'not carried.',
    );
  }
  const sourceState = stateOf(source);
  const clone = new Container();
  copyDisplayState(source, clone);
  const bound = bindParticles2D({
    godotMajor: sourceState.godotMajor,
    godotClass: sourceState.godotClass,
    node: clone,
    presentationRoot: sourceState.presentationRoot,
    amount: sourceState.amount,
    amountRatio: sourceState.amountRatio,
    lifetime: sourceState.lifetime,
    speedScale: sourceState.speedScale,
    localCoords: sourceState.localCoords,
    emitting: sourceState.emitting,
    oneShot: sourceState.oneShot,
    explosiveness: sourceState.explosiveness,
    randomness: sourceState.randomness,
    lifetimeRandomness: sourceState.lifetimeRandomness,
    preprocess: sourceState.preprocess,
    fixedFps: sourceState.fixedFps,
    fractionalDelta: sourceState.fractionalDelta,
    drawOrder: sourceState.drawOrder,
    visibilityRect: sourceState.visibilityRect,
    texture: sourceState.texture,
    // Node::_duplicate_properties shallow-copies Resource properties. Rota explicitly replaces
    // this with `(snow_mat/rain_mat).duplicate()` after cloning the node.
    processMaterial: sourceState.processMaterial,
    cpuDirection: sourceState.cpuDirection,
    cpuColor: sourceState.cpuColor,
    cpuEmissionPoints: sourceState.cpuEmissionPoints,
    cpuEmissionNormals: sourceState.cpuEmissionNormals,
    cpuEmissionColors: sourceState.cpuEmissionColors,
    cpuColorRamp: sourceState.cpuColorRamp,
    cpuColorInitialRamp: sourceState.cpuColorInitialRamp,
    cpuSplitScale: sourceState.cpuSplitScale,
    ...(sourceState.cpuScaleCurveX === undefined
      ? {}
      : { cpuScaleCurveX: sourceState.cpuScaleCurveX }),
    ...(sourceState.cpuScaleCurveY === undefined
      ? {}
      : { cpuScaleCurveY: sourceState.cpuScaleCurveY }),
    registry: sourceState.registry,
    duplicateEnabled: sourceState.duplicateEnabled,
    ...(sourceState.duplicateAuthoredChildren === undefined
      ? {}
      : { duplicateAuthoredChildren: sourceState.duplicateAuthoredChildren }),
  });
  for (const child of sourceState.duplicateAuthoredChildren?.() ?? []) bound.addChild(child);
  return bound;
}

function sampleCurve(points: ParticleCurveResource, t: number): number {
  if (points instanceof GodotCurve) return points.sample(t);
  if (isCurveTexture(points)) return points.get_curve()?.sample(t) ?? 1;
  if (t <= (points[0]?.offset ?? 0)) return points[0]?.value ?? 1;
  for (let i = 1; i < points.length; i += 1) {
    const right = points[i] as ParticleCurvePoint;
    if (t > right.offset) continue;
    const left = points[i - 1] as ParticleCurvePoint;
    const width = right.offset - left.offset;
    const f = width === 0 ? 0 : (t - left.offset) / width;
    const f2 = f * f;
    const f3 = f2 * f;
    return (
      (2 * f3 - 3 * f2 + 1) * left.value +
      (f3 - 2 * f2 + f) * left.rightTangent * width +
      (-2 * f3 + 3 * f2) * right.value +
      (f3 - f2) * right.leftTangent * width
    );
  }
  return points.at(-1)?.value ?? 1;
}

function sampleGradient(stops: ParticleGradientResource, t: number): ParticleGradientStop {
  if (stops instanceof GodotGradient) return { offset: t, ...stops.sample(t) };
  if (isGradientTexture(stops)) {
    return { offset: t, ...(stops.get_gradient()?.sample(t) ?? { r: 1, g: 1, b: 1, a: 1 }) };
  }
  if (t <= (stops[0]?.offset ?? 0)) return stops[0] ?? { offset: 0, r: 1, g: 1, b: 1, a: 1 };
  for (let i = 1; i < stops.length; i += 1) {
    const right = stops[i] as ParticleGradientStop;
    if (t > right.offset) continue;
    const left = stops[i - 1] as ParticleGradientStop;
    const width = right.offset - left.offset;
    const f = width === 0 ? 0 : (t - left.offset) / width;
    return {
      offset: t,
      r: left.r + (right.r - left.r) * f,
      g: left.g + (right.g - left.g) * f,
      b: left.b + (right.b - left.b) * f,
      a: left.a + (right.a - left.a) * f,
    };
  }
  return stops.at(-1) ?? { offset: 1, r: 1, g: 1, b: 1, a: 1 };
}

function tintOf(stop: ParticleGradientStop, baseTint: number): number {
  const channel = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 255);
  const red = ((baseTint >> 16) & 0xff) / 255;
  const green = ((baseTint >> 8) & 0xff) / 255;
  const blue = (baseTint & 0xff) / 255;
  return (
    (channel(stop.r * red) << 16) |
    (channel(stop.g * green) << 8) |
    channel(stop.b * blue)
  );
}

function particleColorTint(color: ParticleColor): number {
  const channel = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 255);
  return (channel(color.r) << 16) | (channel(color.g) << 8) | channel(color.b);
}

function particleAlpha(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hueRotatedTint(tint: number, variation: number): number {
  if (variation === 0) return tint;
  const r = ((tint >> 16) & 0xff) / 255;
  const g = ((tint >> 8) & 0xff) / 255;
  const b = (tint & 0xff) / 255;
  const angle = variation * Math.PI * 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // ParticleProcessMaterial's shader uses the standard YIQ hue rotation matrix.
  const rr = (0.299 + 0.701 * c + 0.168 * s) * r +
    (0.587 - 0.587 * c + 0.330 * s) * g + (0.114 - 0.114 * c - 0.497 * s) * b;
  const gg = (0.299 - 0.299 * c - 0.328 * s) * r +
    (0.587 + 0.413 * c + 0.035 * s) * g + (0.114 - 0.114 * c + 0.292 * s) * b;
  const bb = (0.299 - 0.300 * c + 1.250 * s) * r +
    (0.587 - 0.588 * c - 1.050 * s) * g + (0.114 + 0.886 * c - 0.203 * s) * b;
  const channel = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 255);
  return (channel(rr) << 16) | (channel(gg) << 8) | channel(bb);
}

function multiplyParticleTint(tint: number, color: CpuParticles2DColor): number {
  const channel = (shift: number, multiplier: number): number =>
    Math.round(((tint >> shift) & 0xff) * multiplier);
  return (channel(16, color.r) << 16) | (channel(8, color.g) << 8) | channel(0, color.b);
}

function ranged(min: number, max: number, random: number): number {
  return min + (max - min) * random;
}

function curveFactor(curve: ParticleCurveResource | undefined, life: number): number {
  return curve === undefined ? 1 : sampleCurve(curve, life);
}

/**
 * One deterministic simulation step owned entirely by copied compat.
 *
 * The low-discrepancy phase/spin/jitter sequence is the existing bounded Pixi carry, not a claim
 * to reproduce Godot's renderer RNG stream. It remains isolated from the game's seeded RNG.
 */
function simulateParticles2D(
  node: GodotParticles2DNode,
  state: Particles2DState,
  delta: number,
): void {
  state.clock += delta * state.speedScale;
  const material = state.processMaterial;
  const gravity = material.gravity;
  const emissionSpan = state.lifetime * (1 - state.explosiveness);
  // The world transform is common to the whole native batch for this step. Computing it once is
  // important for global-coordinate weather emitters with hundreds of particles.
  const logicalTransform = state.localCoords
    ? undefined
    : godotCanvasTransform2D(node, state.presentationRoot);
  let liveParticles = 0;
  const activeAmount = state.godotClass === 'GPUParticles2D'
    ? Math.ceil(state.amount * state.amountRatio)
    : state.amount;
  for (let i = 0; i < state.amount; i += 1) {
    const particle = state.particles[i] as Particle;
    if (i >= activeAmount) {
      particle.alpha = 0;
      (state.origins[i] as ParticleOrigin).age = Number.NEGATIVE_INFINITY;
      continue;
    }
    const phaseJitter = ((((i + 1) * 0.5698402909980532) % 1) + 1) % 1;
    const birthOffset =
      (i * emissionSpan) / Math.max(state.amount, 1) +
      (phaseJitter * state.randomness * state.lifetime) / Math.max(state.amount, 1);
    let born = state.clock - birthOffset;
    if (born < 0) {
      particle.alpha = 0;
      (state.origins[i] as ParticleOrigin).age = Number.NEGATIVE_INFINITY;
      continue;
    }
    let cycle = Math.floor(born / state.lifetime);
    const origin = state.origins[i] as ParticleOrigin;
    const birthTime = cycle * state.lifetime + birthOffset;
    let newBirth = false;
    if (state.emissionCutoff !== undefined && birthTime > state.emissionCutoff) {
      if (origin.cycle < 0) {
        particle.alpha = 0;
        origin.age = Number.NEGATIVE_INFINITY;
        continue;
      }
      cycle = origin.cycle;
    } else if (origin.cycle !== cycle) {
      origin.cycle = cycle;
      newBirth = true;
    }
    if (state.oneShot && cycle > 0) {
      particle.alpha = 0;
      origin.age = Number.NEGATIVE_INFINITY;
      continue;
    }
    const age = born - cycle * state.lifetime;
    const lifetimeRandomness = state.godotClass === 'GPUParticles2D'
      ? material.lifetime_randomness
      : state.lifetimeRandomness;
    const particleLifetime = state.lifetime * (1 - lifetimeRandomness * phaseJitter);
    if (age >= particleLifetime) {
      particle.alpha = 0;
      origin.age = Number.NEGATIVE_INFINITY;
      continue;
    }
    origin.age = age;
    const life = age / particleLifetime;
    const spin = ((((i + cycle * state.amount) * 0.6180339887498949) % 1) + 1) % 1;
    const jitter = ((((i + cycle * state.amount) * 0.7548776662466927) % 1) + 1) % 1;
    const angle = material.direction_angle + (spin * 2 - 1) * material.spread;
    const speed = material.initial_velocity * (1 - material.initial_velocity_random * jitter);
    let emissionX = 0;
    let emissionY = 0;
    let emissionDirection: CpuParticles2DVector2 | undefined;
    let emissionColor: CpuParticles2DColor | undefined;
    if (material.emission_shape === 1 || material.emission_shape === 2) {
      const radius = (material.emission_shape === 2 ? 1 : Math.sqrt(phaseJitter)) * material.emission_sphere_radius;
      const shapeAngle = spin * Math.PI * 2;
      emissionX = Math.cos(shapeAngle) * radius;
      emissionY = Math.sin(shapeAngle) * radius;
    } else if (material.emission_shape === 3) {
      emissionX = (phaseJitter * 2 - 1) * material.emission_box_extents.x;
      emissionY = (spin * 2 - 1) * material.emission_box_extents.y;
    } else if (material.emission_shape === 4 || material.emission_shape === 5) {
      if (state.cpuEmissionPoints.length === 0) {
        particle.alpha = 0;
        origin.age = Number.NEGATIVE_INFINITY;
        continue;
      }
      const pointIndex = Math.min(
        state.cpuEmissionPoints.length - 1,
        Math.floor(phaseJitter * state.cpuEmissionPoints.length),
      );
      const point = state.cpuEmissionPoints[pointIndex]!;
      emissionX = point.x;
      emissionY = point.y;
      emissionColor = state.cpuEmissionColors[pointIndex];
      if (material.emission_shape === 5) {
        const normal = state.cpuEmissionNormals[pointIndex];
        if (normal !== undefined) {
          const normalLength = Math.hypot(normal.x, normal.y);
          emissionDirection = normalLength === 0
            ? { x: 0, y: 0 }
            : { x: normal.x / normalLength, y: normal.y / normalLength };
        }
      }
    } else if (material.emission_shape === 6) {
      // Godot 3.6 particles_material.cpp's ring shader samples radius linearly between the two
      // authored radii (it does not area-weight with sqrt).
      const radius =
        material.emission_ring_inner_radius +
        phaseJitter * (material.emission_ring_radius - material.emission_ring_inner_radius);
      const shapeAngle = spin * Math.PI * 2;
      emissionX = Math.cos(shapeAngle) * radius;
      emissionY = Math.sin(shapeAngle) * radius;
    }
    emissionX = material.emission_shape_offset.x + emissionX * material.emission_shape_scale.x;
    emissionY = material.emission_shape_offset.y + emissionY * material.emission_shape_scale.y;
    const spreadOffset = (spin * 2 - 1) * material.spread;
    const spreadCos = Math.cos(spreadOffset), spreadSin = Math.sin(spreadOffset);
    const cpuDirection = emissionDirection ?? state.cpuDirection;
    const directionX = state.godotClass === 'CPUParticles2D'
      ? cpuDirection.x * spreadCos - cpuDirection.y * spreadSin
      : Math.cos(angle);
    const directionY = state.godotClass === 'CPUParticles2D'
      ? cpuDirection.x * spreadSin + cpuDirection.y * spreadCos
      : Math.sin(angle);
    const linearAccel = ranged(material.linear_accel_min, material.linear_accel_max, jitter) *
      curveFactor(material.linear_accel_curve, life);
    const radialAccel = ranged(material.radial_accel_min, material.radial_accel_max, spin) *
      curveFactor(material.radial_accel_curve, life);
    const tangentialAccel = ranged(material.tangential_accel_min, material.tangential_accel_max, jitter) *
      curveFactor(material.tangential_accel_curve, life);
    const damping = Math.max(0, ranged(material.damping_min, material.damping_max, spin) *
      curveFactor(material.damping_curve, life));
    const endSpeed = Math.max(0, speed + linearAccel * age - damping * age);
    const distance = (speed + endSpeed) * age * 0.5;
    let radialX = emissionX;
    let radialY = emissionY;
    const radialLength = Math.hypot(radialX, radialY);
    if (radialLength > 0) {
      radialX /= radialLength;
      radialY /= radialLength;
    } else {
      radialX = directionX;
      radialY = directionY;
    }
    const accelerationX = gravity.x + radialX * radialAccel - radialY * tangentialAccel;
    const accelerationY = gravity.y + radialY * radialAccel + radialX * tangentialAccel;
    let x = emissionX + directionX * distance + accelerationX * age * age * 0.5;
    let y = emissionY + directionY * distance + accelerationY * age * age * 0.5;
    let velocityX = directionX * endSpeed + accelerationX * age;
    let velocityY = directionY * endSpeed + accelerationY * age;
    const orbitRate = ranged(material.orbit_velocity_min, material.orbit_velocity_max, spin) *
      curveFactor(material.orbit_velocity_curve, life) * Math.PI * 2;
    const orbit = orbitRate * age;
    if (orbit !== 0) {
      const orbitCos = Math.cos(orbit);
      const orbitSin = Math.sin(orbit);
      const rotatedX = x * orbitCos - y * orbitSin;
      y = x * orbitSin + y * orbitCos;
      x = rotatedX;
      const rotatedVelocityX = velocityX * orbitCos - velocityY * orbitSin - orbitRate * y;
      velocityY = velocityX * orbitSin + velocityY * orbitCos + orbitRate * x;
      velocityX = rotatedVelocityX;
    }
    if (state.localCoords) {
      particle.x = x;
      particle.y = y;
    } else {
      if (newBirth) {
        const emitted = logicalTransform!.apply({ x: 0, y: 0 });
        origin.x = emitted.x;
        origin.y = emitted.y;
      }
      const local = logicalTransform!.applyInverse({ x: origin.x + x, y: origin.y + y });
      particle.x = local.x;
      particle.y = local.y;
    }
    let scale = material.scale_min + (material.scale_max - material.scale_min) * jitter;
    if (material.scale_curve !== undefined) scale *= sampleCurve(material.scale_curve, life);
    particle.scaleX = scale * (
      state.cpuSplitScale ? curveFactor(state.cpuScaleCurveX, life) : 1
    );
    particle.scaleY = scale * (
      state.cpuSplitScale ? curveFactor(state.cpuScaleCurveY, life) : 1
    );
    const initialAngle = ranged(material.angle_min, material.angle_max, spin) *
      curveFactor(material.angle_curve, life);
    const angularVelocity = ranged(
      material.angular_velocity_min, material.angular_velocity_max, jitter,
    ) * curveFactor(material.angular_velocity_curve, life);
    const authoredRotation = (initialAngle + angularVelocity * age) * Math.PI / 180;
    particle.rotation = material.particle_flag_align_y
      ? Math.atan2(velocityY, velocityX) - Math.PI / 2 + authoredRotation
      : authoredRotation;
    particle.texture = particleAtlasTexture(state, material, life, jitter, spin);
    const hueVariation = ranged(
      material.hue_variation_min, material.hue_variation_max, spin,
    ) * curveFactor(material.hue_variation_curve, life);
    const initialColor = state.cpuColorInitialRamp?.sample(spin) ??
      (material.color_initial_ramp === undefined
        ? undefined
        : sampleGradient(material.color_initial_ramp, spin));
    const authoredColor = material.color;
    const baseColor = initialColor === undefined ? authoredColor : {
      r: authoredColor.r * initialColor.r,
      g: authoredColor.g * initialColor.g,
      b: authoredColor.b * initialColor.b,
      a: authoredColor.a * initialColor.a,
    };
    const baseTint = particleColorTint(baseColor);
    if (state.cpuColorRamp !== null || material.color_ramp !== undefined) {
      const sampled = state.cpuColorRamp?.sample(life) ?? sampleGradient(material.color_ramp ?? [], life);
      const color = { offset: life, ...sampled };
      // Godot's particle color is the material color multiplied by the ramp sample; the ramp is
      // not a replacement for the authored base tint (Rota's rain uses this distinction).
      particle.tint = hueRotatedTint(tintOf(color, baseTint), hueVariation);
      particle.alpha = color.a * baseColor.a;
    } else {
      particle.tint = hueRotatedTint(baseTint, hueVariation);
      particle.alpha = baseColor.a;
    }
    if (material.alpha_curve !== undefined) {
      particle.alpha *= particleAlpha(sampleCurve(material.alpha_curve, life));
    }
    if (emissionColor !== undefined) {
      particle.tint = multiplyParticleTint(particle.tint, emissionColor);
      particle.alpha *= emissionColor.a;
    }
    particle.alpha = particleAlpha(particle.alpha);
    if (particle.alpha > 0) liveParticles += 1;
  }
  if (state.oneShot && state.emitting && state.clock >= state.lifetime) {
    state.emitting = false;
    state.emissionCutoff = emissionSpan;
  }
  if (state.oneShot && !state.emitting && liveParticles === 0 && !state.finishedEmitted) {
    state.finishedEmitted = true;
    state.finished.emit();
  }
  applyParticleDrawOrder(state);
}

function applyParticleDrawOrder(state: Particles2DState): void {
  // ParticleContainer insertion order is already Godot DRAW_ORDER_INDEX. Do not rebuild its GPU
  // particle list every frame in the overwhelmingly common default mode.
  if (state.drawOrder === 0 && state.appliedDrawOrder === 0) return;
  const indices = state.drawIndices;
  indices.length = state.particles.length;
  for (let index = 0; index < indices.length; index += 1) indices[index] = index;
  if (state.drawOrder === 1) {
    // DRAW_ORDER_LIFETIME composites older particles first and younger particles last.
    indices.sort((left, right) =>
      (state.origins[right] as ParticleOrigin).age - (state.origins[left] as ParticleOrigin).age ||
      left - right,
    );
  } else if (state.drawOrder === 2) {
    // Godot 4's value 2 is DRAW_ORDER_REVERSE_LIFETIME. Godot 3 value 2 refuses at bind.
    indices.sort((left, right) =>
      (state.origins[left] as ParticleOrigin).age - (state.origins[right] as ParticleOrigin).age ||
      left - right,
    );
  }
  state.renderer.removeParticles();
  for (const index of indices) state.renderer.addParticle(state.particles[index] as Particle);
  state.appliedDrawOrder = state.drawOrder;
}

/** Force the retained native batch to consume current process-material state without advancing time. */
export function requestParticles2DProcess(node: GodotParticles2DNode): void {
  const state = stateOf(node);
  simulateParticles2D(node, state, 0);
  captureCurrentFrames(state);
}

/** Advance the native Pixi particle batch using the authored Godot frame policy. */
export function stepParticles2D(node: GodotParticles2DNode, delta: number): void {
  const state = stateOf(node);
  if (!Number.isFinite(delta) || delta < 0) {
    throw new Error(`Particles2D step delta must be finite and non-negative; received ${delta}`);
  }
  if (!node.parent) return;
  if (state.preprocessPending && state.emitting) {
    const frame = state.fixedFps > 0 ? 1 / state.fixedFps : 1 / 30;
    let remaining = state.preprocess;
    const speedScale = state.speedScale;
    // GPUParticles2D neutralizes speed_scale during preprocess; Particles2D 3.x runs the burn
    // through its ordinary scaled simulation path.
    if (state.godotMajor === 4) state.speedScale = 1;
    while (remaining > 0) {
      const step = Math.min(frame, remaining);
      simulateParticles2D(node, state, step);
      remaining -= step;
    }
    state.speedScale = speedScale;
    state.preprocessPending = false;
    captureCurrentFrames(state);
    beginFixedFrame(state);
  }
  if (state.fixedFps === 0) {
    simulateParticles2D(node, state, delta);
    return;
  }
  const frame = 1 / state.fixedFps;
  state.fixedAccumulator += delta;
  while (state.fixedAccumulator >= frame) {
    beginFixedFrame(state);
    simulateParticles2D(node, state, frame);
    captureCurrentFrames(state);
    state.fixedAccumulator -= frame;
  }
  if (state.fractionalDelta) {
    applyInterpolatedFrames(state, state.fixedAccumulator / frame);
  }
}

/** Release runtime-owned batch/state without touching borrowed textures or authored children. */
export function releaseParticles2D(node: GodotParticles2DNode): void {
  const state = PARTICLE_STATES.get(node);
  if (state === undefined || state.released) return;
  state.released = true;
  state.unregisterDuplicate();
  state.unregisterRelease();
  state.unregisterFrameStepper();
  releaseCanvasItemMaterial(node);
  state.unregisterCanvasMaterial();
  state.registry.delete(node);
  for (const child of authoredCanvasChildren(node)) releaseCanvasNodeBinding(child);
  state.renderer.removeParticles();
  if (state.renderer.parent === node) node.removeChild(state.renderer);
  state.renderer.destroy({ texture: false, textureSource: false });
  destroyDerivedAtlasTextures(state);
  state.particles.length = 0;
  state.origins.length = 0;
  state.previousFrames.length = 0;
  state.currentFrames.length = 0;
  state.drawIndices.length = 0;
  PARTICLE_STATES.delete(node);
}

export interface CpuParticles2DTree {
  readonly root: Container;
  addFrameStepper(step: (dt: number) => void): () => void;
}

/** Construct a complete but unattached Godot 4 CPUParticles2D node. It joins the authoritative
 * SceneTree clock only while parented, matching Node enter/exit-tree processing without a second
 * browser animation timeline. */
export function createGodotCPUParticles2D(tree: CpuParticles2DTree): GodotParticles2DNode {
  const node = new Container();
  const registry = new GodotParticles2DRegistry();
  const bound = bindParticles2D({
    godotMajor: 4,
    godotClass: 'CPUParticles2D',
    node,
    presentationRoot: tree.root,
    processMaterial: createParticlesMaterial2D({ godotMajor: 4 }),
    registry,
  });
  const state = cpuStateOf(bound);
  state.unregisterFrameStepper = tree.addFrameStepper((delta) => {
    if (bound.parent !== null) stepParticles2D(bound, delta);
  });
  return bound;
}

/** Godot 3 `Particles2D.new()` over the same retained Pixi particle owner. */
export function createGodotParticles2D(tree: CpuParticles2DTree): GodotParticles2DNode {
  const node = new Container();
  const registry = new GodotParticles2DRegistry();
  const bound = bindParticles2D({
    godotMajor: 3,
    godotClass: 'Particles2D',
    node,
    presentationRoot: tree.root,
    processMaterial: createParticlesMaterial2D({ godotMajor: 3 }),
    registry,
  });
  const state = cpuStateOf(bound);
  state.unregisterFrameStepper = tree.addFrameStepper((delta) => {
    if (bound.parent !== null) stepParticles2D(bound, delta);
  });
  return bound;
}

/** Scene-owned lifecycle registry; dynamically duplicated emitters join immediately on creation. */
export class GodotParticles2DRegistry {
  private readonly nodes = new Set<GodotParticles2DNode>();
  private destroyed = false;

  add(node: GodotParticles2DNode): void {
    if (this.destroyed) throw new Error('Particles2D registry is already destroyed');
    this.nodes.add(node);
  }

  delete(node: GodotParticles2DNode): void {
    this.nodes.delete(node);
  }

  step(delta: number): void {
    for (const node of this.nodes) stepParticles2D(node, delta);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const node of [...this.nodes]) releaseParticles2D(node);
    this.nodes.clear();
  }
}

// Existing surface helpers remain aliases over the retained node's live properties.
export function setParticlesEmitting(node: object, value: boolean): void {
  (node as GodotParticles2DNode).emitting = value;
}

export function isParticlesEmitting(node: object): boolean {
  return (node as GodotParticles2DNode).emitting;
}

export function setParticlesLifetime(node: object, value: number): void {
  (node as GodotParticles2DNode).lifetime = value;
}

export function getParticlesLifetime(node: object): number {
  return (node as GodotParticles2DNode).lifetime;
}
