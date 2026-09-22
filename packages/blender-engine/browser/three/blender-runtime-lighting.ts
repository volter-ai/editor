/**
 * The scene's own lights, and the Model document's SOLID-MODE STUDIO.
 *
 * TWO LIGHTING STATES, the same split Blender makes between its solid viewport
 * and a render. Modeling is lit by Blender's four view-locked studio lights
 * ({@link ViewportLighting}), so a model reads the same however it is orbited
 * while it is being built; a RENDER is lit by the scene's own lights, because
 * that is what the script placed them for. `setRendered` switches between
 * them, and a render capture is the only caller that asks for the second.
 *
 * The studio lives here rather than in the standard viewport dressing because
 * it is BLENDER's, not the editor's: the dressing's key is one warm light in
 * the world, and Solid mode's is four in view space with no world light at
 * all. The Model document turns the dressing's key AND its IBL off and hands
 * this group over as its `dressing.viewLocked` instead.
 *
 * UNITS. The frame states Blender's own values — watts, radians, metres — and
 * the conversion to three.js's photometric intensities happens here, derived
 * rather than tuned:
 *
 * - POINT and SPOT. Blender spreads `energy` watts over the whole sphere, so
 *   irradiance at distance d is P/(4πd²); three.js gives I/d². Hence I = P/4π.
 * - SUN. `energy` is already an irradiance (W/m²) and a directional light's
 *   intensity is the same quantity, so it passes through.
 * - AREA. P watts leave an area A into a hemisphere, so the radiance is
 *   P/(Aπ), which is what `RectAreaLight.intensity` means. A DISK or ELLIPSE
 *   has no rectangular equivalent, so it becomes the rectangle of EQUAL AREA:
 *   the total emission is right and the shape of a soft shadow's edge is not.
 *
 * SHADOWS follow `use_shadow`, the same flag Cycles reads. A shadow MAP is not
 * a traced shadow: its softness comes from filtering a depth buffer rather than
 * from the light's physical size, so `shadow_soft_size` and a sun's `angle`
 * still reach the frame and still change nothing. A RectAreaLight casts none at
 * all — three.js has no shadow for it — and that is left as it is rather than
 * faked with a substitute light the scene never declared.
 */
import * as THREE from 'three';
import { z } from 'zod';
import type { GradientType } from './blender-gradient-texture';
import { hasSkyTexture, primeSkyTexture, type SkyParameters } from './blender-sky';
import { precomputeSkyOffThread } from './sky-worker';
// ONE sampler, shared with the worker that runs it off the main thread.
import {
  collectSkyParameters,
  sampleWorldField,
  sampleWorldScreen,
  usesWindowCoordinates,
  worldField,
} from './world-field-sampler';
import { type WorldMathOperation, worldMath } from './world-math';

const scalar = z.number().finite();

export const lightSchema = z
  .object({
    type: z.enum(['POINT', 'SUN', 'SPOT', 'AREA']),
    color: z.tuple([scalar, scalar, scalar]),
    energy: scalar,
    use_shadow: z.boolean().default(true),
    radius: scalar.optional(),
    spot_size: scalar.optional(),
    spot_blend: scalar.optional(),
    shape: z.enum(['SQUARE', 'RECTANGLE', 'DISK', 'ELLIPSE']).optional(),
    size: scalar.optional(),
    size_y: scalar.optional(),
  })
  .strict();

export type LightData = z.infer<typeof lightSchema>;

let rectAreaPromise: Promise<void> | undefined;
/** `RectAreaLight` needs its BRDF lookup tables uploaded once per process, and
 *  the module that uploads them is loaded on demand — an area light is the
 *  only thing that wants it, and most models have none. */
function prepareRectArea(): Promise<void> {
  rectAreaPromise ??= import('three/examples/jsm/lights/RectAreaLightUniformsLib.js').then(
    ({ RectAreaLightUniformsLib }) => {
      RectAreaLightUniformsLib.init();
    },
  );
  return rectAreaPromise;
}

/**
 * Resolves once every light built so far can actually be drawn.
 *
 * A render is a present followed immediately by ONE photograph, so a table
 * still in flight is a black area light in the only frame anyone sees. The
 * render path awaits this before it photographs; nothing else needs to.
 */
export function lightingReady(): Promise<void> {
  return rectAreaPromise ?? Promise.resolve();
}

