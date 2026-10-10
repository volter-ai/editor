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
import './blender-properties-context';
import { liveAnimation, setLiveAnimation } from '../src/play-live';
import { decodeFrameFile } from '../web-export/frame-codec';
import { LEVEL_MANIFEST_FILE, levelDir, WEB_EXPORT_CLIPS_FILE, WEB_EXPORT_FRAME_FILE, WEB_EXPORT_MOVIE_FILE, type LevelManifest, type WebExportClips } from '../web-export/web-export-files';
import { fileHash } from './blender-export.command';
import type { BlenderSceneMovie } from '@volter/blender-engine/browser/rna';
import { blenderViewFieldOfView } from '../src/presentation';
import { readBlenderDisplaySettings } from './blender-display-settings';
import {
  type BlenderRuntimeView,
  blenderModelView,
} from '@volter/blender-engine/browser/three/blender-runtime-view';
import { ownedSurfaceMaterial } from '@volter/blender-engine/browser/three/blender-physical-material';
import { createBlenderDisplayTransform, type BlenderDisplayTransform } from '@volter/blender-engine/browser/three/blender-display-transform';
import type { ToolContributionProps, ToolDocumentToolbar } from '@volter/sdk/contributions';
import { editorHost } from '@volter/sdk/host';
import {
  documentViewport,
  documentViewportsVersion,
  subscribeDocumentViewports,
} from '@volter/sdk/kit/document-viewports';
import {
  DOCUMENT_STUDIO_PRESET,
  setViewPresentation,
  subscribeViewportPresentation,
  viewPresentation,
  viewPresentationSnapshot,
} from '@volter/sdk/kit/viewport-presentation';
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
  subscribeBlenderRna,
  blenderViewShading,
  openModelDocumentBlend,
  modelDocumentMayOpen,
  modelDocumentOwnsPresentation,
  blenderActionClip,
  blenderSceneMovie,
  blenderRnaVersion,
} from '../host/blender-runtime-host';
import { BlenderObjectModeHeader } from './blender-header-menus';
import { blenderOutlinerAuthoringFor, createBlenderOutlinerAuthoring } from './blender-outliner-authoring';
import { blenderSkin } from './blender-runtime-skin';
import { playAnimation, type PlayAnimation, type PlayClipCache } from './blender-play-skin';

/** Clip reads per model document, kept across Plays (`PlayClipCache`). */
const playClipCaches = new Map<string, PlayClipCache>();
/** A playing game's camera starts on these clip planes (`projection.owned`): near enough for a
 *  character a step from the camera, and never so far that the depth buffer cannot tell surfaces apart. */
const PLAY_CAMERA_NEAR = 0.1;
const PLAY_CAMERA_FAR = 20_000;
import { areaSplit, subscribeAreaSplit } from '../src/area-split';
import { noteModelDocument } from '../src/play-mode';
import { documentPlayExtension, subscribeDocumentPlayExtensions } from '@volter/sdk/kit/document-play-extension';
import { notifyWorkspaceDocumentSelectionChanged } from '@volter/sdk/kit/workspace-document-registry';
import {
  documentSecondAreaHeader,
  setDocumentSecondArea,
  subscribeDocumentAreas,
} from '@volter/sdk/kit/document-areas';
import { createPortal } from 'react-dom';
import { onViewportStages, viewportStages } from '@volter/editor-threejs/viewport-door';
import {
  object3DDocumentSession,
  subscribeObject3DDocumentSessions,
} from '@volter/editor-threejs/kit/authoring/object3d-document-session-registry';
import type { ToolObject3DAuthoringProps } from '@volter/editor-threejs/object3d-contributions';
import { stageStore, subscribeStageStores } from '@volter/sdk/kit/stage-store-registry';
import { surfaceAcceptsKey } from '@volter/sdk/kit/surface-keyboard';
import { BlenderModelOpening } from './blender-model-opening';
import { modelOpeningErrorMessage } from '../src/model-opening-error';
import { commandLine } from '@volter/sdk/kit/product-command';
import { fontSizeVar, spaceVar, themeVars } from '@volter/sdk/widgets';
import { clearStartupFailure, reportStartupFailure } from '@volter/sdk/kit/startup-failure';

