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
 * (`volter blender-mcp`).
 *
 * WITHOUT AN ENTRY it is still the document `blender-start` presents into: a
 * project that lists no `.blend` of its own gets one Model document at the
 * standing `blender:runtime` address (`models.finder.ts` lists it), and
 * the session opens its default `models/model.blend`.
 */

// How the `model` stage this document builds behaves (its starting presentation).
import { blenderViewFieldOfView } from '../src/presentation';
import {
  type BlenderRuntimeView,
  blenderModelView,
} from '@volter/blender-engine/browser/three/blender-runtime-view';
import { ownedSurfaceMaterial } from '@volter/blender-engine/browser/three/blender-physical-material';
import type { ToolContributionProps, ToolDocumentToolbar } from '@volter/editor-sdk/contributions';
import { editorHost } from '@volter/editor-sdk/host';
import {
  documentViewport,
  documentViewportsVersion,
  subscribeDocumentViewports,
} from '@volter/editor-sdk/kit/document-viewports';
import {
  DOCUMENT_STUDIO_PRESET,
  setViewPresentation,
  subscribeViewportPresentation,
  viewPresentation,
  viewPresentationSnapshot,
} from '@volter/editor-sdk/kit/viewport-presentation';
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import * as THREE from 'three';
import {
  bindModelDocument,
  blenderExecute,
  blenderRna,
  blenderRnaContext,
  subscribeBlenderRna,
  blenderViewShading,
  openModelDocumentBlend,
  modelDocumentMayOpen,
  modelDocumentOwnsPresentation,
} from '../host/blender-runtime-host';
import { BlenderObjectModeHeader } from './blender-header-menus';
import { blenderOutlinerAuthoringFor, createBlenderOutlinerAuthoring } from './blender-outliner-authoring';
import { blenderSkin } from './blender-runtime-skin';
import { areaSplit, subscribeAreaSplit } from '../src/area-split';
import { noteModelDocument } from '../src/play-mode';
import { documentPlayExtension, subscribeDocumentPlayExtensions } from '@volter/editor-sdk/kit/document-play-extension';
import { notifyWorkspaceDocumentSelectionChanged } from '@volter/editor-sdk/kit/workspace-document-registry';
import {
  documentSecondAreaHeader,
  setDocumentSecondArea,
  subscribeDocumentAreas,
} from '@volter/editor-sdk/kit/document-areas';
import { createPortal } from 'react-dom';
import { onViewportStages, viewportStages } from '@volter/editor-threejs/viewport-door';
import {
  object3DDocumentSession,
  subscribeObject3DDocumentSessions,
} from '@volter/editor-threejs/kit/authoring/object3d-document-session-registry';
import type { ToolObject3DAuthoringProps } from '@volter/editor-threejs/object3d-contributions';
import { stageStore, subscribeStageStores } from '@volter/editor-sdk/kit/stage-store-registry';
import { surfaceAcceptsKey } from '@volter/editor-sdk/kit/surface-keyboard';
import { BlenderModelOpening } from './blender-model-opening';
import { modelOpeningErrorMessage } from '../src/model-opening-error';
import {
  clearModelDocumentPreview,
  modelDocumentPreview,
  rememberModelDocumentPreview,
  subscribeModelDocumentPreview,
  type ModelDocumentPreview,
} from '../src/model-document-preview';

/** A detached copy's identity as a React key (the play area is keyed on the copy it draws). */
const playCopyKeys = new WeakMap<object, number>();
let nextPlayCopyKey = 0;
function playCopyKey(copy: object): number {
  let key = playCopyKeys.get(copy);
  if (key === undefined) { key = ++nextPlayCopyKey; playCopyKeys.set(copy, key); }
  return key;
}

/** The second areas' stage stores whose overlays have been opened off (`BlenderViewportArea`). */
const overlaysOpened = new WeakSet<object>();

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
type AreaView = BlenderRuntimeView;

/** A stage draw mode as the `View3DShading.type` Blender saves it under. */
const BLENDER_SHADING = {
  wireframe: 'WIREFRAME',
  solid: 'SOLID',
  preview: 'MATERIAL',
  rendered: 'RENDERED',
} as const;

/** What an area's stage reads from the view it draws, made once per view. */
interface AreaReads {
  readonly subject: () => string | null;
  readonly gridScale: (worldPerDevicePixel: number) => string | null;
  readonly cameraView: NonNullable<ToolObject3DAuthoringProps['cameraView']>;
}
const areaReads = new WeakMap<AreaView, AreaReads>();
function readsOf(view: AreaView): AreaReads {
  let reads = areaReads.get(view);
  if (reads) return reads;
  reads = {
    /** THE SUBJECT LINE'S FRAME IS THE ONE ON SCREEN: the skin's playhead, which during playback
     *  runs ahead of `frame_current` (written once, on pause), as Blender's own `(frame)` does. */
    subject: () => {
      const playhead = blenderSkin.playhead();
      return view.subjectLine(playhead === null ? null : Math.floor(playhead));
    },
    gridScale: (worldPerDevicePixel: number) => view.gridUnitName(worldPerDevicePixel),
    /** BLENDER'S CAMERA VIEW (`blender-runtime-camera-view.ts`): which camera, and how it fits. */
    cameraView: {
      camera: () => view.cameraViewCamera(),
      zoom: view.cameraViewZoom,
      pan: view.cameraViewPan,
      showing: (camera: string | null) => view.setCameraViewShowing(camera),
      // A LOCKED camera view moves the camera (`ED_view3d_camera_lock_sync`: its scale kept); the
      // navigation's end is the one step Blender's history records.
      setPose: (
        camera: string,
        position: readonly [number, number, number],
        quaternion: readonly [number, number, number, number],
        final: boolean,
      ) => {
        const { location, rotation } = view.blenderPose(position, quaternion);
        return blenderExecute(
          'from mathutils import Matrix, Quaternion, Vector\n' +
            `import bpy\nobject = bpy.data.objects[${JSON.stringify(camera)}]\n` +
            `object.matrix_world = Matrix.LocRotScale(Vector((${location.join(', ')})), ` +
            `Quaternion((${rotation.join(', ')})), object.matrix_world.to_scale())`,
          final,
          'Lock Camera to View',
        ).then(
          (answer) => {
            if (answer.error !== null)
              editorHost().console.error(`Blender refused the camera's pose: ${answer.error}`, 'blender-camera');
          },
          (error: unknown) =>
            editorHost().console.error(`The camera's pose was not written to Blender: ${String(error)}`, 'blender-camera'),
        );
      },
      view: (
        camera: string,
        region: { readonly width: number; readonly height: number },
        zoom: number,
        offset: readonly [number, number],
      ) => view.cameraView(camera, region, zoom, offset),
    },
  };
  areaReads.set(view, reads);
  return reads;
}

