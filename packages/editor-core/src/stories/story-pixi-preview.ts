/**
 * Off-screen CANVAS/Pixi story preview — mount a composed CSF story that
 * produces Pixi content and hand back the `PIXI.Container` it rendered into,
 * plus the `Application` that owns its clock.
 *
 * The canvas-surface sibling of `story-three-preview.ts`, and it exists for the
 * same reason: portable CSF is a prefab's explicit "here is how this renders",
 * and a surface that wants to SHOW a prefab (the canvas board, and the
 * qualification both boards key membership on) needs that render as an object,
 * not as a picture.
 *
 * ## Why the mount goes through react-dom, not through a Pixi root
 *
 * A 2D prefab story mounts its OWN `@pixi/react` `<Application>` (see any 2D prefab's colocated
 * story under an example project's `prefabs` directory): unlike the three lane, where the
 * board supplies the scene and the story renders bare JSX into it, nothing
 * supplies a canvas-surface stage, so the story carries one and renders
 * anywhere react-dom renders. That is the story's own declaration and this
 * module does not second-guess it — it mounts the story exactly as written, in
 * a detached DOM host, and then ADOPTS what came out.
 *
 * ## What comes out, and what the caller may do with it
 *
 * `host` is the detached element the story rendered into and `stage` is the
 * Application's own root container — the REAL objects, with the story's real
 * textures on them. A caller that wants to DISPLAY the story reparents the
 * host into its own DOM (the `2D` board does exactly this, one host per
 * frame); nothing here rasterizes, copies, or re-creates anything, which is
 * what keeps the composed story render the sole visual authority (the
 * anti-shim rule) and what makes a `scaleMode: 'nearest'` sheet magnify
 * nearest wherever it ends up — the filtering belongs to the texture's own
 * source, and adopting the real render carries it along.
 *
 * The mount arrives STOPPED: `Application.init` defaults to `autoStart: true`,
 * so the story's own `requestAnimationFrame` loop would run on wall time in a
 * detached host nobody is looking at. {@link MountedStoryPixi.ticker} is that
 * clock, handed to the caller so a surface that wants the cycle to PLAY drives
 * it from its own frame instead — one clock per surface, none on wall time.
 *
 * ## Mounts are SERIAL, and one bad story never takes the rest down
 *
 * Same physics as the three lane, same queue (`story-mount-turn.ts`): a story's
 * loaders touch process-global state (Pixi's `Assets` cache and the
 * `@pixi/react` component catalogue are both module-global), so overlapping two
 * mounts interleaves their setup. A story that crashes while rendering is
 * caught by {@link CrashNullBoundary} and rejects in milliseconds with its own
 * error rather than burning the ceiling below — the exact measurement the three
 * lane records, and the reason a board over a project of non-canvas stories
 * finishes at all.
 */

import type { Application, Container } from 'pixi.js';
import { createElement } from 'react';
import type { Root } from 'react-dom/client';
import { withApplicationCollector } from '../canvas-preview-frames';
import { CrashNullBoundary } from '@volter/editor-sdk/kit/crash-null-boundary';
import { mountedStoryHasPixiContent } from './pixi-story-model';
import { resolveStoryDomRuntime } from './story-dom-runtime';
import { runInStoryMountTurn } from '@volter/editor-sdk/kit/stories/story-mount-turn';
import type { StoryPreviewComponent } from '@volter/editor-sdk/kit/stories/story-preview-component';

/**
 * How long the mount waits for the story's `Application` to finish initializing
 * AND for its stage to hold content. Both are legitimately slow: `init()`
 * creates a real renderer, and a prefab story commonly gates its children on
 * its atlas (`SpritesReady`), so the content arrives when the sheet does.
 * Matches the three lane's own first-commit ceiling.
 */
const PIXI_MOUNT_TIMEOUT_MS = 10_000;

/**
 * Event-loop turns the mount waits for the story's FIRST DOM commit, and for a
 * `<canvas>` to appear in it. This is the cheap NO: a story that renders DOM
 * and no canvas is not a canvas story, and it must answer in a few turns rather
 * than at the ceiling above — otherwise every board build over a UI-only
 * project would pay ten seconds per story.
 */
