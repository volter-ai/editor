/**
 * Shared assembly for the inert runtime contexts used by translated prefab stories.
 *
 * Resource lists and autoload classes remain in generated project source. This capability owns
 * only the cross-project mechanics: native loading, inert input/random, and optional physics/audio
 * stores. A story never steps these worlds; mounting the prefab is enough to photograph it.
 */
import RAPIER2D from '@dimforge/rapier2d-compat';
import RAPIER3D from '@dimforge/rapier3d-compat';
import { Assets, Container, type Texture } from 'pixi.js';
import { Group, Scene, type Texture as ThreeTexture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createGodotAudioGraph, type GodotAudioGraph } from '../godot-compat/audio-graph';
import { createCollisionExceptions } from '../godot-compat/collision-exceptions';
import { createCollisionLayers, godotContactFilter } from '../godot-compat/collision-layers';
import type { GodotModel } from '../godot-compat/gltf-model';
import { createInertInput, type GodotInput } from '../godot-compat/input';
import type { GodotProjectSettingSeed } from '../godot-compat/project-settings';
import { createRandom, type GodotRandom } from '../godot-compat/random';
import { createSceneTree, type SceneTree } from '../godot-compat/scene-tree';
import {
  createGodotCrossSurfaceAnimationBindings,
  createGodotCrossSurfaceNodeBindings,
  type GodotCrossSurfaceAnimationBindings,
  type GodotCrossSurfaceNodeBindings,
} from './scene-lifecycle';

/**
 * Capabilities shared by every translated scene context, including isolated story previews.
 *
 * A preview may mount either projection of a mixed authored scene, so it owns one local pair of
 * the same compat registries as a running translated world. They remain inert until a projected
 * scene binds a real native node/property; no mirror or placeholder node is created here.
 */
interface PreviewSharedSceneCapabilities {
  readonly crossSurfaceAnimation: GodotCrossSurfaceAnimationBindings;
  readonly crossSurfaceNodes: GodotCrossSurfaceNodeBindings;
}

function previewSharedSceneCapabilities(): PreviewSharedSceneCapabilities {
  return {
    crossSurfaceAnimation: createGodotCrossSurfaceAnimationBindings(),
    crossSurfaceNodes: createGodotCrossSurfaceNodeBindings(),
  };
}

interface ThreePreviewOptions {
  readonly projectSettings: GodotProjectSettingSeed;
  readonly resolution: { readonly width: number; readonly height: number };
  readonly modelResPaths: readonly string[];
  readonly hasModels: boolean;
  readonly stepsPhysics: boolean;
  readonly usesCollisionExceptions: boolean;
  readonly hasAudio: boolean;
  readonly hasRuntimeStreams: boolean;
  readonly usesSceneEnvironment: boolean;
  readonly hasInstantiateTextures: boolean;
}

type When<Condition extends boolean, Value> = Condition extends true ? Value : object;

export type ThreePreviewRuntime<Options extends ThreePreviewOptions> = {
  readonly tree: SceneTree<Group>;
  readonly input: GodotInput;
  readonly random: GodotRandom;
  readonly resolution: Options['resolution'];
} & PreviewSharedSceneCapabilities &
  When<Options['hasModels'], { readonly models: ReadonlyMap<string, GodotModel> }> &
  When<Options['usesSceneEnvironment'], { readonly scene: Scene }> &
  When<
    Options['hasInstantiateTextures'],
    { readonly textures: ReadonlyMap<string, ThreeTexture> }
  > &
  When<
    Options['stepsPhysics'],
    {
      readonly world: RAPIER3D.World;
      readonly colliders: Map<RAPIER3D.Collider, object>;
      readonly areaColliders: Map<
        RAPIER3D.Collider,
        { readonly area?: object; readonly node?: object }
      >;
      readonly layers: ReturnType<typeof createCollisionLayers>;
      readonly physicsHooks: RAPIER3D.PhysicsHooks;
      readonly physicsEventQueue: RAPIER3D.EventQueue;
    }
  > &
  When<
    Options['usesCollisionExceptions'],
    { readonly exceptions: ReturnType<typeof createCollisionExceptions> }
  > &
  When<
    Options['hasAudio'],
    {
      readonly audio: {
        readonly graph: GodotAudioGraph;
        readonly context: AudioContext;
        readonly destination: AudioNode;
        readonly reverbBuses: ReadonlyMap<string, never>;
        readonly reverbRegions: never[];
      };
    }
  > &
  When<Options['hasRuntimeStreams'], { readonly streams: ReadonlyMap<string, AudioBuffer> }>;

