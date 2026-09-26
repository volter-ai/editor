/**
 * THE MODEL DOCUMENT — Blender's, and Blender's alone (ARCHITECTURE-CORE §The
 * project model, "A model is Blender data, and a prefab is not a model";
 * WORK.md §Blender in the tab is Blender, "The mesh kit retires", M1).
 *
 * This module declares `documentKind = 'model'`, so the host opens every
 * `model` entry the project's table lists as its OWN document — titled by the
 * entry's label, one per entry — and mounts this with the entry as
 * `props.document`. A `model` entry names a `.blend`
 * (`models.finder.ts`), and opening the document OPENS THAT FILE IN THE
 * ENGINE: `session.py` opens the named file at start and saves back to it, so
 * this is the WS-F save path run backwards.
 *
 * bpy owns every mutation; this document displays them. A gesture is a bpy
 * call the engine records — there is no cage, no append-per-gesture and no
 * TypeScript geometry module. The bpy scripts that authored a `.blend` are
 * ordinary project files beside it (`src/models/<name>.py`); this document
 * does not run them, a person or an agent does, through the session's Blender
 * (`vgai blender-mcp`).
 *
 * WITHOUT AN ENTRY it is still the document `blender-start` presents into: a
 * project that lists no `.blend` of its own gets one Model document at the
 * standing `blender:runtime` address (`models.finder.ts` lists it), and
 * the session opens its default `models/model.blend`.
 */

// How the `model` stage this document builds behaves (its starting presentation).
import '../src/presentation';
import { blenderModelView } from '@volter/blender-engine/browser/three/blender-runtime-view';
import type { ToolContributionProps, ToolDocumentToolbar } from '@volter/editor-sdk/contributions';
import { editorHost } from '@volter/editor-sdk/host';
import { subscribeViewportPresentation, viewPresentation } from '@volter/editor-sdk/kit/viewport-presentation';
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import { bindModelDocument, blenderExecute, openModelDocumentBlend } from '../host/blender-runtime-host';
import { BlenderObjectModeHeader } from './blender-header-menus';
import { createBlenderOutlinerAuthoring } from './blender-outliner-authoring';
import { blenderSkin } from './blender-runtime-skin';

export const point = 'workspace.document';
export const title = 'Blender Model';

/**
 * THE DOCUMENT'S HEADER IS BLENDER'S 3D VIEWPORT HEADER — Select, Add and
 * Object, the menu words `VIEW3D_MT_editor_menus` draws in Object Mode. The
 * rows, their order and what View's absence means are
 * `blender-header-menus.tsx`'s own header; this is the one line the host's
 * strip mounts (`ToolDocumentToolbar`, `DocumentHeaderStrip`).
 */
export const Toolbar: ToolDocumentToolbar = ({ documentId, notify }) => (
  <BlenderObjectModeHeader documentId={documentId} notify={notify} />
);
/** The kind this document EDITS: every `model` table entry opens here. */
export const documentKind = 'model';
/**
 * ON A MODEL DOCUMENT THE PROPERTIES RAIL IS BLENDER'S, AND BLENDER'S ALONE
 * (owner ruling; WORK.md §Blender in the tab is Blender, "Inspection parity",
 * I2 decision 1).
 *
 * Blender's Properties editor draws the tabs `ED_buttons_tabs_list` returns
 * (`space_buttons/space_buttons.cc:201-255`) and nothing else. A rail that
 * carried the host's own Preview, Transform, generic Object, Geometry and
 * Materials blocks beside Blender's sixteen would not be Blender's rail — it
 * would be Blender's rail plus another editor's, and the second editor would
 * be showing three.js's reading of data Blender owns.
 *
 * Declaring this stands the host's sections down for THIS document only: the
 * composer keeps the sections contributed by this contribution's own package
 * (`@volter/editor-blender`) and nothing else (`inspection/compose.ts`,
 * `OwnedInspectorRail`). `inspectorBuiltins` is empty — there is no host block
 * a Blender tab does not already answer for, and the Preview in particular is
 * the document's own viewport, which is the whole centre of the screen.
 */
export const inspectorRail = 'owned';
export const inspectorBuiltins: readonly string[] = [];

