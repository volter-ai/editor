/**
 * @godot-class CPUParticles3D
 * @role PROTOCOL
 *
 * Godot 4.7's `CPUParticles3D` (`scene/3d/cpu_particles_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): the node's particle simulation, transcribed — each
 * internal process frame advances the system's time, restarts the particles whose phase came round
 * (each drawing its randomness from a `RandomPCG` seeded with the system seed, the particle's index
 * and the cycle), integrates the live ones (gravity, accelerations, damping, angle, scale and colour
 * curves) and writes the multimesh buffer (per particle a 3x4 transform, a colour and four custom
 * values). A scene declares one as `<GodotCPUParticles3D>`: the buffer is drawn as a three
 * `InstancedMesh` of the particle mesh. Real values are `real_t` (float), times `double`.
 *
 * Drawn: the instance transforms, and the colour as three's instance colour when the mesh's material
 * uses vertex colour as albedo (`vertex_color_use_as_albedo`); three's instance colour has no alpha,
 * so a particle's colour alpha is not drawn (`particle-alpha`, a named deviation). Not transcribed:
 * the draw orders other than by index, `request_particles_process`, sub-emitters.
 */

import type { ReactElement } from 'react';
import { Color as ThreeColor, Group, InstancedMesh, Matrix4, type Object3D } from 'three';
import { godot_base_material_3d_three } from './base-material-3d';
import { type Color, construct as color } from './color';
import { type Curve, godot_curve_ensure_default_setup, sample as curveSample } from './curve';
import { randi } from './global-scope';
import { type Gradient, sample as gradientSample } from './gradient';
import { get_process_delta_time, godot_node_foreign, godot_node_set_internal_process, godot_node_tree_signal, is_inside_tree } from './node';
import { get_global_transform } from './node-3d';
import { godot_primitive_mesh_geometry, get_material, type PrimitiveMesh } from './primitive-mesh';
import { type GodotElementClass, type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { godot_random_pcg_new, godot_random_pcg_randf, godot_random_pcg_seed, type RandomPCG } from './random-pcg';
import type { Transform3D } from './transform-3d';
import { construct as vector3, type Vector3 } from './vector3';

const f32 = Math.fround;
const CMP_EPSILON = 0.00001;
const PI = 3.1415926535897932384626433833;
const TAU = 6.2831853071795864769252867666;
/** `CPUParticles3D::Parameter` (`cpu_particles_3d.h:52`). */
const PARAM_INITIAL_LINEAR_VELOCITY = 0;
const PARAM_ANGULAR_VELOCITY = 1;
const PARAM_ORBIT_VELOCITY = 2;
const PARAM_LINEAR_ACCEL = 3;
const PARAM_RADIAL_ACCEL = 4;
const PARAM_TANGENTIAL_ACCEL = 5;
const PARAM_DAMPING = 6;
const PARAM_ANGLE = 7;
const PARAM_SCALE = 8;
const PARAM_HUE_VARIATION = 9;
const PARAM_ANIM_SPEED = 10;
const PARAM_ANIM_OFFSET = 11;
const PARAM_MAX = 12;
/** `CPUParticles3D::ParticleFlags` (`cpu_particles_3d.h:68`). */
const FLAG_ALIGN_Y_TO_VELOCITY = 0;
const FLAG_ROTATE_Y = 1;
const FLAG_DISABLE_Z = 2;
/** `CPUParticles3D::EmissionShape` (`cpu_particles_3d.h:75`). */
const SHAPE_POINT = 0;
const SHAPE_SPHERE = 1;
const SHAPE_SPHERE_SURFACE = 2;
const SHAPE_BOX = 3;
const SHAPE_POINTS = 4;
const SHAPE_DIRECTED_POINTS = 5;
const SHAPE_RING = 6;

type V3 = [number, number, number];
/** A 3x4 transform: `rows` of the basis, and the origin. */
interface T3 {
  rows: [V3, V3, V3];
  origin: V3;
}

interface Particle {
  transform: T3;
  color: Color;
  custom: [number, number, number, number];
  velocity: V3;
  active: boolean;
  angle_rand: number;
  scale_rand: number;
  hue_rot_rand: number;
  anim_offset_rand: number;
  start_color_rand: Color;
  time: number;
  lifetime: number;
  base_color: Color;
  seed: number;
}

export interface CPUParticles3D {
  emitting: boolean;
  active: boolean;
  particles: Particle[];
  data: Float32Array;
  time: number;
  frame_remainder: number;
  cycle: number;
  one_shot: boolean;
  lifetime: number;
  pre_process_time: number;
  explosiveness_ratio: number;
  randomness_ratio: number;
  lifetime_randomness: number;
  speed_scale: number;
  local_coords: boolean;
  fixed_fps: number;
  fractional_delta: boolean;
  seed: number;
  use_fixed_seed: boolean;
  direction: Vector3;
  spread: number;
  flatness: number;
  parameters_min: number[];
  parameters_max: number[];
  curve_parameters: (Curve | null)[];
  color: Color;
  color_ramp: Gradient | null;
  color_initial_ramp: Gradient | null;
  particle_flags: [boolean, boolean, boolean];
  emission_shape: number;
  emission_sphere_radius: number;
  emission_box_extents: Vector3;
  emission_points: Vector3[];
  emission_normals: Vector3[];
  emission_colors: Color[];
  emission_ring_axis: Vector3;
  emission_ring_height: number;
  emission_ring_radius: number;
  emission_ring_inner_radius: number;
  emission_ring_cone_angle: number;
  split_scale: boolean;
  scale_curve: [Curve | null, Curve | null, Curve | null];
  gravity: Vector3;
  mesh: PrimitiveMesh | null;
  inv_emission_transform: T3;
  rng: RandomPCG;
  redraw: boolean;
  /** The particles as three draws them: an instance per particle of the mesh, made as it first draws. */
  drawn: InstancedMesh | null;
  /** The buffer as last handed to the renderer (`multimesh_set_buffer`); empty before the first update. */
  pushed: Float32Array;
}

const STATE = new WeakMap<object, CPUParticles3D>();

function stateOf(self: object, member: string): CPUParticles3D {
  const state = STATE.get(self);
  if (state === undefined) throw new TypeError(`godot-compat: CPUParticles3D.${member} requires a CPUParticles3D.`);
  return state;
}

const identity = (): T3 => ({ rows: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], origin: [0, 0, 0] });

/** The node's global transform as rows and origin, in float. */
function transformOf(value: Transform3D): T3 {
  const b = value.basis;
  return {
    rows: [
      [f32(b.x.x), f32(b.y.x), f32(b.z.x)],
      [f32(b.x.y), f32(b.y.y), f32(b.z.y)],
      [f32(b.x.z), f32(b.y.z), f32(b.z.z)],
    ],
    origin: [f32(value.origin.x), f32(value.origin.y), f32(value.origin.z)],
  };
}

