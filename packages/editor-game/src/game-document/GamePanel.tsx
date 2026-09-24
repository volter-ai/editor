/**
 * THE GAME DOCUMENT'S PANEL — the container element a runtime mounts into,
 * with the device/letterbox presentation around it and the split-screen
 * instance slots beside it. This is what `live-document.ts` opens and what
 * every lane's `acquire()` waits for the commit of.
 *
 * It moved out of `components/CenterDocuments.tsx` when Play left the host
 * (WORK.md §The workbench, P3b). The panel reports its container through the
 * door (`workspace.liveDocument.setContainer` / `.releaseContainer`); the
 * editor internals it still reads are reached through the `@editor/*` alias.
 */

import {
  getMountFailureReports,
  subscribeToMountFailures,
} from '@volter/editor-sdk/kit/mount-failure-report';
import { SurfaceStateOverlay } from '@volter/editor-core/components/SurfaceStateOverlay';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { useEditorStore } from '@volter/editor-core/editor-runtime';
import { getCurrentProject, onProjectChange } from '@volter/editor-core/project-manager';
import { readinessFacet, subscribeRootReadiness } from '@volter/editor-sdk/kit/readiness';
import { domHasRenderableContent } from '../host/surface-content';
import { explainSurface } from '@volter/editor-sdk/kit/surface-state';
import { editorHost } from '@volter/editor-sdk/host';
import { themeVars } from '@volter/editor-sdk/widgets';
import {
  fitPresentation,
  type PresentedSize,
  resolvePresentedSize,
} from '@volter/game-runtime/runtime/presentation';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { activeIngest } from '../ingest/active-ingest';
import {
  desiredExtraInstances,
  focusedInstanceId,
  gameRootSurfaceFacts,
  instanceNameAt,
  isPlayModeActive,
  mountAdditionalInstance,
  primaryInstanceId,
  resizeGame,
  setFocusedInstance,
  subscribeExtraInstances,
  subscribeFocusedInstance,
  subscribeGameSession,
  unmountAdditionalInstance,
} from '../play/play-mode';
import {
  attachDeviceTouchTarget,
  detachDeviceTouchTarget,
  devicePreset,
  devicePreviewVersion,
  hostDefaultPixelRatio,
  restoreDevicePresetForProject,
  subscribeDevicePreview,
} from './device-preview';
import {
  applyGameDevicePreset,
  gameDocumentResolution,
  gameViewVersion,
  notifyGameView,
  setGameScale,
  subscribeGameView,
} from './game-view-store';

/** The play-mode-owned children of a game mount container: stamped root
 * surfaces (stacked canvases + React DOM layers). */
export function collectGameSurfaces(container: HTMLElement): Element[] {
  return Array.from(container.children).filter(
    (node) => (node as HTMLElement).dataset?.['vgaiRootSurface'] === 'true',
  );
}

/** Re-adopt stashed game surfaces (in order — surface stacking IS DOM order)
 *  into a freshly mounted container; also drains `prev` if it is somehow
 *  still live in the same call (defensive, see `canvasRef` below). */
function adoptGameSurfaces(el: HTMLElement, stash: Element[], prev: HTMLElement | null): void {
  for (const node of stash) {
    if (!node.contains(el)) el.appendChild(node);
  }
  if (prev) {
    for (const node of collectGameSurfaces(prev)) el.appendChild(node);
  }
}

/** Game panel — a container div that play-mode.ts fills with a canvas. */
/**
 * One split-screen viewport for an instance mounted BESIDE the primary
 * (multiplayer authoring). Container-first, because play-mode must never own a
 * detached DOM node (the same reason the primary's mount is a React ref): on
 * attach it asks play-mode to `mountAdditionalInstance` into this element; on
 * detach it tears that instance down. The async mount is guarded so a viewport
 * unmounted before its mount resolves still cleans up, and
 * `unmountAdditionalInstance` is idempotent so `exitPlayMode`'s bulk teardown
 * and this per-viewport teardown can both fire for one instance.
 */
