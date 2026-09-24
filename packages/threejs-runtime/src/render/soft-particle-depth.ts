/**
 * Opaque scene DEPTH for native consumers, including three.quarks soft particles and translated
 * Godot `hint_depth_texture` shader uniforms.
 *
 * ## What three.quarks needs, and what it does when nobody supplies it
 *
 * A batch built with `softParticles` compiles its fragment stage with
 * `SOFT_PARTICLES` defined, which brings in these two chunks verbatim
 * (`three.quarks@0.16.0`, `src/shaders/chunks/soft_pars_fragment.glsl.ts` and
 * `soft_fragment.glsl.ts`):
 *
 * ```glsl
 *     uniform sampler2D depthTexture;
 *     uniform vec4 projParams;
 *     uniform vec2 softParams;
 *
 *     varying vec4 projPosition;
 *     varying float linearDepth;
 *
 *     #define SOFT_NEAR_FADE softParams.x
 *     #define SOFT_INV_FADE_DISTANCE softParams.y
 *
 *     #define zNear projParams.x
 *     #define zFar projParams.y
 *
 *     float linearize_depth(float d)
 *     {
 *         return (zFar * zNear) / (zFar - d * (zFar - zNear));
 *     }
 * ```
 *
 * ```glsl
 *     vec2 p2 = projPosition.xy / projPosition.w;
 *
 *     p2 = 0.5 * p2 + 0.5;
 *
 *     float readDepth = texture2D(depthTexture, p2.xy).r;
 *     float viewDepth = linearize_depth(readDepth);
 *
 *     float softParticlesFade = saturate(SOFT_INV_FADE_DISTANCE * ((viewDepth - SOFT_NEAR_FADE) - linearDepth));
 *
 *     gl_FragColor *= softParticlesFade;
 * ```
 *
 * `depthTexture` is a `new Uniform(null)` until something calls
 * `BatchedRenderer.setDepthTexture` / `VFXBatch.applyDepthTexture`
 * (`BatchedRenderer.ts:191-196`, `VFXBatch.ts:93-101`). With it null the sampler
 * reads black, `readDepth` is `0`, `viewDepth` collapses to `zNear`, and
 * `softParticlesFade` saturates to `0` — every particle multiplied away. That is
 * the failure this module exists to make impossible: {@link farDepthTexture} is
 * bound to every `BatchedRenderer` this engine constructs, so the WORST case is
 * `readDepth = 1` ⇒ `viewDepth = zFar` ⇒ fade `1`, i.e. pixel-identical to a
 * batch that never had `SOFT_PARTICLES` at all.
 *
 * ## The pass, and what it costs
 *
 * The fade needs the depth of the geometry BEHIND the particle, which cannot be
 * the depth attachment the particle is being drawn into (sampling a texture
 * attached to the bound framebuffer is a feedback loop). So it is a real
 * PREPASS: one extra `renderer.render(scene, camera)` into a depth-only target,
 * with the armed particle renderers and every transparent surface hidden and a
 * colour-write-disabled override material in place.
 *
 * That cost is paid ONLY while something is armed. Soft particles enter through
 * {@link armSoftParticleDepth}; translated depth-texture shader programs enter through
 * {@link armSceneDepthTexture}. With both registries empty {@link SoftParticleDepthPass.render}
 * returns before it touches the scene. Armed, per frame per camera it costs: one scene traverse (to find the
 * transparent surfaces to hide), one extra geometry-only scene draw with shadow
 * updates suppressed, and a drawing-buffer-sized depth target
 * (`UnsignedIntType` depth + an unread RGBA8 colour attachment ≈ 8
 * bytes/pixel).
 *
 * ## Why TRANSPARENT surfaces are hidden
 *
 * Godot's own `DEPTH_TEXTURE` — the one `proximity_fade_enabled` samples — is
 * the OPAQUE pass's depth: `BaseMaterial3D`'s default `depth_draw_opaque` means
 * a transparent material contributes no depth. Reproducing that is not
 * cosmetic; without it the starter kit's coin would fade its stars against the
 * translucent glow quad sitting in front of them rather than against the floor.
 *
 * ## Resource ownership
 *
 * - {@link farDepthTexture}'s 1x1 texture is a module singleton, created on
 *   first use and NEVER disposed: it is bound into every renderer's uniforms as
 *   the safe default, so there is no moment at which the last user is known.
 *   One texel, one allocation per process.
 * - The armed-renderer registry is written by exactly two functions,
 *   {@link armSoftParticleDepth} / {@link disarmSoftParticleDepth}, whose only
 *   callers are `registerParticleSystem` / `unregisterParticleSystem`.
 * - The render target and override material belong to the
 *   {@link SoftParticleDepthPass} instance and die with its `dispose()`. The
 *   pass is owned by the renderer loop that calls it: an adapter mount for a
 *   runtime renderer, or the editor Scene viewport for its renderer. That
 *   owner's teardown is the one path allowed to end it.
 */