export default function BlenderModelDocument(props: ToolContributionProps) {
  const { active, document, documentId, notify, publishContext } = props;
  const blend = document?.source?.path;
  const entryId = document?.id;
  const key = JSON.stringify([documentId, entryId, blend]);
  const [opened, setOpened] = useState<{ key: string; error: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const project = editorHost().projectLocalState.projectRootPath();
  const preview = useSyncExternalStore(subscribeModelDocumentPreview, () => modelDocumentPreview(project), () => null);
  const viewportVersion = useSyncExternalStore(subscribeDocumentViewports, documentViewportsVersion, documentViewportsVersion);
  const lastFrame = useRef<ModelDocumentPreview | null>(null);
  const callbacks = useRef({ notify, publishContext });
  callbacks.current = { notify, publishContext };

  useEffect(() => editorHost().session.onEnded(clearModelDocumentPreview), []);
  // Retain a bounded photograph while the stage is healthy. Teardown can
  // already have changed its scene/camera, so it is too late to re-render then.
  useEffect(() => {
    if (active === false || !documentId || !entryId || !project || opened?.key !== key || opened.error) return;
    const stage = object3DDocumentSession(documentId);
    if (!stage) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const photograph = async () => {
      try {
        const presented = view.snapshot();
        const viewport = documentViewport(documentId);
        if (!viewport || stage.root !== view.root || !modelDocumentOwnsPresentation(documentId, entryId, blend, presented)) return;
        const frame = await stage.requestPresentedFrame();
        if (cancelled || view.snapshot() !== presented ||
          object3DDocumentSession(documentId) !== stage || stage.root !== view.root || documentViewport(documentId) !== viewport ||
          !modelDocumentOwnsPresentation(documentId, entryId, blend, presented)) return;
        if (frame && frame.width > 0 && frame.height > 0) {
          const copy = window.document.createElement('canvas');
          copy.width = Math.min(frame.width, 1024);
          copy.height = Math.max(1, Math.round(copy.width * frame.height / frame.width));
          const context = copy.getContext('2d');
          if (context) {
            context.drawImage(frame, 0, 0, copy.width, copy.height);
            lastFrame.current = { project, entryId, path: blend ?? 'Model', image: copy.toDataURL('image/png'), capturedAt: performance.now() };
            rememberModelDocumentPreview(lastFrame.current);
          }
        }
      } catch {
        // An unavailable frame leaves the last good photograph intact.
      } finally {
        if (!cancelled) timer = setTimeout(() => { void photograph(); }, 1000);
      }
    };
    void photograph();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, blend, documentId, entryId, project, key, opened, viewportVersion]);

  // Publish only an image, never the old file's authoring stage or context.
  useLayoutEffect(() => {
    if (active === false || !documentId || !entryId || !project || opened?.key !== key || opened.error) return;
    return () => {
      if (!editorHost().session.open()) return;
      const frame = lastFrame.current;
      if (frame?.project === project && frame.entryId === entryId) rememberModelDocumentPreview(frame);
    };
  }, [active, blend, documentId, entryId, project, key, opened]);

  useEffect(() => {
    if (active === false || !documentId) return;
    let cancelled = false;
    let unpublish: (() => void) | undefined;
    const binding = blend === undefined ? null : { documentId, entryId: entryId!, blend };
    const unbind = bindModelDocument(binding);
    const publish = () => { unpublish = callbacks.current.publishContext?.(view); };
    setOpened(null);
    // Native focus can arrive after the contributed pane mounts. A declined
    // open is not an in-flight load: retry when the host activates this model,
    // rather than leaving "Opening model…" latched forever. Utility focus
    // after a successful open must not tear down the model's published view.
    const documents = editorHost().documents;
    let starting = false;
    let finished = false;
    const open = async () => {
      if (cancelled || starting || finished || (binding && !modelDocumentMayOpen(binding))) return;
      starting = true;
      try {
        if (binding) {
          if (!await openModelDocumentBlend(binding, publish)) return;
        } else {
          // The standing Model document is the explicit blender-start target.
          publish();
        }
        if (!cancelled) {
          finished = true;
          setOpened({ key, error: null });
        }
      } catch (error) {
        if (cancelled) return;
        finished = true;
        unpublish?.();
        unpublish = undefined;
        const detail = error instanceof Error ? error.message : String(error);
        setOpened({ key, error: detail });
        editorHost().console.error(detail, 'blender-open');
        callbacks.current.notify?.({ tone: 'error', title: `Blender could not open ${blend ?? 'the model'}`, detail: modelOpeningErrorMessage(detail) });
      } finally {
        starting = false;
      }
    };
    // Opening publishes context to other React roots. Start outside this
    // effect (or a host activation listener's synchronous notification stack)
    // so those roots cannot synchronously commit through a pending commit here.
    let queued = false;
    const requestOpen = () => {
      if (cancelled || queued) return;
      queued = true;
      setTimeout(() => { queued = false; void open(); }, 0);
    };
    const unsubscribe = documents.subscribe(requestOpen);
    requestOpen();
    return () => {
      cancelled = true;
      unsubscribe();
      unpublish?.();
      unbind();
    };
  }, [active, blend, documentId, entryId, key, attempt]);

  if (active === false || !documentId) return null;
  if (opened?.key !== key || opened.error) return <BlenderModelOpening
    documentId={documentId} path={blend ?? 'Model'} error={opened?.key === key ? opened.error : null} preview={preview}
    retry={() => { setOpened(null); setAttempt(value => value + 1); }}
    returnToPreview={() => {
      if (!preview) return;
      void editorHost().workspace.open({ kind: 'document', id: preview.entryId }).then(opened => {
        if (!opened) throw new Error('The previous model is no longer available in this project.');
      }).catch(error => callbacks.current.notify?.({ tone: 'error', title: 'Could not return to the previous model', detail: String(error) }));
    }}
  />;
  return <>
    <BlenderModelViewport {...props} />
    {!documentViewport(documentId) && <BlenderModelOpening documentId={documentId} path={blend ?? 'Model'} error={null}
      preparingView preview={preview} retry={() => {}} returnToPreview={() => {}} />}
  </>;
}

/**
 * THE MODEL DOCUMENT'S AREA: one 3D viewport, and the whole screen unless the area is split
 * (View ▸ Area ▸ Vertical Split, `src/area-split.ts`). Split, the second area is the same
 * viewport over a follower of the presented view (`BlenderRuntimeView.follow`), opened as
 * Blender's standard always-on render preview is set up: Rendered shading, through the scene
 * camera. Each area has its own stage, shading, navigation and camera view; the model, its
 * selection and its history are the document's.
 *
 * PLAYING (the composed Play tool), the area shows a DETACHED copy of the model
 * (`BlenderRuntimeView.detach`) on a stage of its own, which the project's play script moves
 * (the document Play extension). The model's own stage stays mounted underneath, hidden, so Stop
 * returns to the same view of the same model: nothing a game does reaches Blender.
 */
function BlenderModelViewport(props: ToolContributionProps) {
  const { documentId } = props;
  const blend = props.document?.source?.path;
  // THE BOTTOM AREA SERVES THIS DOCUMENT while it is the model on screen (`../src/play-mode.ts`):
  // the Game panel drives this id's run, and Game or Movie is chosen by this file's play script.
  useEffect(() => (documentId ? noteModelDocument(documentId, blend) : undefined), [documentId, blend]);
  // Rendered areas and Play use the scene's display transform, just as a
  // photograph does. Solid keeps its studio transform. RNA also announces
  // colour settings that change without changing the presented geometry.
  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    let revision = 0;
    let applied: { mapper: string; exposure: number } | null = null;
    const read = async () => {
      const mine = ++revision;
      const context = await blenderRnaContext();
      if (!context) return;
      const settings = await blenderRna(`${context.scene}.view_settings`);
      if (cancelled || mine !== revision || settings?.kind !== 'struct' || settings.type !== 'ColorManagedViewSettings') return;
      const rows = settings.groups.flatMap(group => group.rows);
      const transform = rows.find(row => row.identifier === 'view_transform')?.value;
      const stops = rows.find(row => row.identifier === 'exposure')?.value;
      const mapper = transform === 'Standard' ? 'none' : transform === 'Filmic' ? 'filmic' : 'agx';
      const exposure = typeof stops === 'number' ? 2 ** stops : 1;
      if (applied?.mapper === mapper && applied.exposure === exposure) return;
      applied = { mapper, exposure };
      for (const id of [documentId, `${documentId}#area-2`, `${documentId}#play`]) {
        setViewPresentation(id, { modes: {
          rendered: { lighting: { tone: { mapper, exposure } } },
          preview: { lighting: { tone: { mapper, exposure } } },
        } });
      }
    };
    const update = () => { void read().catch(error => editorHost().console.error(String(error), 'blender-colour')); };
    const stopRna = subscribeBlenderRna(update);
    update();
    return () => { cancelled = true; stopRna(); };
  }, [documentId]);
  const split = useSyncExternalStore(
    subscribeAreaSplit,
    () => (documentId ? areaSplit(documentId) : false),
    () => false,
  );
  const [follower, setFollower] = useState<ReturnType<AreaView['follow']> | null>(null);
  useEffect(() => {
    if (!split || !documentId) return;
    // The area's shading is its CHOICE, the door a shading cell uses, made before its stage binds
    // so the stage's session takes it; an area whose shading was already chosen keeps it.
    const secondId = `${documentId}#area-2`;
    if (viewPresentationSnapshot(secondId).drawMode === undefined)
      setViewPresentation(secondId, { drawMode: 'rendered' });
    const second = view.follow();
    setFollower(second);
    return () => {
      setFollower(null);
      second.dispose();
    };
  }, [split, documentId]);
  const playing = useSyncExternalStore(
    subscribeDocumentPlayExtensions,
    () => (documentId ? documentPlayExtension('model')?.playing(documentId) ?? false : false),
    () => false,
  );
  const [played, setPlayed] = useState<ReturnType<AreaView['detach']> | null>(null);
  const playAspect = useSyncExternalStore(
    subscribeDocumentPlayExtensions,
    () => (documentId ? documentPlayExtension('model')?.aspectRatio?.(documentId) ?? null : null),
    () => null,
  );
  const [playedReady, setPlayedReady] = useState(false);
  /**
   * RESTART IS A NEW GENERATION OF THE SAME PLAY (`DocumentPlayTransport.generation`): the copy
   * below is detached per generation, so a restart disposes the played copy and detaches a fresh
   * one from the model, which never moved, while playing stays true throughout.
   *
   * THE OLD GAME STAYS ON SCREEN UNTIL THE NEW ONE HAS DRAWN. Between the two the new copy's
   * stage is still preparing its rendered draw, and the model area is what lies under the play
   * area — so a restart would flash the editing model between two games. The generation is
   * therefore taken in two steps: a layout effect photographs the old play stage while it still
   * stands (`capture`, the frame it draws) and only then moves `shownGeneration`, which is what
   * detaches the new copy. The photograph covers the play area until the new runner's first
   * frame (`onPlayReady`), the model area stays hidden throughout, and the old runner, no longer
   * the current generation, stands still meanwhile (`play-script.ts`).
   */
  const generation = useSyncExternalStore(
    subscribeDocumentPlayExtensions,
    () => (documentId ? documentPlayExtension('model')?.transport?.generation(documentId) ?? 0 : 0),
    () => 0,
  );
  const [shownGeneration, setShownGeneration] = useState(generation);
  const [restartStill, setRestartStill] = useState<string | null>(null);
  const restarting = useRef(false);
  // A restarted game that has not drawn yet: its stage holds no game to photograph, so a second
  // Restart in that window keeps the cover it has (or none) rather than photographing a blank.
  const awaitingDraw = useRef(false);
  useLayoutEffect(() => {
    if (generation === shownGeneration) return;
    if (playing && documentId) {
      restarting.current = true;
      if (!awaitingDraw.current) {
        let still: string | null = null;
        try { still = documentViewport(`${documentId}#play`)?.capture?.() ?? null; }
        catch { /* No photograph: the new stage shows as it prepares, still never the model. */ }
        setRestartStill(still);
      }
      awaitingDraw.current = true;
    }
    setShownGeneration(generation);
  }, [generation, shownGeneration, playing, documentId]);
  /**
   * A RESTARTED GAME THAT FAILS never draws (its script did not start, or threw on its first
   * update), so the cover would stand over it while the panel said Playing. The runner says so
   * on the clock (`DocumentPlayClock.failure`); the cover drops and the stage shows what it has.
   */
  const transport = documentPlayExtension('model')?.transport;
  const subscribeFailure = useCallback(
    (listener: () => void) => transport?.subscribeClock(listener) ?? (() => {}),
    [transport],
  );
  const failure = useSyncExternalStore(
    subscribeFailure,
    () => (documentId && transport ? transport.clock(documentId).failure ?? null : null),
    () => null,
  );
  useEffect(() => {
    if (failure === null) return;
    awaitingDraw.current = false;
    setRestartStill(null);
  }, [failure]);
  /**
   * COPIES A RESTART RETIRED, disposed only once the play area that drew them has unmounted:
   * the commit that renders the new copy removes the old area first, and this runs after it.
   * Disposed earlier, the old stage could draw a disposed copy for a frame.
   */
  const retired = useRef<ReturnType<AreaView['detach']>[]>([]);
  useEffect(() => {
    if (!playing || !documentId) { restarting.current = false; return; }
    const playId = `${documentId}#play`;
    // A game is seen as the render is: Rendered shading, chosen before the stage binds.
    setViewPresentation(playId, { drawMode: 'rendered' });
    const copy = view.detach();
    const restart = restarting.current;
    restarting.current = false;
    // A restart keeps the model area hidden: the old game's photograph stands in until ready.
    if (!restart) setPlayedReady(false);
    setPlayed(copy);
    if (!restart) {
      // The stage's mode is PLAY for as long as a copy stands, so the keys are the player's.
      view.setPlaying(true);
      notifyWorkspaceDocumentSelectionChanged(documentId);
    }
    return () => {
      // Read at cleanup: the layout effect above has already marked a restart, whose new copy
      // takes over in this same commit with the play mode unchanged.
      if (restarting.current && documentPlayExtension('model')?.playing(documentId)) {
        retired.current.push(copy);
        return;
      }
      copy.dispose();
      for (const old of retired.current.splice(0)) old.dispose();
      awaitingDraw.current = false;
      setPlayed(null);
      setRestartStill(null);
      view.setPlaying(false);
      notifyWorkspaceDocumentSelectionChanged(documentId);
    };
  }, [playing, documentId, shownGeneration]);
  useEffect(() => {
    for (const old of retired.current.filter(one => one !== played)) old.dispose();
    retired.current = retired.current.filter(one => one === played);
  }, [played]);
  // And whatever is still retired when the document itself goes (declared after the copy's own
  // effect, so its cleanup has already handed over anything mid-restart).
  useEffect(() => () => { for (const old of retired.current.splice(0)) old.dispose(); }, []);
  // The document closing or going inactive ends its game; a game never outlives its stage.
  useEffect(() => {
    if (!documentId) return;
    return () => documentPlayExtension('model')?.setPlaying(documentId, false);
  }, [documentId]);
  const game = playing ? played : null;
  const playFrame = playAspect === null ? { position: 'absolute', inset: 0 } as const : {
    position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
    width: `min(100cqw, calc(100cqh * ${playAspect}))`,
    height: `min(100cqh, calc(100cqw / ${playAspect}))`,
  } as const;
  useEffect(() => {
    if (!game || !documentId) return;
    const modelViewport = documentViewport(documentId);
    if (!modelViewport) return;
    // registerObject3DDocumentSession creates this document's own viewport object; capture may follow its visible play area.
    const capture = modelViewport.capture;
    const playCapture = (size: Parameters<NonNullable<typeof capture>>[0]) => documentViewport(`${documentId}#play`)?.capture?.(size) ?? null;
    modelViewport.capture = playCapture;
    return () => {
      if (modelViewport.capture !== playCapture) return;
      if (capture) modelViewport.capture = capture;
      else delete modelViewport.capture;
    };
  }, [game, documentId]);
  if (!documentId) return null;
  const second = split ? follower : null;
  // Keep both authoring areas mounted across Play/Stop. Remounting a stage discards
  // its pose/session and repeats the second area's initial scene-camera setup.
  const area = { position: 'relative', flex: '1 1 0', minWidth: 0, margin: 12 } as const;
  // THE HIDDEN MODEL AREA IS INERT, not merely `pointer-events: none`. It lies OVER the play
  // area (z-index 2, faded out once the game has drawn), and the stage inside it sets its own
  // `pointer-events: auto` (`StageHost`'s viewport box), which a parent's `none` does not reach:
  // a real click on the game hit the invisible editing canvas, never the play surface, so the
  // runner's takeover (`play-script.ts`, which asks whether the press landed in the game) never
  // saw it and the game never got it — while keys, read off the window, took over fine. `inert`
  // takes the whole subtree out of hit testing and focus.
  const hidden = game !== null && playedReady;
  return (
    <div style={game || second ? { position: 'absolute', inset: -12, display: 'flex', gap: 2 } : { display: 'contents' }}>
      <div key="model" inert={hidden || undefined} style={game ? { position: 'absolute', inset: 12, zIndex: 2, opacity: playedReady ? 0 : 1, pointerEvents: playedReady ? 'none' : 'auto', transition: 'opacity 160ms ease-out' } : second ? area : { display: 'contents' }}>
        <BlenderViewportArea {...props} view={view} main />
      </div>
      {game && (
        // Keyed on the COPY, so a restart mounts a new stage and runner exactly when the new copy
        // is the one rendered — never over the old, disposed one.
        <div key={`play-${playCopyKey(game)}`} style={{ position: 'absolute', inset: 12, containerType: 'size' }} data-testid="blender-play-area">
          <div data-volter-play-frame style={playFrame}>
          <BlenderViewportArea {...props} documentId={`${documentId}#play`} view={game.view} main={false} playing
            onPlayReady={() => { awaitingDraw.current = false; setPlayedReady(true); setRestartStill(null); }} onPlayReturn={() => setPlayedReady(false)} />
          </div>
        </div>
      )}
      {game && restartStill !== null && (
        <div key="restart-still" style={{ position: 'absolute', inset: 12, containerType: 'size', zIndex: 3, pointerEvents: 'none' }} data-testid="blender-play-restart-still">
          <img alt="" src={restartStill} style={{ ...playFrame, display: 'block', objectFit: 'fill' }} />
        </div>
      )}
      {second && (
        <div key="second" style={{ ...area, visibility: game ? 'hidden' : undefined }} aria-hidden={game ? true : undefined} data-testid="blender-second-area">
          <BlenderViewportArea {...props} documentId={`${documentId}#area-2`} view={second.view} main={false} />
          {!game && <SecondAreaChrome documentId={documentId} areaId={`${documentId}#area-2`} notify={props.notify} />}
        </div>
      )}
    </div>
  );
}

