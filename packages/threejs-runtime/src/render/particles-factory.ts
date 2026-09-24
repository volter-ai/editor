// biome-ignore-all lint/suspicious/noExplicitAny: quarks' API uses untyped FunctionJSON internally; our Zod types are structurally compatible but TS can't unify them
/**
 * Converts ParticlesDescriptor JSON → three.quarks ParticleSystem.
 *
 * A published engine entry point (the export map is the wildcard `./*`): user
 * games outside this repo reach it directly, and the in-repo callers are the
 * editor's own selection-bounds proof and `defaultParticlesData`'s consumers.
 * The schema mirrors quarks' native JSON format, so most fields pass through
 * directly to quarks' fromJSON or constructor methods.
 *
 * It used to name `godot-compat`'s `createCpuParticles3D` as its one in-repo
 * caller; that lane is ARCHIVED off main — `git fetch origin
 * archive/godot-lane`, tag `archive/godot-lane-2026-09-19`.
 */

import {
  ApplyForce,
  ChangeEmitDirection,
  CircleEmitter,
  type ColorGenerator,
  ColorGeneratorFromJSON,
  ColorOverLife,
  ConeEmitter,
  DonutEmitter,
  type EmitterShape,
  ForceOverLife,
  FrameOverLife,
  type FunctionColorGenerator,
  GravityForce,
  GridEmitter,
  HemisphereEmitter,
  LimitSpeedOverLife,
  Noise,
  OrbitOverLife,
  PointEmitter,
  Vector3 as QVector3,
  RectangleEmitter,
  RotationOverLife,
  SizeOverLife,
  SpeedOverLife,
  SphereEmitter,
  TurbulenceField,
  ValueGeneratorFromJSON,
  WidthOverLength,
} from 'quarks.core';
import * as THREE from 'three';
import { type BatchedRenderer, ParticleSystem, RenderMode } from 'three.quarks';
import type {
  BehaviorJSON,
  ColorGeneratorJSON,
  EmitterShapeJSON,
  ParticlesDescriptor,
  ValueGeneratorJSON,
} from '../asset-formats/particles';
import { armSoftParticleDepth, disarmSoftParticleDepth } from './soft-particle-depth';

// --- Render mode mapping ---

const RENDER_MODE_MAP: Record<string, RenderMode> = {
  billboard: RenderMode.BillBoard,
  stretchedBillboard: RenderMode.StretchedBillBoard,
  mesh: RenderMode.Mesh,
  trail: RenderMode.Trail,
  horizontalBillboard: RenderMode.HorizontalBillBoard,
  verticalBillboard: RenderMode.VerticalBillBoard,
};

// --- Texture loader (shared cache) ---

import { textureLoader } from '../loader';

type ParticleMapSampler = NonNullable<ParticlesDescriptor['material']['mapSampler']>;

const WRAP: Record<NonNullable<ParticleMapSampler['wrap']>, THREE.Wrapping> = {
  clamp: THREE.ClampToEdgeWrapping,
  repeat: THREE.RepeatWrapping,
  mirror: THREE.MirroredRepeatWrapping,
};

/** `minFilter` is where the two sampler axes MEET — `filter` chooses linear vs nearest and
 *  `mipmaps` chooses whether the mip chain is sampled at all — and three spells the four
 *  combinations as four constants. A table rather than nested conditionals, which read as a
 *  puzzle. (`magFilter` has no mip half; it is the `filter` axis alone.) */
const MIN_FILTER = {
  'linear/mips': THREE.LinearMipmapLinearFilter,
  'linear/no-mips': THREE.LinearFilter,
  'nearest/mips': THREE.NearestMipmapNearestFilter,
  'nearest/no-mips': THREE.NearestFilter,
} as const;

const particleTexCache = new Map<string, THREE.Texture>();