// The Python session outlives workspace switches and document remounts. Keep
// its disposable presentation for this project module's lifetime too. A new
// Python session explicitly replaces it through applyFrame's session address.
// It is CONSTRUCTED in `blender-runtime-view.ts` rather than here, because the
// Timeline binds a skeleton into the same presented graph and there is exactly
// one set of presented objects (`blender-runtime-skin.ts`).
const view = blenderModelView;

export default function BlenderModelDocument(props: ToolContributionProps) {
  const { active, document, documentId, notify, publishContext } = props;
  const blend = document?.source?.path;
  const entryId = document?.id;
  const key = JSON.stringify([documentId, entryId, blend]);
  const [opened, setOpened] = useState<{ key: string; error: string | null } | null>(null);
  const callbacks = useRef({ notify, publishContext });
  callbacks.current = { notify, publishContext };

  useEffect(() => {
    if (active === false || !documentId) return;
    let cancelled = false;
    let unpublish: (() => void) | undefined;
    const binding = blend === undefined ? null : { documentId, entryId: entryId!, blend };
    const unbind = bindModelDocument(binding);
    const publish = () => { unpublish = callbacks.current.publishContext?.(view); };
    setOpened(null);
    void (async () => {
      try {
        if (binding) {
          if (!await openModelDocumentBlend(binding, publish)) return;
        } else {
          // The standing Model document is the explicit blender-start target.
          publish();
        }
        if (!cancelled) setOpened({ key, error: null });
      } catch (error) {
        if (cancelled) return;
        unpublish?.();
        unpublish = undefined;
        const detail = error instanceof Error ? error.message : String(error);
        setOpened({ key, error: detail });
        callbacks.current.notify?.({ tone: 'error', title: `Blender could not open ${blend ?? 'the model'}`, detail });
      }
    })();
    return () => {
      cancelled = true;
      unpublish?.();
      unbind();
    };
  }, [active, blend, documentId, entryId, key]);

  if (active === false || !documentId) return null;
  if (opened?.key !== key) return <div role="status">Opening model…</div>;
  if (opened.error) return <div role="alert">{opened.error}</div>;
  return <BlenderModelViewport {...props} />;
}

