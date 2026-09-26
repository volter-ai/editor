import {
  faBorderAll,
  faCheck,
  faExpand,
  faHand,
  faLayerGroup,
  faLock,
  faLockOpen,
  faRulerCombined,
  faMagnifyingGlassMinus,
  faMagnifyingGlassPlus,
} from '@fortawesome/free-solid-svg-icons';
import {
  AnchoredMenu,
  Button,
  EditorIcon,
  FloatingToolbar,
  IconButton,
  MenuItem,
  MenuSeparator,
  Tooltip,
} from '@volter/editor-sdk/widgets';
import type { AuthoringAdapter, DOMRectLike } from '@volter/editor-project/adapter';
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { collectAllNodeIds } from '@volter/editor-sdk/kit/authoring/active-adapter';
import { SCENE_MAX_ZOOM, SCENE_MIN_ZOOM } from '@volter/editor-sdk/kit/authoring/react-canvas-navigation';
import {
  addCanvasSceneGuide,
  canvasSceneGuideRevision,
  canvasSceneGuides,
  clearCanvasSceneGuides,
  moveCanvasSceneGuide,
  removeCanvasSceneGuide,
  subscribeCanvasSceneGuides,
} from '../authoring/canvas-scene-guides';
import type { RootViewController } from '@volter/editor-sdk/kit/world-pan-state';
import { useEditorStore } from '@volter/editor-sdk/kit/editor-runtime';
import {
  bindViewPresentation,
  setViewDrafting,
  setViewGridVisible,
  viewDrafting,
  subscribeViewportPresentation,
  viewGridVisible,
  viewportPresentationVersion,
} from '@volter/editor-sdk/kit/viewport-presentation';
import { getCurrentProject } from '@volter/editor-sdk/kit/project-manager';
import { ToolStrip } from '@volter/editor-sdk/kit/components/Toolbar';
import { TransientHintOverlay } from '@volter/editor-sdk/kit/components/TransientHint';

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Neutral spatial-workspace ground shared in spirit with the Three Scene.
 * Unlike the component boards' media background, this is editor viewport
 * dressing: native Pixi content renders transparently above it. */
export const CANVAS_SCENE_BACKGROUND = '#111214';

/** Keep the drafting grid legible without divorcing it from world units.
 * Every visible interval is a power-of-two multiple/division of the canonical
 * 32-unit cell, so grid intersections never swim relative to authored points. */
function adaptiveGridWorldSpacing(zoom: number): number {
  let worldUnits = 32;
  while (worldUnits * zoom < 12) worldUnits *= 2;
  while (worldUnits * zoom > 48) worldUnits /= 2;
  return worldUnits;
}

function adaptiveGridSpacing(zoom: number): number {
  return adaptiveGridWorldSpacing(zoom) * zoom;
}