/**
 * The sprite texture for a material's `map`, loaded once per URL+sampler.
 *
 * Two things are decided here rather than left to three's loader defaults:
 *
 *  - **COLOUR SPACE.** `THREE.TextureLoader` leaves `colorSpace` at `NoColorSpace`, which tells
 *    three the texels are already linear — so an ordinary sRGB PNG sprite is composited
 *    UNDECODED and every mid-tone comes out far too bright. A `map` is a colour texture by
 *    definition (three's own `GLTFLoader` states `SRGBColorSpace` on `baseColorTexture` for the
 *    same reason), so this states sRGB unconditionally. It is not a descriptor field: there is no
 *    correct second value for this slot. Measured 2026-08-14 against real Godot 3.6/GLES3 — a
 *    128,128,128 sprite read back 0.5015 there and 0.7373 here, and after this line 0.5019; the
 *    whole A/B is in `godot-compat/cpu-particles-3d.ts`'s header.
 *  - **SAMPLER.** `material.mapSampler`, when the descriptor carries one. The cache key includes
 *    it because two emitters may name ONE image and want different sampling of it — a URL-only
 *    key would hand the second one the first's configured texture.
 *
 * `flipY` is deliberately untouched: the billboard quad this shader draws is built by
 * `three.quarks` with three's own V-up UVs, so three's `flipY = true` is the consistent half of
 * that pair.
 */
function loadParticleTexture(url: string, sampler?: ParticleMapSampler): THREE.Texture {
  const key = sampler === undefined ? url : `${url}\u0000${JSON.stringify(sampler)}`;
  const cached = particleTexCache.get(key);
  if (cached) return cached;
  const tex = textureLoader.load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (sampler !== undefined) applyMapSampler(tex, sampler);
  particleTexCache.set(key, tex);
  return tex;
}

/** One `mapSampler` onto three's own texture properties. An unstated field is left at three's
 *  default rather than restated — see {@link loadParticleTexture}. */
function applyMapSampler(tex: THREE.Texture, sampler: ParticleMapSampler): void {
  if (sampler.wrap !== undefined) {
    tex.wrapS = WRAP[sampler.wrap];
    tex.wrapT = WRAP[sampler.wrap];
  }
  if (sampler.filter !== undefined || sampler.mipmaps !== undefined) {
    // An unstated axis takes three's own default, which is linear and mipmapped.
    const filter = sampler.filter ?? 'linear';
    const mips = sampler.mipmaps === false ? 'no-mips' : 'mips';
    if (sampler.filter !== undefined) {
      tex.magFilter = filter === 'linear' ? THREE.LinearFilter : THREE.NearestFilter;
    }
    tex.minFilter = MIN_FILTER[`${filter}/${mips}`];
  }
  if (sampler.mipmaps !== undefined) tex.generateMipmaps = sampler.mipmaps;
  // Anisotropy rides through unclamped: three's own `WebGLTextures` uploads
  // `Math.min(texture.anisotropy, capabilities.getMaxAnisotropy())`, so the renderer's real
  // capability is what binds and a second clamp here would have no effect.
  if (sampler.anisotropy !== undefined) tex.anisotropy = sampler.anisotropy;
}

// --- Helpers ---

/** Strip keys with undefined values so exactOptionalPropertyTypes is satisfied. */
function defined(obj: Record<string, any>): any {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
}

// --- Emitter shape ---

function createEmitterShape(json: EmitterShapeJSON) {
  switch (json.type) {
    case 'point':
      return new PointEmitter();
    case 'sphere':
      return new SphereEmitter(
        defined({ radius: json.radius, arc: json.arc, thickness: json.thickness }),
      );
    case 'hemisphere':
      return new HemisphereEmitter(
        defined({ radius: json.radius, arc: json.arc, thickness: json.thickness }),
      );
    case 'cone':
      return new ConeEmitter(
        defined({
          radius: json.radius,
          arc: json.arc,
          thickness: json.thickness,
          angle: json.angle,
        }),
      );
    case 'circle':
      return new CircleEmitter(
        defined({ radius: json.radius, arc: json.arc, thickness: json.thickness }),
      );
    case 'donut':
      return new DonutEmitter(
        defined({
          radius: json.radius,
          arc: json.arc,
          thickness: json.thickness,
          donutRadius: json.donutRadius,
        }),
      );
    case 'rectangle':
      return new RectangleEmitter(
        defined({ width: json.width, height: json.height, thickness: json.thickness }),
      );
    case 'grid':
      return new GridEmitter(
        defined({ width: json.width, height: json.height, column: json.column, row: json.row }),
      );
  }
}