// Float vector arithmetic in Godot's operand order.
const add = (a: V3, b: V3): V3 => [f32(a[0] + b[0]), f32(a[1] + b[1]), f32(a[2] + b[2])];
const sub = (a: V3, b: V3): V3 => [f32(a[0] - b[0]), f32(a[1] - b[1]), f32(a[2] - b[2])];
const mul = (a: V3, s: number): V3 => [f32(a[0] * s), f32(a[1] * s), f32(a[2] * s)];
const mulv = (a: V3, b: V3): V3 => [f32(a[0] * b[0]), f32(a[1] * b[1]), f32(a[2] * b[2])];
const dot = (a: V3, b: V3): number => f32(f32(f32(a[0] * b[0]) + f32(a[1] * b[1])) + f32(a[2] * b[2]));
const cross = (a: V3, b: V3): V3 => [
  f32(f32(a[1] * b[2]) - f32(a[2] * b[1])),
  f32(f32(a[2] * b[0]) - f32(a[0] * b[2])),
  f32(f32(a[0] * b[1]) - f32(a[1] * b[0])),
];
const lengthSquared = (a: V3): number => dot(a, a);
const length = (a: V3): number => f32(Math.sqrt(lengthSquared(a)));
/** `Vector3::normalize` (`core/math/vector3.h:548`). */
function normalized(a: V3): V3 {
  const l = lengthSquared(a);
  if (l === 0) return [0, 0, 0];
  const s = f32(Math.sqrt(l));
  return [f32(a[0] / s), f32(a[1] / s), f32(a[2] / s)];
}
const column = (t: T3, i: number): V3 => [t.rows[0][i] as number, t.rows[1][i] as number, t.rows[2][i] as number];
function setColumn(t: T3, i: number, v: V3): void {
  t.rows[0][i] = v[0];
  t.rows[1][i] = v[1];
  t.rows[2][i] = v[2];
}
/** `Basis::xform`: each row dotted with the vector. */
const xform = (t: T3, v: V3): V3 => [dot(t.rows[0], v), dot(t.rows[1], v), dot(t.rows[2], v)];
/** `Transform3D::operator*` (`core/math/transform_3d.h`): origin transformed, then the bases multiplied. */
function multiply(a: T3, b: T3): T3 {
  const origin = add(xform(a, b.origin), a.origin);
  // `Basis::operator*=`: `set(p.tdotx(rows[0]), p.tdoty(rows[0]), …)`.
  const tdot = (row: V3, c: number): number =>
    f32(f32(f32((b.rows[0][c] as number) * row[0]) + f32((b.rows[1][c] as number) * row[1])) + f32((b.rows[2][c] as number) * row[2]));
  const rows = a.rows.map((row) => [tdot(row, 0), tdot(row, 1), tdot(row, 2)] as V3) as [V3, V3, V3];
  return { rows, origin };
}
/** `Basis::orthonormalize` (`core/math/basis.cpp:56`): Gram-Schmidt on the columns. */
function orthonormalize(t: T3): void {
  const x = normalized(column(t, 0));
  const y = normalized(sub(column(t, 1), mul(x, dot(x, column(t, 1)))));
  const z = normalized(sub(sub(column(t, 2), mul(x, dot(x, column(t, 2)))), mul(y, dot(y, column(t, 2)))));
  setColumn(t, 0, x);
  setColumn(t, 1, y);
  setColumn(t, 2, z);
}
/** `Basis::affine_inverse` of an invertible transform (`Transform3D::affine_inverse`). */
function affineInverse(t: T3): T3 {
  const [r0, r1, r2] = t.rows;
  const co = [
    f32(f32(r1[1] * r2[2]) - f32(r1[2] * r2[1])),
    f32(f32(r1[2] * r2[0]) - f32(r1[0] * r2[2])),
    f32(f32(r1[0] * r2[1]) - f32(r1[1] * r2[0])),
  ];
  const det = f32(f32(f32(r0[0] * (co[0] as number)) + f32(r0[1] * (co[1] as number))) + f32(r0[2] * (co[2] as number)));
  const s = f32(1 / det);
  const rows: [V3, V3, V3] = [
    [f32((co[0] as number) * s), f32(f32(f32(r0[2] * r2[1]) - f32(r0[1] * r2[2])) * s), f32(f32(f32(r0[1] * r1[2]) - f32(r0[2] * r1[1])) * s)],
    [f32((co[1] as number) * s), f32(f32(f32(r0[0] * r2[2]) - f32(r0[2] * r2[0])) * s), f32(f32(f32(r0[2] * r1[0]) - f32(r0[0] * r1[2])) * s)],
    [f32((co[2] as number) * s), f32(f32(f32(r0[1] * r2[0]) - f32(r0[0] * r2[1])) * s), f32(f32(f32(r0[0] * r1[1]) - f32(r0[1] * r1[0])) * s)],
  ];
  const inverse = { rows, origin: [0, 0, 0] as V3 };
  inverse.origin = xform(inverse, [f32(-t.origin[0]), f32(-t.origin[1]), f32(-t.origin[2])]);
  return inverse;
}

const lerp = (from: number, to: number, weight: number): number => f32(from + f32(f32(to - from) * weight));
const degToRad = (value: number): number => f32(value * f32(f32(PI) / 180));
const sinf = (value: number): number => f32(Math.sin(value));
const cosf = (value: number): number => f32(Math.cos(value));
const v3 = (value: Vector3): V3 => [f32(value.x), f32(value.y), f32(value.z)];

/** `idhash` (`cpu_particles_3d.cpp:634`). */
function idhash(value: number): number {
  let x = value >>> 0;
  x = Math.imul(((x >>> 16) ^ x) >>> 0, 0x45d9f3b) >>> 0;
  x = Math.imul(((x >>> 16) ^ x) >>> 0, 0x45d9f3b) >>> 0;
  return ((x >>> 16) ^ x) >>> 0;
}

/** `rand_from_seed` (`cpu_particles_3d.cpp:641`): Park–Miller over the particle's own seed. */
function randFromSeed(seed: { value: number }): number {
  let s = seed.value | 0;
  if (s === 0) s = 305420679;
  const k = Math.trunc(s / 127773);
  s = (Math.imul(16807, s - Math.imul(k, 127773)) - Math.imul(2836, k)) | 0;
  if (s < 0) s = (s + 2147483647) | 0;
  seed.value = s >>> 0;
  return f32((seed.value % 65536) / 65535.0);
}

function colorMul(a: Color, b: Color): Color {
  return color(f32(a.r * b.r), f32(a.g * b.g), f32(a.b * b.b), f32(a.a * b.a));
}

