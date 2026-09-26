/**
 * The 2D COMPONENTS board — every qualifying canvas story laid out as a frame
 * on the project's design canvas, each frame hosting that story's OWN mounted
 * Pixi `Application`, playing its cycle, framed to the component's content.
 *
 * It is a PEER OF THE `UI` BOARD, not of the `3D` one. A canvas story renders a
 * `<canvas>` — it is DOM — so it is an ordinary frame on the shared story-board
 * substrate, and everything a Figma-style board needs is already there and
 * reused verbatim:
 *
 *  - frame layout, group clustering and view fitting — `authoring/react-story-board.ts`
 *  - frame/group names, zoom-independent and collision-free — `authoring/story-board-chrome-fit.ts`
 *  - pan + zoom — the ONE shared singleton `authoring/world-pan-state.ts`,
 *    driven by `authoring/react-canvas-navigation.ts`
 *  - the dot-grid canvas and the alpha checkerboard — `authoring/react-design-canvas-style.ts`
 *  - districts — `stories/story-grouping.ts`
 *
 * What is genuinely this board's own is only what goes IN a frame (an adopted
 * Pixi host instead of a React render) and WHO is on it
 * (`canvas-board-model.ts`).
 *
 * ## True texel scale
 *
 * A frame is the mounted Pixi content's bounds with a small transparent inset.
 * The `<Application width height>` is only a mounting harness; it becomes the
 * frame when the story opts into Storybook's standard `layout: 'fullscreen'`.
 * There is no scale channel between art and frame. Magnification is the
 * board's shared zoom, and while it magnifies, exhibits' canvases are told to
 * magnify TEXELS rather than blur them (see `applyView` below).
 *
 * ## One clock, and one context per exhibit
 *
 * Each exhibit arrives STOPPED (`stories/story-pixi-preview.ts` never lets a
 * design-time story run on wall time) and is driven from THIS document's single
 * rAF loop, which runs only while the document is the active tab. Each exhibit
 * keeps its own renderer, which is what draws its own canvas — so the exhibit
 * count is bounded by the browser's WebGL context budget (order of sixteen per
 * page), not by layout. That ceiling is stated in `MountedStoryPixi.app`.
 *
 * ## Ghost slots open nothing
 *
 * A storyless canvas component gets a reserved, named frame with a dashed edge
 * and NO fabricated render. The board says what is missing where the missing
 * thing would be.
 */