// --- Value / Color generators ---
// Our Zod-inferred types are structurally identical to quarks' FunctionJSON
// but TypeScript can't unify them, so we cast through the untyped bridge.

function valueGen(json: ValueGeneratorJSON) {
  return ValueGeneratorFromJSON(json as any);
}

function colorGen(json: ColorGeneratorJSON) {
  return ColorGeneratorFromJSON(json as any);
}

// --- Behaviors ---

function createBehavior(json: BehaviorJSON): any {
  switch (json.type) {
    case 'ApplyForce':
      return new ApplyForce(
        new QVector3(json.direction[0], json.direction[1], json.direction[2]),
        valueGen(json.magnitude) as any,
      );
    case 'ColorOverLife':
      return new ColorOverLife(colorGen(json.color) as any);
    case 'SizeOverLife':
      return new SizeOverLife(valueGen(json.size) as any);
    case 'SpeedOverLife':
      return new SpeedOverLife(valueGen(json.speed) as any);
    case 'RotationOverLife':
      return new RotationOverLife(valueGen(json.angularVelocity) as any);
    case 'ForceOverLife':
      return new ForceOverLife(
        valueGen(json.x) as any,
        valueGen(json.y) as any,
        valueGen(json.z) as any,
      );
    case 'OrbitOverLife':
      return new OrbitOverLife(
        valueGen(json.orbitSpeed) as any,
        json.axis ? new QVector3(json.axis[0], json.axis[1], json.axis[2]) : undefined,
      );
    case 'Noise':
      return new Noise(
        valueGen(json.frequency) as any,
        valueGen(json.power) as any,
        json.positionAmount ? (valueGen(json.positionAmount) as any) : undefined,
        json.rotationAmount ? (valueGen(json.rotationAmount) as any) : undefined,
      );
    case 'TurbulenceField':
      return new TurbulenceField(
        new QVector3(json.scale[0], json.scale[1], json.scale[2]),
        json.octaves,
        new QVector3(
          json.velocityMultiplier[0],
          json.velocityMultiplier[1],
          json.velocityMultiplier[2],
        ),
        new QVector3(json.timeScale[0], json.timeScale[1], json.timeScale[2]),
      );
    case 'FrameOverLife':
      return new FrameOverLife(valueGen(json.frame) as any);
    case 'LimitSpeedOverLife':
      return new LimitSpeedOverLife(valueGen(json.speed) as any, json.dampen);
    case 'ChangeEmitDirection':
      return new ChangeEmitDirection(valueGen(json.angle) as any);
    case 'GravityForce':
      return new GravityForce(
        new QVector3(json.center[0], json.center[1], json.center[2]),
        json.magnitude,
      );
    case 'WidthOverLength':
      return new WidthOverLength(valueGen(json.width) as any);
  }
}

// --- Material ---

function createParticleMaterial(mat: ParticlesDescriptor['material']): THREE.Material {
  const textures: Record<string, THREE.Texture> = {};
  if (mat.map) textures['map'] = loadParticleTexture(mat.map, mat.mapSampler);

  const blending = mat.blending === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending;
  const transparent = mat.transparent !== false;
  const depthWrite = mat.depthWrite ?? false;
  const side =
    mat.side === 'back'
      ? THREE.BackSide
      : mat.side === 'double'
        ? THREE.DoubleSide
        : THREE.FrontSide;

  if (mat.type === 'standard') {
    return new THREE.MeshStandardMaterial({
      color: mat.color ?? '#ffffff',
      ...textures,
      blending,
      transparent,
      depthWrite,
      side,
    });
  }

  return new THREE.MeshBasicMaterial({
    color: mat.color ?? '#ffffff',
    ...textures,
    blending,
    transparent,
    depthWrite,
    side,
  });
}