/** `CPUParticles3D::_particles_process` (`cpu_particles_3d.cpp:759`). */
function particlesProcess(entity: object, s: CPUParticles3D, p_delta: number): void {
  const delta = p_delta * s.speed_scale;
  const pcount = s.particles.length;
  const prev_time = s.time;
  s.time += delta;
  if (s.time > s.lifetime) {
    s.time = s.time % s.lifetime;
    s.cycle += 1;
    if (s.one_shot && s.cycle > 0) set_emitting(entity, false);
  }
  let emission_xform = identity();
  let velocity_xform = identity();
  if (!s.local_coords) {
    emission_xform = transformOf(get_global_transform(entity as Object3D));
    velocity_xform = { rows: emission_xform.rows, origin: [0, 0, 0] };
  }
  const system_phase = s.time / s.lifetime;
  let should_be_active = false;
  const min = s.parameters_min;
  const max = s.parameters_max;
  const curve = (param: number): Curve | null => s.curve_parameters[param] ?? null;
  const flags = s.particle_flags;
  for (let i = 0; i < pcount; i += 1) {
    const p = s.particles[i] as Particle;
    if (!s.emitting && !p.active) continue;
    let local_delta = delta;
    let restart_phase = i / pcount;
    if (s.randomness_ratio > 0) {
      let seed = s.cycle >>> 0;
      if (restart_phase >= system_phase) seed = (seed - 1) >>> 0;
      seed = Math.imul(seed, pcount) >>> 0;
      seed = (seed + i) >>> 0;
      const random = (idhash(seed) % 65536) / 65536.0;
      restart_phase += (s.randomness_ratio * random * 1.0) / pcount;
    }
    restart_phase *= 1.0 - s.explosiveness_ratio;
    const restart_time = restart_phase * s.lifetime;
    let restart = false;
    if (s.time > prev_time) {
      if (restart_time >= prev_time && restart_time < s.time) {
        restart = true;
        if (s.fractional_delta) local_delta = s.time - restart_time;
      }
    } else if (local_delta > 0) {
      if (restart_time >= prev_time) {
        restart = true;
        if (s.fractional_delta) local_delta = s.lifetime - restart_time + s.time;
      } else if (restart_time < s.time) {
        restart = true;
        if (s.fractional_delta) local_delta = s.time - restart_time;
      }
    }
    if (p.time * (1.0 - s.explosiveness_ratio) > p.lifetime) restart = true;
    let tv = 0;
    if (restart) {
      if (!s.emitting) {
        p.active = false;
        continue;
      }
      p.active = true;
      const angleCurve = curve(PARAM_ANGLE);
      const tex_angle = angleCurve !== null ? curveSample(angleCurve, tv) : 1;
      const tex_anim_offset = angleCurve !== null ? curveSample(angleCurve, tv) : 1;
      p.seed = (((s.seed + 1) >>> 0) + i + Math.imul(s.cycle, pcount)) >>> 0;
      godot_random_pcg_seed(s.rng, p.seed);
      const randf = (): number => godot_random_pcg_randf(s.rng);
      p.angle_rand = randf();
      p.scale_rand = randf();
      p.hue_rot_rand = randf();
      p.anim_offset_rand = randf();
      p.start_color_rand = s.color_initial_ramp !== null ? gradientSample(s.color_initial_ramp, randf()) : color(1, 1, 1, 1);
      if (flags[FLAG_DISABLE_Z]) {
        const dir = v3(s.direction);
        const angle1_rad = f32(f32(Math.atan2(dir[1], dir[0])) + (randf() * 2.0 - 1.0) * s.spread * (PI / 180.0));
        const rot: V3 = [cosf(angle1_rad), sinf(angle1_rad), 0];
        p.velocity = mul(rot, lerp(min[PARAM_INITIAL_LINEAR_VELOCITY] as number, max[PARAM_INITIAL_LINEAR_VELOCITY] as number, randf()));
      } else {
        const angle1_rad = degToRad(f32(f32(f32(randf() * 2) - 1) * s.spread));
        const angle2_rad = degToRad(f32(f32(f32(f32(randf() * 2) - 1) * f32(1 - s.flatness)) * s.spread));
        const direction_xz: V3 = [sinf(angle1_rad), 0, cosf(angle1_rad)];
        const direction_yz: V3 = [0, sinf(angle2_rad), cosf(angle2_rad)];
        const spread_direction: V3 = [f32(direction_xz[0] * direction_yz[2]), direction_yz[1], f32(direction_xz[2] * direction_yz[2])];
        let direction_nrm = v3(s.direction);
        direction_nrm = lengthSquared(direction_nrm) > 0 ? normalized(direction_nrm) : [0, 0, 1];
        let binormal = cross([0, 1, 0], direction_nrm);
        if (lengthSquared(binormal) < 0.00000001) binormal = [0, 0, 1];
        binormal = normalized(binormal);
        const normal = cross(binormal, direction_nrm);
        const spread = add(add(mul(binormal, spread_direction[0]), mul(normal, spread_direction[1])), mul(direction_nrm, spread_direction[2]));
        p.velocity = mul(spread, lerp(min[PARAM_INITIAL_LINEAR_VELOCITY] as number, max[PARAM_INITIAL_LINEAR_VELOCITY] as number, randf()));
      }
      const base_angle = f32(tex_angle * lerp(min[PARAM_ANGLE] as number, max[PARAM_ANGLE] as number, p.angle_rand));
      p.custom[0] = degToRad(base_angle);
      p.custom[1] = 0;
      p.custom[2] = f32(tex_anim_offset * lerp(min[PARAM_ANIM_OFFSET] as number, max[PARAM_ANIM_OFFSET] as number, p.anim_offset_rand));
      p.custom[3] = f32(1.0 - randf() * s.lifetime_randomness);
      p.transform = identity();
      p.time = 0;
      p.lifetime = s.lifetime * p.custom[3];
      p.base_color = color(1, 1, 1, 1);
      switch (s.emission_shape) {
        case SHAPE_SPHERE: {
          const sv = f32(f32(2 * randf()) - 1);
          const t = f32(TAU * randf());
          const x = randf();
          const radius = f32(s.emission_sphere_radius * Math.sqrt(1.0 - f32(sv * sv)));
          // `Vector3::lerp` from zero.
          const to: V3 = [f32(radius * cosf(t)), f32(radius * sinf(t)), f32(s.emission_sphere_radius * sv)];
          p.transform.origin = [f32(0 + f32(to[0] * x)), f32(0 + f32(to[1] * x)), f32(0 + f32(to[2] * x))];
          break;
        }
        case SHAPE_SPHERE_SURFACE: {
          const sv = f32(f32(2 * randf()) - 1);
          const t = f32(TAU * randf());
          const radius = f32(s.emission_sphere_radius * Math.sqrt(1.0 - f32(sv * sv)));
          p.transform.origin = [f32(radius * cosf(t)), f32(radius * sinf(t)), f32(s.emission_sphere_radius * sv)];
          break;
        }
        case SHAPE_BOX: {
          const a = f32(f32(randf() * 2) - 1);
          const b = f32(f32(randf() * 2) - 1);
          const c = f32(f32(randf() * 2) - 1);
          p.transform.origin = mulv([a, b, c], v3(s.emission_box_extents));
          break;
        }
        case SHAPE_POINTS:
        case SHAPE_DIRECTED_POINTS: {
          const pc = s.emission_points.length;
          if (pc === 0) break;
          const index = randi() % pc;
          p.transform.origin = v3(s.emission_points[index] as Vector3);
          if (s.emission_shape === SHAPE_DIRECTED_POINTS && s.emission_normals.length === pc) {
            if (flags[FLAG_DISABLE_Z]) throw new Error('godot-compat: directed points with Z disabled are not transcribed.');
            const n = v3(s.emission_normals[index] as Vector3);
            const v0: V3 = Math.abs(n[2]) < 0.999 ? [0, 0, 1] : [0, 1, 0];
            const tangent = normalized(cross(v0, n));
            const bitangent = normalized(cross(tangent, n));
            const m3: T3 = identity();
            setColumn(m3, 0, tangent);
            setColumn(m3, 1, bitangent);
            setColumn(m3, 2, n);
            p.velocity = xform(m3, p.velocity);
          }
          if (s.emission_colors.length === pc) p.base_color = s.emission_colors[index] as Color;
          break;
        }
        case SHAPE_RING:
          throw new Error('godot-compat: the ring emission shape is not transcribed.');
        default:
          break;
      }
      if (!s.local_coords) {
        p.velocity = xform(velocity_xform, p.velocity);
        p.transform = multiply(emission_xform, p.transform);
      }
      if (flags[FLAG_DISABLE_Z]) {
        p.velocity[2] = 0;
        p.transform.origin[2] = 0;
      }
    } else if (!p.active) {
      continue;
    } else if (p.time > p.lifetime) {
      p.active = false;
      tv = 1;
    } else {
      const alt_seed = { value: p.seed };
      p.time += local_delta;
      p.custom[1] = f32(p.time / s.lifetime);
      tv = f32(p.time / p.lifetime);
      const sampled = (param: number): number => {
        const c = curve(param);
        return c !== null ? curveSample(c, tv) : 1;
      };
      const tex_linear_velocity = sampled(PARAM_INITIAL_LINEAR_VELOCITY);
      const tex_orbit_velocity = flags[FLAG_DISABLE_Z] ? sampled(PARAM_ORBIT_VELOCITY) : 1;
      const tex_angular_velocity = sampled(PARAM_ANGULAR_VELOCITY);
      const tex_linear_accel = sampled(PARAM_LINEAR_ACCEL);
      const tex_tangential_accel = sampled(PARAM_TANGENTIAL_ACCEL);
      const tex_radial_accel = sampled(PARAM_RADIAL_ACCEL);
      const tex_damping = sampled(PARAM_DAMPING);
      const tex_angle = sampled(PARAM_ANGLE);
      const tex_anim_speed = sampled(PARAM_ANIM_SPEED);
      const tex_anim_offset = sampled(PARAM_ANIM_OFFSET);
      let force = v3(s.gravity);
      const position: V3 = [...p.transform.origin];
      if (flags[FLAG_DISABLE_Z]) position[2] = 0;
      force = add(
        force,
        length(p.velocity) > 0
          ? mul(mul(normalized(p.velocity), tex_linear_accel), lerp(min[PARAM_LINEAR_ACCEL] as number, max[PARAM_LINEAR_ACCEL] as number, randFromSeed(alt_seed)))
          : [0, 0, 0],
      );
      const org = emission_xform.origin;
      const diff = sub(position, org);
      force = add(
        force,
        length(diff) > 0
          ? mul(mul(normalized(diff), tex_radial_accel), lerp(min[PARAM_RADIAL_ACCEL] as number, max[PARAM_RADIAL_ACCEL] as number, randFromSeed(alt_seed)))
          : [0, 0, 0],
      );
      if (flags[FLAG_DISABLE_Z]) {
        const yx: [number, number] = [diff[1], diff[0]];
        const yx2Len = f32(Math.sqrt(f32(f32(yx[0] * yx[0]) + f32(yx[1] * yx[1]))));
        const yx2: [number, number] = yx2Len === 0 ? [0, 0] : [f32(f32(-yx[0]) / yx2Len), f32(yx[1] / yx2Len)];
        force = add(
          force,
          yx2Len > 0
            ? mul([yx2[0], yx2[1], 0], f32(tex_tangential_accel * lerp(min[PARAM_TANGENTIAL_ACCEL] as number, max[PARAM_TANGENTIAL_ACCEL] as number, randFromSeed(alt_seed))))
            : [0, 0, 0],
        );
      } else {
        const crossDiff = cross(normalized(diff), normalized(v3(s.gravity)));
        force = add(
          force,
          length(crossDiff) > 0
            ? mul(normalized(crossDiff), f32(tex_tangential_accel * lerp(min[PARAM_TANGENTIAL_ACCEL] as number, max[PARAM_TANGENTIAL_ACCEL] as number, randFromSeed(alt_seed))))
            : [0, 0, 0],
        );
      }
      p.velocity = add(p.velocity, mul(force, f32(local_delta)));
      if (flags[FLAG_DISABLE_Z]) {
        const orbit_amount = f32(tex_orbit_velocity * lerp(min[PARAM_ORBIT_VELOCITY] as number, max[PARAM_ORBIT_VELOCITY] as number, randFromSeed(alt_seed)));
        if (orbit_amount !== 0) throw new Error('godot-compat: orbit velocity with Z disabled is not transcribed.');
      }
      if (curve(PARAM_INITIAL_LINEAR_VELOCITY) !== null) p.velocity = mul(normalized(p.velocity), tex_linear_velocity);
      if (f32((max[PARAM_DAMPING] as number) + tex_damping) > 0) {
        let v = length(p.velocity);
        const damp = f32(tex_damping * lerp(min[PARAM_DAMPING] as number, max[PARAM_DAMPING] as number, randFromSeed(alt_seed)));
        v = f32(v - damp * local_delta);
        p.velocity = v < 0 ? [0, 0, 0] : mul(normalized(p.velocity), v);
      }
      let base_angle = f32(tex_angle * lerp(min[PARAM_ANGLE] as number, max[PARAM_ANGLE] as number, p.angle_rand));
      base_angle = f32(
        base_angle +
          p.custom[1] * s.lifetime * tex_angular_velocity * lerp(min[PARAM_ANGULAR_VELOCITY] as number, max[PARAM_ANGULAR_VELOCITY] as number, randFromSeed(alt_seed)),
      );
      p.custom[0] = degToRad(base_angle);
      p.custom[2] = f32(
        f32(tex_anim_offset * lerp(min[PARAM_ANIM_OFFSET] as number, max[PARAM_ANIM_OFFSET] as number, p.anim_offset_rand)) +
          f32(f32(tv * tex_anim_speed) * lerp(min[PARAM_ANIM_SPEED] as number, max[PARAM_ANIM_SPEED] as number, randFromSeed(alt_seed))),
      );
    }
    // Scale.
    let tex_scale: V3 = [1, 1, 1];
    if (s.split_scale) {
      tex_scale = s.scale_curve.map((c) => (c !== null ? curveSample(c, tv) : 1)) as V3;
    } else {
      const c = curve(PARAM_SCALE);
      if (c !== null) {
        const tmp = curveSample(c, tv);
        tex_scale = [tmp, tmp, tmp];
      }
    }
    // Colour, with the hue rotated (`hue_rot_mat`).
    const hueCurve = curve(PARAM_HUE_VARIATION);
    const tex_hue_variation = hueCurve !== null ? curveSample(hueCurve, tv) : 0;
    const hue_rot_angle = f32(tex_hue_variation * TAU * lerp(min[PARAM_HUE_VARIATION] as number, max[PARAM_HUE_VARIATION] as number, p.hue_rot_rand));
    const hue_rot_c = cosf(hue_rot_angle);
    const hue_rot_s = sinf(hue_rot_angle);
    const mat1: [V3, V3, V3] = [[0.299, 0.587, 0.114], [0.299, 0.587, 0.114], [0.299, 0.587, 0.114]].map((r) => r.map(f32)) as [V3, V3, V3];
    const mat2: [V3, V3, V3] = [[0.701, -0.587, -0.114], [-0.299, 0.413, -0.114], [-0.3, -0.588, 0.886]].map((r) => r.map(f32)) as [V3, V3, V3];
    const mat3: [V3, V3, V3] = [[0.168, 0.33, -0.497], [-0.328, 0.035, 0.292], [1.25, -1.05, -0.203]].map((r) => r.map(f32)) as [V3, V3, V3];
    const hue: T3 = { rows: [0, 1, 2].map((j) => add(add(mat1[j] as V3, mul(mat2[j] as V3, hue_rot_c)), mul(mat3[j] as V3, hue_rot_s))) as [V3, V3, V3], origin: [0, 0, 0] };
    p.color = s.color_ramp !== null ? colorMul(gradientSample(s.color_ramp, tv), s.color) : s.color;
    // `Basis::xform_inv`: the columns dotted with the vector.
    const rgb: V3 = [p.color.r, p.color.g, p.color.b];
    const inv: V3 = [dot(column(hue, 0), rgb), dot(column(hue, 1), rgb), dot(column(hue, 2), rgb)];
    p.color = colorMul(color(inv[0], inv[1], inv[2], p.color.a), colorMul(p.base_color, p.start_color_rand));
    // Orientation.
    if (flags[FLAG_DISABLE_Z]) {
      if (flags[FLAG_ALIGN_Y_TO_VELOCITY]) {
        if (length(p.velocity) > 0) setColumn(p.transform, 1, normalized(p.velocity));
        setColumn(p.transform, 0, normalized(cross(column(p.transform, 1), column(p.transform, 2))));
        setColumn(p.transform, 2, [0, 0, 1]);
      } else {
        setColumn(p.transform, 0, [cosf(p.custom[0]), f32(-sinf(p.custom[0])), 0]);
        setColumn(p.transform, 1, [sinf(p.custom[0]), cosf(p.custom[0]), 0]);
        setColumn(p.transform, 2, [0, 0, 1]);
      }
    } else {
      if (flags[FLAG_ALIGN_Y_TO_VELOCITY]) {
        if (length(p.velocity) > 0) setColumn(p.transform, 1, normalized(p.velocity));
        else setColumn(p.transform, 1, normalized(column(p.transform, 1)));
        const c0 = column(p.transform, 0);
        const c1 = column(p.transform, 1);
        if (c1[0] === c0[0] && c1[1] === c0[1] && c1[2] === c0[2]) {
          setColumn(p.transform, 0, normalized(cross(column(p.transform, 1), column(p.transform, 2))));
          setColumn(p.transform, 2, normalized(cross(column(p.transform, 0), column(p.transform, 1))));
        } else {
          setColumn(p.transform, 2, normalized(cross(column(p.transform, 0), column(p.transform, 1))));
          setColumn(p.transform, 0, normalized(cross(column(p.transform, 1), column(p.transform, 2))));
        }
      } else {
        orthonormalize(p.transform);
      }
      if (flags[FLAG_ROTATE_Y]) {
        // `Basis(Vector3(0, 1, 0), angle)`: a rotation about Y.
        const c = cosf(p.custom[0]);
        const sn = sinf(p.custom[0]);
        p.transform.rows = [[c, 0, sn], [0, 1, 0], [f32(-sn), 0, c]];
      }
    }
    orthonormalize(p.transform);
    const base_scale = mul(tex_scale, lerp(min[PARAM_SCALE] as number, max[PARAM_SCALE] as number, p.scale_rand));
    for (let k = 0; k < 3; k += 1) if ((base_scale[k] as number) < CMP_EPSILON) base_scale[k] = f32(CMP_EPSILON);
    // `Basis::scale`: each row by its component.
    p.transform.rows = [mul(p.transform.rows[0], base_scale[0]), mul(p.transform.rows[1], base_scale[1]), mul(p.transform.rows[2], base_scale[2])];
    if (flags[FLAG_DISABLE_Z]) {
      p.velocity[2] = 0;
      p.transform.origin[2] = 0;
    }
    p.transform.origin = add(p.transform.origin, mul(p.velocity, f32(local_delta)));
    should_be_active = true;
  }
  if (!(Math.abs(s.time) < CMP_EPSILON) && s.active && !should_be_active) {
    s.active = false;
    godot_cpu_particles_3d_finished_emit(entity);
  }
}

