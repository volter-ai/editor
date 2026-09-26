/**
 * Props for ordinary React components registered at editor contribution
 * points. There is deliberately no extension class or lifecycle: package
 * metadata names a module and the editor renders its default export.
 */

import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import type { GenerationAccountProjection } from '@volter/editor-sdk/account';
import type { GenerationJob } from '@volter/editor-sdk/generations';
import type {
  AnimationClip,
  Camera,
  ColorRepresentation,
  Group,
  Intersection,
  Object3D,
  Ray,
  Scene,
  ToneMapping,
  WebGLRenderer,
} from 'three';
import type { EditorClient } from './client.js';
import type { ProjectToolCatalogEntry } from './types.js';

/** Stable, format-neutral selection data available to inspector contributions. */
export interface ToolContributionNode {
  readonly id: string;
  readonly label: string;
  readonly role?: string;
  readonly secondaryLabel?: string;
  readonly kind: string;
  readonly parentId: string | null;
  readonly childIds: string[];
}

/**
 * One disposable native Three.js build supplied to the editor's generic
 * preview surface. This is a host-lifetime boundary, not a model format or
 * procedural-asset base class: project code still constructs ordinary
 * Object3D and AnimationClip instances directly.
 */
export interface ToolObject3DPreviewSource {
  readonly root: Object3D;
  /**
   * Optional authored roots for the document hierarchy when `root` is a
   * presentation/lifetime container rather than authored content itself.
   * Framing, ticking and disposal still own `root`; this list only scopes the
   * shared Hierarchy. Omitted means `root`, preserving the native tree.
   */
  readonly hierarchyRoots?: readonly Object3D[];
  readonly animations?: readonly AnimationClip[];
  /**
   * The source's OWN tick, and the host drives it EXACTLY ONCE per mount — for
   * the bounded design-time settle that gives a physics-owned body the pose it
   * actually rests in (`authoring/design-time-settle.ts`). It is never a frame
   * loop: content time does not advance on a design-time surface, so a source
   * that animates from here shows its settled pose and then holds it. Play is
   * where a world runs.
   */
  update?(deltaSeconds: number): void;
  /**
   * EVERY CHANGE TO WHAT THE SOURCE DRAWS, announced: the host calls
   * `listener` whenever the source's graph, materials, textures or poses may
   * look different, and returns nothing from it. A source that offers this is
   * drawn only when something changed -- this, the camera, input on the
   * stage, the editor's own state, playback -- so an idle document costs no
   * frames. A source without it is drawn every frame.
   */
  onChange?(listener: () => void): () => void;
  dispose(): void;
}

/** Direct native handles for optional project-owned preview presentation. */
export interface ToolObject3DPreviewContext {
  readonly scene: Scene;
  readonly camera: Camera;
  readonly renderer: WebGLRenderer;
  /**
   * A cloned Object3D graph, never the source root itself. Geometry,
   * materials, and textures are shared read-only with the disposable source;
   * clone a resource before applying preview-only mutations to it.
   */
  readonly model: Object3D;
}

export interface ToolObject3DPreviewExtension {
  /** When present, replaces the viewer's default render call for this frame. */
  render?(deltaSeconds: number): void;
  /** Resize project-owned composers and render targets with the host viewport. */
  resize?(width: number, height: number, pixelRatio: number): void;
  /** Release every light, ground mesh, pass, target, and listener added here. */
  dispose(): void;
}

export interface ToolObject3DPreviewProps {
  /** Build a fresh source. The host disposes it after its preview snapshot. */
  readonly build: () => ToolObject3DPreviewSource;
  readonly displayName?: string;
  readonly height?: number | string;
  readonly background?: ColorRepresentation;
  readonly showSkeleton?: boolean;
  readonly cameraDirection?: readonly [number, number, number];
  /** Host diagnostic grid. Defaults off with setupPreview, on otherwise. */
  readonly showGrid?: boolean;
  /** Host studio lights. Defaults off with setupPreview, on otherwise. */
  readonly useDefaultLighting?: boolean;
  /** Explicit renderer exposure. Custom presentation otherwise owns it. */
  readonly exposure?: number;
  /**
   * Optional raw Three.js presentation hook for project-specific lights,
   * ground, or postprocessing. Host grid/studio lights default off when this
   * is present. It is preview chrome and is never exported.
   */
  readonly setupPreview?: (
    context: ToolObject3DPreviewContext,
  ) => ToolObject3DPreviewExtension | undefined;
  readonly active?: boolean;
}

/**
 * Per-document overrides of the editor's standard viewport dressing — explicit
 * opt-outs and opt-ins, never re-implementations. Omitted means the standard
 * look (`standard-viewport-dressing.ts`).
 */
export interface ToolViewportDressing {
  /** `false` skips the RoomEnvironment IBL — and, with it, the stage's
   *  environment INTENSITY: a document that opts out of image-based lighting
   *  is lit by its own lights alone. Default on. */
  readonly environment?: boolean;
  /** `false` skips the gradient backdrop. Default on (an explicit flat
   *  `background` color or the asset studio stage also skips it). */
  readonly background?: boolean;
  /** `false` skips the key light — and the editor's own design-time light
   *  rig with it, because both answer the same question and a document that
   *  says "I light myself" is answering it. Default on; a source that
   *  authors its own lights skips the key regardless — authored lighting
   *  always wins. */
  readonly keyLight?: boolean;
  /** `true` adds the ground grid (content standing on y=0). Default off. */
  readonly grid?: boolean;
  /**
   * An object the STAGE parents to its own camera, so everything under it
   * turns with the view instead of standing still in the world.
   *
   * It exists for VIEW-SPACE LIGHTING — Blender's Solid mode has no world
   * light at all, only four studio lights stated in view space, which is why
   * its shading reads the same however the model is orbited. A directional
   * light here states its direction in the camera's own space (three's camera
   * looks down −Z) and keeps its `target` under this object at the origin.
   *
   * The stage owns the parenting AND the teardown: a document hands the
   * object over and its own `dispose` never touches the camera.
   */
  readonly viewLocked?: Object3D;
  /**
   * THE STAGE'S VIEW TRANSFORM — three's `WebGLRenderer.toneMapping`. Omitted
   * means the editor's own, ACES.
   *
   * A document whose source system states its own transform passes that one
   * instead: Blender's factory scene is AgX (`view_settings.view_transform`),
   * and this product's Blender RENDER path already photographs through
   * `AgXToneMapping` — so before this existed the viewport was the one
   * surface in the chain running a different curve from the thing it frames.
   * It is not a look preference: the curve decides how a shading range lands
   * on screen, and two curves over one radiance are two different pictures.
   */
  readonly toneMapping?: ToneMapping;
}