// --- Default sprite texture (soft radial gradient) ---

let _defaultSpriteTex: THREE.Texture | null = null;

function getDefaultSpriteTex(): THREE.Texture {
  if (_defaultSpriteTex) return _defaultSpriteTex;
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const c2d = canvas.getContext('2d')!;
  const grad = c2d.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  c2d.fillStyle = grad;
  c2d.fillRect(0, 0, 16, 16);
  _defaultSpriteTex = new THREE.CanvasTexture(canvas);
  return _defaultSpriteTex;
}

// --- Public API ---

export interface ParticleSystemResult {
  /** The emitter Object3D (add to scene for transform) */
  emitter: THREE.Object3D;
  /** The ParticleSystem instance (register with BatchedRenderer) */
  system: ParticleSystem;
}

/**
 * The non-JSON companion to a {@link ParticlesDescriptor} — the runtime objects
 * a JSON document cannot carry, and an authoring toggle. Every field is
 * optional and the whole argument is optional, so existing single-argument
 * callers are unchanged.
 *
 * This is how a caller with fidelity a plain descriptor cannot express reaches
 * the SAME factory instead of hand-building its own `new ParticleSystem(...)`:
 * a foreign-engine carry (e.g. Godot CPUParticles) supplies its own
 * `EmitterShape`, start-colour generator, and instancing geometry here, and
 * expresses everything else — lifecycle, scalar start values, emission,
 * behaviors, material — as descriptor JSON.
 */
export interface ParticleSystemObjects {
  /**
   * A pre-built emitter shape for a spawn distribution the JSON `shape` field
   * cannot express (a `three.quarks` `EmitterShape` plugin instance). When
   * present it REPLACES `data.shape`.
   */
  shape?: EmitterShape;
  /**
   * A pre-built start-colour generator for a per-particle draw the descriptor's
   * JSON generator vocabulary cannot express. When present it REPLACES
   * `data.startColor`.
   */
  startColor?: ColorGenerator | FunctionColorGenerator;
  /**
   * The geometry instanced per particle in `RenderMode.Mesh`. A
   * `BufferGeometry` is not JSON-serializable, so `renderMode: 'mesh'` requires
   * the caller to resolve and pass it here.
   */
  instancingGeometry?: THREE.BufferGeometry;
  /**
   * When the material has no texture `map`, the factory substitutes a soft
   * radial default sprite so a freshly-authored billboard shows something.
   * Pass `false` to keep the material's own (map-less) appearance — a faithful
   * carry of a foreign engine whose particle draws a plain colored quad, and
   * the way that carry avoids the default-sprite canvas entirely. Defaults to
   * `true`.
   */
  defaultSprite?: boolean;
}