const areaExtent = (data: LightData): [number, number] => {
  const size = data.size ?? 0;
  const other = data.size_y ?? size;
  if (data.shape === 'RECTANGLE') return [size, other];
  if (data.shape === 'DISK') {
    const side = Math.sqrt((Math.PI * size * size) / 4);
    return [side, side];
  }
  if (data.shape === 'ELLIPSE') {
    const scale = Math.sqrt(Math.PI / 4);
    return [size * scale, other * scale];
  }
  return [size, size];
};

/** The three.js light for one Blender light datablock, or `null` when the
 *  existing light is already the right kind and was updated in place. */
export function buildLight(data: LightData, existing: THREE.Light | null): THREE.Light {
  const reuse = <T extends THREE.Light>(
    ctor: new () => T,
    is: (light: THREE.Light) => boolean,
  ): T => (existing && is(existing) ? (existing as T) : new ctor());
  if (data.type === 'SUN') {
    const light = reuse(
      THREE.DirectionalLight,
      (l) => (l as THREE.DirectionalLight).isDirectionalLight,
    );
    light.intensity = data.energy;
    light.color.setRGB(data.color[0], data.color[1], data.color[2], THREE.LinearSRGBColorSpace);
    light.castShadow = data.use_shadow;
    return light;
  }
  if (data.type === 'POINT') {
    const light = reuse(THREE.PointLight, (l) => (l as THREE.PointLight).isPointLight);
    light.intensity = data.energy / (4 * Math.PI);
    light.distance = 0;
    light.decay = 2;
    light.color.setRGB(data.color[0], data.color[1], data.color[2], THREE.LinearSRGBColorSpace);
    light.castShadow = data.use_shadow;
    return light;
  }
  if (data.type === 'SPOT') {
    const light = reuse(THREE.SpotLight, (l) => (l as THREE.SpotLight).isSpotLight);
    light.intensity = data.energy / (4 * Math.PI);
    light.distance = 0;
    light.decay = 2;
    // Blender states the FULL cone angle; three.js states the half angle.
    light.angle = (data.spot_size ?? 0) / 2;
    light.penumbra = data.spot_blend ?? 0;
    light.color.setRGB(data.color[0], data.color[1], data.color[2], THREE.LinearSRGBColorSpace);
    light.castShadow = data.use_shadow;
    return light;
  }
  void prepareRectArea();
  const light = reuse(THREE.RectAreaLight, (l) => (l as THREE.RectAreaLight).isRectAreaLight);
  const [width, height] = areaExtent(data);
  light.width = width;
  light.height = height;
  light.intensity = data.energy / (Math.max(width * height, Number.MIN_VALUE) * Math.PI);
  light.color.setRGB(data.color[0], data.color[1], data.color[2], THREE.LinearSRGBColorSpace);
  // A RectAreaLight casts no shadow in three.js; `use_shadow` has nowhere to go.
  return light;
}

/**
 * Point a light's shadow camera at the model.
 *
 * Every default here would be wrong: a directional light's shadow camera is an
 * orthographic box two units wide, and a point light's frustum ends at 500. So
 * the model's bounding sphere IS the frustum — the box is the sphere's radius
 * on each side, and the depth range is the light's own distance to the centre
 * plus or minus that radius. Nothing is tuned; it is the geometry.
 */
export function fitShadow(light: THREE.Light, centre: THREE.Vector3, radius: number): void {
  if (!light.castShadow || radius <= 0) return;
  const position = light.getWorldPosition(new THREE.Vector3());
  const distance = position.distanceTo(centre);
  const shadow = (light as THREE.Light & { shadow?: THREE.LightShadow }).shadow;
  if (!shadow) return;
  const camera = shadow.camera as THREE.OrthographicCamera & THREE.PerspectiveCamera;
  camera.near = Math.max(radius * 1e-3, distance - radius);
  camera.far = distance + radius;
  if ((light as THREE.DirectionalLight).isDirectionalLight) {
    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
  }
  camera.updateProjectionMatrix();
}

/** A Blender light aims down its own -Z; a three.js directional/spot/area
 *  light aims at a target object. The target rides one unit down that axis. */
