/**
 * @godot-class GPUParticles3D
 * @role BINDING
 *
 * Godot 4.7's `GPUParticles3D` (`scene/3d/gpu_particles_3d.cpp`) and the Compatibility renderer's
 * particles (`drivers/gles3/storage/particles_storage.cpp`), at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`, on the page's WebGL2 context: the node's state and
 * its internal processing are transcribed; the particles live on the GPU as Godot keeps them,
 * each particle's record (colour, velocity and flags, custom, the transform's rows, the shader's
 * userdata) in two vertex buffers swapped every step through transform feedback, run by Godot's
 * own `particles.glsl` with the process material's `start()` and `process()` (the shader Godot
 * generated for it, lowered) in its `#CODE` sections (`particles-shader-gles3.ts`). Each frame the
 * server's order is kept (`RenderingServerDefault::draw`): the systems a visible instance asked to
 * process last frame are processed (`update_particles`: pre-process, fixed-fps steps with their
 * remainder, `_particles_process` filling the frame parameters), then each visible system asks
 * again and its instance buffer is filled by Godot's `particles_copy.glsl` (the camera axis for
 * the billboard alignments), and the buffer is read back (`godot_webgl2_glGetBufferSubData`, as
 * Godot's own web build does to sort) into the `InstancedMesh` that draws each draw pass: its rows
 * the instance matrices, its colour and custom halves the `godotInstanceColor` and
 * `godotInstanceCustom` the scene shader reads (`base-material-3d.ts`).
 *
 * Not carried, each refused where a scene or script asks for it: collision and attractors (a
 * scene's `GPUParticlesCollision3D`/`GPUParticlesAttractor3D`), sub-emitters, trails, skinning,
 * the view-depth sort, 2D mode (`gpu-particles-2d.ts`).
 */

