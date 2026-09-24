/**
 * The live probes of one renderer + scene, and the one capture schedule they
 * share.
 *
 * Capture is NATIVE end to end: a `CubeCamera` renders the live scene into a
 * cube target and `PMREMGenerator` prefilters it, so what a probe PUBLISHES is
 * an ordinary Three texture the author assigns as `envMap`. Nothing here
 * touches a material, and nothing here walks the scene looking for one —
 * probes register THEMSELVES (`<ReflectionProbe>` does it in a layout effect).
 *
 * At most one probe captures per frame: a cube capture is six scene renders,
 * and letting several land in one frame is what turns a room full of probes
 * into a stall. `canCaptureEnvironment` is asked before any GPU object is
 * created, so the editor's inert design-time tree and headless runtimes mount
 * the authored scene and allocate nothing.
 *
 * A probe's own subtree is hidden for the duration of its capture (drei's
 * `CubeCamera` does the same), so a surface already showing this probe's last
 * result cannot photograph itself. Observers exist so a probe can publish its
 * texture and so the volume material — the only thing here that owns a shader —
 * can zero its own probe uniforms inside that same window.
 */
import type { ReflectionProbeMark } from '@volter/threejs-runtime/adapter/reflection-probe';
import {
  canCaptureEnvironment,
  withCaptureMask,
  withCaptureShadows,
} from '@volter/threejs-runtime/render/environment-capture';
import {
  CubeCamera,
  HalfFloatType,
  LinearMipmapLinearFilter,
  Matrix4,
  type Object3D,
  PMREMGenerator,
  Quaternion,
  type Scene,
  type Texture,
  Vector3,
  WebGLCubeRenderTarget,
  type WebGLRenderer,
} from 'three';
import type { MutableReflectionProbeMark } from './probe-controller';

type FilteredTarget = ReturnType<PMREMGenerator['fromCubemap']>;

/** One probe as its readers see it: a result texture plus the volume it describes. */
export interface ReflectionProbeRuntime {
  readonly node: Object3D;
  readonly mark: ReflectionProbeMark;
  /** The captured cube's edge, snapped to a power of two — the PMREM atlas is `4 * cubeSize` tall. */
  readonly cubeSize: number;
  readonly worldToLocal: Matrix4;
  readonly extents: Vector3;
  readonly parallaxExtents: Vector3;
  readonly parallaxOffset: Vector3;
  readonly captureOffset: Vector3;
  /** The prefiltered result, assignable as a native `envMap`; null before the first capture. */
  readonly texture: Texture | null;
  readonly ready: boolean;
}

interface ProbeState extends ReflectionProbeRuntime {
  cubeSize: number;
  /** Allocated on the first capture, never at mount: a renderer may not be able to capture at all. */
  target: WebGLCubeRenderTarget | null;
  camera: CubeCamera | null;
  filtered: FilteredTarget | null;
  readonly atlases: Map<number, FilteredTarget>;
  texture: Texture | null;
  ready: boolean;
  capturedRevision: number;
  readonly capturedTransform: Matrix4;
}

/** Called every update, and again the moment a capture window opens/closes. */
export type ReflectionProbeObserver = (
  probes: readonly ReflectionProbeRuntime[],
  capturing: boolean,
) => void;

export interface ReflectionProbeRegistry {
  /** Publish a probe. The returned function unregisters it and frees its GPU targets. */
  registerProbe(node: Object3D, mark: ReflectionProbeMark): () => void;
  observe(observer: ReflectionProbeObserver): () => void;
  update(frameToken: number): void;
}

function cubeSizeOf(mark: ReflectionProbeMark): number {
  const requested = Math.round(mark.config.resolution);
  return 2 ** Math.round(Math.log2(Math.max(16, Math.min(1024, requested))));
}

function mutable(mark: ReflectionProbeMark): MutableReflectionProbeMark {
  return mark as MutableReflectionProbeMark;
}

function makeTarget(cubeSize: number, renderer: WebGLRenderer): WebGLCubeRenderTarget {
  const target = new WebGLCubeRenderTarget(cubeSize, {
    type: HalfFloatType,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    depthBuffer: true,
  });
  // HMR can unmount a probe between the capture that allocated this target and
  // that capture finishing. Three only creates the six framebuffer slots
  // lazily; disposing a cube target whose texture listener exists but whose
  // slots do not is not a safe state in every supported Three revision.
  // Initialize the native target here so teardown is deterministic whether or
  // not the capture that wanted it completes.
  renderer.initRenderTarget(target);
  return target;
}

function makeCamera(mark: ReflectionProbeMark, target: WebGLCubeRenderTarget): CubeCamera {
  return new CubeCamera(Math.max(0.001, mark.config.near), Math.max(0.01, mark.config.far), target);
}

