import {
  faExpand,
  faMagnifyingGlassMinus,
  faMagnifyingGlassPlus,
  faRotate,
} from '@fortawesome/free-solid-svg-icons';
import {
  AnchoredMenu,
  Button,
  EditorIcon,
  FloatingToolbar,
  IconButton,
  MenuItem,
  MenuSeparator,
  Select,
  TextInput,
} from '@volter/editor-sdk/widgets';
import { type RefObject, useCallback, useRef, useState, useSyncExternalStore } from 'react';
import {
  fitReactStoryBoard,
  getReactStoryBoardViewport,
  type ReactStoryBoardViewportState,
  setActiveReactStoryBoardViewport,
  subscribeReactStoryBoardViewport,
  toggleActiveReactStoryBoardViewportRotation,
} from '@volter/editor-sdk/kit/authoring/react-story-board';
import type { ViewportToolContext } from '@volter/editor-sdk/kit/authoring/viewport-tool-context';
import {
  getRootCanvasViewport,
  setRootCanvasViewport,
  subscribeRootCanvasViewport,
} from '@volter/editor-sdk/kit/world-canvas-viewport-state';
import {
  getRootPan,
  panTransformValue,
  setRootView,
  subscribeRootPan,
} from '@volter/editor-sdk/kit/world-pan-state';
import { useEditorStore } from '@volter/editor-sdk/kit/editor-runtime';

const VIEWPORT_PRESETS = {
  fill: null,
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const;

function ResponsiveViewportControls({
  boardViewport,
  containerRef,
  selectViewport,
  viewportValue,
}: {
  boardViewport: ReactStoryBoardViewportState | null;
  containerRef: RefObject<HTMLDivElement | null>;
  selectViewport(preset: string): void;
  viewportValue: string;
}) {
  return (
    <>
      <Select
        aria-label="Responsive viewport"
        title={
          boardViewport?.locked
            ? 'Viewport is locked by this story’s globals.viewport'
            : 'Responsive viewport'
        }
        value={viewportValue}
        disabled={boardViewport?.locked === true}
        onChange={(event) => selectViewport(event.target.value)}
        className="vgai-react-viewport-select"
      >
        <option value="fill">Responsive</option>
        {boardViewport ? (
          boardViewport.choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label} · {choice.width}×{choice.height}
            </option>
          ))
        ) : (
          <>
            <option value="desktop">Desktop · 1440×900</option>
            <option value="tablet">Tablet · 768×1024</option>
            <option value="mobile">Mobile · 390×844</option>
          </>
        )}
      </Select>
      {boardViewport && (
        <IconButton
          aria-label="Rotate viewport"
          title={
            boardViewport.locked
              ? 'Viewport is locked by this story’s globals.viewport'
              : 'Rotate viewport'
          }
          size="comfortable"
          disabled={boardViewport.locked}
          onClick={() => toggleActiveReactStoryBoardViewportRotation(containerRef.current)}
        >
          <EditorIcon icon={faRotate} size="md" />
        </IconButton>
      )}
    </>
  );
}

