import { themeVars, zIndex } from '@volter/editor-sdk/widgets';
import {
  REACT_STORY_TRANSPARENCY_BASE,
  reactStoryTransparencyBackground,
} from './react-design-canvas-style';
import {
  applyStoryChrome,
  FRAME_LABEL_GAP as FLOATING_LABEL_GAP,
  FRAME_LABEL_HEIGHT as FLOATING_LABEL_HEIGHT,
  GROUP_LABEL_GAP,
  GROUP_LABEL_HEIGHT,
  placeStoryChrome,
} from './story-board-chrome-fit';
import type {
  ResolvedStoryPresentation,
  StoryBoardPresentation,
  StoryPresentationIndex,
} from './story-board-presentation';
import { getRootCanvasViewport, subscribeRootCanvasViewport } from './world-canvas-viewport-state';
import { getRootPan, setRootView, subscribeRootPan } from './world-pan-state';

const DEFAULT_FRAME_WIDTH = 640;
const DEFAULT_FRAME_HEIGHT = 400;
const BOARD_PADDING = 64;
const FRAME_GAP = 64;
const VIEW_PADDING = 72;
/** Below this client width a truncated frame title is visual noise. */
const MIN_FRAME_LABEL_WIDTH = 28;

/** Vertical space between two group blocks — the ordinary frame gap plus the
 *  chrome that sits above the next block (its group label and its frames'
 *  own floating labels). Never applied to a single-group board, which is why
 *  an ungrouped project lays out byte-for-byte as it did before grouping. */
const GROUP_BLOCK_GAP =
  FRAME_GAP + GROUP_LABEL_HEIGHT + GROUP_LABEL_GAP + FLOATING_LABEL_HEIGHT + FLOATING_LABEL_GAP;

export interface ReactStoryBoardStory {
  readonly id: string;
  readonly label: string;
  readonly modulePath: string;
  /** Composed CSF meta title when the module authored one. Organization input
   *  only (`authoring/story-board-presentation.ts`). */
  readonly title?: string | undefined;
  readonly parameters?: Readonly<Record<string, unknown>> | undefined;
  readonly globals?: Readonly<Record<string, unknown>> | undefined;
  readonly viewportLocked?: boolean | undefined;
  /**
   * The frame's own size in authored px, for a story that BAKES its cell.
   *
   * A dom story omits it: its frame is a Storybook viewport (or the shared
   * responsive preset), which is what makes a UI frame a phone or a desktop.
   * A canvas story supplies the content-bounds frame resolved by its native
   * board — so the shared substrate uses that exact authored-space rectangle
   * rather than scaling it into a default UI viewport. See
   * `@vgai/canvas`'s `canvas-board/CanvasBoardDocument.tsx`.
   */
  readonly frameSize?: { readonly width: number; readonly height: number } | undefined;
}

/** One component section: its named story frames, in Storybook order. */
interface BoardGroup {
  readonly key: string;
  readonly label: string;
  readonly stories: ReactStoryBoardStory[];
}

/** Project the shared Storybook index into component sections. */
function groupStories(
  stories: readonly ReactStoryBoardStory[],
  index: StoryPresentationIndex,
): BoardGroup[] {
  const byId = new Map(stories.map((story) => [story.id, story]));
  return index.sections.map((section) => ({
    key: section.id,
    label: section.label,
    stories: section.storyIds.flatMap((storyId) => {
      const story = byId.get(storyId);
      return story ? [story] : [];
    }),
  }));
}

const pathSegments = (path: string): string[] =>
  path
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
interface BoardBlock {
  key: string;
  label: string | null;
  stories: ReactStoryBoardStory[];
}
function boardBlocks(groups: readonly BoardGroup[]): BoardBlock[] {
  const soloSections = new Set(
    groups.filter((group) => group.stories.length === 1).map((group) => group.key),
  );
  const blocks: BoardBlock[] = [];
  {
    const byCategory = new Map<string, BoardBlock>();
    for (const group of groups) {
      if (!soloSections.has(group.key)) {
        blocks.push({ key: group.key, label: group.label, stories: [...group.stories] });
        continue;
      }
      const category = pathSegments(group.label).slice(0, -1).join('/');
      let block = byCategory.get(category);
      if (!block) {
        block = { key: `category:${category}`, label: category || null, stories: [] };
        byCategory.set(category, block);
        blocks.push(block);
      }
      block.stories.push(...group.stories);
    }
  }

  return blocks;
}