/** This document's model open, as a source in the page's startup-failure registry. */
const MODEL_OPEN_STARTUP_SOURCE = 'blender-model-open';
/** How long "Opening model…" stands before the pane also says what it is waiting on. */
const MODEL_OPEN_NOTE_AFTER_MS = 30_000;
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
  /** What a slow open is waiting on, once it has been slow (`MODEL_OPEN_NOTE_AFTER_MS`). */
  const [stillOpening, setStillOpening] = useState<string | null>(null);
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
    setStillOpening(null);
    // Native focus can arrive after the contributed pane mounts. A declined
    // open is not an in-flight load: retry when the host activates this model,
    // rather than leaving "Opening model…" latched forever. Utility focus
    // after a successful open must not tear down the model's published view.
    const documents = editorHost().documents;
    let starting = false;
    let finished = false;
    let declined = false;
    const path = blend ?? 'the model';
    const open = async () => {
      if (cancelled || starting || finished) return;
      if (binding && !modelDocumentMayOpen(binding)) { declined = true; return; }
      starting = true;
      declined = false;
      try {
        if (binding) {
          if (!await openModelDocumentBlend(binding, publish)) { declined = true; return; }
        } else {
          // The standing Model document is the explicit blender-start target.
          publish();
        }
        if (!cancelled) {
          finished = true;
          clearStartupFailure(MODEL_OPEN_STARTUP_SOURCE);
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
        callbacks.current.notify?.({ tone: 'error', title: `Blender could not open ${path}`, detail: modelOpeningErrorMessage(detail) });
        // AND TO THE PRODUCT'S COVER, which is still up while the first model opens and
        // would otherwise go on saying "Opening the first model…" over this pane's error
        // until its own budget ran out. After the cover has lifted, this changes nothing.
        reportStartupFailure(MODEL_OPEN_STARTUP_SOURCE, {
          message: `Blender could not open ${path}: ${detail}`,
          guidance: `${modelOpeningErrorMessage(detail)} Dismiss this to reach the model's Retry.`,
          command: null,
        });
      } finally {
        starting = false;
      }
    };
    // A SLOW OPEN SAYS WHAT IT IS WAITING ON (2026-10-06 audit: "Opening model…" had no word
    // past its spinner, and a declined open sat there indefinitely). It is progress, never an
    // error, and it offers no Retry (#147 review): the open is still running, and a second one
    // would queue behind it. A real failure arrives through the catch above.
    const slow = setInterval(() => {
      if (cancelled || finished) return;
      setStillOpening(declined
        ? `Still waiting: Blender is holding another model, and opens ${path} when it is free.`
        : `Still opening ${path}: Blender is working (a large file, or a cold start). ${commandLine('status')} shows what it is busy with.`);
    }, MODEL_OPEN_NOTE_AFTER_MS);
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
      clearInterval(slow);
      unsubscribe();
      unpublish?.();
      unbind();
    };
  }, [active, blend, documentId, entryId, key, attempt]);

  if (active === false || !documentId) return null;
  if (opened?.key !== key || opened.error) return <BlenderModelOpening
    documentId={documentId} path={blend ?? 'Model'} error={opened?.key === key ? opened.error : null} preview={preview}
    note={stillOpening}
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
    let applied: { key: string; transform: BlenderDisplayTransform } | null = null;
    const ids = [documentId, `${documentId}#area-2`, `${documentId}#play`];
    const attach = () => {
      for (const id of ids) object3DDocumentSession(id)?.setDisplayTransform(applied?.transform ?? null);
    };
    const read = async () => {
      const mine = ++revision;
      const display = await readBlenderDisplaySettings();
      if (cancelled || mine !== revision || !display) return;
      const key = JSON.stringify(display);
      if (applied?.key === key) return;
      const resolved = await createBlenderDisplayTransform(display);
      if (cancelled || mine !== revision) { resolved.dispose(); return; }
      const previous = applied;
      applied = { key, transform: resolved };
      attach();
      previous?.transform.dispose();
      for (const id of ids) {
        setViewPresentation(id, { modes: {
          rendered: { lighting: { tone: { mapper: 'none', exposure: 1 } } },
          preview: { lighting: { tone: { mapper: 'none', exposure: 1 } } },
        } });
      }
    };
    const update = () => { void read().catch(error => editorHost().console.error(String(error), 'blender-colour')); };
    const stopRna = subscribeBlenderRna(update);
    const stopSessions = subscribeObject3DDocumentSessions(attach);
    update();
    return () => {
      cancelled = true; stopRna(); stopSessions();
      const previous = applied;
      applied = null;
      attach();
      previous?.transform.dispose();
    };
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
      {game && failure !== null && (
        // A PLAY WITH NO GAME, said over the area itself. When the script did not start (or the
        // stage could not be prepared) the game never draws and the model area stays in front,
        // so the area looked like plain editing while Play was on and the reason was a toast
        // that had already gone (2026-10-06 audit). The Game panel says the same in its line.
        <div key="play-failure" role="alert" data-testid="blender-play-failure"
          style={{ position: 'absolute', left: 24, right: 24, top: 24, zIndex: 4, padding: `${spaceVar[2]} ${spaceVar[3]}`,
            background: themeVars.surface.chrome, border: `1px solid ${themeVars.semantic.danger}`, borderRadius: themeVars.shape.small,
            color: themeVars.content.primary, fontSize: fontSizeVar.sm, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' }}>
          <strong style={{ color: themeVars.semantic.danger }}>Play is not running.</strong> {failure} Restart (or save the script) to try again, or Stop.
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
 * (`@volter/sdk/kit/document-areas`). Its HEADER stands in the document's header row over
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
    let projection: { owned: boolean } | null = null;
    let animation: PlayAnimation | null = null;
    const start = (): void => {
      if (stopScript || preparing || stopped) return;
      const stage = viewportStages().find((one) => one.documentId === documentId);
      if (!stage || !view.root.parent) return;
      preparing = true;
      orbit = stage.rig().orbit;
      orbit.enabled = false;
      // THE GAME OWNS ITS CAMERA'S PROJECTION: the stage stops fitting the clip planes to the file
      // (which pushed `near` out with the file's size), and the game starts from planes fit for a
      // game: 0.1 m near, the fitted reach as far, no more than 20 km. A script may set its own.
      projection = stage.rig().projection ?? null;
      if (projection) {
        projection.owned = true;
        const drawn = stage.rig().drawCamera() as THREE.PerspectiveCamera;
        if (drawn.isPerspectiveCamera) {
          drawn.near = PLAY_CAMERA_NEAR;
          drawn.far = Math.min(Math.max(drawn.far, 1000), PLAY_CAMERA_FAR);
          drawn.updateProjectionMatrix();
        }
      }
      // THE COPY'S CHARACTERS ANIMATE: its view bound their skins from the copied frame, and each
      // armature plays the action the file assigns it until the game sets another
      // (`blender-play-skin.ts`). Nothing is read before the game starts.
      // A LOADING PHASE, said on screen: the game starts only once its stage is drawn and every
      // character's starting clips are baked (`PlayAnimation.prepare`). Started before them, a
      // character whose clip Blender had not answered yet stood frozen in its rest pose, and a
      // clip whose read failed stayed frozen for the whole run. That is the suspected cause of
      // "sometimes none of the animations work" (a busy Blender was measured to delay the clips).
      // THE WAIT IS BOUNDED AND SAID: after LOADING_SAY the overlay names the clips still
      // awaited; at LOADING_LIMIT the game starts without them and the console names them (each
      // still plays once Blender answers). A thrown `prepare` is named too; the game always starts.
      const loading = window.document.createElement('div');
      loading.dataset['testid'] = 'model-play-loading';
      loading.textContent = 'Loading…';
      Object.assign(loading.style, {
        position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.35)', color: '#e6e6e6', font: '600 14px system-ui, sans-serif', pointerEvents: 'none',
      });
      layers.appendChild(loading);
      void view.prepareRendered(stage.rig().drawCamera(), 'render').then(async () => {
        if (stopped) return;
        // No session answers null: a read that failed, asked again, not a clip that animates nothing.
        // A SETUP THAT THROWS still starts the game, without animation and said so; left
        // outside any catch it left the loading overlay up and the script never ran.
        let cache = playClipCaches.get(modelId);
        if (!cache) playClipCaches.set(modelId, cache = new Map());
        let loaded: PlayAnimation | null = null;
        try {
          loaded = playAnimation(view, async (armature, action) => {
            const clip = await blenderActionClip({ object: armature, action, summary: false });
            if (clip === null) throw new Error("Blender's session is not started");
            return clip;
          }, cache, { warn: (said) => editorHost().console.warn(said, 'blender-animation'), readMovie: () => blenderSceneMovie() });
        } catch (error) {
          editorHost().console.error(`The game's animation could not be set up, so the game starts without it: ${error instanceof Error ? error.message : String(error)}`, 'blender-animation');
        }
        animation = loaded;
        if (!loaded) {
          loading.remove();
          if (stopped) return;
        }
        if (loaded) {
          const anim = loaded;
          const LOADING_SAY = 3_000, LOADING_LIMIT = 20_000;
          const clips = (names: readonly string[]): string => `${names.length} clip${names.length === 1 ? '' : 's'}`;
          const say = window.setInterval(() => {
            const pending = anim.pending();
            if (pending.length > 0) loading.textContent = `Loading… waiting on Blender for ${clips(pending)}: ${pending.slice(0, 6).join(', ')}${pending.length > 6 ? ` and ${pending.length - 6} more` : ''}`;
          }, LOADING_SAY);
          let limit = 0;
          const outcome = await Promise.race([
            anim.prepare().then(({ failed }) => ({ failed, waiting: [] as readonly string[] }), (error: unknown) => ({ failed: [`the loading phase failed: ${error instanceof Error ? error.message : String(error)}`], waiting: [] as readonly string[] })),
            new Promise<{ failed: readonly string[]; waiting: readonly string[] }>((resolve) => {
              limit = window.setTimeout(() => resolve({ failed: [], waiting: anim.pending() }), LOADING_LIMIT);
            }),
          ]);
          window.clearInterval(say);
          window.clearTimeout(limit);
          loading.remove();
          if (stopped) return;
          if (outcome.failed.length > 0)
            editorHost().console.warn(`The game started without ${clips(outcome.failed)} it starts on: ${outcome.failed.join('; ')}`, 'blender-animation');
          if (outcome.waiting.length > 0)
            editorHost().console.warn(`The game started after ${LOADING_LIMIT / 1000} s still waiting on Blender for ${clips(outcome.waiting)}; each plays once Blender answers: ${outcome.waiting.join(', ')}`, 'blender-animation');
          anim.prefetch();
        }
        setLiveAnimation(animation);
        /** A LEVEL'S COOK, read and decoded once per run (`play.preload` reads it ahead of its load). */
        const cooks = new Map<string, Promise<{ manifest: LevelManifest; frame: { session: string }; clips: WebExportClips; movie: BlenderSceneMovie | null }>>();
        const readCook = (level: string) => {
          let cook = cooks.get(level);
          if (!cook) {
            cook = (async () => {
              const files = editorHost().files;
              const dir = levelDir(level);
              if (!(await files.exists(`${dir}/${LEVEL_MANIFEST_FILE}`)))
                throw new Error(`There is no cooked level "${level}": cook it with \`cyclotron levels cook ${level}\`.`);
              const manifest = JSON.parse(await files.read(`${dir}/${LEVEL_MANIFEST_FILE}`)) as LevelManifest;
              if ((await fileHash(manifest.blend).catch(() => null)) !== manifest.hash)
                editorHost().console.warn(`Level "${level}" was cooked before ${manifest.blend} last changed, and plays as it was then; \`cyclotron levels cook ${level}\` cooks it again.`, 'model-play');
              const [frameBytes, clipsText, movieText] = await Promise.all([
                files.readBytes(`${dir}/${WEB_EXPORT_FRAME_FILE}`),
                files.read(`${dir}/${WEB_EXPORT_CLIPS_FILE}`),
                files.read(`${dir}/${WEB_EXPORT_MOVIE_FILE}`).catch(() => 'null'),
              ]);
              return {
                manifest,
                frame: decodeFrameFile(frameBytes) as { session: string },
                clips: JSON.parse(clipsText) as WebExportClips,
                movie: JSON.parse(movieText) as BlenderSceneMovie | null,
              };
            })();
            cooks.set(level, cook);
            cook.catch(() => { if (cooks.get(level) === cook) cooks.delete(level); });
          }
          return cook;
        };
        stopScript = documentPlayExtension('model')?.run({
          ...(animation ? { animation } : {}),
          documentId: modelId,
          container: layers,
          ready: () => { if (!stopped) { setPlayReady(true); playReadyRef.current?.(); } },
          returning: () => { if (!stopped) playReturnRef.current?.(); },
          sourcePath: blend,
          root: view.root,
          // A LEVEL (`play.load`, docs/LEVELS.md), from its cook: its frame replaces the copy's scene
          // in this same view (the stage, the rendered draw and `root` stay), its clips and movie
          // become the run's animation
          preloadLevel: async (level) => { await readCook(level); },
          loadLevel: async (level) => {
            const files = editorHost().files;
            const { manifest, frame, clips, movie } = await readCook(level);
            cooks.delete(level);
            if (stopped) throw new Error('Play stopped while the level was loading.');
            // ITS OWN SESSION: the view takes it as a new scene, never as an older frame of this one
            frame.session = `level:${level}:${Date.now()}`;
            const previous = animation;
            if (liveAnimation() === previous) setLiveAnimation(null);
            previous?.dispose();
            animation = null;
            view.applyFrame(frame);
            await view.prepareRendered(stage.rig().drawCamera(), 'render');
            const next = playAnimation(view, async (armature, action) => {
              const entry = clips.armatures[armature]?.[action];
              if (typeof entry === 'number') return clips.clips[entry] ?? null;
              throw new Error(typeof entry === 'string' ? entry : `${armature} / ${action} was not cooked with level "${level}"`);
            }, new Map(), { warn: (said) => editorHost().console.warn(said, 'blender-animation'), readMovie: async () => movie });
            const { failed } = await next.prepare();
            if (failed.length > 0) editorHost().console.warn(`Level "${level}" started without ${failed.length} clip(s): ${failed.join('; ')}`, 'blender-animation');
            if (stopped) { next.dispose(); throw new Error('Play stopped while the level was loading.'); }
            animation = next;
            setLiveAnimation(next);
            // the level's own play script, beside its .blend, when it has one
            const script = manifest.blend.replace(/\.blend$/i, '') + '.play.ts';
            return { animation: next, script: (await files.exists(script)) ? script : null };
          },
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
        loading.remove();
        if (stopped) return;
        const failure = `The game's stage could not be prepared for a rendered draw: ${error instanceof Error ? error.message : String(error)}`;
        editorHost().console.error(failure, 'model-play');
        // SAID WHERE THE PERSON IS LOOKING: on the run's clock, which the Game panel and the
        // play area draw, and in the play log. Turning Play off (what this did until
        // 2026-10-06) erased the only trace a person could have seen.
        const extension = documentPlayExtension('model');
        if (extension?.transport?.fail) extension.transport.fail(modelId, blend, failure);
        else {
          notifyRef.current?.({ tone: 'error', title: 'Play could not start', detail: failure });
          extension?.setPlaying(modelId, false);
        }
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
      if (event.key !== 'Escape' || !surfaceAcceptsKey(event)) return;
      // Decided once the event has finished dispatching: a play script that claims Escape (a
      // game's pause, registered after this listener) prevents its default, and the Escape that
      // frees a game's mouse look is the person taking their mouse back. Both used to stop Play
      // (three playtests of a Cyclotron game lost a mission each to it).
      if (globalThis.document.pointerLockElement || performance.now() - lastPointerUnlockAt < 500) return;
      setTimeout(() => {
        if (event.defaultPrevented) return;
        const extension = documentPlayExtension('model');
        if (extension?.escape) extension.escape(modelId);
        else extension?.setPlaying(modelId, false);
      }, 0);
    };
    let lastPointerUnlockAt = -Infinity;
    const onLockChange = (): void => { if (!globalThis.document.pointerLockElement) lastPointerUnlockAt = performance.now(); };
    globalThis.document.addEventListener('pointerlockchange', onLockChange);
    window.addEventListener('keydown', onEscape, true);
    return () => {
      globalThis.document.removeEventListener('pointerlockchange', onLockChange);
      stopped = true;
      stopStages();
      stopPrepareFrames?.();
      window.removeEventListener('keydown', onEscape, true);
      stopScript?.();
      // Only this run's animation is cleared: a restart's new run may already hold the slot.
      if (liveAnimation() === animation) setLiveAnimation(null);
      animation?.dispose();
      animation = null;
      layers.remove();
      if (orbit) orbit.enabled = true;
      if (projection) { projection.owned = false; projection = null; }
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
   * THE ASSIGNED ACTION ON THE PRESENTED SKELETONS. The skins themselves come with every frame (the
   * presenter binds them, `blender-runtime-skeleton.ts`); after each present the director follows
   * the frame, and reads a clip only when the frame says its action, revision or clock moved.
   */
  const rnaVersion = useSyncExternalStore(subscribeBlenderRna, blenderRnaVersion, blenderRnaVersion);
  useEffect(() => {
    if (!documentId || !main) return;
    let live = true;
    void blenderSkin.sync(view, {
      clip: (armature) => blenderActionClip(armature === null ? {} : { object: armature }),
      bake: (armature, action) => blenderActionClip({ object: armature, action, summary: false }),
      movie: () => blenderSceneMovie(),
    }).catch((thrown: unknown) => {
      if (live) editorHost().console.warn(`This file's action could not be read: ${thrown instanceof Error ? thrown.message : String(thrown)}`, 'blender-skin');
    });
    return () => { live = false; };
  }, [documentId, main, view, rnaVersion]);
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
