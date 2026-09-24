/**
 * The two viewport tabs — the editor's two MODES, named for what the user is
 * doing rather than for what happens to be mounted (ARCHITECTURE-CORE
 * §Vocabulary, decided 2026-08-02). Deliberately not `'scene' | 'game'`:
 * `'scene'` names a document format (a three root is TSX, and
 * asset/story/tool documents live on that tab too), and `'game'`
 * names the mounted artifact rather than the mode. Not to be confused with the
 * PLAY TRANSPORT (the five stable controls) — this is which tab is showing.
 */
export type ViewportTab = 'edit' | 'play';

export type AssetKind =
  | 'model'
  | 'image'
  | 'video'
  | 'audio'
  | 'animation'
  | 'json'
  | 'prefab'
  | 'source';

/**
 * The editor's NAMED WORKSPACES — task-named layout memories over the one
 * physical dock (ARCHITECTURE-CORE §Editor chrome). Named for the TASK, each
 * borrowing the arrangement of the tool that does it best; `game` is the
 * default and is the editor's standing arrangement. Restated here (rather than
 * imported from the editor) for the same reason every other id union in this
 * file is: the SDK is a wire client and must not depend on the editor bundle.
 */
/** One entry of the resolved document table, as `EditorState['adapter']['scenes']`
 *  and `documentTable()` carry it over the wire. */
export interface DocumentTableEntryProjection {
  id: string;
  label: string;
  /** OPEN: `scene`, `prefab`, `page`, `model`, `shot`, `take`, … */
  kind: string;
  region: string | null;
  authorable: boolean;
  reach: { kind: string; [field: string]: unknown };
  source?: { path: string; export?: string };
  finder?: string;
}

export interface DocumentTableProjection {
  default: string | null;
  entries: DocumentTableEntryProjection[];
  /** True while a declared finder has no registration yet — a contribution's
   *  finder before the contribution pass — so the table is NOT final. */
  pending: boolean;
}

/** A registered workspace's id: one of the editor's own (`look`, `animate`,
 *  `design`) or one a declared package contributes (`game`, `model`,
 *  `sculpt`, `texture`, `stage`, …). Validated by the editor against its
 *  live registry, the way a utility id is — not a closed set here. */
export type EditorWorkspaceName = string;

export interface HelperVisibility {
  bounds: boolean;
  lights: boolean;
  cameras: boolean;
  colliders: boolean;
  joints: boolean;
  particles: boolean;
  lod: boolean;
  audio: boolean;
  splines: boolean;
  navmesh: boolean;
  constraints: boolean;
  reflectionProbes: boolean;
  triggerVolumes: boolean;
  skeletons: boolean;
  /**
   * The WEIGHT display — a mesh coloured by its active vertex group
   * (`@vgai/blender`'s `blender-runtime-weights.ts`). Added 2026-09-19 (I4)
   * because nothing in this set stood for it: `skeletons` is the bones, and
   * Blender's own viewport overlay has a Bones checkbox but reaches weight
   * colours through Weight Paint MODE, which an inspection surface has no
   * brushes to enter. OFF by default, the way Blender shows no weights until
   * you ask for them.
   */
  weights: boolean;
}

export interface Vec3Value {
  x: number;
  y: number;
  z: number;
}

export interface EditorCameraState {
  position: Vec3Value;
  target: Vec3Value;
  fov?: number;
}

export interface EditorEntitySummary {
  id: string;
  name: string;
  childIds: string[];
}

export interface ViewportCapture {
  base64: string;
  mimeType: 'image/png';
}

/**
 * How an animated look move on the open Object3D document ended. Never an
 * error: the camera is SHARED with the person watching, so "they grabbed it
 * mid-orbit" is an outcome to read, not a failure to handle.
 */
export interface DocumentLookOutcome {
  /** True only when the whole move was drawn. */
  completed: boolean;
  /** Why it stopped early: a human drag, a later look verb, or a closed document. */
  cancelledBy?: 'human' | 'superseded' | 'closed';
  /** Where the camera ended up, radians around the framed subject. */
  azimuth: number;
  /** Radians above the subject's horizon. */
  elevation: number;
  /** Seconds of the move that were actually drawn. */
  seconds: number;
}

/** Where the open document's camera is standing and what it is aimed at. */
export interface DocumentCameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

/**
 * Unit 4 (live-front-door wave) — the RUNNING GAME's pixels, as captured by
 * the `bridge-screenshot` relay op (`command-listener.ts`'s
 * `handleBridgeScreenshot`): the full play-mode game stack — canvas(es) PLUS
 * the DOM adapter layers (for example React roots) composited by
 * `capturePlayComposite`. Distinct from {@link ViewportCapture}, which is the
 * EDITOR viewport's own canvas (`capture-viewport`) and knows nothing about
 * play mode or the HUD.
 *
 * `composite` reports honestly whether the DOM-layer composite leg actually
 * ran, or whether the capture degraded to a canvas-only `toDataURL` frame (no
 * container, no DOM `Image`/`XMLSerializer`, or a rasterization failure) —
 * never a silently HUD-less image passed off as the whole game. `layers` is
 * only present on the composite leg.
 *
 * `flatness` and `loopRecoveryFrame` are the same honesty contract applied to
 * the PIXELS: how much of the frame is one flat surface (a near-blank capture
 * carries its own "weak evidence" warning), and whether the frame exists only
 * because capture recovered a starved host loop with one deterministic tick.
 */
export interface GameCapture {
  base64: string;
  mimeType: 'image/png';
  composite: boolean;
  layers?: { canvases: number; domOverlays: number };
  /** Degeneracy measure — `packages/editor/src/composite-screenshot.ts`'s
   *  `measureFlatness`. Absent when pixel readback was unavailable. */
  flatness?: {
    dominantFraction: number;
    dominantColor: string;
    distinctRegions: number;
    degenerate: boolean;
    /** Present iff `degenerate`; the sentence to show the caller verbatim. */
    warning?: string;
  };
  /** True when the host loop was starved and the runtime rendered one
   *  deterministic tick to produce this frame. */
  loopRecoveryFrame?: boolean;
  /** Present when this frame came out of a RECORDED run (every `vgai play`
   *  records). The still is delivered either way; `notice` is the sentence
   *  naming the clip, its offset-0 wall clock, and what a still cannot answer —
   *  shown verbatim, never re-derived by the caller. */
  recording?: {
    path: string;
    startedAt: string;
    notice: string;
  };
}

/** Options for recording the clean running-game composite. */
export interface GameplayRecordingOptions {
  /** Requested real-time capture cadence. Defaults to 30; range 1–60. */
  fps?: number;
  /** `composite-webm` is the compatible one-file artifact. `canvas-dom`
   * records the world canvas directly and writes the HUD to a synchronized
   * replay sidecar, avoiding live DOM rasterization. */
  format?: 'composite-webm' | 'canvas-dom';
  /** Names the file under `.vgai/recordings/`. During Play, absence names the
   *  clip after its durable Gameplay Session. */
  name?: string | null;
}

/** Facts fixed when a gameplay recording starts. */
export interface GameplayRecordingStarted {
  format: 'composite-webm' | 'canvas-dom';
  startedAt: string;
  mimeType: string;
  width: number;
  height: number;
  fps: number;
  audio: boolean;
  layers: { canvases: number; domOverlays: number };
  /** Where the bytes are landing — known at START, so a caller can say where
   *  the evidence for a run still in progress will be. */
  path: string;
  /** Replay sidecar directory for `canvas-dom`; null for a composite. */
  replayPath: string | null;
  /** True only for the out-of-session rotating fallback. */
  rotates: boolean;
  /** This run's `logs/play-*.jsonl`, whose event timestamps map to clip offsets. */
  logFile: string | null;
}

/** Final browser recording. Media chunks stream directly to the project while
 * recording, so the command result stays small even for a long playthrough. */
export interface GameplayRecordingCapture extends GameplayRecordingStarted {
  durationMs: number;
  droppedFrames: number;
  frameErrors: number;
  /** The cadence ACHIEVED (frames over wall duration), which diverges from the
   *  requested `fps` on a throttled hidden tab. Read this before reasoning
   *  about a clip's timing. */
  effectiveFps: number;
  /** True when the tab was hidden for any part of the recording. */
  hidden: boolean;
}