/**
 * A native source graph hosted by the editor's normal Three.js authoring
 * viewport, hierarchy, selection, and Inspector. Unlike Object3DPreview this
 * surface exposes the live graph as the active workspace document context.
 */
export interface ToolObject3DAuthoringProps {
  readonly documentId: string;
  readonly sourcePath: string;
  /**
   * Produce the graph to author. Called ONCE PER ACTIVATION, not once per
   * document: the host tears its scene down whenever the document goes inactive
   * (an ordinary tab switch) and calls this again on the way back, disposing
   * whatever the previous call returned. So a caller must pick one of two
   * shapes, and there is no third:
   *
   *  - a FACTORY — build a fresh graph every call, and let the returned
   *    `dispose` free it (what the model/entity asset documents do); or
   *  - an OWNED graph — return the same root every call with an EMPTY `dispose`,
   *    and free it from the caller's own lifetime instead (what the 3D
   *    components board and the story turntable do, because their graph is
   *    async to create).
   *
   * Returning a graph you cannot rebuild synchronously AND a `dispose` that
   * really frees it is the third shape, and it renders a black panel on the
   * second activation.
   */
  readonly build: () => ToolObject3DPreviewSource;
  readonly displayName?: string;
  /** Explicit flat scene background. Omit it to inherit the editor's standard
   *  viewport dressing (environment, gradient backdrop, key light). */
  readonly background?: ColorRepresentation;
  /**
   * The Asset Lab's IMPORT AUDIT on this document's inspector — the Geometry
   * block (triangle counts, GPU estimate, LODs, collision, invalid values)
   * and the Source row. Default on: it is what an imported model's inspector
   * is for. A modeling document that carries its own data panel (the mesh
   * document's Data / Modifiers sections) passes `false`, the way Blender's
   * Object Data tab is the mesh's own, not an importer's report.
   */
  readonly audit?: boolean;
  readonly cameraDirection?: readonly [number, number, number];
  /** Per-document overrides of the standard viewport dressing. */
  readonly dressing?: ToolViewportDressing;
  /** The kind of stage this view is, for its starting presentation
   *  (`@volter/editor-sdk/kit/viewport-presentation`): the document's own kind (`'model'`).
   *  Without it the kind is read off the document id's prefix. */
  readonly stageKind?: string;
  /** How far the OPENING view stands back from a fit of the content: `1` fills the view (the
   *  default). Frame (numpad .) still fits exactly. */
  readonly openingFit?: number;
  /**
   * THE OPENING VIEW STATED OUTRIGHT, for a document whose file saved one (a .blend's 3D View,
   * where Blender opens it): the pivot, the direction from the pivot to the eye, the distance, the
   * projection and the lens, in the stage's frame. The view's roll is not carried: the stage orbits a
   * turntable about the world's up. In place of `cameraDirection` and `openingFit` when given; Frame still
   * fits.
   */
  readonly openingView?: {
    readonly target: readonly [number, number, number];
    readonly direction: readonly [number, number, number];
    /** The screen's up, used where the direction runs along the world's up axis. */
    readonly up?: readonly [number, number, number];
    readonly distance: number;
    readonly projection?: 'perspective' | 'orthographic';
    /** The view's lens in mm over a 36 mm sensor (Blender's `View3D.lens`); the stage's 50 when
     *  omitted. */
    readonly lens?: number;
  } | null;
  /**
   * Optional binding from live native clips back to ordinary project source.
   * Project code only serializes its own TypeScript shape; the editor owns the
   * checksum-guarded write and records it in the canonical project history.
   * Without this binding the animation workspace remains honestly read-only.
   */
  /**
   * Project-owned serialization for this authored document. Each serializer
   * returns the exact bytes of one ordinary project file; the host writes all
   * resources as one checksum-guarded, failure-atomic history transaction.
   * The project owns the format and the host never interprets its contents.
   */
  readonly persistence?: ToolObject3DDocumentPersistence;
  /** Project-owned serialization of this document into ONE source module,
   * written through the editor's source seam (see the binding's docs). */
  readonly documentSource?: ToolDocumentSourceBinding;
  /** Replace the default native-tree projection with a semantic adapter. The
   * default adapter is provided for delegation, so a project can add terrain
   * layers, bones, or mesh elements without rebuilding Object3D projection. */
  readonly authoring?: ToolObject3DDocumentAuthoringFactory;
  /** Project-owned direct manipulation hosted by the editor's input and
   * transient-overlay lifecycle. Completed gestures commit `persistence`; an
   * Escape, unmount, thrown callback, or failed write calls `cancel`. */
  readonly interaction?: ToolObject3DDocumentInteraction;
  /**
   * The editor's orange SELECTION SILHOUETTE around whatever the hierarchy
   * has selected. Default on. A document that owns a sub-object editing mode
   * passes `false` while that mode is live: the silhouette is an OBJECT-level
   * affordance, and Blender draws none in Edit Mode. It is live — a document
   * may flip it as its own mode changes, and the outline appears or goes with
   * the next frame.
   */
  readonly selectionOutline?: boolean;
  readonly active?: boolean;
  /**
   * This document's own counts, drawn in the VIEWPORT OVERLAY under the view
   * and subject lines — Blender's home for them (`sculpting.png`: `Vertices
   * 8` / `Faces 6` below `User Perspective` / `(1) Cube | Cube`, never in the
   * header band). The host owns the block's geometry and ink; the document
   * owns which counts exist and what they are called, because only it knows
   * what it is counting. Omit it and no block is drawn.
   */
  readonly statistics?: readonly ToolViewportStatistic[];
  /**
   * This document's own SUBJECT LINE, the overlay's second line, drawn as given in place of the
   * host's `<document> | <active object>`. For a document whose source system composes that line
   * itself (Blender's `(1) Collection | Cube`, `draw_selected_name`). Omit it and the host's is
   * drawn.
   */
  readonly subject?: string;
  /**
   * The name of the grid's step under the subject line, for the world units per DEVICE pixel the
   * view is drawn at, or null for none (Blender's `10 Centimeters`, `draw_grid_unit_name`). The
   * host asks only in an axis-aligned orthographic view, where Blender draws it. Omit it and no
   * line is drawn.
   */
  readonly gridScale?: (worldPerDevicePixel: number) => string | null;
  /**
   * A CAMERA VIEW: looking through one of the document's own cameras, the way Blender's
   * `view3d.view_camera` (numpad 0, the navigation cluster's camera button) does. The document
   * says which camera and how its view fits a region; the stage owns the toggle, the frame's
   * zoom and offset, and leaving the view. Omit it and the stage has no camera view.
   */
  readonly cameraView?: ToolCameraViewSource;
}