/** The instance's name bar — a header STRIP above the view (chrome, not an
 *  overlay) so the "Instance 1"/"Instance 2" label never covers game pixels. */
function InstanceNameBar({ name }: { name: string }) {
  return (
    <div
      data-testid="game-instance-name"
      style={{
        flex: '0 0 auto',
        padding: '3px 10px',
        background: themeVars.surface.chrome,
        color: themeVars.content.primary,
        borderBottom: `1px solid ${themeVars.boundary.default}`,
        fontSize: 11,
        fontWeight: 600,
        userSelect: 'none',
      }}
    >
      {name}
    </div>
  );
}

/** A split slot: the name bar above, its game area below. Shared by the primary
 *  and every extra viewport so both frame their game identically. `focused`
 *  draws the keyboard-focus ring; `onFocus` fires on a click anywhere in the
 *  slot so a player picks which seat the keyboard drives. */
function InstanceSlot({
  name,
  testId,
  borderLeft,
  focused,
  onFocus,
  children,
}: {
  name: string;
  testId: string;
  borderLeft?: boolean;
  focused?: boolean | undefined;
  onFocus?: (() => void) | undefined;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      data-focused={focused || undefined}
      // Pointer-down (not click) so focus lands before the game consumes the
      // event; capture so it fires even though the game canvas is inside.
      onPointerDownCapture={onFocus}
      style={{
        flex: 1,
        // min-width:0 lets flex actually divide the row; without it a flex item
        // refuses to shrink below its content's min size.
        minWidth: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        cursor: onFocus && !focused ? 'pointer' : undefined,
        ...(borderLeft ? { borderLeft: `1px solid ${themeVars.boundary.default}` } : {}),
      }}
    >
      <InstanceNameBar name={name} />
      {/* The game area — min-height:0 is the column-flex sibling of the row's
          min-width:0, letting this shrink so the bar is never squeezed out. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </div>
      {/* Keyboard/runtime-focus ring — the editor accent is the established
          selected-context color across 2D/3D viewports. Inset so it never
          shifts layout or eats pointer events. */}
      {focused && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            // Above the game canvas/DOM layers (which set their own stacking),
            // or the ring hides behind the running game.
            zIndex: 40,
            border: `2px solid ${themeVars.accent.default}`,
            boxShadow: `inset 0 0 0 1px ${themeVars.accent.default}`,
          }}
        />
      )}
    </div>
  );
}