import type { ReactElement } from 'react';
import {
  type Box3,
  type BufferGeometry,
  type Camera,
  Frustum,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  type Object3D,
  Sphere,
  Vector3 as ThreeVector3,
  type WebGLRenderer,
} from 'three';
import { type AABB, construct as aabb, get_longest_axis_size, godot_aabb_expand_to, godot_aabb_grow_by } from './aabb';
import { randi } from './global-scope';
import { can_process, godot_node_foreign, godot_node_set_internal_physics, godot_node_set_internal_process, godot_node_tree_signal, get_physics_process_delta_time, get_process_delta_time, is_inside_tree } from './node';
import { get_global_transform, is_visible_in_tree } from './node-3d';
import type { GodotParticleTexture, GodotShaderParameter, ParticleProcessMaterial } from './particle-process-material';
import { GODOT_PARTICLES_COPY_GLSL, GODOT_PARTICLES_GLSL, GODOT_STDLIB_INC_GLSL } from './particles-shader-gles3';
import { type GodotElementClass, type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { type GodotSignal, godot_object_signal } from './signal';
import { godot_viewport_frame_work } from './viewport';
import { affine_inverse, construct as transform3d, op_multiply, type Transform3D } from './transform-3d';
import { construct as vector3 } from './vector3';

const f32 = Math.fround;

/** `RSE::ParticlesDrawOrder` (`rendering_server_enums.h`): index, lifetime, reverse lifetime, view depth. */
const DRAW_ORDER_LIFETIME = 1;
const DRAW_ORDER_REVERSE_LIFETIME = 2;
const DRAW_ORDER_VIEW_DEPTH = 3;
/** `RSE::ParticlesTransformAlign`: disabled, Z-billboard, Y to velocity, Z-billboard Y to velocity, local billboard. */
const ALIGN_Z_BILLBOARD = 1;
const ALIGN_Z_BILLBOARD_Y_TO_VELOCITY = 3;
const ALIGN_LOCAL_BILLBOARD = 4;

/** `ParticlesStorage::Particles` (`particles_storage.h:149`), the server's state of one system. */
interface Particles {
  mode3d: boolean;
  inactive: boolean;
  inactive_time: number;
  emitting: boolean;
  one_shot: boolean;
  amount_ratio: number;
  amount: number;
  lifetime: number;
  pre_process_time: number;
  request_process_time: number;
  request_process_time_residual: number;
  explosiveness: number;
  randomness: number;
  restart_request: boolean;
  custom_aabb: { position: readonly [number, number, number]; size: readonly [number, number, number] };
  use_local_coords: boolean;
  process_material: ParticleProcessMaterial | null;
  frame_counter: number;
  transform_align: number;
  transform_align_axis: number;
  transform_align_channel_filter: number;
  draw_order: number;
  dirty: boolean;
  phase: number;
  prev_phase: number;
  random_seed: number;
  cycle_number: number;
  speed_scale: number;
  fixed_fps: number;
  interpolate: boolean;
  fractional_delta: boolean;
  frame_remainder: number;
  collision_base_size: number;
  clear: boolean;
  /** `Transform3D` column-major, as `store_transform` writes it. */
  emission_transform: Float32Array;
  /** The same transform as Godot holds it (`particles_get_current_aabb` inverts it). */
  emission_xform: Transform3D;
  emitter_velocity: readonly [number, number, number];
  interp_to_end: number;
  gl: ParticlesBuffers | null;
  last_frame_buffer_filled: boolean;
  last_frame_phase: number;
  sort_buffer_filled: boolean;
  sort_buffer_phase: number;
}

/** The GL objects of one system (`_particles_update_buffers`). */
interface ParticlesBuffers {
  readonly gl: WebGL2RenderingContext;
  userdata_count: number;
  front_vertex_array: WebGLVertexArrayObject;
  front_process_buffer: WebGLBuffer;
  front_instance_buffer: WebGLBuffer;
  back_vertex_array: WebGLVertexArrayObject;
  back_process_buffer: WebGLBuffer;
  back_instance_buffer: WebGLBuffer;
  last_frame_buffer: WebGLBuffer | null;
  sort_buffer: WebGLBuffer | null;
  frame_params_ubo: WebGLBuffer;
  readonly instance_buffer_stride: number;
  readonly process_buffer_stride: number;
  readonly num_attrib_arrays: number;
}

/** The node (`GPUParticles3D`, `gpu_particles_3d.h`) and its server-side system. */
interface GPUParticles3D {
  readonly particles: Particles;
  emitting: boolean;
  active: boolean;
  signal_canceled: boolean;
  one_shot: boolean;
  amount: number;
  lifetime: number;
  interp_to_end_factor: number;
  use_fixed_seed: boolean;
  seed: number;
  pre_process_time: number;
  explosiveness_ratio: number;
  randomness_ratio: number;
  visibility_aabb: { position: readonly [number, number, number]; size: readonly [number, number, number] };
  local_coords: boolean;
  process_material: ParticleProcessMaterial | null;
  speed_scale: number;
  collision_base_size: number;
  draw_order: number;
  fixed_fps: number;
  fractional_delta: boolean;
  interpolate: boolean;
  amount_ratio: number;
  transform_align: number;
  time: number;
  emission_time: number;
  active_time: number;
  previous_position: readonly [number, number, number];
  previous_velocity: readonly [number, number, number];
  /** The draw passes' meshes as three draws them, and the material override. */
  draw_passes: ({ readonly geometry: BufferGeometry; readonly material: Material | null } | null)[];
  material_override: Material | null;
  cast_shadow: boolean;
  drawn: InstancedMesh[];
}

const STATE = new WeakMap<object, GPUParticles3D>();
/** The systems a visible instance asked to process (`particle_update_list`), in request order. */
const UPDATE_LIST: GPUParticles3D[] = [];
/** Every live system, for the frame's visibility pass. */
const SYSTEMS = new Set<object>();

function stateOf(self: object, member: string): GPUParticles3D {
  const s = STATE.get(self);
  if (s === undefined) throw new TypeError(`godot-compat: GPUParticles3D.${member} requires a GPUParticles3D receiver.`);
  return s;
}

// --- The frame clock of the rasterizer (`RasterizerGLES3::begin_frame`, `rasterizer_gles3.cpp:101`).

const rasterizer: { frame: number; delta: number; time_total: number; gl: WebGL2RenderingContext | null } = { frame: 0, delta: 0, time_total: 0, gl: null };
/** `rendering/limits/time/time_rollover_secs`'s default (`rendering_server.cpp`). */
const TIME_ROLLOVER = 3600;

// --- Program assembly (`gles3_builders.py`, `ShaderGLES3::_build_variant_code`, `shader_gles3.cpp:159`).

/** A `.glsl` file's vertex section with its `#include`s inlined, and its transform-feedback outputs. */
function vertexSection(file: string): { readonly text: string; readonly feedbacks: readonly { readonly name: string; readonly specialization: string }[] } {
  const lines: string[] = [];
  const feedbacks: { name: string; specialization: string }[] = [];
  let reading = '';
  const include = (source: string, top: boolean): void => {
    for (const line of source.split('\n')) {
      if (top && line.includes('#[vertex]')) {
        reading = 'vertex';
        continue;
      }
      if (top && line.includes('#[fragment]')) {
        reading = 'fragment';
        continue;
      }
      if (top && reading === '') continue;
      if (reading !== 'vertex') continue;
      if (line.includes('#include ')) {
        const name = line.replace('#include ', '').trim().slice(1, -1);
        if (name !== 'stdlib_inc.glsl') throw new Error(`godot-compat: the particle shader includes ${name}, which is not vendored.`);
        include(GODOT_STDLIB_INC_GLSL, false);
        continue;
      }
      // `//tfb:<specialization>` marks a transform-feedback output (`gles3_builders.py:208`).
      const trimmed = line.trim();
      if ((trimmed.startsWith('out ') || trimmed.startsWith('flat ')) && line.includes('tfb:')) {
        const declaration = line.slice(0, line.indexOf('//')).replace(';', '').trim().split(/\s+/u);
        feedbacks.push({ name: declaration[declaration.length - 1] as string, specialization: line.slice(line.indexOf('tfb:') + 4).trim() });
      }
      lines.push(line);
    }
  };
  include(file, true);
  return { text: `${lines.join('\n')}\n`, feedbacks };
}

const PROCESS_SECTION = vertexSection(GODOT_PARTICLES_GLSL);
const COPY_SECTION = vertexSection(GODOT_PARTICLES_COPY_GLSL);

/**
 * The vertex program's text for a set of defines and the version's code (`_build_variant_code`):
 * the version line, the specializations and defines, the precision lines, then the stage's chunks
 * with `#MATERIAL_UNIFORMS`, `#GLOBALS` and `#CODE : <name>` replaced.
 */
function buildVertex(section: string, specializations: readonly string[], defines: string, globals: string, code: Readonly<Record<string, string>>): string {
  let out = '#version 300 es\n';
  for (const name of specializations) out += `#define ${name}\n`;
  for (const name of Object.keys(code)) out += `#define ${name}_CODE_USED\n`;
  out += '\n';
  out += defines;
  out += '\n';
  out += '#define samplerExternalOES sampler2D\n';
  out += '#ifdef USE_MULTIVIEW\n#if defined(GL_OVR_multiview2)\n#extension GL_OVR_multiview2 : require\n#elif defined(GL_OVR_multiview)\n#extension GL_OVR_multiview : require\n#endif\nlayout(num_views=2) in;\n#define ViewIndex gl_ViewID_OVR\n#define MAX_VIEWS 2\n#else\n#define ViewIndex uint(0)\n#define MAX_VIEWS 1\n#endif\n';
  out += 'precision highp float;\nprecision highp int;\nprecision highp sampler2D;\nprecision highp samplerCube;\nprecision highp sampler2DArray;\nprecision highp sampler3D;\n';
  for (const line of section.split('\n').slice(0, -1)) {
    if (line.startsWith('#GLOBALS')) out += globals;
    else if (line.startsWith('#MATERIAL_UNIFORMS')) out += '';
    else if (line.startsWith('#CODE')) out += code[line.replace('#CODE', '').replace(':', '').trim().toUpperCase()] ?? '';
    else out += `${line}\n`;
  }
  return out;
}

const FRAGMENT = '#version 300 es\nprecision highp float;\nprecision highp int;\nvoid main() {\n}\n';

function compile(gl: WebGL2RenderingContext, vertex: string, feedbacks: readonly string[], attributes: readonly [string, number][]): WebGLProgram {
  const shader = (type: number, text: string): WebGLShader => {
    const made = gl.createShader(type) as WebGLShader;
    gl.shaderSource(made, text);
    gl.compileShader(made);
    if (gl.getShaderParameter(made, gl.COMPILE_STATUS) !== true) {
      throw new Error(`godot-compat: a particle shader did not compile: ${String(gl.getShaderInfoLog(made))}\n${text}`);
    }
    return made;
  };
  const program = gl.createProgram() as WebGLProgram;
  gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  // The userdata inputs carry no layout: they follow the record's fixed fields in the buffer
  // (`_particles_update_buffers` sets attribute j at offset 16 * j).
  for (const [name, location] of attributes) gl.bindAttribLocation(program, location, name);
  gl.transformFeedbackVaryings(program, [...feedbacks], gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    throw new Error(`godot-compat: a particle shader did not link: ${String(gl.getProgramInfoLog(program))}`);
  }
  return program;
}

interface ProcessProgram {
  readonly program: WebGLProgram;
  readonly userdata: readonly number[];
  readonly uniforms: ReadonlyMap<string, WebGLUniformLocation>;
  readonly samplers: readonly { readonly name: string; readonly location: WebGLUniformLocation; readonly unit: number }[];
}

const PROCESS_PROGRAMS = new WeakMap<WebGL2RenderingContext, Map<object, ProcessProgram>>();
const COPY_PROGRAMS = new WeakMap<WebGL2RenderingContext, WebGLProgram>();

/** The process program for a material's shader (`ParticlesShaderData::set_code`, `material_storage.cpp:3278`). */
function processProgram(gl: WebGL2RenderingContext, material: ParticleProcessMaterial): ProcessProgram {
  const shader = material.shader;
  if (shader === null) throw new Error('godot-compat: a GPUParticles3D process material has no generated shader.');
  let programs = PROCESS_PROGRAMS.get(gl);
  if (programs === undefined) {
    programs = new Map();
    PROCESS_PROGRAMS.set(gl, programs);
  }
  const cached = programs.get(shader);
  if (cached !== undefined) return cached;
  const userdata = [1, 2, 3, 4, 5, 6].filter((n) => shader.defines.includes(`USERDATA${String(n)}_USED`));
  const specializations = ['MODE_3D', ...userdata.map((n) => `USERDATA${String(n)}_USED`)];
  const defines = `#define MAX_GLOBAL_SHADER_UNIFORMS 256\n${shader.defines.map((define) => `#define ${define}\n`).join('')}`;
  const globals = `${shader.uniforms.map((uniform) => `uniform ${uniform.type} ${uniform.glsl};\n`).join('')}\n${shader.functions}\n`;
  const vertex = buildVertex(PROCESS_SECTION.text, specializations, defines, globals, { START: `${shader.start}\n`, PROCESS: `${shader.process}\n` });
  const feedbacks = PROCESS_SECTION.feedbacks.filter((entry) => entry.specialization === '' || specializations.includes(entry.specialization)).map((entry) => entry.name);
  const program = compile(gl, vertex, feedbacks, userdata.map((n, index) => [`userdata${String(n)}`, 6 + index]));
  const uniforms = new Map<string, WebGLUniformLocation>();
  for (const name of ['lifetime', 'clear', 'total_particles', 'use_fractional_delta', 'height_field_texture', ...shader.uniforms.map((uniform) => uniform.glsl)]) {
    const location = gl.getUniformLocation(program, name);
    if (location !== null) uniforms.set(name, location);
  }
  gl.useProgram(program);
  const frame = gl.getUniformBlockIndex(program, 'FrameData');
  if (frame !== gl.INVALID_INDEX) gl.uniformBlockBinding(program, frame, 0);
  const globalData = gl.getUniformBlockIndex(program, 'GlobalShaderUniformData');
  if (globalData !== gl.INVALID_INDEX) gl.uniformBlockBinding(program, globalData, 1);
  // `height_field_texture` is `//texunit:0`; the material's samplers follow it.
  const heightField = uniforms.get('height_field_texture');
  if (heightField !== undefined) gl.uniform1i(heightField, 0);
  const samplers = shader.uniforms
    .filter((uniform) => uniform.type.startsWith('sampler'))
    .flatMap((uniform, index) => {
      const location = uniforms.get(uniform.glsl);
      if (location === undefined) return [];
      gl.uniform1i(location, 1 + index);
      return [{ name: uniform.name, location, unit: 1 + index }];
    });
  const made = { program, userdata, uniforms, samplers };
  programs.set(shader, made);
  return made;
}

function copyProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const cached = COPY_PROGRAMS.get(gl);
  if (cached !== undefined) return cached;
  const vertex = buildVertex(COPY_SECTION.text, ['MODE_3D'], '', '', {});
  const feedbacks = COPY_SECTION.feedbacks.filter((entry) => entry.specialization === '' || entry.specialization === 'MODE_3D').map((entry) => entry.name);
  const program = compile(gl, vertex, feedbacks, []);
  COPY_PROGRAMS.set(gl, program);
  return program;
}

// --- Buffers (`_particles_update_buffers`, `particles_storage.cpp:857`).

function freeData(p: Particles): void {
  const b = p.gl;
  if (b === null) return;
  const gl = b.gl;
  for (const vao of [b.front_vertex_array, b.back_vertex_array]) gl.deleteVertexArray(vao);
  for (const buffer of [b.front_process_buffer, b.front_instance_buffer, b.back_process_buffer, b.back_instance_buffer, b.last_frame_buffer, b.sort_buffer, b.frame_params_ubo]) {
    if (buffer !== null) gl.deleteBuffer(buffer);
  }
  p.gl = null;
  p.sort_buffer_filled = false;
  p.last_frame_buffer_filled = false;
}