/** Shared authored-space placement for the board and its chrome-free preview. */
export function reactStoryBoardLayout(
  stories: readonly ReactStoryBoardStory[],
  index: StoryPresentationIndex,
  presentationFor: (story: ReactStoryBoardStory) => { width: number; height: number },
) {
  const blocks = boardBlocks(groupStories(stories, index));
  const layouts = new Map<string, FrameLayout>();
  const groupOrigins = new Map<string, { x: number; y: number; roomAbove: number }>();
  let blockTop = BOARD_PADDING;
  let widestBlock = 0;

  // One block per BoardBlock (see the blocks derivation above): variant
  // sections as themselves, solo cards in shared category grids.
  blocks.forEach((group, blockIndex) => {
    const columns = Math.max(1, Math.ceil(Math.sqrt(group.stories.length)));
    const rows = Math.ceil(group.stories.length / columns);
    const presentations = group.stories.map((story) => presentationFor(story));
    const columnWidths = Array.from({ length: columns }, () => 0);
    const rowHeights = Array.from({ length: rows }, () => 0);
    presentations.forEach((presentation, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      columnWidths[column] = Math.max(columnWidths[column]!, presentation.width);
      rowHeights[row] = Math.max(rowHeights[row]!, presentation.height);
    });
    const columnX = columnWidths.map((_, column) =>
      columnWidths.slice(0, column).reduce((sum, width) => sum + width + FRAME_GAP, 0),
    );
    const rowY = rowHeights.map((_, row) =>
      rowHeights.slice(0, row).reduce((sum, height) => sum + height + FRAME_GAP, 0),
    );
    // Nothing sits above the board's very first row, so its chrome is never
    // constrained; every later block sits one block gap below its predecessor.
    // An unlabeled block carries no group title, so it borrows only the room
    // its own frame labels need.
    const blockRoom =
      blockIndex === 0
        ? Number.POSITIVE_INFINITY
        : group.label !== null
          ? GROUP_BLOCK_GAP
          : FRAME_GAP + FLOATING_LABEL_HEIGHT + FLOATING_LABEL_GAP;
    if (group.label !== null) {
      groupOrigins.set(group.key, { x: BOARD_PADDING, y: blockTop, roomAbove: blockRoom });
    }

    group.stories.forEach((story, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const presentation = presentations[index]!;
      const { width, height } = presentation;
      const x = BOARD_PADDING + columnX[column]!;
      const y = blockTop + rowY[row]!;
      layouts.set(story.id, {
        x,
        y,
        width,
        height,
        roomAbove: row === 0 ? blockRoom : FRAME_GAP,
        withGroupLabel: blocks.length > 1 && row === 0 && group.label !== null,
      });
    });

    const blockWidth =
      columnWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, columns - 1) * FRAME_GAP;
    const blockHeight =
      rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, rows - 1) * FRAME_GAP;
    widestBlock = Math.max(widestBlock, blockWidth);
    blockTop += blockHeight + GROUP_BLOCK_GAP;
  });

  const boardWidth = BOARD_PADDING * 2 + widestBlock;
  const boardHeight = blockTop - GROUP_BLOCK_GAP + BOARD_PADDING;

  return { layouts, groupOrigins, width: boardWidth, height: stories.length ? boardHeight : 0 };
}

export interface ReactStoryBoardFrame {
  readonly element: HTMLElement;
  readonly content: HTMLElement;
}

export type ReactStoryBoardSelectionIntent = 'highlight' | 'zoom';

interface FrameLayout {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Authored px between this frame's top edge and the bottom edge of the
   *  frames above it — `Infinity` on the board's own first row. Multiplied by
   *  zoom it is the client-space room the floating chrome must fit into. */
  readonly roomAbove: number;
  /** True on the first row of a block on a grouped board: that row's chrome
   *  stack also carries the group name, which is served first. */
  readonly withGroupLabel: boolean;
}

export interface ReactStoryBoard {
  readonly element: HTMLElement;
  readonly frames: ReadonlyMap<string, ReactStoryBoardFrame>;
  activeContent(): HTMLElement;
  activate(storyId: string, focus?: boolean): void;
  clearError(storyId: string): void;
  fitAll(): void;
  selectAtClientPoint(clientX: number, clientY: number): boolean;
  zoomAtClientPoint(clientX: number, clientY: number): boolean;
  setError(storyId: string, message: string): void;
  /**
   * Present the story's MEASURED content rectangle as its cell — the dom
   * lane's version of the canvas exhibit's content-bounds frame + crop. The
   * mount keeps its declared-viewport harness; the frame becomes a window
   * onto `offset → offset + frame`. `null` restores the declared
   * presentation. The caller (design-time-layers) measures after each mount;
   * a `fullscreen` story never gets one.
   */
  setMeasuredFrame(
    storyId: string,
    measured: {
      frame: { width: number; height: number };
      mount: { width: number; height: number };
      offset: { x: number; y: number };
    } | null,
  ): void;
  /** Show (non-empty) or clear (`null`) the self-explanation on EVERY card —
   *  the condition it reports is a project-level fact, never a per-story one. */
  setNote(message: string | null): void;
  viewport(): ReactStoryBoardViewportState;
  setViewport(viewportId: string | null): void;
  setRotation(rotated: boolean): void;
  dispose(): void;
}