/** See {@link ToolObject3DAuthoringProps.cameraView}. */
export interface ToolCameraViewSource {
  /** The camera a camera view entered now would look through, or null when there is none. */
  readonly camera: () => string | null;
  /** The frame zoom a camera view opens at, and the range it keeps to. */
  readonly zoom: { readonly opening: number; readonly min: number; readonly max: number };
  /**
   * The pan after the pointer moves `dx`, `dy` (fractions of the region's width and height,
   * down and right positive) at zoom `zoom`, from `offset`: the source's own pan state, which a
   * camera view opens at `[0, 0]` and hands back to `view` unread.
   */
  readonly pan: (
    offset: readonly [number, number],
    zoom: number,
    dx: number,
    dy: number,
  ) => readonly [number, number];
  /** Told the camera a camera view is looking through (null when none), so the document can
   *  stand down its own drawing of it: the view's frame is its border. */
  readonly showing?: (camera: string | null) => void;
  /**
   * Move `camera` to a pose in the stage's frame (the eye, and its rotation looking down -Z),
   * keeping its scale: what a LOCKED camera view does as it is navigated (Blender's
   * `View3D.lock_camera`, `ED_view3d_camera_lock_sync`). `final` is the navigation's end, the
   * one write a history records. Omit it and the view has no lock.
   */
  readonly setPose?: (
    camera: string,
    position: readonly [number, number, number],
    quaternion: readonly [number, number, number, number],
    final: boolean,
  ) => void | Promise<void>;
  /**
   * `camera`'s view on a region `width` × `height` pixels, at frame zoom `zoom` and pan
   * `offset`; null when that camera is gone.
   */
  readonly view: (
    camera: string,
    region: { readonly width: number; readonly height: number },
    zoom: number,
    offset: readonly [number, number],
  ) => ToolCameraView | null;
}

/** One camera view, in the stage's frame. */
export interface ToolCameraView {
  readonly name: string;
  /** The eye, looking down its own -Z with +Y up. */
  readonly position: readonly [number, number, number];
  readonly quaternion: readonly [number, number, number, number];
  readonly projection: 'perspective' | 'orthographic';
  /** The window: at unit distance for a perspective view, in world units for an orthographic
   *  one; up positive. */
  readonly window: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
  readonly near: number;
  readonly far: number;
  /** The camera's frame on the region, as fractions of its width and height from the top left. */
  readonly frame: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  /** Outside the frame: its colour and opacity (0 draws none). */
  readonly passepartout: { readonly color: string; readonly opacity: number };
  /** The frame's edge: a solid line under a dashed one, and the colour of the dashed box one
   *  pixel outside them while the view is locked to the camera; each a CSS colour. */
  readonly border: { readonly solid: string; readonly dashed: string; readonly locked: string };
}

/** One row of the viewport overlay's statistics block: Blender's label column
 *  and its value column. */
export interface ToolViewportStatistic {
  /** Stable row identity — the React key, never drawn. */
  readonly id: string;
  /** Blender's own noun where one exists (`Vertices`, `Faces`). */
  readonly label: string;
  readonly value: string;
}

/** The native document state handed back to project-owned serializers. */
export interface ToolObject3DDocumentState {
  readonly root: Object3D;
  readonly animations: readonly AnimationClip[];
}

/** One project-owned artifact participating in an Asset Lab commit. */
export interface ToolObject3DDocumentResource {
  /** Project-root-relative destination. */
  readonly path: string;
  /** MIME type recorded in canonical history. */
  readonly contentType?: string;
  /** `null` removes the file in the same atomic transaction. */
  readonly serialize: (
    document: ToolObject3DDocumentState,
  ) => string | Uint8Array | null | Promise<string | Uint8Array | null>;
}

export interface ToolObject3DDocumentPersistence {
  /** Default undo/redo label. A completed gesture may supply a narrower one. */
  readonly label?: string;
  /** Non-empty, path-unique set of files owned by this document. */
  readonly resources: readonly ToolObject3DDocumentResource[];
}