function updateBuffers(gl: WebGL2RenderingContext, p: Particles): void {
  const userdataCount = p.process_material === null ? 0 : processProgram(gl, p.process_material).userdata.length;
  if (p.gl !== null && (p.gl.userdata_count !== userdataCount || p.gl.gl !== gl)) {
    freeData(p);
    p.restart_request = true;
  }
  if (p.amount <= 0 || p.gl !== null) return;
  const xformSize = p.mode3d ? 3 : 2;
  const instance_buffer_stride = 4 * 4 * (xformSize + 1);
  const num_attrib_arrays = 5 + userdataCount + (xformSize - 2);
  const process_buffer_stride = 4 * 4 * num_attrib_arrays;
  const vertexArray = (buffer: WebGLBuffer): WebGLVertexArrayObject => {
    const vao = gl.createVertexArray() as WebGLVertexArrayObject;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (let j = 0; j < num_attrib_arrays; j += 1) {
      gl.enableVertexAttribArray(j);
      gl.vertexAttribPointer(j, 4, gl.FLOAT, false, process_buffer_stride, 4 * 4 * j);
    }
    gl.bindVertexArray(null);
    return vao;
  };
  const buffer = (size: number): WebGLBuffer => {
    const made = gl.createBuffer() as WebGLBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, made);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(size), gl.DYNAMIC_COPY);
    return made;
  };
  const front_process_buffer = buffer(process_buffer_stride * p.amount);
  const front_instance_buffer = buffer(instance_buffer_stride * p.amount);
  const back_process_buffer = buffer(process_buffer_stride * p.amount);
  const back_instance_buffer = buffer(instance_buffer_stride * p.amount);
  const frame_params_ubo = gl.createBuffer() as WebGLBuffer;
  p.gl = {
    gl,
    userdata_count: userdataCount,
    front_vertex_array: vertexArray(front_process_buffer),
    front_process_buffer,
    front_instance_buffer,
    back_vertex_array: vertexArray(back_process_buffer),
    back_process_buffer,
    back_instance_buffer,
    last_frame_buffer: null,
    sort_buffer: null,
    frame_params_ubo,
    instance_buffer_stride,
    process_buffer_stride,
    num_attrib_arrays,
  };
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

// --- One step (`_particles_process`, `particles_storage.cpp:526`).

/** `ParticlesFrameParams` (`particles_storage.h:76`) in std140: 6288 bytes. */
const FRAME_PARAMS_SIZE = 6288;
const frameParams = new DataView(new ArrayBuffer(FRAME_PARAMS_SIZE));
const zeroGlobals = new Uint8Array(256 * 16);
const globalsBuffers = new WeakMap<WebGL2RenderingContext, WebGLBuffer>();
const blackTextures = new WeakMap<WebGL2RenderingContext, WebGLTexture>();
const materialTextures = new WeakMap<GodotParticleTexture, { gl: WebGL2RenderingContext; texture: WebGLTexture }>();

function uploadTexture(gl: WebGL2RenderingContext, source: GodotParticleTexture): WebGLTexture {
  const cached = materialTextures.get(source);
  if (cached !== undefined && cached.gl === gl) return cached.texture;
  const { width, height, format, data } = source.pixels();
  const texture = gl.createTexture() as WebGLTexture;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  if (format === 'rgba8') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data as Uint8Array);
  else if (format === 'rgbf') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, width, height, 0, gl.RGB, gl.FLOAT, data as Float32Array);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, data as Float32Array);
  // No mipmaps (the curve and gradient images have none), so the default linear-mipmap filter
  // samples level 0 linearly; the uniforms state `repeat_disable`.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  materialTextures.set(source, { gl, texture });
  return texture;
}

function blackTexture(gl: WebGL2RenderingContext): WebGLTexture {
  let texture = blackTextures.get(gl);
  if (texture === undefined) {
    texture = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4 * 4 * 4));
    blackTextures.set(gl, texture);
  }
  return texture;
}

/** A shader parameter set on the bound program (`bind_uniforms`), else the shader's own default. */
function setUniform(gl: WebGL2RenderingContext, type: string, location: WebGLUniformLocation, value: GodotShaderParameter | undefined, fallback: readonly number[] | null): void {
  const numbers = typeof value === 'number' ? [value] : Array.isArray(value) ? (value as readonly number[]) : (fallback ?? []);
  const at = (index: number): number => numbers[index] ?? 0;
  switch (type) {
    case 'float':
      gl.uniform1f(location, at(0));
      return;
    case 'vec2':
      gl.uniform2f(location, at(0), at(1));
      return;
    case 'vec3':
      gl.uniform3f(location, at(0), at(1), at(2));
      return;
    case 'vec4':
      gl.uniform4f(location, at(0), at(1), at(2), at(3));
      return;
    case 'int':
    case 'bool':
      gl.uniform1i(location, at(0));
      return;
    case 'uint':
      gl.uniform1ui(location, at(0));
      return;
    default:
      throw new Error(`godot-compat: a particle shader parameter of type ${type} is not bound.`);
  }
}

/** `MaterialStorage::store_transform`: a `Transform3D` as a column-major matrix. */
function storeTransform(t: Transform3D, out: Float32Array): void {
  out.set([t.basis.x.x, t.basis.x.y, t.basis.x.z, 0, t.basis.y.x, t.basis.y.y, t.basis.y.z, 0, t.basis.z.x, t.basis.z.y, t.basis.z.z, 0, t.origin.x, t.origin.y, t.origin.z, 1]);
}

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function particlesProcess(gl: WebGL2RenderingContext, p: Particles, delta: number): void {
  const b = p.gl as ParticlesBuffers;
  const new_phase = (p.phase + delta / p.lifetime) % 1.0;
  if (p.clear) p.cycle_number = 0;
  else if (new_phase < p.phase) {
    if (p.one_shot) p.emitting = false;
    p.cycle_number += 1;
  }
  const v = frameParams;
  v.setUint32(0, p.emitting ? 1 : 0, true);
  v.setUint32(4, p.cycle_number >>> 0, true);
  v.setFloat32(8, new_phase, true);
  v.setFloat32(12, p.phase, true);
  p.phase = new_phase;
  v.setFloat32(16, p.explosiveness, true);
  v.setFloat32(20, p.randomness, true);
  v.setFloat32(24, rasterizer.time_total, true);
  v.setFloat32(28, delta, true);
  v.setFloat32(32, p.collision_base_size, true);
  v.setFloat32(36, p.amount_ratio, true);
  v.setFloat32(40, 0, true);
  v.setFloat32(44, 0, true);
  v.setUint32(48, p.random_seed >>> 0, true);
  v.setUint32(52, 0, true);
  v.setUint32(56, 0, true);
  v.setUint32(60, p.frame_counter >>> 0, true);
  p.frame_counter += 1;
  const emission = p.use_local_coords ? IDENTITY : p.emission_transform;
  for (let i = 0; i < 16; i += 1) v.setFloat32(64 + i * 4, emission[i] as number, true);
  v.setFloat32(128, p.emitter_velocity[0], true);
  v.setFloat32(132, p.emitter_velocity[1], true);
  v.setFloat32(136, p.emitter_velocity[2], true);
  v.setFloat32(140, p.interp_to_end, true);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, blackTexture(gl));
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, b.frame_params_ubo);
  gl.bufferData(gl.UNIFORM_BUFFER, v, gl.STREAM_DRAW);
  let globals = globalsBuffers.get(gl);
  if (globals === undefined) {
    globals = gl.createBuffer() as WebGLBuffer;
    gl.bindBuffer(gl.UNIFORM_BUFFER, globals);
    gl.bufferData(gl.UNIFORM_BUFFER, zeroGlobals, gl.STATIC_DRAW);
    globalsBuffers.set(gl, globals);
  }
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, globals);

  const material = p.process_material as ParticleProcessMaterial;
  const program = processProgram(gl, material);
  gl.useProgram(program.program);
  // `m->bind_uniforms()`: the material's parameters and textures.
  for (const uniform of material.shader?.uniforms ?? []) {
    if (uniform.type.startsWith('sampler')) continue;
    const location = program.uniforms.get(uniform.glsl);
    if (location !== undefined) setUniform(gl, uniform.type, location, material.parameters.get(uniform.name), uniform.default);
  }
  for (const sampler of program.samplers) {
    const value = material.parameters.get(sampler.name);
    gl.activeTexture(gl.TEXTURE0 + sampler.unit);
    gl.bindTexture(gl.TEXTURE_2D, value !== null && value !== undefined && typeof value === 'object' && 'pixels' in value ? uploadTexture(gl, value) : blackTexture(gl));
  }
  const uniform = (name: string) => program.uniforms.get(name);
  const lifetime = uniform('lifetime');
  if (lifetime !== undefined) gl.uniform1f(lifetime, p.lifetime);
  const clear = uniform('clear');
  if (clear !== undefined) gl.uniform1i(clear, p.clear ? 1 : 0);
  const total = uniform('total_particles');
  if (total !== undefined) gl.uniform1ui(total, p.amount);
  const fractional = uniform('use_fractional_delta');
  if (fractional !== undefined) gl.uniform1i(fractional, p.fractional_delta ? 1 : 0);
  p.clear = false;

  gl.bindVertexArray(b.back_vertex_array);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, b.front_process_buffer);
  gl.beginTransformFeedback(gl.POINTS);
  gl.drawArrays(gl.POINTS, 0, p.amount);
  gl.endTransformFeedback();
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
  gl.bindVertexArray(null);
  [b.front_process_buffer, b.back_process_buffer] = [b.back_process_buffer, b.front_process_buffer];
  [b.front_vertex_array, b.back_vertex_array] = [b.back_vertex_array, b.front_vertex_array];
}