import { installReactCanvasNavigation } from '@volter/editor-sdk/kit/authoring/react-canvas-navigation';
import {
  REACT_DESIGN_CANVAS_COLOR,
  REACT_DESIGN_CANVAS_DOT,
} from '@volter/editor-sdk/kit/authoring/react-design-canvas-style';
import {
  createReactStoryBoard,
  type ReactStoryBoard,
  type ReactStoryBoardStory,
} from '@volter/editor-sdk/kit/authoring/react-story-board';
import {
  getRootPan,
  panRootBy,
  panTransformValue,
  subscribeRootPan,
} from '@volter/editor-sdk/kit/world-pan-state';
import { registerPresentedPixiApps } from '../../host/canvas-preview-frames';
import { ReactCanvasControls } from '@volter/editor-sdk/kit/components/ReactCanvasControls';
import { themeVars } from '@volter/editor-sdk/widgets';
import { listProjectComponents } from '@volter/editor-sdk/kit/api/assets';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { publishDocumentInspectionSubject } from '@volter/editor-sdk/kit/inspection/document-subject';
import { CANVAS_COMPONENTS_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import { registerAvailableWorkspaceDocument } from '@volter/editor-sdk/kit/workspace-available-documents';
import {
  registerWorkspaceDocumentSelection,
  type WorkspaceDocumentContentProps,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { storyBoardPresentation } from '@volter/editor-sdk/kit/stories/story-presentation';
import { getProjectStoryModules, subscribeProjectStoryModules } from '@volter/editor-sdk/kit/stories/story-registry';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  buildCanvasBoard,
  type CanvasBoard,
  disposeCanvasBoard,
  GHOST_DISTRICT,
  GHOST_FRAME_SIZE,
  summarizeCanvasBoardSkips,
} from './canvas-board-model';

/** The board is a project-wide singleton: one generated view of one registry.
 *  Symmetric with the other pinned boards — a stable project-level id, so a
 *  persisted layout never strands the panel when a file is renamed. */
export { CANVAS_COMPONENTS_DOCUMENT_ID };

/** The tab reads `2D`, the peer of `3D` and `UI` in the center strip. */
const CANVAS_COMPONENTS_TITLE = '2D';

/** The narrow store surface this document needs. */
type BuildState =
  | { readonly status: 'idle' }
  | { readonly status: 'building' }
  | { readonly status: 'ready'; readonly board: CanvasBoard }
  | { readonly status: 'error'; readonly message: string };

/** How far a press may travel and still count as a click rather than a pan. */
const BOARD_CLICK_SLOP_PX = 4;

/** A live presentation of one built board over one container. */
interface CanvasBoardPresentation {
  /** Drive (or freeze) every exhibit's own clock. */
  setPlaying(playing: boolean): void;
  /** Select the frame under a client point; false when the point hit no
   *  inactive frame. The whole frame is the target, not only its label. */
  selectAt(clientX: number, clientY: number): boolean;
  /** Recenter on the frame under a client point. */
  zoomAt(clientX: number, clientY: number): boolean;
  /** The exhibit the board is currently showing as active, for the Inspector. */
  activeStoryId(): string | null;
  dispose(): void;
}

/**
 * The exhibits' rows, then the ghosts'.
 *
 * A row's `title` is the substrate's ORGANIZATION input, and this board's
 * blocks are DISTRICTS rather than components: the board already shows one
 * exhibit per component, so clustering by component would stack a column of
 * one-frame blocks instead of the shelf a museum wants. So each row is titled
 * with its district, which makes the block "Gameplay" and the frames inside it
 * "Hero", "Grunt", "Brute". Ghosts share ONE trailing district, so the
 * storyless components land after every real block — a "still to do" shelf,
 * never interleaved with the museum.
 *
 * An ungrouped exhibit (no district) carries no title and falls back to the
 * substrate's own module-path derivation, exactly like an untitled dom story.
 */
function boardRows(board: CanvasBoard): ReactStoryBoardStory[] {
  return [
    ...board.exhibits.map((exhibit) => ({
      id: exhibit.id,
      label: exhibit.label,
      modulePath: exhibit.modulePath,
      ...(exhibit.district ? { title: exhibit.district } : {}),
      frameSize: exhibit.frameSize,
    })),
    ...board.ghosts.map((ghost) => ({
      id: ghost.key,
      label: ghost.name,
      modulePath: ghost.path,
      title: GHOST_DISTRICT,
      frameSize: GHOST_FRAME_SIZE,
    })),
  ];
}

/**
 * Mount one built board into `container`: the shared design canvas' own
 * transformed layer, the shared story board over it, and each story's mounted
 * host adopted into its frame.
 *
 * Returns null for a board with nothing on it — the substrate requires at least
 * one frame, and an empty board is a status line rather than a canvas.
 */
function presentCanvasBoard(
  container: HTMLElement,
  board: CanvasBoard,
  onSelectionChanged?: () => void,
): CanvasBoardPresentation | null {
  const rows = boardRows(board);
  const first = rows[0];
  if (!first) return null;

  // The transformed world layer — the same role `design-time-layers.ts`'s
  // layer plays for the UI board, and the same ONE shared transform value
  // (`panTransformValue(getRootPan())`), so both boards' cameras are literally
  // one camera and neither can drift from the other.
  const layer = document.createElement('div');
  layer.dataset['testid'] = 'canvas-board-layer';
  layer.style.position = 'absolute';
  layer.style.left = '0';
  layer.style.top = '0';
  layer.style.transformOrigin = '0 0';
  container.appendChild(layer);

  let storyBoard: ReactStoryBoard | null = null;
  let selectedStoryId: string | null = first.id;
  storyBoard = createReactStoryBoard(
    layer,
    rows,
    first.id,
    (storyId, intent) => {
      // No authoring adapter stands behind this board: a frame click
      // highlights, a double-click recenters on it. Both are the substrate's
      // own. What the click DOES carry is identity, which the Inspector can
      // say something honest about — see the document subject published below.
      selectedStoryId = storyId;
      storyBoard?.activate(storyId, intent === 'zoom');
      onSelectionChanged?.();
    },
    // The substrate is host chrome's and does not import portable CSF; the
    // lane that mounts a board supplies how its frames are organized and
    // sized (`@volter/editor-sdk/kit/authoring/story-board-presentation.ts`).
    storyBoardPresentation(rows),
  );

  const canvases: HTMLCanvasElement[] = [];
  for (const exhibit of board.exhibits) {
    const frame = storyBoard.frames.get(exhibit.id);
    if (!frame) continue;
    // The story's OWN host element, not its canvas: react owns the host's
    // children, and moving a react-rendered node out from under its root makes
    // unmount throw (`MountedStoryPixi.host`).
    const host = exhibit.mounted.host;
    host.setAttribute(
      'style',
      `position:absolute;left:${-exhibit.crop.x}px;top:${-exhibit.crop.y}px;` +
        `width:${exhibit.mounted.app.screen.width}px;height:${exhibit.mounted.app.screen.height}px;` +
        'overflow:visible;contain:layout paint;',
    );
    const canvas = exhibit.mounted.app.canvas as HTMLCanvasElement;
    canvas.style.display = 'block';
    // 1 declared px = 1 CSS px. Pixi's own `autoDensity` may have written a
    // device-pixel-ratio size here; the frame is authored space, so it is the
    // declared cell that goes on screen.
    canvas.style.width = `${exhibit.mounted.app.screen.width}px`;
    canvas.style.height = `${exhibit.mounted.app.screen.height}px`;
    frame.content.appendChild(host);
    canvases.push(canvas);
  }

  for (const ghost of board.ghosts) {
    const frame = storyBoard.frames.get(ghost.key);
    if (!frame) continue;
    frame.element.style.border = `1px dashed ${themeVars.boundary.strong}`;
    const empty = document.createElement('div');
    empty.dataset['testid'] = 'canvas-board-ghost';
    empty.textContent = 'No story yet';
    empty.style.position = 'absolute';
    empty.style.inset = '0';
    empty.style.display = 'flex';
    empty.style.alignItems = 'center';
    empty.style.justifyContent = 'center';
    empty.style.color = themeVars.content.dim;
    empty.style.font = `11px ${themeVars.typography.sans}`;
    empty.style.pointerEvents = 'none';
    frame.content.appendChild(empty);
  }

  // The board's exhibits are what `capture-active-document` photographs, and a
  // story's own `<Application>` has no `preserveDrawingBuffer` — so the shared
  // composite lane needs Pixi's own extraction for exactly these canvases.
  const unregisterApps = registerPresentedPixiApps(
    board.exhibits.map((exhibit) => exhibit.mounted.app),
  );

  const applyView = (): void => {
    const view = getRootPan();
    layer.style.transform = panTransformValue(view) ?? '';
    // MAGNIFY TEXELS, NEVER BLUR THEM. The board's zoom is a CSS scale over an
    // already-rendered canvas, and a browser resamples that bilinearly by
    // default — which would smooth away the nearest-neighbour sheet the game
    // actually ships. Below 1× the opposite is true: dropping texels aliases,
    // so the overview keeps the browser's own filtering.
    const rendering = view.zoom >= 1 ? 'pixelated' : 'auto';
    for (const canvas of canvases) canvas.style.imageRendering = rendering;
  };
  const unsubscribePan = subscribeRootPan(applyView);
  applyView();

  // The board's subject is the whole shelf, so it opens on the overview rather
  // than on one frame (the substrate's own default, which suits a UI board
  // being edited a state at a time). A frame this size at editing zoom would
  // show one sprite and no neighbours to compare it with. After a frame, so it
  // lands on the substrate's own initial fit rather than under it.
  const openingFit = requestAnimationFrame(() => storyBoard?.fitAll());

  let playing = false;
  let frameHandle = 0;
  let lastFrameMs = 0;
  let elapsedMs = 0;
  const tick = (now: number): void => {
    frameHandle = requestAnimationFrame(tick);
    // Exhibit clocks advance by REAL elapsed time, clamped so a backgrounded
    // tab does not resume with one enormous step through every cycle.
    elapsedMs += lastFrameMs === 0 ? 16 : Math.min(100, now - lastFrameMs);
    lastFrameMs = now;
    for (const exhibit of board.exhibits) {
      try {
        exhibit.mounted.ticker.update(elapsedMs);
      } catch (error) {
        // biome-ignore lint/suspicious/noConsole: a broken exhibit must stay diagnosable without stopping the board
        console.error('[canvas-board] an exhibit failed to tick.', error);
      }
    }
  };

  return {
    // THE WHOLE FRAME IS THE TARGET, not only its label. The substrate has
    // always exposed this hit test — `selectReactStoryFrameAtPoint`'s own note
    // calls it "the expected Figma-style click target" — but this board never
    // wired it, so a frame could only be selected by clicking its small name
    // (runhuman pass 86: "you have to click it by the name; if you click it by
    // the card, you can't actually select it"). The UI board gets this through
    // `RootSelectionOverlay`, which no adapter-less board mounts.
    selectAt(clientX: number, clientY: number): boolean {
      return storyBoard?.selectAtClientPoint(clientX, clientY) ?? false;
    },
    activeStoryId(): string | null {
      return selectedStoryId;
    },
    zoomAt(clientX: number, clientY: number): boolean {
      return storyBoard?.zoomAtClientPoint(clientX, clientY) ?? false;
    },
    setPlaying(next: boolean): void {
      if (next === playing) return;
      playing = next;
      if (next) {
        lastFrameMs = 0;
        frameHandle = requestAnimationFrame(tick);
      } else {
        cancelAnimationFrame(frameHandle);
        frameHandle = 0;
      }
    },
    dispose(): void {
      cancelAnimationFrame(frameHandle);
      cancelAnimationFrame(openingFit);
      unsubscribePan();
      unregisterApps();
      // Every adopted host goes home BEFORE the board's own DOM does: the host
      // belongs to the story's mount, which is the only thing entitled to free
      // it (the mount's own `dispose`, run by `disposeCanvasBoard`).
      for (const exhibit of board.exhibits) exhibit.mounted.host.remove();
      storyBoard?.dispose();
      storyBoard = null;
      layer.remove();
    },
  };
}

function CanvasBoardContent({ active }: WorkspaceDocumentContentProps) {
  const modules = useSyncExternalStore(subscribeProjectStoryModules, getProjectStoryModules);
  const containerRef = useRef<HTMLDivElement>(null);
  const presentationRef = useRef<CanvasBoardPresentation | null>(null);
  /** Where the current press started, so a pan is never read as a click. */
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  /** The previous pointer position while a drag-pan is running. */
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [state, setState] = useState<BuildState>({ status: 'idle' });

  // The board is a STANDING tab whose panel Dockview mounts whether or not it
  // is the active one, so mounting is not the trigger — FIRST ACTIVATION is.
  // Building mounts every story off-screen, one at a time, and a tab nobody
  // has looked at must cost nothing at boot. It latches: once shown, the board
  // survives tab switches rather than being rebuilt on every return.
  const [revealed, setRevealed] = useState(active);
  useEffect(() => {
    if (active) setRevealed(true);
  }, [active]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return installReactCanvasNavigation(container);
  }, []);

  // Rebuild on reveal and on every story-registry change; the previous board's
  // ONE teardown runs here and nowhere else.
  useEffect(() => {
    if (!revealed) return;
    const controller = new AbortController();
    let built: CanvasBoard | null = null;
    setState({ status: 'building' });
    // The component index rides along so storyless canvas components get their
    // ghost frames — the Content gallery's own discovery, never a second scan.
    // An index failure degrades to "no ghosts", not to a failed board.
    void listProjectComponents()
      .then((listing) => {
        // Still "no ghosts, not a failed board" — but SAID OUT LOUD, so a
        // failed index does not look like a project with no components.
        if (!listing.ok) {
          editorConsole.warn(
            `Component index unavailable, so this board shows no ghost frames: ${listing.reason}`,
            'canvas-board',
          );
        }
        return buildCanvasBoard(modules, listing.ok ? listing.entries : [], controller.signal);
      })
      .then(
        (board) => {
          // A build can RESOLVE in the same turn that unmount aborts it, when
          // cleanup already saw `built === null` — so a success landing after
          // an abort frees itself here or it leaks.
          if (controller.signal.aborted) {
            void disposeCanvasBoard(board);
            return;
          }
          built = board;
          setState({ status: 'ready', board });
        },
        (error: unknown) => {
          // A superseded build already freed itself in its own turn.
          if (controller.signal.aborted) return;
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        },
      );
    return () => {
      controller.abort();
      if (built) void disposeCanvasBoard(built);
    };
  }, [modules, revealed]);

  const board = state.status === 'ready' ? state.board : null;
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !board) return;
    const presentation = presentCanvasBoard(container, board, () => {
      setSelectedStoryId(presentationRef.current?.activeStoryId() ?? null);
    });
    presentationRef.current = presentation;
    setSelectedStoryId(presentation?.activeStoryId() ?? null);
    return () => {
      presentationRef.current = null;
      presentation?.dispose();
    };
  }, [board]);

  /**
   * WHAT THE SELECTED FRAME IS, said in the Inspector.
   *
   * This board stands behind no authoring adapter — a frame carries no
   * editable transform — so clicking one used to leave the Inspector
   * completely empty, which reads as the click having failed (runhuman pass
   * 86). A frame still HAS an identity, and identity is exactly what a
   * document may describe about itself: the component the exhibit shows, the
   * story composing it, and the module both come from. Read-only by
   * construction: no io, no fields, nothing that implies an edit this surface
   * cannot perform.
   */
  const selectedExhibit = board?.exhibits.find((exhibit) => exhibit.id === selectedStoryId) ?? null;
  // "I AM THE SUBJECT" — the half without which publishing is inert. With no
  // registered selection the Inspector falls back to the shared entity
  // selection, so the board would show whatever was picked in the scene
  // before its tab was opened, and a board with nothing picked in it would
  // never reach the no-selection seam at all
  // (`workspace-document-registry.ts`'s `WorkspaceDocumentSelection`, and
  // `components/AssetEditorShell.tsx`, which registers the same pair).
  useEffect(() => {
    if (!active) return;
    return registerWorkspaceDocumentSelection(CANVAS_COMPONENTS_DOCUMENT_ID, () => ({
      adapter: null,
      nodeId: null,
    }));
  }, [active]);
  useEffect(() => {
    if (!active || !selectedExhibit) return;
    return publishDocumentInspectionSubject(CANVAS_COMPONENTS_DOCUMENT_ID, () => ({
      id: selectedExhibit.id,
      title: selectedExhibit.label,
      kindLabel: 'Canvas story',
      note: {
        text: `${selectedExhibit.storyName} · ${selectedExhibit.modulePath}`,
        testId: 'canvas-board-subject-note',
      },
      sections: [],
    }));
  }, [active, selectedExhibit]);

  // The exhibits' clocks run only while this document is the visible subject.
  // Keyed on the BOARD as well as on `active`: a board that finishes building
  // while its tab is already the active one never sees `active` change, and
  // without this its exhibits would mount frozen on their first frame.
  useEffect(() => {
    presentationRef.current?.setPlaying(active);
    return () => presentationRef.current?.setPlaying(false);
  }, [active, board]);

  return (
    <div
      data-testid="canvas-board"
      data-vgai-backdrop-color={active ? REACT_DESIGN_CANVAS_COLOR : undefined}
      data-vgai-backdrop-policy={active ? 'dark-frost' : undefined}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'auto',
        touchAction: 'none',
        // A DRAG PANS; IT NEVER SWEEPS TEXT. Now that dragging moves the
        // canvas, the browser's own text selection ran alongside it and left
        // frame labels highlighted, which visibly fought the next pan — "you
        // have to double- or triple-click somewhere else for the text to be
        // unhighlighted" (runhuman pass 89). Board chrome is a surface to
        // navigate, not prose to select.
        userSelect: 'none',
        WebkitUserSelect: 'none',
        backgroundColor: REACT_DESIGN_CANVAS_COLOR,
      }}
      ref={containerRef}
      // DRAG PANS, AND A CLICK STILL SELECTS. The board's navigation was
      // wheel-only (wheel pans, cmd-wheel zooms — Figma's own model), so
      // dragging did nothing at all and a tester reported "you can't pan" as
      // their number one fix (runhuman pass 87). Any button drags the canvas,
      // because this board has no marquee and no movable frames, so there is
      // nothing else a drag could mean. The press point is remembered so a
      // drag that ends over a frame stays a pan rather than selecting it —
      // the movement threshold the Scene's own grammar uses, not a modifier.
      onPointerDown={(event) => {
        pressRef.current = { x: event.clientX, y: event.clientY };
        dragRef.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const from = dragRef.current;
        if (!from) return;
        const dx = event.clientX - from.x;
        const dy = event.clientY - from.y;
        if (dx === 0 && dy === 0) return;
        dragRef.current = { x: event.clientX, y: event.clientY };
        panRootBy(dx, dy);
      }}
      onPointerUp={(event) => {
        const press = pressRef.current;
        pressRef.current = null;
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (!press) return;
        const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
        if (moved > BOARD_CLICK_SLOP_PX) return;
        presentationRef.current?.selectAt(event.clientX, event.clientY);
      }}
      onPointerCancel={() => {
        pressRef.current = null;
        dragRef.current = null;
      }}
      onDoubleClick={(event) => {
        presentationRef.current?.zoomAt(event.clientX, event.clientY);
      }}
    >
      <DesignCanvasBackdrop />
      {board ? (
        <CanvasBoardStatus board={board} />
      ) : (
        <div
          data-testid="canvas-board-status"
          style={{ padding: 16, fontSize: 12, color: themeVars.content.muted }}
        >
          {state.status === 'error' && state.message}
          {state.status === 'building' && 'Mounting every canvas story off-screen…'}
          {state.status === 'idle' && 'Open this tab to lay out every canvas story at 1× texels.'}
        </div>
      )}
      <ReactCanvasControls containerRef={containerRef} context={null} boardOnly />
    </div>
  );
}

