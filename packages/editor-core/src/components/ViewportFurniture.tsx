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
import type { ToolViewportStatistic } from '@volter/editor-sdk/contributions';
import {
  EditorIcon,
  editorIcons,
  IconButton,
  spaceVar,
  Tooltip,
  themeVars,
} from '@volter/editor-sdk/widgets';
import { Fragment, type PointerEvent as ReactPointerEvent, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { axisViewName } from '../asset-workflow/model-inspection';
import type { Object3DDocumentSession } from '../authoring/object3d-document-session';
import type { EditorShellStore } from '../editor-shell-store';
import { COMPASS_CLUSTER_TOP_PX, type EditorViewport } from '../editor-viewport';
import {
  lookDeclaresViewportColors,
  subscribeNativeSelectionTheme,
} from '../native-selection-style';
import type { ThreeViewportProjection } from '../three-viewport-presentation';

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

export interface ViewportFurnitureProps {
  readonly viewport: EditorViewport | null;
  readonly session: Object3DDocumentSession | null;
  readonly store: EditorShellStore;
  readonly projection: ThreeViewportProjection;
  readonly displayName: string;
  readonly objectName: (id: string) => string | null;
  /** The active document's own counts. See `ToolObject3DAuthoringProps.statistics`. */
  readonly statistics?: readonly ToolViewportStatistic[];
}

export function ViewportFurniture({
  viewport,
  session,
  store,
  projection,
  displayName,
  objectName,
  statistics,
}: ViewportFurnitureProps) {
  useSyncExternalStore(store.subscribe, store.getShellSnapshot ?? store.getSnapshot);
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
  const overlayInk = lookPaintsViewport ? themeVars.content.onAccent : themeVars.content.primary;
  if (!viewport) return null;
  // Blender's view text names the DIRECTION as well as the projection —
  // "Front Orthographic" on numpad 1 (`modeling-front-ortho.png`), "User
  // Perspective" the moment the view is orbited off that axis. Derived from
  // the live camera, so it reverts on the first drag the way Blender's does.
  const axis =
    axisViewName(viewport.camera.position.clone().sub(viewport.orbitControls.target)) ?? 'User';
  const drawn = session?.projection() ?? projection;
  const viewText = `${axis} ${drawn === 'perspective' ? 'Perspective' : 'Orthographic'}`;
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
    activeName === null || activeName === displayName
      ? displayName
      : `${displayName} | ${activeName}`;

  const dolly = (factor: number): void => {
    const camera = viewport.renderCamera;
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = Math.max(0.01, camera.zoom / factor);
      camera.updateProjectionMatrix();
      return;
    }
    const target = viewport.orbitControls.target;
    viewport.camera.position.sub(target).multiplyScalar(factor).add(target);
    viewport.orbitControls.update();
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
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
  };

  return (
    <>
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
      {/* FIVE BUTTONS AGAINST BLENDER'S FOUR, and the count is decided, not
          drifted (2026-09-19, measured against `modeling-edit-none.png`).
          Blender draws zoom, hand, camera, grid in a 28 CSS capsule: glyph
          boxes 16 CSS, pitch 30, ink 203. Our cell, gap, pitch and capsule
          width are already those numbers exactly.

          BLENDER'S CAMERA HAS NO ANALOGUE HERE and none is invented: a Model
          document has no scene camera for it to toggle to.

          BLENDER'S ONE MAGNIFIER IS A DRAG; OURS ARE TWO CLICKS, and two is
          the honest shape for a click-only cluster. A drag carries the sign
          in its axis, so one control can do both directions; a click has no
          axis, so a single magnifier here could only ever zoom one way —
          half a control. Driven through the camera's own state rather than
          a DOM signature (the instrument that reported this pair dead once):
          distance 11.459238 -> 9.167390 on Zoom in and exactly back to
          11.459238 on Zoom out, so the two factors are exact reciprocals
          (0.8, 1.25) and the pair round-trips to the float.

          FRAME ALL IS A CONTROL BLENDER LACKS AND IT STAYS. Its home is the
          document header's own view control (`Object3DDocumentToolbar`,
          where the label even follows the selection), so on a Model document
          this is a shortcut — but `StageHost` mounts this cluster on every
          ready document host, including stages that carry no such header,
          and there it is the only door onto framing. Deleting it to match a
          picture would take the operation away from those. */}
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
        <Tooltip text="Zoom in">
          <IconButton size="comfortable" aria-label="Zoom in" onClick={() => dolly(0.8)}>
            <EditorIcon size="2xl" icon={editorIcons.viewport.zoomIn} />
          </IconButton>
        </Tooltip>
        <Tooltip text="Zoom out">
          <IconButton size="comfortable" aria-label="Zoom out" onClick={() => dolly(1.25)}>
            <EditorIcon size="2xl" icon={editorIcons.viewport.zoomOut} />
          </IconButton>
        </Tooltip>
        <Tooltip text="Pan (drag)">
          <IconButton size="comfortable" aria-label="Pan the view" onPointerDown={startPan}>
            <EditorIcon size="2xl" icon={editorIcons.viewport.pan} />
          </IconButton>
        </Tooltip>
        <Tooltip text="Frame all">
          <IconButton
            size="comfortable"
            aria-label="Frame all"
            onClick={() => {
              if (!session?.frame()) viewport.focusOn(viewport.orbitControls.object);
            }}
          >
            <EditorIcon size="2xl" icon={editorIcons.viewport.frame} />
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
        <Tooltip text={drawn === 'perspective' ? 'Orthographic' : 'Perspective'}>
          <IconButton
            size="comfortable"
            aria-label="Toggle perspective and orthographic"
            aria-pressed={drawn === 'orthographic'}
            onClick={() => {
              const next = drawn === 'perspective' ? 'orthographic' : 'perspective';
              if (session) session.setProjection(next);
              else viewport.setProjection(next);
            }}
          >
            <EditorIcon size="2xl" icon={editorIcons.viewport.projection} />
          </IconButton>
        </Tooltip>
      </div>
    </>
  );
}