/** `_particles_update_instance_buffer` (`particles_storage.cpp:947`): the copy pass into the front instance buffer. */
function updateInstanceBuffer(gl: WebGL2RenderingContext, p: Particles, axis: readonly [number, number, number], up: readonly [number, number, number]): void {
  const b = p.gl as ParticlesBuffers;
  const program = copyProgram(gl);
  gl.useProgram(program);
  const set = (name: string, apply: (location: WebGLUniformLocation) => void): void => {
    const location = gl.getUniformLocation(program, name);
    if (location !== null) apply(location);
  };
  set('inv_emission_transform', (l) => gl.uniformMatrix4fv(l, false, IDENTITY));
  set('frame_remainder', (l) => gl.uniform1f(l, p.interpolate ? p.frame_remainder : 0.0));
  set('align_mode', (l) => gl.uniform1ui(l, p.transform_align));
  set('align_up', (l) => gl.uniform3f(l, up[0], up[1], up[2]));
  set('sort_direction', (l) => gl.uniform3f(l, axis[0], axis[1], axis[2]));
  set('align_axis', (l) => gl.uniform1ui(l, p.transform_align_axis));
  set('align_channel_filter', (l) => gl.uniform1ui(l, p.transform_align_channel_filter));

  gl.bindVertexArray(b.back_vertex_array);
  gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER, 0, b.front_instance_buffer, 0, b.instance_buffer_stride * p.amount);
  gl.beginTransformFeedback(gl.POINTS);
  if (p.draw_order === DRAW_ORDER_LIFETIME) {
    const lifetime_split = (Math.min(Math.trunc(p.amount * p.phase), p.amount - 1) + 1) % p.amount;
    const stride = b.process_buffer_stride;
    gl.bindBuffer(gl.ARRAY_BUFFER, b.back_process_buffer);
    // Offset the VBO so the draw starts at the newest particle.
    if (p.amount - lifetime_split > 0) {
      for (let j = 0; j < 6; j += 1) {
        gl.enableVertexAttribArray(j);
        gl.vertexAttribPointer(j, 4, gl.FLOAT, false, stride, stride * lifetime_split + 4 * 4 * j);
      }
      gl.drawArrays(gl.POINTS, 0, p.amount - lifetime_split);
    }
    // Then from index 0 up to the newest particle, into the second portion.
    if (lifetime_split > 0) {
      gl.endTransformFeedback();
      gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER, 0, b.front_instance_buffer, b.instance_buffer_stride * (p.amount - lifetime_split), b.instance_buffer_stride * lifetime_split);
      gl.beginTransformFeedback(gl.POINTS);
      for (let j = 0; j < b.num_attrib_arrays; j += 1) {
        gl.enableVertexAttribArray(j);
        gl.vertexAttribPointer(j, 4, gl.FLOAT, false, stride, 4 * 4 * j);
      }
      gl.drawArrays(gl.POINTS, 0, lifetime_split);
    }
  } else {
    gl.drawArrays(gl.POINTS, 0, p.amount);
  }
  gl.endTransformFeedback();
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

/** `_particles_reverse_lifetime_sort` (`particles_storage.cpp:1233`) over the sort buffer's records. */
function reverseLifetimeSort(gl: WebGL2RenderingContext, p: Particles): void {
  const b = p.gl as ParticlesBuffers;
  if (b.sort_buffer === null) return;
  const stride = b.instance_buffer_stride / 4;
  const data = new Float32Array(p.amount * stride);
  gl.bindBuffer(gl.ARRAY_BUFFER, b.sort_buffer);
  gl.getBufferSubData(gl.ARRAY_BUFFER, 0, data);
  const swap = (i: number, j: number): void => {
    const a = data.slice(i * stride, (i + 1) * stride);
    data.copyWithin(i * stride, j * stride, (j + 1) * stride);
    data.set(a, j * stride);
  };
  const lifetime_split = (Math.min(Math.trunc(p.amount * p.sort_buffer_phase), p.amount - 1) + 1) % p.amount;
  for (let i = 0; i < Math.trunc(lifetime_split / 2); i += 1) swap(i, lifetime_split - i - 1);
  for (let i = 0; i < Math.trunc((p.amount - lifetime_split) / 2); i += 1) swap(lifetime_split + i, p.amount - 1 - i);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

/** `update_particles` (`particles_storage.cpp:1037`): the systems asked to process last frame. */
function updateParticles(gl: WebGL2RenderingContext): void {
  if (UPDATE_LIST.length === 0) return;
  gl.enable(gl.RASTERIZER_DISCARD);
  while (UPDATE_LIST.length > 0) {
    const node = UPDATE_LIST.shift() as GPUParticles3D;
    const p = node.particles;
    p.dirty = false;
    if (p.process_material === null) continue;
    updateBuffers(gl, p);
    if (p.restart_request) {
      p.phase = 0;
      p.prev_phase = 0;
      p.clear = true;
      p.restart_request = false;
      p.frame_remainder = 0.0;
    }
    if (p.inactive && !p.emitting) continue;
    if (p.emitting) {
      if (p.inactive) {
        // Restart the system from scratch.
        p.phase = 0;
        p.prev_phase = 0;
        p.clear = true;
      }
      p.inactive = false;
      p.inactive_time = 0;
    } else {
      p.inactive_time += p.speed_scale * rasterizer.delta;
      if (p.inactive_time > p.lifetime * 1.2) {
        p.inactive = true;
        continue;
      }
    }
    const b = p.gl as ParticlesBuffers;
    // Last frame's instance buffer into the last-frame buffer; the sort buffer is two frames old.
    if (p.draw_order === DRAW_ORDER_VIEW_DEPTH || p.draw_order === DRAW_ORDER_REVERSE_LIFETIME) {
      if (b.sort_buffer === null) {
        const history = (): WebGLBuffer => {
          const made = gl.createBuffer() as WebGLBuffer;
          gl.bindBuffer(gl.ARRAY_BUFFER, made);
          gl.bufferData(gl.ARRAY_BUFFER, b.instance_buffer_stride * p.amount, gl.DYNAMIC_READ);
          return made;
        };
        b.last_frame_buffer = history();
        b.sort_buffer = history();
        p.sort_buffer_filled = false;
        p.last_frame_buffer_filled = false;
      }
      [b.last_frame_buffer, b.sort_buffer] = [b.sort_buffer, b.last_frame_buffer];
      gl.bindBuffer(gl.COPY_READ_BUFFER, b.back_instance_buffer);
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, b.last_frame_buffer);
      gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, b.instance_buffer_stride * p.amount);
      p.sort_buffer_filled = p.last_frame_buffer_filled;
      p.sort_buffer_phase = p.last_frame_phase;
      p.last_frame_buffer_filled = true;
      p.last_frame_phase = p.phase;
      gl.bindBuffer(gl.COPY_READ_BUFFER, null);
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
    }
    const fixed_fps = p.fixed_fps > 0 ? p.fixed_fps : 0;
    // The request-process and pre-process block.
    {
      let todo = p.clear ? p.pre_process_time : 0;
      todo = todo > p.request_process_time ? todo : p.request_process_time;
      todo = todo > p.request_process_time_residual ? todo : p.request_process_time_residual;
      if (todo > 0.0) {
        const frame_time = f32(fixed_fps > 0 ? 1.0 / fixed_fps : 1.0 / 30.0);
        const tmp_scale = p.speed_scale;
        p.speed_scale = 1.0;
        if (p.clear) {
          todo = f32(p.pre_process_time);
          while (todo > 0.00001) {
            particlesProcess(gl, p, frame_time > todo ? todo : frame_time);
            todo = f32(todo - frame_time);
          }
        }
        if (p.request_process_time > 0.0) {
          todo = p.request_process_time;
          while (todo > 0.0) {
            particlesProcess(gl, p, frame_time > todo ? todo : frame_time);
            todo = f32(todo - frame_time);
          }
        }
        if (p.request_process_time_residual > 0.0) {
          p.emitting = false;
          todo = p.request_process_time_residual;
          while (todo > 0.0) {
            particlesProcess(gl, p, frame_time > todo ? todo : frame_time);
            todo = f32(todo - frame_time);
          }
        }
        p.speed_scale = tmp_scale;
      }
      p.request_process_time = 0.0;
      p.request_process_time_residual = 0.0;
    }
    const time_scale = Math.max(p.speed_scale, 0.0);
    if (fixed_fps > 0) {
      const frame_time = 1.0 / fixed_fps;
      let delta = rasterizer.delta;
      if (delta > 0.1) delta = 0.1;
      else if (delta < 0.0) delta = 0.0;
      let todo = p.frame_remainder + delta * time_scale;
      while (todo >= frame_time) {
        particlesProcess(gl, p, frame_time);
        todo -= frame_time;
      }
      p.frame_remainder = todo;
    } else {
      particlesProcess(gl, p, rasterizer.delta * time_scale);
    }
    // The instance buffer, unless the camera is needed (view depth or a billboard alignment).
    if (p.draw_order !== DRAW_ORDER_VIEW_DEPTH && p.transform_align !== ALIGN_Z_BILLBOARD && p.transform_align !== ALIGN_Z_BILLBOARD_Y_TO_VELOCITY && p.transform_align !== ALIGN_LOCAL_BILLBOARD) {
      updateInstanceBuffer(gl, p, [0, 0, 0], [0, 0, 0]);
      if (p.draw_order === DRAW_ORDER_REVERSE_LIFETIME && p.sort_buffer_filled) reverseLifetimeSort(gl, p);
    }
    [b.front_instance_buffer, b.back_instance_buffer] = [b.back_instance_buffer, b.front_instance_buffer];
  }
  gl.disable(gl.RASTERIZER_DISCARD);
}