function makeProbe(node: Object3D, mark: ReflectionProbeMark): ProbeState {
  return {
    node,
    mark,
    cubeSize: cubeSizeOf(mark),
    target: null,
    camera: null,
    worldToLocal: new Matrix4(),
    extents: new Vector3(),
    parallaxExtents: new Vector3(),
    parallaxOffset: new Vector3(),
    captureOffset: new Vector3(),
    capturedTransform: new Matrix4().makeScale(0, 0, 0),
    filtered: null,
    atlases: new Map(),
    texture: null,
    ready: false,
    capturedRevision: mark.config.captureMode === 'manual' ? mark.revision : -1,
  };
}

/**
 * R3F can dispose its renderer before child layout-effect cleanup runs. Three
 * leaves each resource's dispose listener installed while clearing the
 * renderer's WebGLProperties map, so dispatching dispose afterward asks that
 * stale listener to deallocate framebuffer slots that no longer exist. Three
 * exposes no renderer-disposed signal (and compatible renderers need not
 * expose WebGLProperties), so only that exact native deallocation failure is
 * absorbed; every other cleanup failure remains loud.
 */
function disposeRendererResource(resource: { dispose(): void }): void {
  try {
    resource.dispose();
  } catch (error) {
    const stack = error instanceof Error ? error.stack : undefined;
    if (
      error instanceof TypeError &&
      error.message.includes('Cannot read properties of undefined') &&
      stack?.includes('deallocateRenderTarget')
    ) {
      return;
    }
    throw error;
  }
}

/** Free everything this probe holds on the GPU, and forget its result. */
function releaseProbeResources(probe: ProbeState): void {
  for (const atlas of probe.atlases.values()) disposeRendererResource(atlas);
  probe.atlases.clear();
  if (probe.target) disposeRendererResource(probe.target);
  probe.filtered = null;
  probe.target = null;
  probe.camera = null;
  probe.texture = null;
  probe.ready = false;
}

function refreshProbe(probe: ProbeState): boolean {
  const config = probe.mark.config;
  const cubeSize = cubeSizeOf(probe.mark);
  if (cubeSize !== probe.cubeSize) {
    // Published textures may still be bound by React or an imperative author.
    // Keep each resolution's atlas alive until this probe unmounts, and reuse
    // it on recapture. There are only seven supported power-of-two sizes.
    if (probe.target) disposeRendererResource(probe.target);
    probe.target = null;
    probe.camera = null;
    probe.filtered = probe.atlases.get(cubeSize) ?? null;
    probe.cubeSize = cubeSize;
    probe.capturedRevision = -1;
  }
  probe.node.updateWorldMatrix(true, false);
  probe.worldToLocal.copy(probe.node.matrixWorld).invert();
  probe.extents.fromArray(config.size).multiplyScalar(0.5);
  probe.parallaxExtents.fromArray(config.parallaxSize).multiplyScalar(0.5);
  probe.parallaxOffset.fromArray(config.parallaxOffset);
  probe.captureOffset.fromArray(config.captureOffset);
  const moved = !probe.capturedTransform.equals(probe.node.matrixWorld);
  if (moved && config.captureMode === 'on-change') probe.ready = false;
  return moved;
}

/** The cube target and camera, created here because only a capture needs them. */
function ensureCaptureResources(probe: ProbeState, renderer: WebGLRenderer): CubeCamera {
  if (!probe.target) probe.target = makeTarget(probe.cubeSize, renderer);
  if (!probe.camera) probe.camera = makeCamera(probe.mark, probe.target);
  return probe.camera;
}