/**
 * Create a three.quarks ParticleSystem from ParticlesDescriptor JSON data.
 *
 * `objects` carries the pieces a JSON descriptor cannot: a plugin emitter
 * shape, a start-colour generator, a mesh-mode instancing geometry, and the
 * default-sprite toggle. It is optional and additive — a call with only `data`
 * behaves exactly as before.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: straightforward field-by-field mapping
export function createParticleSystemFromData(
  data: ParticlesDescriptor,
  objects?: ParticleSystemObjects,
): ParticleSystemResult {
  const material = createParticleMaterial(data.material);

  // Apply default sprite if no texture specified (unless the caller opts out to
  // keep a map-less material faithful to its source).
  if ((objects?.defaultSprite ?? true) && !data.material.map && 'map' in material) {
    (material as THREE.MeshBasicMaterial).map = getDefaultSpriteTex();
  }

  // Build params, strip undefined keys for exactOptionalPropertyTypes compat
  const params: Record<string, unknown> = { material };

  if (data.autoDestroy != null) params['autoDestroy'] = data.autoDestroy;
  if (data.looping != null) params['looping'] = data.looping;
  if (data.prewarm != null) params['prewarm'] = data.prewarm;
  if (data.duration != null) params['duration'] = data.duration;
  // A pre-built shape (a distribution the JSON cannot express) wins over the
  // descriptor's own shape; otherwise build the shape from JSON.
  if (objects?.shape) params['shape'] = objects.shape;
  else if (data.shape) params['shape'] = createEmitterShape(data.shape);
  if (objects?.instancingGeometry) params['instancingGeometry'] = objects.instancingGeometry;

  if (data.startLife) params['startLife'] = valueGen(data.startLife);
  if (data.startSpeed) params['startSpeed'] = valueGen(data.startSpeed);
  if (data.startSize) params['startSize'] = valueGen(data.startSize);
  if (data.startRotation) params['startRotation'] = valueGen(data.startRotation);
  if (objects?.startColor) params['startColor'] = objects.startColor;
  else if (data.startColor) params['startColor'] = colorGen(data.startColor);
  if (data.startTileIndex) params['startTileIndex'] = valueGen(data.startTileIndex);

  // Trail mode requires startLength inside rendererEmitterSettings, not as a top-level param
  if (data.renderMode === 'trail' && data.startLength) {
    params['rendererEmitterSettings'] = { startLength: valueGen(data.startLength) };
  }

  if (data.emissionOverTime) params['emissionOverTime'] = valueGen(data.emissionOverTime);
  if (data.emissionOverDistance)
    params['emissionOverDistance'] = valueGen(data.emissionOverDistance);
  if (data.emissionBursts) {
    params['emissionBursts'] = data.emissionBursts.map((b) => ({
      time: b.time,
      count: valueGen(b.count),
      cycle: b.cycle ?? 1,
      interval: b.interval ?? 0,
      probability: b.probability ?? 1,
    }));
  }

  if (data.behaviors) params['behaviors'] = data.behaviors.map(createBehavior);
  if (data.renderMode != null) params['renderMode'] = RENDER_MODE_MAP[data.renderMode];
  if (data.worldSpace != null) params['worldSpace'] = data.worldSpace;
  if (data.renderOrder != null) params['renderOrder'] = data.renderOrder;
  if (data.uTileCount != null) params['uTileCount'] = data.uTileCount;
  if (data.vTileCount != null) params['vTileCount'] = data.vTileCount;
  if (data.blendTiles != null) params['blendTiles'] = data.blendTiles;
  if (data.softParticles != null) params['softParticles'] = data.softParticles;
  if (data.softFarFade != null) params['softFarFade'] = data.softFarFade;
  if (data.softNearFade != null) params['softNearFade'] = data.softNearFade;

  const ps = new ParticleSystem(params as any);

  return { emitter: ps.emitter, system: ps };
}

/**
 * Patch a RUNNING ParticleSystem in place from ParticlesDescriptor JSON — the
 * editor's live-tune path (W1b). Unlike `createParticleSystemFromData`, this
 * does NOT recreate the system: the particle pool, per-particle ages, and the
 * emission clock all survive, so a curve-key drag reshapes the live emitter
 * with no restart stutter.
 *
 * Covers the live-tunable subset: lifecycle scalars (duration/looping/
 * prewarm), emitter shape, start-value generators, emission rates + bursts,
 * and the behavior stack (behavior instances are rebuilt from JSON — quarks
 * behaviors read their generators per-update, so existing particles pick the
 * new curves up on the next frame).
 *
 * NOT covered (these change the render batch and must go through the normal
 * teardown/rebuild path): material, renderMode, tiling/soft-particle render
 * settings, worldSpace.
 */