/** A position on the active recorder's authoritative monotonic timeline.
 * `startedAt` identifies the recording; `elapsedMs` shares the exact origin
 * used to calculate the finalized capture's `durationMs`. */
export interface GameplayRecordingTimeline {
  startedAt: string;
  elapsedMs: number;
}

/** A PNG reconstructed on demand from canvas video plus its DOM timeline. */
export interface GameplayReplayCapture {
  replayPath: string;
  positionMs: number;
  width: number;
  height: number;
  base64: string;
  mimeType: 'image/png';
  layers: { canvases: number; domOverlays: number };
  flatness?: GameCapture['flatness'];
}

/** What Play can report while its recording is still open. Geometry, layers, media cadence, and
 * final health are deliberately absent: those facts are only authoritative after Stop finalizes
 * the capture. */
export interface PlayRecordingStatus {
  path: string;
  format: 'composite-webm' | 'canvas-dom';
  replayPath: string | null;
  startedAt: string;
  rotates: boolean;
  logFile: string | null;
  idleAutoStopMs: number;
}

/** What `play` reports back once the run is up and recording. */
export interface PlayStarted {
  /** Absent only when the recorder could not start; play is up either way and
   *  the editor console carries the reason. */
  recording?: PlayRecordingStatus;
}

export type AssetPreviewView = 'front' | 'right' | 'top' | 'perspective';
export type AssetPreviewBackground = 'neutral' | 'transparent';

/**
 * What the Asset Lab is being asked to photograph: a same-origin project
 * model path, a live scene entity, or RAW GLB BYTES that travel with the
 * command.
 *
 * The bytes form exists because rasterization only happens where there is a
 * GPU. A Node host that built a model in memory — the module-look lane's
 * `project.bake.preview`, which compiles a project TS module's `Object3D` and
 * exports it to an in-memory GLB without writing anything — has pixels
 * nowhere until the live editor session renders them. It is four-view,
 * lab-stage only: bytes stand nowhere, so `stage: 'scene'`, the shot-set /
 * source-review modes and compare are all refused by name at the relay.
 */
export type AssetPreviewSource =
  | { assetPath: string; entityId?: never; glbBase64?: never }
  | { entityId: string; assetPath?: never; glbBase64?: never }
  | { glbBase64: string; assetPath?: never; entityId?: never };

/**
 * Where an ENTITY capture is staged.
 *
 * `'lab'` (the default on every surface) is the editor's neutral Asset Lab
 * stage: an isolated, yaw-normalized snapshot under fixed studio lighting,
 * identical whatever the entity's surroundings are. `'scene'` photographs the
 * entity where it stands in the live scene, under the scene's own lighting,
 * with the editor's own grid/gizmos/helpers excluded — see
 * `packages/editor/src/asset-preview.ts`'s `captureSceneStageAssetPreview`.
 *
 * `'scene'` is an ENTITY-only, four-view option: the relay refuses it by name
 * for an `assetPath` source (a model loaded from disk stands nowhere) and for
 * the shot-set / source-review / compare modes (each stages its own subject).
 */
export type AssetPreviewStage = 'lab' | 'scene';

/**
 * A free capture camera for the Asset Lab legs (`vgai screenshot`'s
 * `--azimuth/--elevation/--distance`): ONE view from a chosen angle instead
 * of the fixed four. Angles are relative to the subject's AUTHORED front —
 * azimuth 0 photographs the declared front, 90 walks toward the side the
 * turntable's yaw-90 shot shows; elevation raises the camera (degrees above
 * level); `distance` is meters from the framing center, auto-fit when
 * omitted.
 */
export interface AssetPreviewCameraChoice {
  azimuthDegrees: number;
  elevationDegrees: number;
  distance?: number;
}

/**
 * Pose an animated subject before capturing (`vgai screenshot`'s
 * `--clip <name> --time <t>`): the named clip is sampled at `timeSeconds`
 * on the capture's disposable snapshot — the source is never mutated. The
 * capture fails loudly (naming the clips that DO exist) when the subject
 * carries no clip by this name.
 */
export interface AssetPreviewPose {
  clip: string;
  timeSeconds: number;
}

export interface AssetPreviewOptions {
  width?: number;
  height?: number;
  background?: AssetPreviewBackground;
  stage?: AssetPreviewStage;
  camera?: AssetPreviewCameraChoice;
  pose?: AssetPreviewPose;
}

/**
 * How the captured subject was oriented relative to its AUTHORED coordinates.
 * The editor yaw-normalizes a subject so the front camera photographs its
 * declared front; a 180-degree yaw maps authored +X to screen-LEFT in the
 * front view. The yaw is reported here (and stamped onto the images' own
 * pixels as `+X>` / `<+X` markers) so it is never applied silently.
 */
export interface AssetPreviewOrientation {
  /** The subject's declared forward, `[0,0,1]` when it declares none. */
  forward: [number, number, number];
  /** Yaw applied to face the front camera; 0 means authored axes = world axes. */
  yawDegrees: number;
}

export interface AssetPreviewCapture {
  width: number;
  height: number;
  /** Absent from editors that predate orientation reporting. */
  orientation?: AssetPreviewOrientation;
  views: Array<ViewportCapture & { view: AssetPreviewView }>;
  contactSheet: ViewportCapture & { width: number; height: number };
}

/**
 * The STORY lane (`vgai screenshot <file>.stories.tsx`): a project CSF file's
 * exports rendered in the live session's DOM and captured through the same
 * composite leg the game lane uses, as ONE variant sheet per file. `story`
 * narrows to a single export. See
 * `packages/editor/src/stories/story-capture.ts`.
 */
export interface StoryCaptureOptions {
  /** Narrow the sheet to one CSF export name (`--story <export>`). */
  story?: string;
  /** Per-variant cell size in CSS pixels; defaults to a 960x540 rectangle,
   *  because a UI story is not the Asset Lab's square 3D view. */
  width?: number;
  height?: number;
  /** Free capture camera for THREE stories (same contract as the Asset Lab's
   *  {@link AssetPreviewCameraChoice}). A selected story that renders on the
   *  DOM leg refuses these BY NAME rather than silently ignoring them. */
  camera?: AssetPreviewCameraChoice;
  /** Clip pose for THREE stories (same contract as the Asset Lab's
   *  {@link AssetPreviewPose}); DOM-leg stories refuse it by name. */
  pose?: AssetPreviewPose;
}

export interface StoryVariantImage extends ViewportCapture {
  /** The CSF export name — the file name each variant PNG is written under. */
  name: string;
  /** Storybook's human-facing story name. */
  label: string;
}

export interface StoryVariantCapture {
  /** Project-relative path of the CSF module that was photographed. */
  modulePath: string;
  width: number;
  height: number;
  variants: StoryVariantImage[];
  contactSheet: ViewportCapture & { width: number; height: number };
}

/**
 * B8.4 — the Asset Lab compare mode (`vgai screenshot <model.glb>
 * --compare <ref.glb>`): the asset and a caller-supplied reference GLB rendered with
 * matched orthographic front + side framing (equal-height bounding-box
 * normalization, both yaw-normalized to face the camera), scored by
 * silhouette IoU with per-view overlay evidence (orange asset / cyan
 * reference / near-white agreement). See
 * `packages/editor/src/asset-compare.ts`.
 */
export type AssetCompareView = 'front' | 'side';

export interface AssetCompareOptions {
  width?: number;
  height?: number;
  /** Override the reference GLB's ground-plane forward vector; defaults to
   *  its `userData.forward` extras when present, else glTF's +Z. */
  refForward?: [number, number, number];
}

export interface AssetCompareCapture {
  width: number;
  height: number;
  views: Array<{
    view: AssetCompareView;
    /** Silhouette intersection-over-union in [0, 1]. */
    iou: number;
    overlay: ViewportCapture;
    asset: ViewportCapture;
    ref: ViewportCapture;
  }>;
}