function configureCamera(probe: ProbeState, camera: CubeCamera, renderer: WebGLRenderer): void {
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  probe.node.matrixWorld.decompose(position, rotation, scale);
  camera.position.copy(probe.captureOffset).applyMatrix4(probe.node.matrixWorld);
  camera.quaternion.copy(rotation);
  const near = Math.max(0.001, probe.mark.config.near);
  const far = Math.max(near + 0.001, probe.mark.config.far);
  for (const child of camera.children) {
    const face = child as typeof child & {
      near: number;
      far: number;
      updateProjectionMatrix(): void;
    };
    face.near = near;
    face.far = far;
    face.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
  if (camera.coordinateSystem !== renderer.coordinateSystem) {
    camera.coordinateSystem = renderer.coordinateSystem;
    camera.updateCoordinateSystem();
  }
}

export function createReflectionProbeRegistry(
  renderer: WebGLRenderer,
  scene: Scene,
): ReflectionProbeRegistry & { dispose(): void } {
  const probes: ProbeState[] = [];
  const observers = new Set<ReflectionProbeObserver>();
  // Three's supplied-target path reuses its internal blur resources without
  // resizing them. Each resolution therefore owns its native generator.
  const generators = new Map<number, PMREMGenerator>();
  let cursor = 0;
  let lastFrame = Number.NaN;
  let disposed = false;

  const notify = (capturing: boolean) => {
    for (const observer of observers) observer(probes, capturing);
  };

  const capture = (probe: ProbeState) => {
    mutable(probe.mark).setCaptureStatus({
      status: 'capturing',
      lastCapturedAt: probe.mark.getSnapshot().lastCapturedAt,
    });
    const visible = probe.node.visible;
    const renderTarget = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    const xrEnabled = renderer.xr.enabled;
    try {
      const camera = ensureCaptureResources(probe, renderer);
      configureCamera(probe, camera, renderer);
      notify(true);
      // What this probe already lights must not be photographed by it.
      probe.node.visible = false;
      withCaptureShadows(scene, probe.mark.config.captureShadows, () => {
        withCaptureMask(scene, probe.mark.config.cullMask, () => camera.update(renderer, scene));
      });
      let pmrem = generators.get(probe.cubeSize);
      if (!pmrem) {
        pmrem = new PMREMGenerator(renderer);
        generators.set(probe.cubeSize, pmrem);
      }
      const filtered = pmrem.fromCubemap(camera.renderTarget.texture, probe.filtered);
      probe.atlases.set(probe.cubeSize, filtered);
      probe.filtered = filtered;
      probe.texture = filtered.texture;
      probe.ready = true;
      probe.capturedRevision = probe.mark.revision;
      probe.capturedTransform.copy(probe.node.matrixWorld);
      mutable(probe.mark).setCaptureStatus({ status: 'ready', lastCapturedAt: performance.now() });
    } catch (error) {
      probe.ready = false;
      mutable(probe.mark).setCaptureStatus({
        status: 'error',
        lastCapturedAt: probe.mark.getSnapshot().lastCapturedAt,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      probe.node.visible = visible;
      if (probe.target) probe.target.texture.generateMipmaps = true;
      renderer.setRenderTarget(renderTarget, cubeFace, mipLevel);
      renderer.xr.enabled = xrEnabled;
    }
  };

  const nextCapture = (): ProbeState | null => {
    for (let offset = 0; offset < probes.length; offset += 1) {
      const index = (cursor + offset) % probes.length;
      const probe = probes[index]!;
      const moved = refreshProbe(probe);
      const mode = probe.mark.config.captureMode;
      const due =
        mode === 'realtime' ||
        probe.capturedRevision !== probe.mark.revision ||
        (mode === 'on-change' && moved);
      if (!due) continue;
      cursor = (index + 1) % probes.length;
      return probe;
    }
    return null;
  };

  return {
    registerProbe(node, mark) {
      const probe = makeProbe(node, mark);
      probes.push(probe);
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        const index = probes.indexOf(probe);
        if (index >= 0) probes.splice(index, 1);
        cursor = probes.length === 0 ? 0 : cursor % probes.length;
        releaseProbeResources(probe);
        notify(false);
      };
    },
    observe(observer) {
      observers.add(observer);
      observer(probes, false);
      return () => observers.delete(observer);
    },
    update(frameToken) {
      if (disposed || frameToken === lastFrame || !canCaptureEnvironment(renderer)) return;
      lastFrame = frameToken;
      for (const probe of probes) refreshProbe(probe);
      const due = nextCapture();
      if (due) capture(due);
      notify(false);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observers.clear();
      for (const probe of probes) releaseProbeResources(probe);
      probes.length = 0;
      for (const pmrem of generators.values()) pmrem.dispose();
      generators.clear();
    },
  };
}

interface SharedRegistry {
  readonly registry: ReflectionProbeRegistry & { dispose(): void };
  references: number;
}

const byRenderer = new WeakMap<WebGLRenderer, WeakMap<Scene, SharedRegistry>>();

export interface ReflectionProbeRegistryLease {
  readonly registry: ReflectionProbeRegistry;
  release(): void;
}

/** One registry per native renderer + scene pair, shared by every probe in it. */
export function acquireReflectionProbeRegistry(
  renderer: WebGLRenderer,
  scene: Scene,
): ReflectionProbeRegistryLease {
  let scenes = byRenderer.get(renderer);
  if (!scenes) {
    scenes = new WeakMap();
    byRenderer.set(renderer, scenes);
  }
  const sceneRegistries = scenes;
  const shared =
    sceneRegistries.get(scene) ??
    (() => {
      const created: SharedRegistry = {
        registry: createReflectionProbeRegistry(renderer, scene),
        references: 0,
      };
      sceneRegistries.set(scene, created);
      return created;
    })();
  shared.references += 1;
  let released = false;
  return {
    registry: shared.registry,
    release() {
      if (released) return;
      released = true;
      shared.references -= 1;
      if (shared.references > 0) return;
      shared.registry.dispose();
      sceneRegistries.delete(scene);
    },
  };
}