/**
 * THE SECOND AREA'S OWN HEADER, as each of Blender's areas has one: the editor menus (their
 * View ▸ Area ▸ Close Area closes this area), then THIS area's view, shading and helpers, the
 * header controls its own stage registered, so its shading cells change this area and not the
 * other.
 */
/**
 * THE SECOND AREA'S OWN HEADER AND SHELF, as each of Blender's areas has them.
 *
 * The area is declared to the host as the document's second area
 * (`@volter/editor-sdk/kit/document-areas`). Its HEADER stands in the document's header row over
 * this area: the host reserves this area's width at the row's trailing edge, so the first area's
 * header ends where the first area does, and this renders into the region it draws there: the
 * editor menus (their View ▸ Area ▸ Close Area closes this area), then THIS area's view, shading
 * and helpers, the header controls its own stage registered, so its shading cells change this
 * area and not the other. Its SHELF is an element the host fills with its own tool strip: the
 * tools belong to the workspace in Blender, not to an area, so both shelves are the one strip.
 */
function SecondAreaChrome({
  documentId,
  areaId,
  notify,
}: {
  readonly documentId: string;
  readonly areaId: string;
  readonly notify: ToolContributionProps['notify'];
}) {
  useSyncExternalStore(subscribeDocumentViewports, documentViewportsVersion, documentViewportsVersion);
  const header = useSyncExternalStore(subscribeDocumentAreas, () => documentSecondAreaHeader(documentId));
  const HeaderControls = documentViewport(areaId)?.HeaderControls;
  const shelfRef = useRef<HTMLDivElement>(null);
  // THE RESERVED WIDTH IS THIS AREA'S: from its stage's left edge (the area bleeds 12 px past its
  // box, as the stage does) to the row's end, kept as the split or the window moves.
  useEffect(() => {
    const shelf = shelfRef.current;
    const area = shelf?.parentElement;
    if (!area) return;
    const measure = (): void =>
      setDocumentSecondArea(documentId, { headerWidth: area.getBoundingClientRect().width + 12, shelf });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => {
      observer.disconnect();
      setDocumentSecondArea(documentId, null);
    };
  }, [documentId]);
  return (
    <>
      <div ref={shelfRef} className="volter-dock-document-shelf" role="toolbar" aria-orientation="vertical" aria-label="Document tools" />
      {header &&
        createPortal(
          <div className="volter-dock-document-toolbar-own" data-testid={`document-header:${areaId}`} style={{ display: 'flex', alignItems: 'center' }}>
            <BlenderObjectModeHeader documentId={documentId} notify={notify} />
            {HeaderControls && (
              <Suspense fallback={null}>
                <HeaderControls documentId={areaId} />
              </Suspense>
            )}
          </div>,
          header,
        )}
    </>
  );
}