/**
 * THE shot-set contract. This block is the ONE declaration of it.
 *
 * A project-defined labeled shot set (`vgai screenshot <target> --shots <set>`).
 * The DEFINITION is project data: a registered project tool named
 * `project.<set>.previewShots` returns it (installed capabilities register
 * theirs — the bird, humanoid and walking-castle capabilities each contribute
 * their canonical verify set), and the editor's generic capture engine renders
 * it — turntable yaw angles and skeleton-anchored zoom crops, optionally under
 * a named pose applied to a disposable snapshot. Every shot is labeled so a
 * flat directory of PNGs is self-describing without a manifest file.
 *
 * The contract lives HERE, in the SDK, because it crosses the editor relay:
 * the capability tool that authors a set, the CLI that ships it across, and
 * `packages/editor/src/asset-preview.ts`'s capture engine that renders it are
 * three different programs. Each of those used to declare its own copy — five
 * declarations in total — and the copies had already drifted on what a pose
 * step's `radians` is measured FROM. Every side now type-checks against this
 * one: the capture engine annotates its parser's return with
 * `AssetPreviewShotSetDefinition`, and each capability tool annotates its
 * exported set with it, so a Zod schema that stops matching this shape is a
 * compile error rather than a runtime surprise at the relay.
 */
export interface ShotSetPoseRotation {
  bone: string;
  axis: 'x' | 'y' | 'z';
  /**
   * A DELTA about the bone's own local axis, in radians, relative to the
   * loaded GLB's baked rest pose — NOT an absolute local rotation.
   *
   * That is what the capture engine does with it: `bone.rotateX/Y/Z(radians)`,
   * which composes onto the bone's existing local quaternion. The consequence
   * to watch for is that "rest pose" means whatever the GLB baked, not
   * identity — a rig baked mid-gait needs `pose(t) - pose(0)` here, while a
   * rig baked at identity can pass its absolute angle unchanged. Getting that
   * backwards silently double-applies the baked pose.
   */
  radians: number;
}

/** The other half of a pose: a named morph target driven to an influence.
 *  Morphs are how a rig expresses what a joint cannot — an eyelid sliding over
 *  an eyeball, a brow band tilting — so a set that poses a FACE needs both
 *  halves or it can only ever show the jaw. A rig whose meshes carry no such
 *  morph is posed by the rotations alone: the same degrade-don't-throw rule
 *  the rotations follow for a missing joint. */
export interface ShotSetPoseMorph {
  morph: string;
  influence: number;
}

/** The TRANSLATION channel of a pose: a joint displaced along its own local
 *  axis. Rotations alone cannot state a gait's vertical truth — a crouch, a
 *  jump apex, the hip dip that makes a walk read as weighted — because those
 *  are the root/hips MOVING, not a joint bending (round-4 finding: shot sets
 *  could not photograph a gait). Same delta semantics as the rotation: the
 *  capture engine applies `bone.translateX/Y/Z(meters)`, composing onto
 *  whatever local position the GLB baked. */
export interface ShotSetPoseTranslation {
  bone: string;
  axis: 'x' | 'y' | 'z';
  /** A DELTA along the bone's own local axis, in meters, relative to the
   *  loaded GLB's baked rest position. */
  meters: number;
}

/** One step of a named pose. A flat union rather than parallel lists: a
 *  single expression is normally one rotation AND one morph (a jaw ROTATION
 *  plus a brow MORPH), so keeping them in one ordered list means a definition
 *  never has to zip them. Discriminated by field name: `radians` is a
 *  rotation, `meters` a translation, `influence` a morph. */
export type ShotSetPoseStep = ShotSetPoseRotation | ShotSetPoseMorph | ShotSetPoseTranslation;

export type ShotSetShot =
  | { label: string; view: 'turntable'; yaw: number; pose?: string | undefined }
  | {
      label: string;
      view: 'bone-zoom';
      bones: string[];
      spanFraction: number;
      /**
       * The angle the crop is taken FROM, in the same convention and units as
       * a turntable shot's `yaw` (radians; 0 is the front camera, -PI/2 the
       * subject's left, +PI/2 its right). Omitted means 0 — the front-camera
       * framing every bone-zoom shot had before this field existed, so an
       * existing shot set renders unchanged.
       *
       * It exists because the front camera is not a general answer for a long
       * subject: on an 8 m quadruped a crop anchored on the tail root
       * photographs the hind legs standing between the camera and the tail. A
       * junction whose axis runs down the body's length is inspectable only
       * from the side.
       */
      yaw?: number | undefined;
      pose?: string | undefined;
    };

export interface AssetPreviewShotSetDefinition {
  /** The set's name (the CLI's `--shots <name>`), echoed in error messages. */
  name: string;
  /** Joints that must exist on the loaded GLB's OWN skeleton — zoom anchors
   *  plus a loud failure naming the missing joints (never a silent
   *  bounding-box fallback for a set that promised skeleton anchoring). */
  requiredBones?: string[];
  /** Optional clause appended to rig-requirement errors,
   *  e.g. "a Mixamo-named humanoid skeleton". */
  rigRequirementHint?: string;
  /** Named poses (bone rotations and morph influences applied to a disposable
   *  snapshot only); shots opt in via their `pose` field. */
  poses?: Record<string, ShotSetPoseStep[]>;
  shots: ShotSetShot[];
}

/**
 * A shot the capture engine rendered but does not vouch for.
 *
 * `'empty-frame'` — the shot's frame contained no renderable geometry, so
 * the PNG is background only. It is reported rather than thrown because one
 * mis-aimed crop must not kill a 20-shot render; it is reported LOUDLY
 * because a background tile on a contact sheet otherwise reads as coverage.
 */
export interface AssetPreviewShotWarning {
  label: string;
  reason: 'empty-frame';
  /** Already names the shot, its anchor joints and its pose — surfaces print
   *  this string rather than re-composing one. */
  message: string;
  bones?: string[];
  pose?: string;
}

export interface LabeledShotSetCapture {
  width: number;
  height: number;
  shots: Array<ViewportCapture & { label: string }>;
  /** Empty when every shot framed geometry. Absent against an editor that
   *  predates the empty-frame guard. */
  warnings: AssetPreviewShotWarning[];
  contactSheet: ViewportCapture & { width: number; height: number };
}

