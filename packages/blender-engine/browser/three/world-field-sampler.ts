/**
 * Sampling a world's radiance field — the expensive half of the world texture,
 * kept in its own module so a WORKER can own it.
 *
 * This is where the time goes. A sky expression derives Blender's
 * multiple-scattering model (`blender-sky.ts`, 512x256 with 64 in-scattering
 * steps per pixel) and then this samples 32,768 directions out of it. MEASURED:
 * 15.4 seconds. On the page's main thread that is not "slow", it is a FROZEN
 * EDITOR — the owner saw exactly that, and a status-bar spinner could not have
 * helped, because a blocked main thread cannot paint one.
 *
 * Nothing here touches the DOM, three's renderer, or any editor state: it takes
 * a description and returns numbers. That is what makes it movable, and it is
 * the reason the split is here rather than around something larger.
 */
import * as THREE from 'three';
import { gradientTexture } from './blender-gradient-texture';
// Type-only, so this module keeps NO runtime edge back to the contribution
// that uses it -- which is what lets a worker import it alone.
import type { WorldExpression } from './blender-runtime-lighting';
import { type SkyParameters, skyField } from './blender-sky';
import { worldMath } from './world-math';

export function worldField(
  expression: WorldExpression,
  windowCoordinates?: (direction: THREE.Vector3) => THREE.Vector3,
): (direction: THREE.Vector3) => number | THREE.Vector3 {
  if (typeof expression === 'number') return () => expression;
  if (Array.isArray(expression)) {
    const value = new THREE.Vector3(...expression);
    return () => value;
  }
  if (expression.kind === 'direction') return (direction) => direction;
  if (expression.kind === 'window') {
    if (!windowCoordinates) throw new Error('World Window coordinates need a render camera');
    return windowCoordinates;
  }
  if (expression.kind === 'gradient') {
    const source = worldField(expression.vector, windowCoordinates);
    const options = { type: expression.gradient_type };
    const color = new THREE.Vector3();
    return (direction) => {
      const input = source(direction);
      const x = typeof input === 'number' ? input : input.x;
      const y = typeof input === 'number' ? input : input.y;
      const z = typeof input === 'number' ? input : input.z;
      const factor = THREE.MathUtils.clamp(gradientTexture(x, y, z, options), 0, 1);
      return expression.output === 'Fac' ? factor : color.setScalar(factor);
    };
  }
  if (expression.kind === 'to_float') {
    const source = worldField(expression.value, windowCoordinates);
    return (direction) => {
      const value = source(direction);
      if (typeof value === 'number') return value;
      // Blender's default scene-linear Rec.709 -> XYZ Y, from its OCIO config.
      return Math.fround(
        expression.source_type === 'RGBA'
          ? value.x * 0.212639 + value.y * 0.7151687 + value.z * 0.0721923
          : (value.x + value.y + value.z) / 3,
      );
    };
  }
  if (expression.kind === 'math') {
    const inputs = expression.inputs.map((input) => worldField(input, windowCoordinates));
    const operation = worldMath[expression.operation];
    const scalar = (index: number, direction: THREE.Vector3): number => {
      const value = inputs[index]?.(direction) ?? 0;
      if (typeof value !== 'number') throw new Error('World Math needs scalar inputs');
      return Math.fround(value);
    };
    return (direction) => {
      const value = Math.fround(
        operation(scalar(0, direction), scalar(1, direction), scalar(2, direction)),
      );
      return expression.clamp ? THREE.MathUtils.clamp(value, 0, 1) : value;
    };
  }
  if (expression.kind === 'mix_color') {
    const factor = worldField(expression.factor, windowCoordinates);
    const a = worldField(expression.a, windowCoordinates);
    const b = worldField(expression.b, windowCoordinates);
    const color = new THREE.Vector3();
    const second = new THREE.Vector3();
    return (direction) => {
      const amount = factor(direction);
      if (typeof amount !== 'number') throw new Error('World color Mix needs a scalar factor');
      const firstValue = a(direction);
      if (typeof firstValue === 'number') color.setScalar(firstValue);
      else color.copy(firstValue);
      const secondValue = b(direction);
      if (typeof secondValue === 'number') second.setScalar(secondValue);
      else second.copy(secondValue);
      color.lerp(second, expression.clamp_factor ? THREE.MathUtils.clamp(amount, 0, 1) : amount);
      if (expression.clamp_result) color.clampScalar(0, 1);
      return color;
    };
  }
  if (expression.kind === 'sky') {
    // Built ONCE per node: the model precomputes a 512x256 texture, and
    // rebuilding it per direction would be a 65,536-pixel job per texel.
    const field = skyField({
      sunElevation: expression.sun_elevation,
      sunRotation: expression.sun_rotation,
      altitude: expression.altitude,
      airDensity: expression.air_density,
      aerosolDensity: expression.aerosol_density,
      ozoneDensity: expression.ozone_density,
    });
    return (direction) => field(direction);
  }
  if (expression.kind === 'mapping') {
    const source = worldField(expression.vector, windowCoordinates);
    const location = new THREE.Vector3(...expression.location);
    const scale = new THREE.Vector3(...expression.scale);
    const rotation = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          expression.rotation[0],
          expression.rotation[1],
          expression.rotation[2],
          'ZYX',
        ),
    );
    const inverseRotation = rotation.clone().invert();
    const inverseScale = new THREE.Vector3(...expression.scale.map(v => v === 0 ? 0 : 1 / v));
    const value = new THREE.Vector3();
    return (direction) => {
      const input = source(direction);
      if (typeof input === 'number') value.setScalar(input);
      else value.copy(input);
      // Blender's gpu_shader_material_mapping.glsl: texture uses inverse
      // rotation then safe division, normals inverse scale then normalization.
      // A generic inverse matrix is incorrect when a scale component is zero.
      switch (expression.vector_type ?? 'POINT') {
        case 'TEXTURE': return value.sub(location).applyQuaternion(inverseRotation).multiply(inverseScale);
        case 'VECTOR': return value.multiply(scale).applyQuaternion(rotation);
        case 'NORMAL': return value.multiply(inverseScale).applyQuaternion(rotation).normalize();
        case 'POINT': return value.multiply(scale).applyQuaternion(rotation).add(location);
      }
    };
  }
  if (expression.kind === 'map_range') {
    // `intern/cycles/kernel/svm/map_range.h`. Every branch answers 0 when the
    // input range is empty, which is native's own guard and not a tolerance.
    const value = worldField(expression.value, windowCoordinates);
    const fromMin = worldField(expression.from_min, windowCoordinates);
    const fromMax = worldField(expression.from_max, windowCoordinates);
    const toMin = worldField(expression.to_min, windowCoordinates);
    const toMax = worldField(expression.to_max, windowCoordinates);
    const steps = worldField(expression.steps, windowCoordinates);
    const scalar = (f: ReturnType<typeof worldField>, d: THREE.Vector3): number => {
      const got = f(d);
      if (typeof got !== 'number') throw new Error('World Map Range needs scalar inputs');
      return got;
    };
    const mode = expression.interpolation;
    const clamped = expression.clamp;
    return (direction) => {
      const x = scalar(value, direction);
      const a = scalar(fromMin, direction),
        b = scalar(fromMax, direction);
      const lo = scalar(toMin, direction),
        hi = scalar(toMax, direction);
      if (a === b) return 0;
      let factor: number;
      if (mode === 'STEPPED') {
        const n = scalar(steps, direction);
        const raw = (x - a) / (b - a);
        factor = n > 0 ? Math.floor(raw * (n + 1)) / n : 0;
      } else if (mode === 'SMOOTHSTEP' || mode === 'SMOOTHERSTEP') {
        const t = THREE.MathUtils.clamp(
          (x - Math.min(a, b)) / (Math.max(a, b) - Math.min(a, b)),
          0,
          1,
        );
        const shaped =
          mode === 'SMOOTHSTEP' ? t * t * (3 - 2 * t) : t * t * t * (t * (t * 6 - 15) + 10);
        // `fromMin > fromMax` mirrors the curve rather than reversing the ends.
        factor = a > b ? 1 - shaped : shaped;
      } else {
        factor = (x - a) / (b - a);
      }
      const result = lo + factor * (hi - lo);
      if (!clamped) return result;
      return lo > hi
        ? THREE.MathUtils.clamp(result, hi, lo)
        : THREE.MathUtils.clamp(result, lo, hi);
    };
  }
  if (expression.kind === 'separate') {
    const source = worldField(expression.vector, windowCoordinates);
    return (direction) => {
      const input = source(direction);
      return typeof input === 'number' ? input : input.getComponent(expression.axis);
    };
  }
  const factor = worldField(expression.factor, windowCoordinates);
  const value = new THREE.Vector3();
  return (direction) => {
    const input = factor(direction);
    if (typeof input !== 'number') throw new Error('World ColorRamp needs a scalar factor');
    const position = THREE.MathUtils.clamp(input, 0, 1) * 256;
    const index = Math.floor(position);
    const left = expression.colors[index]!;
    const right = expression.colors[Math.min(index + 1, 256)]!;
    const t = expression.interpolate ? position - index : 0;
    return value.set(
      THREE.MathUtils.lerp(left[0], right[0], t),
      THREE.MathUtils.lerp(left[1], right[1], t),
      THREE.MathUtils.lerp(left[2], right[2], t),
    );
  };
}