export async function buildGodotThreePreviewRuntime<const Options extends ThreePreviewOptions>(
  options: Options,
): Promise<ThreePreviewRuntime<Options>> {
  const runtime: Record<string, unknown> = {
    tree: createSceneTree({ root: new Group(), projectSettings: options.projectSettings }),
    input: createInertInput(),
    random: createRandom({ random: () => 0 }),
    resolution: options.resolution,
    ...previewSharedSceneCapabilities(),
  };
  if (options.hasModels) {
    const models = new Map<string, GodotModel>();
    const loader = new GLTFLoader();
    await Promise.all(
      options.modelResPaths.map(async (resPath) => {
        const url = resPath.replace('res://', '/');
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(
            `prefab preview could not load ${resPath} (${url} -> ${response.status}). ` +
              "Copy the Godot project's res:// file to public/ at the same relative path.",
          );
        }
        const gltf = await loader.parseAsync(
          await response.arrayBuffer(),
          url.slice(0, url.lastIndexOf('/') + 1),
        );
        models.set(resPath, { scene: gltf.scene, animations: gltf.animations });
      }),
    );
    runtime['models'] = models;
  }
  if (options.stepsPhysics) {
    await RAPIER3D.init();
    runtime['world'] = new RAPIER3D.World({ x: 0, y: -9.8, z: 0 });
    runtime['colliders'] = new Map<RAPIER3D.Collider, object>();
    runtime['areaColliders'] = new Map<
      RAPIER3D.Collider,
      { readonly area?: object; readonly node?: object }
    >();
    runtime['layers'] = createCollisionLayers();
    runtime['physicsHooks'] = {
      filterContactPair: () => RAPIER3D.SolverFlags.COMPUTE_IMPULSE,
      filterIntersectionPair: () => true,
    } satisfies RAPIER3D.PhysicsHooks;
    runtime['physicsEventQueue'] = new RAPIER3D.EventQueue(true);
  }
  if (options.usesCollisionExceptions) runtime['exceptions'] = createCollisionExceptions();
  if (options.hasAudio) {
    const graph = createGodotAudioGraph().open();
    const { context, destination } = graph;
    runtime['audio'] = {
      graph,
      context,
      destination,
      reverbBuses: new Map(),
      reverbRegions: [],
    };
  }
  if (options.hasRuntimeStreams) runtime['streams'] = new Map<string, AudioBuffer>();
  if (options.usesSceneEnvironment) runtime['scene'] = new Scene();
  if (options.hasInstantiateTextures) runtime['textures'] = new Map<string, ThreeTexture>();
  return runtime as ThreePreviewRuntime<Options>;
}

interface CanvasPreviewOptions {
  readonly projectSettings: GodotProjectSettingSeed;
  readonly resolution: { readonly width: number; readonly height: number };
  readonly gravity: { readonly x: number; readonly y: number };
  readonly stepsPhysics: boolean;
  readonly textures: readonly string[];
  readonly fonts: readonly string[];
  readonly audio: readonly string[];
  readonly runtimeStreams: readonly string[];
}

type PreviewAudioStreams = ReadonlyMap<
  string,
  { readonly buffer: AudioBuffer; readonly destination: AudioNode }
> & { readonly destination: AudioNode; readonly graph: GodotAudioGraph };