function unionRects(rects: readonly DOMRectLike[]): Bounds | null {
  if (rects.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function frameBounds(
  container: HTMLElement,
  view: RootViewController,
  bounds: Bounds | null,
): void {
  if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return;
  const availableWidth = Math.max(1, container.clientWidth - 96);
  const availableHeight = Math.max(1, container.clientHeight - 96);
  const zoom = Math.min(
    4,
    Math.max(SCENE_MIN_ZOOM, Math.min(availableWidth / bounds.width, availableHeight / bounds.height)),
  );
  view.setView(
    container.clientWidth / 2 - (bounds.x + bounds.width / 2) * zoom,
    container.clientHeight / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  );
}

/** Infinite XY drafting overlay for a native Pixi stage. The axes and grid
 * follow the editor camera; neither exists in the game's source or runtime.
 * It sits above source-owned backgrounds (which otherwise erase any useful
 * drafting reference) and below selection/transform chrome. */
export function CanvasSceneBackdrop({ view, documentId }: { view: RootViewController; documentId: string }) {
  const store = useEditorStore();
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  // The 2D scene's grid switch is its VIEW's, like every stage's (`kit/viewport-presentation`):
  // bound under the host document's own id, so a door that toggles the active view's grid
  // reaches this one, and two canvases never share a switch.
  useEffect(() => bindViewPresentation(documentId, 'canvas'), [documentId]);
  useSyncExternalStore(subscribeViewportPresentation, viewportPresentationVersion);
  const showGrid = viewGridVisible(documentId);
  const drafting = viewDrafting(documentId);
  const resolution = getCurrentProject()?.config.resolution;
  const pose = useSyncExternalStore(view.subscribe, view.get, view.get);
  useSyncExternalStore(
    useCallback((listener) => subscribeCanvasSceneGuides(view, listener), [view]),
    useCallback(() => canvasSceneGuideRevision(view), [view]),
  );
  const guides = canvasSceneGuides(view);
  const minor = adaptiveGridSpacing(pose.zoom);
  const major = minor * 4;
  return (
    <div
      data-testid="canvas-scene-backdrop"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 2,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {showGrid && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.075) 1px, transparent 1px),' +
              'linear-gradient(90deg, rgba(255,255,255,.075) 1px, transparent 1px),' +
              'linear-gradient(rgba(255,255,255,.14) 1px, transparent 1px),' +
              'linear-gradient(90deg, rgba(255,255,255,.14) 1px, transparent 1px)',
            backgroundPosition: `${pose.x}px ${pose.y}px`,
            backgroundSize: `${minor}px ${minor}px, ${minor}px ${minor}px, ${major}px ${major}px, ${major}px ${major}px`,
          }}
        />
      )}
      {drafting.viewport && resolution && resolution.width > 0 && resolution.height > 0 && (
        // The game's viewport: the manifest's resolution from the origin, as Godot draws its
        // project window size (View › Show Viewport).
        <div
          data-testid="canvas-scene-viewport-rect"
          style={{
            position: 'absolute',
            left: pose.x,
            top: pose.y,
            width: resolution.width * pose.zoom,
            height: resolution.height * pose.zoom,
            boxSizing: 'border-box',
            borderStyle: 'solid',
            borderWidth: 1,
            borderColor: 'rgba(160, 120, 255, .75)',
          }}
        />
      )}
      {drafting.origin && (
        <>
          <div
            data-testid="canvas-scene-origin-y"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: pose.y,
              height: 1,
              background: 'rgba(238, 91, 91, .8)',
            }}
          />
          <div
            data-testid="canvas-scene-origin-x"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: pose.x,
              width: 1,
              background: 'rgba(87, 199, 126, .8)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: pose.x + 6,
              top: pose.y + 6,
              color: 'rgba(255,255,255,.68)',
              font: '10px ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            0, 0
          </div>
        </>
      )}
      {drafting.guides &&
        guides.map((guide) => (
        <div
          key={guide.id}
          data-testid={`canvas-scene-guide-${guide.axis}`}
          title={`${guide.axis.toUpperCase()} ${Math.round(guide.value * 100) / 100} · drag to move · right-click to remove`}
          onContextMenu={(event) => {
            event.preventDefault();
            removeCanvasSceneGuide(view, guide.id);
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const host = event.currentTarget.parentElement?.getBoundingClientRect();
            if (!host) return;
            const move = (next: PointerEvent) => {
              const screen =
                guide.axis === 'x' ? next.clientX - host.left : next.clientY - host.top;
              const pan = view.get();
              moveCanvasSceneGuide(
                view,
                guide.id,
                (screen - (guide.axis === 'x' ? pan.x : pan.y)) / pan.zoom,
              );
            };
            const end = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', end);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', end, { once: true });
          }}
          style={{
            position: 'absolute',
            pointerEvents: 'auto',
            cursor: guide.axis === 'x' ? 'ew-resize' : 'ns-resize',
            ...(guide.axis === 'x'
              ? {
                  left: pose.x + guide.value * pose.zoom - 4,
                  top: 20,
                  bottom: 0,
                  width: 9,
                  borderLeft: '1px solid rgba(74, 180, 255, .95)',
                }
              : {
                  top: pose.y + guide.value * pose.zoom - 4,
                  left: 20,
                  right: 0,
                  height: 9,
                  borderTop: '1px solid rgba(74, 180, 255, .95)',
                }),
          }}
        />
        ))}
      {drafting.rulers && <CanvasSceneRulers view={view} />}
    </div>
  );
}