export function aimLight(light: THREE.Light, node: THREE.Object3D): void {
  // The parent owns the authored transform; directional/spot defaults are offset.
  light.position.set(0, 0, 0);
  const aimed = light as THREE.Light & { target?: THREE.Object3D };
  if ((light as THREE.RectAreaLight).isRectAreaLight) {
    // A RectAreaLight has no target: it emits along its own -Z already.
    return;
  }
  if (!aimed.target) return;
  if (aimed.target.parent !== node) {
    aimed.target.position.set(0, 0, -1);
    node.add(aimed.target);
  }
}

/**
 * BLENDER'S FOUR SOLID-MODE STUDIO LIGHTS, read back from the box's own
 * Blender 5.2.0 LTS with `-b --factory-startup`
 * (`preferences.system.solid_lights`, `studio_light 'Default'`,
 * `light_ambient (0, 0, 0)`).
 *
 * `direction` is in VIEW space and points TOWARD the light — Blender's view
 * space is x right, y up, z toward the viewer, the same handedness as a
 * three.js camera's own space, so each vector transfers as-is into a light
 * parented to the camera. `smooth` is the wrap factor; see
 * {@link ViewportLighting} for how it becomes three's lambert.
 *
 * `specular_color` is deliberately NOT carried: three's own BRDF produces the
 * material's highlight from the same light colour, and a second colour for it
 * would be a second specular model beside the one already shading the model.
 */
const SOLID_LIGHTS: readonly {
  readonly direction: readonly [number, number, number];
  readonly diffuse: readonly [number, number, number];
  readonly smooth: number;
}[] = [
  {
    direction: [-0.352546, 0.170931, -0.920051],
    diffuse: [0.033103, 0.033103, 0.033103],
    smooth: 0.52662,
  },
  {
    direction: [-0.408163, 0.346939, 0.844415],
    diffuse: [0.521083, 0.538226, 0.538226],
    smooth: 0.0,
  },
  {
    direction: [0.521739, 0.826087, 0.212999],
    diffuse: [0.038403, 0.034357, 0.04953],
    smooth: 0.478261,
  },
  {
    direction: [0.624519, -0.562067, -0.542269],
    diffuse: [0.090838, 0.08208, 0.072255],
    smooth: 0.2,
  },
];

/**
 * THE ONE CALIBRATED NUMBER in the studio, and it is one gain over all four
 * lights — their RELATIVE strengths, directions and wraps are Blender's own
 * and nothing here tunes them apart.
 *
 * It absorbs two things this side cannot state exactly. First, the workbench's
 * own normalization: Blender's shader is `Σ diffuseᵢ · wrap(N·Lᵢ)` times the
 * viewport colour PLUS a specular term over `brdf_approx`, and the measured
 * frame comes out at ~0.88 of the diffuse sum alone. Second, the stage's tone
 * curve: the editor renders through ACES (`StageHost`), Blender's viewport
 * through AgX, and near middle grey the two differ by a near-constant factor
 * (checked both ways: with one gain ACES lands the three faces within 4 levels
 * and AgX within 3, so the curve is NOT what row 1's 13-vs-30 spread was made
 * of and the stage keeps its own operator).
 *
 * THE ROUNDS, on a `model-editor create` scaffold driven through `vgai
 * screenshot editor`, 30x30 means (std 0 — every patch inside one flat face)
 * of the factory cube's three visible faces against Blender 5.2's own frame,
 * (141,143,145) top / (129,131,131) left / (111,112,113) front:
 *
 *   0.74, ACES -> (148,150,151) (138,140,140) (108,110,110)  worst 9
 *   0.70, ACES -> (144,146,147) (134,136,136) (105,106,106)  worst 7, spread 39
 *   0.69, AgX  -> (138,139,139) (131,132,133) (112,113,113)  worst 6, spread 26
 *
 * Blender's own spread is 30. The ACES rounds are what says the tone curve
 * was carrying the rest of row 1's defect: at ANY gain the operator holds the
 * shading range 30% wider than Blender's, which is why the document names its
 * own (`ToolViewportDressing.toneMapping`).
 *
 * WHAT IS LEFT, measured rather than guessed: the top face reads 3 to 6
 * levels dark and slightly warm. Blender's workbench couples its specular to
 * its diffuse — the same cube with `show_specular_highlight` off renders
 * BRIGHTER, (146,148,149)/(136,138,138)/(114,115,116) against
 * (142,144,145)/(130,132,132)/(112,113,113) with it on — and three's BRDF has
 * no such coupling, nor a second colour per light to carry
 * `specular_color`. Closing that is a shader of our own, not a light rig.
 */
