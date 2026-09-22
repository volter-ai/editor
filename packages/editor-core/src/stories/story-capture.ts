/**
 * The STORY lane of `vgai screenshot` — a `.stories.tsx`/`.stories.ts` file's
 * CSF exports rendered in the live session's DOM and captured as one variant
 * sheet (ARCHITECTURE-CORE §Agent surface, the look-verb decision).
 *
 * Nothing here is a second story runtime. The editor already discovers CSF
 * files (`stories/story-discovery.ts`), composes them through Storybook's own
 * portable-story API (`stories/compose-project-stories.ts`) and mounts one
 * into an isolated `react-dom/client` root (`stories/StoryPreviewMount.ts`'s
 * `mountIsolatedStory`) for the Stories panel. This lane DRIVES that machinery
 * headlessly and photographs the result — the CSF module on disk stays the
 * only story definition that exists, and a story looks the same through the
 * CLI as it does in the panel because it is literally the same mount.
 *
 * The pixels come from the same leg the GAME lane composites with
 * (`capturePlayComposite`): a story is DOM, so it rides the `foreignObject`
 * half of that function exactly as a React HUD does. One capture path, so a
 * story sheet and a game screenshot can never disagree about how DOM is
 * rasterized.
 *
 * A CANVAS story is DOM (its own `<Application>` renders into a `<canvas>` the
 * DOM leg composites), so it rides that leg — but it needed two things the leg
 * did not do, and until they were added every `@pixi/react` story photographed
 * BLANK: the capture has to wait for the Pixi renderer's first presented frame
 * (`<Application>` commits its canvas before it has a renderer at all), and it
 * has to read the pixels back through Pixi's own extraction (a WebGL canvas
 * created without `preserveDrawingBuffer` — which a story's own `<Application>`
 * is — has nothing left to `drawImage` by the time the compositor gets to it).
 * Both live in `canvas-preview-frames.ts` with the measurement.
 *
 * EXCEPT a `three` story, which is not DOM at all: a prefab's CSF renders R3F
 * JSX (`<group>`, `<mesh>`), and a DOM root turns those into inert custom
 * elements — every 3D prefab's sheet came out pure white, silently (found
 * live: a project whose 120+ prefab stories all photographed blank). So each
 * export is offered to the off-screen R3F mount FIRST (`mountStoryObject3D`
 * via `captureStoryComponentThumbnail` — the same machinery the Content tab's
 * thumbnails and the 3D board already trust, packaged-runtime-aware), and
 * only a story the R3F reconciler refuses ("is not part of the THREE
 * namespace" — the qualification-rejection class that module documents) falls
 * through to the DOM leg below. The known cost: a DOM story's `loaders` run
 * once in the refused three attempt and again in the DOM mount — accepted,
 * because the alternative (guessing a story's kind from its source) is a
 * second story format, and loaders on DOM stories are rare.
 *
 * Isolation and cleanup: every export gets its OWN container element, mounted,
 * captured, unmounted and removed before the next one — and the offscreen host
 * is removed in a `finally`, so a story that throws mid-sheet leaves nothing
 * behind in `document.body`. Per-export containers are not fussiness:
 * `mountIsolatedStory` keys its react root by container in a `WeakMap` and
 * DELETES the entry on unmount, so re-mounting into an already-unmounted
 * container would call `createRoot` twice on the same node — react-dom's own
 * documented warning case.
 */