export interface EditorState {
  /** Last announced work, held by the server; not a stack trace or causal claim. */
  pageWork?: { label: string | null; reportedAgoMs: number } | null;
  /**
   * The Code-OSS workbench this session is running, or `null` when it is
   * running none. The session's children are the session's to report, exactly
   * as its run configurations are — so this is SERVER-computed on every read,
   * never part of the browser-POSTed snapshot.
   *
   * `kind` is how the bytes were obtained: a `release` is an extracted
   * `vscode-reh-web-*` package (its `BUILD.json` carries the commit), `sources`
   * is a fork checkout (`git rev-parse HEAD` is the commit). `dir` is what the
   * project's `.vgai/workbench.json` — or `vgai edit --workbench` — named.
   * `product` is the product whose workbench half is overlaid on those bytes
   * (P3): a workbench is built for ONE product, and the session refuses one
   * built for another than this project's before it spawns.
   * Absent against an older server that predates the field.
   */
  workbench?: {
    kind: 'release' | 'sources';
    dir: string;
    commit: string;
    product: string;
  } | null;
  /**
   * The PRODUCT this session is serving — `@vgai/game-editor` or
   * `@vgai/model-editor` — or `null` when it is serving none. SERVER-computed
   * on every read, beside {@link workbench}, for the same reason: what a
   * session is running is its own fact, not something the page reports about
   * itself.
   *
   * `id` is the package name, `dir` where it resolved from, `version` what it
   * is. Which product runs is never a switch (ARCHITECTURE-CORE §The target
   * shape, rule 4) — it is what the project's dependencies resolved to — so
   * this is a REPORT and never a thing to branch on. Absent against an older
   * server that predates the field.
   */
  product?: { id: string; dir: string; version: string } | null;
  playState: 'stopped' | 'playing' | 'paused';
  /**
   * Issue #175 — the REAL engine `GameLoop.liveness` behind the current play
   * session, distinct from `playState` above (editor UI state — a store
   * flag that never reflected whether the loop was actually ticking).
   * `'loop-starved'` means the host loop has observed no recent rAF progress:
   * either the current `document.hidden` gate deliberately parked it, or an
   * armed visible-page callback has not arrived within the starvation
   * interval. It is explicitly NOT a conclusion that the tab is hidden.
   * `null` while not in play mode (no loop to report on) or against an older
   * server that predates this field.
   */
  loopLiveness?: 'running' | 'loop-starved' | 'stopped' | null;
  /**
   * The connected editor tab's OWN reported visibility/focus
   * (`command-listener.ts`'s `collectPresence`, straight off
   * `document.visibilityState`/`document.hasFocus()`). This is the only field
   * that distinguishes a usable session from a merely attached one:
   * `connected` answers "is an SSE client holding the session open", which a
   * BACKGROUNDED tab satisfies perfectly while the engine hidden-pauses its
   * loop underneath. `null` when the page has no `document` at all; absent
   * against an older server that predates the field.
   *
   * P21 — `reportedAt` is `Date.now()` in the TAB at the moment those two
   * values were read. It is what makes this snapshot readable as a
   * measurement rather than a fact: the tab re-POSTs state on
   * visibilitychange/focus/blur, after commands and on store changes, so
   * between those moments this ages, and a reader with no age has no way to
   * tell a 40ms-old reading from a 40s-old one. Absent against an editor
   * page that predates the field — never fabricated from the read time.
   */
  presence?: {
    visibility: 'visible' | 'hidden' | 'prerender';
    focused: boolean;
    reportedAt?: number;
  } | null;
  /**
   * The pending-restart reason when source changed while the game was
   * RUNNING and the running session is now stale (e.g. an R3F entry-file
   * write-back during play, a registry.ts edit). The editor's Restart button
   * surfaces the same reason; one restart (`vgai play`, or the button)
   * remounts every root from fresh source and clears it. `null` when the
   * running session is fresh; absent against an older server that predates
   * the field.
   */
  restartRequired?: string | null;
  selectedEntityId: string | null;
  selectedEntityIds: string[];
  activeViewportTab: ViewportTab;
  /** The actual active center document, including tool/source documents. */
  activeDocumentId?: string | null;
  /** The visible bottom utility, or null when that drawer is collapsed. */
  activeUtilityId?: string | null;
  /** The shared Analytics rail's current durable-session selection. */
  gameplaySession?: {
    selectedSessionId: string | null;
    latestSessionId: string | null;
    selectedStatus: 'live' | 'completed' | null;
    cursorMs: number;
    liveEdgeMs: number;
  };
  /** Every center document the editor currently has open, by stable registry id. */
  openDocumentIds?: string[];
  /** Every document a package has made available to open, and which one the
   *  session opens by default when nothing is restored. */
  availableDocuments?: { id: string; category: string; default: boolean }[];
  /** Live editor-owned WebGL renderers, split by resource owner. */
  rendererResources?: {
    hostLive: number;
    interactive: { active: number; idle: number };
    inspectorPreview: { active: number; idle: number };
  };
  activeTabKey: string;
  showGrid: boolean;
  showHelpers: boolean;
  showStats: boolean;
  shadingMode: ShadingMode;
  helperVisibility: HelperVisibility;
  transformMode: 'translate' | 'rotate' | 'scale';
  transformSpace: 'world' | 'local';
  snapEnabled: boolean;
  entityCount: number;
  savePath: string | null;
  /** Live editor persistence state. Wait for `saved` before an external scene-file write. */
  saveState: 'saved' | 'unsaved' | 'failed';
  /** Current editor camera pose when the viewport has bound a camera. */
  camera?: EditorCameraState;
  /** Flattened live authoring hierarchy, useful for agent entity discovery. */
  entities?: EditorEntitySummary[];
  /**
   * How many browser tabs are PRESENT for this session right now, read from
   * the server's tab table (`server/tab-presence.ts`) rather than from a
   * socket count — so a tab mid-reload still counts (it is beating), and a
   * socket with no tab behind it does not.
   *
   * The rest of this object is the last snapshot a browser POSTed and
   * persists even after every tab goes — so a `0` here means the other fields
   * are stale cache and commands (`play`, `scene`, …) will refuse with the
   * table's own reason. Added by the server on every `/__editor/state` read.
   */
  editorsConnected?: number;
  /** Convenience: `editorsConnected > 0`. */
  connected?: boolean;
  /**
   * ONE ROW PER PRESENT TAB — the whole table, because the owner's rule for
   * this seam is "if they DO get disconnected, make it clear that it
   * happened" and a single boolean can never say that.
   *
   * `lastBeatAgo` is the heartbeat age (null for a tab that cannot beat, e.g.
   * one bridged through the share tunnel); a number climbing past a second or
   * two is a gap in progress. `epochCount` counts page-loads, so a number
   * that keeps rising is a reload loop. `channel: 'down'` with a fresh beat
   * is a tab mid-reload — present, and briefly unable to take a command.
   * `unresponsive` is the zombie: beating, but its page has never opened a
   * command channel this page-load. Absent against an older server.
   *
   * `commandListener` is the standing verdict on the DOCUMENT, and it is a
   * different question from all of the above: the control channel is opened by
   * the tiny pre-React entry before any module loads, so a page that dies
   * during boot beats, holds a channel, gets blessed, and executes nothing. It
   * reads `'not attached'` for that page, `'silent since <t>'` for one whose
   * listener stopped acknowledging relayed commands, and `'ready'` otherwise —
   * each from a timestamp the server already stamps (the listener's own
   * attach/detach report, and the command receipts). Absent against an older
   * server, and absent for a tab the server cannot measure.
   *
   * `pageErrors` is the OTHER half of that verdict — WHY. Uncaught errors and
   * unhandled rejections captured by the page shell's inline bootstrap, which
   * runs before the module graph, so the boot failure that leaves no listener
   * is exactly the one they explain. They come back on a plain GET and need no
   * cooperation from the page beyond the handler itself. `[]` means the page
   * reported none; absent means the server cannot measure this tab.
   *
   * `census` is the tab's RESOURCE PROFILE, sampled by the page every five
   * seconds and carried on the heartbeat: what a browser-level renderer death
   * would otherwise leave unexplained. It is `@volter/editor-sdk/tab-census`'s
   * {@link RecordedTabCensus} — the census MINUS the `mountEpochs` guarantee,
   * because this is a response and the server that answered it may be older
   * than that field; every other absence (`heapUsedMB` off Chromium, renderer
   * counts with no mounted adapter) is documented on the type itself.
   * `censusAgeMs` says how stale the profile is — a hidden tab is not sampled.
   * The census's `blender` block is the OTHER question it carries: how long the
   * tab's Blender worker has been holding a call and how long this thread has
   * stalled, absent in a tab with no Blender session.
   */
  tabs?: Array<{
    /**
     * WHAT IS TRUE OF THIS TAB, in one word — `ended`, `closed`, `reloading`,
     * `crashed`, `suspended`, `hung`, `busy` or `present` — derived
     * server-side by ONE function over the fields below
     * (`server/tab-presence.ts`'s `tabState`), never re-derived by a reader.
     *
     * It exists because every other field on this row answers a NARROWER
     * question than the one that gets asked. Measured 2026-09-17: one symptom
     * ("the battery stopped") had four causes in one night — a renderer killed
     * by a dev-server reload, a worker that never finished booting, a main
     * thread wedged inside a 46 MB encode, and a twin call genuinely running
     * for sixteen minutes — and each of them is a different instruction to
     * whoever is reading. `stateMs` is THE number that goes with the word, and
     * it is a different measurement per state (time since the goodbye, beat
     * age, the gap that was resumed, census age, the outstanding call's age);
     * `stateBecause` is the evidence in a sentence, so a reader never has to
     * know which field the verdict came from. Absent against an older server.
     */
    state?:
      | 'ended'
      | 'closed'
      | 'reloading'
      | 'crashed'
      | 'suspended'
      | 'hung'
      | 'busy'
      | 'present';
    stateMs?: number | null;
    stateBecause?: string;
    tabId8: string;
    presentFor: number;
    lastBeatAgo: number | null;
    epochCount: number;
    /** Age of the DOCUMENT running in this tab (this page-load), as opposed
     *  to `presentFor`, which is the age of the tab and survives its
     *  reloads. Absent against an older server. */
    epochAgeMs?: number;
    visibility: 'visible' | 'hidden';
    route: 'project' | 'no-project' | 'unknown';
    /**
     * WHAT KIND OF PAGE this tab is: the editor's own page, or a Code-OSS
     * workbench window running it through the frame (docs/CODE-OSS.md §Boot,
     * DESKTOP). A reader prints it because "a VS Code window that beats" and
     * "a browser tab that beats" are the same health and different places to
     * look when they are not. Absent against an older server.
     */
    surface?: 'editor' | 'vscode';
    blessed: boolean;
    channel: 'open' | 'down';
    unresponsive: boolean;
    commandListener?: 'ready' | 'not attached' | (string & {});
    pageErrors?: string[];
    /**
     * The control-plane generation handshake for each page load currently
     * associated with this physical tab. Anything other than `aligned` is a
     * lifecycle contradiction or a handshake still in progress.
     */
    controlLifecycles?: Array<{
      status: 'aligned' | 'awaiting-heartbeat' | 'unconfirmed' | 'mismatch';
      serverGeneration8: string;
      connectionGeneration8: string;
      pageGeneration8: string;
      clientId8: string;
    }>;
    census?: RecordedTabCensus | null;
    censusAgeMs?: number | null;
  }>;
  /**
   * TABS THAT ARE GONE — the tab table's short departure memory, same row
   * shape as {@link tabs} above.
   *
   * `ended`, `closed` and `crashed` are verdicts about a tab that is no longer present,
   * so this is the only array they can appear in, and they are exactly the two
   * answers the product could not give before: a tab whose beats stopped left
   * the table and took its explanation with it. Kept separate from `tabs`
   * because `editorsConnected` counts that one — a dead row inside it would
   * make a crashed tab read as a connected one. Bounded by age and count
   * (a memory, not a log; the session journal is the archive). Absent against
   * an older server.
   */
  departedTabs?: EditorState['tabs'];
  /**
   * The auto-open runaway guard. `stopped` means this session opened
   * `attempts` tabs, none of them ever appeared in the table, and it has
   * stopped trying — the browser, not the editor, is what to check.
   */
  tabAutoOpen?: { attempts: number; stopped: boolean };
  /**
   * Epoch ms of the last genuine HTML page load this server served — i.e.
   * when the editor tab last did a FULL document load (first open, reload,
   * self-heal). Server-observed (`editor-server.ts`'s response-finish
   * middleware), never browser-reported. `null` until the first page load.
   *
   * P20 reads this against {@link publicAssets} to answer "did bytes under
   * `public/` change since the running document loaded", which is when
   * module-scope loaders and the page-lifetime asset caches (Pixi `Assets`,
   * three's loader caches) can still be serving the OLD bytes.
   */
  lastIndexRequestAt?: number | null;
  /**
   * P20 — what the server has OBSERVED land under this project's `public/`
   * during this server lifetime, from the same chokidar watcher that
   * broadcasts `assets-changed`. `lastChangedAt` is `null` when nothing has
   * changed since the server started. Absent against an older server.
   *
   * This is a divergence signal, not a cache verdict: nothing here knows
   * whether the running page actually holds a stale copy of those bytes,
   * only that they changed after it loaded.
   */
  publicAssets?: {
    lastChangedAt: number | null;
    lastPath: string | null;
    changedCount: number;
  };
  /**
   * Epoch ms when the server last received a state POST from a browser tab —
   * i.e. the age of the cached snapshot above. Omitted if no tab has ever
   * posted state this server lifetime (or since the last project switch,
   * which clears the cache). Present regardless of `connected`, but only
   * meaningful for interpreting staleness when `connected` is `false`.
   */
  stateUpdatedAt?: number;
  /**
   * Validate-on-change (#103): per-file validation status for every
   * Project `src/**` source / `vgai.project.json` the dev
   * server has seen
   * change since it booted (or since the last project switch). Server-
   * computed — unlike the rest of `EditorState`, it is NOT part of the
   * browser-POSTed snapshot, so it is always current. A file appears here
   * ONLY while it is currently failing; a clean write removes its entry
   * (absence means "not known to be invalid", not "never checked"). Always
   * present (`{}` when nothing is failing) so `vgai status` consumers can
   * read it unconditionally.
   */
  projectValidation?: Record<string, { errors: string[]; at: number }>;
  /**
   * PD-13: the WARNING half of the same server-computed validation pass —
   * authoring-convention findings (the R3F00x codes, OID surface conflicts)
   * that do not make a file invalid but do make it unauthorable. Same shape,
   * same lifecycle and same freshness guarantee as `projectValidation` above:
   * whole-project (not just the open document), keyed by project-relative
   * path, present only while the file currently warns, `{}` when clean.
   *
   * The server has sent this since the R3F authoring diagnostics landed; it
   * was missing from this interface, so every typed consumer — `vgai status`
   * included — could only reach it through a cast. Declared here so a caller
   * that wants to react to authoring warnings can see they exist.
   */
  projectWarnings?: Record<string, { warnings: string[]; at: number }>;
  /**
   * PD-14: whether the SOURCE half of the validation pass above is running at
   * all. `'active'` is the normal state; `'awaiting-src'` means the project
   * has no `src/` directory yet, so nothing under `src/` is being validated —
   * an empty `projectValidation`/`projectWarnings` says nothing about source
   * files while this reads `'awaiting-src'`. It is not terminal: the watcher
   * is armed on the not-yet-existing path and flips to `'active'` (running
   * the boot-equivalent scan) the moment `src/` appears, with no restart.
   * `'no-project'` when no project is open. Server-computed, like its
   * neighbors above.
   */
  sourceValidation?: 'active' | 'awaiting-src' | 'no-project';
  /**
   * The compatibility verdict between this editor and the project it serves —
   * `null` when they agree, otherwise the refusal the browser renders when it
   * declines to activate the project, with its recovery guidance.
   *
   * Server-computed per read like its neighbors above. It is here because the
   * gate was previously reported ONLY in the browser: an editor started on an
   * incompatible project serves happily (it activates nothing), so the tab
   * showed "This project is pinned to @volter/editor-project X, but this editor is
   * running Y" while `vgai status` reported a connected session with empty
   * validation and `vgai play` timed out into a retry message about the tab
   * reloading. An agent drives this editor through the CLI, so a gate visible
   * only in pixels is invisible by construction.
   */
  projectCompatibility?: {
    error: string;
    recovery?: { kind: string; title: string; guidance: string; command?: string };
  } | null;
  /**
   * #124: the absolute path of the project this editor server currently has
   * open — server-computed (never part of the browser-POSTed snapshot,
   * exactly like `projectValidation` above), so it is always current. Added
   * so a watcher/relay holding only a port number (e.g. an agent that
   * printed a `vgai edit` URL earlier and lost track of which project it
   * belongs to) can identify which project that port serves without also
   * reading the `~/.vgai/editor-sessions.json` registry file. `null` when no
   * project is open (the in-repo "no project selected" default server
   * state — mirrors `/__editor/project`'s own `{ project: null }` shape).
   */
  projectRoot?: string | null;
  /**
   * #124: the open project's declared name, alongside `projectRoot` above
   * (`vgai.project.json`'s `name`). `null` when no project is open, or the open
   * project has no readable manifest name.
   */
  projectName?: string | null;
  /**
   * The open project's ADAPTER, resolved (ARCHITECTURE-CORE §The editor
   * protocol). `source` names WHOSE declaration is running: `'project'` = the
   * project's own `vgai.adapter.ts` supplied the binding table (and it always
   * outranks the registry); `'registry'` = the HOST's in-tree ingest registry
   * supplied it, matched on this project's ingest root id, with `modulePath`
   * naming the repo file — a binding the project did not ship, stated rather
   * than inferred; `'native'` = it declared none and got `nativeAdapter()` —
   * the declared native default, not a silent fallback.
   *
   * `null`/absent means NOBODY HAS LOOKED YET (no project open, or the load
   * has not finished), which is deliberately distinct from a loaded adapter
   * whose `scenes.entries` is empty — that is a real, gradable answer. A
   * non-null `error` means the project's own module did NOT load and the
   * table below is the native default standing in, with the failure named.
   *
   * Structurally declared here rather than imported from
   * `@volter/editor-project/adapter/adapter-module` because this interface is the WIRE
   * contract: everything in it has already been through JSON.
   */
  adapter?: {
    source: 'project' | 'registry' | 'native';
    modulePath: string | null;
    regions: {
      id: string;
      surface: string;
      projector: string;
      dialect: string | null;
      anchors: string[];
    }[];
    scenes: {
      default: string | null;
      entries: {
        id: string;
        label: string;
        /** OPEN (ARCHITECTURE-CORE §The project model, "Documents, not
         *  scenes"): `scene` and `prefab` are the first two kinds; a page,
         *  a model, a shot, a take are kinds the same way. */
        kind: string;
        region: string | null;
        authorable: boolean;
        reach: { kind: string; [field: string]: unknown };
        source?: { path: string; export?: string };
        finder?: string;
      }[];
    };
    notes: string[];
    error: string | null;
  } | null;
}

