/**
 * THE VIEWPORT'S FURNITURE — what every 3D area carries besides its content
 * (Blender's 3D Viewport: the view text at the top-left, "User Perspective"
 * over the collection and active object; the navigation cluster under the
 * axis gizmo at the top-right — zoom, pan, frame, projection). Drawn by the
 * 3D document host (`StageHost`) over its stage for every
 * document with chrome; nothing here holds state of its own. Hidden while the
 * host has no viewport yet.
 *
 * WHICH OBJECT A BUTTON DRIVES IS THE QUESTION TO ASK BEFORE ADDING ONE.
 * `StageHost` is this component's only caller and every stage it hosts is
 * painted by `Object3DDocumentSession.renderViewport` — through
 * `session.camera()`, not through `viewport.renderCamera`. So a verb whose
 * effect is the CAMERA'S POSE reaches the picture through the viewport (the
 * session's cameras are derived from that pose every frame), while a verb
 * that changes WHICH camera paints must go to the session. The projection
 * button got that wrong and was inert everywhere it was drawn; see its own
 * comment below for the measurement, and do not route a new control to
 * `viewport.*` without checking which side of that line it falls on.
 */
import type { ToolCameraView, ToolViewportStatistic } from '../../object3d-contributions';
import {
  EditorIcon,
  editorIcons,
  IconButton,
  spaceVar,
  Tooltip,
  themeVars,
} from '@volter/editor-sdk/widgets';
import { Fragment, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { axisViewName } from '../asset-workflow/model-inspection';
import type { Object3DDocumentSession } from '../authoring/object3d-document-session';
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import {
  COMPASS_CENTER_RIGHT_PX,
  COMPASS_CLUSTER_TOP_PX,
  COMPASS_INK_BOTTOM_PX,
  type EditorViewport,
} from '../editor-viewport';
import { faBars, faChevronLeft } from '@fortawesome/free-solid-svg-icons';
import { stageViewName } from './stage-view-name';
import { ViewportViewMenu } from './ViewportViewMenu';
import {
  lookDeclaresViewportColors,
  lookPaintsLightViewport,
  subscribeNativeSelectionTheme,
  useViewportChrome,
} from '@volter/editor-sdk/kit/native-selection-style';
import type { ThreeViewportProjection } from '@volter/editor-sdk/kit/three-viewport-presentation';

/** The cluster sits 8px under the compass — one number, owned by the
 *  compass's own box (`editor-viewport.ts`, measured against Blender's
 *  navigation gizmo), never restated here. */
const CLUSTER_TOP = COMPASS_CLUSTER_TOP_PX;

/** Module-level for `useSyncExternalStore`'s stable identity; the theme root
 *  is global, so no stage's element narrows it (same shape as `StageHost`'s
 *  own subscription to the viewport group). */
function subscribeThemeViewportGroup(onChange: () => void): () => void {
  return subscribeNativeSelectionTheme(null, onChange);
}

/** Stable no-session stand-ins, so the subscription hook keeps one identity
 *  across renders of a document that has no session. */
const NO_SESSION_SUBSCRIBE = (): (() => void) => () => {};
const NO_SESSION_SNAPSHOT = (): number => 0;

/**
 * THE STATISTICS BLOCK'S GEOMETRY, measured on `sculpting.png` — the ONE
 * reference frame that photographs the overlay's counts (every other frame
 * has the Statistics overlay off; `modeling-front-ortho.png`'s third line is
 * the ortho grid's unit, not a count). Device px at native 2x, CSS halved:
 *
 *   `User Perspective`   ink y 181..201, x 138..306   (baseline ~196.5)
 *   `(1) Cube | Cube`    ink y 211..237, x 139..300   (baseline ~231.5)
 *   `Vertices`  `8`      ink y 273..288, label x 136..216, value x 252..262
 *   `Faces`     `6`      ink y 308..323, label x 138..194, value x 252..261
 *
 * Three facts that become the two constants below. The line step INSIDE a
 * block is 35 device (17.5 CSS) — the same step the two identity lines use.
 * The step from the subject line to `Vertices` is 56.5 device, so the stats
 * block stands one extra 21.5 device (10.75 CSS) off the lines above it;
 * `space-5` is 10, the nearest rung, and the scale has nothing at 11.
 * And the VALUE is a COLUMN, not a space: both rows start their number at
 * exactly x 252 device while their labels end at 216 and 194, so the label
 * cell is a fixed 115 device / 57.5 CSS measured from the block's own left
 * edge (x 137) — 58 at the rounding the rest of this file uses.
 */
const STATISTICS_BLOCK_OFFSET = 5 as const;
/** See {@link STATISTICS_BLOCK_OFFSET}: Blender's value column, CSS px from
 *  the overlay block's left edge. */
const STATISTICS_LABEL_COLUMN_PX = 58;

/** What the overlay lines read off the camera, so a move that changes one re-renders them. */
function cameraSignature(viewport: EditorViewport, session: Object3DDocumentSession | null): string {
  const camera = session?.camera() ?? viewport.renderCamera;
  const position = viewport.camera.position;
  const target = viewport.orbitControls.target;
  const zoom = (camera as THREE.OrthographicCamera).isOrthographicCamera
    ? orthographicWorldPerDevicePixel(camera as THREE.OrthographicCamera, viewport, session)
    : 0;
  return [position.x, position.y, position.z, target.x, target.y, target.z, zoom].map((n) => n.toPrecision(6)).join(',');
}

/** World units across one device pixel of an orthographic view: its height over the drawing
 *  buffer's (the session's canvas, in device pixels), else the controls' element at the
 *  display's ratio. */
function orthographicWorldPerDevicePixel(
  camera: THREE.OrthographicCamera,
  viewport: EditorViewport,
  session: Object3DDocumentSession | null,
): number {
  const element = viewport.orbitControls.domElement;
  const height = Math.max(
    1,
    session?.renderer.domElement.height ??
      (element?.clientHeight ?? 1) * (element?.ownerDocument.defaultView?.devicePixelRatio ?? 1),
  );
  return (camera.top - camera.bottom) / camera.zoom / height;
}

export interface ViewportFurnitureProps {
  readonly viewport: EditorViewport | null;
  /** The stage's document, whose view menu the look's view-name pill opens. */
  readonly documentId: string;
  readonly session: Object3DDocumentSession | null;
  readonly store: ShellStore;
  readonly projection: ThreeViewportProjection;
  readonly displayName: string;
  readonly objectName: (id: string) => string | null;
  /** The active document's own counts. See `ToolObject3DAuthoringProps.statistics`. */
  readonly statistics?: readonly ToolViewportStatistic[];
  /** The document's own subject line. See `ToolObject3DAuthoringProps.subject`. */
  readonly subject?: string;
  /** The document's grid-step name. See `ToolObject3DAuthoringProps.gridScale`. */
  readonly gridScale?: (worldPerDevicePixel: number) => string | null;
}

export function ViewportFurniture({
  viewport,
  documentId,
  session,
  store,
  projection,
  displayName,
  objectName,
  statistics,
  subject: documentSubject,
  gridScale,
}: ViewportFurnitureProps) {
  useSyncExternalStore(store.subscribe, store.getShellSnapshot ?? store.getSnapshot);
  // THE LINES FOLLOW THE CAMERA: the view text names the axis the view looks down and the grid
  // line names the step at the current zoom, and neither is a store or session change.
  useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        const controls = viewport?.orbitControls;
        controls?.addEventListener('change', listener);
        return () => controls?.removeEventListener('change', listener);
      },
      [viewport],
    ),
    () => (viewport ? cameraSignature(viewport, session) : ''),
  );
  // The VIEW TEXT must follow the projection the stage is actually drawing
  // with. A document session carries its own (`session.camera()` returns its
  // orthographic camera off it), and the viewport's flag says nothing about
  // it — so the text read "User Perspective" over an orthographic stage the
  // moment the document toolbar's own projection menu was used.
  useSyncExternalStore(
    session?.subscribe ?? NO_SESSION_SUBSCRIBE,
    session?.getSnapshot ?? NO_SESSION_SNAPSHOT,
    session?.getSnapshot ?? NO_SESSION_SNAPSHOT,
  );
  // THE VIEW TEXT IS THE BRIGHTEST THING IN BLENDER'S FRAME, and it is the one
  // place Blender goes to pure white: measured on `modeling-edit-none.png` at
  // native 2x, both overlay lines plateau at 255 (240 px at 255 against 296 at
  // its AA neighbour 253) where its panel text inks 229. Ours drew
  // `content.primary` — one step back, over the busiest backdrop in the
  // window.
  //
  // `content.onAccent` IS THE MEMBER THAT HOLDS 255, and its NAME is
  // misleading for this role: Blender spends that ink mostly NOT on an accent.
  // DO NOT RENAME IT — it is a pre-v3 core key in all three palette lists and
  // every shipped palette document names it, so a rename breaks every skin on
  // disk to make a docblock read better. This comment is the correction.
  //
  // AND IT IS GATED, because the member's real role is "ink that must read
  // over a fill the PALETTE chose". Measured: Classic's `content.onAccent` is
  // #101820 — near-black, correct against its light accent chip and ruinous
  // over a mid-grey viewport. The gate is the predicate that already decides
  // every other viewport paint question (`lookDeclaresViewportColors`, the
  // same one the grid's distance fade reads): a look that declares what the
  // viewport is painted has answered for both values, and a look that leaves
  // the backdrop to the editor keeps the ink it had. Classic is bit-identical.
  const lookPaintsViewport = useSyncExternalStore(
    subscribeThemeViewportGroup,
    lookDeclaresViewportColors,
  );
  // A LIGHT declared viewport (a paper ground) is the one case the on-accent ink cannot serve:
  // there it is the ground's own colour, so the ordinary ink reads instead.
  const lookPaintsLight = useSyncExternalStore(subscribeThemeViewportGroup, lookPaintsLightViewport);
  const overlayInk = lookPaintsViewport && !lookPaintsLight ? themeVars.content.onAccent : themeVars.content.primary;
  // WHICH OF THIS FURNITURE THE TARGET DRAWS is the look's (`stage.chrome`): the view text is
  // Blender's, the zoom and pan cluster Blender's alone; Godot names the view in a pill that
  // opens the view menu, Unity under its scene gizmo.
  const chrome = useViewportChrome();
  if (!viewport) return null;
  // Blender's view text names the DIRECTION as well as the projection —
  // "Front Orthographic" on numpad 1 (`modeling-front-ortho.png`), "User
  // Perspective" the moment the view is orbited off that axis. Derived from
  // the live camera, so it reverts on the first drag the way Blender's does.
  const axis =
    axisViewName(
      viewport.camera.position.clone().sub(viewport.orbitControls.target),
      new THREE.Vector3(0, 1, 0).applyQuaternion(viewport.camera.quaternion),
    ) ?? 'User';
  const drawn = session?.projection() ?? projection;
  // A CAMERA VIEW names itself as Blender's does: "Camera Perspective" / "Camera Orthographic",
  // after the camera's own projection.
  const through = session?.cameraView() ?? null;
  const viewText = through
    ? `Camera ${through.projection === 'perspective' ? 'Perspective' : 'Orthographic'}`
    : `${axis} ${drawn === 'perspective' ? 'Perspective' : 'Orthographic'}`;
  // THE SUBJECT LINE. Blender's is `(frame) <active collection> | <active
  // object>` — THREE parts, and which part is which was settled by CONTRAST
  // across the frames, never from one of them. `modeling-object-none.png`,
  // `modeling-object-selected.png` and `layout.png` all read
  // `(1) Collection | Cube`; `sculpting.png` reads `(1) Cube | Cube` only
  // because THAT file's collection is itself named Cube. So the leading part
  // is a CONTAINER and the trailing part is the ACTIVE OBJECT — neither is
  // the mesh datablock, which Blender never puts on this line at all.
  //
  // We have one of Blender's three. There is no frame (no timeline) and no
  // collection; the DOCUMENT is the only container an object on this stage
  // belongs to, so it takes the leading slot — a world-root stage names a
  // scene there and the selection names an object inside it.
  //
  // AND THE CONTAINER SLOT IS DROPPED WHEN IT IS NOT A CONTAINER. A Model
  // document names its own subject, so both slots resolve to ONE string from
  // ONE
  // source and the overlay rendered `cube | cube` — one entity printed
  // twice, which is not Blender's pair. Measured live on a cold models build
  // before this change. Blender would happily print two identical words
  // there (sculpting.png does); ours would be printing one thing twice, so
  // it says that one thing once.
  //
  // THE TRAILING PART IS THE ACTIVE OBJECT, not the oldest selected one.
  // `store.selectedEntityId` is the store's own active id — `[...selection]
  // .at(-1)`, what the transform gizmo binds to and what the Outliner marks
  // as its active row. This read `[...selectedEntityIds][0]`, the OLDEST id,
  // which is the same defect `inspector-selection.ts`'s docblock records
  // fixing for the inspector on 2026-09-18 (click A, ctrl-click B, and the
  // gizmo moved to B while the inspector kept showing A). Back-applied here,
  // the third reader of that selection. A Model document holds one entity,
  // so this half is not visible in its frame; it shows on any stage where
  // two objects can be selected at once.
  const activeId = store.selectedEntityId;
  const activeName = (activeId === null ? null : objectName(activeId)) || null;
  const subject =
    documentSubject ??
    (activeName === null || activeName === displayName ? displayName : `${displayName} | ${activeName}`);
  // THE GRID'S STEP, where Blender names it: an orthographic view down an axis
  // (`draw_grid_unit_name`, `!rv3d->is_persp && RV3D_VIEW_IS_AXIS`). What the step is called
  // is the document's; the host hands it the world units one device pixel spans.
  const drawnCamera = session?.camera() ?? viewport.renderCamera;
  const gridLine =
    gridScale && !through && axis !== 'User' && (drawnCamera as THREE.OrthographicCamera).isOrthographicCamera
      ? gridScale(orthographicWorldPerDevicePixel(drawnCamera as THREE.OrthographicCamera, viewport, session))
      : null;

  // BLENDER'S MAGNIFIER IS A DRAG (`view3d.zoom` from the navigation gizmo, the factory
  // `USER_ZOOM_DOLLY` style, `viewzoom_scale_value`): with `len` the pointer's height below the
  // region's top plus 5, the distance is the one the drag started at times
  // `2 * (len / len0 - 1) + 1` — down backs away, up closes in.
  const startZoom = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const regionTop = viewport.orbitControls.domElement?.getBoundingClientRect().top ?? 0;
    const lenOld = Math.max(5 + event.clientY - regionTop, 1);
    const camera = viewport.camera;
    const target = viewport.orbitControls.target;
    const offset = camera.position.clone().sub(target);
    const ortho = !session && viewport.renderCamera instanceof THREE.OrthographicCamera ? viewport.renderCamera : null;
    const zoom0 = ortho?.zoom ?? 1;
    // In a camera view the same drag zooms the camera's frame (`view_zoom_to_window_xy_camera`).
    const frameZoom0 = session?.cameraViewZoom() ?? null;
    const move = (moveEvent: PointerEvent): void => {
      const lenNew = 5 + moveEvent.clientY - regionTop;
      const factor = Math.max(0.01, 2 * (lenNew / lenOld - 1) + 1);
      if (frameZoom0 !== null && session?.cameraView()) {
        session.setCameraViewZoom(frameZoom0 / factor);
      } else if (ortho) {
        ortho.zoom = zoom0 / factor;
        ortho.updateProjectionMatrix();
      } else camera.position.copy(target).addScaledVector(offset, factor);
      viewport.orbitControls.update();
    };
    const end = (): void => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', end);
      element.removeEventListener('pointercancel', end);
      element.removeEventListener('lostpointercapture', end);
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    element.addEventListener('lostpointercapture', end);
  };

  const startPan = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    let lastX = event.clientX;
    let lastY = event.clientY;
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const move = (moveEvent: PointerEvent): void => {
      const dx = moveEvent.clientX - lastX;
      const dy = moveEvent.clientY - lastY;
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      // In a camera view a pan moves the camera's frame with the pointer (`view_move`).
      if (session?.cameraView()) {
        const region = session.renderer.domElement;
        session.panCameraView(dx / Math.max(region.clientWidth, 1), dy / Math.max(region.clientHeight, 1));
        return;
      }
      const camera = viewport.camera;
      const target = viewport.orbitControls.target;
      const distance = camera.position.distanceTo(target);
      const height = Math.max(1, element.ownerDocument.defaultView?.innerHeight ?? 1);
      const worldPerPixel =
        (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / height;
      right.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(-dx * worldPerPixel);
      up.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(dy * worldPerPixel);
      camera.position.add(right).add(up);
      target.add(right).add(up);
      viewport.orbitControls.update();
    };
    const end = (): void => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', end);
      element.removeEventListener('pointercancel', end);
      element.removeEventListener('lostpointercapture', end);
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    element.addEventListener('lostpointercapture', end);
  };

  return (
    <>
      {chrome.viewName === 'text' ? (
      <div
        data-testid="viewport-view-text"
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 'var(--vgai-space-3)',
          // Clear of the tool rail at the stage's left edge (Blender's text
          // starts past its toolbar): the rail is one control wide plus its
          // own inset.
          left: 'calc(var(--vgai-space-4) + var(--vgai-control-comfortable-height) * 2 + var(--vgai-space-4))',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--vgai-space-1)',
          fontSize: 'var(--vgai-font-sm)',
          color: overlayInk,
          textShadow: 'var(--vgai-content-text-shadow, none)',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        <span>{viewText}</span>
        <span>{subject}</span>
        {gridLine ? <span data-testid="viewport-grid-scale">{gridLine}</span> : null}
        {statistics && statistics.length > 0 ? (
          <div
            data-testid="viewport-statistics"
            style={{
              display: 'grid',
              gridTemplateColumns: `${STATISTICS_LABEL_COLUMN_PX}px auto`,
              // The column's own rows keep the block's line step; the block
              // itself stands off the lines above it. See
              // `STATISTICS_BLOCK_OFFSET`.
              rowGap: 'var(--vgai-space-1)',
              marginTop: spaceVar[STATISTICS_BLOCK_OFFSET],
            }}
          >
            {statistics.map((statistic) => (
              <Fragment key={statistic.id}>
                <span>{statistic.label}</span>
                <span>{statistic.value}</span>
              </Fragment>
            ))}
          </div>
        ) : null}
      </div>
      ) : null}
      {chrome.viewName === 'menu' ? (
        <div
          className="vgai-viewport-view-pill"
          style={{
            position: 'absolute',
            top: 'var(--vgai-viewport-overlay-top, var(--vgai-space-4))',
            // Past the tool shelf when the tools ride it, as the view text is.
            left:
              chrome.tools === 'shelf'
                ? 'calc(var(--vgai-space-4) + var(--vgai-control-comfortable-height) * 2 + var(--vgai-space-4))'
                : 'var(--vgai-space-2)',
            zIndex: 'calc(var(--vgai-z-dropdown, 1000) - 1)',
            pointerEvents: 'auto',
          }}
        >
          <ViewportViewMenu shell={store} documentId={documentId} label={stageViewName(viewport, drawn, 'long')} kebab />
        </div>
      ) : null}
      {chrome.viewName === 'gizmo' ? (
        // UNITY'S LABEL UNDER THE SCENE GIZMO (`Editor-SceneGizmo.png`): the projection's mark and
        // its name, and a click toggles the projection, as Unity's does.
        <button
          type="button"
          data-testid="viewport-view-name"
          className="vgai-viewport-gizmo-label"
          aria-label={drawn === 'perspective' ? 'Switch to orthographic' : 'Switch to perspective'}
          onClick={() => {
            const next = drawn === 'perspective' ? 'orthographic' : 'perspective';
            if (session) session.setProjection(next);
            else viewport.setProjection(next);
          }}
          style={{
            position: 'absolute',
            top: COMPASS_INK_BOTTOM_PX + 4,
            right: COMPASS_CENTER_RIGHT_PX,
            transform: 'translateX(50%)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--vgai-space-1)',
            padding: 0,
            border: 0,
            background: 'none',
            fontSize: 'var(--vgai-font-sm)',
            color: overlayInk,
            textShadow: 'var(--vgai-content-text-shadow, none)',
            cursor: 'pointer',
            pointerEvents: 'auto',
          }}
        >
          <EditorIcon size="xs" icon={drawn === 'perspective' ? faChevronLeft : faBars} />
          {stageViewName(viewport, drawn, 'short')}
        </button>
      ) : null}
      {/* BLENDER'S NAVIGATION CLUSTER (`view3d_gizmo_navigate.cc`): Zoom and Pan, each a drag;
          Camera; and the projection toggle, whose mark is the projection the view has. Cell,
          gap, pitch and capsule width are Blender's (`modeling-edit-none.png`: glyph boxes 16
          CSS, pitch 30, a 28 CSS capsule). Framing is not here: its home is the document
          header's view control and the Home and numpad-period keys, as Blender's is its View
          menu. The Camera button is not drawn yet: looking through a scene camera is not a
          view this stage has. */}
      {chrome.navigation ? (
      <div
        data-testid="viewport-navigation"
        role="toolbar"
        aria-label="Navigation"
        aria-orientation="vertical"
        className="vgai-chrome-island vgai-viewport-navigation"
        style={{
          position: 'absolute',
          top: CLUSTER_TOP,
          // 12, not 8: PAINTED EDGE to PAINTED EDGE is how the reference was
          // read, and this panel's rect runs ~3 CSS past the last pixel the
          // viewport paints (the dock's sash). At 8 the gap measured 5.0 CSS
          // against Blender's 9.0 (`modeling-edit-none.png`: the capsule's
          // last column is device 2817 and the area's dark boundary starts at
          // 2836); at 12 it is 9.0.
          // UNGATED, like every other number this cluster carries: its 28 and
          // 16 are Blender's for every skin already (`theme.css`'s
          // `.vgai-viewport-navigation` block, no palette selector), and the
          // estate's `css-style-identity-selector` gate forbids one anyway.
          right: 'var(--vgai-space-6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--vgai-space-1)',
          // Blender's capsule is exactly as wide as its buttons: it insets
          // only along the column.
          padding: 'var(--vgai-space-1) 0',
          borderRadius: 'var(--vgai-radius-full)',
          background: 'var(--vgai-island-surface, var(--vgai-surface-overlay))',
          pointerEvents: 'auto',
        }}
      >
        <Tooltip text="Zoom (drag)">
          <IconButton size="comfortable" aria-label="Zoom the view" onPointerDown={startZoom}>
            <EditorIcon size="2xl" icon={editorIcons.viewport.zoomIn} />
          </IconButton>
        </Tooltip>
        <Tooltip text="Pan (drag)">
          <IconButton size="comfortable" aria-label="Pan the view" onPointerDown={startPan}>
            <EditorIcon size="2xl" icon={editorIcons.viewport.pan} />
          </IconButton>
        </Tooltip>
        {/* THE PROJECTION THIS BUTTON MEANS IS THE STAGE'S, NOT THE
            VIEWPORT'S. It drove `viewport.setProjection` and was INERT
            wherever this cluster is drawn — `StageHost` is its only caller,
            every stage it hosts is painted by
            `Object3DDocumentSession.renderViewport` through `session.camera()`,
            and that camera reads the SESSION's own `projection` (the comment
            on the view text above already said so). Measured 2026-09-19 in a
            cold models scaffold: the click flipped `aria-pressed` and left the
            frame hash byte-identical, while the document header's Camera view
            menu — `session.setProjection`, the same intent one row up —
            changed both the picture and the view text. It was worse than
            inert: `dolly` below branches on `viewport.renderCamera`, so while
            this button was "pressed" Zoom in and Zoom out went dead too, and
            flipping back nudged the camera as `_syncPerspectiveFromOrthographic`
            copied the phantom pose home. Transcribed from the sibling door
            (`Object3DDocumentToolbar`), with the viewport kept as the answer
            for a stage that has no session. */}
        {session?.hasCameraView() ? (
          <Tooltip text={through ? 'Leave the camera view' : 'Look through the camera'}>
            <IconButton size="comfortable" aria-label="Toggle the camera view" onClick={() => session.toggleCameraView()}>
              {/* Blender's `VIEW_CAMERA_UNSELECTED` out of the camera view, `VIEW_CAMERA` in it. */}
              <EditorIcon size="2xl" icon={through ? editorIcons.viewport.cameraView : editorIcons.viewport.camera} />
            </IconButton>
          </Tooltip>
        ) : null}
        {/* In a camera view, the lock that makes navigating it move the camera
            (`View3D.lock_camera`): `VIEW_LOCKED` while it holds, `VIEW_UNLOCKED` otherwise. */}
        {through && session?.cameraViewLocked() !== null ? (
          <Tooltip text={session?.cameraViewLocked() ? 'Unlock the camera from the view' : 'Lock the camera to the view'}>
            <IconButton size="comfortable" aria-label="Lock the camera to the view" onClick={() => session?.toggleCameraViewLock()}>
              <EditorIcon
                size="2xl"
                icon={session?.cameraViewLocked() ? editorIcons.viewport.cameraLocked : editorIcons.viewport.cameraUnlocked}
              />
            </IconButton>
          </Tooltip>
        ) : null}
        {/* A camera view has its camera's projection, so the toggle stands down in it. */}
        {through ? null : (
        <Tooltip text={drawn === 'perspective' ? 'Orthographic' : 'Perspective'}>
          <IconButton
            size="comfortable"
            aria-label="Toggle perspective and orthographic"
            onClick={() => {
              const next = drawn === 'perspective' ? 'orthographic' : 'perspective';
              if (session) session.setProjection(next);
              else viewport.setProjection(next);
            }}
          >
            {/* The mark names the projection the view HAS, as Blender's `VIEW_PERSPECTIVE` /
                `VIEW_ORTHO` do; the button is never shown pressed. */}
            <EditorIcon
              size="2xl"
              icon={drawn === 'orthographic' ? editorIcons.viewport.projectionOrthographic : editorIcons.viewport.projection}
            />
          </IconButton>
        </Tooltip>
        )}
      </div>
      ) : null}
      {through && session ? (
        <CameraFrame view={through} canvas={session.renderer.domElement} locked={session.cameraViewLocked() === true} />
      ) : null}
    </>
  );
}

