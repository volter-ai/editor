/**
 * THE DECLARED PRESENTATION SURFACE — the one door for "what is this game
 * presented on, and which element carries its pixels".
 *
 * ARCHITECTURE-CORE §The editor protocol, "Zero inference": read a declaration,
 * walk ground truth, or diagnose declared-vs-measured drift — never guess a
 * fact the game's author (or, here, the HOST'S OWN MOUNT) already stated. Three
 * capture-side readers were guessing:
 *
 *   · `composite-screenshot.ts` counted `<canvas>` children to decide whether
 *     the subject is a DOM-only medium and therefore needs the compositor
 *     settle window;
 *   · `play-mode.ts`'s `getPlayCanvas` took the FIRST `<canvas>` in DOM order
 *     as "the game canvas" — a guess about authoring order that a game with a
 *     minimap, an offscreen buffer, or a 2D overlay quietly loses;
 *   · `command-listener.ts`'s screenshot staleness gate skipped itself when no
 *     canvas was found, i.e. inferred "React-only root" from a DOM absence.
 *
 * Every one of those facts is DECLARED somewhere already:
 *
 *   · the MEDIUM is the adapter's region table (`project-adapter.ts`) — a
 *     region's `surface` is a first-party statement about what the host hands
 *     that root;
 *   · a HOST-MOUNTED root's canvas is stamped with its root id by the mount
 *     that created it (`create-runtime.ts`, `data-vgai-root-id`);
 *   · a SELF-BOOTING game's canvas is its own, so its contract declares it
 *     (`window.vgaiGame.presentation`), and the ingest mount records it here.
 *
 * The measured answers all remain, because a game that declares nothing must
 * keep working — but they are REPORTED as measured (`source`), so "nobody
 * stated this" is a visible fact instead of an invisible default.
 */

import {
  type AdapterRegion,
  type AdapterRegionBasis,
  NATIVE_REGION_BASIS,
} from '@volter/editor-project/adapter/adapter-module';

/** Where an answer came from. `none` = there is no answer at all, which is
 *  deliberately distinct from a measured one. */
export type PresentationSource = 'declared' | 'measured' | 'none';

/** What the game is presented ON. `unknown` means no adapter table has loaded
 *  yet — "nobody looked", never "it has no canvas". */
export type PresentationMedium = 'canvas' | 'dom' | 'unknown';

export interface PresentationSurfaceReading {
  /** The element carrying the game's pixels, or `null` for a DOM-only game (or
   *  before anything mounted). */
  readonly canvas: HTMLCanvasElement | null;
  /** How {@link canvas} was answered. */
  readonly source: PresentationSource;
  /** The root the surface belongs to, when the answer named one. */
  readonly rootId: string | null;
  /** What the ADAPTER declares this project is presented on. */
  readonly medium: PresentationMedium;
}

/** The host stamp `create-runtime.ts` writes on every surface it mounts. */
const ROOT_ID_ATTRIBUTE = 'data-vgai-root-id';

/**
 * Presentation elements a SELF-BOOTING game owns, keyed by root id — the
 * ingest mount records one per mounted game and drops it on teardown. Most are
 * canvases; CSS3DRenderer truthfully contributes a DOM element and `canvas: null`.
 *
 * RESOURCE OWNERSHIP: the ingest mount path that recorded an entry
 * (`authoring/ingest-root-adapter.ts`) is the only party that clears it, in its
 * own teardown. Nothing else writes this map, and a stale entry cannot outlive
 * its mount, because the reading below also requires the canvas to still be
 * inside the container it is asked about.
 */
const _selfBooting = new Map<
  string,
  {
    element: HTMLElement;
    canvas: HTMLCanvasElement | null;
    source: 'declared' | 'measured';
  }
>();

/**
 * Record the element a self-booting game presents on.
 *
 * `source` is the honesty: `declared` when the game's own contract named it
 * (`window.vgaiGame.presentation`), `measured` when the host took the captured
 * renderer's `domElement` — which is a real measurement off the render trap,
 * not a DOM-order guess, but still not a statement by the game.
 */
export function recordPresentationSurface(
  rootId: string,
  element: HTMLElement,
  source: 'declared' | 'measured',
): void {
  const canvas = element.tagName === 'CANVAS' ? (element as HTMLCanvasElement) : null;
  _selfBooting.set(rootId, { element, canvas, source });
}

/** Drop one mount's recorded surface — what its teardown calls. */
export function clearPresentationSurface(rootId: string): void {
  _selfBooting.delete(rootId);
}

/** Test seam: drop every recorded surface and the published region table. */
export function __resetPresentationSurfacesForTest(): void {
  _selfBooting.clear();
  _regions = [];
}

/**
 * The loaded adapter's regions, PUSHED here by their one owner rather than
 * pulled from it.
 *
 * `project-adapter.ts` publishes the resolved table and calls this from the
 * same `publish`, so there is still exactly one place regions are decided. The
 * direction matters: this module is read from inside the ingest mount and from
 * `play-mode.ts`, and importing the adapter loader would drag its whole
 * transitive graph (editor API, project manager, story registry, the ingest
 * registry) into both. A one-line push keeps this module dependency-free apart
 * from an engine TYPE — which is also what makes it testable without standing
 * up a project.
 */
