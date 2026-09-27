/**
 * First-party {@link RenderDebugAdapter} wiring (W4b, F11) — the glue between
 * the WebGL2 frame capture (`webgl-frame-capture.ts`), a live three.js scene,
 * and the render adapter's per-frame render pass.
 *
 * Split OUT of `editor-game/src/host/roots/r3f-root.tsx` so the capture/attribution/restore
 * flow is unit-testable in a headless Node test with a mock GL context and a
 * plain scene — a real non-headless GPU mount (EffectComposer + WebGLRenderer)
 * cannot run under vitest here. `mount()` owns the
 * DECISION to construct this (only under a real WebGL2 context, never
 * headless — see `frameCaptureContextFor`); this module owns the BEHAVIOR.
 *
 * Attribution model (honest by construction): `captureFrame()` wraps every
 * renderable's `onBeforeRender` to feed one annotation to the capture. three
 * calls `onBeforeRender` immediately before that object's MAIN-pass draw, so
 * main-pass draws are attributed and shadow/composer-pass draws record
 * `annotation: null` (counted as unattributed) — never a fabricated guess. The
 * wrappers are all restored when the capture resolves, rejects, times out, or
 * the adapter is disposed.
 *
 * That attribution is a THREE capability, not a property of frame capture: a
 * surface whose renderer has no per-draw annotation seam omits `scene` entirely
 * (the Pixi ingest lane does — `editor/src/ingest/ingest-render-debug.ts`), and
 * every draw is then recorded unattributed. The capture itself is GL-level and
 * unchanged either way; only the names beside the draws go away.
 */

import type { RenderDebugAdapter } from '@volter/editor-project/adapter/system-adapter';
import type * as THREE from 'three';
import type { RenderMemorySnapshot } from './render-memory';
import type { DrawAnnotation, FrameCapture, WebGLFrameCapture } from './webgl-frame-capture';

/** Decide whether a mount can host frame capture — a real WebGL2 context with
 *  the draw entry points, never a headless/stub renderer. Exported so the
 *  mount uses ONE predicate and a unit test can assert both sides (mock GL ⇒
 *  the context; headless/missing ⇒ null) without a GPU. */
export function frameCaptureContextFor(
  headless: boolean,
  rendererContext: unknown,
): WebGL2RenderingContext | null {
  if (headless) return null;
  if (!rendererContext || typeof rendererContext !== 'object') return null;
  const gl = rendererContext as Partial<WebGL2RenderingContext>;
  if (typeof gl.getExtension !== 'function') return null;
  if (typeof gl.drawArrays !== 'function' || typeof gl.drawElements !== 'function') return null;
  return rendererContext as WebGL2RenderingContext;
}