/** `_update_particle_data_buffer` (`cpu_particles_3d.cpp:1270`), in index order. */
function updateBuffer(entity: object, s: CPUParticles3D): void {
  const data = s.data;
  s.particles.forEach((p, i) => {
    const t = s.local_coords ? p.transform : multiply(s.inv_emission_transform, p.transform);
    const at = i * 20;
    if (p.active) {
      data.set([t.rows[0][0], t.rows[0][1], t.rows[0][2], t.origin[0], t.rows[1][0], t.rows[1][1], t.rows[1][2], t.origin[1], t.rows[2][0], t.rows[2][1], t.rows[2][2], t.origin[2]], at);
    } else {
      data.fill(0, at, at + 12);
    }
    data.set([p.color.r, p.color.g, p.color.b, p.color.a, ...p.custom], at + 12);
  });
  s.pushed = data.slice();
  draw(entity, s);
}

const scratch = new Matrix4();
const scratchColor = new ThreeColor();

/**
 * The buffer drawn (`_update_render_thread`, `cpu_particles_3d.cpp:1382`): each particle's rows as an
 * instance matrix of an `InstancedMesh` of the mesh, a child the Node protocol does not count; its
 * colour as the instance colour where the material takes vertex colour as albedo (no alpha).
 */
function draw(entity: object, s: CPUParticles3D): void {
  if (s.mesh === null) return;
  const count = s.particles.length;
  if (s.drawn === null || s.drawn.count !== count) {
    if (s.drawn !== null) (entity as Object3D).remove(s.drawn);
    const source = get_material(s.mesh);
    const drawn = new InstancedMesh(godot_primitive_mesh_geometry(s.mesh), source === null ? undefined : godot_base_material_3d_three(source as never), count);
    drawn.frustumCulled = false;
    godot_node_foreign(drawn);
    (entity as Object3D).add(drawn);
    s.drawn = drawn;
  }
  const drawn = s.drawn;
  const colored = (drawn.material as { vertexColors?: boolean }).vertexColors === true;
  const d = s.data;
  for (let i = 0; i < count; i += 1) {
    const at = i * 20;
    scratch.set(d[at] as number, d[at + 1] as number, d[at + 2] as number, d[at + 3] as number, d[at + 4] as number, d[at + 5] as number, d[at + 6] as number, d[at + 7] as number, d[at + 8] as number, d[at + 9] as number, d[at + 10] as number, d[at + 11] as number, 0, 0, 0, 1);
    drawn.setMatrixAt(i, scratch);
    if (colored) drawn.setColorAt(i, scratchColor.setRGB(d[at + 12] as number, d[at + 13] as number, d[at + 14] as number));
  }
  drawn.visible = s.redraw;
  drawn.instanceMatrix.needsUpdate = true;
  if (drawn.instanceColor !== null) drawn.instanceColor.needsUpdate = true;
}