function CanvasSceneRulers({ view }: { view: RootViewController }) {
  const pose = useSyncExternalStore(view.subscribe, view.get, view.get);
  const horizontalRef = useRef<HTMLButtonElement>(null);
  const verticalRef = useRef<HTMLButtonElement>(null);
  const [extent, setExtent] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const update = () => {
      const width = horizontalRef.current?.clientWidth ?? 0;
      const height = verticalRef.current?.clientHeight ?? 0;
      setExtent((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    if (horizontalRef.current) observer.observe(horizontalRef.current);
    if (verticalRef.current) observer.observe(verticalRef.current);
    return () => observer.disconnect();
  }, []);

  const ticksFor = (axis: 'x' | 'y', length: number) => {
    if (!(length > 0)) return [];
    const pan = axis === 'x' ? pose.x : pose.y;
    const worldStep = adaptiveGridWorldSpacing(pose.zoom);
    const screenStep = worldStep * pose.zoom;
    const rulerStart = 20;
    const first = Math.ceil((rulerStart - pan) / screenStep);
    const last = Math.floor((rulerStart + length - pan) / screenStep);
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, offset) => {
      const index = first + offset;
      return {
        major: index % 4 === 0,
        screen: pan + index * screenStep - rulerStart,
        value: index * worldStep,
      };
    });
  };
  const horizontalTicks = ticksFor('x', extent.width);
  const verticalTicks = ticksFor('y', extent.height);

  const beginGuide = (axis: 'x' | 'y', event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const host = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!host) return;
    const valueAt = (clientX: number, clientY: number): number => {
      const pose = view.get();
      const screen = axis === 'x' ? clientX - host.left : clientY - host.top;
      return (screen - (axis === 'x' ? pose.x : pose.y)) / pose.zoom;
    };
    const id = addCanvasSceneGuide(view, axis, valueAt(event.clientX, event.clientY));
    const move = (next: PointerEvent) =>
      moveCanvasSceneGuide(view, id, valueAt(next.clientX, next.clientY));
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  };
  const rulerBase = {
    position: 'absolute' as const,
    pointerEvents: 'auto' as const,
    backgroundColor: 'rgba(24, 26, 30, .96)',
    border: 0,
    borderColor: 'rgba(255,255,255,.14)',
    boxSizing: 'border-box' as const,
  };
  return (
    <>
      <button
        ref={horizontalRef}
        type="button"
        data-testid="canvas-scene-ruler-x"
        aria-label="Horizontal ruler; drag to create a horizontal guide"
        onPointerDown={(event) => beginGuide('y', event)}
        style={{
          ...rulerBase,
          left: 20,
          right: 0,
          top: 0,
          height: 20,
          borderBottomStyle: 'solid',
          borderBottomWidth: 1,
          cursor: 'row-resize',
          padding: 0,
          overflow: 'hidden',
        }}
      >
        {horizontalTicks.map((tick) => (
          <span
            key={tick.value}
            aria-hidden="true"
            data-ruler-axis="x"
            data-ruler-value={tick.value}
            style={{
              position: 'absolute',
              left: tick.screen,
              bottom: 0,
              width: 1,
              height: tick.major ? 8 : 4,
              background: tick.major ? 'rgba(255,255,255,.5)' : 'rgba(255,255,255,.28)',
              pointerEvents: 'none',
            }}
          >
            {tick.major && (
              <span
                style={{
                  position: 'absolute',
                  left: 3,
                  bottom: 5,
                  color: 'rgba(255,255,255,.62)',
                  font: '9px ui-monospace, SFMono-Regular, Menlo, monospace',
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {tick.value}
              </span>
            )}
          </span>
        ))}
      </button>
      <button
        ref={verticalRef}
        type="button"
        data-testid="canvas-scene-ruler-y"
        aria-label="Vertical ruler; drag to create a vertical guide"
        onPointerDown={(event) => beginGuide('x', event)}
        style={{
          ...rulerBase,
          top: 20,
          bottom: 0,
          left: 0,
          width: 20,
          borderRightStyle: 'solid',
          borderRightWidth: 1,
          cursor: 'col-resize',
          padding: 0,
          overflow: 'hidden',
        }}
      >
        {verticalTicks.map((tick) => (
          <span
            key={tick.value}
            aria-hidden="true"
            data-ruler-axis="y"
            data-ruler-value={tick.value}
            style={{
              position: 'absolute',
              top: tick.screen,
              right: 0,
              width: tick.major ? 8 : 4,
              height: 1,
              background: tick.major ? 'rgba(255,255,255,.5)' : 'rgba(255,255,255,.28)',
              pointerEvents: 'none',
            }}
          >
            {tick.major && (
              <span
                style={{
                  position: 'absolute',
                  right: 4,
                  top: 3,
                  color: 'rgba(255,255,255,.62)',
                  font: '9px ui-monospace, SFMono-Regular, Menlo, monospace',
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                  writingMode: 'vertical-rl',
                  transform: 'rotate(180deg)',
                }}
              >
                {tick.value}
              </span>
            )}
          </span>
        ))}
      </button>
      <div style={{ ...rulerBase, left: 0, top: 0, width: 20, height: 20 }} />
    </>
  );
}

/** Standard 2D scene controls: transform tools on the left, display/framing
 * on the right, and zoom at the lower-right. All operate on the independent
 * editor camera; none changes the game's runtime camera or resolution. */
export function CanvasSceneControls({
  active,
  adapter,
  containerRef,
  view,
  documentId,
}: {
  active: boolean;
  adapter?: AuthoringAdapter;
  containerRef: RefObject<HTMLDivElement | null>;
  view: RootViewController;
  documentId: string;
}) {
  const store = useEditorStore();
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  useSyncExternalStore(subscribeViewportPresentation, viewportPresentationVersion);
  const showGrid = viewGridVisible(documentId);
  const pose = useSyncExternalStore(view.subscribe, view.get, view.get);
  const [mode, setMode] = useState<'pan' | 'ruler' | null>(null);

  const zoomAroundCenter = useCallback(
    (requestedZoom: number) => {
      const container = containerRef.current;
      if (!container) return;
      const zoom = Math.min(SCENE_MAX_ZOOM, Math.max(SCENE_MIN_ZOOM, requestedZoom));
      const cx = container.clientWidth / 2;
      const cy = container.clientHeight / 2;
      const worldX = (cx - pose.x) / pose.zoom;
      const worldY = (cy - pose.y) / pose.zoom;
      view.setView(cx - worldX * zoom, cy - worldY * zoom, zoom);
    },
    [containerRef, pose, view],
  );

  const rectsFor = useCallback(
    (ids: Iterable<string>): DOMRectLike[] => {
      if (!adapter?.rects) return [];
      const rects: DOMRectLike[] = [];
      for (const id of ids) {
        const rect = adapter.rects.rect(id);
        if (rect && rect.width > 0 && rect.height > 0) rects.push(rect);
      }
      return rects;
    },
    [adapter],
  );

  const frameSelection = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    frameBounds(container, view, unionRects(rectsFor(store.selectedEntityIds)));
  }, [containerRef, rectsFor, store, view]);

  // The zoom widget's first button (Godot's Center View): the game's viewport rectangle, or the
  // origin when the project declares no resolution, in the middle of the pane at this zoom.
  const centerView = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const now = view.get();
    const resolution = getCurrentProject()?.config.resolution;
    const cx = resolution ? resolution.width / 2 : 0;
    const cy = resolution ? resolution.height / 2 : 0;
    view.setView(container.clientWidth / 2 - cx * now.zoom, container.clientHeight / 2 - cy * now.zoom, now.zoom);
  }, [containerRef, view]);

  const centerSelection = useCallback(() => {
    const container = containerRef.current;
    const bounds = unionRects(rectsFor(store.selectedEntityIds));
    if (!container || !bounds) return;
    const now = view.get();
    view.setView(
      container.clientWidth / 2 - (bounds.x + bounds.width / 2) * now.zoom,
      container.clientHeight / 2 - (bounds.y + bounds.height / 2) * now.zoom,
      now.zoom,
    );
  }, [containerRef, rectsFor, store, view]);

  const frameScene = useCallback(() => {
    const container = containerRef.current;
    if (!container || !adapter) return;
    frameBounds(container, view, unionRects(rectsFor(collectAllNodeIds(adapter))));
  }, [adapter, containerRef, rectsFor, view]);

  // Focus is an editor action, not a Three-camera action. The native Canvas
  // Scene consumes the same hierarchy/hotkey commands as the Three Scene,
  // then resolves them through Pixi's own bounds and its independent 2D
  // editor camera. An inactive document stays MOUNTED, so only the active
  // Scene may respond.
  useEffect(() => {
    if (!active) return;
    return store.onViewportAction((action) => {
      if (action.type === 'focus-entity') {
        const container = containerRef.current;
        if (!container) return;
        frameBounds(container, view, unionRects(rectsFor([action.id])));
      } else if (action.type === 'focus-selection') {
        frameSelection();
      } else if (action.type === 'focus-scene') {
        frameScene();
      }
    });
  }, [active, containerRef, frameScene, frameSelection, rectsFor, store, view]);

  return (
    <>
      {/* The editor's one transient-hint channel renders per SCENE surface
       *  (the world root's stage mounts it for the three viewport). Without it here a
       *  canvas world had no hint surface at all, so a refused write — the
       *  declared-prop transform refusal — could only speak in the Console,
       *  which a user watching the board does not read (pass 65). */}
      <TransientHintOverlay />
      <ToolStrip dimensions="2d" />
      {mode ? <CanvasSceneModeLayer mode={mode} view={view} containerRef={containerRef} onExit={() => setMode(null)} /> : null}
      <FloatingToolbar
        label="2D scene display"
        className="vgai-viewport-toolbar vgai-viewport-toolbar-right"
        data-vgai-canvas-navigation-ignore="true"
      >
        <Tooltip text={`Grid: ${showGrid ? 'On' : 'Off'}`}>
          <IconButton
            aria-label="Toggle 2D grid"
            aria-pressed={showGrid}
            size="comfortable"
            onClick={() => setViewGridVisible(documentId, !showGrid)}
          >
            <EditorIcon icon={faBorderAll} size="md" />
          </IconButton>
        </Tooltip>
        <Button aria-label="Frame all" variant="ghost" size="comfortable" onClick={frameScene}>
          Frame all
        </Button>
        <Tooltip text="Pan (Space-drag pans in any mode)">
          <IconButton
            aria-label="Pan mode"
            aria-pressed={mode === 'pan'}
            size="comfortable"
            onClick={() => setMode(mode === 'pan' ? null : 'pan')}
          >
            <EditorIcon icon={faHand} size="md" />
          </IconButton>
        </Tooltip>
        <Tooltip text="Ruler: drag to measure distance and angle">
          <IconButton
            aria-label="Ruler mode"
            aria-pressed={mode === 'ruler'}
            size="comfortable"
            onClick={() => setMode(mode === 'ruler' ? null : 'ruler')}
          >
            <EditorIcon icon={faRulerCombined} size="md" />
          </IconButton>
        </Tooltip>
        <CanvasSceneLockButton adapter={adapter} selected={[...store.selectedEntityIds]} />
        <CanvasSceneGroupButton adapter={adapter} selected={[...store.selectedEntityIds]} />
        <CanvasSceneViewMenu
          documentId={documentId}
          view={view}
          hasSelection={store.selectedEntityIds.size > 0}
          onCenterSelection={centerSelection}
          onFrameSelection={frameSelection}
        />
      </FloatingToolbar>
      <FloatingToolbar
        label="2D scene navigation"
        className="vgai-canvas-scene-navigation"
        data-vgai-canvas-navigation-ignore="true"
      >
        <IconButton
          aria-label="Center view"
          title="Center view: the game's viewport in the middle of the pane, at this zoom"
          size="comfortable"
          onClick={centerView}
        >
          <EditorIcon icon={faExpand} size="md" />
        </IconButton>
        <IconButton
          aria-label="Zoom out"
          title="Zoom out"
          size="comfortable"
          onClick={() => zoomAroundCenter(pose.zoom / 1.2)}
        >
          <EditorIcon icon={faMagnifyingGlassMinus} size="md" />
        </IconButton>
        <Button
          variant="ghost"
          aria-label="Reset zoom to 100%"
          title="Reset zoom to 100%"
          size="comfortable"
          onClick={() => zoomAroundCenter(1)}
        >
          {Math.round(pose.zoom * 100)}%
        </Button>
        <IconButton
          aria-label="Zoom in"
          title="Zoom in"
          size="comfortable"
          onClick={() => zoomAroundCenter(pose.zoom * 1.2)}
        >
          <EditorIcon icon={faMagnifyingGlassPlus} size="md" />
        </IconButton>
      </FloatingToolbar>
    </>
  );
}