export interface RenderDebugAdapterDeps {
  /** The armed-on-demand frame capture over the mount's real context. */
  capture: WebGLFrameCapture;
  /**
   * The live three scene root traversed to attribute draws to the objects that
   * issue them.
   *
   * OMITTED on a surface whose renderer publishes no per-draw annotation seam —
   * the Pixi lane, where display objects have no `onBeforeRender` and the
   * batcher merges many display objects into one draw, so there is no object to
   * name for a given draw at all. Then every draw is recorded with
   * `annotation: null` and lands in `totals.unattributed`: the honest "this
   * seam cannot say who drew this", never a guess derived from the scene's
   * shape.
   */
  scene?: THREE.Object3D;
  /** Memory snapshot supplier (renderer.info-backed). When omitted, the
   *  adapter's `memorySnapshot` is absent (honest capability degradation). */
  memory?: () => RenderMemorySnapshot;
  /** Timeout (ms) after which a pending `captureFrame` rejects — the world
   *  never rendered (paused/stopped). Default 5000. */
  timeoutMs?: number;
  /** Injected timer, for tests. Defaults to the real `setTimeout`/
   *  `clearTimeout`. */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface RenderDebugWiring {
  readonly adapter: RenderDebugAdapter;
  /** Call at the START of the host render pass, before draws. */
  beforeRender(): void;
  /** Call at the END of the host render pass, after draws (in a `finally`). */
  afterRender(): void;
  /** Restore any pending attribution wrappers and reject a pending capture. */
  dispose(): void;
}

interface Pending {
  resolve(capture: FrameCapture): void;
  reject(error: Error): void;
  restores: (() => void)[];
  timer: unknown;
  settled: boolean;
}

/** Objects three actually issues draws for (and thus calls `onBeforeRender`
 *  on before the main-pass draw). */
function isRenderable(object: THREE.Object3D): boolean {
  const o = object as unknown as {
    isMesh?: boolean;
    isSkinnedMesh?: boolean;
    isPoints?: boolean;
    isLine?: boolean;
    isSprite?: boolean;
  };
  return Boolean(o.isMesh || o.isSkinnedMesh || o.isPoints || o.isLine || o.isSprite);
}

function annotationFor(object: THREE.Object3D): DrawAnnotation {
  const mesh = object as THREE.Mesh;
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  const rawMaterial = mesh.material;
  const material = (Array.isArray(rawMaterial) ? rawMaterial[0] : rawMaterial) as
    | THREE.Material
    | undefined;
  const entityId = object.userData?.['entityId'];
  return {
    object: {
      name: object.name || object.type,
      type: object.type,
      ...(entityId !== undefined ? { entityId: String(entityId) } : {}),
    },
    geometry: {
      type: geometry?.type ?? 'unknown',
      name: geometry?.name ?? '',
      attributes: geometry ? Object.keys(geometry.attributes) : [],
      indexed: Boolean(geometry?.index),
    },
    material: {
      type: material?.type ?? 'unknown',
      name: material?.name ?? '',
    },
  };
}

export function createRenderDebugAdapter(deps: RenderDebugAdapterDeps): RenderDebugWiring {
  const { capture, scene, memory } = deps;
  const timeoutMs = deps.timeoutMs ?? 5000;
  const setTimer = deps.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let pending: Pending | null = null;

  function wrapOnBeforeRender(): (() => void)[] {
    const restores: (() => void)[] = [];
    // No scene ⇒ no annotation seam on this surface (see `scene` above): wrap
    // nothing, restore nothing, and let every draw record `annotation: null`.
    if (!scene) return restores;
    scene.traverse((object) => {
      if (!isRenderable(object)) return;
      const original = object.onBeforeRender;
      object.onBeforeRender = function patched(this: THREE.Object3D, ...args) {
        capture.annotateNextDraw(annotationFor(object));
        original.apply(this, args as Parameters<THREE.Object3D['onBeforeRender']>);
      };
      restores.push(() => {
        object.onBeforeRender = original;
      });
    });
    return restores;
  }

  function settlePending(): Pending | null {
    const p = pending;
    if (p && !p.settled) {
      p.settled = true;
      clearTimer(p.timer);
      for (const restore of p.restores) restore();
      pending = null;
      return p;
    }
    return null;
  }

  const adapter: RenderDebugAdapter = {
    captureFrame(): Promise<FrameCapture> {
      if (pending) {
        return Promise.reject(new Error('RenderDebugAdapter: a frame capture is already pending'));
      }
      return new Promise<FrameCapture>((resolve, reject) => {
        const restores = wrapOnBeforeRender();
        capture.arm();
        // Assign `pending` BEFORE arming the timer so a synchronous injected
        // timer (test) sees a settle-able pending rather than a null one.
        const p: Pending = { resolve, reject, restores, timer: null, settled: false };
        pending = p;
        p.timer = setTimer(() => {
          if (settlePending()) {
            reject(
              new Error(
                `RenderDebugAdapter: no frame rendered within ${timeoutMs}ms — the world may be paused or stopped`,
              ),
            );
          }
        }, timeoutMs);
      });
    },
    ...(memory ? { memorySnapshot: (): RenderMemorySnapshot => memory() } : {}),
  };

  return {
    adapter,
    beforeRender(): void {
      capture.beginPass();
    },
    afterRender(): void {
      const result = capture.endPass();
      if (result && pending) {
        const p = settlePending();
        p?.resolve(result);
      }
    },
    dispose(): void {
      const p = settlePending();
      if (p) p.reject(new Error('RenderDebugAdapter: disposed before a frame was captured'));
    },
  };
}