/** `particles_request_process` (`particles_storage.cpp:395`). */
function requestProcess(node: GPUParticles3D): void {
  const p = node.particles;
  if (!p.dirty) {
    p.dirty = true;
    if (!UPDATE_LIST.includes(node)) UPDATE_LIST.push(node);
  }
}

/** `particles_is_inactive` (`particles_storage.cpp:1272`). */
function isInactive(p: Particles): boolean {
  return !p.emitting && p.inactive;
}

/** `particles_set_view_axis` (`particles_storage.cpp:806`): the copy pass with the camera's axes. */
function setViewAxis(gl: WebGL2RenderingContext, p: Particles, p_axis: ThreeVector3, p_up: ThreeVector3): void {
  if (p.draw_order !== DRAW_ORDER_VIEW_DEPTH && p.transform_align !== ALIGN_Z_BILLBOARD && p.transform_align !== ALIGN_Z_BILLBOARD_Y_TO_VELOCITY && p.transform_align !== ALIGN_LOCAL_BILLBOARD) return;
  if (p.gl === null) return;
  if (p.draw_order === DRAW_ORDER_VIEW_DEPTH) throw new Error('godot-compat: the view-depth particle draw order is not transcribed.');
  let axis: [number, number, number] = [-p_axis.x, -p_axis.y, -p_axis.z];
  if (p.use_local_coords) {
    // `basis.xform_inv(axis).normalized()`: the transpose of the emission basis.
    const e = p.emission_transform;
    const x = (e[0] as number) * axis[0] + (e[1] as number) * axis[1] + (e[2] as number) * axis[2];
    const y = (e[4] as number) * axis[0] + (e[5] as number) * axis[1] + (e[6] as number) * axis[2];
    const z = (e[8] as number) * axis[0] + (e[9] as number) * axis[1] + (e[10] as number) * axis[2];
    const length = Math.sqrt(x * x + y * y + z * z);
    axis = length === 0 ? [0, 0, 0] : [x / length, y / length, z / length];
  }
  gl.enable(gl.RASTERIZER_DISCARD);
  updateInstanceBuffer(gl, p, axis, [p_up.x, p_up.y, p_up.z]);
  gl.disable(gl.RASTERIZER_DISCARD);
}

// --- The node (`gpu_particles_3d.cpp`).

const GPU_PARTICLES_3D = Object.freeze(['GPUParticles3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object']);

function globalPosition(entity: object): readonly [number, number, number] {
  const origin = get_global_transform(entity as Object3D).origin;
  return [origin.x, origin.y, origin.z];
}

function setProcessInternal(entity: object, s: GPUParticles3D, on: boolean): void {
  godot_node_set_internal_process(entity, on ? () => internalProcess(entity, s) : undefined);
}

/** `NOTIFICATION_INTERNAL_PROCESS` (`gpu_particles_3d.cpp:536`). */
function internalProcess(entity: object, s: GPUParticles3D): void {
  const delta = get_process_delta_time(entity);
  const position = globalPosition(entity);
  const velocity: readonly [number, number, number] = [
    f32((position[0] - s.previous_position[0]) / delta),
    f32((position[1] - s.previous_position[1]) / delta),
    f32((position[2] - s.previous_position[2]) / delta),
  ];
  if (velocity.some((value, index) => value !== s.previous_velocity[index])) {
    s.particles.emitter_velocity = velocity;
    s.previous_velocity = velocity;
  }
  s.previous_position = position;
  if (s.one_shot) {
    s.time += delta;
    if (s.time > s.emission_time) {
      s.emitting = false;
      if (!s.active) setProcessInternal(entity, s, false);
    }
    if (s.time > s.active_time) {
      if (s.active && !s.signal_canceled) godot_object_signal<[]>(entity, 'finished').emit();
      s.active = false;
      if (!s.emitting) setProcessInternal(entity, s, false);
    }
  }
}

/** `NOTIFICATION_INTERNAL_PHYSICS_PROCESS` (`gpu_particles_3d.cpp:565`). */
function internalPhysics(entity: object, s: GPUParticles3D): void {
  const delta = get_physics_process_delta_time(entity);
  const position = globalPosition(entity);
  const velocity: readonly [number, number, number] = [
    f32((position[0] - s.previous_position[0]) / delta),
    f32((position[1] - s.previous_position[1]) / delta),
    f32((position[2] - s.previous_position[2]) / delta),
  ];
  if (velocity.some((value, index) => value !== s.previous_velocity[index])) {
    s.particles.emitter_velocity = velocity;
    s.previous_velocity = velocity;
  }
  s.previous_position = position;
}

/**
 * Makes `entity` a GPUParticles3D with Godot's defaults (`GPUParticles3D::GPUParticles3D`,
 * `gpu_particles_3d.cpp:933`): emitting, 8 particles, one second, 30 fixed fps, fractional delta,
 * interpolated, a seed from the global generator; on entering the tree it processes internally
 * (`NOTIFICATION_ENTER_TREE`, `:577`).
 *
 * @godot GPUParticles3D.GPUParticles3D
 * @source scene/3d/gpu_particles_3d.cpp:933
 */
export function godot_gpu_particles_3d_adopt(entity: object): void {
  if (STATE.has(entity)) return;
  const particles: Particles = {
    mode3d: true,
    inactive: true,
    inactive_time: 0,
    emitting: false,
    one_shot: false,
    amount_ratio: 1.0,
    amount: 0,
    lifetime: 1.0,
    pre_process_time: 0,
    request_process_time: 0,
    request_process_time_residual: 0,
    explosiveness: 0,
    randomness: 0,
    restart_request: false,
    custom_aabb: { position: [-4, -4, -4], size: [8, 8, 8] },
    use_local_coords: false,
    process_material: null,
    frame_counter: 0,
    transform_align: 0,
    transform_align_axis: 1,
    transform_align_channel_filter: 1,
    draw_order: 0,
    dirty: false,
    phase: 0,
    prev_phase: 0,
    random_seed: randi() >>> 0,
    cycle_number: 0,
    speed_scale: 1.0,
    fixed_fps: 30,
    interpolate: true,
    fractional_delta: false,
    frame_remainder: 0,
    collision_base_size: 0.01,
    clear: true,
    emission_transform: new Float32Array(IDENTITY),
    emission_xform: transform3d(),
    emitter_velocity: [0, 0, 0],
    interp_to_end: 0,
    gl: null,
    last_frame_buffer_filled: false,
    last_frame_phase: 0,
    sort_buffer_filled: false,
    sort_buffer_phase: 0,
  };
  const s: GPUParticles3D = {
    particles,
    emitting: false,
    active: false,
    signal_canceled: false,
    one_shot: false,
    amount: 0,
    lifetime: 1,
    interp_to_end_factor: 0,
    use_fixed_seed: false,
    seed: 0,
    pre_process_time: 0,
    explosiveness_ratio: 0,
    randomness_ratio: 0,
    visibility_aabb: { position: [-4, -4, -4], size: [8, 8, 8] },
    local_coords: false,
    process_material: null,
    speed_scale: 1,
    collision_base_size: 0.01,
    draw_order: 0,
    fixed_fps: 30,
    fractional_delta: true,
    interpolate: true,
    amount_ratio: 1,
    transform_align: 0,
    time: 0,
    emission_time: 0,
    active_time: 0,
    previous_position: [0, 0, 0],
    previous_velocity: [0, 0, 0],
    draw_passes: [null],
    material_override: null,
    cast_shadow: true,
    drawn: [],
  };
  STATE.set(entity, s);
  SYSTEMS.add(entity);
  set_emitting(entity, true);
  set_one_shot(entity, false);
  set_seed(entity, randi() >>> 0);
  set_amount_ratio(entity, 1.0);
  set_amount(entity, 8);
  set_lifetime(entity, 1);
  set_fixed_fps(entity, 30);
  set_fractional_delta(entity, true);
  set_interpolate(entity, true);
  set_pre_process_time(entity, 0);
  set_explosiveness_ratio(entity, 0);
  set_randomness_ratio(entity, 0);
  set_use_local_coordinates(entity, false);
  set_draw_order(entity, 0);
  set_speed_scale(entity, 1);
  godot_node_tree_signal(entity, 'tree_entered').connect(() => {
    setProcessInternal(entity, s, false);
    godot_node_set_internal_physics(entity, undefined);
    s.particles.speed_scale = can_process(entity) ? s.speed_scale : 0;
    s.previous_position = globalPosition(entity);
    setProcessInternal(entity, s, true);
    godot_node_set_internal_physics(entity, () => internalPhysics(entity, s));
  });
}