const SOLID_STUDIO_GAIN = 0.69;

/**
 * SOLID SHADING IS BLENDER'S: four VIEW-LOCKED studio lights, no world light.
 *
 * Blender's Solid mode does not light a model with the world — there is no
 * IBL and no ambient in it at all. It lights it with the four lights above,
 * stated in VIEW space, so they turn with the camera and a model keeps the
 * same read however it is orbited. The stage does the turning: this group is
 * handed over as the Model document's `dressing.viewLocked` and the stage
 * hangs it off the camera it draws with (`StageHost.tsx`); nothing here knows
 * which camera that is, and nothing here is in the model's own frame.
 *
 * THE SHADING MODEL, and exactly where it is and is not Blender's. Workbench
 * accumulates `Σ diffuseᵢ · wrap(N·Lᵢ, smoothᵢ)` times the material's viewport
 * colour, with
 *
 *     wrap(NL, w) = max((NL + w) / (1 + w)², 0)
 *
 * (`workbench_world_light_lib.glsl`). three has no wrapped lambert, but the
 * wrap SPLITS exactly into a lambert term and a CONSTANT:
 *
 *     (NL + w) / (1 + w)²  =  NL / (1 + w)²  +  w / (1 + w)²
 *
 * so each light is a `DirectionalLight` at `π·G/(1+w)²` and the constant half
 * of all four is one `AmbientLight` at `π·G·Σ wᵢ/(1+wᵢ)²`. That ambient is
 * the STUDIO LIGHTS' OWN wrap, not a world ambient: Blender's `light_ambient`
 * is (0,0,0) and stays unread, and the term goes to zero the moment a light's
 * `smooth` does. The one place the two models disagree is the far dark side —
 * Blender's wrap reaches zero at N·L = −w while a clamped lambert plus a
 * constant holds that constant all the way round — so a fully unlit face
 * reads a few levels light. Nothing else is approximated and nothing is tuned
 * per light.
 *
 * TWO LIGHTING STATES, the same split Blender makes between its solid viewport
 * and a render. Modeling is lit by this studio; a RENDER is lit by the scene's
 * own lights, because that is what the script placed them for. `setRendered`
 * switches between them, and a render capture is the only caller that asks for
 * the second.
 */
export class ViewportLighting {
  /** The view-locked group: the stage parents THIS to the camera it draws
   *  with, and owns the teardown of that parenting. */
  readonly group = new THREE.Group();
  private readonly lights: THREE.Light[] = [];

  constructor() {
    this.group.name = 'BlenderSolidStudio';
    // What every directional light aims at: the camera's own origin, so a
    // light standing along `direction` shines back down it. It rides in the
    // same group, which is what keeps the whole studio ONE object to parent.
    const target = new THREE.Object3D();
    target.name = 'BlenderSolidStudioTarget';
    this.group.add(target);
    const fill = new THREE.Color(0, 0, 0);
    for (const [index, light] of SOLID_LIGHTS.entries()) {
      const falloff = (1 + light.smooth) ** 2;
      const direct = new THREE.DirectionalLight(0xffffff, (Math.PI * SOLID_STUDIO_GAIN) / falloff);
      direct.name = `BlenderSolidLight${index}`;
      direct.color.setRGB(
        light.diffuse[0],
        light.diffuse[1],
        light.diffuse[2],
        THREE.LinearSRGBColorSpace,
      );
      // Unit length is all that matters — a directional light has no falloff —
      // and the shared target is what makes the aim the camera's own axis.
      direct.position.set(light.direction[0], light.direction[1], light.direction[2]);
      direct.target = target;
      this.group.add(direct);
      this.lights.push(direct);
      fill.r += (light.diffuse[0] * light.smooth) / falloff;
      fill.g += (light.diffuse[1] * light.smooth) / falloff;
      fill.b += (light.diffuse[2] * light.smooth) / falloff;
    }
    const ambient = new THREE.AmbientLight(0xffffff, Math.PI * SOLID_STUDIO_GAIN);
    ambient.name = 'BlenderSolidWrapFill';
    ambient.color.copy(fill);
    this.group.add(ambient);
    this.lights.push(ambient);
  }