export interface ToolObject3DDocumentAuthoringContext extends ToolObject3DDocumentState {
  readonly documentId: string;
  readonly sourcePath: string;
  readonly scene: Scene;
  readonly defaultAdapter: AuthoringAdapter;
  /**
   * Serialize this project-owned document through its declared persistence
   * resources and record the change in canonical history. Rejects when the
   * document is read-only or the atomic write fails.
   */
  readonly commit: (label?: string) => Promise<boolean>;
}

export interface ToolObject3DDocumentAuthoring {
  readonly adapter: AuthoringAdapter;
  dispose?(): void;
}

export type ToolObject3DDocumentAuthoringFactory = (
  context: ToolObject3DDocumentAuthoringContext,
) => ToolObject3DDocumentAuthoring;

/** Adapter-native hit data for a project-owned Asset Lab gesture. */
export interface ToolObject3DPointerEvent {
  readonly pointerId: number;
  readonly button: number;
  readonly buttons: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly ray: Ray;
  readonly hits: readonly Intersection<Object3D>[];
}

/** One gesture owns exact rollback to its pre-begin document state. */
export interface ToolObject3DGesture {
  readonly label?: string;
  update(event: ToolObject3DPointerEvent): void;
  /** Finalize the project-owned native state before the host serializes it. */
  commit(event: ToolObject3DPointerEvent): void | Promise<void>;
  /** Restore exact pre-begin native state. Must be safe after partial commit. */
  cancel(): void | Promise<void>;
}

export interface ToolObject3DInteractionContext {
  readonly root: Object3D;
  readonly scene: Scene;
  readonly renderer: WebGLRenderer;
  /** Host-owned group removed on document teardown. Project code owns GPU
   * resources it adds and releases them from the extension's `dispose`. */
  readonly overlay: Group;
  /** Live camera getter; projection can change while the document is open. */
  readonly camera: () => Camera;
  /** False means gestures will not begin because no persistence binding exists. */
  readonly writable: boolean;
}

export interface ToolObject3DInteractionExtension {
  /** Return null to yield this pointer to the ordinary viewport controls. */
  begin(event: ToolObject3DPointerEvent): ToolObject3DGesture | null;
  /**
   * Optional pre-sample phase. Restore any transforms changed by the previous
   * frame's refinement here; the host advances content time after this call
   * and invokes {@link update} with the resulting native pose.
   */
  prepareFrame?(deltaSeconds: number): void;
  /**
   * Optional per-frame refinement after the host has advanced content time.
   * Use this for project-owned constraints and overlay presentation.
   */
  update?(deltaSeconds: number): void;
  dispose(): void;
}

export interface ToolObject3DDocumentInteraction {
  setup(context: ToolObject3DInteractionContext): ToolObject3DInteractionExtension;
}

/**
 * Project-owned serialization of a WHOLE Asset Lab document into one ordinary
 * source file, for a
 * document whose truth is a TypeScript module (a modeling session's mesh
 * module). The editor owns the checksum-guarded whole-file write through the
 * source seam and records it in canonical history; executable source never
 * travels through {@link ToolObject3DAuthoringProps.persistence}'s resource
 * route, which the server refuses by rule. A document declares either this or
 * `persistence`, never both. MUST be referentially stable across renders.
 */
export interface ToolDocumentSourceBinding {
  /** Project-relative source file below src/. */
  readonly path: string;
  /** Undo/redo label shown by the editor history. */
  readonly label?: string;
  /** The exact bytes of the module for this document state — or `null` for
   *  "nothing changed, write nothing", so a gesture that ended without an
   *  edit leaves the file byte-for-byte alone. */
  readonly serialize: (document: ToolObject3DDocumentState) => string | null;
}

/** Format-neutral identity for a project-owned Asset Lab document.
 *
 * This surface deliberately accepts no React children. Project tools may run
 * a different React major than the editor, so their native UI stays in their
 * own runtime while this editor-owned subject publishes the standard Asset
 * Lab context, selection floor, and Inspector identity row beside it.
 */
export interface ToolAssetDocumentProps {
  /** Stable id of the open workspace document. */
  readonly documentId: string;
  /** Subject name shown by the Inspector. */
  readonly title: string;
  /** Ecosystem-neutral asset kind shown by the Inspector. */
  readonly type: string;
  /** Optional provenance or concise state shown with the identity row. */
  readonly status?: string;
  /** Whether this is the active center document. */
  readonly active?: boolean;
}

/** Editor-owned native surfaces available to ordinary project React tools. */
export interface ToolContributionSurfaces {
  readonly AssetDocument: import('react').ComponentType<ToolAssetDocumentProps>;
  readonly Object3DPreview: import('react').ComponentType<ToolObject3DPreviewProps>;
  readonly Object3DAuthoring: import('react').ComponentType<ToolObject3DAuthoringProps>;
}