/** One field, sampled over the equirectangular grid the texture uses. Three
 *  floats per texel, UNSCALED: strength is a multiply the caller applies, and
 *  keeping it out of here is what lets one derivation serve two strengths. */
export function sampleWorldField(
  expression: WorldExpression,
  width: number,
  height: number,
  windowCoordinates?: (direction: THREE.Vector3) => THREE.Vector3,
): Float32Array {
  const samples = new Float32Array(width * height * 3);
  const field = worldField(expression, windowCoordinates);
  const direction = new THREE.Vector3();
  for (let y = 0; y < height; y++) {
    const latitude = ((y + 0.5) / height - 0.5) * Math.PI;
    for (let x = 0; x < width; x++) {
      const longitude = ((x + 0.5) / width - 0.5) * 2 * Math.PI;
      direction.set(
        Math.cos(latitude) * Math.cos(longitude),
        -Math.cos(latitude) * Math.sin(longitude),
        Math.sin(latitude),
      );
      const color = field(direction),
        offset = (y * width + x) * 3;
      samples[offset] = typeof color === 'number' ? color : color.x;
      samples[offset + 1] = typeof color === 'number' ? color : color.y;
      samples[offset + 2] = typeof color === 'number' ? color : color.z;
    }
  }
  return samples;
}