export function applyParticlesDataLive(system: ParticleSystem, data: ParticlesDescriptor): void {
  if (data.duration != null) system.duration = data.duration;
  if (data.looping != null) system.looping = data.looping;
  if (data.prewarm != null) system.prewarm = data.prewarm;
  if (data.shape) system.emitterShape = createEmitterShape(data.shape);
  if (data.startLife) system.startLife = valueGen(data.startLife) as any;
  if (data.startSpeed) system.startSpeed = valueGen(data.startSpeed) as any;
  if (data.startSize) system.startSize = valueGen(data.startSize) as any;
  if (data.startRotation) system.startRotation = valueGen(data.startRotation) as any;
  if (data.startColor) system.startColor = colorGen(data.startColor) as any;
  if (data.startTileIndex) system.startTileIndex = valueGen(data.startTileIndex) as any;
  if (data.emissionOverTime) system.emissionOverTime = valueGen(data.emissionOverTime) as any;
  if (data.emissionOverDistance)
    system.emissionOverDistance = valueGen(data.emissionOverDistance) as any;
  system.emissionBursts = (data.emissionBursts ?? []).map((b) => ({
    time: b.time,
    count: valueGen(b.count) as any,
    cycle: b.cycle ?? 1,
    interval: b.interval ?? 0,
    probability: b.probability ?? 1,
  }));
  system.behaviors = (data.behaviors ?? []).map(createBehavior);
}

/**
 * Scrub a ParticleSystem to an absolute time by deterministic re-simulation:
 * restart, then advance in fixed steps to `time`, then pause. Used by the
 * editor's emitter-transport time scrub. `update` is TS-private on
 * ParticleSystem but is exactly what BatchedRenderer.update calls per system.
 */
export function scrubParticleSystemTo(system: ParticleSystem, time: number, step = 1 / 60): void {
  system.restart();
  const target = Math.max(0, time);
  let t = 0;
  while (t < target) {
    const dt = Math.min(step, target - t);
    (system as any).update(dt);
    t += dt;
  }
  system.pause();
}

/**
 * Register a particle system with a BatchedRenderer.
 *
 * This is also the ONE seat that arms the scene-depth prepass: a system built
 * with `softParticles` compiles its batch with three.quarks' `SOFT_PARTICLES`
 * define, which samples a `depthTexture` uniform nothing else in this engine
 * would ever fill (see `render/soft-particle-depth.ts` for what an unfilled one
 * does to the frame). Arming here — rather than in
 * {@link createParticleSystemFromData} — is what makes it correct: the uniform
 * lives on the BATCH, and no batch exists until a renderer is handed the
 * system.
 */
export function registerParticleSystem(
  batchedRenderer: BatchedRenderer,
  system: ParticleSystem,
): void {
  batchedRenderer.addSystem(system);
  if (system.softParticles) armSoftParticleDepth(batchedRenderer);
}

/**
 * Unregister a particle system from a BatchedRenderer.
 *
 * Disarms the depth prepass — one decrement against the arming above, so a
 * renderer hosting several soft systems stays armed until its last one leaves.
 */
export function unregisterParticleSystem(
  batchedRenderer: BatchedRenderer,
  system: ParticleSystem,
): void {
  batchedRenderer.deleteSystem(system);
  if (system.softParticles) disarmSoftParticleDepth(batchedRenderer);
}

/**
 * Default particle data for creating a new particle emitter via AddSectionMenu.
 */
export function defaultParticlesData(): ParticlesDescriptor {
  return {
    looping: true,
    duration: 2,
    shape: { type: 'cone', radius: 0.1, angle: 0.3 },
    startLife: { type: 'IntervalValue', a: 0.5, b: 1.5 },
    startSpeed: { type: 'IntervalValue', a: 1, b: 3 },
    startSize: { type: 'IntervalValue', a: 0.05, b: 0.15 },
    startColor: {
      type: 'ConstantColor',
      color: { r: 1, g: 0.8, b: 0.2, a: 1 },
    },
    emissionOverTime: { type: 'ConstantValue', value: 30 },
    behaviors: [
      {
        type: 'SizeOverLife',
        size: {
          type: 'PiecewiseBezier',
          functions: [{ function: { p0: 1, p1: 0.67, p2: 0.33, p3: 0 }, start: 0 }],
        },
      },
    ],
    material: {
      type: 'basic',
      blending: 'additive',
      transparent: true,
      depthWrite: false,
    },
  };
}