import * as THREE from 'three';
import type { BatchedRenderer } from 'three.quarks';

/**
 * The renderers hosting at least one system that asked for `softParticles`, and
 * HOW MANY — a renderer may batch several emitters and must stay armed until
 * the last one leaves.
 *
 * Module-scoped because the pass is per-MOUNT while a renderer is per-emitter:
 * two worlds may be mounted at once and each pass filters this map down to the
 * renderers actually parented under the scene it is rendering.
 */
const armed = new Map<BatchedRenderer, number>();

/** Any native material/program that samples Godot's opaque-pass depth texture. */
export interface SceneDepthTextureConsumer {
  setDepthTexture(texture: THREE.Texture): void;
}

const depthTextureConsumers = new Map<SceneDepthTextureConsumer, number>();

let farDepth: THREE.DataTexture | undefined;

/**
 * A 1x1 texture whose red channel is 1.0 — "the depth buffer says nothing is in
 * front of anything".
 *
 * Bound to a `BatchedRenderer` the moment it is constructed, so a batch that
 * later compiles with `SOFT_PARTICLES` inherits it (`BatchedRenderer.addSystem`
 * applies `this.depthTexture` to each batch it creates). Feeding
 * `linearize_depth` a `1.0` yields `(zFar * zNear) / (zFar - (zFar - zNear))`,
 * which is `zFar`, so the fade term is `saturate(k * (zFar - linearDepth))` — 1
 * for every fragment in front of the far plane. The fade is INERT rather than
 * wrong, which is what makes an undriven surface (a design-time preview, a host
 * with no pass) render exactly as it did before soft particles existed.
 */
export function farDepthTexture(): THREE.DataTexture {
  if (farDepth === undefined) {
    farDepth = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    farDepth.name = 'soft-particle-far-depth';
    farDepth.needsUpdate = true;
  }
  return farDepth;
}

/** Record that `renderer` hosts one more soft-particle system, so passes stop skipping it. */
export function armSoftParticleDepth(renderer: BatchedRenderer): void {
  armed.set(renderer, (armed.get(renderer) ?? 0) + 1);
}

/**
 * The other half of {@link armSoftParticleDepth}. On the LAST soft system the
 * renderer is dropped from the registry and handed the inert far-depth default
 * back, so a batch that outlives its registration never keeps sampling a scene
 * depth nobody is refreshing.
 */
export function disarmSoftParticleDepth(renderer: BatchedRenderer): void {
  const remaining = (armed.get(renderer) ?? 0) - 1;
  if (remaining > 0) {
    armed.set(renderer, remaining);
    return;
  }
  if (!armed.delete(renderer)) return;
  renderer.setDepthTexture(farDepthTexture());
}