/** Every Sky Texture node in an expression, as the parameters that identify its
 *  precomputed texture. This is the WORK LIST: a caller that must not block the
 *  main thread primes each of these off-thread before it samples anything. */
export function collectSkyParameters(expression: WorldExpression): SkyParameters[] {
  const found: SkyParameters[] = [];
  const walk = (node: WorldExpression): void => {
    if (typeof node === 'number' || Array.isArray(node)) return;
    switch (node.kind) {
      case 'sky':
        found.push({
          sunElevation: node.sun_elevation,
          sunRotation: node.sun_rotation,
          altitude: node.altitude,
          airDensity: node.air_density,
          aerosolDensity: node.aerosol_density,
          ozoneDensity: node.ozone_density,
        });
        return;
      case 'mapping':
      case 'gradient':
      case 'separate':
        walk(node.vector);
        return;
      case 'ramp':
        walk(node.factor);
        return;
      case 'mix_color':
        walk(node.factor);
        walk(node.a);
        walk(node.b);
        return;
      case 'math':
        node.inputs.forEach(walk);
        return;
      case 'to_float':
        walk(node.value);
        return;
      case 'map_range':
        walk(node.value);
        walk(node.from_min);
        walk(node.from_max);
        walk(node.to_min);
        walk(node.to_max);
        walk(node.steps);
        return;
      default:
        return;
    }
  };
  walk(expression);
  return found;
}

/** Whether this expression depends on the camera's normalized image coordinates. */
export function usesWindowCoordinates(expression: WorldExpression): boolean {
  if (typeof expression === 'number' || Array.isArray(expression)) return false;
  switch (expression.kind) {
    case 'window':
      return true;
    case 'mapping':
    case 'gradient':
    case 'separate':
      return usesWindowCoordinates(expression.vector);
    case 'ramp':
      return usesWindowCoordinates(expression.factor);
    case 'mix_color':
      return [expression.factor, expression.a, expression.b].some(usesWindowCoordinates);
    case 'math':
      return expression.inputs.some(usesWindowCoordinates);
    case 'to_float':
      return usesWindowCoordinates(expression.value);
    case 'map_range':
      return [
        expression.value,
        expression.from_min,
        expression.from_max,
        expression.to_min,
        expression.to_max,
        expression.steps,
      ].some(usesWindowCoordinates);
    default:
      return false;
  }
}

/** Camera rays carry pixel coordinates even when orthographic directions are parallel. */
export function sampleWorldScreen(
  expression: WorldExpression,
  width: number,
  height: number,
  camera: THREE.Camera,
): Float32Array {
  camera.updateMatrixWorld();
  const pixels = new Float32Array(width * height * 3);
  const windowPoint = new THREE.Vector3();
  const field = worldField(expression, () => windowPoint);
  const direction = new THREE.Vector3();
  const position = camera.getWorldPosition(new THREE.Vector3());
  const forward = camera.getWorldDirection(new THREE.Vector3());
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width,
        v = (y + 0.5) / height;
      windowPoint.set(u, v, 0);
      if ((camera as THREE.OrthographicCamera).isOrthographicCamera) direction.copy(forward);
      else
        direction
          .set(u * 2 - 1, v * 2 - 1, 0.5)
          .unproject(camera)
          .sub(position)
          .normalize();
      direction.set(direction.x, -direction.z, direction.y);
      const color = field(direction),
        offset = (y * width + x) * 3;
      pixels[offset] = typeof color === 'number' ? color : color.x;
      pixels[offset + 1] = typeof color === 'number' ? color : color.y;
      pixels[offset + 2] = typeof color === 'number' ? color : color.z;
    }
  }
  return pixels;
}