function BlenderViewportArea({
  active,
  document,
  documentId,
  notify,
  surfaces,
  view,
  main,
  playing = false,
  onPlayReady,
  onPlayReturn,
}: ToolContributionProps & { readonly view: AreaView; readonly main: boolean; readonly playing?: boolean; readonly onPlayReady?: () => void; readonly onPlayReturn?: () => void }) {
  const reads = readsOf(view);
  const build = useCallback(
    () => ({
      root: view.root,
      prepareDraw: (camera: THREE.Camera, options?: {interactive: boolean; height: number; multiDraw?: boolean; renderer?: THREE.WebGLRenderer}) => view.prepareDraw(camera, options),
      // What the view draws changes with each frame and the work after it,
      // and with the skin's poses when the Timeline scrubs. A PLAYING copy announces nothing:
      // its script moves it every frame, and a source that announces nothing is drawn every
      // frame (`ToolObject3DPreviewSource.onChange`).
      ...(playing
        ? {}
        : {
            onChange(listener: () => void) {
              const stopView = view.onChange(listener);
              const stopSkin = blenderSkin.subscribe(listener);
              return () => {
                stopView();
                stopSkin();
              };
            },
          }),
      dispose() {},
    }),
    [view, playing],
  );
  const blend = document?.source?.path;
  // Re-read on the engine's frames, the skin's publications and every drawn frame of this stage
  // (playback moves the playhead with no publication); the snapshot is a string, so only a
  // changed line re-renders.
  const subscribeSubject = useCallback(
    (listener: () => void) => {
      const stopView = view.onChange(listener);
      const stopSkin = blenderSkin.subscribe(listener);
      let stopFrame: (() => void) | null = null;
      const bind = (): void => {
        stopFrame?.();
        stopFrame = viewportStages().find((one) => one.documentId === documentId)?.onFrame(listener) ?? null;
      };
      bind();
      const stopStages = onViewportStages(bind);
      return () => {
        stopView();
        stopSkin();
        stopStages();
        stopFrame?.();
      };
    },
    [documentId, view],
  );
  const subject = useSyncExternalStore(subscribeSubject, reads.subject);
  // THE SECOND AREA'S ROWS MEET ITS OWN GRAPH: the same Outliner, over the view this stage draws.
  const authoring = useMemo(
    () => (main ? createBlenderOutlinerAuthoring : blenderOutlinerAuthoringFor(() => view)),
    [main, view],
  );
  /**
   * THE SECOND AREA OPENS AS BLENDER'S RENDER PREVIEW IS SET UP: Rendered shading (chosen as the
   * area is made, `BlenderModelViewport`) and looking through the scene camera
   * (`view3d.view_camera`), entered once the stage stands and there is a camera to look through.
   * Afterwards it is an ordinary area: leaving the camera view or changing the shading is the
   * person's.
   */
  useEffect(() => {
    // A playing copy's camera is its script's.
    if (main || playing || !documentId) return;
    let entered = false;
    const enter = (): void => {
      if (entered) return;
      const session = object3DDocumentSession(documentId);
      if (session === null || view.cameraViewCamera() === null) return;
      entered = session.toggleCameraView();
    };
    enter();
    const stopSessions = subscribeObject3DDocumentSessions(enter);
    const stopFrames = view.subscribeFrames(enter);
    return () => {
      stopSessions();
      stopFrames();
    };
  }, [main, playing, documentId, view]);
  /**
   * THE PLAYING COPY IS MOVED BY THE PROJECT'S PLAY SCRIPT (the document Play extension), on this
   * stage's own frame hook, once the stage stands. The stage's orbit stands down while it runs,
   * so the script's camera is not argued with, and Escape stops the game.
   */
  const notifyRef = useRef(notify);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [playReady, setPlayReady] = useState(false);
  notifyRef.current = notify;
  const playReadyRef = useRef(onPlayReady);
  playReadyRef.current = onPlayReady;
  const playReturnRef = useRef(onPlayReturn);
  playReturnRef.current = onPlayReturn;
  useEffect(() => {
    if (!playing || !documentId) return;
    if (blend === undefined) {
      notifyRef.current?.({
        tone: 'error',
        title: 'This model has no play script',
        detail: 'A play script stands beside a model\'s .blend file, and this model has no file of its own.',
      });
      return;
    }
    const modelId = documentId.replace(/#play$/, '');
    const layers = window.document.createElement('div');
    Object.assign(layers.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    layers.dataset['testid'] = 'model-play-roots';
    surfaceRef.current?.appendChild(layers);
    setPlayReady(false);
    let stopped = false;
    let preparing = false;
    let stopScript: (() => void) | null = null;
    let orbit: { enabled: boolean } | null = null;
    const start = (): void => {
      if (stopScript || preparing || stopped) return;
      const stage = viewportStages().find((one) => one.documentId === documentId);
      if (!stage || !view.root.parent) return;
      preparing = true;
      orbit = stage.rig().orbit;
      orbit.enabled = false;
      void view.prepareRendered(stage.rig().drawCamera(), 'render').then(() => {
        if (stopped) return;
        stopScript = documentPlayExtension('model')?.run({
          documentId: modelId,
          container: layers,
          ready: () => { if (!stopped) { setPlayReady(true); playReadyRef.current?.(); } },
          returning: () => { if (!stopped) playReturnRef.current?.(); },
          sourcePath: blend,
          root: view.root,
          camera: () => stage.rig().drawCamera(),
          editingCamera: () => viewportStages().find(one => one.documentId === modelId)?.rig().drawCamera() ?? stage.rig().drawCamera(),
          onFrame: (fn) => stage.onFrame(fn),
          ownMaterial: (material) => ownedSurfaceMaterial(material as THREE.Material),
          report: (title, detail) => {
            editorHost().console.error(`${title}: ${detail}`, 'blender-play');
            notifyRef.current?.({ tone: 'error', title, detail });
          },
        }) ?? null;
      }, error => {
        if (stopped) return;
        editorHost().console.error(`Rendered stage preparation failed: ${String(error)}`, 'model-play');
        documentPlayExtension('model')?.setPlaying(modelId, false);
      });
    };
    start();
    let waitingStage: ReturnType<typeof viewportStages>[number] | undefined;
    let stopPrepareFrames: (() => void) | undefined;
    const waitForDraw = () => {
      const stage = viewportStages().find(one => one.documentId === documentId);
      if (stage === waitingStage) return;
      stopPrepareFrames?.();
      waitingStage = stage;
      stopPrepareFrames = stage?.onFrame(start);
      start();
    };
    waitForDraw();
    const stopStages = onViewportStages(waitForDraw);
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && surfaceAcceptsKey(event)) {
        const extension = documentPlayExtension('model');
        if (extension?.escape) extension.escape(modelId);
        else extension?.setPlaying(modelId, false);
      }
    };
    window.addEventListener('keydown', onEscape, true);
    return () => {
      stopped = true;
      stopStages();
      stopPrepareFrames?.();
      window.removeEventListener('keydown', onEscape, true);
      stopScript?.();
      layers.remove();
      if (orbit) orbit.enabled = true;
    };
  }, [playing, documentId, blend, view]);
  /**
   * A SHADING PICK IS KEPT WHERE BLENDER KEEPS IT: in the file's own 3D View, the one it reopens
   * on (`blenderViewShading`), so the next save carries it and a reopen starts from it. Noted on
   * the view at once, so a remount before the next frame reads the pick and not the file's old
   * shading. Modes Blender's four cells do not name (Clay, Matcap…) stay the editor's.
   */
  useEffect(() => {
    if (!main || !documentId) return;
    const keep = (): void => {
      const saved = view.savedView();
      const mode = viewPresentation(documentId).drawMode;
      const shading = BLENDER_SHADING[mode as keyof typeof BLENDER_SHADING];
      if (!saved || shading === undefined || saved.drawMode === mode) return;
      view.noteSavedShading(shading);
      void blenderViewShading(shading);
    };
    return subscribeViewportPresentation(keep);
  }, [main, documentId, view]);
  /**
   * AND WITH THE AREA'S SHOW OVERLAYS OFF, the switch that makes a camera view read as the render
   * does: no grid, no camera or light wires, no selection marks, no view text — and still the
   * camera's outline and passepartout (`drawviewborder`: "When overlays are disabled, only show
   * camera outline & passepartout"). Set once per stage store, which outlives the area's remounts,
   * so turning them back on is the person's and stays.
   */
  useEffect(() => {
    if (main || !documentId) return;
    const opened = (): void => {
      const store = stageStore(documentId);
      if (store === null || overlaysOpened.has(store)) return;
      overlaysOpened.add(store);
      if (store.showHelpers) store.toggleHelpers();
      if (store.showGizmos) store.toggleGizmos();
    };
    opened();
    return subscribeStageStores(opened);
  }, [main, documentId]);
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
    const groups = view.overlayGroups();
    const apply = (): void => {
      const stage = viewportStages().find((one) => one.documentId === documentId);
      if (!stage) return;
      for (const { kind, object } of groups) stage.setHelper(kind, object);
    };
    apply();
    const stop = onViewportStages(apply);
    return () => {
      stop();
      const stage = viewportStages().find((one) => one.documentId === documentId);
      for (const { kind } of groups) stage?.setHelper(kind, null);
    };
  }, [documentId, view]);
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
    // The skin poses the presented view's graph; a follower's has no skeleton bound.
    if (!documentId || !main) return;
    const { transport } = editorHost();
    let detach: (() => void) | null = null;
    let cancelled = false;
    let queued = false;
    const attach = (): void => {
      if (cancelled || detach) return;
      const handle = transport.for(documentId);
      if (!handle) return;
      detach = blenderSkin.attachTo(handle);
    };
    // attachTo restores the loaded clip's bookmark through transport.seek.
    // That publishes the skin/transport snapshots consumed by the Timeline's
    // separate React root. Keep those updates outside this root's passive
    // effect stack, including a registry notification during another effect.
    const requestAttach = (): void => {
      if (cancelled || queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; attach(); });
    };
    requestAttach();
    const stop = transport.subscribe(requestAttach);
    return () => {
      cancelled = true;
      stop();
      // Detaching the subject also publishes the transport snapshot. A
      // superseded effect releases its own handle before the next attachment.
      const release = detach;
      detach = null;
      if (release) queueMicrotask(release);
    };
  }, [documentId, main]);
  /**
   * BLENDER'S RENDERED SHADING IS THE SCENE'S OWN LIGHT. When this stage's view lights by the
   * `scene` (the Rendered shading cell, or the Lighting row's Scene), the presenter holds the viewport
   * in the lighting its render photographs with (`BlenderRuntimeView.holdRendered`): the
   * scene's lights, its World and shadows, through the camera the stage draws
   * with, re-applied from the stage's frame loop when that camera or the World changes. Any
   * other source returns it to modeling. The stage itself draws a `scene` source unlit
   * (`standard-viewport-dressing.ts`), because Blender's lights live in the presenter.
   */
  useEffect(() => {
    if (!documentId) return;
    const stageOf = () => viewportStages().find((one) => one.documentId === documentId);
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
      const { lighting, drawMode } = viewPresentation(documentId);
      const preview = drawMode === 'preview';
      const sceneLighting = preview ? { world: lighting.source === 'scene', lights: lighting.preview.sceneLights } : undefined;
      const needsScene = lighting.source === 'scene' || (preview && lighting.preview.sceneLights);
      // Shading changes lighting, not which objects an editing viewport shows.
      // Only the detached game uses render visibility, as a clean capture does.
      view.holdRendered(needsScene && stage ? drawCamera : null, sceneLighting, playing ? 'render' : 'viewport');
      // BLENDER'S SOLID IS BLENDER'S OWN FUNCTION: while the stage lights by Blender's studio, the
      // presenter draws every surface by it (`blender-workbench-material.ts`).
      view.setWorkbench(lighting.source === 'studio' && lighting.studioPreset === DOCUMENT_STUDIO_PRESET.id);
    };
    apply();
    const stopPresentation = subscribeViewportPresentation(apply);
    const stopStages = onViewportStages(apply);
    return () => {
      stopPresentation();
      stopStages();
      stopFrame?.();
      view.holdRendered(null);
      view.setWorkbench(false);
    };
  }, [documentId, view, playing]);
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
    !playing && event.button === 2 && event.shiftKey && event.target instanceof HTMLCanvasElement;
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
      ref={surfaceRef}
      data-play-ready={playing ? playReady : undefined}
      style={playing ? { position: 'absolute', inset: 0 } : { display: 'contents' }}
      onPointerDownCapture={onPointerDownCapture}
      onPointerUpCapture={onPointerUpCapture}
      onPointerCancelCapture={dropCursorPress}
      onLostPointerCaptureCapture={dropCursorPress}
      onContextMenuCapture={onContextMenuCapture}
    >
    <Surface
      active={active ?? true}
      fillContainer={playing}
      documentId={documentId}
      sourcePath={blend ?? 'blender:runtime'}
      displayName={document?.label ?? 'Model'}
      // THE OVERLAY'S SUBJECT AND GRID LINES ARE BLENDER'S: the engine composes the subject from
      // the scene (`session.py` `_subject_line`) and names the grid's step in the scene's units.
      {...(subject === null ? {} : { subject })}
      gridScale={reads.gridScale}
      cameraView={reads.cameraView}
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
      // A PLAYING COPY HAS NO AUTHORING: it is read-only to the editor, and what moves it is its
      // script. With none given the stage is the native read-only one.
      {...(playing ? {} : { authoring })}
      cameraDirection={[0.8187, 0.4458, 0.3617]}
      // FOR A FILE THAT SAVED NO 3D VIEW: Blender's factory Modeling direction, standing back
      // three fits.
      openingFit={3}
      // WHERE BLENDER OPENS THE FILE: its own saved 3D View, when it holds one; the direction and
      // fit above are the fallback for a file that saved none.
      openingView={view.savedView()}
      // The file's own lens (Blender's arithmetic in degrees) and, for the main area, the shading
      // its view was saved in, as the document's presentation: Blender reopens a file saved in
      // Material Preview in Material Preview, so a textured scene saved that way does not open
      // grey. The second area is the render preview and opens Rendered.
      presentation={(() => {
        const saved = view.savedView();
        if (!saved) return null;
        const camera = { fov: blenderViewFieldOfView(saved.lens) };
        return main && saved.drawMode ? {
          camera, drawMode: saved.drawMode,
          modes: { preview: {
            lighting: { source: saved.sceneWorld ? 'scene' as const : 'preview' as const, preview: { sceneLights: saved.sceneLights } },
            backdrop: { source: saved.sceneWorld ? 'scene' as const : 'fill' as const },
          } },
        } : { camera };
      })()}
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
      // THE VIEW TRANSFORM IS EACH SHADING MODE'S OWN (`src/presentation.ts`: Standard for Solid,
      // AgX for Material Preview and Rendered), so the dressing states none: a document mapper
      // would outrank every mode's.
      dressing={{
        environment: false,
        keyLight: false,
        viewLocked: view.studioLights(),
      }}
    />
    </div>
  );
}