/** Retain one consumer of the same opaque scene-depth image Godot exposes as hint_depth_texture. */
export function armSceneDepthTexture(consumer: SceneDepthTextureConsumer): void {
  depthTextureConsumers.set(consumer, (depthTextureConsumers.get(consumer) ?? 0) + 1);
  consumer.setDepthTexture(farDepthTexture());
}

/** Release one retained Godot depth-texture consumer without leaving a disposed target bound. */
export function disarmSceneDepthTexture(consumer: SceneDepthTextureConsumer): void {
  const remaining = (depthTextureConsumers.get(consumer) ?? 0) - 1;
  if (remaining > 0) {
    depthTextureConsumers.set(consumer, remaining);
    return;
  }
  if (!depthTextureConsumers.delete(consumer)) return;
  consumer.setDepthTexture(farDepthTexture());
}

/** Test/diagnostic read of the registry — how many renderers a pass would consider. */
export function armedSoftParticleRendererCount(): number {
  return armed.size;
}

/** The subset of `THREE.WebGLRenderer` this pass drives, so a host can supply its own. */
export interface SoftParticleDepthRenderer {
  getDrawingBufferSize(target: THREE.Vector2): THREE.Vector2;
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  setRenderTarget(target: THREE.WebGLRenderTarget | null): void;
  render(scene: THREE.Object3D, camera: THREE.Camera): void;
  /** Optional because a stub renderer legitimately has none — see {@link SoftParticleDepthPass}. */
  readonly shadowMap?: { autoUpdate: boolean; needsUpdate: boolean };
}

export interface SoftParticleDepthPass {
  /**
   * Draw scene depth and hand it to every armed renderer under `scene`.
   *
   * A no-op — not one draw call, not one traversal — while nothing is armed.
   * Call it after gameplay has moved the frame's transforms and before the
   * frame is drawn.
   */
  render(renderer: SoftParticleDepthRenderer, scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
}

/** Is `node` inside `root`'s subtree? Walks parents, so it is O(depth), not O(scene). */
function isUnder(node: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let at: THREE.Object3D | null = node; at !== null; at = at.parent) {
    if (at === root) return true;
  }
  return false;
}

/** Godot's `depth_draw_opaque`: a transparent surface contributes no depth. */
function drawsIntoDepth(object: THREE.Object3D): boolean {
  const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
  if (material === undefined) return true;
  return Array.isArray(material)
    ? !material.every((entry) => entry.transparent)
    : !material.transparent;
}

/**
 * The three renderer members this prepass CANNOT do without — the render-target
 * swap it draws through, and the buffer size it sizes that target from.
 *
 * A real `WebGLRenderer` has all of them. A design-time stand-in that only has
 * to answer `render` may mount a world so another host can read it, but cannot
 * run this effect. The editor does not pass that stand-in here: its real
 * viewport renderer owns its own pass. Other incomplete hosts still degrade
 * loudly and once instead of taking the frame down.
 */
const REQUIRED_RENDERER_MEMBERS = [
  'getDrawingBufferSize',
  'getRenderTarget',
  'setRenderTarget',
  'render',
] as const;

/** The required members `renderer` does not implement, in declaration order. */
function missingRendererMembers(renderer: SoftParticleDepthRenderer): string[] {
  const held = renderer as unknown as Record<string, unknown>;
  return REQUIRED_RENDERER_MEMBERS.filter((name) => typeof held[name] !== 'function');
}