export interface ReactStoryBoardViewportState {
  readonly storyId: string;
  readonly selectedViewportId: string | null;
  readonly locked: boolean;
  readonly rotated: boolean;
  readonly choices: ResolvedStoryPresentation['choices'];
}

const boardsByContainer = new WeakMap<HTMLElement, ReactStoryBoard>();
const boardViewportListeners = new Set<() => void>();
const EMPTY_BOARD_VIEWPORT: ReactStoryBoardViewportState | null = null;

function notifyBoardViewport(): void {
  for (const listener of boardViewportListeners) listener();
}

export function subscribeReactStoryBoardViewport(listener: () => void): () => void {
  boardViewportListeners.add(listener);
  return () => boardViewportListeners.delete(listener);
}

/**
 * The active board's frame placements in BOARD coordinates (the unzoomed
 * layer pixels `layout()` writes to each frame's `style.left/top`) — what
 * "Materialize pasteboard" reads to turn the DERIVED auto-grid into AUTHORED
 * `<At x y>` literals. Null when the container holds no board.
 */
export function reactStoryBoardFramePlacements(
  element: HTMLElement | null,
): Array<{ storyId: string; x: number; y: number }> | null {
  // Boards register under the layer's PARENT (`createReactStoryBoard`'s
  // `container`), while the queryable marker sits on the layer itself —
  // accept either, so a caller holding `[data-vgai-react-story-board]` works.
  const board = element
    ? (boardsByContainer.get(element) ??
      (element.parentElement ? boardsByContainer.get(element.parentElement) : undefined))
    : undefined;
  if (!board) return null;
  const placements: Array<{ storyId: string; x: number; y: number }> = [];
  for (const [storyId, frame] of board.frames) {
    placements.push({
      storyId,
      x: Math.round(Number.parseFloat(frame.element.style.left) || 0),
      y: Math.round(Number.parseFloat(frame.element.style.top) || 0),
    });
  }
  return placements;
}

export function getReactStoryBoardViewport(
  container: HTMLElement | null,
): ReactStoryBoardViewportState | null {
  return container ? (boardsByContainer.get(container)?.viewport() ?? EMPTY_BOARD_VIEWPORT) : null;
}

export function setActiveReactStoryBoardViewport(
  container: HTMLElement | null,
  viewportId: string | null,
): boolean {
  const board = container ? boardsByContainer.get(container) : undefined;
  if (!board) return false;
  board.setViewport(viewportId);
  return true;
}

export function toggleActiveReactStoryBoardViewportRotation(
  container: HTMLElement | null,
): boolean {
  const board = container ? boardsByContainer.get(container) : undefined;
  if (!board || board.viewport().locked) return false;
  board.setRotation(!board.viewport().rotated);
  return true;
}

function fallbackFrameSize(): { width: number; height: number } {
  const viewport = getRootCanvasViewport();
  return {
    width: viewport.width ?? DEFAULT_FRAME_WIDTH,
    height: viewport.height ?? DEFAULT_FRAME_HEIGHT,
  };
}

function fitBounds(
  container: HTMLElement,
  bounds: { x: number; y: number; width: number; height: number },
  maximumZoom: number,
): void {
  if (bounds.width <= 0 || bounds.height <= 0) return;
  const availableWidth = Math.max(1, container.clientWidth - VIEW_PADDING * 2);
  const availableHeight = Math.max(1, container.clientHeight - VIEW_PADDING * 2);
  const zoom = Math.min(
    maximumZoom,
    Math.max(0.1, Math.min(availableWidth / bounds.width, availableHeight / bounds.height)),
  );
  setRootView(
    container.clientWidth / 2 - (bounds.x + bounds.width / 2) * zoom,
    container.clientHeight / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  );
}

/** Fit the board hosted by `container`, if it has one. Used by viewport chrome. */
export function fitReactStoryBoard(container: HTMLElement): boolean {
  const board = boardsByContainer.get(container);
  if (!board) return false;
  board.fitAll();
  return true;
}

/** Focus an inactive story frame from a canvas pointer press. Returns true
 * only when the point was inside an inactive frame and its story-selection
 * callback was dispatched. The selection overlay uses this to give the whole
 * frame—not only its small label—the expected Figma-style click target. */
export function selectReactStoryFrameAtPoint(
  container: HTMLElement | null,
  clientX: number,
  clientY: number,
): boolean {
  if (!container) return false;
  return boardsByContainer.get(container)?.selectAtClientPoint(clientX, clientY) ?? false;
}

