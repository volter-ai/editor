/**
 * THE OBJECT3D CONTRIBUTION CONTRACT — Three's own public API for project and package
 * contributions that hand the editor a native three.js graph: the preview and authoring surfaces'
 * props, the document state serializers receive, and the gestures a document owns. A contribution
 * mounts the surfaces from its `surfaces` prop; this module adds them to
 * `ToolContributionSurfaces`, so a contribution that imports these types sees them there, and
 * the Three integration registers what renders them (`kit/three-integration.ts`).
 */

import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import type {
  DocumentPersistenceBinding,
  DocumentPersistenceResource,
} from '@volter/editor-sdk/kit/authoring/object3d-document-persistence';
import type { PresentationLayer } from '@volter/editor-sdk/kit/viewport-presentation';
import type { ComponentType } from 'react';
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
   * where Blender opens it): the pivot, the direction from the pivot to the eye, the view's up,
   * the distance and the projection, in the stage's frame. In place of `cameraDirection` and
   * `openingFit` when given; Frame still fits. The saved field of view is the document's
   * `presentation` (`camera.fov`).
   */
  readonly openingView?: {
    readonly target: readonly [number, number, number];
    readonly direction: readonly [number, number, number];
    /** The view's own up, which carries its roll. */
    readonly up?: readonly [number, number, number];
    readonly distance: number;
    readonly projection?: 'perspective' | 'orthographic';
  } | null;
  /**
   * THE DOCUMENT'S OWN PRESENTATION LAYER, over the stage's starting values and under a person's
   * choices (`kit/viewport-presentation`): what the file itself says about how it is seen — a
   * `.blend`'s saved lens as `camera.fov`. Read when the document binds.
   */
  readonly presentation?: PresentationLayer | null;
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
export type ToolObject3DDocumentResource = DocumentPersistenceResource<ToolObject3DDocumentState>;

export type ToolObject3DDocumentPersistence = DocumentPersistenceBinding<ToolObject3DDocumentState>;

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

declare module '@volter/editor-sdk/contributions' {
  interface ToolContributionSurfaces {
    readonly Object3DPreview: ComponentType<ToolObject3DPreviewProps>;
    readonly Object3DAuthoring: ComponentType<ToolObject3DAuthoringProps>;
  }
}