export type ViewPreset = 'top' | 'front' | 'right' | 'perspective';
export type ShadingMode =
  | 'solid'
  | 'clay'
  | 'unlit'
  | 'wireframe'
  | 'matcap'
  | 'normals'
  | 'overdraw';

export type TransformMode = 'translate' | 'rotate' | 'scale';
export type TransformSpace = 'world' | 'local';

/**
 * Stable editor-owned workspace documents that may appear in a shareable
 * view. One runtime list owns both URL parsing and the public id type.
 *
 * This SDK cannot import the editor — the dependency runs the other way — so
 * nothing links this list to the documents the editor actually registers, and
 * an id added there is silently unaddressable here (a view carrying it
 * round-trips to nothing). The link is asserted from the side that CAN see
 * both: `packages/editor/test/editor-view-address-space.test.ts`. Adding a
 * document id means adding it here too.
 */
export const EDITOR_VIEW_WORKSPACE_DOCUMENT_IDS = [
  'workspace:scene',
  'workspace:canvas-scene',
  'workspace:game',
  'workspace:3d-components',
  'workspace:2d-components',
  'workspace:ui-components',
  'account',
  'project-tools',
] as const;

export type EditorViewWorkspaceDocumentId = (typeof EDITOR_VIEW_WORKSPACE_DOCUMENT_IDS)[number];