export function createSoftParticleDepthPass(): SoftParticleDepthPass {
  let target: THREE.WebGLRenderTarget | null = null;
  /** Warned about already — one line per pass, not one per frame. */
  let warnedIncapable = false;
  const override = new THREE.MeshBasicMaterial({ colorWrite: false });
  override.name = 'soft-particle-depth-prepass';
  const size = new THREE.Vector2();
  const hidden: THREE.Object3D[] = [];

  const resize = (width: number, height: number): THREE.WebGLRenderTarget => {
    if (target !== null && target.width === width && target.height === height) return target;
    target?.dispose();
    const depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
    depthTexture.name = 'soft-particle-scene-depth';
    const next = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true, depthTexture });
    target = next;
    return next;
  };

  return {
    render(renderer, scene, camera): void {
      if (armed.size === 0 && depthTextureConsumers.size === 0) return;
      const consumers: BatchedRenderer[] = [];
      for (const candidate of armed.keys()) {
        if (isUnder(candidate, scene)) consumers.push(candidate);
      }
      if (consumers.length === 0 && depthTextureConsumers.size === 0) return;

      // See REQUIRED_RENDERER_MEMBERS: a renderer that cannot swap render
      // targets cannot run a prepass, and the frame is worth more than the
      // fade. Every consumer keeps the far-depth default it was armed with.
      const missing = missingRendererMembers(renderer);
      if (missing.length > 0) {
        if (!warnedIncapable) {
          warnedIncapable = true;
          // biome-ignore lint/suspicious/noConsole: deliberate loud degrade — the documented alternative to throwing out of the frame
          console.warn(
            `opaque scene-depth prepass skipped: this renderer is missing ${missing.join(', ')}. ` +
              `${String(consumers.length)} particle batch(es) and ${String(depthTextureConsumers.size)} ` +
              'shader consumer(s) keep the inert far-depth default. A real ' +
              'WebGLRenderer has these; a design-time settle stand-in does not.',
          );
        }
        return;
      }

      renderer.getDrawingBufferSize(size);
      const width = Math.max(1, Math.floor(size.x));
      const height = Math.max(1, Math.floor(size.y));
      const rt = resize(width, height);

      // Hidden for the prepass: the particles themselves (they are what samples
      // this depth) and every transparent surface (Godot's opaque-only depth).
      hidden.length = 0;
      for (const consumer of consumers) {
        if (consumer.visible) {
          consumer.visible = false;
          hidden.push(consumer);
        }
      }
      scene.traverse((object) => {
        if (!object.visible) return;
        if (drawsIntoDepth(object)) return;
        object.visible = false;
        hidden.push(object);
      });

      const previousTarget = renderer.getRenderTarget();
      const previousOverride = scene.overrideMaterial;
      // three re-renders every shadow map on EVERY `render()` call while
      // `shadowMap.autoUpdate` is on, so without this the prepass would double
      // the frame's shadow cost for a pass that writes depth and nothing else.
      // Both flags are restored below; the frame's own draw re-renders them.
      const shadows = renderer.shadowMap;
      const previousAutoUpdate = shadows?.autoUpdate ?? false;
      const previousNeedsUpdate = shadows?.needsUpdate ?? false;
      if (shadows !== undefined) {
        shadows.autoUpdate = false;
        shadows.needsUpdate = false;
      }
      scene.overrideMaterial = override;
      try {
        renderer.setRenderTarget(rt);
        renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(previousTarget);
        scene.overrideMaterial = previousOverride;
        if (shadows !== undefined) {
          shadows.autoUpdate = previousAutoUpdate;
          shadows.needsUpdate = previousNeedsUpdate;
        }
        for (const object of hidden) object.visible = true;
        hidden.length = 0;
      }

      const renderedDepth = rt.depthTexture;
      if (renderedDepth === null) {
        throw new Error('opaque scene-depth prepass lost its authored depth texture.');
      }
      for (const consumer of consumers) consumer.setDepthTexture(renderedDepth);
      for (const consumer of depthTextureConsumers.keys()) consumer.setDepthTexture(renderedDepth);
    },
    dispose(): void {
      // Every consumer this pass fed now points at a texture that is about to
      // go away. Hand them the inert default back rather than a disposed one.
      for (const candidate of armed.keys()) candidate.setDepthTexture(farDepthTexture());
      for (const consumer of depthTextureConsumers.keys())
        consumer.setDepthTexture(farDepthTexture());
      target?.dispose();
      target = null;
      override.dispose();
    },
  };
}