/**
 * THE 2D VIEW MENU — Godot's 2D View menu, the home of what the view draws and where it looks:
 * the grid, rulers, guides, origin and the game's viewport rectangle (each the view's own switch,
 * `overlays` in its presentation), then Center Selection, Frame Selection and Clear Guides.
 */
function CanvasSceneViewMenu({
  documentId,
  view,
  hasSelection,
  onCenterSelection,
  onFrameSelection,
}: {
  documentId: string;
  view: RootViewController;
  hasSelection: boolean;
  onCenterSelection: () => void;
  onFrameSelection: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useSyncExternalStore(subscribeViewportPresentation, viewportPresentationVersion);
  useSyncExternalStore(
    useCallback((listener) => subscribeCanvasSceneGuides(view, listener), [view]),
    useCallback(() => canvasSceneGuideRevision(view), [view]),
  );
  const drafting = viewDrafting(documentId);
  const switches: readonly { label: string; on: boolean; toggle: () => void }[] = [
    { label: 'Grid', on: viewGridVisible(documentId), toggle: () => setViewGridVisible(documentId, !viewGridVisible(documentId)) },
    { label: 'Rulers', on: drafting.rulers, toggle: () => setViewDrafting(documentId, { rulers: !drafting.rulers }) },
    { label: 'Guides', on: drafting.guides, toggle: () => setViewDrafting(documentId, { guides: !drafting.guides }) },
    { label: 'Origin', on: drafting.origin, toggle: () => setViewDrafting(documentId, { origin: !drafting.origin }) },
    { label: 'Viewport', on: drafting.viewport, toggle: () => setViewDrafting(documentId, { viewport: !drafting.viewport }) },
  ];
  const act = (run: () => void) => () => {
    run();
    setOpen(false);
  };
  return (
    <>
      <Button
        ref={triggerRef}
        aria-label="View"
        aria-haspopup="menu"
        aria-expanded={open}
        variant="ghost"
        size="comfortable"
        onClick={() => setOpen(!open)}
      >
        View
      </Button>
      {open && (
        <AnchoredMenu anchorRef={triggerRef} align="end" clamp aria-label="2D view" onDismiss={() => setOpen(false)}>
          {switches.map((entry) => (
            <MenuItem
              key={entry.label}
              role="menuitemcheckbox"
              aria-checked={entry.on}
              // Godot's menu closes on a checked item too (`hide_on_checkable_item_selection`).
              onSelect={act(entry.toggle)}
            >
              <span className="vgai-menu-check">{entry.on && <EditorIcon icon={faCheck} size="xs" />}</span>
              {`Show ${entry.label}`}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem disabled={!hasSelection} onSelect={act(onCenterSelection)}>
            <span className="vgai-menu-check" />
            Center Selection
          </MenuItem>
          <MenuItem disabled={!hasSelection} onSelect={act(onFrameSelection)}>
            <span className="vgai-menu-check" />
            Frame Selection
          </MenuItem>
          <MenuItem disabled={canvasSceneGuides(view).length === 0} onSelect={act(() => clearCanvasSceneGuides(view))}>
            <span className="vgai-menu-check" />
            Clear Guides
          </MenuItem>
        </AnchoredMenu>
      )}
    </>
  );
}

/**
 * Lock the selected node against selection and movement — Godot's 2D toolbar Lock, a shortcut to
 * the lock the hierarchy owns (`locked`, the same session-local flag its row toggles).
 */
function CanvasSceneLockButton({ adapter, selected }: { adapter: AuthoringAdapter | undefined; selected: readonly string[] }) {
  const id = selected.length === 1 ? selected[0]! : null;
  const locked = id !== null && adapter?.inspector?.get(id, 'locked') === true;
  const label = locked ? 'Unlock selected node' : 'Lock selected node';
  return (
    <Tooltip text={id ? label : 'Select one node to lock it'}>
      <IconButton
        aria-label={label}
        aria-pressed={locked}
        size="comfortable"
        disabled={id === null || !adapter?.inspector?.set}
        onClick={() => {
          if (id) adapter?.inspector?.set?.(id, 'locked', !locked);
        }}
      >
        <EditorIcon icon={locked ? faLock : faLockOpen} size="md" />
      </IconButton>
    </Tooltip>
  );
}

/**
 * Godot's Pan and Ruler modes: while one is on, this layer over the scene takes the pointer. Pan
 * drags the view with the primary button; Ruler draws the drag as a line and reads its length in
 * world units and its angle. Escape leaves the mode.
 */
function CanvasSceneModeLayer({
  mode,
  view,
  containerRef,
  onExit,
}: {
  mode: 'pan' | 'ruler';
  view: RootViewController;
  containerRef: RefObject<HTMLDivElement | null>;
  onExit: () => void;
}) {
  const pose = useSyncExternalStore(view.subscribe, view.get, view.get);
  const [measure, setMeasure] = useState<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);
  const worldAt = (clientX: number, clientY: number) => {
    const box = containerRef.current?.getBoundingClientRect();
    const now = view.get();
    const x = clientX - (box?.left ?? 0);
    const y = clientY - (box?.top ?? 0);
    return { x: (x - now.x) / now.zoom, y: (y - now.y) / now.zoom };
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = { clientX: event.clientX, clientY: event.clientY, pose: view.get() };
    const from = worldAt(event.clientX, event.clientY);
    if (mode === 'ruler') setMeasure({ from, to: from });
    const move = (next: PointerEvent) => {
      if (mode === 'pan') {
        view.setView(
          start.pose.x + next.clientX - start.clientX,
          start.pose.y + next.clientY - start.clientY,
          start.pose.zoom,
        );
      } else {
        setMeasure({ from, to: worldAt(next.clientX, next.clientY) });
      }
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  };
  const screen = (point: { x: number; y: number }) => ({ x: pose.x + point.x * pose.zoom, y: pose.y + point.y * pose.zoom });
  const length = measure ? Math.hypot(measure.to.x - measure.from.x, measure.to.y - measure.from.y) : 0;
  const angle = measure ? (Math.atan2(measure.to.y - measure.from.y, measure.to.x - measure.from.x) * 180) / Math.PI : 0;
  const a = measure ? screen(measure.from) : null;
  const b = measure ? screen(measure.to) : null;
  return (
    <div
      data-testid={`canvas-scene-${mode}-layer`}
      data-vgai-canvas-navigation-ignore="true"
      onPointerDown={onPointerDown}
      // Above the selection hit layer (z50), below the viewport toolbars.
      style={{ position: 'absolute', inset: 0, zIndex: 60, cursor: mode === 'pan' ? 'grab' : 'crosshair' }}
    >
      {a && b ? (
        <>
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ff5fa2" strokeWidth={1.5} />
          </svg>
          <div
            data-testid="canvas-scene-ruler-reading"
            style={{
              position: 'absolute',
              left: (a.x + b.x) / 2 + 8,
              top: (a.y + b.y) / 2 + 8,
              padding: '2px 6px',
              borderRadius: 4,
              background: 'rgba(24, 26, 30, .92)',
              color: '#fff',
              font: '11px ui-monospace, SFMono-Regular, Menlo, monospace',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {`${length.toFixed(1)} px · ${angle.toFixed(1)}° · Δ ${(measure!.to.x - measure!.from.x).toFixed(1)}, ${(measure!.to.y - measure!.from.y).toFixed(1)}`}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Group the selected node with its children — Godot's 2D toolbar Group: a click on any node inside
 * it then selects the group (`grouped`, beside `locked`; the hierarchy still reaches every child).
 */
function CanvasSceneGroupButton({ adapter, selected }: { adapter: AuthoringAdapter | undefined; selected: readonly string[] }) {
  const id = selected.length === 1 ? selected[0]! : null;
  const offered = id !== null && adapter?.inspector?.properties(id).some((property) => property.path === 'grouped') === true;
  const grouped = id !== null && adapter?.inspector?.get(id, 'grouped') === true;
  const label = grouped ? 'Ungroup selected node' : 'Group selected node with its children';
  return (
    <Tooltip text={id ? label : 'Select one node to group it'}>
      <IconButton
        aria-label={label}
        aria-pressed={grouped}
        size="comfortable"
        disabled={!offered || !adapter?.inspector?.set}
        onClick={() => {
          if (id) adapter?.inspector?.set?.(id, 'grouped', !grouped);
        }}
      >
        <EditorIcon icon={faLayerGroup} size="md" />
      </IconButton>
    </Tooltip>
  );
}