let _regions: readonly AdapterRegion[] = [];

export function setPresentationRegions(regions: readonly AdapterRegion[]): void {
  _regions = regions;
}

/** The adapter's regions — the manifest allows at most one per medium. */
function contentRegions(): readonly AdapterRegion[] {
  return _regions;
}

/**
 * The world basis the loaded adapter declares for `surface`'s CONTENT region —
 * "which way is up in this game, and where is its ground". The gizmo viewport's
 * ground-plane raycast (asset drop, nav probe) reads it instead of the `y = 0`
 * constant it used to compile in (ARCHITECTURE-CORE §The editor protocol,
 * "Zero inference").
 *
 * It lives HERE, on the pushed region table, and not on the loader that fills
 * it, for the same reason {@link presentationSurface} does: the viewport is a
 * surface below the shell, and importing `project-adapter.ts` to ask one
 * question about one region drags the whole loader graph (editor API, project
 * manager, story registry, the ingest registry) into it — measured at 121 files
 * for a two-line read. The push already delivered the answer; this is the
 * reader beside it.
 *
 * Before the first load, and for a region that declares no basis, the answer is
 * {@link NATIVE_REGION_BASIS} — the declared native default, which
 * `regionsFromManifestRoots` publishes outright.
 */
export function presentationRegionBasis(surface: AdapterRegion['surface']): AdapterRegionBasis {
  return _regions.find((entry) => entry.surface === surface)?.basis ?? NATIVE_REGION_BASIS;
}

/**
 * What the ADAPTER declares this project is presented on.
 *
 * `three` and `canvas` regions are handed a canvas by the host; a `dom` region
 * is handed a DOM container. A project with both is `canvas` — the canvas is
 * where the game's pixels are, and the HUD rides over it.
 */
function presentationMedium(container: HTMLElement | null): PresentationMedium {
  const regions = contentRegions();
  if (regions.length === 0) return 'unknown';
  return regions.some((region) => {
    if (region.surface === 'dom') return false;
    const measured = _selfBooting.get(region.id);
    return (
      !measured || measured.canvas !== null || !container || !holds(container, measured.element)
    );
  })
    ? 'canvas'
    : 'dom';
}

/**
 * A container is only queryable if it really is an element.
 *
 * The play container reaches here from several routes, and the relay's own
 * harnesses hand in stand-ins that implement exactly the members the old reader
 * touched. Every DOM read below is therefore capability-checked rather than
 * assumed: a container that cannot answer a question contributes nothing to the
 * reading, which lands on `source: 'none'` — the honest answer, and the one that
 * leaves each caller's own degrade path (the canvas-only capture leg, the
 * screenshot's named refusal) exactly where it was.
 */
function holds(container: HTMLElement, element: HTMLElement): boolean {
  return typeof container.contains === 'function' && container.contains(element);
}

/** The declared-canvas legs, in precedence order, or `null` when none answers. */
function declaredCanvas(
  container: HTMLElement,
): { canvas: HTMLCanvasElement; rootId: string } | null {
  // 1. A self-booting game's own declaration wins outright.
  for (const [rootId, entry] of _selfBooting) {
    if (entry.canvas && entry.source === 'declared' && holds(container, entry.canvas)) {
      return { canvas: entry.canvas, rootId };
    }
  }
  // 2. A host-mounted root's canvas carries the id of the root it presents —
  //    stamped by the mount that made it, so this is a read, not a search for
  //    something canvas-shaped.
  const stamped =
    typeof container.querySelectorAll === 'function'
      ? Array.from(container.querySelectorAll<HTMLCanvasElement>(`canvas[${ROOT_ID_ATTRIBUTE}]`))
      : [];
  for (const region of contentRegions()) {
    if (region.surface === 'dom') continue;
    const match = stamped.find((canvas) => canvas.dataset['vgaiRootId'] === region.id);
    if (match) return { canvas: match, rootId: region.id };
  }
  return null;
}

/**
 * Resolve the presentation surface inside `container`.
 *
 * Declaration first, measured fallback SECOND AND LABELLED. The fallback is
 * still first-canvas-in-DOM-order — deliberately unchanged, because a game that
 * declares nothing must behave exactly as it did — but it now arrives as
 * `source: 'measured'` wherever it is reported, so the guess is legible.
 */
export function presentationSurface(container: HTMLElement | null): PresentationSurfaceReading {
  const medium = presentationMedium(container);
  if (!container) return { canvas: null, source: 'none', rootId: null, medium };
  const declared = declaredCanvas(container);
  if (declared) {
    return { canvas: declared.canvas, source: 'declared', rootId: declared.rootId, medium };
  }
  // A self-booting game whose contract declared nothing: the host's own
  // measurement (the captured renderer's element) still beats a DOM sweep.
  for (const [rootId, entry] of _selfBooting) {
    if (entry.canvas && holds(container, entry.canvas)) {
      return { canvas: entry.canvas, source: 'measured', rootId, medium };
    }
    if (holds(container, entry.element)) {
      return { canvas: null, source: entry.source, rootId, medium };
    }
  }
  const first =
    typeof container.querySelector === 'function' ? container.querySelector('canvas') : null;
  if (first) return { canvas: first, source: 'measured', rootId: null, medium };
  return { canvas: null, source: 'none', rootId: null, medium };
}