const COMMIT_TURNS = 12;

/** Where the detached host sits: far off-screen, contained, inert. `contain:
 *  strict` makes the host the containing block for `position: fixed`
 *  descendants, so a story that pins itself cannot flash across the editor —
 *  the same containment `story-capture.ts` documents for its own host. */
const HOST_STYLE =
  'position:fixed;left:-20000px;top:0;width:512px;height:512px;' +
  'overflow:hidden;contain:strict;pointer-events:none;visibility:hidden;';

/** One mounted canvas story. */
export interface MountedStoryPixi {
  /**
   * The detached element the story rendered into, with its `<canvas>` inside.
   *
   * A DOM surface that wants to SHOW this story reparents THIS element — never
   * the canvas alone. React owns the host's children: moving a react-rendered
   * node out from under its own root leaves `root.unmount()` removing a child
   * of a parent it no longer has, which throws. The host itself is ours, so it
   * travels freely and {@link dispose} still removes it from wherever it ended
   * up. Restyle it on adoption; {@link HOST_STYLE} only parks it off-screen.
   */
  readonly host: HTMLElement;
  /** The Application's own root container — the story's real display tree.
   *  Reparent it; never copy it. */
  readonly stage: Container;
  /** The story's clock, already STOPPED. A surface that wants the story's
   *  cycle to play calls `ticker.update(elapsedMs)` from its own frame. */
  readonly ticker: Application['ticker'];
  /**
   * The Application the story built — its own renderer included.
   *
   * A displaying surface keeps that renderer (it is what draws the adopted
   * host's canvas) and therefore keeps its WebGL context. That is the real
   * ceiling on how many stories one surface may show at once: a browser allows
   * on the order of sixteen contexts per page and drops the OLDEST when that
   * runs out. `app.screen` is the mounting canvas the story's own
   * `<Application>` declared; presentation surfaces may crop it to stage
   * content unless the story explicitly requests a fullscreen layout.
   */
  readonly app: Application;
  /** Tear the isolated react root down and destroy the story's display tree and
   *  clock. Runs the story's own effect cleanups. Idempotent. */
  dispose(): void;
}

/** A mount function valid inside an already-acquired story turn — the canvas
 *  sibling of `story-three-preview.ts`'s `StoryMountInTurn`. */
export type PixiStoryMountInTurn = (
  Component: StoryPreviewComponent,
  props?: Record<string, unknown>,
) => Promise<MountedStoryPixi>;

/** Run one compound canvas-story operation (a whole board build) with no other
 *  story mount, of any medium, interleaving it. */
export function withPixiStoryMountTurn<T>(
  task: (mount: PixiStoryMountInTurn) => Promise<T>,
): Promise<T> {
  return runInStoryMountTurn(() => task(mountStoryPixiInTurn));
}

/** Mount one canvas story off-screen, taking a turn of its own. */
export function mountStoryPixi(
  Component: StoryPreviewComponent,
  props: Record<string, unknown> = {},
): Promise<MountedStoryPixi> {
  return withPixiStoryMountTurn((mount) => mount(Component, props));
}

/** Dispose a standalone mount in the same shared turn domain. Compound callers
 *  already holding a turn dispose their own mounts inside it. */
export function disposeStoryPixi(mounted: MountedStoryPixi): Promise<void> {
  return runInStoryMountTurn(async () => mounted.dispose());
}

export interface PixiStoryThumbnailOptions {
  readonly width?: number;
  readonly height?: number;
  readonly props?: Record<string, unknown>;
  /** Storybook's standard layout policy. Only `fullscreen` makes the
   *  mounting Application's declared canvas part of the preview. */
  readonly layout?: 'centered' | 'padded' | 'fullscreen';
}

/**
 * Photograph a canvas prefab from its portable CSF story.
 *
 * This is the Pixi sibling of `captureStoryComponentThumbnail`: the story is
 * mounted through its own real `<Application>`, its paused stage is rendered
 * once without advancing the ticker, and Pixi's extraction API reads the
 * result back. The requested rectangle is presentation only; it never becomes
 * a second authored size or a component-specific thumbnail asset.
 */