/**
 * The editor's OWN bottom-drawer instruments, as named in a shareable view.
 * One runtime list owns both URL parsing and the public id type — the same
 * discipline as {@link EDITOR_VIEW_WORKSPACE_DOCUMENT_IDS}, and for the same
 * reason: a separate hand-written union and parser allowlist drift silently
 * (`behavior` was in the union and missing from the allowlist, so a view
 * carrying it round-tripped to nothing).
 *
 * This must equal the editor's live `BUILT_IN_WORKSPACE_UTILITIES`
 * (`packages/editor/src/workspace-core-utilities.ts`). It had drifted to five
 * of thirteen — every id from `generations` onward was unaddressable in a
 * shared view. As above, the SDK cannot import the editor to derive this, so
 * `packages/editor/test/editor-view-address-space.test.ts` asserts the
 * equality from the side that sees both.
 */
export const EDITOR_VIEW_BUILT_IN_UTILITY_IDS = [
  'animation',
  'behavior',
  'generations',
  'console',
  'light-explorer',
  'story-actions',
  'story-interactions',
  'story-accessibility',
] as const;

export type EditorViewBuiltInUtilityId = (typeof EDITOR_VIEW_BUILT_IN_UTILITY_IDS)[number];

/** The prefix a PROJECT-contributed utility's id carries. The editor's tool
 *  loader namespaces every `workspace.utility` contribution as
 *  `tool:<contribution-id>`, exactly as a contributed center document is
 *  addressed by `{ kind: 'tool', id }`. */
export const EDITOR_VIEW_TOOL_UTILITY_PREFIX = 'tool:';

/**
 * Which bottom-drawer utility a view reveals: one of the editor's own
 * instruments, or a utility the OPEN PROJECT contributes.
 *
 * The project half cannot be an enum — which tabs exist depends entirely on
 * the game that is open — so the address space admits the namespace and the
 * EDITOR validates the id against its live utility registry when the view is
 * presented, refusing an unregistered one by naming what IS registered.
 */
export type EditorViewUtility =
  | EditorViewBuiltInUtilityId
  | `${typeof EDITOR_VIEW_TOOL_UTILITY_PREFIX}${string}`;

/** Whether `value` is addressable as a view's utility. Shape only — existence
 *  is the editor's answer at present-time, not the URL's. */
export function isEditorViewUtility(value: string): value is EditorViewUtility {
  return (
    (EDITOR_VIEW_BUILT_IN_UTILITY_IDS as readonly string[]).includes(value) ||
    (value.startsWith(EDITOR_VIEW_TOOL_UTILITY_PREFIX) &&
      value.length > EDITOR_VIEW_TOOL_UTILITY_PREFIX.length)
  );
}

/**
 * A durable, intentionally small projection of what an editor is presenting.
 * This is not workspace persistence: panel sizes, transient tool state, and
 * authored document contents remain outside the URL.
 */
export type EditorViewDocument =
  | { kind: 'scene'; path: string }
  | { kind: 'asset'; path: string; entityId?: never; assetKind?: AssetKind }
  | { kind: 'asset'; entityId: string; path?: never; assetKind?: 'model' }
  | { kind: 'tool'; id: string }
  /** A document the adapter's table lists (a model, a page) — `id` is the
   *  table entry's id — opened in the editor registered for its kind. */
  | { kind: 'document'; id: string }
  | { kind: 'world'; id: string }
  | { kind: 'story'; modulePath: string; storyName: string; mode?: 'preview' | 'docs' }
  | { kind: 'project-tool'; name: string }
  | { kind: 'generation'; id: string }
  | {
      kind: 'workspace';
      id: EditorViewWorkspaceDocumentId;
      /**
       * For a COMPONENT BOARD document: the portable story frame to open on
       * — a story id, or a unique CSF export name or label (an ambiguous or
       * unknown value refuses loudly, listing candidates). Emitted back by
       * the board's own presentation so a captured view round-trips. This is
       * the design ledger's "board story selector": without it only the
       * derived default story could ever be addressed.
       */
      story?: string;
    };

/**
 * The document ADDRESS KINDS an `EditorView` can carry — the same published,
 * finite vocabulary `EDITOR_VIEW_KEYS` is for the view's own keys, and for the
 * same reason: a kind this list does not hold must refuse by name rather than
 * fall off the end of a switch. `{kind: 'model', path}` used to present `ok`,
 * move nothing, and echo the caller's own mistake back in `view.doc=undefined`.
 *
 * A document KIND (`model`, `page`) is not one of these: it is the kind of a
 * row in the project's own document table, and its address is
 * `{kind: 'document', id}` — "a document opens in the editor registered for its
 * KIND" (ARCHITECTURE-CORE). The refusal says exactly that, reading the kinds
 * from the project's resolved table rather than from a list written here.
 */
export const EDITOR_VIEW_DOCUMENT_KINDS = [
  'scene',
  'asset',
  'tool',
  'document',
  'world',
  'story',
  'project-tool',
  'generation',
  'workspace',
] as const satisfies ReadonlyArray<EditorViewDocument['kind']>;

/** Narrow an arbitrary string to one of {@link EDITOR_VIEW_DOCUMENT_KINDS}. */
export function isEditorViewDocumentKind(value: string): value is EditorViewDocument['kind'] {
  return (EDITOR_VIEW_DOCUMENT_KINDS as readonly string[]).includes(value);
}