/** One bounded visual-history sample from the live Play recording. */
export interface ToolContributionRecordingFrame {
  /** Monotonic within this recording, including after older frames are evicted. */
  readonly sequence: number;
  /** Position on the recording clock, measured from `startedAt`. */
  readonly mediaTimeMs: number;
  /** Wall-clock capture time, for correlating project-owned event streams. */
  readonly capturedAt: string;
  /** Borrowed object URL. It remains valid until this frame is evicted or Play ends. */
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

/** Stable snapshot returned by the live recording transport. */
export interface ToolContributionRecordingSnapshot {
  readonly startedAt: string;
  readonly width: number;
  readonly height: number;
  /** Latest sampled position on the live recording clock. */
  readonly liveEdgeMs: number;
  readonly sampleFps: number;
  readonly retentionMs: number;
  readonly frames: readonly ToolContributionRecordingFrame[];
  /** A preview failure never stops the full WebM recording. */
  readonly previewError: string | null;
}

/**
 * Read-only visual history for the current Play recording.
 *
 * `getSnapshot` is referentially stable between notifications, so it can be
 * passed directly to React's `useSyncExternalStore`. A `null` snapshot means
 * Play is not currently recording (for example, a human-started Play session
 * that did not explicitly start recording).
 */
export interface ToolContributionRecording {
  readonly getSnapshot: () => ToolContributionRecordingSnapshot | null;
  readonly subscribe: (listener: () => void) => () => void;
}

/** One structured row from a Gameplay Session's durable JSONL record. */
export interface ToolGameplaySessionEntry {
  readonly t?: number;
  readonly level?: string;
  readonly source?: string;
  readonly sub?: string;
  readonly msg?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly tick?: number;
  readonly simT?: number;
  readonly world?: string;
  readonly simSpeed?: number;
  readonly [field: string]: unknown;
}

export interface ToolGameplaySessionRecording {
  readonly format: 'composite-webm' | 'canvas-dom';
  readonly replay: string | null;
  readonly file: string;
  readonly url: string;
  readonly startedAt: number | null;
  readonly finalized: boolean;
  readonly bytes: number | null;
}

/** One Play interval, durable after Stop and editor reload. */
export interface ToolGameplaySession {
  readonly id: string;
  readonly run: string | null;
  readonly status: 'live' | 'completed';
  readonly startedAt: number;
  readonly endedAt: number | null;
  /** Real elapsed wall time. Simulation time remains an entry field. */
  readonly durationMs: number;
  readonly logFile: string;
  readonly entries: readonly ToolGameplaySessionEntry[];
  readonly recording: ToolGameplaySessionRecording | null;
}

export interface ToolGameplaySessionsSnapshot {
  readonly sessions: readonly ToolGameplaySession[];
  readonly selectedSessionId: string | null;
  readonly selectedSession: ToolGameplaySession | null;
  /** Shared analytics cursor, measured in real milliseconds from Play start. */
  readonly cursorMs: number;
  readonly liveEdgeMs: number;
  readonly loading: boolean;
  readonly error: string | null;
}

/** Stable external store supplied to the built-in Analytics contribution. */
export interface ToolGameplaySessions {
  readonly getSnapshot: () => ToolGameplaySessionsSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly select: (sessionId: string) => void;
  readonly seek: (realTimeMs: number) => void;
  readonly refresh: () => Promise<void>;
}

/**
 * The live game a contribution is looking at, or `null` when nothing is
 * playing.
 *
 * A dev-GUI contribution's whole subject is the RUNNING game — its stats,
 * cheats, tuning handles and event stream all hang off the live `Game`, and
 * there is no other door to it from a contribution (the editor's own state is
 * not the game's). It is `unknown` deliberately: `@vgai/game-runtime`'s `Game` is
 * the project's dependency, not this package's, so a contribution narrows it
 * with its own import rather than making every consumer of this SDK carry the
 * engine's types.
 *
 * `instanceId` is the mount id the editor's runtime instruments are pointed
 * at (the Inspect selector). With several seats live that is the ONLY thing
 * distinguishing two mounts of the same project, so a contribution that
 * caches per-game state keys it on this and re-reads when it changes.
 */
export interface ToolContributionPlay {
  readonly game: unknown;
  readonly instanceId: string;
  /** The editor-owned recording transport shared by every project tool. */
  readonly recording: ToolContributionRecording;
}

/**
 * THE DOCUMENT HEADER REGION, as a project contribution sees it.
 *
 * A `workspace.document` module may `export const Toolbar` beside its default
 * component. The editor renders it in the host-owned header strip above the
 * document — the same strip the Game and Story documents use — with the SAME
 * props the content receives, so a header and its body read one state. The
 * host draws the strip identically for every document (height, divider,
 * island treatment over a backdrop document); the contribution supplies
 * only what goes in it. A document that hand-draws a bar inside its own body
 * instead is a document whose header no skin, preset or region rule can
 * reach — which is the whole reason the strip is the host's.
 */
export type ToolDocumentToolbar = import('react').ComponentType<ToolContributionProps>;

/**
 * THE DOCUMENT SHELF REGION — Blender's tool shelf — as a project sees it:
 * `export const Shelf` on a `workspace.document` module. The editor draws it
 * as a vertical rail over the leading edge of the document's content box,
 * with the same props as the body. Same contract as {@link ToolDocumentToolbar}.
 */
export type ToolDocumentShelf = import('react').ComponentType<ToolContributionProps>;

/**
 * A document the adapter's table lists — a model, a page — as handed to the
 * editor registered for its kind (ARCHITECTURE-CORE §The project model,
 * "Documents, not scenes"). A `workspace.document` contribution declares the
 * kind it edits with `export const documentKind = 'model'`; the host then
 * opens every table entry of that kind as its OWN document — titled by the
 * entry's label, one per entry, restored across reloads by the entry's id —
 * and mounts the contribution with the entry here. Nothing else is looked
 * up: the entry names the module (`source`) and the contribution does the
 * rest through `importProjectModule`.
 */
export interface ToolDocumentEntry {
  /** The table entry's id (`model:src/models/cage.ts`). */
  readonly id: string;
  readonly kind: string;
  /** The entry's display label — the document's title (`cage`). */
  readonly label: string;
  /** The module that IS the document, when the entry has one. */
  readonly source?: { readonly path: string; readonly export?: string };
}

export interface ToolContributionProps {
  /** The exact registered callable this contribution presents. */
  readonly tool: ProjectToolCatalogEntry;
  /** Present when mounted as the editor of a table document of the kind this
   *  contribution declared (`export const documentKind`). */
  readonly document?: ToolDocumentEntry;
  /** Stable id of this presentation within the registered callable. */
  readonly contributionId?: string;
  /** Direct editor SDK client; invoke with `client.runProjectTool(tool.name, ...)`. */
  readonly client: EditorClient;
  /** Generic editor-owned presentation surfaces; project source remains native. */
  readonly surfaces: ToolContributionSurfaces;
  /** Sanitized product-account projection. Never contains an access token. */
  readonly account: GenerationAccountProjection;
  /** The inspected play instance, or `null` while nothing is playing. */
  readonly play: ToolContributionPlay | null;
  /** Present when mounted as a workspace document contribution. */
  readonly documentId?: string;
  /** Whether that workspace document is the active center subject. */
  readonly active?: boolean;
  /**
   * Present with `documentId`. Hand the host the ONE object this document
   * edits through — its live session — and `editor.document.run(ctx => …)`
   * (`vgai eval`) runs a step against it in Edit mode, without play: the
   * agent's REPL over the document. Re-publish whenever that object changes
   * (a reload that swaps a session); the return value unpublishes.
   */
  readonly publishContext?: (context: unknown) => () => void;
  /**
   * Raise a card on the editor's bottom-right notification stack — the ONE
   * shape an event takes (ARCHITECTURE-CORE §Editor chrome, "Notices take
   * VS Code's shape"): a refusal, a failed write, a no-op the user should
   * hear about. Never paint these into a document's own chrome. Plain
   * `info` hides itself; warnings and errors stay until dismissed. The
   * return value dismisses the card early.
   */
  readonly notify?: (notice: ToolNotice) => () => void;
  /**
   * Tell the host what this contribution is about to do on the page's main
   * thread — `work('building src/models/x.ts')` before running a module's
   * `build()`, `work(null)` after. A command that times out meanwhile is
   * refused naming that work instead of "the page never answered".
   */
  readonly work?: (label: string | null) => void;
}

/** A card for {@link ToolContributionProps.notify}. */
export interface ToolNotice {
  readonly tone: 'info' | 'warning' | 'error';
  /** One line, bold — what happened. */
  readonly title: string;
  /** The rest, plain — what it means, what to do. */
  readonly detail?: string;
}

/**
 * A `workspace.utility`'s props — the shared shape, except that `tool` may be
 * absent.
 *
 * It is its own type rather than a relaxation of {@link ToolContributionProps}
 * because only the two PRESENTING points earn the relaxation (this one and
 * {@link ToolInspectorContributionProps}): a record-reading drawer panel (a
 * log, a run timeline) presents what HAPPENED rather than one callable's
 * output, so there is no honest name to put there and the loader stopped
 * demanding a false one. Widening the shared props instead would hand every
 * RUNNING contribution a `tool` it must now null-check while its own point
 * still guarantees one.
 */
export interface ToolUtilityContributionProps extends Omit<ToolContributionProps, 'tool'> {
  /** The callable this utility declared, when it declared one at all. */
  readonly tool?: ProjectToolCatalogEntry;
}

/**
 * A game's analytics body. The editor owns session selection, real-time
 * transport, and optional video preview; this component owns only the charts
 * and readouts that give the selected session meaning for this game.
 *
 * `play` is intentionally absent. Historical analysis consumes the durable
 * Gameplay Session record, so the type itself prevents an Analytics surface
 * from accidentally depending on a live module graph.
 */
export interface ToolAnalyticsContributionProps
  extends Omit<ToolContributionProps, 'tool' | 'play'> {
  readonly tool?: ProjectToolCatalogEntry;
  readonly gameplaySessions: ToolGameplaySessions;
}

/**
 * A `selection.inspector`'s props. `tool` is OPTIONAL here for the same reason
 * it is on a utility: a section may present state the editor already has —
 * readings, verbs a game registered as debug commands — and drive no single
 * registered callable at all. A section that DOES commit through one still
 * declares it and still gets the resolved entry.
 *
 * A module may also `export const icon = '<glyph name>'` — the NAME of the
 * glyph that stands for this section wherever the Inspector shows one (the
 * Properties tab rail, the section-icon strip). A name, never an icon
 * object: the active icon set paints it, and a set may give that name its
 * own category ink (`IconSetContribution` `tone`). Give a section that
 * means something its OWN name (`properties-data`), the way the Outliner's
 * rows do, because a tone is keyed by name and a shared name would tint
 * every section that borrowed it. Omitted, the host draws its generic tool
 * glyph.
 */
export interface ToolInspectorContributionProps extends Omit<ToolContributionProps, 'tool'> {
  /** The callable this section declared, when it declared one at all. */
  readonly tool?: ProjectToolCatalogEntry;
  readonly node: ToolContributionNode | null;
  readonly nodeId: string | null;
  /** The matched adapter — the same value `match` was handed. Adapter-native
   *  API; import its concrete type when a section reads more than the node
   *  (a model section reads the document's source path and root). */
  readonly adapter: unknown;
}

/** Stable editor projection of one selected project or external-library asset. */
export interface ToolContributionAsset {
  readonly path: string;
  readonly name: string;
  readonly kind: string;
  readonly origin: 'project' | 'library';
  readonly sourcePath?: string;
}

/** An `asset.inspector`'s props — the same relaxation as the two other
 *  PRESENTING points ({@link ToolUtilityContributionProps},
 *  {@link ToolInspectorContributionProps}): it presents what an ASSET is, not
 *  one callable's output, so `tool` may be absent. */
/**
 * A verb an `asset.inspector` contribution offers for the asset it is
 * showing — the SAME thing a built-in Inspector button is: it appears in the
 * panel's identity row, `editor.inspect().quickActions` lists it, and
 * `editor.runAction(id)` runs exactly this `run`. A section publishes its
 * verbs with {@link ToolAssetInspectorContributionProps.setActions} when it
 * knows them, which is what gives a project's own Inspector door a place in
 * the control API instead of a mouse only.
 */
export interface ToolAssetInspectorAction {
  /** Stable id, unique within the contribution (`shot.open`). */
  readonly id: string;
  /** Accessible name and tooltip. */
  readonly title: string;
  /** Visible button text. */
  readonly label?: string;
  readonly disabled?: boolean;
  readonly run: () => void | Promise<void>;
}

export interface ToolAssetInspectorContributionProps extends Omit<ToolContributionProps, 'tool'> {
  readonly tool?: ProjectToolCatalogEntry;
  readonly asset: ToolContributionAsset | null;
  /**
   * Publish the verbs this section offers for the asset it is showing — see
   * {@link ToolAssetInspectorAction}. Call it with the list when the answer
   * is known (a section that probes asynchronously calls it from the effect
   * that resolves), and with `[]` when the answer is no. The editor renders
   * them in the identity row and serves them to
   * `editor.inspect().quickActions` / `editor.runAction(id)`, so the panel
   * and the control API always show one list. Not calling it means "no
   * verbs", which is what a section that only displays should do.
   */
  readonly setActions: (actions: readonly ToolAssetInspectorAction[]) => void;
}

/** Optional named export required by `asset.inspector` contributions. */
export type ToolAssetInspectorContributionMatch = (asset: ToolContributionAsset | null) => boolean;

/**
 * Provider-owned presentation mounted inside the editor-owned generation
 * result document. The host owns job state, billing, and acceptance; this
 * component only interprets the native poll result.
 */
export interface ToolGenerationResultContributionProps extends ToolContributionProps {
  readonly job: GenerationJob;
  readonly result: unknown;
}

/**
 * Required named export for `generation.result` contributions. A single poll
 * callable may serve many native operations, so presentation selection is
 * based on the durable job and the provider's unmodified poll result rather
 * than registration order or a host-owned media taxonomy.
 */
export type ToolGenerationResultContributionMatch = (
  job: GenerationJob,
  result: unknown,
) => boolean;

/**
 * What the inspector is showing AROUND the node a `selection.inspector`
 * contribution is being matched against.
 *
 * It exists for one question a `node`/`adapter` pair cannot answer: with
 * NOTHING selected, `node` is `null` on every surface alike — an open Asset
 * Lab document's empty state and the play surface's Game subject are the same
 * two arguments. A contribution that matches `node === null` therefore matched
 * BOTH, and the empty-state subject of whatever document happened to be open
 * grew sections belonging to another surface entirely.
 *
 * `nullSubjectId` is the id of the empty-state subject actually being composed
 * (`inspection/null-subject.ts`), so a contribution scopes itself POSITIVELY —
 * `ctx.nullSubjectId === 'game'` — rather than by guessing from the adapter.
 * It is `null` whenever a node IS selected, which is the honest answer: there
 * is no empty-state subject in that composition.
 */
export interface ToolInspectorContributionMatchContext {
  readonly nullSubjectId: string | null;
}

/** Optional named export required by `selection.inspector` contributions. */
export type ToolInspectorContributionMatch = (
  node: ToolContributionNode | null,
  /** Adapter-native API. Import its concrete type when a contribution needs it. */
  adapter: unknown,
  context: ToolInspectorContributionMatchContext,
) => boolean;

// ---------------------------------------------------------------------------
// Project modules, through the host's own door
// ---------------------------------------------------------------------------

/**
 * How THIS HOST loads a project module for a contribution: the dev/packaged
 * host serves it through its own Vite (`/@fs/…`, with a URL a live re-import
 * can stamp). The host registers one loader per project (`tool-loader.ts`); a
 * contribution that needs a project module — a model's Edit Mesh door
 * importing `build()` — asks {@link importProjectModule} and never spells a
 * tier's mechanics itself.
 */
export interface ProjectModuleLoader {
  readonly import: (path: string) => Promise<Record<string, unknown>>;
  /** The module's servable URL, or `null` on a tier that serves none. */
  readonly url: (path: string) => URL | null;
  /** The module's SOURCE TEXT as it is on disk (or in storage) right now —
   *  what a contribution that writes the module back (a model's mesh
   *  editor appending a line) patches. */
  readonly source: (path: string) => Promise<string>;
}

/** ONE loader across every copy of this module — see `host.ts` for why the
 *  packaged runtime holds two SDK instances, and `layouts.tsx` for the
 *  `Symbol.for` precedent. */
const LOADER_KEY = Symbol.for('vgai.editor.project-module-loader');
const loaders = globalThis as typeof globalThis & {
  [LOADER_KEY]?: ProjectModuleLoader | null;
};

/** Host side: install (or clear) the active project's module loader. */
export function registerProjectModuleLoader(loader: ProjectModuleLoader | null): void {
  loaders[LOADER_KEY] = loader;
}

/** Contribution side: a project module (`src/models/cage.ts`), loaded the
 *  way this tier loads project modules. Refuses by name with no host. */
export function importProjectModule(path: string): Promise<Record<string, unknown>> {
  if (!loaders[LOADER_KEY]) {
    return Promise.reject(
      new Error(`importProjectModule(${path}): no host has registered a project module loader`),
    );
  }
  return loaders[LOADER_KEY].import(path);
}

/** The module's servable URL on this host, or `null` when it has none. */
export function projectModuleUrl(path: string): URL | null {
  return loaders[LOADER_KEY]?.url(path) ?? null;
}

/** Contribution side: the module's current source text. Refuses by name with no host. */
export function readProjectModuleSource(path: string): Promise<string> {
  if (!loaders[LOADER_KEY]) {
    return Promise.reject(
      new Error(`readProjectModuleSource(${path}): no host has registered a project module loader`),
    );
  }
  return loaders[LOADER_KEY].source(path);
}

// ---------------------------------------------------------------------------
// The transform a stage transforms through
// ---------------------------------------------------------------------------

/**
 * THE MODAL TRANSFORM A STAGE OWNS — the door the host's transform tools drive
 * on a stage that is not the editor viewport's own.
 *
 * WHY IT EXISTS, measured rather than argued (2026-09-19, cold `--template
 * models` scaffold): the host's `ToolStrip` draws Move / Rotate / Scale /
 * Transform over every stage that paints a three surface, and on a Model
 * document all four lit and nothing happened — `Transform` lit at boot,
 * offering a tool that could never act. Eight controls in the two places a
 * person looks first, one of them lit.
 *
 * TWO SEPARATE CAUSES, and only the second one is this door's:
 *  1 THE TOOLS WROTE THE WRONG STORE. Every stage owns an `EditorShellStore`
 *    (`stage-store-registry.ts`); the strip wrote the SHELL's, which no
 *    document stage reads. That is fixed in the host (`ToolStrip`'s own note
 *    carries the prefab-story measurement) and it is why a session-painted
 *    stage now takes the ordinary GIZMO arm.
 *  2 A MESH MODULE DOES NOT TRANSFORM THROUGH A GIZMO AT ALL. Blender's Edit
 *    Mode Move/Rotate/Scale act on the element selection and are its
 *    `G`/`R`/`S`; ours already do, through `MeshEditSession.beginTransform`
 *    from the Mesh menu and the keys, while the document's own adapter is a
 *    read-only projection of the datablock that a gizmo could not write. So
 *    the stage DECLARES how it transforms and the host's three single-channel
 *    tools run that, instead of the host guessing from the document's kind.
 *
 * THERE IS NO `combined` KIND, and that is the tool shelf's own rule applied
 * to the fourth button: Blender's all-handles Transform IS a gizmo, and a
 * modal transform has no twin for it, so the host does not draw it over a
 * door (the same reason ten of Blender's twenty-one tools are absent; the
 * 21-row table that said which lived in the deleted Edit Mesh document and is
 * in git — `packages/mesh/contributions/mesh-edit-document.tsx` before
 * 2026-09-19).
 *
 * NEITHER ARE THE HEADER'S TRANSFORM WELLS (orientation, pivot/anchor, snap,
 * options) over a door. Every one of them configures a GIZMO — measured
 * 2026-09-19: `transformSpace`'s only functional reader is the viewport's
 * `controls.setSpace`, and `pivotMode`/`gizmoAnchor`/`snapEnabled` are read
 * only by that viewport and the 2D canvas overlay. A modal door has no
 * orientation, no pivot choice and no snapping to configure (the mesh kit
 * transforms about the selection's median on global axes, always), so the host
 * draws no wells over one. Wiring a well here means giving the door a
 * parameter first.
 */
export type StageTransformKind = 'translate' | 'rotate' | 'scale';

export interface StageTransformDoor {
  /** Arm this stage's own modal transform. The stage narrates its own refusal
   *  (nothing selected, another gesture running); the host never paraphrases
   *  it. */
  readonly begin: (kind: StageTransformKind) => void;
  /** The kind armed right now, or `null`. This is what LIGHTS a tool: these
   *  are modal operators, not persistent tool modes, so between gestures
   *  nothing is lit. */
  readonly armed: () => StageTransformKind | null;
  /** `useSyncExternalStore` pair with {@link armed}. */
  readonly subscribe: (listener: () => void) => () => void;
}

interface StageTransformRegistry {
  readonly doors: Map<string, StageTransformDoor>;
  version: number;
  readonly listeners: Set<() => void>;
}

/** ONE registry across every copy of this module, for the same reason
 *  {@link registerProjectModuleLoader} needs one — see its note. */
const STAGE_TRANSFORM_KEY = Symbol.for('vgai.editor.stage-transform-doors');
const stageTransforms = globalThis as typeof globalThis & {
  [STAGE_TRANSFORM_KEY]?: StageTransformRegistry;
};

function stageTransformRegistry(): StageTransformRegistry {
  const existing = stageTransforms[STAGE_TRANSFORM_KEY];
  if (existing) return existing;
  const created: StageTransformRegistry = { doors: new Map(), version: 0, listeners: new Set() };
  stageTransforms[STAGE_TRANSFORM_KEY] = created;
  return created;
}

function notifyStageTransforms(registry: StageTransformRegistry): void {
  registry.version++;
  for (const listener of [...registry.listeners]) listener();
}

/** A mounted stage declares the transform it transforms through — the shape
 *  `stage-store-registry.ts` uses for the store a stage runs on. Re-registering
 *  the same document replaces it; the returned unregister drops it. */
export function registerStageTransform(documentId: string, door: StageTransformDoor): () => void {
  const registry = stageTransformRegistry();
  registry.doors.set(documentId, door);
  notifyStageTransforms(registry);
  return () => {
    if (registry.doors.get(documentId) !== door) return;
    registry.doors.delete(documentId);
    notifyStageTransforms(registry);
  };
}

/** The transform that document's stage owns, or `null` when it declares none
 *  (every stage whose transform is the editor viewport's own gizmo). */
export function stageTransformDoor(documentId: string | null): StageTransformDoor | null {
  return documentId === null ? null : (stageTransformRegistry().doors.get(documentId) ?? null);
}

/** `useSyncExternalStore` shape — a stage declaring or dropping its door
 *  changes what the shelf and the header draw. */
export function subscribeStageTransforms(listener: () => void): () => void {
  const registry = stageTransformRegistry();
  registry.listeners.add(listener);
  return () => {
    registry.listeners.delete(listener);
  };
}

export function stageTransformsVersion(): number {
  return stageTransformRegistry().version;
}