import type { Application } from 'pixi.js';
import { reactStoryBoardLayout } from '../authoring/react-story-board';
import { drawBitmapLabel } from '../bitmap-label';
import { pixiCanvasFrame, withApplicationCollector } from '../canvas-preview-frames';
import { type CaptureOptions, capturePlayComposite } from '../composite-screenshot';
import { getCurrentProject } from '../project-manager';
import {
  type ComposedProjectStory,
  composeProjectStories,
  ensureProjectAnnotations,
} from './compose-project-stories';
import { getProjectStoryRegions } from './project-story-regions';
import { mountIsolatedStory } from './StoryPreviewMount';
import { declaredStoryMedium } from './story-declared-medium';
import {
  discoverProjectStories,
  loadProjectPreviewAnnotations,
  type StoryDiscoveryProject,
} from './story-discovery';
import { awaitPixiStoryFrame } from './story-pixi-preview';
import { storyBoardPresentation } from './story-presentation';
import { getProjectPreviewStories, whenProjectStoriesReady } from './story-registry';
import {
  captureStoryComponentThumbnail,
  isStoryThreeClassificationRefusal,
  type StoryPreviewComponent,
  supportsThreeStoryCapture,
} from './story-three-preview';

/** One CSF export, rendered and photographed. */
export interface StoryVariantImage {
  /** The CSF export name — what `--story` narrows on, and the sheet label. */
  name: string;
  /** Storybook's human-facing story name; the CLI prints it, files use `name`. */
  label: string;
  base64: string;
  mimeType: 'image/png';
}

/** One story FILE's variant sheet — the unit this lane produces. */
export interface StoryVariantCapture {
  /** Project-relative path of the CSF module that was photographed. */
  modulePath: string;
  /** Per-variant cell size in CSS pixels. */
  width: number;
  height: number;
  variants: StoryVariantImage[];
  contactSheet: { width: number; height: number; base64: string; mimeType: 'image/png' };
}

export interface StoryCaptureOptions {
  /** Project-relative CSF path, exactly as `/__editor/story-files` reports it. */
  modulePath: string;
  /** Narrow the sheet to ONE export (`--story <export>`). */
  story?: string;
  width: number;
  height: number;
  /**
   * The rasterizer. Defaults to the game lane's own composite capture; a test
   * injects a stub because jsdom has no canvas, which is also what lets the
   * mount/cleanup contract be proven without a browser. The options are the
   * composite's own — the Pixi lane below hands it a `canvasFrame` seam.
   */
  capture?: (container: HTMLElement, options?: CaptureOptions) => Promise<{ base64: string }>;
  /**
   * The `three` leg (see the module doc comment). Defaults to
   * `captureStoryComponentThumbnail`, gated on `supportsThreeStoryCapture()`
   * (jsdom has no WebGL, so under tests the default leg is simply absent
   * unless a stub is injected). Returns a `data:` URL; ANY rejection routes
   * the story to the DOM leg.
   */
  captureThree?: (
    component: StoryPreviewComponent,
    size: { width: number; height: number },
  ) => Promise<string>;
  /** Free capture camera for THREE stories (`--azimuth/--elevation/
   *  --distance`), forwarded to the three leg's `captureObjectAssetPreview`.
   *  A selected story that lands on the DOM leg REFUSES it by name — a
   *  camera silently ignored is a wrong photograph presented as evidence. */
  camera?: import('@volter/editor-sdk').AssetPreviewCameraChoice;
  /** Clip pose for THREE stories (`--clip/--time`); DOM-leg stories refuse
   *  it by the same rule. */
  pose?: import('@volter/editor-sdk').AssetPreviewPose;
}

/** Capture the UI Canvas as a composition of every declared DOM artboard.
 * This uses the same portable-story mount and composite rasterizer as the
 * live board, without opening or activating that document. */
