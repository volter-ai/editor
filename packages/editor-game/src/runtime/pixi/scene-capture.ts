/**
 * Scene capture for the Pixi surface — the PixiJS analog of the three.js render
 * accessor-trap (`adapter/ingest/scene-capture.ts`).
 *
 * An unmodified PixiJS game owns its own `Application`, `stage`, renderer, and
 * ticker. To inspect/host that live scene with ZERO edits to the game, we trap the
 * render call and capture the game's `stage` + renderer + app on its first frame.
 *
 * Unlike three.js's `WebGLRenderer` (whose `render` is an own-instance property,
 * forcing a prototype getter/setter), PixiJS's `Application.prototype.render` is a
 * normal prototype method — the standard ticker render path (`ticker → app.render()`)
 * goes through it — so a direct prototype wrap suffices.
 *
 * CRITICAL (same module-identity gatekeeper as the 3D path): the trap must be
 * installed on the SAME `pixi.js` module instance the game uses. A bundler/dev-server
 * that dedupes `pixi.js` makes an ESM game's `import 'pixi.js'` resolve to the host
 * instance, so it is trapped; a game bundling its own pixi cannot be captured at
 * all, and its mount fails by name.
 */

import {
  type CaptureWaitOptions,
  documentVisibilityClock,
  startVisibleCaptureWindow,
} from '@volter/threejs-runtime/adapter/ingest/visible-capture-window';

/**
 * Options for {@link SceneCapture2DHandle.waitForCapture} — the WAIT's options,
 * not this lane's, so they carry no `2D` suffix and are not declared here.
 * They configure `visible-capture-window.ts`'s window, which both surfaces
 * share; this lane used to restate them field-for-field under a `2D` name.
 * The suffix marks what a surface genuinely owns
 * ({@link CapturedRuntime2D} is a Pixi stage/renderer/app, and stays), and a
 * budget of visible milliseconds is not that. Passing a bare number is
 * `{ timeoutMs }`, which is what every existing caller does.
 */
export type { CaptureWaitOptions };

/** A live Pixi runtime captured from an external PixiJS game. */
export interface CapturedRuntime2D {
  /** The game's root stage Container. */
  stage: unknown;
  /** The game's PixiJS renderer. */
  renderer: unknown;
  /** The game's Application (so the host can pause/resume its ticker). */
  app: unknown;
}

export interface SceneCapture2DHandle {
  readonly captured: CapturedRuntime2D | null;
  /**
   * Resolve once the game's stage is captured.
   *
   * The timeout is a budget of **VISIBLE** time, not wall-clock time — the same
   * rule the three lane has had since `visible-capture-window.ts`, and for the
   * same measured reason: a hidden document cannot render (the browser parks
   * rAF), so counting hidden time against the game counts time it was not
   * allowed to use. MEASURED on the bubbo-bubbo ingest with a plain
   * `setTimeout` here: the mount succeeded when the auto-opened tab happened to
   * be in front and died terminally 8s later when it was behind — "canvas
   * ingest: game … rendered no capturable frame", with foregrounding the tab
   * afterwards changing nothing. The normal HUMAN path is the backgrounded one.
   *
   * So the wait PARKS while hidden, the trap stays installed, and the first
   * frame the tab draws after it comes forward is trapped exactly as it would
   * have been at boot. Rejects only when the window is spent while VISIBLE.
   */
  waitForCapture(options?: number | CaptureWaitOptions): Promise<CapturedRuntime2D>;
  getDrawCount(): number;
  /** Pause/resume the captured game's own ticker (loop-host gating). */
  setPaused(paused: boolean): void;
  uninstall(): void;
}

interface PixiLike {
  Application: { prototype: Record<string, unknown> };
}

export interface SceneCapture2DOptions {
  /**
   * Select the runtime owned by this mount when other Pixi Applications share
   * the page (for example editor prefab previews). Rejected draws still count,
   * but cannot satisfy {@link SceneCapture2DHandle.waitForCapture}.
   */
  accept?: ((runtime: CapturedRuntime2D) => boolean) | undefined;
}

/**
 * Install the render trap on `pixiNamespace.Application.prototype.render`. Pass the
 * host's `pixi.js` namespace so a shared-instance game is trapped. Install once per
 * ingest session; `uninstall()` on teardown.
 */
export function installSceneCapture2D(
  pixiNamespace: unknown,
  options: SceneCapture2DOptions = {},
): SceneCapture2DHandle {
  const PIXI = pixiNamespace as PixiLike;
  const proto = PIXI.Application.prototype;

  let captured: CapturedRuntime2D | null = null;
  let drawCount = 0;
  const waiters: Array<(rt: CapturedRuntime2D) => void> = [];

  const priorRender = Object.getOwnPropertyDescriptor(proto, 'render');
  const realRender = proto['render'] as ((...a: unknown[]) => unknown) | undefined;

  Object.defineProperty(proto, 'render', {
    configurable: true,
    writable: true,
    value: function (this: Record<string, unknown>, ...args: unknown[]) {
      drawCount++;
      const stage = this['stage'];
      if (!captured && stage) {
        const candidate = { stage, renderer: this['renderer'], app: this };
        if (options.accept?.(candidate) ?? true) {
          captured = candidate;
          for (const resolve of waiters.splice(0)) resolve(captured);
        }
      }
      return realRender?.apply(this, args);
    },
  });

  return {
    get captured() {
      return captured;
    },
    getDrawCount() {
      return drawCount;
    },
    setPaused(paused: boolean) {
      const app = captured?.app as { ticker?: { start(): void; stop(): void } } | undefined;
      if (!app?.ticker) return;
      if (paused) app.ticker.stop();
      else app.ticker.start();
    },
    waitForCapture(options) {
      const opts: CaptureWaitOptions =
        typeof options === 'number' ? { timeoutMs: options } : (options ?? {});
      const timeoutMs = opts.timeoutMs ?? 10_000;
      if (captured) return Promise.resolve(captured);
      return new Promise<CapturedRuntime2D>((resolve, reject) => {
        const captureWindow = startVisibleCaptureWindow({
          budgetMs: timeoutMs,
          clock: opts.visibility ?? documentVisibilityClock(),
          onExpire: () => {
            const i = waiters.indexOf(wrapped);
            if (i >= 0) waiters.splice(i, 1);
            opts.onWait?.(null);
            reject(
              new Error(
                `pixi scene capture timed out after ${timeoutMs}ms of VISIBLE time ` +
                  `(${Math.round(captureWindow.elapsedHiddenMs())}ms browser-suspended, which is ` +
                  'not counted because no frame can be presented) — the game never rendered, or it bundles its own ' +
                  '(un-shared) copy of pixi.js.',
              ),
            );
          },
        });
        const wrapped = (rt: CapturedRuntime2D) => {
          captureWindow.cancel();
          opts.onWait?.(null);
          resolve(rt);
        };
        waiters.push(wrapped);
        opts.onWait?.(captureWindow);
      });
    },
    uninstall() {
      if (priorRender) Object.defineProperty(proto, 'render', priorRender);
      else if (realRender)
        Object.defineProperty(proto, 'render', {
          configurable: true,
          writable: true,
          value: realRender,
        });
    },
  };
}