/**
 * Starting a one-shot system draws a new seed unless it is fixed, and restarts its countdown
 * (`time`, the emission and active times) when the last cycle has ended.
 *
 * @godot GPUParticles3D.set_emitting
 * @source scene/3d/gpu_particles_3d.cpp:49
 */
export function set_emitting(self: object, p_emitting: boolean): void {
  const s = stateOf(self, 'set_emitting');
  if (p_emitting && p_emitting !== s.emitting && !s.use_fixed_seed && s.one_shot) set_seed(self, randi() >>> 0);
  if (p_emitting && s.one_shot) {
    if (!s.active && !s.emitting) {
      s.active = true;
      s.time = 0;
      s.signal_canceled = false;
      s.emission_time = s.lifetime;
      s.active_time = s.lifetime * (2 - s.explosiveness_ratio);
    } else {
      s.signal_canceled = true;
    }
    setProcessInternal(self, s, true);
  } else if (!p_emitting) {
    setProcessInternal(self, s, s.one_shot);
  } else {
    setProcessInternal(self, s, true);
  }
  s.emitting = p_emitting;
  s.particles.emitting = p_emitting;
}

/**
 * @godot GPUParticles3D.is_emitting
 * @source scene/3d/gpu_particles_3d.cpp:189
 */
export function is_emitting(self: object): boolean {
  return stateOf(self, 'is_emitting').emitting;
}

/**
 * A changed amount frees the system's buffers and restarts it (`particles_set_amount`).
 *
 * @godot GPUParticles3D.set_amount
 * @source scene/3d/gpu_particles_3d.cpp:80
 */
export function set_amount(self: object, p_amount: number): void {
  const s = stateOf(self, 'set_amount');
  if (p_amount < 1) return;
  s.amount = p_amount;
  const p = s.particles;
  if (p.amount === p_amount) return;
  freeData(p);
  p.amount = p_amount;
  p.phase = 0;
  p.prev_phase = 0;
  p.clear = true;
}

/**
 * @godot GPUParticles3D.get_amount
 * @source scene/3d/gpu_particles_3d.cpp:193
 */
export function get_amount(self: object): number {
  return stateOf(self, 'get_amount').amount;
}

/**
 * @godot GPUParticles3D.set_lifetime
 * @source scene/3d/gpu_particles_3d.cpp:86
 */
export function set_lifetime(self: object, p_lifetime: number): void {
  const s = stateOf(self, 'set_lifetime');
  if (p_lifetime <= 0) return;
  s.lifetime = p_lifetime;
  s.particles.lifetime = p_lifetime;
}

/**
 * @godot GPUParticles3D.get_lifetime
 * @source scene/3d/gpu_particles_3d.cpp:197
 */
export function get_lifetime(self: object): number {
  return stateOf(self, 'get_lifetime').lifetime;
}

/**
 * Turning one-shot off while emitting restarts the system.
 *
 * @godot GPUParticles3D.set_one_shot
 * @source scene/3d/gpu_particles_3d.cpp:97
 */
export function set_one_shot(self: object, p_one_shot: boolean): void {
  const s = stateOf(self, 'set_one_shot');
  s.one_shot = p_one_shot;
  s.particles.one_shot = p_one_shot;
  if (s.emitting && !p_one_shot) s.particles.restart_request = true;
}

/**
 * @godot GPUParticles3D.get_one_shot
 * @source scene/3d/gpu_particles_3d.cpp:205
 */
export function get_one_shot(self: object): boolean {
  return stateOf(self, 'get_one_shot').one_shot;
}

/**
 * @godot GPUParticles3D.set_use_fixed_seed
 * @source scene/3d/gpu_particles_3d.cpp:108
 */
export function set_use_fixed_seed(self: object, p_use_fixed_seed: boolean): void {
  stateOf(self, 'set_use_fixed_seed').use_fixed_seed = p_use_fixed_seed;
}

/**
 * @godot GPUParticles3D.set_seed
 * @source scene/3d/gpu_particles_3d.cpp:120
 */
export function set_seed(self: object, p_seed: number): void {
  const s = stateOf(self, 'set_seed');
  s.seed = p_seed >>> 0;
  s.particles.random_seed = s.seed;
}

/**
 * @godot GPUParticles3D.get_seed
 * @source scene/3d/gpu_particles_3d.cpp:125
 */
export function get_seed(self: object): number {
  return stateOf(self, 'get_seed').seed;
}

/**
 * @godot GPUParticles3D.set_pre_process_time
 * @source scene/3d/gpu_particles_3d.cpp:129
 */
export function set_pre_process_time(self: object, p_time: number): void {
  const s = stateOf(self, 'set_pre_process_time');
  s.pre_process_time = p_time;
  s.particles.pre_process_time = p_time;
}

/**
 * @godot GPUParticles3D.get_pre_process_time
 * @source scene/3d/gpu_particles_3d.cpp:209
 */
export function get_pre_process_time(self: object): number {
  return stateOf(self, 'get_pre_process_time').pre_process_time;
}

/**
 * @godot GPUParticles3D.set_explosiveness_ratio
 * @source scene/3d/gpu_particles_3d.cpp:134
 */
export function set_explosiveness_ratio(self: object, p_ratio: number): void {
  const s = stateOf(self, 'set_explosiveness_ratio');
  s.explosiveness_ratio = f32(p_ratio);
  s.particles.explosiveness = s.explosiveness_ratio;
}

/**
 * @godot GPUParticles3D.get_explosiveness_ratio
 * @source scene/3d/gpu_particles_3d.cpp:213
 */
export function get_explosiveness_ratio(self: object): number {
  return stateOf(self, 'get_explosiveness_ratio').explosiveness_ratio;
}

/**
 * @godot GPUParticles3D.set_randomness_ratio
 * @source scene/3d/gpu_particles_3d.cpp:139
 */
export function set_randomness_ratio(self: object, p_ratio: number): void {
  const s = stateOf(self, 'set_randomness_ratio');
  s.randomness_ratio = f32(p_ratio);
  s.particles.randomness = s.randomness_ratio;
}

/**
 * @godot GPUParticles3D.get_randomness_ratio
 * @source scene/3d/gpu_particles_3d.cpp:217
 */
export function get_randomness_ratio(self: object): number {
  return stateOf(self, 'get_randomness_ratio').randomness_ratio;
}

/**
 * @godot GPUParticles3D.set_visibility_aabb
 * @source scene/3d/gpu_particles_3d.cpp:144
 */
export function set_visibility_aabb(self: object, p_aabb: { readonly position: { readonly x: number; readonly y: number; readonly z: number }; readonly size: { readonly x: number; readonly y: number; readonly z: number } }): void {
  const s = stateOf(self, 'set_visibility_aabb');
  s.visibility_aabb = { position: [p_aabb.position.x, p_aabb.position.y, p_aabb.position.z], size: [p_aabb.size.x, p_aabb.size.y, p_aabb.size.z] };
  s.particles.custom_aabb = s.visibility_aabb;
}

/**
 * @godot GPUParticles3D.set_use_local_coordinates
 * @source scene/3d/gpu_particles_3d.cpp:150
 */
export function set_use_local_coordinates(self: object, p_enable: boolean): void {
  const s = stateOf(self, 'set_use_local_coordinates');
  s.local_coords = p_enable;
  s.particles.use_local_coords = p_enable;
}

/**
 * @godot GPUParticles3D.get_use_local_coordinates
 * @source scene/3d/gpu_particles_3d.cpp:225
 */
export function get_use_local_coordinates(self: object): boolean {
  return stateOf(self, 'get_use_local_coordinates').local_coords;
}

/**
 * @godot GPUParticles3D.set_process_material
 * @source scene/3d/gpu_particles_3d.cpp:155
 */
export function set_process_material(self: object, p_material: ParticleProcessMaterial | null): void {
  const s = stateOf(self, 'set_process_material');
  s.process_material = p_material;
  s.particles.process_material = p_material;
}