/** `Node3D::is_visible_in_tree`: the node and every ancestor visible. */
function visibleInTree(entity: object): boolean {
  for (let at: Object3D | null = entity as Object3D; at !== null; at = at.parent) if (!at.visible) return false;
  return is_inside_tree(entity);
}

/** `_set_redraw` (`cpu_particles_3d.cpp:1359`): whether the instances are drawn. */
function setRedraw(s: CPUParticles3D, redraw: boolean): void {
  s.redraw = redraw;
  if (s.drawn !== null) s.drawn.visible = redraw;
}

/** `CPUParticles3D::_update_internal` (`cpu_particles_3d.cpp:656`). */
function updateInternal(entity: object, s: CPUParticles3D): void {
  if (s.particles.length === 0 || !visibleInTree(entity)) {
    setRedraw(s, false);
    return;
  }
  const delta = get_process_delta_time(entity);
  if (!s.active && !s.emitting) {
    godot_node_set_internal_process(entity, undefined);
    setRedraw(s, false);
    s.time = 0;
    s.frame_remainder = 0;
    s.cycle = 0;
    return;
  }
  setRedraw(s, true);
  let processed = false;
  if (s.time === 0 && s.pre_process_time > 0) {
    const frame_time = s.fixed_fps > 0 ? f32(1.0 / s.fixed_fps) : f32(1.0 / 30.0);
    const scale = s.speed_scale;
    s.speed_scale = 1;
    let todo = f32(s.pre_process_time);
    while (todo > 0) {
      particlesProcess(entity, s, frame_time > todo ? todo : frame_time);
      todo = f32(todo - frame_time);
    }
    s.speed_scale = scale;
    processed = true;
  }
  if (s.fixed_fps > 0) {
    const frame_time = 1.0 / s.fixed_fps;
    const ldelta = delta > 0.1 ? 0.1 : delta < 0 ? 0 : delta;
    let todo = s.frame_remainder + ldelta;
    while (todo >= frame_time) {
      particlesProcess(entity, s, frame_time);
      processed = true;
      todo -= frame_time;
    }
    s.frame_remainder = todo;
  } else {
    particlesProcess(entity, s, delta);
    processed = true;
  }
  if (processed) updateBuffer(entity, s);
}

const FINISHED = new WeakMap<object, Set<() => void>>();

/** The `finished` signal's listeners are called once the system has no active particle left. */
function godot_cpu_particles_3d_finished_emit(entity: object): void {
  for (const listener of [...(FINISHED.get(entity) ?? [])]) listener();
}

/**
 * The `finished` signal (`CPUParticles3D::_particles_process`, `cpu_particles_3d.cpp:1266`).
 *
 * @godot CPUParticles3D (protocol)
 * @source scene/3d/cpu_particles_3d.cpp:1266
 */