export interface EditorView {
  version: 1;
  /** The workspace (a layout: `model`, `sculpt`, `game`, …) the view is in —
   *  the host's own or a package's `workspace.layout` contribution. Presenting
   *  one the open project does not offer REFUSES and names the vocabulary, the
   *  same answer as `set-workspace`; `currentView` always reports it. */
  workspace?: string;
  /** The style bundle (`classic`, `glass`, `blender`, …) the chrome wears —
   *  the host's own or a package's `workspace.style` contribution. Presenting
   *  one the open project does not offer REFUSES and names the vocabulary,
   *  the same answer as `set-style`; `currentView` reports it when the four
   *  appearance axes match a bundle, and omits it for a custom mix. */
  style?: string;
  /**
   * The keymap (`vgai`, `blender`, …) whose bindings the chrome is printing
   * and dispatching — the editor's own or a package's `workspace.keymap`
   * contribution, as the project's adapter declares it or its settings
   * override it. REPORTED, never presented: `currentView` always answers it,
   * and `present-view` WARNS on a keymap it was handed rather than switching,
   * because which bindings a project uses is that project's declaration and a
   * person's preference, not a property of a shared link.
   */
  keymap?: string;
  /**
   * The static PANEL the dock is focused on — `hierarchy`, `asset-library`,
   * `inspector`, and whatever else the editor's panel registry holds. Shape
   * only here, exactly like `workspace`: the vocabulary is the open editor's
   * registry, so presenting a key it does not hold REFUSES and names the ones
   * it does. `currentView` reports it while a panel (rather than a document or
   * a drawer utility) holds the dock's focus.
   */
  panel?: string;
  document?: EditorViewDocument;
  selection?: { ids: string[]; focus?: boolean };
  viewport?: {
    camera?: ViewPreset | 'isometric' | EditorCameraState;
    diagnostic?: ShadingMode | 'uv' | 'vertex-colors' | 'bounds' | 'skeleton';
    frame?: 'document' | 'selection';
    grid?: boolean;
  };
  utility?: EditorViewUtility;
}

/**
 * THE ADDRESS SPACE, AS DATA — every key {@link EditorView} carries, so the
 * presenter can REFUSE one it does not (`editor-view-presentation.ts`).
 *
 * It lives beside the interface because that is the only placement where a
 * drift is visible in one screen: adding a field above without adding its key
 * here is the whole failure mode, and the row order is the interface's.
 *
 * WHY IT EXISTS (found live, 2026-09-19, unit 17's proof run): a view with the
 * document's `kind` spelled at the TOP level — `{version: 1, kind: 'story',
 * modulePath, storyName}` instead of `{version: 1, document: {kind: 'story',
 * …}}` — presented `ok`, changed nothing, and ECHOED THE BOGUS KEY BACK in
 * `PresentedEditorView.view`, so the caller read its own mistake as
 * confirmation. Three `present` proofs were recorded against it before
 * `currentView()` showed the document had never moved. Every NAMED field here
 * already refuses by name (`style`, `workspace`, `panel`); an unnamed one was
 * the silent hole, which is the case CLAUDE.md's "unknown input must REJECT
 * LOUDLY rather than be partially read" is about.
 */
export const EDITOR_VIEW_KEYS = [
  'version',
  'workspace',
  'style',
  'keymap',
  'panel',
  'document',
  'selection',
  'viewport',
  'utility',
] as const satisfies ReadonlyArray<keyof EditorView>;

export interface PresentedEditorView {
  view: EditorView;
  /** Shareable URL for the durable projection that was applied. */
  url: string;
  /** Honest degradations; an unsupported requested view is never silent. */
  warnings: string[];
}

/**
 * How big a capture comes back.
 *
 * A NUMBER is a square of that size, and square stays the default — an
 * unstaged look at a model is a square question. `{width, height}` is for the
 * shaped answer: a video-aspect frame that needs no crop afterwards, which is
 * what the model/module lanes' looks are actually for.
 *
 * Both are bounded by the EDITOR's own ceiling — 64..1024 per side, plus a
 * total no larger than a 1024 square. That is the relay budget, not a taste:
 * the pixels cross the editor relay as base64 JSON, and 1024 is where even
 * incompressible RGBA still fits its 50 MB request limit (`asset-preview.ts`'s
 * `MIN_SIZE`/`MAX_SIZE`). For more picture, take more views, not bigger ones.
 */
export type CaptureDimensions = number | { readonly width: number; readonly height: number };

/** The pixels of the active center document, with enough provenance for an
 * agent to prove which user-visible subject it captured. Editor chrome is
 * deliberately excluded. */
/** A photograph of the editor PAGE — every panel as the person sees it
 *  (`capture-editor-chrome`; the door that lets a skin, a workspace or a
 *  contributed panel be judged sighted through the product). */
export interface EditorChromeCapture extends ViewportCapture {
  view: EditorView;
  /** The frame's own size, in OUTPUT pixels. */
  size: { width: number; height: number };
  /** Output pixels per CSS pixel — what one pixel of {@link size} is. */
  scale: number;
  layers: { canvases: number; domOverlays: number };
  flatness?: { degenerate: boolean; warning?: string };
}

/** How many output pixels one CSS pixel of the editor page becomes; defaults
 *  to the page's own `devicePixelRatio`, at most 4. */
export interface EditorChromeCaptureOptions {
  readonly scale?: number;
}

export interface ActiveDocumentCapture extends ViewportCapture {
  document: {
    id: string;
    title: string;
    kind: string;
    sourcePath?: string;
    rootId?: string;
  };
  view: EditorView;
  source: 'scene-viewport' | 'game-composite' | 'object3d-document' | 'document-composite';
  layers?: { canvases: number; domOverlays: number };
}

/** Template ids accepted by the editor's create-project endpoint. */
export type ProjectTemplate = 'default' | '2d' | 'react' | 'example';

export interface ProjectInfo {
  path: string;
  config: { name: string; [key: string]: unknown };
}

export interface RecentProject {
  name: string;
  path: string;
  lastOpened: string;
  thumbnail?: string;
}

export type ProjectToolOutcome =
  | { ok: true; data: unknown; generation?: GenerationJob; generationWarning?: string }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        data?: unknown;
        issues?: Array<{ path?: PropertyKey[]; message?: string; [key: string]: unknown }>;
      };
    };

import type { GenerationJob } from '@volter/editor-sdk/generations';
import type { RecordedTabCensus } from '@volter/editor-sdk/tab-census';

export type {
  ProjectToolCatalog,
  ProjectToolCatalogEntry,
  ProjectToolContribution,
  ToolContributionPoint,
} from '@volter/editor-sdk/project-tool-catalog';

// ---------------------------------------------------------------------------
// Inspection — the serialized inspection subject (`EditorClient.inspect`)
// ---------------------------------------------------------------------------
//
// The wire mirror of the editor's own `SerializedInspectionSubject`
// (`packages/editor/src/inspection/serialize.ts`, which owns the contract and
// carries the reasoning). `command-listener.ts` annotates its `inspect`
// payload with this type, so `tsc` checks the two sides against each other on
// every build rather than letting them drift silently.

/** Where the inspector's subject lives; `asset-lab` is an open asset
 *  document — the three paradigm scoped to a subtree, inspected in the same
 *  box as the scene. */
export type InspectionSurface = 'three' | 'canvas' | 'dom' | 'asset-lab';

/** Which LAYOUT the one inspector box is in: the compact box over the
 *  viewport, the same sections stacked in the dock column, or that column
 *  with the sections tabbed behind a vertical rail (`properties`). */
export type InspectionPresentationKind = 'card' | 'column' | 'properties';

/** One inspected field: a stable scriptable `path` and the value at it. */
export interface InspectedField {
  path: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'vec3' | 'color' | 'enum' | 'asset' | 'json';
  /** Absent when nothing is at that address, or when `mixed` is set. */
  value?: unknown;
  /** The inspected subjects disagree about this field. */
  mixed?: true;
  /** The value shown is the declared default — the document does not carry it. */
  defaulted?: boolean;
  readonly?: boolean;
  /** The same reason shown by the Inspector and returned by a refused write. */
  readonlyReason?: string;
  resettable?: boolean;
  revertsTo?: string;
  group?: string;
  options?: readonly unknown[];
}