/**
 * @godot GPUParticles3D.get_process_material
 * @source scene/3d/gpu_particles_3d.cpp:229
 */
export function get_process_material(self: object): ParticleProcessMaterial | null {
  return stateOf(self, 'get_process_material').process_material;
}

/**
 * A paused node's system runs at speed 0 (`NOTIFICATION_ENTER_TREE`, `:583`).
 *
 * @godot GPUParticles3D.set_speed_scale
 * @source scene/3d/gpu_particles_3d.cpp:179
 */
export function set_speed_scale(self: object, p_scale: number): void {
  const s = stateOf(self, 'set_speed_scale');
  s.speed_scale = p_scale;
  s.particles.speed_scale = p_scale;
}

/**
 * @godot GPUParticles3D.get_speed_scale
 * @source scene/3d/gpu_particles_3d.cpp:233
 */
export function get_speed_scale(self: object): number {
  return stateOf(self, 'get_speed_scale').speed_scale;
}

/**
 * The view-depth order needs the camera's sort, which is not transcribed.
 *
 * @godot GPUParticles3D.set_draw_order
 * @source scene/3d/gpu_particles_3d.cpp:241
 */
export function set_draw_order(self: object, p_order: number): void {
  const s = stateOf(self, 'set_draw_order');
  if (p_order === DRAW_ORDER_VIEW_DEPTH) throw new Error('godot-compat: the view-depth particle draw order is not transcribed.');
  s.draw_order = p_order;
  s.particles.draw_order = p_order;
}

/**
 * A changed rate frees the system's buffers and restarts it (`particles_set_fixed_fps`).
 *
 * @godot GPUParticles3D.set_fixed_fps
 * @source scene/3d/gpu_particles_3d.cpp:314
 */
export function set_fixed_fps(self: object, p_count: number): void {
  const s = stateOf(self, 'set_fixed_fps');
  s.fixed_fps = p_count;
  const p = s.particles;
  p.fixed_fps = p_count;
  freeData(p);
  p.phase = 0;
  p.prev_phase = 0;
  p.clear = true;
}

/**
 * @godot GPUParticles3D.get_fixed_fps
 * @source scene/3d/gpu_particles_3d.cpp:319
 */
export function get_fixed_fps(self: object): number {
  return stateOf(self, 'get_fixed_fps').fixed_fps;
}

/**
 * @godot GPUParticles3D.set_fractional_delta
 * @source scene/3d/gpu_particles_3d.cpp:323
 */
export function set_fractional_delta(self: object, p_enable: boolean): void {
  const s = stateOf(self, 'set_fractional_delta');
  s.fractional_delta = p_enable;
  s.particles.fractional_delta = p_enable;
}

/**
 * @godot GPUParticles3D.set_interpolate
 * @source scene/3d/gpu_particles_3d.cpp:332
 */
export function set_interpolate(self: object, p_enable: boolean): void {
  const s = stateOf(self, 'set_interpolate');
  s.interpolate = p_enable;
  s.particles.interpolate = p_enable;
}

/**
 * @godot GPUParticles3D.set_amount_ratio
 * @source scene/3d/gpu_particles_3d.cpp:774
 */
export function set_amount_ratio(self: object, p_ratio: number): void {
  const s = stateOf(self, 'set_amount_ratio');
  s.amount_ratio = f32(p_ratio);
  s.particles.amount_ratio = s.amount_ratio;
}

/**
 * @godot GPUParticles3D.set_transform_align
 * @source scene/3d/gpu_particles_3d.cpp:652
 */
export function set_transform_align(self: object, p_align: number): void {
  const s = stateOf(self, 'set_transform_align');
  s.transform_align = p_align;
  s.particles.transform_align = p_align;
}

/**
 * Restarts the system: a new seed unless kept or fixed, emitting, the one-shot countdown anew.
 *
 * @godot GPUParticles3D.restart
 * @source scene/3d/gpu_particles_3d.cpp:442
 */
export function restart(self: object, p_keep_seed = false): void {
  const s = stateOf(self, 'restart');
  if (!p_keep_seed && !s.use_fixed_seed) set_seed(self, randi() >>> 0);
  s.particles.restart_request = true;
  s.particles.emitting = true;
  s.emitting = true;
  s.active = true;
  s.signal_canceled = false;
  s.time = 0;
  s.emission_time = s.lifetime * (1 - s.explosiveness_ratio);
  s.active_time = s.lifetime * (2 - s.explosiveness_ratio);
  setProcessInternal(self, s, true);
}

/**
 * The particles' current bounds, read back from the GPU: every live particle's position (a zero
 * first row, `xform[0] > 0.0`, is an inactive one), into the emitter's frame unless the system is
 * local, grown by the longest axis of the largest draw pass. It reads the sort buffer when a
 * previous frame filled it, else the back instance buffer, as the Compatibility renderer does
 * (`ParticlesStorage::particles_get_current_aabb`, `drivers/gles3/storage/particles_storage.cpp:408`);
 * with no buffer yet it is `AABB()`, as there (`:419`).
 *
 * @godot GPUParticles3D.capture_aabb
 * @source scene/3d/gpu_particles_3d.cpp:458
 */
export function capture_aabb(self: object): AABB {
  const s = stateOf(self, 'capture_aabb');
  const p = s.particles;
  const b = p.gl;
  const gl = rasterizer.gl;
  if (b === null || gl === null) return aabb();
  const read_buffer = p.sort_buffer_filled && b.sort_buffer !== null ? b.sort_buffer : b.back_instance_buffer;
  const stride = b.instance_buffer_stride / 4;
  const data = new Float32Array(stride * p.amount);
  gl.bindBuffer(gl.ARRAY_BUFFER, read_buffer);
  gl.getBufferSubData(gl.ARRAY_BUFFER, 0, data);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  const inv = affine_inverse(p.emission_xform);
  let box = aabb();
  let first = true;
  for (let i = 0; i < p.amount; i += 1) {
    const at = i * stride;
    // If scale is 0.0, we assume the particle is inactive.
    if ((data[at] as number) > 0.0) {
      let pos = vector3(data[at + 3] as number, data[at + 7] as number, data[at + 11] as number);
      if (!p.use_local_coords) pos = op_multiply(inv, pos);
      if (first) {
        box = aabb(pos, vector3());
        first = false;
      } else {
        box = godot_aabb_expand_to(box, pos);
      }
    }
  }
  let longest_axis_size = 0;
  for (const pass of s.draw_passes) {
    if (pass === null) continue;
    pass.geometry.computeBoundingBox();
    const bounds = pass.geometry.boundingBox as Box3;
    const mesh_aabb = aabb(vector3(bounds.min.x, bounds.min.y, bounds.min.z), vector3(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z));
    longest_axis_size = Math.max(get_longest_axis_size(mesh_aabb), longest_axis_size);
  }
  return godot_aabb_grow_by(box, longest_axis_size);
}

/**
 * The node's `finished` signal, emitted when a one-shot system's particles have all ended.
 *
 * @godot GPUParticles3D.finished
 * @source scene/3d/gpu_particles_3d.cpp:554
 */
export function finished(self: object): GodotSignal<[]> {
  return godot_object_signal<[]>(self, 'finished').signal;
}

// --- The frame (`RenderingServerDefault::draw`, `rendering_server_default.cpp:103`).

const frustum = new Frustum();
const sphere = new Sphere();
const projection = new Matrix4();
const cameraAxis = new ThreeVector3();
const cameraUp = new ThreeVector3();
const scratch = new Matrix4();

/** Half to float (`unpackHalf2x16`). */
function half(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (mantissa / 1024);
  if (exponent === 31) return mantissa === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024);
}