export function godot_cpu_particles_3d_finished(self: object): { connect(listener: () => void): { disconnect(): void } } {
  return {
    connect(listener) {
      const listeners = FINISHED.get(self) ?? new Set();
      listeners.add(listener);
      FINISHED.set(self, listeners);
      return { disconnect: () => listeners.delete(listener) };
    },
  };
}

function particle(): Particle {
  return {
    transform: identity(),
    color: color(0, 0, 0, 1),
    custom: [0, 0, 0, 1],
    velocity: [0, 0, 0],
    active: false,
    angle_rand: 0,
    scale_rand: 0,
    hue_rot_rand: 0,
    anim_offset_rand: 0,
    start_color_rand: color(0, 0, 0, 1),
    time: 0,
    lifetime: 0,
    base_color: color(0, 0, 0, 1),
    seed: 0,
  };
}

/**
 * Makes `entity` a CPUParticles3D with Godot's defaults (`CPUParticles3D::CPUParticles3D`,
 * `cpu_particles_3d.cpp:1812`): emitting, 8 particles, a seed from the global generator, the
 * parameters' default ranges; it processes, and draws, once it enters the tree
 * (`NOTIFICATION_ENTER_TREE`, `:1392`).
 *
 * @godot CPUParticles3D (protocol)
 * @source scene/3d/cpu_particles_3d.cpp:1812
 */
export function godot_cpu_particles_3d_adopt(entity: object): void {
  if (STATE.has(entity)) return;
  const s: CPUParticles3D = {
    emitting: false,
    active: false,
    particles: [],
    data: new Float32Array(0),
    time: 0,
    frame_remainder: 0,
    cycle: 0,
    one_shot: false,
    lifetime: 1,
    pre_process_time: 0,
    explosiveness_ratio: 0,
    randomness_ratio: 0,
    lifetime_randomness: 0,
    speed_scale: 1,
    local_coords: false,
    fixed_fps: 0,
    fractional_delta: true,
    seed: 0,
    use_fixed_seed: false,
    direction: vector3(1, 0, 0),
    spread: 45,
    flatness: 0,
    parameters_min: new Array<number>(PARAM_MAX).fill(0),
    parameters_max: new Array<number>(PARAM_MAX).fill(0),
    curve_parameters: new Array<Curve | null>(PARAM_MAX).fill(null),
    color: color(1, 1, 1, 1),
    color_ramp: null,
    color_initial_ramp: null,
    particle_flags: [false, false, false],
    emission_shape: SHAPE_POINT,
    emission_sphere_radius: 1,
    emission_box_extents: vector3(1, 1, 1),
    emission_points: [],
    emission_normals: [],
    emission_colors: [],
    emission_ring_axis: vector3(0, 0, 1),
    emission_ring_height: 1,
    emission_ring_radius: 1,
    emission_ring_inner_radius: 0,
    emission_ring_cone_angle: 90,
    split_scale: false,
    scale_curve: [null, null, null],
    gravity: vector3(0, -9.8, 0),
    mesh: null,
    inv_emission_transform: identity(),
    rng: godot_random_pcg_new(),
    redraw: false,
    drawn: null,
    pushed: new Float32Array(0),
  };
  STATE.set(entity, s);
  // `set_emitting(true)` before any particle: active, its first update finding none.
  s.emitting = true;
  s.active = true;
  set_amount(entity, 8);
  s.seed = randi() >>> 0;
  s.parameters_min[PARAM_SCALE] = 1;
  s.parameters_max[PARAM_SCALE] = 1;
  // `NOTIFICATION_ENTER_TREE` (`:1393`): processing as it emits, a first update before drawing.
  godot_node_tree_signal(entity, 'tree_entered').connect(() => {
    transformChanged(entity, s);
    godot_node_set_internal_process(entity, s.emitting ? internalProcess(entity, s) : undefined);
    if (s.emitting && s.time === 0) updateInternal(entity, s);
  });
  godot_node_tree_signal(entity, 'tree_exiting').connect(() => setRedraw(s, false));
}

/** `NOTIFICATION_TRANSFORM_CHANGED` (`cpu_particles_3d.cpp:1417`): the inverse emission transform. */
function transformChanged(entity: object, s: CPUParticles3D): void {
  const global = transformOf(get_global_transform(entity as Object3D));
  const [r0, r1, r2] = global.rows;
  const det = f32(
    f32(f32(r0[0] * f32(f32(r1[1] * r2[2]) - f32(r1[2] * r2[1]))) - f32(r0[1] * f32(f32(r1[0] * r2[2]) - f32(r1[2] * r2[0])))) +
      f32(r0[2] * f32(f32(r1[0] * r2[1]) - f32(r1[1] * r2[0]))),
  );
  if (det === 0) return;
  s.inv_emission_transform = affineInverse(global);
}

/** `_set_emitting` (`cpu_particles_3d.cpp:66`): active, processing, a first update at time 0. */
function setEmittingProcess(entity: object, s: CPUParticles3D): void {
  s.active = true;
  godot_node_set_internal_process(entity, internalProcess(entity, s));
  if (s.time === 0) updateInternal(entity, s);
}

/** `NOTIFICATION_INTERNAL_PROCESS`, the emission transform taken as it stands. */
function internalProcess(entity: object, s: CPUParticles3D): () => void {
  return () => {
    transformChanged(entity, s);
    updateInternal(entity, s);
  };
}

/**
 * Starting draws a new seed for a one-shot system without a fixed one.
 *
 * @godot CPUParticles3D.set_emitting
 * @source scene/3d/cpu_particles_3d.cpp:51
 */
export function set_emitting(self: object, emitting: boolean): void {
  const s = stateOf(self, 'set_emitting');
  if (s.emitting === emitting) return;
  if (emitting && !s.use_fixed_seed && s.one_shot) s.seed = randi() >>> 0;
  s.emitting = emitting;
  if (emitting) setEmittingProcess(self, s);
}

/**
 * @godot CPUParticles3D.is_emitting
 * @source scene/3d/cpu_particles_3d.cpp:134
 */
export function is_emitting(self: object): boolean {
  return stateOf(self, 'is_emitting').emitting;
}

/**
 * Fewer than one fails; the particles are made anew, inactive.
 *
 * @godot CPUParticles3D.set_amount
 * @source scene/3d/cpu_particles_3d.cpp:75
 */
export function set_amount(self: object, amount: number): void {
  const s = stateOf(self, 'set_amount');
  if (amount < 1) return;
  const kept = s.particles.slice(0, amount);
  while (kept.length < amount) kept.push(particle());
  for (const p of kept) {
    p.active = false;
    p.custom[3] = 1;
  }
  s.particles = kept;
  s.data = new Float32Array(20 * amount);
}

/**
 * @godot CPUParticles3D.get_amount
 * @source scene/3d/cpu_particles_3d.cpp:138
 */
export function get_amount(self: object): number {
  return stateOf(self, 'get_amount').particles.length;
}

/**
 * A lifetime of zero or less fails.
 *
 * @godot CPUParticles3D.set_lifetime
 * @source scene/3d/cpu_particles_3d.cpp:95
 */
export function set_lifetime(self: object, lifetime: number): void {
  if (lifetime <= 0) return;
  stateOf(self, 'set_lifetime').lifetime = lifetime;
}

/**
 * @godot CPUParticles3D.set_one_shot
 * @source scene/3d/cpu_particles_3d.cpp:100
 */
export function set_one_shot(self: object, one_shot: boolean): void {
  stateOf(self, 'set_one_shot').one_shot = one_shot;
}

/**
 * @godot CPUParticles3D.set_pre_process_time
 * @source scene/3d/cpu_particles_3d.cpp:104
 */
export function set_pre_process_time(self: object, time: number): void {
  stateOf(self, 'set_pre_process_time').pre_process_time = time;
}