/** A section's content. Custom RENDERING remains opaque — the wire never
 *  introspects React — while any ordinary descriptor channel that chrome owns
 *  IS a `fields` body here, including its write-refusal reasons: nothing is
 *  rendered on this wire, so naming chrome a reader cannot see while hiding
 *  the fields it can use is the wrong half. (Measured: the whole react/DOM
 *  lane draws its own widgets over the style descriptors, so every one of its
 *  sections reported `custom` and `inspect()` enumerated zero fields for a DOM
 *  element.) The two opaque kinds are distinguished because "this subject has
 *  a live preview" is a real fact about it: `custom` is a contributed block
 *  with no descriptor channel of its own, `preview` is the subject's own
 *  square view of itself.
 *
 *  A custom body carries `data` when it can say what it DISPLAYS — the keys
 *  are the section's own vocabulary, not a shared schema. The shipped case is
 *  `transform`: `{position, rotation, scale}`, three numbers each, with
 *  rotation in Euler XYZ DEGREES exactly as the rotation inputs show it (the
 *  quaternion behind them is not on this wire). */
export type InspectedSectionBody =
  | { kind: 'fields'; fields: readonly InspectedField[] }
  | {
      kind: 'custom';
      id: string;
      title: string;
      data?: Record<string, unknown>;
    }
  | { kind: 'preview'; id: string; title: string };

export interface InspectedSection {
  id: string;
  title: string;
  order: number;
  description?: string;
  body: InspectedSectionBody;
}

/** A verb on the subject (the visibility eye, the Asset Editor jump). */
export interface InspectedAction {
  id: string;
  title: string;
  label?: string;
  /** Toggle state, for verbs that have one — how visibility is read. */
  pressed?: boolean;
  disabled?: boolean;
}

export interface InspectedSubjectLink {
  id: string;
  title: string;
}

/** The whole inspection subject, as data — what a human sees in the
 *  inspector, for an agent (`vgai eval 'editor.inspect()'`). */
export interface InspectedSubject {
  id: string;
  title: string;
  kindLabel?: string;
  /** The quiet line a subject with nothing to edit explains itself with. */
  hint?: string;
  presentation: {
    preferred: InspectionPresentationKind;
    resolved?: InspectionPresentationKind;
    surface?: InspectionSurface;
  };
  quickActions: readonly InspectedAction[];
  /** Agent-visible counterparts of the inspector's related-document buttons. */
  related: readonly InspectedSubjectLink[];
  /** Already in display order. */
  sections: readonly InspectedSection[];
}

/** NOTHING is being inspected: the inspector is unmounted, so the honest
 *  answer is not an empty subject but the absence of one. Distinct from a
 *  missing reply, which means nobody answered
 *  (`editor.inspection.get`'s `INSPECTION_UNAVAILABLE`). */
export interface InspectedNothing {
  none: true;
}

/** What `editor.inspect()` answers: the subject showing, or nothing at all.
 *  Narrow with `'none' in result`. */
export type InspectedInspection = InspectedSubject | InspectedNothing;

/**
 * WHERE THIS WRITE WENT — carried by every `editor.setField()` ack.
 *
 * A write with no persistence route still succeeds: it lands on the live
 * object and journals live-only, exactly as designed. Without this the ack was
 * indistinguishable from one that reached a file, so a caller could only find
 * out by diffing the tree — and a healthy consent-off session read as a silent
 * no-op. `persisted: false` with `destination: "live-only (not saved)"` is the
 * honest floor: never silence, and never a fabricated file name.
 *
 * IT IS PER-EDIT, produced by the component that performed the write and
 * returned through the editor's persistence pipe — never a property of the
 * session, the surface or the adapter. A composite holding a live-only three
 * root beside a source-backed DOM root has no single true answer, and the
 * adapter-wide one it used to give was the DOM root's (measured on the
 * vendored racing game: a three-root edit acked `persisted: true` against a
 * file it never touched). The ack is also AWAITED: it resolves after the bytes
 * have landed, so a caller holding it can diff the tree immediately.
 */
export interface InspectedWriteDestination {
  /** Where THIS edit's bytes landed, in the writer's own words — a source
   *  file, the game's own JSX, or a named non-target like
   *  `"live-only (not saved)"`. */
  destination: string;
  /** Whether a byte actually moved for THIS edit. */
  persisted: boolean;
}

/** What `editor.setField()` answers: the subject after the write, plus where
 *  the write went. */
export interface InspectedFieldWrite {
  subject: InspectedInspection;
  write: InspectedWriteDestination;
}

/**
 * The STRUCTURE verbs — the hierarchy context menu's own ops, addressable.
 *
 * The names are the menu's, not the provider's, because the menu is the
 * surface a human uses and an agent is doing the same thing through a
 * different door (`delete` covers the provider's `remove`/`removeMany`: a
 * multi-id delete is ONE undoable op when the adapter can batch it).
 */
export type StructureOp =
  | 'create'
  | 'delete'
  | 'duplicate'
  | 'reparent'
  | 'reorder'
  | 'wrap'
  | 'unwrap'
  | 'group'
  | 'ungroup'
  | 'copy'
  | 'cut'
  | 'paste';

/** Arguments for one {@link StructureOp}. Everything is optional: `id`/`ids`
 *  default to the current selection, the menu's own subject. */
export interface StructureOpOptions {
  id?: string;
  ids?: readonly string[];
  /** `create`: which creatable kind (see the adapter's `creatableKinds`). */
  kind?: string;
  /** `create`/`reparent`/`paste`: the destination; `null`/absent = document root. */
  parentId?: string;
  /** `reorder`: move immediately before this sibling; absent = to the end. */
  beforeSiblingId?: string;
  /** `wrap`: the wrapper tag; absent = the adapter's own default. */
  tag?: string;
}

/** What one structure op answers. `write` is the same per-edit ack
 *  `editor.setField()` carries — `persisted: false` means the tree moved and
 *  no byte did. `id`/`ids` name what the op produced, when it produces one. */
export interface StructureOpResult {
  id?: string | null;
  ids?: readonly string[];
  write?: InspectedWriteDestination;
  /** `copy` only: whether the clipboard actually took the payload. */
  copied?: boolean;
}

// ---------------------------------------------------------------- hierarchy
//
// The wire mirror of the editor's own `SerializedHierarchyPanel`
// (`packages/editor/src/hierarchy-panel-view.ts`, which owns the contract and
// carries the reasoning). `command-listener.ts` annotates its `hierarchy`
// payload with this type, so `tsc` checks the two sides against each other on
// every build.
//
// This is NOT `EditorState.entities`: that facet is the raw adapter tree, with
// no marks, no internals folding and no document promotion. This one is what
// the hierarchy PANEL rendered — the rows a human is looking at.

/** One row of the hierarchy panel, as data. */
export interface InspectedHierarchyRow {
  id: string;
  label: string;
  /** The dim type suffix the row prints (`Coin1 ·Coin`). */
  typeLabel?: string;
  role?: string;
  depth: number;
  /** Children the row's view has — what opening the caret reveals. Folded
   *  implementation children are NOT counted here. */
  childCount: number;
  /** Children folded away as implementation, behind "Reveal Internals". */
  internalChildCount: number;
  /** Whether the panel renders a disclosure control. A row with children of
   *  any kind and `expandable: false` is a subtree the UI cannot reach. */
  expandable: boolean;
  expanded?: boolean;
  internal?: true;
  componentRoot?: true;
  /** A synthetic "… N more" cap stub rather than a real node. */
  more?: { hidden: number };
  children?: readonly InspectedHierarchyRow[];
}

/** What `editor.hierarchy()` answers. */
export interface InspectedHierarchy {
  rowCount: number;
  /** The slice in the DOM; a smaller span than `rowCount` means the rest is
   *  scrolled out, not absent. */
  window: { start: number; end: number };
  search?: string;
  scopeId?: string;
  playState: string;
  activeViewportTab: string;
  roots: readonly InspectedHierarchyRow[];
}