export async function captureDomStoryBoardPreview(width: number, height: number): Promise<string> {
  await whenProjectStoriesReady();
  const regions = getProjectStoryRegions();
  const stories = getProjectPreviewStories().filter(
    (story) => declaredStoryMedium({ modulePath: story.modulePath, regions }).medium === 'dom',
  );
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const context = output.getContext('2d');
  if (!context) throw new Error('UI Canvas preview could not create a 2D output context.');
  if (stories.length === 0) return output.toDataURL('image/png');
  const presentation = storyBoardPresentation(stories);
  const resolution = getCurrentProject()?.config.resolution;
  const fallback = { width: resolution?.width ?? 640, height: resolution?.height ?? 400 };
  const images = new Map<string, HTMLImageElement>();
  const sizes = new Map<string, { width: number; height: number }>();
  for (const story of stories) {
    const frame = presentation.resolve(story, fallback);
    const [variant] = await renderStoryVariants(story.modulePath, [story], {
      width: frame.width,
      height: frame.height,
      capture: capturePlayComposite,
      cropToContent: frame.layout !== 'fullscreen',
      layout: frame.layout,
      transparent: true,
    });
    if (!variant) throw new Error(`No preview rendered for ${story.id}.`);
    const image = new Image();
    image.src = `data:${variant.mimeType};base64,${variant.base64}`;
    await image.decode();
    images.set(story.id, image);
    sizes.set(story.id, { width: image.naturalWidth, height: image.naturalHeight });
  }
  const board = reactStoryBoardLayout(stories, presentation.index, (story) => sizes.get(story.id)!);
  const scale = Math.min(width / board.width, height / board.height);
  const left = (width - board.width * scale) / 2;
  const top = (height - board.height * scale) / 2;
  for (const [id, frame] of board.layouts) {
    context.drawImage(
      images.get(id)!,
      left + frame.x * scale,
      top + frame.y * scale,
      frame.width * scale,
      frame.height * scale,
    );
  }
  return output.toDataURL('image/png');
}

/**
 * A neutral, OPAQUE backdrop behind each story.
 *
 * Storybook's own default backdrop is white and most CSF files that care paint
 * their own (a decorator with `position:absolute; inset:0`), so this only shows
 * through where a story declares nothing. Opaque rather than transparent for a
 * mechanical reason as well: `capturePlayComposite` treats a canvas-less
 * capture that comes back mostly transparent as a torn `foreignObject` frame
 * and pays for two bounded retries before returning it.
 */
const STORY_BACKDROP = '#ffffff';

/** The sheet's gutter/letterbox colour — dark, so a white story cell reads as
 *  a cell rather than bleeding into the sheet. */
const SHEET_BACKDROP = '#14171c';

/**
 * Load one project CSF module and photograph each of its stories.
 *
 * Every refusal names the FILE, because the caller typed a path: a module the
 * project's own story scan does not know, a module that fails to import, a
 * module with no renderable stories, and a `--story` that names no export all
 * fail loudly rather than producing a plausible empty sheet.
 */