/**
 * @godot CPUParticles3D.set_explosiveness_ratio
 * @source scene/3d/cpu_particles_3d.cpp:108
 */
export function set_explosiveness_ratio(self: object, ratio: number): void {
  stateOf(self, 'set_explosiveness_ratio').explosiveness_ratio = f32(ratio);
}

/**
 * @godot CPUParticles3D.set_randomness_ratio
 * @source scene/3d/cpu_particles_3d.cpp:112
 */
export function set_randomness_ratio(self: object, ratio: number): void {
  stateOf(self, 'set_randomness_ratio').randomness_ratio = f32(ratio);
}

/**
 * @godot CPUParticles3D.set_lifetime_randomness
 * @source scene/3d/cpu_particles_3d.cpp:122
 */
export function set_lifetime_randomness(self: object, random: number): void {
  stateOf(self, 'set_lifetime_randomness').lifetime_randomness = random;
}

/**
 * @godot CPUParticles3D.set_use_local_coordinates
 * @source scene/3d/cpu_particles_3d.cpp:126
 */
export function set_use_local_coordinates(self: object, enable: boolean): void {
  stateOf(self, 'set_use_local_coordinates').local_coords = enable;
}

/**
 * @godot CPUParticles3D.set_speed_scale
 * @source scene/3d/cpu_particles_3d.cpp:130
 */
export function set_speed_scale(self: object, scale: number): void {
  stateOf(self, 'set_speed_scale').speed_scale = scale;
}

/**
 * @godot CPUParticles3D.set_fixed_fps
 * @source scene/3d/cpu_particles_3d.cpp:202
 */
export function set_fixed_fps(self: object, fps: number): void {
  stateOf(self, 'set_fixed_fps').fixed_fps = fps;
}

/**
 * @godot CPUParticles3D.set_fractional_delta
 * @source scene/3d/cpu_particles_3d.cpp:210
 */
export function set_fractional_delta(self: object, enable: boolean): void {
  stateOf(self, 'set_fractional_delta').fractional_delta = enable;
}

/**
 * The bounds the node reports to culling (`visibility_aabb`); three draws the instances unculled.
 *
 * @godot CPUParticles3D.set_visibility_aabb
 * @source scene/3d/cpu_particles_3d.cpp:116
 */
export function set_visibility_aabb(self: object, aabb: unknown): void {
  stateOf(self, 'set_visibility_aabb');
  void aabb;
}

/**
 * @godot CPUParticles3D.set_mesh
 * @source scene/3d/cpu_particles_3d.cpp:187
 */
export function set_mesh(self: object, mesh: PrimitiveMesh | null): void {
  const s = stateOf(self, 'set_mesh');
  s.mesh = mesh;
  if (s.drawn !== null) (self as Object3D).remove(s.drawn);
  s.drawn = null;
}

/**
 * @godot CPUParticles3D.restart
 * @source scene/3d/cpu_particles_3d.cpp:248
 */
export function restart(self: object, keep_seed = false): void {
  const s = stateOf(self, 'restart');
  s.time = 0;
  s.frame_remainder = 0;
  s.cycle = 0;
  s.emitting = false;
  for (const p of s.particles) p.active = false;
  if (!keep_seed && !s.use_fixed_seed) s.seed = randi() >>> 0;
  s.emitting = true;
  setEmittingProcess(self, s);
}

/**
 * @godot CPUParticles3D.set_direction
 * @source scene/3d/cpu_particles_3d.cpp:270
 */
export function set_direction(self: object, direction: Vector3): void {
  stateOf(self, 'set_direction').direction = vector3(direction);
}

/**
 * @godot CPUParticles3D.set_spread
 * @source scene/3d/cpu_particles_3d.cpp:278
 */
export function set_spread(self: object, spread: number): void {
  stateOf(self, 'set_spread').spread = f32(spread);
}

/**
 * @godot CPUParticles3D.set_flatness
 * @source scene/3d/cpu_particles_3d.cpp:286
 */
export function set_flatness(self: object, flatness: number): void {
  stateOf(self, 'set_flatness').flatness = f32(flatness);
}

/**
 * A minimum above the maximum raises the maximum.
 *
 * @godot CPUParticles3D.set_param_min
 * @source scene/3d/cpu_particles_3d.cpp:294
 */
export function set_param_min(self: object, param: number, value: number): void {
  const s = stateOf(self, 'set_param_min');
  if (param < 0 || param >= PARAM_MAX) return;
  s.parameters_min[param] = f32(value);
  if ((s.parameters_min[param] as number) > (s.parameters_max[param] as number)) set_param_max(self, param, value);
}

/**
 * @godot CPUParticles3D.get_param_min
 * @source scene/3d/cpu_particles_3d.cpp:305
 */
export function get_param_min(self: object, param: number): number {
  return stateOf(self, 'get_param_min').parameters_min[param] ?? 0;
}

/**
 * A maximum below the minimum lowers the minimum.
 *
 * @godot CPUParticles3D.set_param_max
 * @source scene/3d/cpu_particles_3d.cpp:311
 */
export function set_param_max(self: object, param: number, value: number): void {
  const s = stateOf(self, 'set_param_max');
  if (param < 0 || param >= PARAM_MAX) return;
  s.parameters_max[param] = f32(value);
  if ((s.parameters_min[param] as number) > (s.parameters_max[param] as number)) set_param_min(self, param, value);
}

/**
 * @godot CPUParticles3D.get_param_max
 * @source scene/3d/cpu_particles_3d.cpp:322
 */
export function get_param_max(self: object, param: number): number {
  return stateOf(self, 'get_param_max').parameters_max[param] ?? 0;
}

/** `_adjust_curve_range`'s ranges by parameter (`cpu_particles_3d.cpp:337`). */
const CURVE_RANGES: Readonly<Record<number, readonly [number, number]>> = {
  [PARAM_ANGULAR_VELOCITY]: [-360, 360],
  [PARAM_ORBIT_VELOCITY]: [-500, 500],
  [PARAM_LINEAR_ACCEL]: [-200, 200],
  [PARAM_RADIAL_ACCEL]: [-200, 200],
  [PARAM_TANGENTIAL_ACCEL]: [-200, 200],
  [PARAM_DAMPING]: [0, 100],
  [PARAM_ANGLE]: [-360, 360],
  [PARAM_HUE_VARIATION]: [-1, 1],
  [PARAM_ANIM_SPEED]: [0, 200],
};

/**
 * A parameter's curve; an empty curve takes the parameter's default setup.
 *
 * @godot CPUParticles3D.set_param_curve
 * @source scene/3d/cpu_particles_3d.cpp:337
 */
export function set_param_curve(self: object, param: number, curve: Curve | null): void {
  const s = stateOf(self, 'set_param_curve');
  if (param < 0 || param >= PARAM_MAX) return;
  s.curve_parameters[param] = curve;
  const range = CURVE_RANGES[param];
  if (curve !== null && range !== undefined) godot_curve_ensure_default_setup(curve, range[0], range[1]);
}

/**
 * @godot CPUParticles3D.set_color
 * @source scene/3d/cpu_particles_3d.cpp:390
 */
export function set_color(self: object, value: Color): void {
  stateOf(self, 'set_color').color = value;
}

/**
 * @godot CPUParticles3D.set_color_ramp
 * @source scene/3d/cpu_particles_3d.cpp:398
 */
export function set_color_ramp(self: object, ramp: Gradient | null): void {
  stateOf(self, 'set_color_ramp').color_ramp = ramp;
}

/**
 * @godot CPUParticles3D.set_color_initial_ramp
 * @source scene/3d/cpu_particles_3d.cpp:406
 */