export async function capturePixiStoryThumbnail(
  Component: StoryPreviewComponent,
  options: PixiStoryThumbnailOptions = {},
): Promise<string> {
  const mounted = await mountStoryPixi(Component, options.props ?? {});
  try {
    const width = options.width ?? 128;
    const height = options.height ?? 96;
    mounted.app.renderer.render({ container: mounted.stage });

    const bounds = mounted.stage.getBounds();
    const fullscreen = options.layout === 'fullscreen';
    const padding = 8;
    // Both frames are the STORY's own `Rectangle` — `screen.clone()` is the
    // app's class, whatever graph the story mounted in. A story's
    // `<Application>` comes from its own module graph (the project's under the
    // packaged runtime), and this rectangle is handed straight back to that
    // app's extractor; constructing the shell's class here was the one value
    // in this path that crossed.
    const frame = mounted.app.screen.clone();
    if (!fullscreen) {
      frame.x = bounds.x - padding;
      frame.y = bounds.y - padding;
      frame.width = Math.max(1, bounds.width + padding * 2);
      frame.height = Math.max(1, bounds.height + padding * 2);
    }
    // Match the target aspect by adding transparent breathing room. Never
    // stretch a sprite to make a rectangular thumbnail.
    const targetAspect = width / height;
    if (!fullscreen && frame.width / frame.height < targetAspect) {
      const nextWidth = frame.height * targetAspect;
      frame.x -= (nextWidth - frame.width) / 2;
      frame.width = nextWidth;
    } else if (!fullscreen && frame.width / frame.height > targetAspect) {
      const nextHeight = frame.width / targetAspect;
      frame.y -= (nextHeight - frame.height) / 2;
      frame.height = nextHeight;
    }
    const background = mounted.app.renderer.background;
    const source = (await mounted.app.renderer.extract.canvas({
      target: mounted.stage,
      frame,
      ...(fullscreen && background.alpha > 0 ? { clearColor: background.colorRgba } : {}),
    })) as HTMLCanvasElement;
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const context = output.getContext('2d');
    if (!context) throw new Error('Canvas story preview could not create a 2D readback context.');

    const scale = Math.min(width / source.width, height / source.height);
    const drawWidth = source.width * scale;
    const drawHeight = source.height * scale;
    context.drawImage(
      source,
      (width - drawWidth) / 2,
      (height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
    return output.toDataURL('image/png');
  } finally {
    await disposeStoryPixi(mounted);
  }
}

const nextTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The mount body for callers that already own the story turn. */
async function mountStoryPixiInTurn(
  StoryComponent: StoryPreviewComponent,
  props: Record<string, unknown> = {},
): Promise<MountedStoryPixi> {
  // Loaders first (Storybook 9's portable-story contract): a story's `loaded`
  // data is empty until `.load()` has run, and a canvas prefab's loader is
  // where it fetches its atlas.
  if (typeof StoryComponent.load === 'function') await StoryComponent.load();

  // In the packaged editor the CSF component and @pixi/react both belong to
  // the project's Vite graph. Mount them with that graph's react-dom too;
  // using the prebuilt editor bundle's createRoot crosses React dispatchers.
  const storyRuntime = await resolveStoryDomRuntime();

  const host = document.createElement('div');
  host.setAttribute('style', HOST_STYLE);
  document.body.appendChild(host);

  let root: Root | null = null;
  const teardown = (): void => {
    root?.unmount();
    root = null;
    host.remove();
  };

  try {
    return await withApplicationCollector(async (created) => {
      let renderError: unknown = null;
      root = storyRuntime.createRoot(host);
      root.render(
        createElement(
          CrashNullBoundary,
          {
            onCaught: (error: unknown) => {
              renderError ??= error;
            },
          },
          createElement(StoryComponent, props),
        ),
      );

      // The cheap NO: a committed story with no canvas in it is not a canvas
      // story, and says so in a few turns.
      for (let turn = 0; turn < COMMIT_TURNS; turn++) {
        if (renderError) break;
        if (host.querySelector('canvas')) break;
        await nextTurn();
      }
      if (renderError) throw describeMountFailure(renderError);
      if (!host.querySelector('canvas')) {
        throw new Error('The story rendered no canvas — it does not mount Pixi content.');
      }

      // A canvas is present, so an `Application.init()` is in flight (or has
      // already landed). From here the ceiling is the real one: init creates a
      // renderer, and the story's own content may be gated on its atlas.
      const deadline = Date.now() + PIXI_MOUNT_TIMEOUT_MS;
      let app: Application | undefined;
      while (Date.now() < deadline) {
        if (renderError) throw describeMountFailure(renderError);
        app ??= created[0];
        if (app && mountedStoryHasPixiContent(app.stage)) break;
        await nextTurn();
      }
      if (!app) {
        throw new Error(
          'The story rendered a canvas but never initialized a Pixi Application within ' +
            `${PIXI_MOUNT_TIMEOUT_MS / 1000}s — it is not a canvas story, or its renderer ` +
            'could not be created here.',
        );
      }

      // Content time does not run on wall time at design time. The story's own
      // rAF loop stops here and the clock is handed to whoever presents it.
      app.stop();
      app.ticker.lastTime = 0;

      let disposed = false;
      return {
        host,
        stage: app.stage,
        ticker: app.ticker,
        app,
        dispose(): void {
          if (disposed) return;
          disposed = true;
          // React, and react ONLY. Unmounting the story's `<Application>` is
          // what tears the Application down: `@pixi/react`'s own unmount path
          // (`helpers/unmountRoot`) renders `null` into the stage — running
          // every `useTick` cleanup in order — and only then destroys the app
          // and forgets its canvas. Destroying anything here as well is a
          // double free of a ticker its cleanups are still using.
          teardown();
        },
      } satisfies MountedStoryPixi;
    });
  } catch (error) {
    teardown();
    throw error;
  }
}

// ------------------------------------------------- the capture lane's frame

/** How long {@link awaitPixiStoryFrame} waits. Same ceiling, same reasons, as
 *  the mount above: a real renderer is created and a prefab's content commonly
 *  waits on its atlas. */
const FIRST_FRAME_TIMEOUT_MS = PIXI_MOUNT_TIMEOUT_MS;

/**
 * Wait until every collected `Application` has PRESENTED a frame with content
 * in it — the readiness test a capture of a canvas story owes itself.
 *
 * MEASURED DEFECT (this is why the function exists): `vgai screenshot
 * <file>.stories.tsx` photographed a `@pixi/react` story blank. The capture
 * lane's own readiness test is "the container has committed child nodes", and
 * `<Application>` commits its `<canvas>` on the FIRST commit — before
 * `Application.init()` has even created a renderer, and long before an atlas
 * the story gates its children on has resolved. So the sheet was rasterized
 * from an empty canvas and looked like a perfectly plausible blank frame, which
 * is the worst failure a look verb has.
 *
 * Two conditions, because either alone still lies: a renderer that has drawn an
 * empty stage has presented a frame, and a stage with children whose renderer
 * has not run yet has no pixels.
 *
 * Resolves (rather than throwing) at the ceiling: a story that genuinely never
 * draws must still be photographed, and an honestly blank cell is the truth
 * about it.
 */
export async function awaitPixiStoryFrame(
  apps: readonly Application[],
  now: () => number = Date.now,
): Promise<void> {
  if (apps.length === 0) return;
  const presented = new Set<Application>();
  const subscriptions = apps.map((app) => {
    const observer = {
      postrender: () => {
        presented.add(app);
      },
    };
    app.renderer?.runners.postrender.add(observer);
    return { app, observer };
  });
  try {
    const deadline = now() + FIRST_FRAME_TIMEOUT_MS;
    while (now() < deadline) {
      const ready = apps.every(
        (app) =>
          app.stage !== undefined && mountedStoryHasPixiContent(app.stage) && presented.has(app),
      );
      if (ready) return;
      await nextTurn();
    }
  } finally {
    for (const { app, observer } of subscriptions) {
      app.renderer?.runners.postrender.remove(observer);
    }
  }
}

function describeMountFailure(error: unknown): Error {
  return new Error(
    'mountStoryPixi: the story threw while rendering — it does not mount Pixi content, or its ' +
      `component crashed. Original error: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  );
}