function BlenderModelViewport({
  active,
  document,
  documentId,
  surfaces,
}: ToolContributionProps) {
  const build = useCallback(
    () => ({
      root: view.root,
      // What the view draws changes with each frame and the work after it,
      // and with the skin's poses when the Timeline scrubs.
      onChange(listener: () => void) {
        const stopView = view.onChange(listener);
        const stopSkin = blenderSkin.subscribe(listener);
        return () => {
          stopView();
          stopSkin();
        };
      },
      dispose() {},
    }),
    [],
  );
  const blend = document?.source?.path;
  /**
   * THE INSPECTION OVERLAYS ARE HELPERS, and the Helpers menu owns them
   * (WORK.md §Blender in the tab is Blender, "Inspection parity", I4).
   *
   * Blender's viewport overlay has a Bones checkbox (`View3DOverlay.
   * show_bones`, `rna_space.cc:5125-5129`, drawn by `space_view3d.py:7161`)
   * and this editor's Helpers menu already has a Skeletons row; a weight
   * display had no member and gained one (`weights`). Handing each group to
   * the stage through `setHelper` is the whole wiring: the host marks it
   * editor-owned — out of the hierarchy, out of the raycast — sets its
   * visibility from that kind's checkbox on the spot, keeps it across the
   * stage's remounts, and toggles it afterwards. Nothing here reads or
   * mirrors the toggle's state, which is why there is no second copy of it.
   */
  useEffect(() => {
    if (!documentId) return;
    const { viewport } = editorHost();
    const groups = view.overlayGroups();
    const apply = (): void => {
      const stage = viewport.stages().find((one) => one.documentId === documentId);
      if (!stage) return;
      for (const { kind, object } of groups) stage.setHelper(kind, object);
    };
    apply();
    const stop = viewport.onStages(apply);
    return () => {
      stop();
      const stage = viewport.stages().find((one) => one.documentId === documentId);
      for (const { kind } of groups) stage?.setHelper(kind, null);
    };
  }, [documentId]);
  /**
   * ATTACH THE SKIN TO THIS STAGE'S TRANSPORT.
   *
   * This document is the one that HAS the id — the Timeline binds to the
   * `blenderModelView` singleton and cannot name a document — so the one door
   * use lives here, and the Timeline drives `blenderSkin.transport`.
   *
   * The transport is registered by the stage host when the stage mounts, which
   * may be after this effect first runs, so it retries on the registry's own
   * notification rather than assuming an order.
   */
  useEffect(() => {
    if (!documentId) return;
    const { transport } = editorHost();
    let detach: (() => void) | null = null;
    const attach = (): void => {
      if (detach) return;
      const handle = transport.for(documentId);
      if (!handle) return;
      detach = blenderSkin.attachTo(handle);
    };
    attach();
    const stop = transport.subscribe(attach);
    return () => {
      stop();
      detach?.();
    };
  }, [documentId]);
  /**
   * BLENDER'S RENDERED SHADING IS THE SCENE'S OWN LIGHT. When this stage's view lights by the
   * `scene` (the Rendered shading cell, or the Lighting row's Scene), the presenter holds the viewport
   * in the lighting its render photographs with (`BlenderRuntimeView.holdRendered`): the
   * scene's lights, its World, `hide_render` and shadows, through the camera the stage draws
   * with, re-applied from the stage's frame loop when that camera or the World changes. Any
   * other source returns it to modeling. The stage itself draws a `scene` source unlit
   * (`standard-viewport-dressing.ts`), because Blender's lights live in the presenter.
   */
  useEffect(() => {
    if (!documentId) return;
    const { viewport } = editorHost();
    const stageOf = () => viewport.stages().find((one) => one.documentId === documentId);
    let framed: ReturnType<typeof stageOf> = undefined;
    let stopFrame: (() => void) | null = null;
    // One getter for the life of the effect, so holding again is not a change; the stand-in is
    // for the moment a stage has left and `onStages` has not yet released the hold.
    const standIn = new THREE.PerspectiveCamera();
    const drawCamera = (): THREE.Camera => stageOf()?.rig().drawCamera() ?? standIn;
    const apply = (): void => {
      const stage = stageOf();
      if (stage !== framed) {
        stopFrame?.();
        stopFrame = stage ? stage.onFrame(() => view.refreshRendered()) : null;
        framed = stage;
      }
      const lit = viewPresentation(documentId).lighting.source === 'scene';
      view.holdRendered(lit && stage ? drawCamera : null);
    };
    apply();
    const stopPresentation = subscribeViewportPresentation(apply);
    const stopStages = viewport.onStages(apply);
    return () => {
      stopPresentation();
      stopStages();
      stopFrame?.();
      view.holdRendered(null);
    };
  }, [documentId]);
  /**
   * SHIFT+RIGHT-CLICK PLACES THE 3D CURSOR, Blender's own chord for
   * `view3d.cursor3d` (`blender_default.py`, `params.cursor_set_event`). The
   * press is taken before the stage's orbit sees it, and a press that moves
   * is not a click. A press that never came back (released outside the page,
   * cancelled) is dropped by the next press or the cancel, so it can never
   * swallow a later orbit's release. The drawn cursor moves at once (`placeCursor`); Blender
   * then writes `Scene.cursor` with no history step, as its operator pushes
   * no undo.
   */
  const cursorPress = useRef<{ id: number; x: number; y: number } | null>(null);
  const cursorChord = (event: ReactPointerEvent | ReactMouseEvent): boolean =>
    event.button === 2 && event.shiftKey && event.target instanceof HTMLCanvasElement;
  const onPointerDownCapture = (event: ReactPointerEvent): void => {
    if (!cursorChord(event)) {
      cursorPress.current = null;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    cursorPress.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    // A real pointer is captured so its release comes back here; a synthetic one cannot be.
    if (event.isTrusted) (event.target as Element).setPointerCapture(event.pointerId);
  };
  const dropCursorPress = (): void => {
    cursorPress.current = null;
  };
  const onPointerUpCapture = (event: ReactPointerEvent): void => {
    const press = cursorPress.current;
    if (press === null || event.pointerId !== press.id || event.button !== 2) return;
    cursorPress.current = null;
    event.preventDefault();
    event.stopPropagation();
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 3) return;
    const placed = view.placeCursor(event.clientX, event.clientY, event.target);
    if (placed === null) return;
    const [x, y, z] = placed.location;
    const [qw, qx, qy, qz] = placed.rotation;
    void blenderExecute(
      'from mathutils import Matrix, Quaternion, Vector\n' +
        `bpy.context.scene.cursor.matrix = Matrix.LocRotScale(Vector((${x}, ${y}, ${z})), ` +
        `Quaternion((${qw}, ${qx}, ${qy}, ${qz})), None)`,
      false,
      'Set 3D Cursor',
    ).then(
      (answer) => {
        if (answer.error !== null)
          editorHost().console.error(`Blender refused the 3D cursor: ${answer.error}`, 'blender-cursor');
      },
      (error: unknown) =>
        editorHost().console.error(`The 3D cursor was not written to Blender: ${String(error)}`, 'blender-cursor'),
    );
  };
  const onContextMenuCapture = (event: ReactMouseEvent): void => {
    if (cursorChord(event)) event.preventDefault();
  };
  if (!documentId) return null;
  const Surface = surfaces.Object3DAuthoring;
  return (
    <div
      style={{ display: 'contents' }}
      onPointerDownCapture={onPointerDownCapture}
      onPointerUpCapture={onPointerUpCapture}
      onPointerCancelCapture={dropCursorPress}
      onLostPointerCaptureCapture={dropCursorPress}
      onContextMenuCapture={onContextMenuCapture}
    >
    <Surface
      active={active ?? true}
      documentId={documentId}
      sourcePath={blend ?? 'blender:runtime'}
      displayName={document?.label ?? 'Model'}
      build={build}
      audit={false}
      // ON A MODEL DOCUMENT THE HIERARCHY IS BLENDER'S OUTLINER, for the same
      // reason the Properties rail is Blender's rail: the rows this panel drew
      // were the PRESENTER's three.js graph — a reading of Blender's data by
      // the thing that photographs it — where Blender's own Outliner shows the
      // VIEW LAYER's datablock tree. `blender-outliner-authoring.ts` is the
      // provider; the default adapter it delegates to still answers everything
      // about the presentation (WORK.md §Blender in the tab is Blender,
      // "Inspection parity", I3).
      authoring={createBlenderOutlinerAuthoring}
      cameraDirection={[0.8187, 0.4458, 0.3617]}
      // AND AS FAR BACK AS BLENDER'S STARTUP VIEW STANDS. The direction alone
      // put the cube where Blender's is but FILLING the frame: the factory
      // view is 18.39 units from a 2 m cube (`region_3d.view_distance` at
      // `--factory-startup`), about a third of the size a bare fit gives, which
      // is the number `openingFit` was written for and nothing was passing.
      openingFit={3}
      // Every entry this document opens is a `model` stage, the standing `blender:runtime`
      // address included (its id carries no `model:` prefix).
      stageKind={documentKind}
      // SOLID SHADING IS BLENDER'S, and Blender's Solid mode has NO world
      // light: `light_ambient` is (0,0,0), there is no IBL, and the model is
      // lit by four studio lights stated in VIEW space. So this document
      // turns the editor's studio dressing off — its RoomEnvironment IBL and
      // its one warm key, which between them were the blow-out row 1
      // measured (the factory cube read (240,240,239)/(231,231,231)/
      // (227,226,225) against Blender's (141,143,145)/(129,131,131)/
      // (111,112,113), a spread of 13 against 30) — and hands the stage
      // Blender's own four instead. `keyLight: false` also stands down the
      // editor's design-time light rig, which answers the same question.
      // The BACKGROUND stays the dressing's, because the Blender palette
      // already paints the viewport its own flat grey.
      //
      // AND THE VIEW TRANSFORM IS BLENDER'S. Blender's factory scene is AgX
      // (`view_settings.view_transform`), and this document's own RENDER path
      // already photographs through `THREE.AgXToneMapping` (`presenter.ts`),
      // so the viewport was the one surface in the chain running a different
      // curve from the thing it frames. MEASURED on the factory cube, our own
      // radiance through each operator against Blender's (141,143,145)/
      // (129,131,131)/(111,112,113): ACES lands the three faces within 6
      // levels with a spread of 40 where Blender's is 30 — the curve, not the
      // lights, is what was left of row 1's spread — and AgX within 3 at a
      // spread of 26.
      dressing={{
        environment: false,
        keyLight: false,
        toneMapping: THREE.AgXToneMapping,
        viewLocked: view.studioLights(),
      }}
    />
    </div>
  );
}