export async function captureProjectStoryVariants(
  project: StoryDiscoveryProject | null,
  options: StoryCaptureOptions,
): Promise<StoryVariantCapture> {
  const { modulePath, width, height } = options;
  if (!project) {
    throw new Error(
      `No project is open, so '${modulePath}' cannot be loaded. Open the project first.`,
    );
  }

  const discovered = await discoverProjectStories(project);
  const found = discovered.find((candidate) => candidate.modulePath === modulePath);
  if (!found) {
    throw new Error(
      `'${modulePath}' is not a story file of this project. ` +
        (discovered.length === 0
          ? 'This project has no *.stories.tsx / *.stories.ts under src/.'
          : `This project's story files are: ${discovered.map((s) => s.modulePath).join(', ')}.`),
    );
  }

  // The Stories panel applies the project's `.storybook/preview` annotations
  // through this same once-per-session latch before composing anything. Doing
  // it here too means a capture taken before the panel has ever opened is
  // composed identically to one taken after — not almost identically.
  await ensureProjectAnnotations(await loadProjectPreviewAnnotations(project));

  let mod: unknown;
  try {
    mod = await found.load();
  } catch (err) {
    throw new Error(
      `'${modulePath}' failed to import — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const composed = await composeProjectStories(modulePath, mod);
  if (!composed.ok) throw new Error(composed.error);

  const selected = selectStories(modulePath, composed.stories, options.story);
  const capture = options.capture ?? capturePlayComposite;
  const captureThree =
    options.captureThree ??
    (supportsThreeStoryCapture()
      ? (component: StoryPreviewComponent, size: { width: number; height: number }) =>
          captureStoryComponentThumbnail(component, {
            ...size,
            ...(options.camera === undefined ? {} : { camera: options.camera }),
            ...(options.pose === undefined ? {} : { pose: options.pose }),
          })
      : undefined);
  if ((options.camera || options.pose) && !captureThree) {
    throw new Error(
      `'${modulePath}': camera/clip parameters need the three capture leg, which this ` +
        'environment cannot provide (no WebGL).',
    );
  }
  const variants = await renderStoryVariants(modulePath, selected, {
    width,
    height,
    capture,
    ...(captureThree ? { captureThree } : {}),
    requireThree: Boolean(options.camera || options.pose),
  });
  const contactSheet = await composeVariantSheet(variants, width, height);
  return { modulePath, width, height, variants, contactSheet };
}

/** `--story <export>`, or every story in CSF export order. */
function selectStories(
  modulePath: string,
  stories: ComposedProjectStory[],
  story: string | undefined,
): ComposedProjectStory[] {
  if (story === undefined) return stories;
  const match = stories.find((candidate) => candidate.name === story);
  if (!match) {
    throw new Error(
      `'${modulePath}' exports no story named '${story}'. It exports: ` +
        `${stories.map((candidate) => candidate.name).join(', ')}.`,
    );
  }
  return [match];
}

/**
 * Mount each story offscreen, one at a time, and capture it.
 *
 * The host is `position: fixed` far off-screen with `contain: strict` — the
 * containment is load-bearing, not decoration: layout containment makes the
 * host the containing block for `position: fixed` descendants, so a HUD story
 * that pins itself to the viewport lands inside the capture box instead of
 * flashing across the editor the user is watching.
 */
export async function renderStoryVariants(
  modulePath: string,
  stories: readonly ComposedProjectStory[],
  options: {
    width: number;
    height: number;
    capture: (
      container: HTMLElement,
      captureOptions?: CaptureOptions,
    ) => Promise<{
      base64: string;
    }>;
    captureThree?: (
      component: StoryPreviewComponent,
      size: { width: number; height: number },
    ) => Promise<string>;
    /** Camera/clip parameters were requested: a story that cannot render on
     *  the three leg REFUSES by name instead of falling back to the DOM leg,
     *  which would silently ignore them. */
    requireThree?: boolean;
    /** Preserve the declared mount box for artboard/composition capture. */
    cropToContent?: boolean;
    layout?: string;
    transparent?: boolean;
  },
): Promise<StoryVariantImage[]> {
  const { width, height, capture, captureThree, requireThree, cropToContent = true } = options;
  const host = document.createElement('div');
  host.setAttribute(
    'style',
    `position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px;` +
      // The neutral backdrop lives HERE, behind the per-story container it
      // exactly covers — never inline on the container itself. That container
      // is a game-CSS scope root (`mountIsolatedStory` marks it), and an
      // inline background there outranks every rule in the game's own
      // stylesheet: a dark-themed game would get its white HUD text painted
      // onto the editor's white backdrop, correctly styled and unreadable.
      // Behind the container the backdrop still shows through wherever the
      // story paints nothing, which is all it was ever for.
      `overflow:hidden;contain:strict;pointer-events:none;background:${options.transparent ? 'transparent' : STORY_BACKDROP};`,
  );
  document.body.appendChild(host);
  const variants: StoryVariantImage[] = [];
  try {
    for (const story of stories) {
      // The three leg first (see the module doc comment): a prefab story is
      // R3F JSX that a DOM root can only render as a blank cell. ANY three
      // failure — the reconciler's qualification rejection for a DOM story,
      // or a genuine crash — falls through to the DOM leg, whose error
      // boundary is the containment that names a broken story in its cell.
      if (captureThree) {
        const three = await captureThree(story.Component as StoryPreviewComponent, {
          width,
          height,
        }).catch((error: unknown) => {
          // The DOM-story classification refusal falls through silently by design; a THREE
          // story that genuinely failed must be named here, or a broken prefab photographs
          // as a blank cell with no trace (the whole-project-blank-sheet defect).
          if (!isStoryThreeClassificationRefusal(error)) {
            // biome-ignore lint/suspicious/noConsole: the loud half of the fall-through contract — this refusal used to be swallowed whole.
            console.warn(
              `[story-capture] three mount for '${story.name}' failed — falling back to the DOM leg:`,
              error instanceof Error ? (error.stack ?? error.message) : String(error),
            );
          }
          return null;
        });
        if (three === null && requireThree) {
          throw new Error(
            `story '${story.name}' did not render on the three leg — ` +
              '--azimuth/--elevation/--distance/--clip/--time apply to three (R3F) stories ' +
              'only, and falling back to the DOM leg would silently ignore them. Narrow to a ' +
              'three story with --story <export>, or drop the camera/clip flags.',
          );
        }
        if (three !== null) {
          const comma = three.indexOf(',');
          variants.push({
            name: story.name,
            label: story.label,
            base64: comma >= 0 ? three.slice(comma + 1) : three,
            mimeType: 'image/png',
          });
          continue;
        }
      }
      // A FRESH container per export — see the module doc comment for why
      // reusing one would trip react-dom's double-`createRoot` warning.
      const container = document.createElement('div');
      container.setAttribute(
        'style',
        `position:relative;width:${width}px;height:${height}px;overflow:hidden;`,
      );
      if (options.layout === 'padded') container.style.padding = '16px';
      if (options.layout === 'centered') {
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'center';
      }
      container.style.boxSizing = 'border-box';
      host.replaceChildren(container);
      // Every `Application` this story's mount creates is collected, so the two
      // things a Pixi story's capture needs — a settled first frame, and a
      // readback the compositor cannot clear — can both be keyed on the MOUNT
      // rather than guessed from the story's source
      // (`canvas-preview-frames.ts` owns both, with the measurement).
      let storyApps: readonly Application[] = [];
      const mounted = await withApplicationCollector(async (apps) => {
        storyApps = apps;
        const handle = await mountIsolatedStory(container, modulePath, story.name, story.Component);
        await awaitStoryCommit(container);
        await awaitPixiStoryFrame(apps);
        return handle;
      });
      try {
        // Mount in the truth, frame the subject: the host is the full mount
        // box (the screen the story's anchors resolve against), the photograph
        // crops to what painted. A widget crops to the widget; a full screen's
        // painted union spans the frame and stays effectively full-frame.
        const shot = await capture(host, {
          canvasFrame: pixiCanvasFrame(storyApps),
          cropToContent,
          ...(options.transparent ? { allowTransparent: true } : {}),
        });
        variants.push({
          name: story.name,
          label: story.label,
          base64: shot.base64,
          mimeType: 'image/png',
        });
      } finally {
        mounted?.unmount();
        // `unmount()` defers its real teardown to a microtask (React refuses a
        // synchronous unmount from inside another root's commit); yield a full
        // turn so it has landed before the container is detached.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        container.remove();
      }
    }
  } finally {
    host.remove();
  }
  return variants;
}

/**
 * Wait for the isolated root's render to COMMIT before photographing it.
 *
 * `mountIsolatedStory` returns as soon as it has called `root.render()`, and
 * React schedules that work rather than performing it inline — so capturing on
 * the very next line photographs an empty container. That is not a
 * hypothetical — it has been observed in practice,
 * and it is the worst possible failure for a look verb, because a blank cell
 * rasterizes into a perfectly plausible sheet.
 *
 * Polls for committed child nodes rather than sleeping a guessed duration, so
 * the common case costs one turn. The bound is what a story that legitimately
 * renders `null` falls through — an empty capture is then the truth, not a
 * race.
 *
 * The FIRST child is not the last word: a story whose content arrives through
 * `lazy()` + `<Suspense>` commits its wrapper immediately and its screen when
 * the chunk lands — a translated port's scene UI is the shipped case, and the
 * capture used to photograph the fallback. So after the first commit this
 * waits for the subtree to go QUIET (no mutations for a settle window),
 * bounded — a story that animates forever is photographed mid-animation at the
 * ceiling rather than never.
 */
async function awaitStoryCommit(container: HTMLElement, maxTurns = 10): Promise<void> {
  for (let turn = 0; turn < maxTurns; turn++) {
    if (container.childNodes.length > 0) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (container.childNodes.length === 0) return;
  const QUIET_MS = 200;
  const CEILING_MS = 5_000;
  await new Promise<void>((resolve) => {
    let settle: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const observer = new MutationObserver(() => {
      if (settle !== null) clearTimeout(settle);
      settle = setTimeout(finish, QUIET_MS);
    });
    const ceiling = setTimeout(finish, CEILING_MS);
    function finish(): void {
      if (done) return;
      done = true;
      observer.disconnect();
      if (settle !== null) clearTimeout(settle);
      clearTimeout(ceiling);
      resolve();
    }
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    settle = setTimeout(finish, QUIET_MS);
  });
}

/**
 * Tile the captured variants into ONE labeled sheet — the same 2-column,
 * bitmap-labeled geometry the Asset Lab's four-view contact sheet and its
 * shot-set sheet already use (`asset-preview.ts`), so every sheet this repo
 * hands an agent reads the same way. A single variant gets a single cell
 * rather than a half-empty grid.
 */
export async function composeVariantSheet(
  variants: readonly StoryVariantImage[],
  width: number,
  height: number,
  options: { readonly labels?: boolean; readonly columns?: number } = {},
): Promise<{ width: number; height: number; base64: string; mimeType: 'image/png' }> {
  const columns = Math.min(
    Math.max(1, variants.length),
    Math.max(1, Math.floor(options.columns ?? 2)),
  );
  const rows = Math.max(1, Math.ceil(variants.length / columns));
  // Cells fit the variants, not the mount box: a cropped-to-content variant is
  // its own size, so the cell is the largest variant (falling back to the
  // mount box for an empty sheet) and each image draws centered at 1:1 —
  // stretching a cropped widget to a screen-shaped cell would undo the crop.
  const images: HTMLImageElement[] = [];
  for (const variant of variants) {
    const image = new Image();
    image.src = `data:${variant.mimeType};base64,${variant.base64}`;
    await image.decode();
    images.push(image);
  }
  const cellWidth = Math.max(
    1,
    ...images.map((one) => one.naturalWidth),
    images.length ? 0 : width,
  );
  const cellHeight = Math.max(
    1,
    ...images.map((one) => one.naturalHeight),
    images.length ? 0 : height,
  );
  const sheetWidth = cellWidth * columns;
  const sheetHeight = cellHeight * rows;
  const canvas = document.createElement('canvas');
  canvas.width = sheetWidth;
  canvas.height = sheetHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create the story variant sheet.');
  context.fillStyle = SHEET_BACKDROP;
  context.fillRect(0, 0, sheetWidth, sheetHeight);

  for (const [index, variant] of variants.entries()) {
    const x = (index % columns) * cellWidth;
    const y = Math.floor(index / columns) * cellHeight;
    const image = images[index]!;
    context.drawImage(
      image,
      x + Math.floor((cellWidth - image.naturalWidth) / 2),
      y + Math.floor((cellHeight - image.naturalHeight) / 2),
    );
    if (options.labels !== false)
      drawBitmapLabel(context, variant.name.toUpperCase(), x, y, cellWidth, cellHeight);
  }

  const dataUrl = canvas.toDataURL('image/png');
  const comma = dataUrl.indexOf(',');
  return {
    width: sheetWidth,
    height: sheetHeight,
    base64: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
    mimeType: 'image/png',
  };
}