export function ReactCanvasControls({
  containerRef,
  context,
  boardOnly = false,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  context: ViewportToolContext | null;
  /** Fixed-pixel component boards need only the common Figma-style camera
   * controls. Responsive presets and entity framing belong to DOM authoring. */
  boardOnly?: boolean;
}) {
  const store = useEditorStore();
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const view = useSyncExternalStore(subscribeRootPan, getRootPan);
  const viewport = useSyncExternalStore(subscribeRootCanvasViewport, getRootCanvasViewport);
  const boardViewport = useSyncExternalStore(
    subscribeReactStoryBoardViewport,
    () => getReactStoryBoardViewport(containerRef.current),
    () => null,
  );

  const zoomAroundCenter = useCallback(
    (requestedZoom: number) => {
      const container = containerRef.current;
      if (!container) return;
      const zoom = Math.min(4, Math.max(0.1, requestedZoom));
      const cx = container.clientWidth / 2;
      const cy = container.clientHeight / 2;
      const worldX = (cx - view.x) / view.zoom;
      const worldY = (cy - view.y) / view.zoom;
      setRootView(cx - worldX * zoom, cy - worldY * zoom, zoom);
    },
    [containerRef, view],
  );

  const zoomToSelection = useCallback(() => {
    const container = containerRef.current;
    const selectedId = [...store.selectedEntityIds].at(-1);
    if (!container || !selectedId) return;
    const rect = context?.adapter.rects?.rect(selectedId);
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const availableWidth = Math.max(1, container.clientWidth - 96);
    const availableHeight = Math.max(1, container.clientHeight - 96);
    const zoom = Math.min(
      4,
      Math.max(0.1, Math.min(availableWidth / rect.width, availableHeight / rect.height)),
    );
    setRootView(
      container.clientWidth / 2 - (rect.x + rect.width / 2) * zoom,
      container.clientHeight / 2 - (rect.y + rect.height / 2) * zoom,
      zoom,
    );
  }, [containerRef, context, store]);

  const selectViewport = useCallback(
    (preset: string) => {
      const container = containerRef.current;
      if (boardViewport) {
        setActiveReactStoryBoardViewport(container, preset === 'fill' ? null : preset);
        return;
      }
      const size = VIEWPORT_PRESETS[preset as keyof typeof VIEWPORT_PRESETS];
      if (!container || size === null) {
        setRootCanvasViewport(null, null);
        setRootView(0, 0, 1);
        return;
      }
      setRootCanvasViewport(size.width, size.height);
      const zoom = Math.min(
        1,
        Math.max(
          0.1,
          Math.min(
            (container.clientWidth - 96) / size.width,
            (container.clientHeight - 96) / size.height,
          ),
        ),
      );
      setRootView(
        (container.clientWidth - size.width * zoom) / 2,
        (container.clientHeight - size.height * zoom) / 2,
        zoom,
      );
    },
    [boardViewport, containerRef],
  );

  const fitBoard = useCallback(() => {
    const container = containerRef.current;
    if (container) fitReactStoryBoard(container);
  }, [containerRef]);

  const hasStoryBoard = boardViewport !== null;
  const hasDomAuthoring = context?.kind === 'dom' && Boolean(context.adapter.rects);
  if (boardOnly ? !hasStoryBoard : !hasDomAuthoring) return null;

  const viewportValue = boardViewport
    ? (boardViewport.selectedViewportId ?? 'fill')
    : (Object.entries(VIEWPORT_PRESETS).find(([, size]) =>
        size === null
          ? viewport.width === null
          : size.width === viewport.width && size.height === viewport.height,
      )?.[0] ?? 'fill');

  return (
    <>
      {!hasStoryBoard && viewport.width !== null && viewport.height !== null && (
        <div
          data-testid="react-canvas-device-frame"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            zIndex: 0,
            width: viewport.width,
            height: viewport.height,
            transform: panTransformValue(view),
            transformOrigin: '0 0',
            pointerEvents: 'none',
            background: '#fff',
            boxShadow: '0 0 0 1px #ffffff40, 0 8px 30px #0009',
          }}
        />
      )}
      <FloatingToolbar
        label={boardOnly ? '2D component board view' : 'React canvas view'}
        data-testid={boardOnly ? 'canvas-board-zoom-controls' : 'react-canvas-zoom-controls'}
        data-vgai-canvas-navigation-ignore="true"
        className="vgai-react-canvas-controls"
      >
        {!boardOnly && (
          <ResponsiveViewportControls
            boardViewport={boardViewport}
            containerRef={containerRef}
            selectViewport={selectViewport}
            viewportValue={viewportValue}
          />
        )}
        {hasStoryBoard && (
          <Button
            variant="ghost"
            aria-label="Fit story board"
            title="Fit all stories"
            size="comfortable"
            onClick={fitBoard}
          >
            Fit board
          </Button>
        )}
        <IconButton
          aria-label="Zoom out"
          title="Zoom out"
          size="comfortable"
          onClick={() => zoomAroundCenter(view.zoom / 1.2)}
        >
          <EditorIcon icon={faMagnifyingGlassMinus} size="md" />
        </IconButton>
        <ZoomMenu
          zoom={view.zoom}
          zoomTo={zoomAroundCenter}
          {...(hasStoryBoard ? { fit: fitBoard } : {})}
          {...(!boardOnly && store.selectedEntityIds.size > 0 ? { toSelection: zoomToSelection } : {})}
        />
        <IconButton
          aria-label="Zoom in"
          title="Zoom in"
          size="comfortable"
          onClick={() => zoomAroundCenter(view.zoom * 1.2)}
        >
          <EditorIcon icon={faMagnifyingGlassPlus} size="md" />
        </IconButton>
        {!boardOnly && (
          <IconButton
            aria-label="Zoom to selection"
            title="Zoom to selection"
            size="comfortable"
            onClick={zoomToSelection}
          >
            <EditorIcon icon={faExpand} size="md" />
          </IconButton>
        )}
      </FloatingToolbar>
    </>
  );
}

/**
 * Figma's zoom menu, opened from the zoom percentage: the zoom typed as a percentage, Zoom in and
 * out, Zoom to fit, 50%, 100% and 200%, and Zoom to selection when there is one.
 */
function ZoomMenu({
  zoom,
  zoomTo,
  fit,
  toSelection,
}: {
  zoom: number;
  zoomTo: (zoom: number) => void;
  fit?: () => void;
  toSelection?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const act = (run: () => void) => () => {
    run();
    setOpen(false);
  };
  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        aria-label="Zoom"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Zoom"
        size="comfortable"
        onClick={() => setOpen(!open)}
      >
        {Math.round(zoom * 100)}%
      </Button>
      {open && (
        <AnchoredMenu anchorRef={triggerRef} align="end" clamp aria-label="Zoom" onDismiss={() => setOpen(false)}>
          <div style={{ padding: '4px 8px' }}>
            <TextInput
              aria-label="Zoom percentage"
              defaultValue={String(Math.round(zoom * 100))}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                const percent = Number.parseFloat(event.currentTarget.value);
                if (Number.isFinite(percent) && percent > 0) {
                  zoomTo(percent / 100);
                  setOpen(false);
                }
              }}
            />
          </div>
          <MenuSeparator />
          <MenuItem onSelect={act(() => zoomTo(zoom * 1.2))}>Zoom in</MenuItem>
          <MenuItem onSelect={act(() => zoomTo(zoom / 1.2))}>Zoom out</MenuItem>
          {fit ? <MenuItem onSelect={act(fit)}>Zoom to fit</MenuItem> : null}
          {toSelection ? <MenuItem onSelect={act(toSelection)}>Zoom to selection</MenuItem> : null}
          <MenuSeparator />
          {[0.5, 1, 2].map((preset) => (
            <MenuItem key={preset} onSelect={act(() => zoomTo(preset))}>{`Zoom to ${preset * 100}%`}</MenuItem>
          ))}
        </AnchoredMenu>
      )}
    </>
  );
}