/**
 * THE CAMERA'S FRAME over the region, as Blender's `drawviewborder` draws it: the passepartout
 * outside it at the camera's opacity, and one device pixel outside the frame a solid box (only
 * with a passepartout) under a dashed one (`dash_width` 6 at half, in device pixels).
 */
function CameraFrame({ view, canvas, locked }: { view: ToolCameraView; canvas: HTMLCanvasElement; locked: boolean }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  // Positions are read from the layout, so a panel resize has to draw the frame again.
  const [, setLayout] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(() => setLayout((tick) => tick + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvas]);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const ratio = canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
  const canvasRect = canvas.getBoundingClientRect();
  const hostRect = host?.getBoundingClientRect();
  const px = 1 / ratio;
  const x = view.frame.left * width - px;
  const y = view.frame.top * height - px;
  const w = view.frame.width * width + 2 * px;
  const h = view.frame.height * height + 2 * px;
  return (
    <div ref={setHost} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {hostRect ? (
        <svg
          data-testid="viewport-camera-frame"
          width={width}
          height={height}
          style={{ position: 'absolute', left: canvasRect.left - hostRect.left, top: canvasRect.top - hostRect.top }}
        >
          {view.passepartout.opacity > 0 ? (
            <path
              d={`M0 0H${width}V${height}H0Z M${x} ${y}V${y + h}H${x + w}V${y}Z`}
              fill={view.passepartout.color}
              fillOpacity={view.passepartout.opacity}
              fillRule="evenodd"
            />
          ) : null}
          {view.passepartout.opacity > 0 ? (
            <rect x={x} y={y} width={w} height={h} fill="none" stroke={view.border.solid} strokeWidth={px} shapeRendering="crispEdges" />
          ) : null}
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill="none"
            stroke={view.border.dashed}
            strokeWidth={px}
            strokeDasharray={`${3 * px} ${3 * px}`}
            shapeRendering="crispEdges"
          />
          {/* A locked view's outer box, one pixel outside ("not to confuse with object selection"). */}
          {locked ? (
            <rect
              x={x - px}
              y={y - px}
              width={w + 2 * px}
              height={h + 2 * px}
              fill="none"
              stroke={view.border.locked}
              strokeWidth={px}
              strokeDasharray={`${3 * px} ${3 * px}`}
              shapeRendering="crispEdges"
            />
          ) : null}
        </svg>
      ) : null}
    </div>
  );
}