/** Zoom to the story frame under a canvas double-click. Unlike single-click
 * selection, this also handles the already-active frame so recentering never
 * requires a hierarchy round trip. */
export function zoomReactStoryFrameAtPoint(
  container: HTMLElement | null,
  clientX: number,
  clientY: number,
): boolean {
  if (!container) return false;
  return boardsByContainer.get(container)?.zoomAtClientPoint(clientX, clientY) ?? false;
}

/**
 * Editor-only Figma-style canvas over a set of CSF stories — THE board
 * substrate, not a dom-only one. Every story owns an isolated frame; the active
 * frame is only the authoring focus, never a runtime state.
 *
 * Two boards mount it, and the difference between them is membership and what
 * goes IN a frame, never layout: the `UI`/`Dev` boards
 * (`design-time-layers.ts`) mount each dom story's React render into
 * `frames.get(id).content`, and Play tears that whole board down before
 * mounting the root's real manifest entry; the `2D` board
 * (`@vgai/canvas`'s `canvas-board/CanvasBoardDocument.tsx`) puts each canvas story's own mounted
 * Pixi host in the same place, cropped to the mounted stage's content bounds.
 * A frame is DOM either way — a canvas story renders a `<canvas>`, which is
 * why it is an ordinary frame here and not a second board engine.
 */