/** Infinite editor canvas behind the frames — the same dot grid, following the
 *  same shared transform, as the UI board's. */
function DesignCanvasBackdrop() {
  const view = useSyncExternalStore(subscribeRootPan, getRootPan);
  const spacing = Math.max(8, 24 * view.zoom);
  const dotRadius = Math.max(0.7, Math.min(1.4, view.zoom));
  return (
    <div
      data-testid="react-design-canvas-backdrop"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        backgroundColor: REACT_DESIGN_CANVAS_COLOR,
        backgroundImage: `radial-gradient(circle, ${REACT_DESIGN_CANVAS_DOT} ${dotRadius}px, transparent ${dotRadius}px)`,
        backgroundPosition: `${view.x}px ${view.y}px`,
        backgroundSize: `${spacing}px ${spacing}px`,
      }}
    />
  );
}

/** Counts, plus the honest list of stories that produced no Pixi content.
 *  Ghosts and skips are DIFFERENT facts — a ghost is a component with no story,
 *  a skip is a story that mounted nothing 2D — and the footer states both. */
function CanvasBoardStatus({ board }: { readonly board: CanvasBoard }) {
  const [open, setOpen] = useState(false);
  const skips = summarizeCanvasBoardSkips(board.skipped);
  return (
    <div
      data-testid="canvas-board-status"
      style={{
        position: 'absolute',
        left: 8,
        bottom: 8,
        maxWidth: 420,
        padding: '4px 8px',
        borderRadius: themeVars.shape.small,
        background: themeVars.surface.raised,
        border: `1px solid ${themeVars.boundary.default}`,
        fontSize: 10,
        color: themeVars.content.muted,
        pointerEvents: 'auto',
      }}
    >
      {board.exhibits.length} exhibit{board.exhibits.length === 1 ? '' : 's'}
      {board.ghosts.length > 0 && (
        <>
          {' · '}
          {board.ghosts.length} component{board.ghosts.length === 1 ? '' : 's'} without stories
        </>
      )}
      {board.skipped.length > 0 && (
        <>
          {' · '}
          {/* Inline disclosure toggle — the role-annotated span is the
              guard-sanctioned shape for text-link chrome. */}
          <span
            role="button"
            tabIndex={0}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            onKeyDown={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                setOpen((value) => !value);
              }
            }}
            style={{ cursor: 'pointer', color: themeVars.accent.default }}
          >
            {skips.stories} {skips.stories === 1 ? 'story' : 'stories'} in {skips.modules}{' '}
            {skips.modules === 1 ? 'module' : 'modules'} not on this board
          </span>
        </>
      )}
      {open && (
        <div style={{ marginTop: 4, maxHeight: 160, overflow: 'auto' }}>
          {board.skipped.map((entry) => (
            <div key={entry.id} style={{ padding: '1px 0' }}>
              <code style={{ color: themeVars.content.dim }}>
                {entry.modulePath}#{entry.storyName}
              </code>{' '}
              — {entry.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Offer the `2D` board as a document the person can open, the way its `UI` and `3D` peers are
 * offered: the component-board registry installs it when the project has canvas stories
 * (`host/stories/story-media-presence.ts`). It never steals focus, and it costs nothing until
 * looked at.
 */
export function installCanvasBoardDocument(): string {
  return registerAvailableWorkspaceDocument(
    {
      id: CANVAS_COMPONENTS_DOCUMENT_ID,
      title: CANVAS_COMPONENTS_TITLE,
      // A generated browse-over-the-project's-content view, not an authored
      // subject: it is regenerated from the story registry, never persisted.
      kind: 'content-browser',
      workspaceRole: 'workspace-reference',
      Content: CanvasBoardContent,
      closeable: false,
      readOnly: true,
      presentation: () => ({ kind: 'workspace', id: CANVAS_COMPONENTS_DOCUMENT_ID }),
    },
    // A board never steals focus; a canvas root's Scene is the project's default document.
    { category: 'canvas' },
  );
}