export function set_color_initial_ramp(self: object, ramp: Gradient | null): void {
  stateOf(self, 'set_color_initial_ramp').color_initial_ramp = ramp;
}

/**
 * @godot CPUParticles3D.set_particle_flag
 * @source scene/3d/cpu_particles_3d.cpp:414
 */
export function set_particle_flag(self: object, flag: number, enable: boolean): void {
  const s = stateOf(self, 'set_particle_flag');
  if (flag < 0 || flag > 2) return;
  s.particle_flags[flag] = enable;
}

/**
 * @godot CPUParticles3D.set_emission_shape
 * @source scene/3d/cpu_particles_3d.cpp:427
 */
export function set_emission_shape(self: object, shape: number): void {
  if (shape < 0 || shape > SHAPE_RING) return;
  stateOf(self, 'set_emission_shape').emission_shape = shape;
}

/**
 * @godot CPUParticles3D.set_emission_sphere_radius
 * @source scene/3d/cpu_particles_3d.cpp:433
 */
export function set_emission_sphere_radius(self: object, radius: number): void {
  stateOf(self, 'set_emission_sphere_radius').emission_sphere_radius = f32(radius);
}

/**
 * @godot CPUParticles3D.set_emission_box_extents
 * @source scene/3d/cpu_particles_3d.cpp:438
 */
export function set_emission_box_extents(self: object, extents: Vector3): void {
  stateOf(self, 'set_emission_box_extents').emission_box_extents = vector3(extents);
}

/**
 * @godot CPUParticles3D.set_gravity
 * @source scene/3d/cpu_particles_3d.cpp:541
 */
export function set_gravity(self: object, gravity: Vector3): void {
  stateOf(self, 'set_gravity').gravity = vector3(gravity);
}

/**
 * @godot CPUParticles3D.set_use_fixed_seed
 * @source scene/3d/cpu_particles_3d.cpp:570
 */
export function set_use_fixed_seed(self: object, use: boolean): void {
  stateOf(self, 'set_use_fixed_seed').use_fixed_seed = use;
}

/**
 * @godot CPUParticles3D.set_seed
 * @source scene/3d/cpu_particles_3d.cpp:582
 */
export function set_seed(self: object, seed: number): void {
  stateOf(self, 'set_seed').seed = seed >>> 0;
}

/**
 * @godot CPUParticles3D.get_seed
 * @source scene/3d/cpu_particles_3d.cpp:586
 */
export function get_seed(self: object): number {
  return stateOf(self, 'get_seed').seed;
}

/**
 * The multimesh buffer as the node last handed it to the renderer: 20 floats a particle, none
 * before its first update.
 *
 * @godot CPUParticles3D (protocol)
 * @source scene/3d/cpu_particles_3d.cpp:1382
 */
export function godot_cpu_particles_3d_buffer(self: object): Float32Array {
  return stateOf(self, 'buffer').pushed;
}

// The node's class, for a CPUParticles3D its JSX declares.
const CPU_PARTICLES_3D = Object.freeze(['CPUParticles3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object']);

const param = (index: number): [GodotElementProp<Group>, GodotElementProp<Group>, GodotElementProp<Group>] => [
  (self, value: number) => set_param_min(self, index, value),
  (self, value: number) => set_param_max(self, index, value),
  (self, value: Curve | null) => set_param_curve(self, index, value),
];

/** The props a scene states on `<GodotCPUParticles3D>`, by the setter each calls. */
const CPU_PARTICLES_3D_ELEMENT: GodotElementClass<Group> = {
  create: () => new Group(),
  classes: CPU_PARTICLES_3D,
  spatial: true,
  mount: (entity) => godot_cpu_particles_3d_adopt(entity),
  props: new Map<string, GodotElementProp<Group>>([
    ['emitting', (self, value: boolean) => set_emitting(self, value)],
    ['amount', (self, value: number) => set_amount(self, value)],
    ['lifetime', (self, value: number) => set_lifetime(self, value)],
    ['oneShot', (self, value: boolean) => set_one_shot(self, value)],
    ['preprocess', (self, value: number) => set_pre_process_time(self, value)],
    ['explosiveness', (self, value: number) => set_explosiveness_ratio(self, value)],
    ['randomness', (self, value: number) => set_randomness_ratio(self, value)],
    ['lifetimeRandomness', (self, value: number) => set_lifetime_randomness(self, value)],
    ['localCoords', (self, value: boolean) => set_use_local_coordinates(self, value)],
    ['speedScale', (self, value: number) => set_speed_scale(self, value)],
    ['fixedFps', (self, value: number) => set_fixed_fps(self, value)],
    ['fractDelta', (self, value: boolean) => set_fractional_delta(self, value)],
    ['visibilityAabb', (self, value: unknown) => set_visibility_aabb(self, value)],
    ['mesh', (self, value: PrimitiveMesh | null) => set_mesh(self, value)],
    ['direction', (self, value: readonly [number, number, number]) => set_direction(self, vector3(...value))],
    ['spread', (self, value: number) => set_spread(self, value)],
    ['flatness', (self, value: number) => set_flatness(self, value)],
    ['gravity', (self, value: readonly [number, number, number]) => set_gravity(self, vector3(...value))],
    ['color', (self, value: readonly [number, number, number, number]) => set_color(self, color(...value))],
    ['colorRamp', (self, value: Gradient | null) => set_color_ramp(self, value)],
    ['colorInitialRamp', (self, value: Gradient | null) => set_color_initial_ramp(self, value)],
    ['emissionShape', (self, value: number) => set_emission_shape(self, value)],
    ['emissionSphereRadius', (self, value: number) => set_emission_sphere_radius(self, value)],
    ['emissionBoxExtents', (self, value: readonly [number, number, number]) => set_emission_box_extents(self, vector3(...value))],
    ['useFixedSeed', (self, value: boolean) => set_use_fixed_seed(self, value)],
    ['seed', (self, value: number) => set_seed(self, value)],
    ...(
      [
        ['initialVelocity', PARAM_INITIAL_LINEAR_VELOCITY],
        ['angularVelocity', PARAM_ANGULAR_VELOCITY],
        ['orbitVelocity', PARAM_ORBIT_VELOCITY],
        ['linearAccel', PARAM_LINEAR_ACCEL],
        ['radialAccel', PARAM_RADIAL_ACCEL],
        ['tangentialAccel', PARAM_TANGENTIAL_ACCEL],
        ['damping', PARAM_DAMPING],
        ['angle', PARAM_ANGLE],
        ['scaleAmount', PARAM_SCALE],
        ['hueVariation', PARAM_HUE_VARIATION],
        ['animSpeed', PARAM_ANIM_SPEED],
        ['animOffset', PARAM_ANIM_OFFSET],
      ] as const
    ).flatMap(([name, index]): [string, GodotElementProp<Group>][] => {
      const [min, max, curve] = param(index);
      return [[`${name}Min`, min], [`${name}Max`, max], [`${name}Curve`, curve]];
    }),
    ['particleFlagAlignY', (self, value: boolean) => set_particle_flag(self, FLAG_ALIGN_Y_TO_VELOCITY, value)],
    ['particleFlagRotateY', (self, value: boolean) => set_particle_flag(self, FLAG_ROTATE_Y, value)],
    ['particleFlagDisableZ', (self, value: boolean) => set_particle_flag(self, FLAG_DISABLE_Z, value)],
  ]),
};

/**
 * A CPUParticles3D as a scene writes it (`cpu_particles_3d.cpp:1548`: its properties): a group
 * the node's state is kept on, drawing its particles as an `InstancedMesh` child.
 *
 * @godot CPUParticles3D (protocol)
 * @source scene/3d/cpu_particles_3d.cpp:1548
 */
export function GodotCPUParticles3D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(CPU_PARTICLES_3D_ELEMENT, props);
}