/** The instance buffer read back into each draw pass's instances (`particles_get_gl_buffer`). */
function readBack(gl: WebGL2RenderingContext, entity: object, s: GPUParticles3D): void {
  const p = s.particles;
  const b = p.gl;
  if (b === null) return;
  const source = (p.draw_order === DRAW_ORDER_REVERSE_LIFETIME && p.sort_buffer_filled && b.sort_buffer !== null) ? b.sort_buffer : b.back_instance_buffer;
  const floats = new Float32Array((b.instance_buffer_stride / 4) * p.amount);
  gl.bindBuffer(gl.ARRAY_BUFFER, source);
  gl.getBufferSubData(gl.ARRAY_BUFFER, 0, floats);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  const words = new Uint32Array(floats.buffer);
  const drawn = draw(entity, s);
  for (const mesh of drawn) {
    const colors = mesh.geometry.getAttribute('godotInstanceColor') as InstancedBufferAttribute;
    const customs = mesh.geometry.getAttribute('godotInstanceCustom') as InstancedBufferAttribute;
    for (let i = 0; i < p.amount; i += 1) {
      const at = i * 16;
      // The three transform rows, then the packed colour and custom (`particles_copy.glsl`).
      scratch.set(floats[at] as number, floats[at + 1] as number, floats[at + 2] as number, floats[at + 3] as number, floats[at + 4] as number, floats[at + 5] as number, floats[at + 6] as number, floats[at + 7] as number, floats[at + 8] as number, floats[at + 9] as number, floats[at + 10] as number, floats[at + 11] as number, 0, 0, 0, 1);
      mesh.setMatrixAt(i, scratch);
      const packed = [words[at + 12] as number, words[at + 13] as number, words[at + 14] as number, words[at + 15] as number];
      (colors.array as Float32Array).set([half(packed[0] & 0xffff), half(packed[0] >>> 16), half(packed[1] & 0xffff), half(packed[1] >>> 16)], i * 4);
      (customs.array as Float32Array).set([half(packed[2] & 0xffff), half(packed[2] >>> 16), half(packed[3] & 0xffff), half(packed[3] >>> 16)], i * 4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    colors.needsUpdate = true;
    customs.needsUpdate = true;
  }
}

/**
 * The draw passes as `InstancedMesh` children (the instance's surfaces, each with the material
 * override or the surface's own), drawn in the world's frame unless the system is local
 * (`store_transform`, `rasterizer_scene_gles3.cpp:502`).
 */
function draw(entity: object, s: GPUParticles3D): InstancedMesh[] {
  const count = s.particles.amount;
  const wanted = s.draw_passes.filter((pass): pass is { geometry: BufferGeometry; material: Material | null } => pass !== null);
  if (s.drawn.length !== wanted.length || s.drawn.some((mesh) => mesh.count !== count)) {
    for (const mesh of s.drawn) (entity as Object3D).remove(mesh);
    s.drawn = wanted.map((pass) => {
      const own = pass.geometry.clone();
      own.setAttribute('godotInstanceColor', new InstancedBufferAttribute(new Float32Array(count * 4), 4));
      own.setAttribute('godotInstanceCustom', new InstancedBufferAttribute(new Float32Array(count * 4), 4));
      const material = s.material_override ?? pass.material ?? undefined;
      const mesh = new InstancedMesh(own, material, count);
      mesh.frustumCulled = false;
      mesh.castShadow = s.cast_shadow;
      godot_node_foreign(mesh);
      (entity as Object3D).add(mesh);
      return mesh;
    });
  }
  for (const mesh of s.drawn) {
    if (!s.particles.use_local_coords) {
      // Particles in world space: the instances are drawn with the world's transform.
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorldAutoUpdate = false;
      mesh.matrixWorld.identity();
    }
  }
  return s.drawn;
}

/**
 * One rendered frame of every GPU particle system (`RenderingServerDefault::draw`): the
 * rasterizer's clock advances by the frame's step (`begin_frame`), the systems a visible instance
 * asked to process last frame are processed (`update_particles`), each system whose instance is
 * visible to `camera` asks again (`RendererSceneCull::_scene_cull`, `renderer_scene_cull.cpp:2993`:
 * the visibility AABB in the instance's frame against the camera's frustum) and has its instance
 * buffer copied with the camera's axes (`_scene_particles_set_view_axis`), and each system's
 * instances are read back into its draw passes.
 *
 * @godot GPUParticles3D (protocol)
 * @source servers/rendering/rendering_server_default.cpp:103
 */
export function godot_gpu_particles_3d_frame(renderer: WebGLRenderer, camera: Camera | null, frame_step: number): void {
  rasterizer.gl = renderer.getContext() as WebGL2RenderingContext;
  rasterizer.frame += 1;
  rasterizer.delta = frame_step;
  rasterizer.time_total = (rasterizer.time_total + frame_step) % TIME_ROLLOVER;
  if (SYSTEMS.size === 0) return;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  // The emission transforms (`RendererSceneCull::_update_instance`, `renderer_scene_cull.cpp:1667`).
  for (const entity of SYSTEMS) {
    const s = STATE.get(entity) as GPUParticles3D;
    if (is_inside_tree(entity)) {
      s.particles.emission_xform = get_global_transform(entity as Object3D);
      storeTransform(s.particles.emission_xform, s.particles.emission_transform);
    }
  }
  updateParticles(gl);
  if (camera !== null) {
    camera.updateMatrixWorld();
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection);
    cameraAxis.setFromMatrixColumn(camera.matrixWorld, 2).normalize().negate();
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    gl.enable(gl.RASTERIZER_DISCARD);
    for (const entity of SYSTEMS) {
      const s = STATE.get(entity) as GPUParticles3D;
      if (!is_inside_tree(entity) || !is_visible_in_tree(entity as Object3D)) continue;
      const aabb = s.particles.custom_aabb;
      sphere.center.set(aabb.position[0] + aabb.size[0] / 2, aabb.position[1] + aabb.size[1] / 2, aabb.position[2] + aabb.size[2] / 2);
      sphere.radius = Math.sqrt(aabb.size[0] ** 2 + aabb.size[1] ** 2 + aabb.size[2] ** 2) / 2;
      sphere.applyMatrix4((entity as Object3D).matrixWorld);
      if (!frustum.intersectsSphere(sphere)) continue;
      if (isInactive(s.particles)) continue;
      requestProcess(s);
      setViewAxis(gl, s.particles, cameraAxis, cameraUp);
    }
    gl.disable(gl.RASTERIZER_DISCARD);
  }
  for (const entity of SYSTEMS) {
    const s = STATE.get(entity) as GPUParticles3D;
    if (s.particles.gl !== null) readBack(gl, entity, s);
  }
  renderer.resetState();
}

godot_viewport_frame_work(godot_gpu_particles_3d_frame);

/** The draw passes and the material override, as a scene states them. */
function setDrawPass(self: object, pass: number, value: { readonly geometry: BufferGeometry; readonly material: Material | null } | null): void {
  const s = stateOf(self, 'set_draw_pass_mesh');
  while (s.draw_passes.length <= pass) s.draw_passes.push(null);
  s.draw_passes[pass] = value;
  for (const mesh of s.drawn) (self as Object3D).remove(mesh);
  s.drawn = [];
}

/** The props a scene states on `<GodotGPUParticles3D>`, by the setter each calls. */
const GPU_PARTICLES_3D_ELEMENT: GodotElementClass<Group> = {
  create: () => new Group(),
  classes: GPU_PARTICLES_3D,
  spatial: true,
  mount: (entity) => godot_gpu_particles_3d_adopt(entity),
  props: new Map<string, GodotElementProp<Group>>([
    ['emitting', (self, value: boolean) => set_emitting(self, value)],
    ['amount', (self, value: number) => set_amount(self, value)],
    ['lifetime', (self, value: number) => set_lifetime(self, value)],
    ['oneShot', (self, value: boolean) => set_one_shot(self, value)],
    ['preprocess', (self, value: number) => set_pre_process_time(self, value)],
    ['speedScale', (self, value: number) => set_speed_scale(self, value)],
    ['explosiveness', (self, value: number) => set_explosiveness_ratio(self, value)],
    ['randomness', (self, value: number) => set_randomness_ratio(self, value)],
    ['fixedFps', (self, value: number) => set_fixed_fps(self, value)],
    ['interpolate', (self, value: boolean) => set_interpolate(self, value)],
    ['fractDelta', (self, value: boolean) => set_fractional_delta(self, value)],
    ['localCoords', (self, value: boolean) => set_use_local_coordinates(self, value)],
    ['drawOrder', (self, value: number) => set_draw_order(self, value)],
    ['transformAlign', (self, value: number) => set_transform_align(self, value)],
    ['amountRatio', (self, value: number) => set_amount_ratio(self, value)],
    ['useFixedSeed', (self, value: boolean) => set_use_fixed_seed(self, value)],
    ['seed', (self, value: number) => set_seed(self, value)],
    ['processMaterial', (self, value: ParticleProcessMaterial | null) => set_process_material(self, value)],
    ['visibilityAabb', (self, value: readonly number[]) => set_visibility_aabb(self, { position: { x: value[0] as number, y: value[1] as number, z: value[2] as number }, size: { x: value[3] as number, y: value[4] as number, z: value[5] as number } })],
    ['drawPass1', (self, value: { readonly geometry: BufferGeometry; readonly material: Material | null } | null) => setDrawPass(self, 0, value)],
    [
      'materialOverride',
      (self, value: Material | null) => {
        const s = stateOf(self, 'set_material_override');
        s.material_override = value;
        for (const mesh of s.drawn) (self as Object3D).remove(mesh);
        s.drawn = [];
      },
    ],
    [
      'castShadow',
      (self, value: number) => {
        const s = stateOf(self, 'set_cast_shadows_setting');
        s.cast_shadow = value !== 0;
        for (const mesh of s.drawn) mesh.castShadow = s.cast_shadow;
      },
    ],
  ]),
};

/**
 * A GPUParticles3D as a scene writes it (`gpu_particles_3d.cpp:783`: its properties): a group the
 * node's state is kept on, drawing its particles as `InstancedMesh` children.
 *
 * @godot GPUParticles3D (protocol)
 * @source scene/3d/gpu_particles_3d.cpp:783
 */
export function GodotGPUParticles3D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(GPU_PARTICLES_3D_ELEMENT, props);
}