function InstanceViewport({ index }: { index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // index 0 is the primary, so an extra viewport at list-index `index` is
  // instance `index + 1`.
  const name = instanceNameAt(index + 1);
  // An additional instance can only mount ONCE the primary session is live —
  // `mountAdditionalInstance` throws otherwise. At play-start the split slot
  // renders as soon as `playState` flips to 'playing', ~a frame before the
  // primary's async composition finishes mounting, so this effect must WAIT for
  // the primary and re-run when it arrives. `subscribeGameSession` fires when
  // the primary mounts (and on stop); gating on it — instead of mounting the
  // extra eagerly — is what stops the "no primary play session is running" error.
  const primaryLive = useSyncExternalStore(subscribeGameSession, isPlayModeActive);
  const [mountedId, setMountedId] = useState<string | null>(null);
  const focused = useSyncExternalStore(subscribeFocusedInstance, focusedInstanceId);
  useEffect(() => {
    const el = ref.current;
    if (!el || !primaryLive) return;
    let id: string | null = null;
    let disposed = false;
    void mountAdditionalInstance(el, name).then(
      (mid) => {
        if (disposed) unmountAdditionalInstance(mid);
        else {
          id = mid;
          setMountedId(mid);
        }
      },
      (err) => {
        // A failed extra instance is a real defect a human must see, not a
        // silently blank panel.
        editorConsole.error(`Failed to mount ${name}: ${err}`, 'play-mode');
      },
    );
    return () => {
      disposed = true;
      setMountedId(null);
      if (id) unmountAdditionalInstance(id);
    };
    // `name` is derived from index and stable for this slot; index is the key.
    // `primaryLive` gates the mount on the primary session existing.
  }, [index, primaryLive]);
  return (
    <InstanceSlot
      name={name}
      testId={`game-instance-slot-${index + 1}`}
      borderLeft
      focused={mountedId != null && focused === mountedId}
      onFocus={mountedId ? () => setFocusedInstance(mountedId) : undefined}
    >
      <div ref={ref} data-vgai-instance-viewport="" style={{ position: 'absolute', inset: 0 }} />
    </InstanceSlot>
  );
}

export function GamePanel({ style }: { style?: React.CSSProperties }) {
  const project = useSyncExternalStore(onProjectChange, getCurrentProject);
  const store = useEditorStore();
  const isRunning = store.playState !== 'stopped';
  const outerRef = useRef<HTMLDivElement>(null);
  // Resolution comes from the shared game-view store above — the
  // document-local toolbar writes it, this content applies it.
  useSyncExternalStore(subscribeGameView, gameViewVersion);
  // The device preset (DPR / safe-area / touch emulation) rides on top of
  // the resolution mechanism — the preset's CSS resolution is written INTO
  // `_gameResolution` by `applyGameDevicePreset`, so all letterbox/scale
  // math below is unchanged.
  useSyncExternalStore(subscribeDevicePreview, devicePreviewVersion);
  // Multiplayer authoring: how many instances BESIDE the primary to show
  // split-screen. 0 (the common case) renders exactly as before — no wrapper,
  // no layout change, so the device-preview path is untouched.
  const extraInstances = useSyncExternalStore(subscribeExtraInstances, desiredExtraInstances);
  // The split is decided by the INSTANCE COUNT alone. This document exists
  // only while a runtime is live or booting, and play-mode captures the
  // primary container BEFORE it flips the play state: gating the split on
  // `isRunning` mounted the bare container first, then re-rendered it into a
  // slot once the state flipped — React threw the captured element away and
  // the primary's runtime appended its canvas into a detached node, so
  // instance 1 stayed dark for the whole session while instance 2 rendered
  // (runhuman pass 143; traced append-by-append on production build 67).
  const showSplit = extraInstances > 0;
  // Which seat the keyboard drives (for the primary slot's focus ring/click).
  const focusedId = useSyncExternalStore(subscribeFocusedInstance, focusedInstanceId);
  const preset = devicePreset();
  const resolution = gameDocumentResolution();
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [contentProbe, setContentProbe] = useState(0);
  const prevRef = useRef<HTMLDivElement | null>(null);
  const rootReadiness = useSyncExternalStore(subscribeRootReadiness, readinessFacet);
  const mountFailures = useSyncExternalStore(subscribeToMountFailures, getMountFailureReports);
  const gameFacts = gameRootSurfaceFacts();
  const ingest = activeIngest();
  const gameRootIds =
    gameFacts.length > 0
      ? gameFacts.map((fact) => fact.rootId)
      : ingest
        ? [ingest.worldId]
        : rootReadiness
            .filter((entry) => entry.mechanism === 'host-mount')
            .map((entry) => entry.rootId);
  const mountedContainerHasContent = Boolean(
    prevRef.current && domHasRenderableContent(prevRef.current),
  );
  const gameHasContent =
    gameFacts.length > 0
      ? gameFacts.some((fact) => fact.hasRenderableContent)
      : mountedContainerHasContent;
  const rootsMounted = gameFacts.length > 0 || ingest !== null;
  const gameExplanation = isRunning
    ? explainSurface({
        surface: 'Game',
        rootIds: gameRootIds,
        phase: rootsMounted ? 'ready' : 'loading',
        content: rootsMounted ? (gameHasContent ? 'present' : 'empty') : 'unknown',
        readiness: rootReadiness,
        failures: mountFailures,
      })
    : null;

  // A setup may intentionally finish before its first visible object appears.
  // Re-check only while the mounted composition is empty; once pixels exist,
  // the overlay is gone and this probe stops entirely.
  useEffect(() => {
    if (!isRunning || !rootsMounted || gameHasContent) return;
    const timeout = window.setTimeout(() => setContentProbe((value) => value + 1), 250);
    return () => window.clearTimeout(timeout);
  }, [contentProbe, gameHasContent, isRunning, rootsMounted]);

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => setContentProbe((value) => value + 1));
    observer.observe(outer, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  // W2c: per-project persisted device preset — restore once per workspace
  // mount (project switches tear the whole workspace down, so this re-runs
  // with the new project's stored choice).
  useEffect(() => {
    const restored = restoreDevicePresetForProject();
    if (restored.width !== null) {
      applyGameDevicePreset(restored);
      notifyGameView();
    }
  }, []);

  // Callback ref so setGameContainer is called even when the element swaps
  // (fill ↔ device). React detaches the OLD element's ref (`null`) before the
  // new element's ref fires, so the live game canvases must be STASHED at
  // detach time and re-adopted at attach time. A single `if (prevRef.current
  // && el)` move branch cannot work here — both sides are never non-null in
  // the same call — and switching resolution DURING play would silently drop
  // the running game's canvases with the removed element. Only nodes the game
  // HOST mounted are
  // stashed (world surfaces carry `data-vgai-root-surface`): the fill/device branches are keyed below so
  // React really remounts, but if it ever aliases the container DOM node
  // again, a blind childNodes copy would capture React-owned children too —
  // that exact aliasing put the incoming inner div in the stash and made
  // `appendChild` throw a cycle error (first run of this fix).
  const orphanedGameNodes = useRef<Element[]>([]);
  const canvasRef = useCallback((el: HTMLDivElement | null) => {
    if (el === prevRef.current) return;
    if (!el && prevRef.current) {
      // Old container is being unmounted — rescue the play-mode-owned
      // canvases/DOM layers before the element leaves the document.
      orphanedGameNodes.current = collectGameSurfaces(prevRef.current);
    }
    if (el) {
      adoptGameSurfaces(el, orphanedGameNodes.current, prevRef.current);
      orphanedGameNodes.current = [];
    }
    const prev = prevRef.current;
    prevRef.current = el;
    // ATTACH names the element; DETACH names the element it lets go of. A
    // bare `setGameContainer(null)` here is what a STALE panel's cleanup used
    // to run AFTER the replacing panel had already attached — two GamePanels
    // coexist across a close/reopen gesture, and React orders their refs by
    // its own schedule, not by which panel is current. `releaseGameContainer`
    // is keyed so only the owner can empty the slot (see its doc for the
    // measured mount refusal).
    if (el) editorHost().workspace.liveDocument.setContainer(el);
    else if (prev) editorHost().workspace.liveDocument.releaseContainer(prev);
    // W2c: the same element is the pointer-as-touch emulation seam — same
    // ownership rule on detach.
    if (el) attachDeviceTouchTarget(el);
    else if (prev) detachDeviceTouchTarget(prev);
  }, []);

  // Track outer container size for scale calculation
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setContainerSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Resize the game renderer when resolution or container size changes.
  // W2c: a device preset also pins the renderer pixel ratio; without one we
  // pass the host default explicitly so leaving a preset restores it.
  // (`isRunning` is a dep so the DPR re-lands on a session that restarts at
  // an unchanged size; the boot-time application lives in `enterPlayMode`,
  // which consults `deviceEmulatedPixelRatio()` once the session exists.)
  // What size this game is PRESENTED at. Two things can name one and the precedence lives in
  // `resolvePresentedSize`: a device preset the user picked wins, and otherwise the project's own
  // declared `resolution` (`vgai.project.json`) puts the game on screen at its authored logical
  // size, uniformly scaled and letterboxed by the branch below — presentation scaling, never a
  // stretch mode. A project that declares neither fills the panel exactly as before.
  const declaredResolution = project?.config.resolution;
  const presented: PresentedSize = resolvePresentedSize(resolution, declaredResolution);
  const isFill = presented.kind === 'fill';
  // Under split the primary renders FILL (each instance owns an equal slot);
  // the device/logical letterbox is a single-instance authoring aid, and its
  // fixed-size wrapper would otherwise dominate the flex row (min-width:auto)
  // and starve the extra slots to 0 (the live-verified failure mode).
  const primaryFill = isFill || showSplit;
  const logicalWidth = presented.kind === 'logical' ? presented.width : null;
  const logicalHeight = presented.kind === 'logical' ? presented.height : null;
  const presetDpr = preset.dpr;
  useEffect(() => {
    const dpr = presetDpr ?? hostDefaultPixelRatio();
    if (showSplit) {
      // The primary fills its equal slot (width / instance count). Size its
      // render buffer to that slot so it is not horizontally squished, rather
      // than to the full panel.
      if (containerSize.width > 0 && containerSize.height > 0) {
        resizeGame(containerSize.width / (extraInstances + 1), containerSize.height, dpr);
      }
    } else if (logicalWidth === null || logicalHeight === null) {
      // Fill mode: resize to match available container space
      if (containerSize.width > 0 && containerSize.height > 0) {
        resizeGame(containerSize.width, containerSize.height, dpr);
      }
    } else {
      // The game renders AT its logical size — that is what makes the camera's aspect and the DOM
      // overlay's design pixels the ones the game was authored against. The panel-fitting is the
      // CSS transform below, not a different render size.
      resizeGame(logicalWidth, logicalHeight, dpr);
    }
  }, [
    logicalWidth,
    logicalHeight,
    containerSize.width,
    containerSize.height,
    presetDpr,
    isRunning,
    showSplit,
    extraInstances,
  ]);

  // Fit the logical rect into the available space. A device preview never upscales (you are
  // looking at the device's own pixels); a declared resolution does, or a small game sits as a
  // postage stamp in a maximized panel.
  const fit = fitPresentation(
    containerSize,
    { width: logicalWidth ?? 0, height: logicalHeight ?? 0 },
    { allowUpscale: presented.kind === 'logical' && presented.allowUpscale },
  );
  const scale = isFill ? 1 : fit.scale;
  // Publish for the toolbar's percentage readout (effect: setState-in-render
  // on ANOTHER component's store is a React error; post-commit is correct).
  useEffect(() => {
    setGameScale(scale);
  }, [scale]);

  // Safe-area contract: the game MOUNT container always carries the
  // inset CSS vars (0px unless the active preset declares insets), so game
  // UI can style with `var(--vgai-safe-area-inset-top, 0px)` etc. Real
  // `env(safe-area-inset-*)` cannot be injected from a same-document host
  // (env() is UA-supplied for the top-level viewport only) — the vars + the
  // visual overlay below ARE the emulation.
  const safeArea = preset.safeArea;
  const safeAreaVars = {
    '--vgai-safe-area-inset-top': `${safeArea?.top ?? 0}px`,
    '--vgai-safe-area-inset-right': `${safeArea?.right ?? 0}px`,
    '--vgai-safe-area-inset-bottom': `${safeArea?.bottom ?? 0}px`,
    '--vgai-safe-area-inset-left': `${safeArea?.left ?? 0}px`,
  } as React.CSSProperties;

  return (
    <div style={{ overflow: 'hidden', position: 'relative', flexDirection: 'column', ...style }}>
      <div
        ref={outerRef}
        style={{
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {(() => {
          // The primary mount, unchanged. Split-screen (multiplayer authoring)
          // renders it as the FIRST slot of a flex row and adds one
          // `InstanceViewport` per extra instance; with no extras this returns
          // it bare, so the single-instance layout and its device-preview path
          // are byte-for-byte what they were.
          const primaryMount = primaryFill ? (
            <div
              key="game-mount-fill"
              ref={canvasRef}
              data-testid="game-runtime-container"
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                // INHERIT, never assert `visible`. Every panel in this
                // workspace is a rect-synced overlay sharing one z-index, so
                // The layout host expresses "this tab is not the one on screen" as
                // `visibility: hidden` on the panel's overlay ancestor and
                // nothing else. `visibility` is inherited, and a descendant
                // that names `visible` re-shows itself out of a hidden
                // ancestor — which is how a running game came to paint over
                // whichever panel the reader was actually looking at. Stating
                // only the hidden half leaves the ancestor's word final.
                ...(isRunning ? {} : { visibility: 'hidden' as const }),
                ...safeAreaVars,
              }}
            />
          ) : (
            /* Wrapper sized to the scaled dimensions so flexbox centering works.
             The inner canvasRef is full device resolution, CSS-scaled down.
             Keyed (like the fill branch) so the fill ↔ device switch REMOUNTS
             instead of morphing one DOM node into the other — the canvasRef
             stash/adopt handoff above depends on a real detach/attach pair. */
            <div
              key="game-mount-device"
              style={{
                position: 'relative',
                width: fit.width,
                height: fit.height,
                overflow: 'hidden',
                // Inherit while running — see the fill branch above.
                ...(isRunning ? {} : { visibility: 'hidden' as const }),
              }}
            >
              <div
                ref={canvasRef}
                data-testid="game-runtime-container"
                aria-hidden="true"
                style={{
                  width: logicalWidth ?? 0,
                  height: logicalHeight ?? 0,
                  transformOrigin: 'top left',
                  transform: `scale(${scale})`,
                  ...safeAreaVars,
                }}
              />
              {/* W2c: visual safe-area (notch / home-indicator) bands — a
                SIBLING of the mount container (play-mode owns that element's
                children), scaled-space sized, hit-transparent. */}
              {safeArea && (
                <div
                  data-testid="device-safe-area-overlay"
                  style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}
                >
                  {(
                    [
                      [
                        'top',
                        safeArea.top,
                        { top: 0, left: 0, right: 0, height: safeArea.top * scale },
                      ],
                      [
                        'bottom',
                        safeArea.bottom,
                        { bottom: 0, left: 0, right: 0, height: safeArea.bottom * scale },
                      ],
                      [
                        'left',
                        safeArea.left,
                        { top: 0, bottom: 0, left: 0, width: safeArea.left * scale },
                      ],
                      [
                        'right',
                        safeArea.right,
                        { top: 0, bottom: 0, right: 0, width: safeArea.right * scale },
                      ],
                    ] as const
                  ).map(([side, inset, rect]) =>
                    inset > 0 ? (
                      <div
                        key={side}
                        data-testid={`device-safe-area-${side}`}
                        style={{
                          position: 'absolute',
                          ...rect,
                          background: themeVars.semantic.dangerFaint,
                          boxShadow: `inset 0 0 0 1px ${themeVars.semantic.dangerMuted}`,
                        }}
                      />
                    ) : null,
                  )}
                </div>
              )}
            </div>
          );
          if (!showSplit) return primaryMount;
          // Flex row: primary first, then one viewport per extra instance. The
          // primary keeps its own positioning inside a relative slot.
          return (
            <>
              <InstanceSlot
                name={instanceNameAt(0)}
                testId="game-instance-slot-0"
                focused={focusedId === primaryInstanceId()}
                onFocus={() => setFocusedInstance(primaryInstanceId())}
              >
                {primaryMount}
              </InstanceSlot>
              {Array.from({ length: extraInstances }, (_v, i) => (
                <InstanceViewport key={i} index={i} />
              ))}
            </>
          );
        })()}
        {!isRunning && (
          <div
            data-testid="game-stopped-placeholder"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              background: themeVars.surface.shell,
              color: themeVars.content.dim,
              fontSize: 11,
              pointerEvents: 'none',
            }}
          >
            <span style={{ color: themeVars.content.primary, fontSize: 13 }}>Game is stopped</span>
            <span>Press Play to start the composed runtime.</span>
          </div>
        )}
        {isRunning && (
          <SurfaceStateOverlay
            explanation={gameExplanation}
            testId="game-surface-status"
            style={{ zIndex: 30, background: themeVars.surface.shell }}
          />
        )}
      </div>
      {/* Transport lives in the global command header (`ProjectHeader.tsx`),
          not here, so it is document-independent; device, resolution,
          shading, and render-debug controls stay in this document's local
          toolbar. */}
    </div>
  );
}