  /** A render is lit by the scene alone; modeling is lit by the studio alone. */
  setRendered(rendered: boolean): void {
    this.group.visible = !rendered;
  }

  dispose(): void {
    for (const light of this.lights) light.dispose();
    this.group.clear();
  }
}

type WorldVector = [number, number, number];
export type WorldExpression =
  | number
  | WorldVector
  | { kind: 'direction' }
  | { kind: 'window' }
  | {
      kind: 'gradient';
      gradient_type: GradientType;
      output: 'Fac' | 'Color';
      vector: WorldExpression;
    }
  | { kind: 'to_float'; source_type: 'RGBA' | 'VECTOR'; value: WorldExpression }
  | { kind: 'math'; operation: WorldMathOperation; clamp: boolean; inputs: WorldExpression[] }
  | {
      kind: 'mix_color';
      factor: WorldExpression;
      a: WorldExpression;
      b: WorldExpression;
      clamp_factor: boolean;
      clamp_result: boolean;
    }
  | {
      kind: 'mapping';
      vector: WorldExpression;
      location: WorldVector;
      rotation: WorldVector;
      scale: WorldVector;
    }
  | { kind: 'separate'; vector: WorldExpression; axis: number }
  | { kind: 'ramp'; factor: WorldExpression; colors: WorldVector[]; interpolate: boolean }
  | {
      kind: 'map_range';
      interpolation: 'LINEAR' | 'STEPPED' | 'SMOOTHSTEP' | 'SMOOTHERSTEP';
      clamp: boolean;
      value: WorldExpression;
      from_min: WorldExpression;
      from_max: WorldExpression;
      to_min: WorldExpression;
      to_max: WorldExpression;
      steps: WorldExpression;
    }
  | {
      kind: 'sky';
      sun_elevation: number;
      sun_rotation: number;
      altitude: number;
      air_density: number;
      aerosol_density: number;
      ozone_density: number;
    };