export type CanvasPreviewRuntime<Options extends CanvasPreviewOptions> = {
  readonly tree: SceneTree<Container>;
  readonly input: GodotInput;
  readonly random: GodotRandom;
  readonly textures: ReadonlyMap<string, Texture>;
  readonly fonts: ReadonlyMap<string, string>;
  readonly audio: PreviewAudioStreams;
  readonly resolution: Options['resolution'];
} & PreviewSharedSceneCapabilities &
  When<
    Options['stepsPhysics'],
    {
      readonly world: RAPIER2D.World;
      readonly colliders: Map<RAPIER2D.Collider, never>;
      readonly areaColliders: Map<
        RAPIER2D.Collider,
        { readonly scene: never; readonly node: Container }
      >;
      readonly layers: ReturnType<typeof createCollisionLayers>;
      readonly physicsHooks: RAPIER2D.PhysicsHooks;
      readonly physicsEventQueue: RAPIER2D.EventQueue;
    }
  > &
  When<
    Options['runtimeStreams'] extends readonly [] ? false : true,
    { readonly streams: ReadonlyMap<string, AudioBuffer> }
  >;

function resourceUrl(path: string): string {
  if (!path.startsWith('res://')) {
    throw new Error(`translated resource "${path}" is not a res:// path`);
  }
  return `/${path.slice('res://'.length)}`;
}

export async function buildGodotCanvasPreviewRuntime<const Options extends CanvasPreviewOptions>(
  options: Options,
): Promise<CanvasPreviewRuntime<Options>> {
  await Assets.load(options.textures.map(resourceUrl));
  const textures = new Map<string, Texture>(
    options.textures.map((path) => [path, Assets.get(resourceUrl(path)) as Texture]),
  );
  const fontEntries = await Promise.all(
    options.fonts.map(async (path, index) => {
      const family = `GodotPreviewFont${index}`;
      const face = new FontFace(family, `url(${resourceUrl(path)})`);
      await face.load();
      document.fonts.add(face);
      return [path, family] as const;
    }),
  );
  const graph = createGodotAudioGraph().open();
  const { context: audioContext, destination } = graph;
  const audioEntries = await Promise.all(
    options.audio.map(async (path) => {
      const response = await fetch(resourceUrl(path));
      if (!response.ok) throw new Error(`preview audio ${path} returned ${response.status}`);
      return [
        path,
        { buffer: await audioContext.decodeAudioData(await response.arrayBuffer()), destination },
      ] as const;
    }),
  );
  const audioStreams = Object.assign(new Map(audioEntries), { destination, graph });
  const runtime: Record<string, unknown> = {
    tree: createSceneTree({ root: new Container(), projectSettings: options.projectSettings }),
    input: createInertInput(),
    random: createRandom({ random: () => 0 }),
    ...previewSharedSceneCapabilities(),
    textures,
    fonts: new Map(fontEntries),
    audio: audioStreams,
    resolution: options.resolution,
  };
  if (options.runtimeStreams.length > 0) {
    runtime['streams'] = new Map(
      options.runtimeStreams.map((path) => {
        const stream = audioStreams.get(path);
        if (stream === undefined) throw new Error(`preview did not decode ${path}`);
        return [path, stream.buffer] as const;
      }),
    );
  }
  if (options.stepsPhysics) {
    await RAPIER2D.init();
    const world = new RAPIER2D.World(options.gravity);
    const layers = createCollisionLayers();
    const collidesWith = godotContactFilter({ world, layers });
    runtime['world'] = world;
    runtime['colliders'] = new Map<RAPIER2D.Collider, never>();
    runtime['areaColliders'] = new Map<
      RAPIER2D.Collider,
      { readonly scene: never; readonly node: Container }
    >();
    runtime['layers'] = layers;
    runtime['physicsHooks'] = {
      filterContactPair: (collider1, collider2, body1, body2) =>
        collidesWith(collider1, collider2, body1, body2)
          ? RAPIER2D.SolverFlags.COMPUTE_IMPULSE
          : null,
      filterIntersectionPair: () => true,
    } satisfies RAPIER2D.PhysicsHooks;
    runtime['physicsEventQueue'] = new RAPIER2D.EventQueue(true);
  }
  return runtime as CanvasPreviewRuntime<Options>;
}
