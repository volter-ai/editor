/**
 * The render-pass BRACKET on the Pixi surface — the canvas-substrate answer to
 * the question the three lane answers with the render accessor-trap's
 * `setRenderPassHooks` (`adapter/ingest/scene-capture.ts`): *when does this
 * renderer's pass begin and end?*
 *
 * ## Why the renderer's own runners, and not another wrap
 *
 * Pixi's `AbstractRenderer.render()` emits five runners in a fixed order —
 * `prerender → renderStart → render → renderEnd → postrender` (verified in the
 * installed pixi.js 8.19,
 * `rendering/renderers/shared/system/AbstractRenderer.mjs`). EVERY GL draw the
 * pass issues happens between the first and the last: the batcher draws under
 * `render`, and even the back-buffer blit, the one draw that is easy to miss,
 * runs under `renderStart`/`renderEnd` (`gl/GlBackBufferSystem.mjs`). So a
 * listener added to `prerender` and `postrender` brackets the whole pass using
 * the renderer's OWN published seam — no instance shadowing, no prototype
 * patch, no ordering assumption beyond the one Pixi itself guarantees.
 *
 * `SystemRunner.add(item)` binds by METHOD NAME (`item[runnerName]` must
 * exist) and `remove(item)` takes it back off, so installing and uninstalling
 * is symmetric and touches nothing else on the renderer.
 *
 * ## Honest absence
 *
 * A renderer that publishes no such runners is not bracketed by guesswork:
 * this returns `null`, and the caller treats that exactly like a missing
 * WebGL2 context — the capability is absent, never faked.
 */

import type { RenderPassHooks } from '@volter/threejs-runtime/adapter/ingest/scene-capture';

/** The slice of a Pixi renderer this reads — structural, so a headless test
 *  hands in a plain object with two runners and nothing else. */
interface RunnerLike {
  add(item: unknown): unknown;
  remove(item: unknown): unknown;
}

interface RendererWithRunners {
  runners?: {
    prerender?: RunnerLike;
    postrender?: RunnerLike;
  };
}

function runnerPair(renderer: unknown): { pre: RunnerLike; post: RunnerLike } | null {
  if (!renderer || typeof renderer !== 'object') return null;
  const runners = (renderer as RendererWithRunners).runners;
  const pre = runners?.prerender;
  const post = runners?.postrender;
  if (!pre || typeof pre.add !== 'function' || typeof pre.remove !== 'function') return null;
  if (!post || typeof post.add !== 'function' || typeof post.remove !== 'function') return null;
  return { pre, post };
}

/**
 * Bracket a Pixi renderer's render pass with `hooks.before`/`hooks.after`.
 *
 * Returns the uninstall function, or `null` when this renderer publishes no
 * `prerender`/`postrender` runners — the honest "cannot bracket this", which
 * the caller reads as "no render-debug capability here".
 *
 * Neither hook may throw — the same contract the three lane's `RenderPassHooks`
 * carries, and for a sharper reason here: these run as listeners on the
 * renderer's own runners, so a throwing `before` aborts the game's frame AND
 * skips the `postrender` emit that would have closed the pass. The assembly
 * point (`ingest/ingest-render-debug.ts`) is where that contract is kept.
 */
export function installPixiRenderPassBracket(
  renderer: unknown,
  hooks: RenderPassHooks,
): (() => void) | null {
  const pair = runnerPair(renderer);
  if (!pair) return null;

  // One object per runner: `SystemRunner.add` binds by method name, so the
  // `prerender` listener and the `postrender` listener cannot be the same
  // object unless it answers to both — keeping them separate makes each
  // `remove()` exact.
  const preListener = {
    prerender() {
      hooks.before();
    },
  };
  const postListener = {
    postrender() {
      hooks.after();
    },
  };

  pair.pre.add(preListener);
  pair.post.add(postListener);

  let uninstalled = false;
  return () => {
    if (uninstalled) return;
    uninstalled = true;
    pair.pre.remove(preListener);
    pair.post.remove(postListener);
  };
}

/**
 * The captured Pixi renderer's real WebGL2 context, or `undefined`.
 *
 * `WebGLRenderer.gl` is the renderer's own published field — `GlContextSystem`
 * assigns it (`this._renderer.gl = gl`,
 * `rendering/renderers/gl/context/GlContextSystem.mjs`) as part of
 * initialisation, and `WebGLRenderer.d.ts` declares it. A WebGPU renderer, or
 * a renderer that has not initialised a context, simply has none — which is the
 * answer, not an error.
 */
export function pixiRenderingContext(renderer: unknown): unknown {
  if (!renderer || typeof renderer !== 'object') return undefined;
  return (renderer as { gl?: unknown }).gl;
}