const worldVector = z.tuple([scalar, scalar, scalar]);
const worldExpression: z.ZodType<WorldExpression> = z.lazy(() =>
  z.union([
    scalar,
    worldVector,
    z.object({ kind: z.literal('direction') }).strict(),
    z.object({ kind: z.literal('window') }).strict(),
    z
      .object({
        kind: z.literal('gradient'),
        gradient_type: z.enum([
          'LINEAR',
          'QUADRATIC',
          'EASING',
          'DIAGONAL',
          'SPHERICAL',
          'QUADRATIC_SPHERE',
          'RADIAL',
        ]),
        output: z.enum(['Fac', 'Color']),
        vector: worldExpression,
      })
      .strict(),
    z
      .object({
        kind: z.literal('to_float'),
        source_type: z.enum(['RGBA', 'VECTOR']),
        value: worldExpression,
      })
      .strict(),
    z
      .object({
        kind: z.literal('math'),
        operation: z.enum(Object.keys(worldMath) as [WorldMathOperation, ...WorldMathOperation[]]),
        clamp: z.boolean(),
        inputs: z.array(worldExpression).min(1).max(3),
      })
      .strict(),
    z
      .object({
        kind: z.literal('mix_color'),
        factor: worldExpression,
        a: worldExpression,
        b: worldExpression,
        clamp_factor: z.boolean(),
        clamp_result: z.boolean(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('mapping'),
        vector: worldExpression,
        location: worldVector,
        rotation: worldVector,
        scale: worldVector,
      })
      .strict(),
    z
      .object({
        kind: z.literal('separate'),
        vector: worldExpression,
        axis: z.number().int().min(0).max(2),
      })
      .strict(),
    z
      .object({
        kind: z.literal('ramp'),
        factor: worldExpression,
        colors: z.array(worldVector).length(257),
        interpolate: z.boolean(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('map_range'),
        interpolation: z.enum(['LINEAR', 'STEPPED', 'SMOOTHSTEP', 'SMOOTHERSTEP']),
        clamp: z.boolean(),
        value: worldExpression,
        from_min: worldExpression,
        from_max: worldExpression,
        to_min: worldExpression,
        to_max: worldExpression,
        steps: worldExpression,
      })
      .strict(),
    z
      .object({
        kind: z.literal('sky'),
        sun_elevation: scalar,
        sun_rotation: scalar,
        altitude: scalar,
        air_density: scalar,
        aerosol_density: scalar,
        ozone_density: scalar,
      })
      .strict(),
  ]),
);
const worldRadiance = z.object({
  color: worldVector,
  strength: scalar,
  shader: worldExpression.optional(),
});
export const worldSchema = worldRadiance
  .extend({
    /** The world that LIGHTS the scene, present only when Blender's Light Path
     * `Is Camera Ray` split it from the world the camera photographs -- one
     * sky at two strengths is how a scene gets a bright backdrop and
     * restrained fill. Absent when a single Background serves both. */
    lighting: worldRadiance.strict().optional(),
  })
  .strict();

/** Compile once; the texture loop only evaluates directions in Blender's Z-up basis. */

/** Sampled world radiance, by the description that produced it.
 *
 * Sampling is 32,768 texels and, for a SKY, each texel runs the
 * multiple-scattering model -- synchronously, on the page's main thread.
 * MEASURED: a capture of a scene with a sky world cost 15.4s against 0.03s for
 * the same scene with a plain background, and three identical captures in a row
 * each paid it in full. That is why the page froze solid during a replay and
 * why the photograph was SLOWER than the Cycles path trace it is compared
 * against (15.4s vs 7.6s) -- for a screenshot.
 *
 * The DATA is cached rather than the texture, because `clear()` disposes
 * textures and a disposed texture must never be handed out again; a Uint16Array
 * survives disposal and uploading it again is free. Keyed by the description
 * itself, so any change to the sky (or to strength) rebuilds and an unchanged
 * one never does. A handful of entries covers the background/lighting pair a
 * split world needs without letting the map grow with the session. */
const WORLD_FIELD_CACHE_LIMIT = 4;
const worldFieldCache = new Map<string, Float32Array>();

/** Sky derivations still running. `worldReady()` is what a RENDER awaits, the
 *  same way it already awaits `lightingReady()` and `texturesReady()` -- a
 *  photograph gets one chance and must not catch a half-built sky. */
const pendingWorld = new Set<Promise<void>>();

export async function worldReady(): Promise<void> {
  while (pendingWorld.size > 0) await Promise.all([...pendingWorld]);
}

function worldTexture(
  expression: WorldExpression,
  strength: number,
  camera?: THREE.Camera,
): THREE.DataTexture {
  const width = 256,
    height = 128;
  // KEYED ON THE EXPRESSION ALONE. Strength is a multiplier applied per texel
  // below, so it cannot change what the field SAMPLES -- only what they are
  // scaled by. Keying on it too made a strength-only change re-derive the whole
  // sky, and made a world split by `Is Camera Ray` (one sky, two strengths)
  // build that sky TWICE where once would do.
  const windowCoordinates = usesWindowCoordinates(expression);
  if (windowCoordinates && !camera)
    throw new Error('World Window coordinates need a render camera');
  camera?.updateMatrixWorld();
  const key = JSON.stringify([
    expression,
    windowCoordinates ? [camera!.matrixWorld.elements, camera!.projectionMatrix.elements] : null,
  ]);
  const cached = worldFieldCache.get(key);
  if (cached !== undefined) return worldDataTexture(cached, strength, width, height);
  // SYNCHRONOUS, AND THAT IS THE POINT. The expensive half -- each Sky Texture's
  // 512x256 multiple-scattering precompute -- has already been derived in the
  // worker and primed into `blender-sky`'s cache by the time anything calls
  // this; see `WorldBackground.apply`. What is left here is 32,768 bilinear
  // lookups, which is milliseconds.
  //
  // It stays synchronous because the alternative is what shipped once and was
  // taken back out (#6609): the texture handed out EMPTY and filled when the
  // worker answered, with the capture racing the fill. Measured on pixels, a
  // fresh sky rendered to 716 bytes and moving the sun produced the
  // byte-identical empty image. A render gets one chance. Nothing here ever
  // hands out a texture it has not already filled; the waiting happens one level
  // up, where `pendingWorld` can hold the capture.
  const windowPoint = new THREE.Vector3();
  const projected = new THREE.Vector4();
  const projection = camera
    ? new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    : null;
  const cameraPosition = camera?.getWorldPosition(new THREE.Vector3());
  const projectWindow = windowCoordinates
    ? (direction: THREE.Vector3) => {
        // Cycles tex_coord.h: a perspective world direction is relative to the
        // camera; an orthographic non-camera ray projects its world direction.
        windowPoint.set(direction.x, direction.z, -direction.y);
        if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera)
          windowPoint.add(cameraPosition!);
        projected.set(windowPoint.x, windowPoint.y, windowPoint.z, 1).applyMatrix4(projection!);
        // Cycles transform_perspective returns zero for a zero denominator.
        if (projected.w === 0) return windowPoint.set(0, 0, 0);
        return windowPoint.set(
          (projected.x / projected.w) * 0.5 + 0.5,
          (projected.y / projected.w) * 0.5 + 0.5,
          0,
        );
      }
    : undefined;
  const samples = sampleWorldField(expression, width, height, projectWindow);
  worldFieldCache.set(key, samples);
  // Oldest out first: insertion order is the Map's own.
  if (worldFieldCache.size > WORLD_FIELD_CACHE_LIMIT) {
    worldFieldCache.delete(worldFieldCache.keys().next().value as string);
  }
  return worldDataTexture(samples, strength, width, height);
}

/** One sampled field, scaled, as a texture. The samples are UNSCALED and shared
 *  between textures; the multiply and the half-float conversion happen here, so
 *  two strengths over one sky cost one derivation and two cheap passes. */
/** Scale and convert, in one pass. The multiply happens BEFORE the half-float
 *  conversion, or a dim fill branch would quantise against a bright backdrop's
 *  range. */
function writeScaled(
  data: Uint16Array,
  samples: Float32Array,
  strength: number,
  texels: number,
): void {
  const alpha = THREE.DataUtils.toHalfFloat(1);
  for (let i = 0; i < texels; i++) {
    data[i * 4] = THREE.DataUtils.toHalfFloat(samples[i * 3]! * strength);
    data[i * 4 + 1] = THREE.DataUtils.toHalfFloat(samples[i * 3 + 1]! * strength);
    data[i * 4 + 2] = THREE.DataUtils.toHalfFloat(samples[i * 3 + 2]! * strength);
    data[i * 4 + 3] = alpha;
  }
}

function worldDataTexture(
  samples: Float32Array,
  strength: number,
  width: number,
  height: number,
): THREE.DataTexture {
  const data = new Uint16Array(width * height * 4);
  writeScaled(data, samples, strength, width * height);
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export type WorldData = z.infer<typeof worldSchema>;

/** World radiance supplies both the background and image-based lighting.
 * Constants and linked colors use the same radiometric path. The environment
 * samples the field at 256×128; features below a texel are filtered. */
export class WorldBackground {
  private pending: Promise<void> | null = null;

  /** Await this world's preparation, including a failure that settled before
   * the caller got here. Another presenter's sky is not this capture's work. */
  async ready(): Promise<void> {
    await this.pending;
  }
  private texture: THREE.DataTexture | null = null;
  /** The lighting branch's own radiance, when the world was split. */
  private environmentTexture: THREE.DataTexture | null = null;
  private screenTexture: THREE.DataTexture | null = null;
  private applied: {
    scene: THREE.Scene;
    background: THREE.Scene['background'];
    environment: THREE.Scene['environment'];
  } | null = null;

  /** The Scene the model hangs in, or null before it is mounted. */
  private static sceneOf(root: THREE.Object3D): THREE.Scene | null {
    let node: THREE.Object3D | null = root;
    while (node) {
      if ((node as THREE.Scene).isScene) return node as THREE.Scene;
      node = node.parent;
    }
    return null;
  }

  /** Bumped by every `apply`/`clear`, so a sky that arrives from the worker
   *  after the world moved on knows it is stale and composes nothing. */
  private generation = 0;

  /**
   * THE ASYNC SEAM, and the only one.
   *
   * Every Sky Texture in this world is derived in a worker BEFORE anything is
   * composed. When all of them are already in `blender-sky`'s cache the whole
   * apply runs synchronously, exactly as it did inline. When any is missing,
   * composition is DEFERRED behind the worker and the promise is registered in
   * `pendingWorld` SYNCHRONOUSLY, before this method returns -- which is what
   * makes it impossible for a caller to reach `worldReady()` in between.
   * `BlenderRuntimeView.setRendered` awaits `worldReady()` AFTER the applies for
   * this reason, and that ordering must not move.
   *
   * The failure this is shaped against (#6609) was a texture handed out empty
   * and filled later. Here nothing is handed out early at all: until the sky
   * exists, `scene.background` is simply not assigned, and the capture that
   * awaits `worldReady()` cannot run until it is.
   */
  apply(root: THREE.Object3D, world: WorldData | null, camera?: THREE.Camera): void {
    this.clear();
    this.pending = null;
    if (!world) return;
    const scene = WorldBackground.sceneOf(root);
    if (!scene) return;
    this.applied = { scene, background: scene.background, environment: scene.environment };
    const expression = world.shader ?? world.color;
    const generation = this.generation;
    const skies: SkyParameters[] = [
      ...collectSkyParameters(expression),
      ...(world.lighting
        ? collectSkyParameters(world.lighting.shader ?? world.lighting.color)
        : []),
    ];
    const missing = skies.filter((parameters) => !hasSkyTexture(parameters));
    if (missing.length === 0) {
      this.compose(scene, world, expression, camera);
      return;
    }
    const pending = (async () => {
      const derived = await Promise.all(missing.map(precomputeSkyOffThread));
      missing.forEach((parameters, index) => {
        primeSkyTexture(parameters, derived[index]!);
      });
      // The world moved on (another apply, or a clear) while the worker ran:
      // composing now would paint a sky nobody asked for over the current one.
      if (this.generation !== generation || this.applied?.scene !== scene) return;
      this.compose(scene, world, expression, camera);
    })();
    this.pending = pending;
    pendingWorld.add(pending);
    // Both arms, or a rejection here is an unhandled one; `worldReady()` still
    // awaits `pending` itself, so the failure reaches the capture LOUDLY rather
    // than leaving it to photograph a scene with no sky.
    void pending.then(
      () => pendingWorld.delete(pending),
      () => pendingWorld.delete(pending),
    );
  }

  private compose(
    scene: THREE.Scene,
    world: WorldData,
    expression: WorldExpression,
    camera?: THREE.Camera,
  ): void {
    this.texture = worldTexture(expression, world.strength, camera);
    if (usesWindowCoordinates(expression)) {
      if (!camera) throw new Error('World Window coordinates need a render camera');
      this.screenTexture = worldDataTexture(
        sampleWorldScreen(expression, 512, 512, camera),
        world.strength,
        512,
        512,
      );
      this.screenTexture.mapping = THREE.UVMapping;
      scene.background = this.screenTexture;
    } else if (camera && (camera as THREE.OrthographicCamera).isOrthographicCamera) {
      // Orthographic rays are parallel: every background pixel samples the
      // same world direction. Three's unit skybox cannot fill this projection.
      const direction = camera.getWorldDirection(new THREE.Vector3());
      direction.set(direction.x, -direction.z, direction.y);
      const value = worldField(world.shader ?? world.color)(direction);
      scene.background =
        typeof value === 'number'
          ? new THREE.Color().setRGB(value, value, value).multiplyScalar(world.strength)
          : new THREE.Color().setRGB(value.x, value.y, value.z).multiplyScalar(world.strength);
    } else {
      scene.background = this.texture;
    }
    // Replace the document environment so the model is not lit twice. When
    // `Is Camera Ray` split the world, what LIGHTS the scene is a different
    // radiance from what the camera photographs -- `19-tram-stop` lights at
    // 0.30 behind a 0.95 backdrop -- and three keeps the two apart, so using
    // the backdrop here would light that scene three times too brightly.
    const { lighting } = world;
    this.environmentTexture = lighting
      ? worldTexture(lighting.shader ?? lighting.color, lighting.strength, camera)
      : null;
    scene.environment = this.environmentTexture ?? this.texture;
  }

  clear(): void {
    this.generation++;
    if (!this.applied) return;
    this.applied.scene.background = this.applied.background;
    this.applied.scene.environment = this.applied.environment;
    this.applied = null;
    this.texture?.dispose();
    this.texture = null;
    this.environmentTexture?.dispose();
    this.environmentTexture = null;
    this.screenTexture?.dispose();
    this.screenTexture = null;
  }

  dispose(): void {
    this.clear();
  }
}