export function createReactStoryBoard(
  layer: HTMLElement,
  stories: readonly ReactStoryBoardStory[],
  initialStoryId: string,
  onStorySelected: (storyId: string, intent: ReactStoryBoardSelectionIntent) => void,
  // INJECTED, not defaulted (`authoring/story-board-presentation.ts`): the
  // board is host chrome's substrate and must not import the CSF
  // implementation that organizes and sizes the frames. `resolve` is called
  // INSIDE the layout pass below, per story and per viewport override, so a
  // caller cannot pre-compute the answers and hand over a table.
  presentation: StoryBoardPresentation,
): ReactStoryBoard {
  if (stories.length === 0) throw new Error('A React story board requires at least one story.');

  const container = layer.parentElement;
  if (!container) throw new Error('A React story board layer must be attached before mounting.');

  layer.dataset['vgaiReactStoryBoard'] = 'true';
  // The board may be larger than the visible document. Individual story
  // frames provide their own layout/paint containment for fixed-position UI.
  layer.style.contain = 'none';

  const boardElement = document.createElement('div');
  boardElement.dataset['testid'] = 'react-story-board';
  boardElement.dataset['vgaiReactStoryBoardCanvas'] = 'true';
  boardElement.style.position = 'absolute';
  boardElement.style.left = '0';
  boardElement.style.top = '0';
  boardElement.style.transformOrigin = '0 0';
  layer.appendChild(boardElement);

  // Labels are editor chrome, not game DOM. Keep them in a synchronized
  // sibling above RootSelectionOverlay (z=overlayLow), otherwise that
  // full-cover interaction layer correctly used for DOM picking intercepts
  // every label click before it reaches the board.
  const chromeElement = document.createElement('div');
  chromeElement.dataset['testid'] = 'react-story-board-chrome';
  chromeElement.dataset['vgaiStoryBoardChromeFor'] = layer.dataset['worldId'] ?? '';
  chromeElement.style.position = 'absolute';
  chromeElement.style.inset = '0';
  chromeElement.style.zIndex = String(zIndex.sticky);
  chromeElement.style.display = layer.style.display || 'block';
  chromeElement.style.pointerEvents = 'none';
  chromeElement.style.overflow = 'visible';
  container.appendChild(chromeElement);

  const frames = new Map<string, ReactStoryBoardFrame>();
  const errors = new Map<string, HTMLElement>();
  const notes = new Map<string, HTMLElement>();
  const labels = new Map<string, HTMLButtonElement>();
  const layouts = new Map<string, FrameLayout>();
  // The dom lane's transcription of the canvas board's exhibit model
  // (`canvas-board-model.ts`): the MOUNT is a harness at the story's declared
  // viewport — the box its anchors resolve against — while the FRAME presents
  // the measured content rectangle inside it. Filled per story by the owner
  // (design-time-layers) after each mount; a story whose presentation is
  // `fullscreen` never gets an entry and presents its whole declared box.
  const measuredFrames = new Map<
    string,
    {
      frame: { width: number; height: number };
      mount: { width: number; height: number };
      offset: { x: number; y: number };
    }
  >();
  // Organization is presentation-only and fixed for the board's lifetime.
  // A board with one component needs no redundant section label.
  const groups = groupStories(stories, presentation.index);
  const groupLabels = new Map<string, HTMLElement>();
  const groupOrigins = new Map<string, { x: number; y: number; roomAbove: number }>();
  const viewportOverrides = new Map<string, string | null>();
  const rotationOverrides = new Map<string, boolean>();
  let viewportSnapshot: ReactStoryBoardViewportState;
  let activeStoryId = stories.some((story) => story.id === initialStoryId)
    ? initialStoryId
    : stories[0]!.id;
  let disposed = false;
  let pendingFit = false;

  const presentationFor = (story: ReactStoryBoardStory): ResolvedStoryPresentation => {
    const resolved = presentation.resolve(
      story,
      story.frameSize ?? fallbackFrameSize(),
      viewportOverrides.has(story.id) ? viewportOverrides.get(story.id) : undefined,
      rotationOverrides.get(story.id),
    );
    // A measured content frame wins the CELL: the board cell is the subject's
    // rectangle, not the whole mount harness. Same `fullscreen` collapse as an
    // exact `frameSize` below, and for the same reason — the measured
    // rectangle already owns its inset.
    const measured = measuredFrames.get(story.id);
    if (measured) {
      return {
        ...resolved,
        width: measured.frame.width,
        height: measured.frame.height,
        layout: 'fullscreen',
      };
    }
    // A story that supplies an exact frame already owns its inset/crop.
    // A `padded` default layout would add a second inset inside that measured
    // rectangle, so the content would sit clipped and off-centre. Nothing else
    // about the presentation changes — a viewport the story really authored
    // still wins the size above.
    return story.frameSize ? { ...resolved, layout: 'fullscreen' } : resolved;
  };

  const updateViewportSnapshot = (): void => {
    const presentation = presentationFor(stories.find((story) => story.id === activeStoryId)!);
    viewportSnapshot = {
      storyId: activeStoryId,
      selectedViewportId: presentation.selectedViewportId,
      locked: presentation.locked,
      rotated: presentation.rotated,
      choices: presentation.choices,
    };
  };
  updateViewportSnapshot();

  // The board's presented hierarchy is Category → Component → Variant, and a
  // SINGLE-variant component folds only its variant level away. Generated
  // projects emit one `Default` export per component module, so componentized
  // sections would otherwise render a section title above every card AND a
  // "Default" label on it — a section per frame, twice-labeled, one row each.
  // The solo card takes its component's name (the title path's last segment)
  // and joins its CATEGORY's block — the path minus that segment ("Prefabs",
  // "UI/Screens") — so the categories the titles author remain the board's
  // grouping. A section with real variants keeps its own titled block and its
  // variant labels, which is the shape the two-level names exist for.
  const soloSections = new Set(
    groups.filter((group) => group.stories.length === 1).map((group) => group.key),
  );
  const pathSegments = (path: string): string[] =>
    path
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);
  const presentedLabels = new Map<string, string>();
  for (const group of groups) {
    for (const story of group.stories) {
      const componentName =
        (story.title ? pathSegments(story.title).at(-1) : undefined) ??
        pathSegments(group.label).at(-1);
      presentedLabels.set(
        story.id,
        soloSections.has(group.key) ? (componentName ?? story.label) : story.label,
      );
    }
  }

  /** Layout/label blocks: variant sections as themselves, solo sections merged
   *  per category (order of first appearance; a pathless category is an
   *  unlabeled block). Fixed for the board's lifetime, like the groups. */
  const blocks = boardBlocks(groups);

  for (const story of groups.flatMap((group) => group.stories)) {
    const frame = document.createElement('section');
    frame.dataset['testid'] = 'react-story-frame';
    frame.dataset['storyId'] = story.id;
    frame.dataset['storyLabel'] = story.label;
    frame.dataset['storyGroup'] =
      presentation.index.sections.find((section) => section.storyIds.includes(story.id))?.label ??
      '';
    frame.style.position = 'absolute';
    frame.style.border = `1px solid ${themeVars.boundary.strong}`;
    frame.style.borderRadius = '0';
    // The transparency checkerboard lives on the FRAME, behind the content box
    // it exactly covers — never as an inline background on `content` itself.
    // `content` is a game-CSS scope root (`scoped-game-css.ts`), and an inline
    // background there beats every rule in the game's own stylesheet, so a
    // game whose `body` paints an opaque backdrop would have shown the
    // editor's checkerboard through its own HUD. Behind the content box the
    // checkerboard still shows through wherever the story authors nothing,
    // which is the whole thing it is for.
    frame.style.backgroundColor = REACT_STORY_TRANSPARENCY_BASE;
    frame.style.backgroundImage = reactStoryTransparencyBackground();
    frame.style.backgroundPosition = '0 0, 8px 8px';
    frame.style.backgroundSize = '16px 16px';
    frame.style.boxShadow = 'none';

    const label = document.createElement('button');
    label.type = 'button';
    label.dataset['testid'] = 'react-story-frame-label';
    label.dataset['storyId'] = story.id;
    label.title = `${presentedLabels.get(story.id) ?? story.label} — click to select, double-click to zoom — ${story.modulePath}`;
    label.textContent = presentedLabels.get(story.id) ?? story.label;
    label.style.position = 'absolute';
    label.style.height = `${FLOATING_LABEL_HEIGHT}px`;
    label.style.padding = '0 2px';
    label.style.border = '0';
    label.style.appearance = 'none';
    label.style.background = 'transparent';
    label.style.color = themeVars.content.primary;
    label.style.font = `600 12px ${themeVars.typography.sans}`;
    label.style.lineHeight = `${FLOATING_LABEL_HEIGHT}px`;
    label.style.textAlign = 'left';
    label.style.cursor = 'default';
    label.style.pointerEvents = 'auto';
    label.style.whiteSpace = 'nowrap';
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';
    label.style.width = 'max-content';
    label.addEventListener('click', () => onStorySelected(story.id, 'highlight'));
    label.addEventListener('dblclick', () => onStorySelected(story.id, 'zoom'));

    const content = document.createElement('div');
    content.dataset['testid'] = 'react-story-frame-content';
    content.dataset['storyId'] = story.id;
    content.style.position = 'absolute';
    content.style.left = '0';
    content.style.top = '0';
    content.style.overflow = 'hidden';
    content.style.contain = 'layout paint';
    content.style.boxSizing = 'border-box';

    // WHY A CARD EXPLAINS ITSELF. A component whose layout lives in its
    // game's page-level stylesheet renders, without that sheet, as real DOM
    // with zero layout — and a person looking at the board reads that as the
    // editor being broken, not as a missing declaration (it was read that way
    // three times before this note existed). So the card says what is missing,
    // in the place the missing thing is SEEN. It is board CHROME, a sibling of
    // `content` and deliberately never inside it: the authoring adapter walks
    // `activeContent().children` as the story's own source tree, and an
    // editor-owned div in there would surface in the hierarchy as an element
    // the story does not have.
    const note = document.createElement('div');
    note.dataset['testid'] = 'react-story-frame-note';
    note.dataset['storyId'] = story.id;
    note.style.position = 'absolute';
    note.style.left = '0';
    note.style.right = '0';
    note.style.bottom = '0';
    note.style.display = 'none';
    note.style.padding = '6px 8px';
    note.style.boxSizing = 'border-box';
    note.style.background = themeVars.surface.overlay;
    note.style.color = themeVars.content.muted;
    note.style.font = `11px ${themeVars.typography.sans}`;
    note.style.pointerEvents = 'none';

    const error = document.createElement('div');
    error.dataset['testid'] = 'react-story-frame-error';
    error.dataset['storyId'] = story.id;
    error.style.position = 'absolute';
    error.style.inset = '0';
    error.style.display = 'none';
    error.style.padding = '16px';
    error.style.boxSizing = 'border-box';
    error.style.background = themeVars.surface.overlay;
    error.style.color = themeVars.semantic.danger;
    error.style.font = `12px ${themeVars.typography.mono}`;
    error.style.pointerEvents = 'none';

    frame.append(content, note, error);
    boardElement.appendChild(frame);
    chromeElement.appendChild(label);
    frames.set(story.id, { element: frame, content });
    errors.set(story.id, error);
    notes.set(story.id, note);
    labels.set(story.id, label);
  }

  // Group names are chrome of the SAME floating kind as the frame labels —
  // constant size above a zooming board, in the same synchronized sibling
  // layer. They name a cluster; they are not selectable, so unlike a frame
  // label they take no pointer events.
  // One block needs no name over it — a single title above the whole board
  // distinguishes nothing, which is the same rule the single-group board
  // always held.
  const showBlockLabels = blocks.length > 1;
  if (showBlockLabels) {
    for (const block of blocks) {
      // An unlabeled block (pathless solo cards) shows nothing above itself —
      // its cards already wear their component names.
      if (block.label === null) continue;
      const groupLabel = document.createElement('div');
      groupLabel.dataset['testid'] = 'react-story-group-label';
      groupLabel.dataset['storyGroup'] = block.key;
      groupLabel.textContent = block.label;
      groupLabel.style.position = 'absolute';
      groupLabel.style.height = `${GROUP_LABEL_HEIGHT}px`;
      groupLabel.style.lineHeight = `${GROUP_LABEL_HEIGHT}px`;
      groupLabel.style.color = themeVars.content.primary;
      groupLabel.style.font = `700 14px ${themeVars.typography.sans}`;
      groupLabel.style.whiteSpace = 'nowrap';
      groupLabel.style.pointerEvents = 'none';
      groupLabel.style.width = 'max-content';
      chromeElement.appendChild(groupLabel);
      groupLabels.set(block.key, groupLabel);
    }
  }

  const updateActiveAppearance = (): void => {
    for (const [storyId, frame] of frames) {
      const active = storyId === activeStoryId;
      frame.element.dataset['active'] = active ? 'true' : 'false';
      frame.element.style.outline = active ? `2px solid ${themeVars.accent.default}` : 'none';
      frame.element.style.outlineOffset = active ? '3px' : '0';
      const label = labels.get(storyId)!;
      label.setAttribute('aria-pressed', String(active));
      label.style.color = active ? themeVars.accent.default : themeVars.content.muted;
    }
  };

  /** The authored room above a row, in client px at the current zoom. */
  const clientRoom = (authored: number, zoom: number): number =>
    Number.isFinite(authored) ? authored * zoom : Number.POSITIVE_INFINITY;

  // Story names are editor chrome, not board content. Convert each authored-
  // space frame origin into client-space placement instead of transforming
  // the label subtree; font size, height, and hit target therefore remain
  // constant while the frames zoom underneath them, matching Figma labels.
  // At far zoom that constant chrome no longer fits the gap it lives in, so
  // `placeStoryChrome` degrades it (scale, then fade, then drop) rather than
  // letting it paint over the frames above — see story-board-chrome-fit.ts.
  const positionLabels = (): void => {
    const view = getRootPan();
    for (const [storyId, frameLayout] of layouts) {
      const label = labels.get(storyId)!;
      const { frame } = placeStoryChrome(
        clientRoom(frameLayout.roomAbove, view.zoom),
        frameLayout.withGroupLabel,
      );
      label.style.left = `${view.x + frameLayout.x * view.zoom}px`;
      label.style.top = `${view.y + frameLayout.y * view.zoom - frame.offset}px`;
      // A floating name may borrow half the inter-frame gap, but never the
      // next frame's column. The old 80px floor made labels for small 2D
      // sprites collide at overview zoom even while their frames were apart;
      // at extreme zoom a title truncates, then disappears below the readable
      // width above instead of claiming space from its neighbour.
      const maxWidth = Math.max(1, (frameLayout.width + FRAME_GAP / 2) * view.zoom);
      label.style.maxWidth = `${maxWidth}px`;
      applyStoryChrome(
        label,
        maxWidth >= MIN_FRAME_LABEL_WIDTH ? frame : { ...frame, opacity: 0, visible: false },
      );
    }
    for (const [key, origin] of groupOrigins) {
      const groupLabel = groupLabels.get(key);
      if (!groupLabel) continue;
      const { group } = placeStoryChrome(clientRoom(origin.roomAbove, view.zoom), true);
      if (!group) continue;
      groupLabel.style.left = `${view.x + origin.x * view.zoom}px`;
      groupLabel.style.top = `${view.y + origin.y * view.zoom - group.offset}px`;
      applyStoryChrome(groupLabel, group);
    }
  };

  // One block per Storybook component, stacked top to bottom. Frames inside a
  // block may differ in size because each story owns its viewport globals.
  const layout = (): void => {
    layouts.clear();
    groupOrigins.clear();
    const placement = reactStoryBoardLayout(stories, presentation.index, presentationFor);
    for (const [key, origin] of placement.groupOrigins) groupOrigins.set(key, origin);
    for (const story of stories) {
      const frameLayout = placement.layouts.get(story.id);
      if (!frameLayout) continue;
      layouts.set(story.id, frameLayout);
      const { x, y, width, height } = frameLayout;
      const presentation = presentationFor(story);
      const frame = frames.get(story.id)!;
      frame.element.style.left = `${x}px`;
      frame.element.style.top = `${y}px`;
      frame.element.style.width = `${width}px`;
      frame.element.style.height = `${height}px`;
      // A measured story's CONTENT stays at its mount-harness size and is
      // translated so the measured rectangle fills the frame — the frame is
      // a window onto the declared viewport, exactly the canvas exhibit's
      // crop. Everything else keeps content == frame.
      const measured = measuredFrames.get(story.id);
      frame.element.style.overflow = measured ? 'hidden' : '';
      frame.content.style.width = `${measured ? measured.mount.width : width}px`;
      frame.content.style.height = `${measured ? measured.mount.height : height}px`;
      frame.content.style.left = `${measured ? -measured.offset.x : 0}px`;
      frame.content.style.top = `${measured ? -measured.offset.y : 0}px`;
      frame.content.dataset['storyLayout'] = presentation.layout;
      frame.content.style.padding = presentation.layout === 'padded' ? '16px' : '0';
      frame.content.style.display = presentation.layout === 'centered' ? 'flex' : 'block';
      frame.content.style.alignItems = presentation.layout === 'centered' ? 'center' : '';
      frame.content.style.justifyContent = presentation.layout === 'centered' ? 'center' : '';
    }
    const boardWidth = placement.width;
    const boardHeight = placement.height;
    boardElement.style.width = `${boardWidth}px`;
    boardElement.style.height = `${boardHeight}px`;
    layer.style.width = `${boardWidth}px`;
    layer.style.height = `${boardHeight}px`;
    positionLabels();
  };

  const fitAll = (): void => {
    const width = Number.parseFloat(boardElement.style.width);
    const height = Number.parseFloat(boardElement.style.height);
    fitBounds(container, { x: 0, y: 0, width, height }, 1);
  };

  const scheduleFitActive = (): void => {
    if (pendingFit) return;
    pendingFit = true;
    queueMicrotask(() => {
      pendingFit = false;
      if (!disposed) activate(activeStoryId, true);
    });
  };

  const activate = (storyId: string, focus = false): void => {
    const frame = frames.get(storyId);
    const frameLayout = layouts.get(storyId);
    if (!frame || !frameLayout) return;
    activeStoryId = storyId;
    updateActiveAppearance();
    updateViewportSnapshot();
    notifyBoardViewport();
    if (focus) fitBounds(container, frameLayout, 2);
  };

  const storyAtClientPoint = (clientX: number, clientY: number): string | null => {
    for (const [storyId, frame] of frames) {
      const rect = frame.content.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return storyId;
      }
    }
    return null;
  };

  const unsubscribeViewport = subscribeRootCanvasViewport(() => {
    layout();
    scheduleFitActive();
  });
  const unsubscribePan = subscribeRootPan(positionLabels);

  layout();
  updateActiveAppearance();
  positionLabels();

  const board: ReactStoryBoard = {
    element: boardElement,
    frames,
    activeContent: () => frames.get(activeStoryId)!.content,
    activate,
    clearError: (storyId) => {
      const error = errors.get(storyId);
      if (!error) return;
      error.style.display = 'none';
      error.textContent = '';
    },
    fitAll,
    selectAtClientPoint: (clientX, clientY) => {
      const storyId = storyAtClientPoint(clientX, clientY);
      if (!storyId || storyId === activeStoryId) return false;
      onStorySelected(storyId, 'highlight');
      return true;
    },
    zoomAtClientPoint: (clientX, clientY) => {
      const storyId = storyAtClientPoint(clientX, clientY);
      if (!storyId) return false;
      onStorySelected(storyId, 'zoom');
      return true;
    },
    setError: (storyId, message) => {
      const error = errors.get(storyId);
      if (!error) return;
      error.textContent = message;
      error.style.display = 'block';
    },
    setMeasuredFrame: (storyId, measured) => {
      if (disposed || !frames.has(storyId)) return;
      const previous = measuredFrames.get(storyId);
      if (measured === null) {
        if (!previous) return;
        measuredFrames.delete(storyId);
      } else {
        if (
          previous &&
          previous.frame.width === measured.frame.width &&
          previous.frame.height === measured.frame.height &&
          previous.mount.width === measured.mount.width &&
          previous.mount.height === measured.mount.height &&
          previous.offset.x === measured.offset.x &&
          previous.offset.y === measured.offset.y
        ) {
          return;
        }
        measuredFrames.set(storyId, measured);
      }
      layout();
      positionLabels();
    },
    setNote: (message) => {
      for (const note of notes.values()) {
        note.textContent = message ?? '';
        note.style.display = message === null ? 'none' : 'block';
      }
    },
    viewport: () => viewportSnapshot,
    setViewport: (viewportId) => {
      if (viewportSnapshot.locked) return;
      viewportOverrides.set(activeStoryId, viewportId);
      layout();
      updateViewportSnapshot();
      notifyBoardViewport();
      activate(activeStoryId, true);
    },
    setRotation: (rotated) => {
      if (viewportSnapshot.locked) return;
      rotationOverrides.set(activeStoryId, rotated);
      layout();
      updateViewportSnapshot();
      notifyBoardViewport();
      activate(activeStoryId, true);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribeViewport();
      unsubscribePan();
      if (boardsByContainer.get(container) === board) boardsByContainer.delete(container);
      notifyBoardViewport();
      boardElement.remove();
      chromeElement.remove();
    },
  };
  boardsByContainer.set(container, board);
  notifyBoardViewport();
  // Open at a useful editing scale on the active story. The complete-board
  // overview remains one explicit "Fit board" click away; auto-fitting every
  // story made desktop-resolution screens postage stamps on first open.
  scheduleFitActive();
  return board;
}
