/**
 * R3fSourceAuthoringAdapter (W4) — the write-back authoring adapter for an
 * entry-based R3F three world in EDIT mode.
 *
 * Model: the live fiber `THREE.Scene` is truth for structure and transforms
 * (projected directly, SourceObject3DAuthoringAdapter-style — no
 * mirror); the project's `.tsx` source is truth for persistence. Nodes whose
 * Object3D carries `userData.oid` (stamped by W1's `userData-oid` dialect in
 * `@volter/editor-react`'s `serving/ui-oid-plugin.ts`) are SOURCE-ADDRESSABLE: their JSX props (including
 * W2's number-tuple transforms) read from the real source text
 * (`analyzeJsxAttributes` over the oid index location) and write back through
 * the same `/__ui-source/*` seam the DOM adapter (`dom-authoring-adapter.ts`) uses — wrapped
 * in `withProjectSourceHistory`, so every write is a checksum-guarded
 * undo/redo entry for free. Nodes without an oid (drei internals, runtime
 * children) project read-only.
 *
 * The literal-vs-dynamic guard is sacred: an expression-bound prop
 * (`position={spawn}`) is surfaced read-only and never written; a gizmo edit
 * on such a channel is refused AND the live object reverts to its pre-drag
 * snapshot (never a silent two-truths divergence).
 *
 * HMR/remount identity (W4e): ids are `r3f:<worldId>:<oid>` — oid signatures
 * (`file:component:tag:occurrence`) are stable across the design session's
 * full remount, so `adoptScene(newScene)` re-resolves the same ids onto the
 * fresh fiber objects and selection survives. The session (r3f-design-
 * session.ts) owns mounting/remounting; this adapter only ever projects the
 * scene it was last handed.
 */

import {
  authoringOidOf,
  instanceStampOf,
  isComponentInstanceRoot,
  isOccurrenceId,
  ownOidOf,
  rendersSameSourceElement,
} from '@volter/editor-threejs/kit/authoring/component-instance-root';
import { beginLiveGesture, endLiveGesture } from '@volter/editor-sdk/kit/live-gesture-lock';
import { createStructWritePipe, type StructOpOptions } from '../../host/authoring/struct-write-pipe';
import {
  CollapsedHierarchyView,
  readLocalTransform,
  StoreSelectionAdoption,
} from '@volter/editor-threejs/kit/authoring/three-projection-core';
import {
  clipboardOutcome,
  LIVE_ONLY_ACK,
  type PipedWrite,
  resolvesLiveOnly,
  runWritePipe,
  type WriteAck,
  type WriteResolution,
} from '@volter/editor-sdk/kit/write-pipe';
import { componentStatesProvider } from '@volter/editor-core/component-states-registry';
import { openProjectToolDocument } from '@volter/editor-core/components/project-tool-documents';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import type { EditorShellStore } from '@volter/editor-threejs/kit/editor-shell-store';
import {
  replaceProjectSource,
  withProjectSourceHistory,
} from '@volter/editor-core/history/source-history-backend';
import { warnGuessedFromText } from '@volter/editor-core/inference-diagnostics';
import {
  extractedHint,
  extractNoBackendHint,
  extractPartialHint,
  extractRefusedHint,
  extractUnavailableHint,
} from '../../host/instance-extract-actions';
import {
  forkedHint,
  forkNoBackendHint,
  forkPartialHint,
  forkRefusedHint,
  forkUnavailableHint,
} from '../../host/instance-fork-actions';
import {
  nativeKindOf,
  type SourceOidIdentity,
  sourceOidIdentity,
  ThreeProjector,
} from '@volter/editor-threejs/kit/projection/three';
import { getStorageBackend } from '@volter/editor-sdk/kit/storage/index';
import { showTransientHint } from '@volter/editor-sdk/kit/transient-hint';
import {
  type ComponentPropSpec,
  lineColToOffset,
  type OidEntry,
  type R3fAuthoringDiagnostic,
  type R3fEnvironmentBinding,
  type R3fEnvironmentNumberBinding,
  type R3fEnvironmentStringBinding,
} from '@volter/editor-react/source/oid-transform';
import { mergeRowDiagnostics } from '@volter/editor-react/source/r3f-diagnostic-index';
import type { R3fJointLiteral, R3fJointLiteralRange } from '@volter/editor-react/source/r3f-joint-binding';
import type { R3fLodNumberBinding } from '@volter/editor-react/source/r3f-lod-binding';
import { bodyPlacedChannel, physicsRefusal } from '@volter/editor-react/source/r3f-physics-binding';
import { relativeImportSpecifier } from '@volter/editor-react/source/relative-import-specifier';
import type { ReparentChannel, ReparentRebase } from '@volter/editor-react/source/reparent-guard';
import type {
  SourceWriteBackend,
  StructReparentContext,
} from '@volter/editor-core/ui-source/source-write-backend';
import {
  analyzeJsxAttributes,
  type DuplicateRewrite,
  findElementEnd,
  findTagEnd,
  isNumberTupleLiteral,
  type JsxAttrInfo,
  offsetSnippetPositions,
} from '@volter/editor-react/source/writer';
import { THREE_COMPONENTS_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import { activateWorkspaceDocument } from '@volter/editor-sdk/kit/workspace-document-registry';
import type {
  AssetDropContext,
  AssetDropProvider,
  AuthoringAdapter,
  AuthoringCapabilities,
  AuthoringProvenance,
  ComponentInstanceApplyResult,
  ComponentInstancesProvider,
  EditorNode,
  HierarchyProvider,
  InspectorProvider,
  NodeCreationSite,
  PersistenceProvider,
  PhysicsAdapter,
  PickProvider,
  PropertyDescriptor,
  RelatedSubjectsProvider,
  SelectionProvider,
  SpatialHandlesProvider,
  StoriesProvider,
  StructureProvider,
  Transform,
  TransformChannel,
  TransformEditability,
  TransformProvider,
  TruthProvider,
  WriteAnchorKind,
} from '@volter/editor-project/adapter';
import { isEditorOwnedObject } from '@volter/editor-threejs/viewport/editor-layers';
import { object3DAuthoringSubjectOf } from '@volter/threejs-runtime/adapter/object3d-authoring-subject';
import { getUserData } from '@volter/threejs-runtime/ecs/user-data';
import type * as THREE from 'three';
import { Box3, Vector3 } from 'three';
import type { ColliderSourceBinding } from './spatial-collider-handles';
import type { JointSourceBinding } from './spatial-joint-handles';
import {
  type LodSourceBinding,
  normalizeLodDistance,
  previewLodDistance,
} from './spatial-lod-handles';
import {
  type NativeParticleEmitter,
  nativeEmitterShapeOf,
  normalizeParticleField,
  type ParticleSourceBinding,
  previewParticleEdit,
} from './spatial-particle-handles';
import { createThreeSpatialHandlesProvider } from './three-spatial-handles';
import {
  applyTypedField,
  lightShadowTypedField,
  readTypedField,
  type TypedThreeField,
  typedFieldForPath,
  typedThreeFields,
} from './typed-three-inspector';

export interface R3fAuthoringOptions {
  readonly worldId: string;
  /** Project-relative entry path — shown as the document's secondary label. */
  readonly entryPath: string;
  /** The RAW http backend; wrapped in `withProjectSourceHistory` here (same
   *  recipe as ReactRootAuthoringAdapter) so writes are undoable. */
  readonly writeBackend?: SourceWriteBackend | undefined;
  /** Dynamic because the design world's system adapters register from React
   * effects and are replaced on each source remount. */
  readonly physics?: (() => PhysicsAdapter | null | undefined) | undefined;
  /**
   * Scene composition projects component instances; an Asset Lab document
   * opens the component definition itself. Definition mode therefore exposes
   * the authored native tree instead of collapsing it back into one instance
   * row, while retaining the exact same OID-backed transform writer.
   */
  readonly hierarchyMode?: 'instances' | 'definition';
  /** Content roots for definition mode when the mount has a presentation
   * wrapper (portable CSF is the concrete case). */
  readonly hierarchyRoots?: readonly THREE.Object3D[];
}

const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const EPS = 1e-6;

/** Present source identifiers the way native engine inspectors present
 * component and property names while keeping the JSX path as source truth. */
function humanizeIdentifier(value: string): string {
  const spaced = value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .trim();
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : value;
}

/** Props never surfaced in the JSX-props section (mirror of writer.ts's skip
 *  set, plus the editor's own stamp + the wrapper's structural props). */
// `type` is NOT hidden: on `<RigidBody type="fixed">` it is the single most
// important prop the author wrote.
const HIDDEN_PROPS = new Set(['key', 'ref', 'data-oid', 'userData-oid', 'children']);
const isHiddenProp = (name: string): boolean =>
  HIDDEN_PROPS.has(name) ||
  /^on[A-Z]/.test(name) ||
  name.startsWith('userData-') ||
  // The editor's OWN injected identity props (`__vgaiOid`, `__vgaiLabel` —
  // `oid-transform.ts`'s callsite stamp). They never reach here today, because
  // attrs are read from the file on disk while the stamp exists only in the
  // transformed module — but they are the one prop family whose removal would
  // break instance identity outright, so the guard is stated rather than
  // inferred from that layering.
  name.startsWith('__vgai');

/** Owned by the Transform section at the top of the panel, and by the Name
 *  field in the header — listing them again showed the same value twice. */
const PANEL_OWNED_PROPS = new Set(['position', 'rotation', 'scale', 'name', 'visible']);

/** Shared empty set for `componentProperties`' default — a typed section owns
 *  nothing extra for an ordinary node. */
const EMPTY_OWNED_PROPS: ReadonlySet<string> = new Set();

/** A thrown value as a sentence fragment — H7's hints quote the failure. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Format a number for source (≤4 decimals, no trailing zeros). */
function fmt(n: number): string {
  const rounded = Math.round(n * 1e4) / 1e4;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function tupleText(values: readonly number[]): string {
  return `[${values.map(fmt).join(', ')}]`;
}

/** Project-relative path, compared the one way both sides spell it. */
function normalizeProjectPath(path: string): string {
  return path.replace(/^\.?\//, '');
}

/** A double-quoted JSX attribute's text — the two characters that could end the
 *  attribute early, removed rather than escaped (a filename containing them is
 *  not something to preserve into source). */
function jsxAttrText(value: string): string {
  return value.replace(/["\\]/g, '');
}

/** `/models/generated/arena-rifle.glb` → `arena-rifle`, the `name` a hierarchy row
 *  reads by. */
function modelNodeName(assetPath: string): string {
  const base = assetPath.split('/').pop() ?? assetPath;
  return base.replace(MODEL_EXTENSION_RE, '') || 'Model';
}

/** What a drop RESOLVES to before any byte is written — see `assetDropPlan`. */
type AssetDropPlan =
  | {
      ok: true;
      parentId: string;
      op: 'create' | 'create-sibling';
      snippet: string;
      ensureImport: { name: string; module: string; kind?: 'default' | 'named' };
      /** The source element the write targets when it is not the row's own
       *  callsite — a drop onto a top-level instance row lands in its
       *  DEFINITION's root, the file the hierarchy's transparent rows already
       *  belong to. */
      sourceOid?: string;
    }
  | { ok: false; reason: string };

function isVec3Literal(raw: string): boolean {
  if (!isNumberTupleLiteral(raw)) return false;
  const parts = raw
    .trim()
    .slice(1, -1)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return parts.length === 3 && parts.every((part) => NUMBER_RE.test(part));
}

/** Cameras are authored scene instruments, not implementation detail inside a
 * component. Keep the native node visible/selectable even when the ordinary
 * component projection collapses same-component host output. Otherwise a
 * normal `<PerspectiveCamera>` is reachable only through Reveal Internals,
 * which makes standard camera authoring undiscoverable. */
function isAuthoredCamera(object: THREE.Object3D): object is THREE.Camera {
  return (object as THREE.Camera).isCamera === true && authoringOidOf(object) !== undefined;
}

function firstMaterial(object: THREE.Object3D): THREE.Material | null {
  const material = (object as THREE.Mesh).material;
  if (Array.isArray(material)) return material[0] ?? null;
  return material ?? null;
}

/** Why a write here resolves live-only — the ONE spelling, shared by all three
 *  of this adapter's pipe plugs so a hosted session says the same thing about
 *  a prop, a token and a gesture. */
const NO_SOURCE_WRITER_REASON = 'this session has no source-write backend';

const JSX_PATH_PREFIX = 'jsx.';
/** `wrap.<encoded oid>.<prop>` — a prop on a wrapper tag that never became its
 *  own node, so the write has to name which tag it lands on. */
const WRAPPER_PATH_PREFIX = 'wrap.';
const COLLIDER_ARG_PATH_PREFIX = 'collider.';
const JOINT_PATH_PREFIX = 'joint.';
const PARTICLE_PATH_PREFIX = 'particle.';
const LOD_PATH_PREFIX = 'lod.';
const WORLD_BACKGROUND_PATH_PREFIX = 'scene.background.';
const WORLD_ENVIRONMENT_PATH_PREFIX = 'scene.environment.';
const WORLD_FOG_PATH_PREFIX = 'scene.fog.';

const COLLIDER_TAG_SHAPES = {
  CuboidCollider: 'cuboid',
  BallCollider: 'ball',
  CapsuleCollider: 'capsule',
} as const;
type ExplicitColliderTag = keyof typeof COLLIDER_TAG_SHAPES;

const JOINT_HOOK_TYPES = {
  useFixedJoint: 'fixed',
  useSphericalJoint: 'spherical',
  useRevoluteJoint: 'revolute',
  usePrismaticJoint: 'prismatic',
  useRopeJoint: 'rope',
  useSpringJoint: 'spring',
} as const;

interface SourceTokenReplacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

type EnvironmentToken = R3fEnvironmentNumberBinding | R3fEnvironmentStringBinding;

interface NativeEnvironmentSource {
  readonly oid: string;
  readonly file: string;
  readonly binding: R3fEnvironmentBinding;
}

interface R3fStructureClipboard {
  readonly sourceFile: string;
  readonly text: string;
  readonly count: number;
  /** Screen-visible landing shift for the pasted block, computed at copy time
   *  from the first copied object's own width (`offsetSnippetPositions`). */
  readonly pasteOffset?: readonly [number, number, number];
}

function isThreeColor(value: unknown): value is THREE.Color {
  return !!value && (value as { readonly isColor?: unknown }).isColor === true;
}

function isThreeTexture(value: unknown): value is THREE.Texture {
  return !!value && (value as { readonly isTexture?: unknown }).isTexture === true;
}

function isLinearFog(value: THREE.Scene['fog']): value is THREE.Fog {
  return !!value && (value as THREE.Fog).isFog === true;
}

function isExponentialFog(value: THREE.Scene['fog']): value is THREE.FogExp2 {
  return !!value && (value as THREE.FogExp2).isFogExp2 === true;
}

function stampedResource(value: unknown): { readonly userData?: Record<string, unknown> } | null {
  return value && typeof value === 'object'
    ? (value as { readonly userData?: Record<string, unknown> })
    : null;
}

function normalizedHex(value: string): string | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1]!.toLowerCase();
  return hex.length === 3
    ? hex
        .split('')
        .map((part) => `${part}${part}`)
        .join('')
    : hex;
}

function jointRangeArray(value: R3fJointLiteralRange): value is readonly R3fJointLiteralRange[] {
  return Array.isArray(value);
}

function collectJointTokenReplacements(
  source: string,
  oldValue: R3fJointLiteral,
  newValue: R3fJointLiteral,
  range: R3fJointLiteralRange,
  replacements: SourceTokenReplacement[],
): boolean {
  const oldArray = Array.isArray(oldValue);
  const newArray = Array.isArray(newValue);
  const ranges = jointRangeArray(range);
  if (oldArray || newArray || ranges) {
    if (!oldArray || !newArray || !ranges || oldValue.length !== newValue.length) return false;
    if (oldValue.length !== range.length) return false;
    return oldValue.every((part, index) =>
      collectJointTokenReplacements(source, part, newValue[index]!, range[index]!, replacements),
    );
  }
  if (oldValue === newValue) return true;
  const currentToken = source.slice(range.start, range.end);
  if (
    typeof oldValue === 'number'
      ? Number(currentToken) !== oldValue
      : currentToken !== String(oldValue)
  ) {
    return false;
  }
  replacements.push({
    start: range.start,
    end: range.end,
    text: typeof newValue === 'number' ? fmt(newValue) : newValue ? 'true' : 'false',
  });
  return true;
}

function jointParameterValue(binding: JointSourceBinding, param: number): unknown {
  const sourceValue = binding.source.params?.[param];
  if (sourceValue !== undefined) return sourceValue;
  const hook = binding.source.hook;
  const snapshot = binding.snapshot;
  if (param === 0) return snapshot.anchor1;
  if (param === (hook === 'useFixedJoint' ? 2 : 1)) return snapshot.anchor2;
  if (param === 2 && (hook === 'useRevoluteJoint' || hook === 'usePrismaticJoint')) {
    return snapshot.axis;
  }
  if (param === 3 && snapshot.limits) return [snapshot.limits.min, snapshot.limits.max];
  return undefined;
}

function jointParameterPart(value: unknown, part: number | undefined): unknown {
  return part === undefined ? value : Array.isArray(value) ? value[part] : undefined;
}

/** Whatever an inspector block reads from and writes to. */
interface PropSubject {
  /** The JSX tag a write targets. */
  readonly oid: string;
  /** The props that tag's component declares. */
  readonly declared: readonly ComponentPropSpec[];
  /** Descriptor path for one of its props. */
  pathFor(prop: string): string;
  /** Echo/dynamic-guard key for one of its props — must match what the writer
   *  for this subject uses (see `echoKey`). */
  keyFor(prop: string): string;
}

/**
 * The curated create presets the hierarchy's Create submenu offers for an
 * R3F world. Each is an R3F-idiomatic, flush-left snippet (2-space
 * internal nesting) that `insertChildElement`'s snippet path re-indents
 * under the chosen parent. The dev server's next transform stamps the new
 * element(s) with `userData-oid`, so a freshly created node is
 * immediately source-addressable after the remount.
 */
const R3F_CREATE_PRESETS: Record<string, string> = {
  group: '<group>\n</group>',
  mesh:
    '<mesh position={[0, 0, 0]}>\n' +
    '  <boxGeometry />\n' +
    '  <meshStandardMaterial color="#8888ff" />\n' +
    '</mesh>',
  pointLight: '<pointLight position={[0, 2, 0]} intensity={1} />',
  ambientLight: '<ambientLight intensity={0.5} />',
  directionalLight: '<directionalLight position={[5, 10, 5]} intensity={1} />',
  reflectionProbe: '<ReflectionProbe position={[0, 2, 0]} size={[10, 6, 10]} blendDistance={1} />',
};

/**
 * The asset kinds an R3F world can mount as a scene node, and the element it
 * mounts them AS.
 *
 * The idiom is drei's own `<Gltf src=… />` — the library packaging of exactly
 * what every shipped example writes by hand (`useGLTF(path)` + a cloned
 * `<primitive>`; see `examples/cinematic-story/src/world.tsx`'s `BakedModel`,
 * `examples/third-person/src/components/WeaponModel.tsx`). A dropped model has
 * no props to configure yet, so the hand-rolled loader component would be a
 * copy of the library's with nothing added — and a component is what an author
 * writes THEMSELVES once the model needs behavior, by editing this callsite.
 * Deliberately NOT a vgai wrapper or a runtime indirection: the inserted line is
 * the line a human would write, and every later edit is drei's own API.
 */
const MODEL_EXTENSION_RE = /\.(glb|gltf)$/i;

/** The prefab a drag carries (`AssetDropContext.item`, component variant). */
type DroppableComponent = Extract<NonNullable<AssetDropContext['item']>, { kind: 'component' }>;

/** Props the drop snippet writes itself (or that name the element's children):
 *  never given a declared default a second time. */
const SNIPPET_OWNED_PROPS = new Set(['name', 'position', 'rotation', 'scale', 'children']);
const DREI_MODULE = '@react-three/drei';
const GLTF_TAG = 'Gltf';

const R3F_CREATE_LABELS: Record<string, string> = {
  group: 'Group',
  mesh: 'Mesh (box)',
  pointLight: 'Point Light',
  ambientLight: 'Ambient Light',
  directionalLight: 'Directional Light',
  reflectionProbe: 'Reflection Probe',
};

interface TransformEditSnapshot {
  id: string;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  euler: [number, number, number];
  scale: [number, number, number];
}

export class R3fSourceAuthoringAdapter implements AuthoringAdapter {
  private readonly documentNodeId: string;
  private scene: THREE.Scene;
  /** The identity scheme this lane is addressed by, and the two OID facts only
   *  its walk can measure (`instanceRoots`, `representatives`). */
  private readonly identity: SourceOidIdentity;
  /** The shared three projector — this adapter's ONE walk and index. The
   *  hierarchy VIEW below (component-boundary collapsing) is derived from it;
   *  the walk itself is not this class's any more. */
  private readonly projector: ThreeProjector;
  private readonly definitionRootIds: readonly string[];
  /** DEFINITION mode's rows: the shared collapse view over this lane's
   *  projection (`three-projection-core.ts`). Instances mode has its own
   *  component-boundary view below — a different question, not this one. */
  private readonly definitionView: CollapsedHierarchyView;
  /** Selection, shared with the store the viewport writes to — see
   *  `three-projection-core.ts`. */
  private readonly selectionState: StoreSelectionAdoption;

  /** OID → {file,line,col} — fetched from `/__ui-source/index`. */
  private oidIndex = new Map<string, OidEntry>();
  private sourceRefreshId = 0;
  private sourceRefreshPending = false;
  /** file → current source text (for client-side attr analysis). */
  private sources = new Map<string, string>();
  /** Optimistic write echo (id|path → value) until the remount reconciles. */
  private valueEcho = new Map<string, unknown>();
  /** id|path refused as dynamic this session — rendered read-only. */
  private dynamicPaths = new Set<string>();
  private reflectionProbeAvailable = false;
  /** Editor-session selection locks. Three/R3F has no native persisted lock
   * field, so this must never manufacture one in game source. The set is read
   * by viewport picking; hierarchy selection remains available for unlock. */
  private readonly lockedIds = new Set<string>();
  /** Session clipboard authority. The OS clipboard carries useful plain JSX;
   * this record carries the source-file provenance needed to refuse an unsafe
   * cross-file paste whose component imports the destination may not have. */
  private structureClipboard: R3fStructureClipboard | null = null;

  private readonly writeBackend: SourceWriteBackend | undefined;
  private readonly transformEdits = new Map<string, TransformEditSnapshot>();
  private readonly completedTransformEdits: TransformEditSnapshot[] = [];
  private transformCommitQueue = Promise.resolve();

  readonly stories: StoriesProvider;

  readonly capabilities: AuthoringCapabilities;
  readonly persistence?: PersistenceProvider;

  readonly provenance: AuthoringProvenance = {
    source: 'source-code',
    label: 'R3F source',
    detail:
      'Live react-three-fiber scene; literal JSX props write back to the .tsx source ' +
      '(expression-bound props are read-only).',
  };

  constructor(
    private readonly store: EditorShellStore,
    scene: THREE.Scene,
    readonly options: R3fAuthoringOptions,
  ) {
    this.scene = scene;
    this.documentNodeId = `r3f-document:${options.worldId}`;
    this.identity = sourceOidIdentity(options.worldId);
    // `'store-object-map'`: this lane's objects ARE the shell's — the design
    // session adopts this scene and `syncAdoptedObjectMap` keeps that index in
    // step — so picking reads the map the viewport itself draws from.
    this.projector = new ThreeProjector(this.identity, { pickScope: 'store-object-map' });
    this.writeBackend = withProjectSourceHistory(options.writeBackend, store.shell.projectHistory);
    this.capabilities = {
      transform: true,
      inspectorFields: true,
      // This adapter auto-saves accepted edits into the TSX source before the
      // edit resolves. A provider still matters: it is how generic shell
      // chrome learns the real destination and a rolled-back write failure.
      persist: this.writeBackend !== undefined,
    };
    if (this.writeBackend) {
      this.persistence = {
        isDirty: () => false,
        save: async () => undefined,
        destination: options.entryPath,
        lastError: () => {
          const error = store.shell.projectHistory?.getSnapshot().lastError;
          if (!error) return null;
          return error.code === 'apply-failed' ||
            error.code === 'compensation-failed' ||
            error.code === 'history-limit'
            ? error.message
            : null;
        },
      };
    }
    this.selectionState = new StoreSelectionAdoption({
      store: store.shell,
      owns: (id) => this.byId.has(id),
      initial: [this.documentNodeId],
    });
    this.indexGraph();
    this.definitionRootIds = (options.hierarchyRoots ?? this.projectedChildren(this.scene))
      .map((object) => this.idByObject.get(object))
      .filter((id): id is string => id !== undefined);
    this.definitionView = new CollapsedHierarchyView({
      projector: this.projector,
      scene: this.scene,
      documentNodeId: this.documentNodeId,
      rootIds: this.definitionRootIds,
    });
    this.stories = componentStatesProvider('three', store.shell, (id) => this.storyComponent(id));
    void this.refreshSourceState();
  }

  // ------------------------------------------------------------------ index

  /** id → live object, and its inverse — VIEWS onto the projector's index, so
   *  this class holds no second copy of the walk's answer. */
  private get byId(): ReadonlyMap<string, THREE.Object3D> {
    return this.projector.objects;
  }

  private get idByObject(): ReadonlyMap<THREE.Object3D, string> {
    return this.projector.idsByObject;
  }

  /** oid → how many live instance ROOTS it renders (measured by the walk). */
  private get instanceRoots(): ReadonlyMap<string, number> {
    return this.identity.instanceRoots;
  }

  /** oid → the FIRST live object that resolved to it — the occurrence that
   *  keeps the bare address and against which every `…#n` occurrence's write
   *  authority is decided (see {@link borrowsRepresentativeCallsite}). */
  private get oidRepresentative(): ReadonlyMap<string, THREE.Object3D> {
    return this.identity.representatives;
  }

  private indexGraph(): void {
    this.projector.project(this.scene);
    this.watchStructure();
  }

  // ------------------------------------------------- late structural commits
  //
  // `indexGraph` runs when the adapter is handed a scene — which is fiber's
  // FIRST commit. A world whose authored tree arrives later (a translated port
  // that renders nothing until its resources load, a Suspense boundary
  // resolving a model) commits real authored nodes into the SAME scene after
  // that walk, and nothing used to notice: the hierarchy stayed one leaf row,
  // the new objects carried no `entityId`, and every transform read as
  // refused — while the viewport (which draws the raw scene) showed the full
  // world. The live adapter's answer is "the read IS the refresh point"; this
  // adapter's index is too expensive to rebuild per read, so it re-indexes on
  // the graph's OWN structural events instead: fiber's `appendChild` is
  // `parent.add(child)`, and three dispatches `childadded`/`childremoved` on
  // the parent, so watching the scene plus every indexed object covers every
  // path a new subtree can enter through. Editor furniture (gizmo/helper
  // attachments carry `isEditorOwnedObject`) is filtered so selection churn
  // does not re-index.

  /** Objects currently carrying this adapter's structural listeners. */
  private disposed = false;
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const object of this.watchedForStructure) {
      object.removeEventListener('childadded', this.onStructureChanged);
      object.removeEventListener('childremoved', this.onStructureChanged);
    }
    this.watchedForStructure = [];
  }

  private watchedForStructure: THREE.Object3D[] = [];
  private structureReindexQueued = false;
  /** Oids whose stale sighting already spent their one index refetch — see the
   *  editability fallback. Per-oid, because a later fast-refresh mints NEW
   *  oids, which arrive with their own budget. */
  private readonly staleOidRefreshes = new Set<string>();

  private readonly onStructureChanged = (event: { child: THREE.Object3D }): void => {
    if (isEditorOwnedObject(event.child)) return;
    this.scheduleStructureReindex();
  };

  /** (Re)attach `childadded`/`childremoved` listeners across the indexed
   *  graph. Called at the end of every `indexGraph`, so a freshly-committed
   *  subtree is itself watched from the re-index that discovered it. */
  private watchStructure(): void {
    const structural = (object: THREE.Object3D) =>
      object as unknown as {
        addEventListener(
          type: 'childadded' | 'childremoved',
          listener: (event: { child: THREE.Object3D }) => void,
        ): void;
        removeEventListener(
          type: 'childadded' | 'childremoved',
          listener: (event: { child: THREE.Object3D }) => void,
        ): void;
      };
    for (const object of this.watchedForStructure) {
      structural(object).removeEventListener('childadded', this.onStructureChanged);
      structural(object).removeEventListener('childremoved', this.onStructureChanged);
    }
    this.watchedForStructure = [];
    const watch = (object: THREE.Object3D): void => {
      structural(object).addEventListener('childadded', this.onStructureChanged);
      structural(object).addEventListener('childremoved', this.onStructureChanged);
      this.watchedForStructure.push(object);
    };
    watch(this.scene);
    for (const [, object] of this.byId) watch(object);
  }

  /** One re-index per commit burst: React's commit is synchronous, so a
   *  microtask runs after the WHOLE subtree is in the graph, however many
   *  `childadded` events the commit fired. */
  private scheduleStructureReindex(): void {
    if (this.disposed || this.structureReindexQueued) return;
    this.structureReindexQueued = true;
    queueMicrotask(() => {
      this.structureReindexQueued = false;
      if (this.disposed) return;
      this.indexGraph();
      // A late subtree can live in files the first source fetch never saw
      // (the fetch caches only files referenced by then-LIVE oids) — refetch
      // when any live oid is unindexed or its file uncached, so the new rows'
      // props/transforms are source-addressable rather than read-only.
      let needsSource = false;
      for (const oid of this.liveOids()) {
        const entry = this.oidIndex.get(oid);
        if (entry === undefined || !this.sources.has(entry.file)) {
          needsSource = true;
          break;
        }
      }
      if (needsSource) void this.refreshSourceState();
      this.syncAdoptedObjectMap();
      // `subscribe` on this adapter IS the store's subscribe, so notifying the
      // store is this adapter's own change signal — and it now reaches a
      // composite parent too, because `CompositeAuthoringAdapter` re-points its
      // child subscriptions when `replaceChild` swaps this adapter in (it used
      // to bind them once at subscribe time, which is why this line carried a
      // note about not being able to rely on the seam).
      this.store.shell.notifyIngestEdit();
    });
  }

  /** Keep `store.objectMap` (the raycast/gizmo index the store built when it
   *  adopted this scene) in step with a re-index — but only while this scene
   *  IS the store's active scene: once play adopts its own scene over the
   *  design session's, the live map belongs to play's adoption frame. */
  private syncAdoptedObjectMap(): void {
    if (this.store.scene !== this.scene) return;
    const map = this.store.objectMap;
    map.clear();
    for (const [id, object] of this.byId) map.set(id, object);
    // Structural re-indexing can remove the currently selected object (for
    // example an editor helper that an older build accidentally admitted).
    // Keep selection inside the same authoritative index the hierarchy,
    // picker, and gizmo now consume; otherwise TransformControls can remain
    // attached to a ghost id after the object has disappeared from every row.
    const retainedSelection = [...this.store.shell.selectedEntityIds].filter((id) => map.has(id));
    if (retainedSelection.length !== this.store.shell.selectedEntityIds.size) {
      this.store.shell.selectMultiple(retainedSelection);
    }
  }

  /** How many live objects the row's authored element renders as. `undefined`
   *  when the row has no source identity at all. */
  private liveInstanceCount(id: string): number | undefined {
    const oid = this.oidOf(id);
    return oid ? this.instanceRoots.get(oid) : undefined;
  }

  /**
   * THE `#n` AUTHORITY RULE — does this occurrence own the callsite it is
   * addressed by?
   *
   * `indexGraph` mints `…#1`, `…#2` whenever several live objects resolve to
   * ONE oid, and two very different things produce that collision:
   *
   *  - A REPEATED CALLSITE. `{spawns.map((s) => <Coin key={s.id} />)}` is one
   *    JSX element rendered 44 times; all 44 carry that callsite's stamp and
   *    all 44 render the SAME element of `Coin`'s definition. Each of them IS
   *    an instance of `<Coin/>`, so the callsite is genuinely its own address.
   *  - A DETACHED POCKET (#635). An interior element of a component that the
   *    runtime reparents out of its instance's subtree (Enemy's `Foregrip`,
   *    authored inside `<WeaponModel>`, ends up under the rifle) stops sharing
   *    its parent's stamp and therefore reads as an instance root too — but it
   *    renders a DIFFERENT element of the definition. The callsite describes
   *    the enemy, not it.
   *
   * The blanket `id.includes('#')` refusal this replaces could not tell them
   * apart, so it refused BOTH — every occurrence past the first was permanently
   * unwritable even when the write was exactly expressible, which is the
   * "instance-id write refusals" defect the one-resolver decision names. The
   * discriminator is structural and needs no source index:
   * {@link rendersSameSourceElement} against the representative occurrence.
   *
   * What a PERMITTED occurrence gets is only the right to be ASKED — the
   * callsite's own contract, literal/expression analysis and backend checks all
   * still run, and they still refuse in a sentence. The unit of edit is one JSX
   * element, so a literal prop written here moves every occurrence of it; that
   * is what the source says, and the row count is already on the inspector
   * (`liveInstanceCount`).
   */
  private borrowsRepresentativeCallsite(id: string): boolean {
    if (!isOccurrenceId(id)) return false;
    const object = this.byId.get(id);
    const oid = object ? authoringOidOf(object) : undefined;
    const representative = oid ? this.oidRepresentative.get(oid) : undefined;
    return !representative || !rendersSameSourceElement(object, representative);
  }

  /** W4e — rebind to a freshly remounted fiber scene. OID-keyed ids re-resolve
   *  onto the new objects; the echo/dynamic state resets (the new source and
   *  live tree are authoritative again). */
  adoptScene(scene: THREE.Scene): void {
    this.scene = scene;
    this.valueEcho.clear();
    this.dynamicPaths.clear();
    this.pendingDuplicateLabels.clear();
    this.pendingDuplicateCounts.clear();
    this.indexGraph();
    // One tick later: the design session's own remount selection restore runs
    // synchronously after this adoption (enterPlayScene clears, then restores
    // the at-write selection); applying after it lets the unchanged-guard
    // arbitrate — a mid-remount user click still wins.
    setTimeout(() => this.applyPendingCreatedSelection(), 0);
    void this.refreshSourceState();
  }

  /**
   * Paste/duplicate select WHAT THEY MADE. The new elements' ids are minted by
   * the remount (oids are content signatures), so the write records the
   * growing parent's child set and the fresh adoption selects the difference —
   * a human pasted a row of trees and had to move them one by one because the
   * ORIGINALS stayed selected ("the ones you pasted should come out with the
   * gizmo" — runhuman pass 51, their one requested fix). A selection the user
   * changed mid-remount wins, same contract as the remount handoff.
   */
  private pendingCreatedSelection: {
    parentId: string;
    before: ReadonlySet<string>;
    selectionAtWrite: ReadonlySet<string>;
    /** The element the new one was written right AFTER (a duplicate's
     *  source). Oids are content signatures with occurrence suffixes, so
     *  inserting a fourth `<JumpPad>` among three renumbers every sibling
     *  after it: the child-set DIFFERENCE then names the shifted LAST
     *  sibling, not the copy (measured 2/2: Ctrl+D on West Jump Pad selected
     *  Center Jump Pad). The copy is the child whose callsite comes next in
     *  the source after its original — that is what this resolves. */
    afterId?: string;
  } | null = null;

  private recordPendingCreatedSelection(parentId: string, afterId?: string): void {
    this.pendingCreatedSelection = {
      parentId,
      before: new Set(this.hierarchy.node(parentId)?.childIds ?? []),
      selectionAtWrite: new Set(this.store.shell.selectedEntityIds),
      ...(afterId ? { afterId } : {}),
    };
  }

  private applyPendingCreatedSelection(): void {
    const pending = this.pendingCreatedSelection;
    this.pendingCreatedSelection = null;
    if (!pending) return;
    const current = this.store.shell.selectedEntityIds;
    const unchanged =
      current.size === pending.selectionAtWrite.size &&
      [...current].every((id) => pending.selectionAtWrite.has(id));
    if (!unchanged) return;
    const children = this.hierarchy.node(pending.parentId)?.childIds ?? [];
    const copy = pending.afterId ? this.childWrittenAfter(children, pending.afterId) : null;
    if (copy) {
      this.store.shell.selectMultiple([copy]);
      return;
    }
    const fresh = children.filter((id) => !pending.before.has(id));
    if (fresh.length > 0) this.store.shell.selectMultiple(fresh);
  }

  /** Among `children`, the one whose callsite is the FIRST after `afterId`'s
   *  in the same file — the element a duplicate write placed there. */
  private childWrittenAfter(children: readonly string[], afterId: string): string | null {
    const origin = this.sourceLocation(afterId);
    if (!origin) return null;
    let best: { id: string; line: number; col: number } | null = null;
    for (const id of children) {
      if (id === afterId) continue;
      const at = this.sourceLocation(id);
      if (!at || at.file !== origin.file) continue;
      const after = at.line > origin.line || (at.line === origin.line && at.col > origin.col);
      if (!after) continue;
      if (!best || at.line < best.line || (at.line === best.line && at.col < best.col)) {
        best = { id, line: at.line, col: at.col };
      }
    }
    return best?.id ?? null;
  }

  /** Refetch the OID index + the source text of every file it references. */
  private async refreshSourceState(): Promise<void> {
    const backend = this.writeBackend;
    if (this.disposed || !backend?.index || !backend.readSource) return;
    const refreshId = ++this.sourceRefreshId;
    this.sourceRefreshPending = true;
    try {
      const idx = await backend.index();
      if (this.disposed || refreshId !== this.sourceRefreshId) return;
      const nextIndex = new Map(Object.entries(idx));
      const files = new Set<string>();
      for (const oid of this.liveOids()) {
        const entry = nextIndex.get(oid);
        if (entry) files.add(entry.file);
      }
      const next = new Map<string, string>();
      await Promise.all(
        [...files].map(async (file) => {
          const res = await backend.readSource!(file);
          next.set(file, res.source);
        }),
      );
      if (this.disposed || refreshId !== this.sourceRefreshId) return;
      // DOES THIS PROJECT HAVE THE REFLECTIONS CAPABILITY? Asked of the file
      // system, positively. Asking it by ATTEMPTING the read routes an
      // ordinary absence through the source backend's failure path, which
      // ANNOUNCES before it throws — so every project that simply never ran
      // `vgai add reflections` carried a permanent unresolved console error
      // about a file it is not supposed to have (runhuman pass 92, on the
      // strategy example). The catch swallowed the exception; it could not
      // swallow the report.
      const reflectionProbeAvailable = await getStorageBackend()
        .exists('src/lib/reflections/index.ts')
        .catch(() => false);
      if (this.disposed || refreshId !== this.sourceRefreshId) return;
      this.oidIndex = nextIndex;
      this.sources = next;
      this.reflectionProbeAvailable = reflectionProbeAvailable;
      this.store.shell.notifyIngestEdit();
    } catch {
      // Honest degradation: nodes stay live-projected (read-only) if the
      // index/source can't be fetched.
    } finally {
      if (refreshId === this.sourceRefreshId) this.sourceRefreshPending = false;
    }
  }

  private liveOids(): Set<string> {
    const oids = new Set<string>();
    for (const [, obj] of this.byId) {
      const oid = authoringOidOf(obj);
      if (oid !== undefined) oids.add(oid);
    }
    // Scene attachments are native Three resources rather than Object3Ds, so
    // they never enter `byId`. Fiber still stamps its editor-only `userData`
    // onto declarative `<color>`/`<fog>` resources; include those exact live
    // resources in the same source fetch instead of scanning unused project
    // code and guessing which environment declaration mounted.
    for (const resource of [this.scene.background, this.scene.environment, this.scene.fog]) {
      const oid = ownOidOf(stampedResource(resource));
      if (oid !== undefined) oids.add(oid);
    }
    return oids;
  }

  private oidOf(id: string): string | null {
    return authoringOidOf(this.byId.get(id)) ?? null;
  }

  /** The node's JSX attributes, analyzed from the CURRENT source text (null
   *  when the node isn't source-addressable or the source isn't cached yet). */
  private attrsOf(id: string): JsxAttrInfo[] | null {
    const oid = this.oidOf(id);
    if (!oid) return null;
    const entry = this.oidIndex.get(oid);
    if (!entry) return null;
    const src = this.sources.get(entry.file);
    if (src === undefined) return null;
    const start = lineColToOffset(src, entry.line, entry.col);
    if (src[start] !== '<') return null; // stale index vs source — refuse honestly
    const tagEnd = findTagEnd(src, start);
    if (tagEnd < 0) return null;
    return analyzeJsxAttributes(src, start, tagEnd);
  }

  sourceLocation(id: string): OidEntry | undefined {
    const oid = this.oidOf(id);
    return oid ? this.oidIndex.get(oid) : undefined;
  }

  /**
   * The DEFINITION-side entry for a component instance: where the component is
   * WRITTEN, as opposed to {@link sourceLocation}'s callsite (where it is USED).
   *
   * Both live in the same OID index; they are different entries reached through
   * different keys on the SAME object. `@volter/editor-react`'s `serving/ui-oid-plugin.ts`'s transform stamps a
   * host element inside a component definition with BOTH
   * `userData-oid="<this element, in the definition file>"` AND
   * `userData-authoringInstance={__vgaiOid}` (the callsite oid, passed in as a
   * prop). `oidOf` deliberately prefers the callsite — that is what makes an
   * instance select and write as one authoring object — so the definition entry
   * is only reachable by reading the raw `oid` key here.
   *
   * Honest `undefined` in every case where the second entry does not exist:
   * an id that resolves to no live object, an object that is not a component
   * boundary (no `authoringInstance` — its own oid IS its callsite, already
   * returned by `sourceLocation`), an unstamped runtime object, or an oid the
   * index has not resolved yet. Never a guess, and never the callsite entry
   * wearing the definition's name.
   */
  definitionLocation(id: string): OidEntry | undefined {
    const own = this.definitionOid(id);
    return own ? this.oidIndex.get(own) : undefined;
  }

  /** Portable CSF is associated with the source component, never inferred
   * from a mesh or scene placement. Prefer the definition-side source path so
   * same-named components in different folders remain unambiguous. */
  private storyComponent(id: string): { name: string; sourcePath?: string } | null {
    const node = this.hierarchy.node(id);
    if (node?.role !== 'component') return null;
    const definition = this.definitionLocation(id);
    const callsite = this.sourceLocation(id);
    const name = definition?.component ?? callsite?.tag ?? node.typeLabel ?? node.label;
    return definition?.file ? { name, sourcePath: definition.file } : { name };
  }

  /** The raw definition-side oid behind {@link definitionLocation} — the key
   *  H7's fork sends to the server, which needs the OID itself rather than the
   *  index entry it resolves to. */
  private definitionOid(id: string): string | null {
    const object = this.byId.get(id);
    // An instance ROOT only: an interior host element of a component has a
    // stamp but is not a boundary, and its own oid IS its address (`oidOf`
    // returns it), so calling that a "definition" would make the two oids the
    // same one wearing two names — and offer Fork Component on a row that is
    // not an instance.
    if (!object || !isComponentInstanceRoot(object)) return null;
    const instance = instanceStampOf(object);
    const own = ownOidOf(object);
    if (own === undefined || own === instance) return null;
    return own;
  }

  /**
   * Whether "Fork Component…" is REACHABLE for this row: the session has a
   * backend that can create a file, and the row resolves both of H3's oids (the
   * callsite to retarget, the definition to copy). Never a claim that the fork
   * would SUCCEED — only the server's plan can say that, and it says it in a
   * sentence.
   */
  canForkComponent(id: string): boolean {
    if (typeof this.writeBackend?.forkComponent !== 'function') return false;
    return !!this.oidOf(id) && !!this.definitionOid(id);
  }

  /**
   * H7 — copy this instance's component to a renamed sibling module and
   * retarget THIS callsite at the copy. Returns the sentence to show; like H3's
   * actions, every path returns one, because a silent refusal is the failure
   * mode this whole decision exists to kill.
   *
   * Two writes, deliberately asymmetric (see the backend seam's own comment):
   * the server creates the new file — nothing on the client seam can create a
   * path — and the CALLSITE edit comes back unwritten so it goes through
   * project history exactly like every other source write. Undo therefore
   * restores the callsite and leaves the copy, which is why the success hint
   * names the file it created.
   */
  async forkComponent(id: string): Promise<string> {
    const callsite = this.sourceLocation(id);
    const oid = this.oidOf(id);
    const definitionOid = this.definitionOid(id);
    const tag = callsite?.tag ?? 'component';
    if (!oid || !definitionOid || !callsite) return forkUnavailableHint(tag);
    const backend = this.writeBackend;
    const history = this.store.shell.projectHistory;
    if (!backend?.forkComponent || !backend.readSource || !backend.applySource || !history) {
      return forkNoBackendHint(tag);
    }

    let response: Awaited<ReturnType<NonNullable<SourceWriteBackend['forkComponent']>>>;
    try {
      response = await backend.forkComponent(oid, definitionOid, this.forkNameSeed(id));
    } catch (error) {
      return forkRefusedHint(errorText(error));
    }
    const { newName, newResourcePath, callsiteFile, callsiteNewSource } = response;
    if (!response.ok || !newName || !newResourcePath || !callsiteFile || !callsiteNewSource) {
      return forkRefusedHint(response.error ?? 'the fork was refused without a reason.');
    }

    try {
      await replaceProjectSource(backend, history, {
        file: callsiteFile,
        source: callsiteNewSource,
        label: response.label ?? `Fork ${tag} → ${newName}`,
      });
    } catch (error) {
      // The new file is already on disk and nothing imports it. Say exactly
      // that rather than pretending the fork failed cleanly.
      return forkPartialHint(tag, newName, newResourcePath, errorText(error));
    }
    await this.refreshSourceState();
    return forkedHint(response.tag ?? tag, newName, newResourcePath);
  }

  /** The fork's preferred name: the instance's authored `name` prop, falling
   *  back to the live object's name. Only a SEED — the server decides, and
   *  falls back to `<Tag>Fork` when this one is unusable or taken. */
  private forkNameSeed(id: string): string | undefined {
    const authored = this.attrsOf(id)?.find((attr) => attr.name === 'name');
    if (authored?.isLiteral && authored.rawValue) return authored.rawValue;
    return this.byId.get(id)?.name || undefined;
  }

  /** The extract seam is reachable for this row: a write backend that can
   *  create files, and a source element to extract. The PLAN's own refusals
   *  (capture, module-local reference, collision) are click-time sentences. */
  canExtractComponent(id: string): boolean {
    return Boolean(this.oidOf(id) && this.writeBackend?.extractComponent);
  }

  /**
   * P1 "Extract Component…" — the fork's complement for a NATIVE subtree: the
   * server (`plan-extract-component.ts` behind
   * `/__ui-source/extract-component`) writes the new component module and its
   * portable CSF story under `src/prefabs/`, and hands back the CALLSITE edit
   * unwritten; that half goes through project history exactly like every
   * other source write. Undo therefore restores the callsite and leaves both
   * new files, which is why the success hint names them.
   */
  async extractComponent(id: string, name?: string): Promise<string> {
    const callsite = this.sourceLocation(id);
    const oid = this.oidOf(id);
    const tag = callsite?.tag ?? 'element';
    if (!oid || !callsite) return extractUnavailableHint(tag);
    const backend = this.writeBackend;
    const history = this.store.shell.projectHistory;
    if (!backend?.extractComponent || !backend.readSource || !backend.applySource || !history) {
      return extractNoBackendHint(tag);
    }

    let response: Awaited<ReturnType<NonNullable<SourceWriteBackend['extractComponent']>>>;
    try {
      response = await backend.extractComponent(oid, name ?? this.forkNameSeed(id));
    } catch (error) {
      return extractRefusedHint(errorText(error));
    }
    const { newName, componentResourcePath, storyResourcePath, callsiteFile, callsiteNewSource } =
      response;
    if (
      !response.ok ||
      !newName ||
      !componentResourcePath ||
      !storyResourcePath ||
      !callsiteFile ||
      !callsiteNewSource
    ) {
      return extractRefusedHint(response.error ?? 'the extraction was refused without a reason.');
    }

    try {
      await replaceProjectSource(backend, history, {
        file: callsiteFile,
        source: callsiteNewSource,
        label: response.label ?? `Extract ${newName}`,
      });
    } catch (error) {
      // The new files are already on disk and nothing imports them. Say
      // exactly that rather than pretending the extraction failed cleanly.
      return extractPartialHint(tag, newName, componentResourcePath, errorText(error));
    }
    await this.refreshSourceState();
    return extractedHint(response.tag ?? tag, newName, componentResourcePath, storyResourcePath);
  }

  /**
   * Every R3F authorability warning that pertains to one row, in the adapter's
   * own vocabulary. Empty (never `undefined`) when there is nothing to say, so
   * the caller has one shape to handle.
   *
   * The row's TWO index entries answer between them, and it takes both: the
   * callsite entry carries what is wrong AT this instance's tag (R3F004, "has
   * no name"), while the definition-root entry carries what is wrong with the
   * COMPONENT it instantiates (R3F002's "does not forward position to its
   * root" — the enemy-movability mystery this whole decision started from).
   * These are the same two entries H3's
   * {@link sourceLocation}/{@link definitionLocation} return, so no new
   * identity machinery exists here; the server did the file-level join when it
   * built the index (`fileDiagnosticJoin`) and this only unions and dedupes.
   *
   * A DETACHED `#n` pocket (#635) is excluded from the callsite half for the
   * same reason `objectNode` withholds its `typeLabel`: the callsite belongs to
   * the instance's representative row, and a pocket echoing "`<Enemy>` has no
   * name" would be a second badge claiming to be that instance. The definition
   * half needs no such guard — a pocket's own entry is an INTERNAL element, and
   * the server's join deliberately lands component-scope diagnostics on the
   * definition ROOT only.
   *
   * Both are `undefined` until `refreshSourceState()` lands, which is the same
   * honest "not known yet" every other source-derived answer on this adapter
   * gives before its first index fetch.
   */
  diagnosticsFor(id: string): readonly R3fAuthoringDiagnostic[] {
    const callsite = this.borrowsRepresentativeCallsite(id) ? undefined : this.sourceLocation(id);
    return mergeRowDiagnostics(callsite, this.definitionLocation(id));
  }

  /**
   * The live children of `id` that {@link projectedChildren} deliberately HIDES:
   * this instance's own host nodes and its unstamped model internals (bones,
   * GLTF meshes). Together with {@link hasInternals} this is the whole adapter
   * side of "reveal internals"; there is no new identity here, because
   * `indexGraph` already minted an id for every one of these objects (`…#n` for
   * a same-instance host node, `@i.j.k` for an unstamped one).
   *
   * The rule is the SAME one `projectedChildren` applies at the raw-child level,
   * inverted: a child whose selection owner is this row's owner belongs to this
   * component's own output and is hidden (→ internal); a child that resolves to
   * a DIFFERENT owner is a nested instance and is already surfaced as a real
   * child (→ excluded here, so the reveal can never double-list it). An
   * unowned child — nothing stamped anywhere above it — is internal too, which
   * is the ordinary case for a `<primitive>`'d GLTF scene.
   *
   * Cheap by construction: one owner resolution per RAW child (O(depth)), never
   * the subtree walk `projectedChildren` performs, because the objects a reveal
   * shows are exactly the ones that walk descends THROUGH.
   *
   * `parentId` is overridden to `id` — the raw parent — rather than left as
   * `objectNode`'s projected parent (which climbs to the owning instance).
   * A revealed subtree is displayed as the tree it literally is, so its rows
   * must say so; the projected answer would make every bone in a rig claim the
   * enemy as its parent.
   *
   * Editor helpers (`editorHelper`/`engineInternal`) stay invisible even here —
   * they never entered `indexGraph`, so they have no id to show and the explicit
   * guard below is the second, independent net.
   */
  internalChildren(id: string): EditorNode[] | undefined {
    if (this.options.hierarchyMode === 'definition') return undefined;
    const object = this.byId.get(id);
    if (!object) return undefined;
    return this.internalChildObjects(object).map((child) => ({
      ...this.objectNode(child),
      parentId: id,
    }));
  }

  /** H6 — does revealing `id` show anything? Same walk as
   *  {@link internalChildren} without building the nodes, so the hierarchy can
   *  offer the action only where it does something. */
  hasInternals(id: string): boolean {
    if (this.options.hierarchyMode === 'definition') return false;
    const object = this.byId.get(id);
    return object ? this.internalChildObjects(object).length > 0 : false;
  }

  private internalChildObjects(object: THREE.Object3D): THREE.Object3D[] {
    // The complement of {@link projectedChildren}, over the SAME predicate: a
    // raw child that is a row is already surfaced there (never double-list it),
    // and everything else this instance renders is internal. Written as the
    // complement rather than as a second owner comparison, because a second
    // comparison is exactly what let the two hierarchy walks drift apart. It
    // also closes a latent double-list: a stamped native inside the transparent
    // top-level instance shares its parent's owner, so it used to count as
    // internal while already being a row.
    return object.children.filter(
      (child) => this.idByObject.has(child) && !this.isProjectedRow(child),
    );
  }

  // -------------------------------------------------------------- hierarchy

  private objectNode(object: THREE.Object3D): EditorNode {
    const id = this.idByObject.get(object)!;
    const parentId = this.projectedParentId(object);
    const detached = this.borrowsRepresentativeCallsite(id);
    const componentBoundary = this.isComponentBoundary(object) && !detached;
    // A detached pocket is named by the object itself, and typed by nothing: the
    // callsite tag belongs to the instance's representative row, so printing it
    // here would claim this object IS the `<Enemy>` its owner rendered.
    const sourceTag = detached ? undefined : this.oidEntryOf(object)?.tag;
    return {
      id,
      label: componentBoundary
        ? getUserData(object, 'authoringLabel') || object.name || sourceTag || 'Component'
        : object.name || object.type || 'Object3D',
      role: componentBoundary ? 'component' : 'entity',
      kind: nativeKindOf(this.transformObject(id) ?? object),
      // An `<Enemy>` renders a `group`, but "group" describes how it is built,
      // not what it is. Name the component in the inspector header, the way
      // Godot names the class there. AT THE BOUNDARY ONLY: an interior host
      // element of that component is not an `<Enemy>`, and suffixing it with
      // the component's tag claims it is.
      ...(componentBoundary && sourceTag && /^[A-Z]/.test(sourceTag)
        ? { typeLabel: sourceTag }
        : {}),
      parentId,
      childIds: this.projector.childIdsOf(this.projectedChildren(object)),
    };
  }

  /**
   * The instance's ROOT, not merely a node that belongs to it — every host
   * element inside a component definition carries the instance stamp, so the
   * bare stamp made `objectNode` print the component's label and `component`
   * role on all of `Stage`'s interior nodes at once. See
   * `component-instance-root.ts`.
   *
   * `componentOwnerChain` is unaffected: it climbs to the first boundary and
   * then to the highest ancestor sharing that instance, and the node this now
   * skips is precisely one of those ancestors.
   */
  private isComponentBoundary(object: THREE.Object3D): boolean {
    // `authoringRoot` is the generic opt-out for a project-local component that constructs the
    // native authoring ENTITY itself. Import runtimes use that shape for one source GameObject;
    // treating the constructor tag as a reusable component boundary labels every row after the
    // runtime (`UnityNode`, etc.) and folds the authored hierarchy. Explicit prefab identity is
    // applied later by the hierarchy-mark projection and therefore remains a component boundary.
    return isComponentInstanceRoot(object) && getUserData(object, 'authoringRoot') !== true;
  }

  /** First concrete Object3D rendered by an editor-injected component
   * boundary. A boundary group carries authoring identity/config, but is not
   * itself the component's spatial transform. */
  private spatialTargetOf(boundary: THREE.Object3D): THREE.Object3D | null {
    return boundary;
  }

  /** Native manipulation/preview object for an authoring identity. */
  private transformObject(id: string): THREE.Object3D | null {
    const object = this.byId.get(id);
    if (!object) return null;
    return this.isComponentBoundary(object) ? this.spatialTargetOf(object) : object;
  }

  private oidEntryOf(object: THREE.Object3D): OidEntry | undefined {
    const id = this.idByObject.get(object);
    return id ? this.sourceLocation(id) : undefined;
  }

  /** Source component-instance owners from outermost to innermost for one
   * render hit. This is the adapter-owned boundary chain used by ordinary,
   * scoped, and one-shot deep selection. */
  private componentOwnerChain(raw: THREE.Object3D): THREE.Object3D[] {
    const innerToOuter: THREE.Object3D[] = [];
    let cursor: THREE.Object3D | null = raw;
    while (cursor && cursor !== this.scene) {
      while (cursor && cursor !== this.scene && !this.isComponentBoundary(cursor)) {
        cursor = cursor.parent;
      }
      if (!cursor || cursor === this.scene) break;
      const instance = instanceStampOf(cursor);
      let owner: THREE.Object3D = cursor;
      while (
        owner.parent &&
        owner.parent !== this.scene &&
        instanceStampOf(owner.parent) === instance
      ) {
        owner = owner.parent;
      }
      innerToOuter.push(owner);
      cursor = owner.parent;
    }
    return innerToOuter.reverse();
  }

  /** Resolve a render part to the highest host Object3D produced by the same
   * React component. Unstamped GLTF/bone internals climb to the nearest stamped
   * owner; a different component name starts a nested instance boundary. */
  private selectionOwnerObject(
    raw: THREE.Object3D,
    /** The owner chain, when the caller already walked it — {@link
     *  isProjectedRow} needs its LENGTH as well (that is
     *  {@link insideTransparentTopLevel}) and would otherwise walk it twice. */
    chain: readonly THREE.Object3D[] = this.componentOwnerChain(raw),
  ): THREE.Object3D | null {
    // A propagated callsite identity always wins over component-definition
    // heuristics. Resolve to the highest existing Object3D carrying the same
    // instance OID; a nested component has a different OID and remains its own
    // selectable instance. No scene-graph wrapper is involved.
    return chain.at(-1) ?? this.stampedOwnerObject(raw);
  }

  /** The nearest STAMPED owner of a render part, ignoring component-instance
   *  boundaries entirely: climb to the first object carrying an OID and stop.
   *  This is what answers when no instance boundary applies — either because
   *  there is none, or because every one that exists is transparent
   *  ({@link selection}'s `resolve`).
   *
   *  It used to keep climbing to the highest consecutive ancestor the SAME
   *  source component authored. Under top-level transparency every stamped
   *  native is a hierarchy row of its own, so that climb only ever merged
   *  rows: clicking "Sun" selected "Environment" (runhuman pass 48), a
   *  grouped instance selected its Group. A stamped element is an authored
   *  entity; the row and the click must name the same thing. */
  private stampedOwnerObject(raw: THREE.Object3D): THREE.Object3D | null {
    let object: THREE.Object3D | undefined = raw;
    while (
      object &&
      object !== this.scene &&
      this.oidOf(this.idByObject.get(object) ?? '') === null
    ) {
      object = object.parent ?? undefined;
    }
    if (!object || object === this.scene) return null;
    return object;
  }

  /** Direct semantic children of one component boundary. Same-component host
   * nodes and unstamped model internals are traversed but not surfaced. */
  /**
   * TOP-LEVEL COMPONENT TRANSPARENCY, for the hierarchy. `selection.resolve`
   * records why the outermost instance is transparent to a click: it is the
   * world's own composition, not a unit chosen for reuse. The hierarchy has
   * to agree, or the tree shows a sealed unit whose parts the viewport
   * selects and whose file the "+" menu writes into (a human tester added a
   * mesh to the scene and could not find it anywhere). So a SOURCE-STAMPED
   * native inside the top-level instance — a light, a group, a mesh authored
   * in the scene's own file — is a row of its own; a nested component
   * instance stays a folded unit, exactly as a click treats it.
   */
  private insideTransparentTopLevel(object: THREE.Object3D): boolean {
    return this.componentOwnerChain(object).length === 1;
  }

  /**
   * **THE ONE RULE OF THE PROJECTED TREE — is this live object a ROW?**
   *
   * Both walks derive from this and from nothing else:
   * {@link projectedChildren} surfaces a descendant exactly when it answers
   * true (and stops descending there), and {@link projectedParentId} climbs to
   * the first ancestor that answers true. Reciprocity is therefore structural:
   * a node's listed children are the rows whose nearest row-ancestor it is,
   * and every one of those rows climbs back to it.
   *
   * Ruled 2026-09-19, after the defect this replaced. The two derivations used
   * to be written separately and disagreed by construction: `projectedChildren`
   * compared each child's selection owner against the LISTING node's owner,
   * while `projectedParentId` compared the PARENT's owner against the CHILD's
   * own id — so on the game template a `<DaylightSky/>` written inside
   * `<group name="Environment">` was listed in `Environment`'s `childIds` and
   * answered `parentId` with the scene component's own root. The panel renders
   * top-down from `childIds` and looked right; everything that walks UPWARD
   * (reparent targets, paste anchors, `isPickLocked`,
   * `structureClipboardPayload`'s top-level filter) resolved against a tree the
   * panel was not showing.
   *
   * Three ways to be a row, in the order the walk applies them:
   *  1. an AUTHORED CAMERA — surfaced wherever it sits, because a camera the
   *     game authored is a subject even inside a folded instance;
   *  2. an object that is its OWN selection owner — a component instance root,
   *     or, where no instance boundary applies at all, the nearest stamped
   *     object;
   *  3. a SOURCE-STAMPED native inside the transparent top-level instance —
   *     see {@link insideTransparentTopLevel} for why that instance's own
   *     parts are rows and a nested instance's parts are not.
   *
   * `selectionOwnerObject` is idempotent — an owner is either a component
   * boundary, which owns itself, or a stamped ancestor, which owns itself — so
   * rule 2 picks out exactly the objects the old owner comparison surfaced.
   */
  private isProjectedRow(object: THREE.Object3D): boolean {
    if (object === this.scene) return false;
    if (isEditorOwnedObject(object)) return false;
    const id = this.idByObject.get(object);
    if (id === undefined) return false;
    if (isAuthoredCamera(object)) return true;
    // ONE owner chain per test: `insideTransparentTopLevel` is its length.
    const chain = this.componentOwnerChain(object);
    if (this.selectionOwnerObject(object, chain) === object) return true;
    return chain.length === 1 && this.oidOf(id) !== null;
  }

  private projectedChildren(object: THREE.Object3D | THREE.Scene): THREE.Object3D[] {
    const result: THREE.Object3D[] = [];
    const seen = new Set<THREE.Object3D>();
    const visit = (child: THREE.Object3D): void => {
      if (isEditorOwnedObject(child)) return;
      if (this.isProjectedRow(child)) {
        if (!seen.has(child)) {
          seen.add(child);
          result.push(child);
        }
        return;
      }
      for (const descendant of child.children) visit(descendant);
    };
    for (const child of object.children) visit(child);
    return result;
  }

  /**
   * The row `object` hangs under — the inverse of {@link projectedChildren}
   * over {@link isProjectedRow}, so the two cannot disagree.
   *
   * A row reports the nearest row ABOVE it. An object that is not a row (an
   * interior host node of an instance, an unstamped model internal) reports the
   * first row at or above it, which is the instance it is part of —
   * `hierarchy.node()` answers for those ids too, and a bone claiming its
   * instance is the right answer there. {@link internalChildren} overrides
   * `parentId` to the RAW parent for a REVEALED subtree, for the reason
   * recorded at that method.
   */
  private projectedParentId(object: THREE.Object3D): string {
    let cursor: THREE.Object3D | null = object.parent;
    while (cursor && cursor !== this.scene) {
      if (this.isProjectedRow(cursor)) return this.idByObject.get(cursor)!;
      cursor = cursor.parent;
    }
    return this.documentNodeId;
  }

  /** The id a selection of `rawId` normalizes to — the same TOP-LEVEL
   *  TRANSPARENCY rule {@link selection}'s `resolve` applies (see there), so
   *  writing back what a click resolved cannot climb it straight out again.
   *  Deliberately NOT `selectionOwnerObject`, which the hierarchy PROJECTION
   *  uses and whose collapse-to-the-outermost-instance answer is what a tree
   *  of rows needs. */
  private selectionOwnerId(rawId: string): string | null {
    const object = this.byId.get(rawId);
    if (!object) return null;
    if (isAuthoredCamera(object)) return rawId;
    const chain = this.componentOwnerChain(object);
    const owner = chain.slice(1).at(-1) ?? this.stampedOwnerObject(object);
    return owner ? (this.idByObject.get(owner) ?? null) : null;
  }

  readonly hierarchy: HierarchyProvider = {
    roots: () => [this.hierarchy.node(this.documentNodeId)!],
    node: (id) => {
      if (id === this.documentNodeId) {
        return {
          id,
          label: this.options.worldId,
          secondaryLabel: this.options.entryPath,
          role: 'document',
          kind: 'three-source',
          parentId: null,
          childIds:
            this.options.hierarchyMode === 'definition'
              ? this.definitionView.rootIds()
              : this.projector.childIdsOf(this.projectedChildren(this.scene)),
        };
      }
      const object = this.byId.get(id);
      return object
        ? this.options.hierarchyMode === 'definition'
          ? this.definitionView.node(object)
          : this.objectNode(object)
        : null;
    },
    object3D: (id) => {
      return this.transformObject(id);
    },
    idForObject3D: (object: THREE.Object3D) => this.idByObject.get(object) ?? null,
  };

  /** The same OID source address every guarded JSX write uses, exposed for
   * Inspector reveal/navigation rather than copied into a second index. */
  readonly truth: TruthProvider = {
    resolve: (id): { site: NodeCreationSite; writeAnchorKind: WriteAnchorKind | undefined } => {
      const oid = this.oidOf(id);
      if (!oid) {
        return {
          site: {
            anchored: false,
            reason:
              id === this.documentNodeId
                ? 'The World document is a composition, not a source element.'
                : 'This rendered object has no authored source identity.',
          },
          writeAnchorKind: this.transformWriteAnchorKind(id),
        };
      }
      const entry = this.oidIndex.get(oid);
      if (!entry) {
        return {
          site: { anchored: false, reason: 'Source metadata is still loading or unavailable.' },
          writeAnchorKind: this.transformWriteAnchorKind(id),
        };
      }
      const file = this.projectRelativeSourceFile(entry.file);
      return {
        site: {
          anchored: true,
          kind: 'source',
          file,
          line: entry.line,
          col: entry.col,
          display: `${file}:${entry.line}`,
        },
        writeAnchorKind: this.transformWriteAnchorKind(id),
      };
    },
  };

  /**
   * WHICH LANE an edit to this node's transform would travel — the write-side
   * half of the plan {@link pipedTransformCommit} resolves, read from the same
   * three facts that resolution reads and in the same order.
   *
   * NOT A SECOND CLASSIFIER, which is the whole point. `write-pipe.ts` states
   * the invariant plainly: the kind a caller READS must be the kind the write
   * actually takes, because the measured defect it was built for was exactly
   * those two coming apart. So this answers from `writeBackend` (is a dialect
   * writer bound at all — the same question `pipedTransformCommit`'s resolution
   * asks), from the node's own OID (the address `commitTransformEdit` sends),
   * and from the served source index's body binding — never from the anchor's
   * shape, which cannot tell a body-placed callsite from an ordinary prop.
   *
   * `undefined` — never `live-only` — for an id no live object of this world
   * owns (the document node, a synthetic row): this adapter plans no write for
   * it at all, which is a different fact from a lane that really does land on a
   * running object.
   *
   * WHY `position` DECIDES IT. The kind is a property of the node's transform,
   * and a body that owns a node's placement owns all three channels of it
   * (`r3f-physics-binding.ts` — the body re-composes the whole matrix, scale
   * included). `position` is therefore the representative channel, the same one
   * the live lane's classifier reads.
   */
  private transformWriteAnchorKind(id: string): WriteAnchorKind | undefined {
    if (!this.byId.has(id)) return undefined;
    const oid = this.oidOf(id);
    // No address, or no writer bound this session: the edit lands on the
    // running object and nowhere else, and saying so is the contract of that
    // kind.
    if (!oid || !this.writeBackend?.writeProp) return 'live-only';
    // A stamped node whose oid the client index has not resolved still WRITES —
    // `commitTransformEdit` sends the oid and the server resolves it — so a
    // missing index entry is a missing ADDRESS, never a different lane.
    if (bodyPlacedChannel(this.oidIndex.get(oid), 'position')) return 'physics-binding';
    return 'source-prop';
  }

  /** B4/D12 — the composite's layered pick walk reaches the Three
   *  child THROUGH this provider (the projector's raycast, over
   *  `store.objectMap` for this lane — see the `pickScope` note in the
   *  constructor). Without it a viewport click never selects an R3F node. */
  readonly pickable: PickProvider = {
    pick: (clientX, clientY) =>
      this.projector.pick(this.store, clientX, clientY, (id) => this.isPickLocked(id)),
    candidates: (clientX, clientY) =>
      this.projector.candidates(this.store, clientX, clientY, (id) => this.isPickLocked(id)),
  };

  private isPickLocked(id: string): boolean {
    let current: string | null = id;
    let guard = 0;
    while (current && guard++ < 1000) {
      if (this.lockedIds.has(current)) return true;
      current = this.hierarchy.node(current)?.parentId ?? null;
    }
    return false;
  }

  // -------------------------------------------------------------- selection

  readonly selection: SelectionProvider = {
    get: () => this.selectionState.current(),
    set: (ids, options) =>
      this.selectionState.publish(
        ids
          .map((id) =>
            this.options.hierarchyMode === 'definition' ||
            options?.intent === 'exact' ||
            id === this.documentNodeId
              ? id
              : (this.selectionOwnerId(id) ?? id),
          )
          // The World document row is selectable and is not one of this
          // world's objects, so it survives here and never reaches the store.
          .filter((id) => id === this.documentNodeId || this.byId.has(id)),
      ),
    /**
     * What a click at this render part selects.
     *
     * ## TOP-LEVEL COMPONENT TRANSPARENCY
     *
     * Instance-first resolution — a click selects the whole instance, and you
     * ENTER it to reach its parts — is Figma's semantics and is right for
     * NESTED instances. It is wrong for the OUTERMOST one, for the same reason
     * Figma does not make you enter a top-level frame: that instance is the
     * world's own composition, not a unit you chose to reuse. Measured live
     * (2026-08-06): the starter rendered its entire scene as one `<BlankStage>`,
     * so every click in a fresh project answered "Blank Stage" and a new user
     * could not click-select the Hero Box at all; the shooter arena had the
     * same shape one level up.
     *
     * So resolution STARTS one level in (`base = 1`). Everything below that is
     * unchanged: a nested instance still selects as a unit, an open scope still
     * resolves just inside itself, and the deep chord still takes one more
     * step. When the chain runs out — a transparent top-level instance with no
     * nested instance under the pointer — the answer is the stamped object
     * itself, which is exactly "the next thing in".
     *
     * The whole instance remains selectable from the hierarchy, and
     * `selectionOwnerId` applies the same rule so writing this answer back does
     * not climb straight out of it.
     */
    resolve: (rawId, options) => {
      const raw = this.byId.get(rawId);
      if (!raw) return null;
      if (this.options.hierarchyMode === 'definition') return { id: rawId };
      if (isAuthoredCamera(raw)) return { id: rawId };
      const chain = this.componentOwnerChain(raw);
      const scopeIndex = options?.scopeId
        ? chain.findIndex((candidate) => this.idByObject.get(candidate) === options.scopeId)
        : -1;
      // Just inside the open scope, or — with none open — one level in anyway.
      const base = scopeIndex >= 0 ? scopeIndex + 1 : 1;
      const index = options?.intent === 'deep' ? base + 1 : base;
      // `?? chain[base]` keeps DEEP monotone: past the end of the chain the
      // stamped fallback can climb OUT of an instance whose parts carry no oid
      // of their own (measured: a bare `<mesh>` inside the arena answered
      // "CitadelArena" for deep and "Mesh" for normal), and a one-shot
      // go-deeper chord must never resolve shallower than the plain click.
      const owner = chain[index] ?? chain[base] ?? this.stampedOwnerObject(raw);
      const id = owner ? (this.idByObject.get(owner) ?? null) : null;
      return id ? { id } : null;
    },
  };

  /** A project may declare which project-tool document owns an ordinary scene
   * instance. The native node carries the generic reference; this adapter only
   * resolves the document verb. No asset-domain vocabulary enters the shell. */
  readonly related: RelatedSubjectsProvider = {
    links: (id) => {
      const reference = getUserData(this.byId.get(id), 'authoringDocument');
      if (!reference || reference.kind !== 'project-tool') return [];
      return [
        {
          // `definition:` marks this as the subject's OPEN-FOR-EDIT target (the
          // owning project-tool document), so the inspector surfaces it as the
          // labeled Edit button by kind, never by list position.
          id: `definition:project-tool:${reference.name}`,
          title: reference.title,
          open: () => {
            openProjectToolDocument(reference.name);
          },
        },
      ];
    },
  };

  private instanceProp(
    id: string,
    path: string,
  ): {
    readonly prop: string;
    readonly spec: ComponentPropSpec;
    readonly attr: JsxAttrInfo;
  } | null {
    if (!path.startsWith(JSX_PATH_PREFIX)) return null;
    const prop = path.slice(JSX_PATH_PREFIX.length);
    const spec = this.declaredPropsOf(id).find((candidate) => candidate.name === prop);
    const attr = this.attrsOf(id)?.find((candidate) => candidate.name === prop);
    return spec && attr ? { prop, spec, attr } : null;
  }

  private affectedInstances(id: string, prop: string): number {
    const selected = this.definitionLocation(id);
    if (!selected) return 0;
    let count = 0;
    for (const [candidateId, object] of this.byId) {
      if (!isComponentInstanceRoot(object)) continue;
      const definition = this.definitionLocation(candidateId);
      if (
        definition?.file !== selected.file ||
        definition.component !== selected.component ||
        this.attrsOf(candidateId)?.some((attr) => attr.name === prop)
      ) {
        continue;
      }
      count += 1;
    }
    // The selected instance loses its override in the same transaction and
    // therefore joins the instances inheriting the new default.
    return count + 1;
  }

  /** Explicit portable-CSF prefab instances only. This is a source diff over
   * the existing Inspector rows, not a second property or persistence model. */
  readonly instances: ComponentInstancesProvider = {
    openComponent: () => {
      void activateWorkspaceDocument(THREE_COMPONENTS_DOCUMENT_ID);
    },
    describe: (id) => {
      const component = this.storyComponent(id);
      if (!component || this.stories.storiesFor(id).length === 0) return null;
      const overrides = this.inspector
        .properties(id)
        .filter((property) => property.resettable && property.path.startsWith(JSX_PATH_PREFIX))
        .map((property) => {
          const source = this.instanceProp(id, property.path);
          const canApplyToComponent =
            !!source?.attr.isLiteral &&
            source.spec.defaultValue !== undefined &&
            !!this.definitionOid(id) &&
            !!this.writeBackend?.runGesture &&
            !!this.writeBackend.writeComponentDefault &&
            !!this.writeBackend.removeProp;
          return {
            path: property.path,
            label: property.label,
            value: this.inspector.get(id, property.path),
            ...(property.revertsTo === undefined ? {} : { defaultText: property.revertsTo }),
            canApplyToComponent,
            affectedInstanceCount: source ? this.affectedInstances(id, source.prop) : 0,
            ...(canApplyToComponent
              ? {}
              : {
                  applyUnavailableReason:
                    source?.spec.defaultValue === undefined
                      ? 'The component default is computed or absent, so source cannot be changed safely.'
                      : 'This session cannot atomically update the component and its callsite.',
                }),
          };
        });
      return {
        componentName: component.name,
        ...(component.sourcePath
          ? { sourcePath: this.projectRelativeSourceFile(component.sourcePath) }
          : {}),
        overrides,
      };
    },
    revert: async (id, paths) => {
      const oid = this.oidOf(id);
      const backend = this.writeBackend;
      if (!oid || !backend?.removeProp) return;
      const props = paths
        .map((path) => this.instanceProp(id, path)?.prop)
        .filter((prop): prop is string => !!prop);
      let changed = false;
      const run = async (selected: SourceWriteBackend): Promise<void> => {
        for (const prop of props) {
          const result = await selected.removeProp?.(oid, prop);
          changed ||= result?.changed === true;
        }
      };
      if (props.length > 1 && backend.runGesture) {
        await backend.runGesture(`Revert ${props.length} Overrides`, run);
      } else {
        await run(backend);
      }
      await this.refreshSourceState();
      return changed ? { destination: this.destinationOf(id), persisted: true } : undefined;
    },
    applyToComponent: async (id, path): Promise<ComponentInstanceApplyResult> => {
      const source = this.instanceProp(id, path);
      const definitionOid = this.definitionOid(id);
      const callsiteOid = this.oidOf(id);
      const backend = this.writeBackend;
      if (
        !source ||
        source.spec.defaultValue === undefined ||
        !definitionOid ||
        !callsiteOid ||
        !backend?.runGesture ||
        !backend.writeComponentDefault ||
        !backend.removeProp
      ) {
        return {
          changed: false,
          message: 'Apply was refused because both literal source writes are not available.',
        };
      }
      const value = this.inspector.get(id, path);
      await backend.runGesture(
        `Apply ${source.prop} to ${this.storyComponent(id)?.name ?? 'Component'}`,
        async (scoped) => {
          const applied = await scoped.writeComponentDefault?.(
            definitionOid,
            source.prop,
            this.serializeValue(value),
          );
          if (!applied?.changed)
            throw new Error(applied?.error ?? 'The component default did not change.');
          const reverted = await scoped.removeProp?.(callsiteOid, source.prop);
          if (!reverted?.changed)
            throw new Error(reverted?.error ?? 'The callsite override was not removed.');
        },
      );
      await this.refreshSourceState();
      return {
        changed: true,
        message: `${source.prop} now defaults to ${String(value)} in ${this.storyComponent(id)?.name ?? 'the component'}.`,
        write: { destination: this.destinationOf(id), persisted: true },
      };
    },
  };

  // -------------------------------------------------------------- transforms

  readonly transforms: TransformProvider = {
    dimensions: (id) => {
      return this.transformObject(id) ? '3d' : null;
    },
    // A DESIGN-TIME world contains matrix-owning nodes too, which is why this
    // lane reads through the shared rule rather than the props it wrote: a
    // physics library sets `matrixAutoUpdate = false` at MOUNT, before any
    // step, so the node renders at whatever its matrix holds (identity, until
    // something writes one) while `.position` still reports the prop.
    get: (id): Transform => readLocalTransform(this.transformObject(id)),
    editability: (id, channel) => this.transformEditability(id, channel),
    beginEdit: (id) => {
      if (
        !this.transformEditability(id, 'position').writable &&
        !this.transformEditability(id, 'rotation').writable &&
        !this.transformEditability(id, 'scale').writable
      )
        return;
      const object = this.transformObject(id);
      if (!object) return;
      if (this.transformEdits.has(id)) return;
      this.transformEdits.set(id, {
        id,
        position: object.position.toArray() as [number, number, number],
        quaternion: object.quaternion.toArray() as [number, number, number, number],
        euler: [object.rotation.x, object.rotation.y, object.rotation.z],
        scale: object.scale.toArray() as [number, number, number],
      });
    },
    apply: (id, t) => {
      // The gizmo has usually already moved the live object; the inspector's
      // numeric commit path has not. Applying unconditionally keeps both
      // consistent (idempotent for the gizmo).
      const object = this.transformObject(id);
      if (!object) return;
      object.position.fromArray(t.position);
      object.quaternion.fromArray(t.rotation);
      object.scale.fromArray(t.scale);
    },
    endEdit: (id) => {
      const edit = this.transformEdits.get(id);
      if (!edit) return;
      this.transformEdits.delete(id);
      this.completedTransformEdits.push(edit);
      // A multi-selection gesture begins every source edit before ending any
      // of them. Commit only when the final participant ends, preserving one
      // ordered source/history transaction for the whole gesture.
      if (this.transformEdits.size > 0) return;
      const completed = this.completedTransformEdits.splice(0);
      // THE GESTURE'S OWN ACK, through the pipe and AWAITED — the commit still
      // serializes behind whatever is already queued (one ordered source/
      // history transaction per gesture is the whole reason the queue exists),
      // and the promise this returns resolves only once the bytes have landed
      // or the lane has honestly reported that none did.
      // The gesture's LOCK outlives the pointer: between the release and this
      // write landing, the design session's swap gates both read idle (the
      // write has not reserved history yet), and an in-flight remount adopted
      // pre-gesture source — the multi-select "one member snapped back on
      // release" (runhuman pass 56; multi loses the race more often because
      // its commit queues later). Held here, released when the bytes settle.
      beginLiveGesture();
      const acked = this.transformCommitQueue.then(() =>
        runWritePipe(this.pipedTransformCommit(completed)),
      );
      void acked.then(endLiveGesture, endLiveGesture);
      this.transformCommitQueue = acked.then(
        () => undefined,
        (error: unknown) => {
          console.error('[R3fSourceAuthoringAdapter] transform commit failed', error);
        },
      );
      return acked;
    },
    /**
     * DELETE THE ATTRIBUTE — the transform channel's half of the same revert
     * the property rows have had since H4 (`inspector.remove`), and the only
     * door on this lane that restores the BYTES a gesture that APPENDED the
     * channel moved. `commitTransformEdits` writes with `addIfMissing`, so
     * placing an object whose callsite carried no `position` adds one; writing
     * the old numbers back leaves that attribute standing, and the file is a
     * byte away from where it started forever.
     *
     * Through the SAME pipe every other JSX-attribute edit uses, resolving on
     * `removeProp` rather than `writeProp` — a session that can write but not
     * remove reaches the live-only floor by name instead of acking a
     * destination no byte left.
     */
    remove: (id, channel) => {
      const oid = this.oidOf(id);
      if (!oid) return;
      return this.pipedJsxRemove(
        () => this.removeTransformChannel(id, oid, channel),
        this.destinationOf(id),
      );
    },
  };

  /**
   * One transform channel's authored attribute, dropped.
   *
   * The editability gate is re-asked HERE and not merely upstream: a removal is
   * as much a source edit as a write, so every reason a channel refuses a write
   * — expression-bound, physics-owned, a component that does not forward it —
   * refuses a deletion for the same reason. Dropping `position={spawnPoint}`
   * would not be a revert; it would be deleting the game's own wiring.
   *
   * Nothing re-poses the live object afterwards, deliberately: the value in
   * force once the attribute is gone is whatever the component's own signature
   * declares, which only the remount can report. Echoing a guess here is the
   * one thing `removeOidProp` refuses to do.
   */
  private async removeTransformChannel(
    id: string,
    oid: string,
    channel: TransformChannel,
  ): Promise<boolean> {
    const editability = this.transformEditability(id, channel);
    if (!editability.writable || editability.removable !== true) {
      console.warn(
        `[R3fSourceAuthoringAdapter] cannot drop "${channel}" on "${id}": ` +
          `${editability.reason ?? 'this callsite authors no such attribute'}.`,
      );
      return false;
    }
    return this.removeOidProp(id, oid, `${JSX_PATH_PREFIX}${channel}`, channel);
  }

  /**
   * THIS ADAPTER'S TRANSFORM PLUG INTO THE PIPE.
   *
   * `resolve` is the whole of the lane question here: this adapter's dialect is
   * the JSX attribute writer, so an edit reaches a writer exactly when one is
   * bound. Per-CHANNEL refusals (an expression-bound prop, a missing stamp) are
   * the writer's own and come back as `persisted: false` with the reason on the
   * console — `commitTransformEdits` reverts the live object for those, which
   * is why they are a write outcome rather than a resolution.
   *
   * There is no `record` work: the source-write backend is wrapped in
   * `withProjectSourceHistory`, so the transaction that carries the bytes IS
   * the history entry. Journaling again here would make one gesture two undos.
   */
  /**
   * EVERY JSX-ATTRIBUTE WRITE this adapter performs, through the pipe.
   *
   * The dialect is one — `SourceWriteBackend.writeProp` — so the resolution is
   * one question (is a writer bound?), and the writer's own per-prop refusals
   * (an expression-bound attribute, a missing stamp, a no-op) come back as
   * `false` with their reason already on the console. That is a WRITE outcome,
   * not a resolution: the helpers revert the live object for those, so the
   * edit's honest ack is the live-only floor and the pipe supplies it.
   */
  /** Where THIS node's bytes land — its creation-site file, not the world
   *  entry. An OID write may address a scene or prefab the entry only imports;
   *  naming `entryPath` is how a child-file edit acked `src/world.tsx`. */
  private destinationOf(id: string): string {
    const loc = this.sourceLocation(id);
    return loc ? this.projectRelativeSourceFile(loc.file) : this.options.entryPath;
  }

  private pipedJsxWrite(
    write: () => Promise<boolean>,
    /**
     * Which backend verb this edit's dialect actually needs. A REMOVAL is the
     * same dialect and the same anchor — a JSX attribute in this entry — but it
     * is `removeProp` that has to be bound, not `writeProp`. Resolving on the
     * wrong verb is how a lane comes to ack `source-prop` for a door it does
     * not have.
     */
    bound: boolean = this.writeBackend?.writeProp !== undefined,
    destination: string = this.options.entryPath,
  ): Promise<WriteAck> {
    return runWritePipe({
      resolve: (): WriteResolution =>
        bound
          ? {
              reaches: 'writer',
              anchorKind: 'source-prop',
              destination,
              write,
            }
          : resolvesLiveOnly(NO_SOURCE_WRITER_REASON),
      // The backend is wrapped in `withProjectSourceHistory`: the transaction
      // that carries the bytes IS the history entry.
      record: () => undefined,
      // A session with no writer degrades LOUDLY — the same warning the write
      // helpers raised when THEY were the ones discovering it. Resolution moved
      // that discovery earlier; the sentence has to move with it, or the lane
      // goes quiet for a whole class of edits.
      report: (reason) =>
        console.warn(`[R3fSourceAuthoringAdapter] this edit stays live-only — ${reason}.`),
    });
  }

  /**
   * The adapter's OTHER dialect: a source-TOKEN replacement (a LOD distance, a
   * joint parameter, a particle field) rewritten in place through
   * `replaceProjectSource`. Same pipe, same recorder, different writer — which
   * is exactly what a plug point is for.
   */
  private pipedSourceTokenWrite(write: () => Promise<boolean>): Promise<WriteAck> {
    return runWritePipe({
      resolve: (): WriteResolution =>
        this.writeBackend && this.store.shell.projectHistory
          ? {
              reaches: 'writer',
              anchorKind: 'construction-literal',
              destination: this.options.entryPath,
              write: () =>
                write().catch((error: unknown) => {
                  console.error('[R3fSourceAuthoringAdapter] source token write failed', error);
                  return false;
                }),
            }
          : resolvesLiveOnly(NO_SOURCE_WRITER_REASON),
      record: () => undefined,
      // A session with no writer degrades LOUDLY — the same warning the write
      // helpers raised when THEY were the ones discovering it. Resolution moved
      // that discovery earlier; the sentence has to move with it, or the lane
      // goes quiet for a whole class of edits.
      report: (reason) =>
        console.warn(`[R3fSourceAuthoringAdapter] this edit stays live-only — ${reason}.`),
    });
  }

  private pipedTransformCommit(completed: readonly TransformEditSnapshot[]): PipedWrite {
    return {
      resolve: (): WriteResolution =>
        this.writeBackend?.writeProp
          ? {
              reaches: 'writer',
              anchorKind: 'source-prop',
              destination: this.destinationOf(completed[0]?.id ?? ''),
              write: () =>
                this.commitTransformEdits(completed).catch((error: unknown) => {
                  console.error('[R3fSourceAuthoringAdapter] transform commit failed', error);
                  return false;
                }),
            }
          : resolvesLiveOnly(NO_SOURCE_WRITER_REASON),
      record: () => undefined,
      // A session with no writer degrades LOUDLY — the same warning the write
      // helpers raised when THEY were the ones discovering it. Resolution moved
      // that discovery earlier; the sentence has to move with it, or the lane
      // goes quiet for a whole class of edits.
      report: (reason) =>
        console.warn(`[R3fSourceAuthoringAdapter] this edit stays live-only — ${reason}.`),
    };
  }

  private transformEditability(id: string, channel: TransformChannel): TransformEditability {
    // Before anything resolves attributes: an occurrence that BORROWS another
    // object's callsite (a reparented interior element, not a repeat of the
    // element itself — see `borrowsRepresentativeCallsite`) would read the
    // OWNER's `<Enemy …>` tag below, and a drag here would commit this object's
    // local transform into the owner's position prop — moving the enemy, not
    // the pocket. A genuine repeat of the callsite falls through to the ordinary
    // contract/literal checks, which is where its write is decided.
    if (this.borrowsRepresentativeCallsite(id)) {
      const object = this.byId.get(id);
      const tag = object ? this.oidEntryOf(object)?.tag : undefined;
      return {
        writable: false,
        reason: `Rendered by ${tag ? `<${tag}>` : 'its component'} — this object has no writable source transform of its own.`,
      };
    }
    const oid = this.oidOf(id);
    if (!oid) {
      // A part with no address of its own may still carry the INHERITED stamp
      // of the instance that rendered it. That is not somewhere to write, but
      // it names who to go and edit instead — a strictly more useful refusal
      // than "no source identity", and the only thing the stamp is good for
      // here (`authoring/component-instance-root.ts`).
      const inherited = instanceStampOf(this.byId.get(id));
      const tag = inherited !== undefined ? this.oidIndex.get(inherited)?.tag : undefined;
      return {
        writable: false,
        reason: tag
          ? `Rendered by <${tag}> — this object has no writable source transform of its own.`
          : 'This rendered part has no authored source identity.',
      };
    }
    if (!this.writeBackend?.writeProp) {
      return { writable: false, reason: 'This session has no source writer.' };
    }
    // A PHYSICS-OWNED node, before any attribute question. The address we are
    // about to write is the element a simulated body is bound to, so its own
    // transform props are dead: the body re-composes the object's matrix from
    // ITS spawn every frame and the file would say the object is somewhere it
    // will never be. Naming the binding is the whole difference between a
    // refusal an author can act on and a write that silently loses.
    const physics = physicsRefusal(this.oidIndex.get(oid), channel);
    if (physics) return { writable: false, reason: physics };
    const attrs = this.attrsOf(id);
    if (!attrs) {
      // The index may merely be STALE, not missing: a prop-only fast-refresh
      // re-stamps live objects in place — new oids, no `childadded` — so the
      // structural reindex above never fires and the cached index keeps the
      // previous transform's rows forever (measured on an imported 3D FPS project:
      // doctor's own edit-write phase re-minted the scene's oids and every
      // later editability read refused "until the page reloads"). A stale
      // sighting gets ONE refetch of the same source state a structural
      // reindex would fetch; the refusal below is then transient — the
      // refreshed index resolves the next read, with no warning.
      if (!this.staleOidRefreshes.has(oid)) {
        this.staleOidRefreshes.add(oid);
        void this.refreshSourceState();
      }
      // While the latest source refresh is still in flight, this read cannot
      // yet distinguish "stale" from "gone" — refuse transiently, never warn.
      if (this.sourceRefreshPending) {
        return {
          writable: false,
          reason: 'Source metadata for this element is being refreshed — try again in a moment.',
        };
      }
      // Refreshed and STILL uncovered: the element genuinely has no source
      // record, and only a page reload re-derives one. Say so, once, where
      // the session ledger keeps it (a blind probe once read adapter source
      // to discover this).
      reportMissingSourceMetadataOnce(id);
      return {
        writable: false,
        reason:
          'Source metadata is missing for this element — an element added by hot reload is not ' +
          'in the OID index until the page reloads. Reload the editor page to author it.',
      };
    }
    const attr = attrs.find((candidate) => candidate.name === channel);
    const object = this.byId.get(id);
    if (object && this.isComponentBoundary(object)) {
      const contract = this.oidEntryOf(object)?.r3fAuthoring;
      const forwardsChannel = contract?.transformProps.includes(channel) ?? false;
      // A simulation-owned root is refused for a DIFFERENT reason than a
      // component that merely forgot to forward: nothing the author writes
      // here survives the next frame. Saying "does not forward position" would
      // send them to add a prop the component is right not to have.
      const simulationOwned = contract?.simulationOwnedTransform === true;
      // …and it OUTRANKS forwarding: a component can forward a channel to its
      // root or its body AND drive that same channel every frame
      // (racing-game's `Train` hands `position` to both its group and its
      // `useBox`, then re-poses the body from its animated group in
      // `useFrame`) — the forward is real at spawn and dead one frame later,
      // so answering "writable" from the forward alone persisted a literal
      // the game demonstrably discards (the doctor's settle leg measured the
      // authored spawn re-posed to the old value, digit for digit).
      if (simulationOwned) {
        return {
          writable: false,
          reason: `${this.oidEntryOf(object)?.tag ?? 'This component'} drives its own ${channel} every frame — this instance is placed by the simulation, not by the editor.`,
        };
      }
      if (!attr) {
        if (forwardsChannel) return { writable: true };
        const contractReason = simulationOwned
          ? `drives its own ${channel} every frame — this instance is placed by the simulation, not by the editor`
          : contract?.root === 'multiple'
            ? 'renders multiple roots'
            : contract?.root === 'non-spatial'
              ? 'has no spatial root'
              : contract?.root === 'unknown'
                ? 'has no statically provable native root'
                : contract?.root === 'single'
                  ? `does not forward ${channel} to its ${contract.rootTag ?? 'native'} root`
                  : `does not expose a ${channel} prop`;
        return {
          writable: false,
          reason: `${this.oidEntryOf(object)?.tag ?? 'This component'} ${contractReason}.`,
        };
      }
      // A local definition gives us stronger evidence than the historical
      // callsite-only fallback. If it exists and the channel is not forwarded,
      // writing the prop would create source that looks editable but is ignored
      // by the component implementation. (The simulation-owned case returned
      // above — it outranks the forwarding question entirely.)
      if (contract && !forwardsChannel) {
        return {
          writable: false,
          reason: `${this.oidEntryOf(object)?.tag ?? 'This component'} does not forward ${channel} to its ${contract.rootTag ?? 'native'} root.`,
        };
      }
      const supportedLiteral =
        attr.isExpression &&
        (isVec3Literal(attr.rawValue) || (channel === 'scale' && NUMBER_RE.test(attr.rawValue)));
      if (!supportedLiteral) {
        return {
          writable: false,
          reason:
            channel === 'scale'
              ? 'scale is not exposed as a number or three-number tuple by this component.'
              : `${channel} is not exposed as a three-number tuple by this component.`,
        };
      }
    }
    if (attr?.isExpression && !attr.isLiteral) {
      return {
        writable: false,
        reason: `${channel} is controlled by the JSX expression {${attr.rawValue}}.`,
      };
    }
    // The same two facts a property row's `resettable` is computed from
    // (`isOverride`, above): the callsite ACTUALLY carries this attribute, and
    // this session has a backend that can take it back. Without the first, a
    // "revert" would delete nothing; without the second there is no door.
    return {
      writable: true,
      ...(attr && this.writeBackend?.removeProp ? { removable: true } : {}),
    };
  }

  /** Drag-end → single tuple write per changed channel (W4c). Refused
   *  channels (dynamic props, scalar-scale mismatch, no backend) revert the
   *  live object to its pre-drag snapshot — source stays truth.
   *
   *  Answers whether ANY byte landed, which is what the pipe acks with. A
   *  gesture every channel of which was refused is `false`: the value is on the
   *  live object and nothing is in the file, and saying so is the point. */
  private async commitTransformEdits(edits: readonly TransformEditSnapshot[]): Promise<boolean> {
    if (edits.length === 0) return false;
    const backend = this.writeBackend;
    let persisted = false;
    const run = async (selectedBackend?: SourceWriteBackend): Promise<void> => {
      for (const edit of edits) {
        if (await this.commitTransformEdit(edit, selectedBackend, false)) persisted = true;
      }
    };
    if (edits.length > 1 && backend?.runGesture) {
      await backend.runGesture('Transform Selection', (scoped) => run(scoped));
    } else {
      await run(backend);
    }
    return persisted;
  }

  /** One node's changed channels. `true` ⇒ at least one channel reached source. */
  private async commitTransformEdit(
    edit: TransformEditSnapshot,
    selectedBackend?: SourceWriteBackend,
    manageGesture = true,
  ): Promise<boolean> {
    const object = this.transformObject(edit.id);
    if (!object) return false;
    const oid = this.oidOf(edit.id);
    const attrs = oid ? this.attrsOf(edit.id) : null;

    const changed = {
      position: !this.nearlyEqual(object.position.toArray(), edit.position),
      rotation: !this.nearlyEqual(
        [object.rotation.x, object.rotation.y, object.rotation.z],
        edit.euler,
      ),
      scale: !this.nearlyEqual(object.scale.toArray(), edit.scale),
    };
    if (!changed.position && !changed.rotation && !changed.scale) return false;

    const revert = (channel: 'position' | 'rotation' | 'scale'): void => {
      if (channel === 'position') object.position.fromArray(edit.position);
      else if (channel === 'rotation') object.quaternion.fromArray(edit.quaternion);
      else object.scale.fromArray(edit.scale);
      this.store.shell.notifyIngestEdit();
    };

    const backend = selectedBackend ?? this.writeBackend;
    if (!oid || !backend?.writeProp) {
      console.warn(
        `[R3fSourceAuthoringAdapter] transform on "${edit.id}" is not persistable ` +
          `(${oid ? 'no source-write backend' : 'node has no source stamp'}) — reverting.`,
      );
      for (const c of ['position', 'rotation', 'scale'] as const) if (changed[c]) revert(c);
      return false;
    }

    const writes: Array<{
      channel: 'position' | 'rotation' | 'scale';
      value: string;
      /** R2 — a non-uniform drag over a scalar `scale={n}` shorthand: the
       *  write EXPLICITLY upgrades the number literal to a tuple literal. */
      shapeUpgrade?: boolean;
    }> = [];
    for (const channel of ['position', 'rotation', 'scale'] as const) {
      if (!changed[channel]) continue;
      const values =
        channel === 'position'
          ? (object.position.toArray() as number[])
          : channel === 'rotation'
            ? [object.rotation.x, object.rotation.y, object.rotation.z]
            : (object.scale.toArray() as number[]);
      const attr = attrs?.find((a) => a.name === channel);
      if (attr && attr.isExpression && !attr.isLiteral) {
        console.warn(
          `[R3fSourceAuthoringAdapter] "${channel}" on "${edit.id}" is expression-bound ` +
            '(guarded) — reverting the live object.',
        );
        this.dynamicPaths.add(`${edit.id}|${channel}`);
        revert(channel);
        continue;
      }
      // Scalar `scale={1.5}` shorthand: a UNIFORM drag keeps writing the
      // scalar (don't churn the authored style); a NON-uniform drag upgrades
      // it to a tuple via the writer's opt-in `allowShapeUpgrade` flag (R2 —
      // the landed refuse+revert behavior becomes an explicit shape upgrade;
      // dynamic scalars were already guarded above).
      if (channel === 'scale' && attr && NUMBER_RE.test(attr.rawValue)) {
        const [sx, sy, sz] = values as [number, number, number];
        if (Math.abs(sx - sy) < EPS && Math.abs(sy - sz) < EPS) {
          writes.push({ channel, value: fmt(sx) });
        } else {
          writes.push({ channel, value: tupleText(values), shapeUpgrade: true });
        }
        continue;
      }
      writes.push({ channel, value: tupleText(values) });
    }
    if (writes.length === 0) return false;

    let persisted = false;
    const run = async (backend: SourceWriteBackend): Promise<void> => {
      for (const w of writes) {
        const res = await backend.writeProp!(oid, w.channel, w.value, {
          addIfMissing: true,
          ...(w.shapeUpgrade ? { allowShapeUpgrade: true } : {}),
        });
        if (res.changed) persisted = true;
        if (!res.changed) {
          if (res.dynamic) this.dynamicPaths.add(`${edit.id}|${w.channel}`);
          console.warn(
            `[R3fSourceAuthoringAdapter] ${w.channel} write refused for oid "${oid}": ` +
              `${res.dynamic ? 'dynamic expression (guarded)' : (res.error ?? 'no change')} — reverting.`,
          );
          revert(w.channel);
        }
      }
    };
    // One history gesture for a multi-channel drag (pivot rotate = position +
    // rotation) so a single Ctrl+Z restores the whole gesture.
    if (manageGesture && writes.length > 1 && backend.runGesture) {
      await backend.runGesture('Transform', (scoped) => run(scoped));
    } else {
      await run(backend);
    }
    this.store.shell.notifyIngestEdit();
    return persisted;
  }

  private nearlyEqual(a: readonly number[], b: readonly number[]): boolean {
    return a.length === b.length && a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < EPS);
  }

  // -------------------------------------------------------------- inspector

  /** The material sub-object's oid, when fiber pierced a stamp onto it (a
   *  `<meshStandardMaterial userData-oid=…>` child element — materials carry
   *  userData but are not scene-graph nodes, so this is their only handle). */
  private materialOidOf(object: THREE.Object3D): string | null {
    return ownOidOf(firstMaterial(object)) ?? null;
  }

  private attrsOfOid(oid: string): JsxAttrInfo[] | null {
    const entry = this.oidIndex.get(oid);
    if (!entry) return null;
    const src = this.sources.get(entry.file);
    if (src === undefined) return null;
    const start = lineColToOffset(src, entry.line, entry.col);
    if (src[start] !== '<') return null;
    const tagEnd = findTagEnd(src, start);
    if (tagEnd < 0) return null;
    return analyzeJsxAttributes(src, start, tagEnd);
  }

  /**
   * The FALLBACK rung of the widget decision: what the attribute's own TEXT
   * looks like, used only when the component's declared type said nothing
   * usable (`componentProperties` tries `spec.type` first).
   *
   * The guess itself is unchanged — a guessed widget beats a blank row — but it
   * is no longer silent. A silently guessed widget is indistinguishable from a
   * declaration that worked, so `color="#ff0000"` on an untyped prop renders a
   * swatch, `color="red"` renders a text box, and nobody learns why. The report
   * names the callsite file and the prop, which is where the fix goes
   * (ARCHITECTURE-CORE §The editor protocol, "Zero inference").
   */
  private descriptorTypeFor(
    attr: JsxAttrInfo,
    subject: PropSubject,
    name: string,
    declared: ComponentPropSpec | undefined,
  ): PropertyDescriptor['type'] {
    const guess = ((): PropertyDescriptor['type'] => {
      if (!attr.isLiteral) return 'string';
      const raw = attr.rawValue;
      if (raw === 'true' || raw === 'false') return 'boolean';
      if (attr.isExpression && NUMBER_RE.test(raw)) return 'number';
      if (attr.isExpression && isNumberTupleLiteral(raw)) return 'json';
      const str = attr.isExpression ? raw.replace(/^['"]|['"]$/g, '') : raw;
      if (HEX_COLOR_RE.test(str)) return 'color';
      return 'string';
    })();
    // The warning is an ASK — "declare it and the editor reads the
    // declaration" — so it fires only when the author can actually act on it
    // and the editor has actually looked (measured on racing-game, all three
    // ways this used to lie):
    //  - a spec whose TYPE merely maps to no widget IS a declaration — the
    //    author already declared; asking again is wrong (`defaultContactMaterial`);
    //  - a lowercase native tag has no declaration an author could write —
    //    the message demanded something only the editor can supply;
    //  - before the server's cold declared-prop resolver has answered
    //    (`propsResolved` on the index entry), absence is PENDING, not
    //    measured — the doctor's sweep raced the cold program and six rows
    //    the resolver demonstrably types went into the ledger as uncovered.
    const entry = this.oidIndex.get(subject.oid);
    const askable =
      declared === undefined && entry?.propsResolved === true && /^[A-Z]/.test(entry.tag ?? '');
    if (askable) {
      warnGuessedFromText(entry?.file ?? this.options.entryPath, name, guess);
    }
    return guess;
  }

  private literalValueOf(attr: JsxAttrInfo): unknown {
    if (!attr.isLiteral) return `{${attr.rawValue}}`;
    const raw = attr.rawValue;
    if (!attr.isExpression) return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (NUMBER_RE.test(raw)) return Number(raw);
    if (isNumberTupleLiteral(raw)) {
      try {
        return JSON.parse(raw.replace(/,\s*\]$/, ']'));
      } catch {
        return raw;
      }
    }
    return raw.replace(/^['"]|['"]$/g, '');
  }

  /** `wrap.<encoded oid>.<prop>` -> its parts. */
  private parseWrapperPropertyPath(path: string): { oid: string; prop: string } | null {
    if (!path.startsWith(WRAPPER_PATH_PREFIX)) return null;
    const rest = path.slice(WRAPPER_PATH_PREFIX.length);
    const separator = rest.indexOf('.');
    if (separator < 1) return null;
    try {
      return { oid: decodeURIComponent(rest.slice(0, separator)), prop: rest.slice(separator + 1) };
    } catch {
      return null;
    }
  }

  /** The props the node's component DECLARES, resolved server-side by the
   *  TypeScript checker and delivered on the OID index entry. Empty for a
   *  native tag or an unresolvable definition. */
  private declaredPropsOf(id: string): ComponentPropSpec[] {
    const oid = this.oidOf(id);
    return (oid ? this.oidIndex.get(oid)?.props : undefined) ?? [];
  }

  /** Whatever a block of inspector rows writes to: the node's own tag, or an
   *  enclosing wrapper tag that never became a node of its own. */
  private nodeSubject(id: string): PropSubject | null {
    const oid = this.oidOf(id);
    if (!oid) return null;
    return {
      oid,
      declared: this.declaredPropsOf(id),
      pathFor: (prop) => `${JSX_PATH_PREFIX}${prop}`,
      keyFor: (prop) => `${id}|${JSX_PATH_PREFIX}${prop}`,
    };
  }

  private wrapperSubject(oid: string): PropSubject {
    const pathFor = (prop: string): string =>
      `${WRAPPER_PATH_PREFIX}${encodeURIComponent(oid)}.${prop}`;
    return {
      oid,
      declared: this.oidIndex.get(oid)?.props ?? [],
      pathFor,
      keyFor: pathFor,
    };
  }

  /**
   * The JSX tags that lexically WRAP this node but never became nodes
   * themselves, outermost first.
   *
   * `<RigidBody><PrototypeCube/></RigidBody>` renders one selectable thing, the
   * cube — rapier's RigidBody does not forward the editor's stamp to the
   * Object3D it creates, so there is nothing to click. Its props are still the
   * author's physics configuration for that cube, and hiding them is why the
   * inspector looked like it had "no components". Attribute them to the node
   * they govern, which is also how Unity presents it: one GameObject, a stack
   * of component blocks.
   *
   * A wrapper that DID become its own node is a real ancestor row and stops the
   * walk — its props belong to it, not to its child.
   */
  private collapsedWrappersOf(id: string): Array<{ oid: string; tag: string }> {
    const startOid = this.oidOf(id);
    if (!startOid) return [];
    const live = this.liveOids();
    const wrappers: Array<{ oid: string; tag: string }> = [];
    let cursor = this.oidIndex.get(startOid)?.parentOid;
    for (let hop = 0; cursor && hop < 16; hop += 1) {
      if (live.has(cursor)) break;
      const entry = this.oidIndex.get(cursor);
      if (!entry) break;
      // Only a COMPONENT wrapper carries configuration. A plain `<group>` or a
      // fragment is structure, and its transform already reaches the node.
      if (/^[A-Z]/.test(entry.tag)) wrappers.push({ oid: cursor, tag: entry.tag });
      cursor = entry.parentOid;
    }
    return wrappers.reverse();
  }

  /** The source `<RigidBody>` governing this selected scene object. Collider
   * components are Inspector components on that object, not hierarchy rows. */
  private rigidBodyOidOf(id: string): string | null {
    const object = this.byId.get(id);
    // A custom-component instance has two honest source addresses: the
    // callsite (`<Crate />`) and the native root in its definition. Physics
    // wrappers/colliders normally live beside that definition root, so walk
    // it FIRST. `oidOf` intentionally prefers the callsite for ordinary
    // instance editing and therefore cannot answer this component-stack
    // question on its own.
    const starts = [this.definitionOid(id), ownOidOf(object), this.oidOf(id)].filter(
      (oid): oid is string => typeof oid === 'string',
    );
    for (const start of starts) {
      let cursor: string | undefined = start;
      for (let hop = 0; cursor && hop < 32; hop += 1) {
        const entry = this.oidIndex.get(cursor);
        if (!entry) break;
        if (entry.tag === 'RigidBody') return cursor;
        cursor = entry.parentOid;
      }
    }
    return null;
  }

  private explicitColliderOids(rigidBodyOid: string): string[] {
    const belongsToBody = (oid: string): boolean => {
      let cursor = this.oidIndex.get(oid)?.parentOid;
      for (let hop = 0; cursor && hop < 32; hop += 1) {
        if (cursor === rigidBodyOid) return true;
        const entry = this.oidIndex.get(cursor);
        if (!entry || entry.tag === 'RigidBody') return false;
        cursor = entry.parentOid;
      }
      return false;
    };
    return [...this.oidIndex.entries()]
      .filter(([oid, entry]) => entry.tag in COLLIDER_TAG_SHAPES && belongsToBody(oid))
      .sort(([, a], [, b]) =>
        a.file === b.file ? a.line - b.line || a.col - b.col : a.file.localeCompare(b.file),
      )
      .map(([oid]) => oid);
  }

  /** Match source collider components to the native Rapier colliders by their
   * creation order, but only when the set and shape sequence agree exactly.
   * A mixed explicit+automatic body therefore degrades instead of binding a
   * source tag to the wrong native shape. */
  /**
   * The physics adapter ONLY while a world is actually stepping.
   *
   * The engine's slot refuses by name when no `<RapierPhysicsBridge>` is
   * live, and that is right for its declared members: they are gesture-rate
   * ACTIONS, so a fabricated empty would be a lie about a sim you just tried
   * to edit (`world3d-react/rapier-physics-bridge.tsx`). The two binding
   * readers below break that premise — they run from `properties()`, which
   * the Inspector calls on EVERY RENDER — so selecting a physics object in
   * edit mode threw the refusal up through React and took the whole editor
   * surface down with it, which then swallowed the edits the human was
   * making (runhuman pass 96: added jump pads "didn't add", a delete "doesn't
   * delete", both actually present after a reload).
   *
   * So the presence question is asked POSITIVELY, before the call. A binding
   * ties a source tag to a LIVE native handle; with nothing stepping there
   * are no handles, and none is the true answer rather than a refusal. Every
   * gesture-rate call keeps going straight at the slot and stays loud.
   */
  private steppingPhysics(): PhysicsAdapter | null {
    if (this.store.shell.playState === 'stopped') return null;
    return this.options.physics?.() ?? null;
  }

  private colliderBindingsOf(id: string): ColliderSourceBinding[] {
    const rigidBodyOid = this.rigidBodyOidOf(id);
    const physics = this.steppingPhysics();
    if (!rigidBodyOid || !physics?.colliders) return [];
    const sourceOids = this.explicitColliderOids(rigidBodyOid);
    const snapshots = [...physics.colliders(id)];
    if (sourceOids.length === 0 || sourceOids.length !== snapshots.length) return [];
    const bindings: ColliderSourceBinding[] = [];
    for (let index = 0; index < sourceOids.length; index += 1) {
      const sourceOid = sourceOids[index]!;
      const sourceTag = this.oidIndex.get(sourceOid)?.tag as ExplicitColliderTag | undefined;
      const snapshot = snapshots[index]!;
      if (!sourceTag || COLLIDER_TAG_SHAPES[sourceTag] !== snapshot.shape.type) return [];
      const args = this.attrsOfOid(sourceOid)?.find((attr) => attr.name === 'args');
      bindings.push({
        sourceOid,
        sourceTag,
        snapshot,
        writable:
          !!this.writeBackend?.writeProp &&
          !!args?.isLiteral &&
          !this.dynamicPaths.has(
            `${COLLIDER_ARG_PATH_PREFIX}${encodeURIComponent(sourceOid)}.args`,
          ),
      });
    }
    return bindings;
  }

  private parseColliderArgPath(path: string): { oid: string; index: number } | null {
    if (!path.startsWith(COLLIDER_ARG_PATH_PREFIX)) return null;
    const match = /^collider\.([^.]*)\.arg\.(\d+)$/.exec(path);
    if (!match) return null;
    try {
      return { oid: decodeURIComponent(match[1]!), index: Number(match[2]) };
    } catch {
      return null;
    }
  }

  private colliderArgs(oid: string): number[] | null {
    const echo = this.valueEcho.get(`${COLLIDER_ARG_PATH_PREFIX}${encodeURIComponent(oid)}.args`);
    if (Array.isArray(echo) && echo.every((value) => typeof value === 'number')) return [...echo];
    const attr = this.attrsOfOid(oid)?.find((candidate) => candidate.name === 'args');
    const value = attr ? this.literalValueOf(attr) : null;
    return Array.isArray(value) && value.every((part) => typeof part === 'number')
      ? [...value]
      : null;
  }

  private colliderDimensionRows(binding: ColliderSourceBinding): PropertyDescriptor[] {
    const labels =
      binding.sourceTag === 'CuboidCollider'
        ? ['Half extent X', 'Half extent Y', 'Half extent Z']
        : binding.sourceTag === 'CapsuleCollider'
          ? ['Half height', 'Radius']
          : ['Radius'];
    return labels.map((label, index) => ({
      path: `${COLLIDER_ARG_PATH_PREFIX}${encodeURIComponent(binding.sourceOid)}.arg.${index}`,
      label,
      type: 'number' as const,
      group: humanizeIdentifier(binding.sourceTag),
      readonly: !binding.writable,
    }));
  }

  /** Source hook calls and native joints must agree as a complete sequence.
   * Rapier handles are runtime identities, so a partial/shape-only match could
   * silently put one hook's anchor onto another joint after an HMR remount. */
  private jointBindingsOf(id: string): JointSourceBinding[] {
    const rigidBodyOid = this.rigidBodyOidOf(id);
    const entry = rigidBodyOid ? this.oidIndex.get(rigidBodyOid) : undefined;
    const physics = this.steppingPhysics();
    if (!rigidBodyOid || !entry?.jointBindings || !physics?.joints) return [];
    const snapshots = [...physics.joints(id)];
    if (entry.jointBindings.length !== snapshots.length) return [];
    const result: JointSourceBinding[] = [];
    for (let index = 0; index < entry.jointBindings.length; index += 1) {
      const source = entry.jointBindings[index]!;
      const snapshot = snapshots[index]!;
      if (JOINT_HOOK_TYPES[source.hook] !== snapshot.type) return [];
      result.push({
        sourceOid: rigidBodyOid,
        sourceFile: entry.file,
        source,
        snapshot,
        writable:
          !!source.params &&
          !!source.paramRanges &&
          !!this.writeBackend?.readSource &&
          !!this.writeBackend.applySource &&
          !!this.store.shell.projectHistory,
      });
    }
    return result;
  }

  private jointKey(binding: JointSourceBinding): string {
    return `${binding.source.line}:${binding.source.col}`;
  }

  private jointPath(binding: JointSourceBinding, suffix: string): string {
    return `${JOINT_PATH_PREFIX}${this.jointKey(binding)}.${suffix}`;
  }

  private jointBindingForPath(id: string, path: string): JointSourceBinding | null {
    const match = /^joint\.(\d+:\d+)\./.exec(path);
    if (!match) return null;
    return this.jointBindingsOf(id).find((binding) => this.jointKey(binding) === match[1]) ?? null;
  }

  private jointParamPath(path: string): { param: number; part?: number } | null {
    const match = /^joint\.\d+:\d+\.param\.(\d+)(?:\.(\d+))?$/.exec(path);
    return match
      ? {
          param: Number(match[1]),
          ...(match[2] === undefined ? {} : { part: Number(match[2]) }),
        }
      : null;
  }

  private jointTupleRows(
    binding: JointSourceBinding,
    label: string,
    param: number,
    axes: readonly string[] = ['X', 'Y', 'Z'],
  ): PropertyDescriptor[] {
    const group = humanizeIdentifier(binding.source.hook.replace(/^use/, ''));
    return axes.map((axis, part) => ({
      path: this.jointPath(binding, `param.${param}.${part}`),
      label: `${label} ${axis}`,
      type: 'number' as const,
      readonly: !binding.writable,
      group,
    }));
  }

  private jointScalarRow(
    binding: JointSourceBinding,
    label: string,
    param: number,
  ): PropertyDescriptor {
    return {
      path: this.jointPath(binding, `param.${param}`),
      label,
      type: 'number',
      readonly: !binding.writable,
      group: humanizeIdentifier(binding.source.hook.replace(/^use/, '')),
    };
  }

  private jointDetailRows(binding: JointSourceBinding): PropertyDescriptor[] {
    switch (binding.source.hook) {
      case 'useFixedJoint':
        return binding.source.params
          ? [
              ...this.jointTupleRows(binding, 'Local Frame A', 1, ['X', 'Y', 'Z', 'W']),
              ...this.jointTupleRows(binding, 'Local Frame B', 3, ['X', 'Y', 'Z', 'W']),
            ]
          : [];
      case 'useRevoluteJoint':
      case 'usePrismaticJoint':
        return [
          ...this.jointTupleRows(binding, 'Axis', 2),
          ...(binding.source.params?.[3] || binding.snapshot.limits
            ? [...this.jointTupleRows(binding, 'Limit', 3, ['Min', 'Max'])]
            : []),
        ];
      case 'useRopeJoint':
        return binding.source.params ? [this.jointScalarRow(binding, 'Length', 2)] : [];
      case 'useSpringJoint':
        return binding.source.params
          ? [
              this.jointScalarRow(binding, 'Rest Length', 2),
              this.jointScalarRow(binding, 'Stiffness', 3),
              this.jointScalarRow(binding, 'Damping', 4),
            ]
          : [];
      default:
        return [];
    }
  }

  private jointRows(binding: JointSourceBinding): PropertyDescriptor[] {
    const group = humanizeIdentifier(binding.source.hook.replace(/^use/, ''));
    return [
      {
        path: this.jointPath(binding, 'body1'),
        label: 'Body A',
        type: 'string',
        readonly: true,
        group,
      },
      {
        path: this.jointPath(binding, 'body2'),
        label: 'Body B',
        type: 'string',
        readonly: true,
        group,
      },
      ...this.jointTupleRows(binding, 'Anchor A', 0),
      ...this.jointTupleRows(binding, 'Anchor B', binding.source.hook === 'useFixedJoint' ? 2 : 1),
      ...this.jointDetailRows(binding),
      {
        path: this.jointPath(binding, 'contacts'),
        label: 'Contacts Enabled',
        type: 'boolean',
        readonly: true,
        group,
      },
    ];
  }

  private jointValue(id: string, path: string): unknown {
    const binding = this.jointBindingForPath(id, path);
    if (!binding) return undefined;
    if (path.endsWith('.body1')) return binding.source.body1Ref;
    if (path.endsWith('.body2')) return binding.source.body2Ref;
    if (path.endsWith('.contacts')) return binding.snapshot.contactsEnabled;
    const parameter = this.jointParamPath(path);
    if (!parameter) return undefined;
    // Dynamic source is inspectable through the native projection, but never
    // writable. Preserve the standard rows instead of hiding the joint.
    return jointParameterPart(jointParameterValue(binding, parameter.param), parameter.part);
  }

  /** Native three.quarks owns particle runtime state; the project's SOURCE owns
   * which object is an emitter.
   *
   * The walk is gated on the DECLARATION, not on the object's shape: an object
   * is a candidate only because its OID indexes a `particleBinding` — the
   * `<primitive object={system.emitter}>` element `r3f-particle-binding.ts`
   * read out of the project's own source. It was previously gated on
   * `object.type === 'ParticleEmitter'`, a string match against a third-party
   * library's internal discriminant: it admitted anything that mimicked the
   * literal and silently dropped every real emitter the day three.quarks
   * renames it. The native shape is then read off the DECLARED object and must
   * agree with what the source constructed. */
  private particleBindingsOf(id: string): ParticleSourceBinding[] {
    const selected = this.byId.get(id);
    if (!selected) return [];
    const declared: { emitter: NativeParticleEmitter; sourceOid: string }[] = [];
    selected.traverse((object) => {
      const sourceOid = ownOidOf(object) ?? authoringOidOf(object);
      if (!sourceOid || !this.oidIndex.get(sourceOid)?.particleBinding) return;
      declared.push({ emitter: object as NativeParticleEmitter, sourceOid });
    });
    const result: ParticleSourceBinding[] = [];
    for (const { emitter, sourceOid } of declared) {
      const entry = this.oidIndex.get(sourceOid);
      const source = entry?.particleBinding;
      const shape = nativeEmitterShapeOf(emitter);
      if (!entry || !source || !shape || source.shape !== shape.type) continue;
      result.push({
        sourceOid,
        sourceFile: entry.file,
        source,
        emitter,
        shape,
        writableFields: new Set(
          Object.keys(source.fields).filter(
            () =>
              !!this.writeBackend?.readSource &&
              !!this.writeBackend.applySource &&
              !!this.store.shell.projectHistory,
          ),
        ),
      });
    }
    return result;
  }

  private particleKey(binding: ParticleSourceBinding): string {
    return encodeURIComponent(binding.sourceOid);
  }

  private particlePath(binding: ParticleSourceBinding, field: string): string {
    return `${PARTICLE_PATH_PREFIX}${this.particleKey(binding)}.${field}`;
  }

  private particleBindingForPath(id: string, path: string): ParticleSourceBinding | null {
    const match = /^particle\.([^.]+)\./.exec(path);
    if (!match) return null;
    return (
      this.particleBindingsOf(id).find((binding) => this.particleKey(binding) === match[1]) ?? null
    );
  }

  private particleFieldPath(path: string): string | null {
    return /^particle\.[^.]+\.([A-Za-z][A-Za-z0-9]*)$/.exec(path)?.[1] ?? null;
  }

  private particleRows(binding: ParticleSourceBinding): PropertyDescriptor[] {
    const group = humanizeIdentifier(binding.source.constructor);
    const labels: Record<string, string> = {
      radius: 'Radius',
      arc: 'Arc',
      thickness: 'Thickness',
      angle: 'Angle',
      donutRadius: 'Donut Radius',
      width: 'Width',
      height: 'Height',
      column: 'Columns',
      row: 'Rows',
    };
    const fieldsByShape: Record<string, readonly string[]> = {
      point: [],
      sphere: ['radius', 'arc', 'thickness'],
      hemisphere: ['radius', 'arc', 'thickness'],
      cone: ['radius', 'arc', 'thickness', 'angle'],
      circle: ['radius', 'arc', 'thickness'],
      donut: ['radius', 'arc', 'thickness', 'donutRadius'],
      rectangle: ['width', 'height', 'thickness'],
      grid: ['width', 'height', 'column', 'row'],
    };
    return [
      {
        path: this.particlePath(binding, 'type'),
        label: 'Shape',
        type: 'string',
        readonly: true,
        group,
      },
      ...(fieldsByShape[binding.shape.type] ?? []).map((field) => ({
        path: this.particlePath(binding, field),
        label: labels[field] ?? humanizeIdentifier(field),
        type: 'number' as const,
        readonly: !binding.writableFields.has(field),
        group,
      })),
    ];
  }

  private particleValue(id: string, path: string): unknown {
    const binding = this.particleBindingForPath(id, path);
    const field = this.particleFieldPath(path);
    if (!binding || !field) return undefined;
    if (field === 'type') return binding.shape.type;
    return (binding.shape as unknown as Record<string, unknown>)[field];
  }

  private async writeParticleField(
    binding: ParticleSourceBinding,
    field: string,
    rawValue: number,
  ): Promise<boolean> {
    const backend = this.writeBackend;
    const history = this.store.shell.projectHistory;
    const token = binding.source.fields[field];
    const source = this.sources.get(binding.sourceFile);
    if (
      !backend ||
      !history ||
      !token ||
      !binding.writableFields.has(field) ||
      source === undefined ||
      token.start < 0 ||
      token.end > source.length ||
      Number(source.slice(token.start, token.end)) !== token.value
    ) {
      return false;
    }
    const value = normalizeParticleField(field, rawValue);
    const previous = (binding.shape as unknown as Record<string, unknown>)[field];
    previewParticleEdit({ binding, field, value });
    this.store.shell.notifyIngestEdit();
    const next = `${source.slice(0, token.start)}${fmt(value)}${source.slice(token.end)}`;
    try {
      await replaceProjectSource(backend, history, {
        file: binding.sourceFile,
        source: next,
        label: `Edit ${humanizeIdentifier(binding.source.constructor)} ${humanizeIdentifier(field)}`,
      });
      this.sources.set(binding.sourceFile, next);
      await this.refreshSourceState();
      return true;
    } catch (error) {
      (binding.shape as unknown as Record<string, unknown>)[field] = previous;
      this.store.shell.notifyIngestEdit();
      throw error;
    }
  }

  /** Project any selected native THREE.LOD. Drei Detailed gains source-backed
   * writes through its exact OID; manually-built LODs remain fully inspectable
   * and previewable without pretending the editor can rewrite arbitrary code. */
  private lodBindingsOf(id: string): LodSourceBinding[] {
    const selected = this.byId.get(id);
    if (!selected) return [];
    const lods: THREE.LOD[] = [];
    selected.traverse((object) => {
      if ((object as THREE.LOD).isLOD) lods.push(object as THREE.LOD);
    });
    const canWrite =
      !!this.writeBackend?.readSource &&
      !!this.writeBackend.applySource &&
      !!this.store.shell.projectHistory;
    return lods.map((lod, index) => {
      const sourceOid = ownOidOf(lod) ?? authoringOidOf(lod);
      const entry = sourceOid ? this.oidIndex.get(sourceOid) : undefined;
      const source = entry?.lodBinding;
      const distancesMatch =
        !!source?.distances &&
        source.distances.length === lod.levels.length &&
        source.distances.every(
          (distance, level) => Math.abs(distance.value - lod.levels[level]!.distance) < EPS,
        );
      const hysteresisMatches =
        !!source?.hysteresis &&
        lod.levels.every((level) => Math.abs(level.hysteresis - source.hysteresis!.value) < EPS);
      return {
        key: sourceOid ?? `${id}:${index}`,
        ...(sourceOid ? { sourceOid } : {}),
        ...(entry ? { sourceFile: entry.file } : {}),
        ...(source ? { source } : {}),
        lod,
        writableDistances: new Set(
          canWrite && distancesMatch ? lod.levels.map((_level, level) => level) : [],
        ),
        writableHysteresis: canWrite && hysteresisMatches,
      };
    });
  }

  private lodPath(binding: LodSourceBinding, suffix: string): string {
    return `${LOD_PATH_PREFIX}${encodeURIComponent(binding.key)}.${suffix}`;
  }

  private lodBindingForPath(id: string, path: string): LodSourceBinding | null {
    const match = /^lod\.([^.]+)\./.exec(path);
    if (!match) return null;
    const key = decodeURIComponent(match[1]!);
    return this.lodBindingsOf(id).find((binding) => binding.key === key) ?? null;
  }

  private lodPreviewOption(binding: LodSourceBinding, level: number): string {
    const object = binding.lod.levels[level]?.object;
    const label = object ? object.name || object.type : '';
    return `Level ${level}${label ? ` — ${label}` : ''}`;
  }

  private lodRows(binding: LodSourceBinding): PropertyDescriptor[] {
    const group = 'Level of Detail';
    const rows: PropertyDescriptor[] = [
      {
        path: this.lodPath(binding, 'preview'),
        label: 'Preview Level',
        type: 'enum',
        options: [
          'Auto',
          ...binding.lod.levels.map((_level, index) => this.lodPreviewOption(binding, index)),
        ],
        group,
      },
      {
        path: this.lodPath(binding, 'active'),
        label: 'Active Level',
        type: 'string',
        readonly: true,
        group,
      },
    ];
    binding.lod.levels.forEach((_level, index) => {
      rows.push(
        {
          path: this.lodPath(binding, `level.${index}.object`),
          label: `Level ${index} Object`,
          type: 'string',
          readonly: true,
          group,
        },
        {
          path: this.lodPath(binding, `level.${index}.distance`),
          label: `Level ${index} Distance`,
          type: 'number',
          readonly: !binding.writableDistances.has(index),
          group,
        },
      );
    });
    if (binding.lod.levels.length > 0) {
      rows.push({
        path: this.lodPath(binding, 'hysteresis'),
        label: 'Hysteresis',
        type: 'number',
        readonly: !binding.writableHysteresis,
        group,
      });
    }
    return rows;
  }

  private lodValue(id: string, path: string): unknown {
    const binding = this.lodBindingForPath(id, path);
    if (!binding) return undefined;
    if (path.endsWith('.preview')) {
      const forced = this.store.getLodForcedLevel(id);
      return forced === null ? 'Auto' : this.lodPreviewOption(binding, forced);
    }
    if (path.endsWith('.active')) {
      const forced = this.store.getLodForcedLevel(id);
      return this.lodPreviewOption(binding, forced ?? binding.lod.getCurrentLevel());
    }
    if (path.endsWith('.hysteresis')) return binding.lod.levels[0]?.hysteresis;
    const match = /\.level\.(\d+)\.(object|distance)$/.exec(path);
    if (!match) return undefined;
    const level = binding.lod.levels[Number(match[1])];
    if (!level) return undefined;
    return match[2] === 'distance'
      ? level.distance
      : level.object.name || level.object.type || `Level ${match[1]}`;
  }

  private async writeLodToken(
    binding: LodSourceBinding,
    token: R3fLodNumberBinding,
    value: number,
    label: string,
    preview: () => void,
    rollback: () => void,
  ): Promise<boolean> {
    const backend = this.writeBackend;
    const history = this.store.shell.projectHistory;
    const file = binding.sourceFile;
    const source = file ? this.sources.get(file) : undefined;
    if (
      !backend ||
      !history ||
      !file ||
      source === undefined ||
      token.start < 0 ||
      token.end > source.length ||
      Number(source.slice(token.start, token.end)) !== token.value
    ) {
      return false;
    }
    preview();
    this.store.shell.notifyIngestEdit();
    const next = `${source.slice(0, token.start)}${fmt(value)}${source.slice(token.end)}`;
    try {
      await replaceProjectSource(backend, history, { file, source: next, label });
      this.sources.set(file, next);
      await this.refreshSourceState();
      return true;
    } catch (error) {
      rollback();
      this.store.shell.notifyIngestEdit();
      throw error;
    }
  }

  private writeLodDistance(
    binding: LodSourceBinding,
    level: number,
    rawValue: number,
  ): Promise<boolean> {
    const token = binding.source?.distances?.[level];
    if (!token || !binding.writableDistances.has(level)) return Promise.resolve(false);
    const value = normalizeLodDistance(binding, level, rawValue);
    const previous = binding.lod.levels[level]?.distance;
    return this.writeLodToken(
      binding,
      token,
      value,
      `Edit LOD ${level} distance`,
      () => previewLodDistance({ binding, level, value }),
      () => {
        const nativeLevel = binding.lod.levels[level];
        if (nativeLevel && previous !== undefined) nativeLevel.distance = previous;
      },
    );
  }

  private writeLodHysteresis(binding: LodSourceBinding, rawValue: number): Promise<boolean> {
    const token = binding.source?.hysteresis;
    if (!token || !binding.writableHysteresis) return Promise.resolve(false);
    const value = Math.round(Math.max(0, Math.min(1, rawValue)) * 1000) / 1000;
    const previous = binding.lod.levels.map((level) => level.hysteresis);
    return this.writeLodToken(
      binding,
      token,
      value,
      'Edit LOD hysteresis',
      () => {
        for (const level of binding.lod.levels) level.hysteresis = value;
      },
      () => {
        binding.lod.levels.forEach((level, index) => {
          level.hysteresis = previous[index] ?? level.hysteresis;
        });
      },
    );
  }

  private async writeJointParams(
    binding: JointSourceBinding,
    params: readonly R3fJointLiteral[],
  ): Promise<boolean> {
    const backend = this.writeBackend;
    const history = this.store.shell.projectHistory;
    const source = this.sources.get(binding.sourceFile);
    const before = binding.source.params;
    const ranges = binding.source.paramRanges;
    if (!backend || !history || source === undefined || !before || !ranges) return false;
    const replacements: SourceTokenReplacement[] = [];
    if (!collectJointTokenReplacements(source, before, params, ranges, replacements)) return false;
    if (replacements.length === 0) return false;
    replacements.sort((a, b) => b.start - a.start);
    let next = source;
    for (const replacement of replacements) {
      if (replacement.start < 0 || replacement.end > next.length) return false;
      next = `${next.slice(0, replacement.start)}${replacement.text}${next.slice(replacement.end)}`;
    }
    await replaceProjectSource(backend, history, {
      file: binding.sourceFile,
      source: next,
      label: `Edit ${humanizeIdentifier(binding.source.hook.replace(/^use/, ''))}`,
    });
    this.sources.set(binding.sourceFile, next);
    await this.refreshSourceState();
    return true;
  }

  /**
   * Is this row an OVERRIDE the editor can actually take back? Four conditions,
   * each of which is a way the revert arrow would otherwise lie:
   *
   * 1. The callsite authors the prop at all (`attr`). An absent attribute is
   *    already at its default — `defaulted` says so, and there is nothing to
   *    remove. A prop supplied only by a `{...spread}` is likewise not an attr:
   *    `analyzeJsxAttributes` skips spreads entirely, so it never appears here
   *    and no arrow offers to delete something it cannot address.
   * 2. The attribute is a literal, and this session has not already had a
   *    dynamic write refused on it — the same literal-vs-dynamic guard every
   *    other write on this adapter respects. `removePropAttribute` refuses an
   *    expression-bound attribute anyway; offering the arrow would just produce
   *    a click that does nothing.
   * 3. The component declares the prop OPTIONAL. Deleting a required prop
   *    leaves source that does not compile, so it is never offered — this is
   *    the one place our source-as-truth model is stricter than Unity's, and
   *    correctly so.
   * 4. This session actually has a backend that can perform the removal. With
   *    no write backend (a read-only hosted session), an arrow would promise a
   *    write nobody can make.
   */
  private isOverride(
    attr: JsxAttrInfo | undefined,
    spec: ComponentPropSpec | undefined,
    dynamicKey: string,
  ): boolean {
    if (!attr?.isLiteral || this.dynamicPaths.has(dynamicKey)) return false;
    if (!spec?.optional) return false;
    return !!this.writeBackend?.removeProp;
  }

  /**
   * One component's inspector rows: every prop it DECLARES (at its default
   * when the tag doesn't override it), then any extra attribute the tag
   * actually carries.
   *
   * Showing the declared surface — not just what someone typed — is the whole
   * difference from a text editor. It is also what makes a union render as a
   * dropdown instead of a free-text box: the widget comes from the declared
   * type, and only falls back to sniffing the attribute text when the
   * component's own type says nothing usable.
   */
  /**
   * The GROUND-TRUTH rung of the widget decision, between the declaration and
   * the text heuristic (ARCHITECTURE-CORE §The editor protocol, "Zero
   * inference": declaration → ground truth → loud heuristic).
   *
   * A native fiber tag (`<hemisphereLight>`, `<mesh>`) declares nothing — the
   * TypeScript-checker rung is defined as empty for it — so before this rung
   * every one of its props fell to the TEXT guess and warned. But for a MOUNTED
   * node the live THREE object is sitting right here, and `groundColor` on it
   * IS a `THREE.Color`: reading the mounted value's own kind is a measurement,
   * not a guess. Three's `isColor` brand rather than `instanceof`, because the
   * adapter deliberately imports three as types only and a brand survives
   * realms. `null` = the value's kind names no widget (objects, functions,
   * unset) — the loud heuristic below remains the honest fallback there.
   */
  private measuredTypeFor(
    liveObject: THREE.Object3D | null,
    name: string,
  ): PropertyDescriptor['type'] | null {
    if (!liveObject) return null;
    const value = (liveObject as unknown as Record<string, unknown>)[name];
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'object' && value !== null && (value as { isColor?: boolean }).isColor) {
      return 'color';
    }
    return null;
  }

  private componentProperties(
    subject: PropSubject,
    group: string,
    attrs: readonly JsxAttrInfo[],
    // Props a dedicated typed section (Light/Camera) owns for THIS object, so
    // the generic grid must not also emit them — the same reason
    // `PANEL_OWNED_PROPS` skips the transform tuples, but object-dependent
    // (a `distance` is light-owned only on a light), so it comes per call.
    ownedProps: ReadonlySet<string> = EMPTY_OWNED_PROPS,
    // The mounted THREE object these props configure, when the subject is the
    // node's own tag — the measured rung above reads it. A wrapper tag that
    // never became a node has none.
    liveObject: THREE.Object3D | null = null,
  ): PropertyDescriptor[] {
    const attrByName = new Map(attrs.map((attr) => [attr.name, attr]));
    const declared = subject.declared;
    const properties: PropertyDescriptor[] = [];
    const emit = (name: string, spec: ComponentPropSpec | undefined): void => {
      if (isHiddenProp(name) || PANEL_OWNED_PROPS.has(name) || ownedProps.has(name)) return;
      const attr = attrByName.get(name);
      // An unwritten prop whose default is a computed expression has no value
      // we can show honestly — show the expression, and don't pretend to edit it.
      const opaqueDefault =
        !attr && spec?.defaultText !== undefined && spec.defaultValue === undefined;
      const declaredType = spec?.type ?? null;
      const path = subject.pathFor(name);
      const resettable = this.isOverride(attr, spec, subject.keyFor(name));
      properties.push({
        path,
        label: humanizeIdentifier(name),
        type: opaqueDefault
          ? 'string'
          : (declaredType ??
            this.measuredTypeFor(liveObject, name) ??
            (attr ? this.descriptorTypeFor(attr, subject, name, spec) : 'string')),
        ...(spec?.options ? { options: [...spec.options] } : {}),
        readonly:
          opaqueDefault ||
          (attr ? !attr.isLiteral : false) ||
          this.dynamicPaths.has(subject.keyFor(name)),
        ...(attr ? {} : { defaulted: true }),
        ...(resettable ? { resettable: true } : {}),
        // H4 — name the destination, but only when the component actually
        // declares one. An optional prop with no declared default still reverts
        // (the row above stays `resettable`); what takes over is then the
        // component's own internal fallback, which nothing here can read, so the
        // affordance says "default" instead of inventing a value.
        ...(resettable && spec?.defaultText !== undefined ? { revertsTo: spec.defaultText } : {}),
        group,
      });
    };
    for (const spec of declared) emit(spec.name, spec);
    const declaredNames = new Set(declared.map((spec) => spec.name));
    for (const attr of attrs) {
      if (!declaredNames.has(attr.name)) emit(attr.name, undefined);
    }
    return properties;
  }

  /** Resolve source metadata from the exact resource mounted on the live
   * THREE.Scene. This is deliberately identity-based: an unused `<fog>` in a
   * story or an unmounted scene file must never become write authority merely
   * because its literal happens to match the current color. */
  private nativeEnvironmentSource(
    resource: unknown,
    kind: R3fEnvironmentBinding['kind'],
  ): NativeEnvironmentSource | null {
    const oid = ownOidOf(stampedResource(resource));
    const entry = oid ? this.oidIndex.get(oid) : undefined;
    return oid && entry?.environmentBinding?.kind === kind
      ? { oid, file: entry.file, binding: entry.environmentBinding }
      : null;
  }

  private canWriteEnvironmentToken(
    source: NativeEnvironmentSource | null,
    token: EnvironmentToken | undefined,
  ): boolean {
    if (
      !source ||
      !token ||
      !this.writeBackend?.readSource ||
      !this.writeBackend.applySource ||
      !this.store.shell.projectHistory
    ) {
      return false;
    }
    const text = this.sources.get(source.file);
    if (text === undefined || token.start < 0 || token.end > text.length) return false;
    const current = text.slice(token.start, token.end);
    return 'quote' in token
      ? current === `${token.quote}${token.value}${token.quote}`
      : Number(current) === token.value;
  }

  private backgroundSource(): NativeEnvironmentSource | null {
    return isThreeColor(this.scene.background)
      ? this.nativeEnvironmentSource(this.scene.background, 'background-color')
      : null;
  }

  private fogSource(): NativeEnvironmentSource | null {
    if (isLinearFog(this.scene.fog)) return this.nativeEnvironmentSource(this.scene.fog, 'fog');
    if (isExponentialFog(this.scene.fog)) {
      return this.nativeEnvironmentSource(this.scene.fog, 'fog-exp2');
    }
    return null;
  }

  private textureLabel(texture: THREE.Texture | null): string {
    if (!texture) return 'None';
    if ((texture as THREE.CubeTexture).isCubeTexture) return texture.name || 'Cube Texture';
    return texture.name || 'Texture';
  }

  /** Unity's Lighting settings, Unreal's Environment Light Mixer, Godot's
   * WorldEnvironment, and Blender's World properties all expose this same
   * scene-global subject. Here the rows remain native THREE.Scene state: lights,
   * post-processing, navigation, and physics keep their own established owners. */
  private worldProperties(): PropertyDescriptor[] {
    const properties: PropertyDescriptor[] = [
      { path: 'name', label: 'World', type: 'string', readonly: true, group: 'World' },
      {
        path: 'source.path',
        label: 'Entry',
        type: 'string',
        readonly: true,
        group: 'World',
      },
    ];
    const background = this.scene.background;
    const backgroundSource = this.backgroundSource();
    properties.push({
      path: `${WORLD_BACKGROUND_PATH_PREFIX}type`,
      label: 'Background',
      type: 'string',
      readonly: true,
      group: 'Environment',
    });
    if (isThreeColor(background)) {
      const token =
        backgroundSource?.binding.kind === 'background-color'
          ? backgroundSource.binding.color
          : undefined;
      properties.push({
        path: `${WORLD_BACKGROUND_PATH_PREFIX}color`,
        label: 'Background Color',
        type: 'color',
        readonly: !this.canWriteEnvironmentToken(backgroundSource, token),
        group: 'Environment',
      });
    } else if (isThreeTexture(background)) {
      properties.push(
        {
          path: `${WORLD_BACKGROUND_PATH_PREFIX}intensity`,
          label: 'Background Intensity',
          type: 'number',
          readonly: true,
          group: 'Environment',
        },
        {
          path: `${WORLD_BACKGROUND_PATH_PREFIX}blurriness`,
          label: 'Background Blur',
          type: 'number',
          readonly: true,
          group: 'Environment',
        },
        {
          path: `${WORLD_BACKGROUND_PATH_PREFIX}rotation`,
          label: 'Background Rotation Y',
          type: 'number',
          readonly: true,
          group: 'Environment',
        },
      );
    }
    properties.push({
      path: `${WORLD_ENVIRONMENT_PATH_PREFIX}map`,
      label: 'Lighting Environment',
      type: 'string',
      readonly: true,
      group: 'Environment',
    });
    if (this.scene.environment) {
      properties.push(
        {
          path: `${WORLD_ENVIRONMENT_PATH_PREFIX}intensity`,
          label: 'Environment Intensity',
          type: 'number',
          readonly: true,
          group: 'Environment',
        },
        {
          path: `${WORLD_ENVIRONMENT_PATH_PREFIX}rotation`,
          label: 'Environment Rotation Y',
          type: 'number',
          readonly: true,
          group: 'Environment',
        },
      );
    }

    const fog = this.scene.fog;
    const fogSource = this.fogSource();
    properties.push({
      path: `${WORLD_FOG_PATH_PREFIX}mode`,
      label: 'Mode',
      type: 'string',
      readonly: true,
      group: 'Fog',
    });
    if (fog) {
      const colorToken = fogSource?.binding.color;
      properties.push({
        path: `${WORLD_FOG_PATH_PREFIX}color`,
        label: 'Color',
        type: 'color',
        readonly: !this.canWriteEnvironmentToken(fogSource, colorToken),
        group: 'Fog',
      });
    }
    if (isLinearFog(fog)) {
      const binding = fogSource?.binding.kind === 'fog' ? fogSource.binding : undefined;
      properties.push(
        {
          path: `${WORLD_FOG_PATH_PREFIX}near`,
          label: 'Near',
          type: 'number',
          readonly: !this.canWriteEnvironmentToken(fogSource, binding?.near),
          group: 'Fog',
        },
        {
          path: `${WORLD_FOG_PATH_PREFIX}far`,
          label: 'Far',
          type: 'number',
          readonly: !this.canWriteEnvironmentToken(fogSource, binding?.far),
          group: 'Fog',
        },
      );
    } else if (isExponentialFog(fog)) {
      const binding = fogSource?.binding.kind === 'fog-exp2' ? fogSource.binding : undefined;
      properties.push({
        path: `${WORLD_FOG_PATH_PREFIX}density`,
        label: 'Density',
        type: 'number',
        readonly: !this.canWriteEnvironmentToken(fogSource, binding?.density),
        group: 'Fog',
      });
    }
    return properties;
  }

  private worldValue(path: string): unknown {
    const background = this.scene.background;
    const fog = this.scene.fog;
    if (path === 'name') return this.options.worldId;
    if (path === 'source.path') return this.options.entryPath;
    if (path === `${WORLD_BACKGROUND_PATH_PREFIX}type`) {
      if (!background) return 'None';
      if (isThreeColor(background)) return 'Color';
      return this.textureLabel(background);
    }
    if (path === `${WORLD_BACKGROUND_PATH_PREFIX}color` && isThreeColor(background)) {
      return `#${background.getHexString()}`;
    }
    if (path === `${WORLD_BACKGROUND_PATH_PREFIX}intensity`) {
      return this.scene.backgroundIntensity;
    }
    if (path === `${WORLD_BACKGROUND_PATH_PREFIX}blurriness`) {
      return this.scene.backgroundBlurriness;
    }
    if (path === `${WORLD_BACKGROUND_PATH_PREFIX}rotation`) {
      return (this.scene.backgroundRotation.y * 180) / Math.PI;
    }
    if (path === `${WORLD_ENVIRONMENT_PATH_PREFIX}map`) {
      return this.textureLabel(this.scene.environment);
    }
    if (path === `${WORLD_ENVIRONMENT_PATH_PREFIX}intensity`) {
      return this.scene.environmentIntensity;
    }
    if (path === `${WORLD_ENVIRONMENT_PATH_PREFIX}rotation`) {
      return (this.scene.environmentRotation.y * 180) / Math.PI;
    }
    if (path === `${WORLD_FOG_PATH_PREFIX}mode`) {
      return isLinearFog(fog) ? 'Linear' : isExponentialFog(fog) ? 'Exponential' : 'None';
    }
    if (path === `${WORLD_FOG_PATH_PREFIX}color` && fog) return `#${fog.color.getHexString()}`;
    if (path === `${WORLD_FOG_PATH_PREFIX}near` && isLinearFog(fog)) return fog.near;
    if (path === `${WORLD_FOG_PATH_PREFIX}far` && isLinearFog(fog)) return fog.far;
    if (path === `${WORLD_FOG_PATH_PREFIX}density` && isExponentialFog(fog)) return fog.density;
    return undefined;
  }

  private setWorldValue(path: string, value: unknown): Promise<boolean> | boolean {
    const background = this.scene.background;
    const fog = this.scene.fog;
    if (path === `${WORLD_BACKGROUND_PATH_PREFIX}color` && isThreeColor(background)) {
      const source = this.backgroundSource();
      const token = source?.binding.kind === 'background-color' ? source.binding.color : undefined;
      if (typeof value !== 'string' || !source || !token) return false;
      const previous = `#${background.getHexString()}`;
      return this.writeEnvironmentToken(
        source,
        token,
        value,
        'Edit background color',
        () => background.set(value),
        () => background.set(previous),
      );
    }
    const source = this.fogSource();
    if (!fog || !source) return false;
    if (path === `${WORLD_FOG_PATH_PREFIX}color` && typeof value === 'string') {
      const token = source.binding.color;
      if (!token) return false;
      const previous = `#${fog.color.getHexString()}`;
      return this.writeEnvironmentToken(
        source,
        token,
        value,
        'Edit fog color',
        () => fog.color.set(value),
        () => fog.color.set(previous),
      );
    }
    if (typeof value !== 'number') return false;
    if (path === `${WORLD_FOG_PATH_PREFIX}near` && isLinearFog(fog)) {
      const token = source.binding.kind === 'fog' ? source.binding.near : undefined;
      if (!token) return false;
      const previous = fog.near;
      const next = Math.max(0, Math.min(value, fog.far - 0.01));
      return this.writeEnvironmentToken(
        source,
        token,
        next,
        'Edit fog near',
        () => {
          fog.near = next;
        },
        () => {
          fog.near = previous;
        },
      );
    } else if (path === `${WORLD_FOG_PATH_PREFIX}far` && isLinearFog(fog)) {
      const token = source.binding.kind === 'fog' ? source.binding.far : undefined;
      if (!token) return false;
      const previous = fog.far;
      const next = Math.max(fog.near + 0.01, value);
      return this.writeEnvironmentToken(
        source,
        token,
        next,
        'Edit fog far',
        () => {
          fog.far = next;
        },
        () => {
          fog.far = previous;
        },
      );
    } else if (path === `${WORLD_FOG_PATH_PREFIX}density` && isExponentialFog(fog)) {
      const token = source.binding.kind === 'fog-exp2' ? source.binding.density : undefined;
      if (!token) return false;
      const previous = fog.density;
      const next = Math.max(0, value);
      return this.writeEnvironmentToken(
        source,
        token,
        next,
        'Edit fog density',
        () => {
          fog.density = next;
        },
        () => {
          fog.density = previous;
        },
      );
    }
    return false;
  }

  private async writeEnvironmentToken(
    source: NativeEnvironmentSource,
    token: EnvironmentToken,
    value: string | number,
    label: string,
    preview: () => void,
    rollback: () => void,
  ): Promise<boolean> {
    const backend = this.writeBackend;
    const history = this.store.shell.projectHistory;
    const text = this.sources.get(source.file);
    if (
      !backend ||
      !history ||
      text === undefined ||
      !this.canWriteEnvironmentToken(source, token)
    ) {
      return false;
    }
    let replacement: string;
    if ('quote' in token) {
      if (typeof value !== 'string' || normalizedHex(value) === null) return false;
      const escaped = value.replaceAll('\\', '\\\\').replaceAll(token.quote, `\\${token.quote}`);
      replacement = `${token.quote}${escaped}${token.quote}`;
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      replacement = fmt(value);
    }
    preview();
    this.store.shell.notifyIngestEdit();
    const next = `${text.slice(0, token.start)}${replacement}${text.slice(token.end)}`;
    try {
      await replaceProjectSource(backend, history, { file: source.file, source: next, label });
      this.sources.set(source.file, next);
      await this.refreshSourceState();
      return true;
    } catch (error) {
      rollback();
      this.store.shell.notifyIngestEdit();
      throw error;
    }
  }

  /** Whether an eye toggle has an honest native JSX destination. A custom
   * component must prove that `visible` reaches its single Object3D root;
   * otherwise adding the prop would create plausible-looking dead source. */
  private visibilityEditability(id: string): TransformEditability {
    if (this.borrowsRepresentativeCallsite(id)) {
      return {
        writable: false,
        reason: 'This rendered part has no visibility prop of its own.',
      };
    }
    const oid = this.oidOf(id);
    if (!oid) {
      return { writable: false, reason: 'This rendered part has no authored source identity.' };
    }
    if (!this.writeBackend?.writeProp) {
      return { writable: false, reason: 'This session has no source writer.' };
    }
    const attrs = this.attrsOf(id);
    if (!attrs) {
      return {
        writable: false,
        reason: 'Source metadata is still loading or unavailable.',
      };
    }
    const attr = attrs.find((candidate) => candidate.name === 'visible');
    const object = this.byId.get(id);
    if (object && this.isComponentBoundary(object)) {
      const entry = this.oidEntryOf(object);
      const contract = entry?.r3fAuthoring;
      if (contract?.visibleProp !== true) {
        return {
          writable: false,
          reason: `${entry?.tag ?? 'This component'} does not prove that visible reaches its ${contract?.rootTag ?? 'native'} root.`,
        };
      }
    }
    if (!attr) return { writable: true };
    if (!attr.isLiteral) {
      return {
        writable: false,
        reason: `visible is controlled by the JSX expression {${attr.rawValue}}.`,
      };
    }
    const booleanLiteral =
      attr.valueStart < 0 ||
      (attr.isExpression && (attr.rawValue === 'true' || attr.rawValue === 'false'));
    return booleanLiteral
      ? { writable: true }
      : { writable: false, reason: 'visible is not exposed as a boolean JSX literal.' };
  }

  private async writeVisibility(
    id: string,
    object: THREE.Object3D,
    value: boolean,
  ): Promise<boolean> {
    const editability = this.visibilityEditability(id);
    const oid = this.oidOf(id);
    const backend = this.writeBackend;
    if (!editability.writable || !oid || !backend?.writeProp) {
      const reason = editability.reason ?? 'No native visibility write is available.';
      console.warn(`[R3fSourceAuthoringAdapter] visibility write refused: ${reason}`);
      showTransientHint(reason);
      return false;
    }
    const previous = object.visible;
    const echoKey = this.echoKey(id, 'visible');
    object.visible = value;
    this.valueEcho.set(echoKey, value);
    this.store.shell.notifyIngestEdit();
    try {
      const result = await backend.writeProp(oid, 'visible', this.serializeValue(value), {
        addIfMissing: true,
      });
      if (result.changed) return true;
      if (result.dynamic) this.dynamicPaths.add(echoKey);
      object.visible = previous;
      this.valueEcho.delete(echoKey);
      this.store.shell.notifyIngestEdit();
      console.warn(
        `[R3fSourceAuthoringAdapter] visibility write refused for oid "${oid}": ` +
          `${result.dynamic ? 'dynamic expression (guarded)' : (result.error ?? 'no change')} — reverting.`,
      );
      return false;
    } catch (error) {
      object.visible = previous;
      this.valueEcho.delete(echoKey);
      this.store.shell.notifyIngestEdit();
      console.warn(
        `[R3fSourceAuthoringAdapter] visibility write failed for oid "${oid}": ${String(error)} — reverting.`,
      );
      return false;
    }
  }

  readonly inspector: InspectorProvider = {
    /** LIVE ONLY (seam: `InspectorProvider.preview`) — the value a dragged
     *  control is currently showing. Mutates the live object and nothing else;
     *  the control's own commit calls `set`, and any preview not followed by
     *  one is discarded by the next remount. */
    preview: (id, path, value): void => {
      const object = this.transformObject(id);
      if (!object) return;
      const field = typedFieldForPath(
        object,
        firstMaterial(object),
        path,
        this.sourceLocation(id)?.tag,
      );
      if (!field || field.type === 'asset') return;
      applyTypedField(object, firstMaterial(object), field, value);
      this.store.shell.notifyIngestEdit();
    },
    properties: (id): PropertyDescriptor[] => {
      if (id === this.documentNodeId) {
        return this.worldProperties();
      }
      const identity = this.byId.get(id);
      const object = this.transformObject(id);
      if (!identity || !object) return [];
      const visibleAttr = this.attrsOf(id)?.find((attr) => attr.name === 'visible');
      const visibility = this.visibilityEditability(id);
      // `name` is an ordinary literal JSX attr at the callsite — writable
      // exactly like `color` (absent adds via addIfMissing; a dynamic
      // expression stays guarded). It was declared readonly wholesale, so
      // the hierarchy's rename box took the text and silently reverted
      // (runhuman pass 21: "changing the name doesn't actually do anything").
      const nameAttr = this.attrsOf(id)?.find((attr) => attr.name === 'name');
      const properties: PropertyDescriptor[] = [
        {
          path: 'name',
          label: 'Name',
          type: 'string',
          readonly: !this.writeBackend?.writeProp || nameAttr?.isLiteral === false,
        },
        {
          path: 'visible',
          label: 'Visible',
          type: 'boolean',
          readonly: !visibility.writable,
          ...(!visibility.writable && visibility.reason
            ? { readonlyReason: visibility.reason }
            : {}),
          ...(visibleAttr ? {} : { defaulted: true }),
        },
        { path: 'locked', label: 'Locked', type: 'boolean' },
      ];
      const authoringSubject = object3DAuthoringSubjectOf(object);
      if (authoringSubject?.fields) {
        properties.push(
          ...authoringSubject
            .fields()
            .filter((field) => !['name', 'visible', 'locked'].includes(field.path))
            .map(({ value: _value, ...descriptor }) => descriptor),
        );
      }

      // Typed light/material/camera fields this object exposes right now
      // (§Roots — read the LIVE object; the write path below persists to
      // source). Its `self`-owned props (a light's `intensity`, a camera's
      // `fov`) are also skipped in the generic grid so a property never
      // renders twice.
      const shadow = lightShadowTypedField(object);
      const typed = [
        ...typedThreeFields(object, firstMaterial(object), this.sourceLocation(id)?.tag),
        ...(shadow ? [shadow] : []),
      ];
      const selfOwned = new Set(typed.filter((f) => f.target === 'self').map((f) => f.prop));
      const lodBindings = this.lodBindingsOf(id);
      if (lodBindings.length > 0) {
        selfOwned.add('distances');
        selfOwned.add('hysteresis');
      }

      for (const lod of lodBindings) properties.push(...this.lodRows(lod));

      const attrs = this.attrsOf(id);
      if (attrs) {
        // Wrapper tags that never became their own node contribute their own
        // sections, OUTERMOST FIRST — `<RigidBody>` reads above the mesh it
        // governs, the way a Unity inspector stacks a Rigidbody above a
        // Collider on one GameObject.
        for (const wrapper of this.collapsedWrappersOf(id)) {
          properties.push(
            ...this.componentProperties(
              this.wrapperSubject(wrapper.oid),
              humanizeIdentifier(wrapper.tag),
              this.attrsOfOid(wrapper.oid) ?? [],
            ),
          );
        }
        for (const collider of this.colliderBindingsOf(id)) {
          properties.push(...this.colliderDimensionRows(collider));
          properties.push(
            ...this.componentProperties(
              this.wrapperSubject(collider.sourceOid),
              humanizeIdentifier(collider.sourceTag),
              this.attrsOfOid(collider.sourceOid) ?? [],
              new Set(['args']),
            ),
          );
        }
        for (const joint of this.jointBindingsOf(id)) properties.push(...this.jointRows(joint));
        for (const particle of this.particleBindingsOf(id)) {
          properties.push(...this.particleRows(particle));
        }
        // The node's config groups under the COMPONENT that owns it — Unity,
        // Godot and Unreal all title a section with the thing whose fields it
        // holds, never with the mechanism that stores them ("JSX Props").
        // The source location is that section's first row, which is exactly
        // where Unity puts a MonoBehaviour's Script reference.
        const entry = this.oidEntryOf(identity);
        // Name the block after the tag that owns it — `Enemy`, `mesh` — the
        // same way the wrapper blocks above are named, and the same way Godot
        // titles a section with the class whose fields it holds.
        const group = entry?.tag ? humanizeIdentifier(entry.tag) : 'Properties';
        const location = this.sourceLocation(id);
        if (location) {
          properties.push({
            path: 'source.location',
            label: 'Source',
            type: 'string',
            readonly: true,
            group,
          });
        }
        const subject = this.nodeSubject(id);
        if (subject) {
          properties.push(...this.componentProperties(subject, group, attrs, selfOwned, object));
        }
      }

      for (const f of typed) properties.push(this.typedThreeRow(id, object, f));
      return properties;
    },

    editability: (id, path) => {
      if (path === 'visible') return this.visibilityEditability(id);
      if (path === 'locked') return { writable: this.byId.has(id) };
      return { writable: true };
    },

    get: (id, path) => {
      if (id === this.documentNodeId) {
        return this.worldValue(path);
      }
      const identity = this.byId.get(id);
      const object = this.transformObject(id);
      if (!identity || !object) return undefined;
      const echo = this.valueEcho.get(this.echoKey(id, path));
      if (echo !== undefined) return echo;
      if (path === 'name') return this.oidEntryOf(identity)?.tag || object.name || object.type;
      if (path === 'visible') return object.visible;
      if (path === 'locked') return this.lockedIds.has(id);
      if (path === 'object.type') return object.type;
      const subjectField = object3DAuthoringSubjectOf(object)
        ?.fields?.()
        .find((field) => field.path === path);
      if (subjectField) return subjectField.value();
      if (path === 'source.location') {
        const loc = this.sourceLocation(id);
        return loc ? `${loc.file.split('/').slice(-2).join('/')}:${loc.line}` : '';
      }
      const typedField = typedFieldForPath(
        object,
        firstMaterial(object),
        path,
        this.sourceLocation(id)?.tag,
      );
      if (typedField) return this.readTypedThree(object, typedField);
      const colliderArg = this.parseColliderArgPath(path);
      if (colliderArg) return this.colliderArgs(colliderArg.oid)?.[colliderArg.index];
      if (path.startsWith(JOINT_PATH_PREFIX)) return this.jointValue(id, path);
      if (path.startsWith(PARTICLE_PATH_PREFIX)) return this.particleValue(id, path);
      if (path.startsWith(LOD_PATH_PREFIX)) return this.lodValue(id, path);
      const wrapperPath = this.parseWrapperPropertyPath(path);
      if (wrapperPath) {
        return this.propValue(
          this.attrsOfOid(wrapperPath.oid),
          this.oidIndex.get(wrapperPath.oid)?.props ?? [],
          wrapperPath.prop,
        );
      }
      if (path.startsWith(JSX_PATH_PREFIX)) {
        const prop = path.slice(JSX_PATH_PREFIX.length);
        return this.propValue(this.attrsOf(id), this.declaredPropsOf(id), prop);
      }
      return undefined;
    },

    set: (id, path, value) => {
      if (id === this.documentNodeId) {
        return this.pipedSourceTokenWrite(async () => this.setWorldValue(path, value));
      }
      const identity = this.byId.get(id);
      const object = this.transformObject(id);
      if (!identity || !object) return;
      if (path === 'visible') {
        return this.pipedJsxWrite(
          () => this.writeVisibility(id, object, Boolean(value)),
          undefined,
          this.destinationOf(id),
        );
      }
      if (path === 'name') {
        const next = String(value ?? '').trim();
        if (!next || next === object.name) return;
        return this.pipedJsxWrite(
          () => this.writeJsxProp(id, 'name', 'name', next),
          undefined,
          this.destinationOf(id),
        );
      }
      if (path === 'locked') {
        if (value) this.lockedIds.add(id);
        else this.lockedIds.delete(id);
        this.store.shell.notifyIngestEdit();
        return;
      }
      const typedField = typedFieldForPath(
        object,
        firstMaterial(object),
        path,
        this.sourceLocation(id)?.tag,
      );
      if (typedField) {
        if (typedField.type === 'asset') return this.setTypedAsset(id, object, typedField, value);
        return this.pipedJsxWrite(
          () => this.writeTypedThree(id, object, typedField, value),
          undefined,
          this.destinationOf(id),
        );
      }
      const colliderArg = this.parseColliderArgPath(path);
      if (colliderArg && typeof value === 'number') {
        const args = this.colliderArgs(colliderArg.oid);
        if (!args || colliderArg.index >= args.length) return;
        args[colliderArg.index] = Math.max(0.01, value);
        return this.pipedJsxWrite(
          () =>
            this.writeOidProp(
              id,
              colliderArg.oid,
              `${COLLIDER_ARG_PATH_PREFIX}${encodeURIComponent(colliderArg.oid)}.args`,
              'args',
              args,
            ),
          undefined,
          this.destinationOf(id),
        );
      }
      const jointParam = this.jointParamPath(path);
      if (jointParam && typeof value === 'number') {
        const binding = this.jointBindingForPath(id, path);
        if (!binding?.writable || !binding.source.params) return;
        const params = binding.source.params.map((part) =>
          Array.isArray(part) ? [...part] : part,
        ) as R3fJointLiteral[];
        const current = params[jointParam.param];
        if (jointParam.part === undefined) {
          if (typeof current !== 'number') return;
          params[jointParam.param] = value;
        } else {
          if (!Array.isArray(current) || typeof current[jointParam.part] !== 'number') return;
          current[jointParam.part] = value;
        }
        return this.pipedSourceTokenWrite(() => this.writeJointParams(binding, params));
      }
      const particleField = this.particleFieldPath(path);
      if (particleField && typeof value === 'number') {
        const binding = this.particleBindingForPath(id, path);
        if (!binding || !binding.writableFields.has(particleField)) return;
        return this.pipedSourceTokenWrite(() =>
          this.writeParticleField(binding, particleField, value),
        );
      }
      if (path.startsWith(LOD_PATH_PREFIX)) {
        const binding = this.lodBindingForPath(id, path);
        if (!binding) return;
        if (path.endsWith('.preview')) {
          const match = typeof value === 'string' ? /^Level (\d+)/.exec(value) : null;
          const level = value === 'Auto' ? null : match ? Number(match[1]) : Number.NaN;
          if (
            level === null ||
            (Number.isInteger(level) && level >= 0 && level < binding.lod.levels.length)
          ) {
            this.store.setLodForcedLevel(id, level);
          }
          return;
        }
        const distance = /\.level\.(\d+)\.distance$/.exec(path);
        if (distance && typeof value === 'number') {
          return this.pipedSourceTokenWrite(() =>
            this.writeLodDistance(binding, Number(distance[1]), value),
          );
        }
        if (path.endsWith('.hysteresis') && typeof value === 'number') {
          return this.pipedSourceTokenWrite(() => this.writeLodHysteresis(binding, value));
        }
      }
      const wrapperPath = this.parseWrapperPropertyPath(path);
      if (wrapperPath) {
        return this.pipedJsxWrite(
          () => this.writeOidProp(id, wrapperPath.oid, path, wrapperPath.prop, value),
          undefined,
          this.destinationOf(id),
        );
      }
      if (path.startsWith(JSX_PATH_PREFIX)) {
        return this.pipedJsxWrite(
          () => this.writeJsxProp(id, path, path.slice(JSX_PATH_PREFIX.length), value),
          undefined,
          this.destinationOf(id),
        );
      }
      return;
    },

    /**
     * Revert to default = DELETE THE ATTRIBUTE. There is no separate stored
     * default to restore to in a JSX world: with the prop absent, the value in
     * force is the one the component's own signature declares. This is the
     * exact inverse of `set`'s append path — and the only door that restores
     * the BYTES a `set` that appended a prop moved, because writing the default
     * back leaves the attribute standing in the file.
     *
     * Through the SAME pipe `set` uses, so a removal answers for itself with a
     * per-edit ack the caller can await and believe. It resolves on
     * `removeProp` rather than `writeProp`: a session whose backend can write
     * but not remove reaches the live-only floor by name instead of acking a
     * destination no byte left.
     */
    remove: (id, path) => {
      const wrapperPath = this.parseWrapperPropertyPath(path);
      if (wrapperPath) {
        return this.pipedJsxRemove(
          () => this.removeOidProp(id, wrapperPath.oid, path, wrapperPath.prop),
          this.destinationOf(id),
        );
      }
      if (!path.startsWith(JSX_PATH_PREFIX)) return;
      const oid = this.oidOf(id);
      if (!oid) return;
      return this.pipedJsxRemove(
        () => this.removeOidProp(id, oid, path, path.slice(JSX_PATH_PREFIX.length)),
        this.destinationOf(id),
      );
    },
  };

  /** Native Three component values projected through the generic handle seam.
   * The viewport never learns Light, PositionalAudio, or JSX prop names; this
   * adapter owns both the live preview and the source-backed commit. */
  readonly spatialHandles: SpatialHandlesProvider = createThreeSpatialHandlesProvider({
    object: (id) => this.transformObject(id),
    sourceTag: (id) => this.sourceLocation(id)?.tag,
    writable: (id, path) => {
      const row = this.inspector.properties(id).find((property) => property.path === path);
      return !!row && row.readonly !== true;
    },
    commit: (id, path, value) => this.inspector.set(id, path, value),
    colliderBindings: (id) => this.colliderBindingsOf(id),
    previewCollider: (colliderId, shape) =>
      this.options.physics?.()?.previewCollider?.(colliderId, shape),
    commitCollider: (id, sourceOid, args) =>
      this.pipedJsxWrite(
        () =>
          this.writeOidProp(
            id,
            sourceOid,
            `${COLLIDER_ARG_PATH_PREFIX}${encodeURIComponent(sourceOid)}.args`,
            'args',
            args,
          ),
        undefined,
        this.destinationOf(id),
      ),
    jointBindings: (id) => this.jointBindingsOf(id),
    previewJointAnchor: (jointId, endpoint, anchor) =>
      this.options.physics?.()?.previewJointAnchor?.(jointId, endpoint, anchor),
    commitJoint: (binding, params) =>
      this.pipedSourceTokenWrite(() =>
        this.writeJointParams(binding, params as readonly R3fJointLiteral[]),
      ),
    particleBindings: (id) => this.particleBindingsOf(id),
    commitParticle: (binding, field, value) =>
      this.pipedSourceTokenWrite(() => this.writeParticleField(binding, field, value)),
    lodBindings: (id) => this.lodBindingsOf(id),
    commitLodDistance: (binding, level, value) =>
      this.pipedSourceTokenWrite(() => this.writeLodDistance(binding, level, value)),
  });

  /** Serialize an inspector value into the writer's `newValue` string. */
  private serializeValue(value: unknown): string {
    if (Array.isArray(value)) return tupleText(value.map((v) => Number(v)));
    if (typeof value === 'number') return fmt(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
  }

  /** The value in force for one prop: the authored attribute if the tag carries
   *  it, else the default the component's own signature declares. */
  private propValue(
    attrs: readonly JsxAttrInfo[] | null,
    declared: readonly ComponentPropSpec[],
    prop: string,
  ): unknown {
    const attr = attrs?.find((candidate) => candidate.name === prop);
    if (attr) return this.literalValueOf(attr);
    const spec = declared.find((candidate) => candidate.name === prop);
    return spec ? (spec.defaultValue ?? spec.defaultText) : undefined;
  }

  /**
   * Key for the optimistic value echo held until the remount reports source.
   * A WRAPPER path already names the tag it writes to, and one wrapper can
   * govern several nodes (`<RigidBody><A/><B/></RigidBody>`), so it is keyed by
   * path alone — an edit made while A is selected must also show on B.
   */
  private echoKey(id: string, path: string): string {
    return path.startsWith(WRAPPER_PATH_PREFIX) ? path : `${id}|${path}`;
  }

  /** Convert an absolute OID-index filename back to the project-relative path
   * used by the manifest. Vite indexes absolute files, while an in-memory or
   * storage-backed tier may already supply relative ones. */
  private projectRelativeSourceFile(file: string): string {
    const normalized = file.replaceAll('\\', '/');
    const entryPath = this.options.entryPath.replaceAll('\\', '/').replace(/^\.\//, '');
    if (!normalized.startsWith('/') && !/^[A-Za-z]:\//.test(normalized)) return normalized;
    for (const entry of this.oidIndex.values()) {
      const indexed = entry.file.replaceAll('\\', '/');
      if (indexed !== entryPath && !indexed.endsWith(`/${entryPath}`)) continue;
      const projectPrefix = indexed.slice(0, -entryPath.length);
      if (normalized.startsWith(projectPrefix)) return normalized.slice(projectPrefix.length);
    }
    return entryPath;
  }

  /** {@link pipedJsxWrite} for a REMOVAL — same dialect, same anchor, but the
   *  verb that has to be bound is `removeProp`. */
  private pipedJsxRemove(
    remove: () => Promise<boolean>,
    destination: string = this.options.entryPath,
  ): Promise<WriteAck> {
    return this.pipedJsxWrite(remove, this.writeBackend?.removeProp !== undefined, destination);
  }

  private async removeOidProp(
    id: string,
    oid: string,
    path: string,
    prop: string,
  ): Promise<boolean> {
    if (!this.writeBackend?.removeProp) {
      console.warn(`[R3fSourceAuthoringAdapter] cannot revert "${prop}": no source-write backend.`);
      return false;
    }
    // No optimistic echo: the value after a revert is the component's declared
    // default, which the remount reports from source. Echoing a guess here
    // would show a value the file does not have.
    this.valueEcho.delete(this.echoKey(id, path));
    const res = await this.writeBackend.removeProp(oid, prop);
    if (!res.changed) {
      this.store.shell.notifyIngestEdit();
      console.warn(
        `[R3fSourceAuthoringAdapter] revert refused/no-op for oid "${oid}" prop "${prop}": ` +
          `${res.dynamic ? 'dynamic expression (guarded)' : (res.error ?? 'no change')}`,
      );
      return false;
    }
    // Re-read the file the write just changed, so the panel stops showing the
    // deleted attribute (row grey again, arrow gone, value back to the declared
    // default) without waiting for the HMR remount. This is NOT the `set`
    // path's optimistic echo: nothing is guessed here — the source on disk is
    // re-read and believed, which is the only honest way to show a value we
    // were never told.
    await this.refreshSourceState();
    return true;
  }

  /** Write one prop onto a KNOWN tag (a wrapper that is not a node of its own,
   *  or a behavior source), rather than resolving the oid from a node id. */
  private async writeOidProp(
    id: string,
    oid: string,
    path: string,
    prop: string,
    value: unknown,
  ): Promise<boolean> {
    if (!this.writeBackend?.writeProp) {
      console.warn(`[R3fSourceAuthoringAdapter] cannot write "${prop}": no source-write backend.`);
      return false;
    }
    const echoKey = this.echoKey(id, path);
    this.valueEcho.set(echoKey, value);
    this.store.shell.notifyIngestEdit();
    let res: Awaited<ReturnType<NonNullable<SourceWriteBackend['writeProp']>>>;
    try {
      res = await this.writeBackend.writeProp(oid, prop, this.serializeValue(value), {
        addIfMissing: true,
      });
    } catch (error) {
      this.valueEcho.delete(echoKey);
      this.store.shell.notifyIngestEdit();
      console.warn(
        `[R3fSourceAuthoringAdapter] prop write failed for oid "${oid}" prop "${prop}": ${String(error)}`,
      );
      return false;
    }
    if (!res.changed) {
      this.valueEcho.delete(echoKey);
      if (res.dynamic) this.dynamicPaths.add(echoKey);
      this.store.shell.notifyIngestEdit();
      console.warn(
        `[R3fSourceAuthoringAdapter] prop write refused/no-op for oid "${oid}" prop "${prop}": ` +
          `${res.dynamic ? 'dynamic expression (guarded)' : (res.error ?? 'no change')}`,
      );
      return false;
    }
    return true;
  }

  private async writeJsxProp(
    id: string,
    path: string,
    prop: string,
    value: unknown,
  ): Promise<boolean> {
    const oid = this.oidOf(id);
    if (!oid || !this.writeBackend?.writeProp) {
      console.warn(
        `[R3fSourceAuthoringAdapter] cannot write "${prop}" on "${id}": ` +
          `${oid ? 'no source-write backend in this session' : 'node has no source stamp'}.`,
      );
      return false;
    }
    const echoKey = `${id}|${path}`;
    this.valueEcho.set(echoKey, value);
    this.store.shell.notifyIngestEdit();
    let res: Awaited<ReturnType<NonNullable<SourceWriteBackend['writeProp']>>>;
    try {
      res = await this.writeBackend.writeProp(oid, prop, this.serializeValue(value), {
        // Editing a prop the tag doesn't carry yet APPENDS it — a component prop
        // sitting at the default its own signature declares. Overriding a default
        // is an ordinary authoring act; it must not need a trip to the text
        // editor.
        // `name` is always appendable: it is what the hierarchy row reads,
        // every Object3D carries it, and a component that forwards its root
        // props takes it — the syntactic specs cannot see a forwarded
        // `name`, and a rename of a name-less dropped instance
        // silently did nothing (runhuman pass 46).
        addIfMissing:
          prop === 'name' || this.declaredPropsOf(id).some((spec) => spec.name === prop),
      });
    } catch (error) {
      this.valueEcho.delete(echoKey);
      this.store.shell.notifyIngestEdit();
      console.warn(
        `[R3fSourceAuthoringAdapter] prop write failed for oid "${oid}" prop "${prop}": ${String(error)}`,
      );
      return false;
    }
    if (!res.changed) {
      this.valueEcho.delete(echoKey);
      if (res.dynamic) this.dynamicPaths.add(echoKey);
      this.store.shell.notifyIngestEdit();
      console.warn(
        `[R3fSourceAuthoringAdapter] prop write refused/no-op for oid "${oid}" prop "${prop}": ` +
          `${res.dynamic ? 'dynamic expression (guarded)' : (res.error ?? 'no change')}`,
      );
      return false;
    }
    return true;
  }

  /** The source tag whose attribute a typed field writes: the object's own
   *  element (`self`), or its material's child element (`material`). */
  private typedFieldOid(id: string, object: THREE.Object3D, field: TypedThreeField): string | null {
    return field.target === 'material' ? this.materialOidOf(object) : this.oidOf(id);
  }

  /**
   * THE PROP THAT DRIVES A DYNAMIC MATERIAL FIELD, when the instance authors it.
   *
   * A prefab's material reads its component's prop — `<meshStandardMaterial
   * color={color} />` — so the material attribute is an expression and the
   * typed write refuses. But the value in force is a LITERAL sitting on the
   * instance's own callsite (`<HeroBox color="#c8dce1" />`), which is exactly
   * what the generic prop row writes. Two human passes changed a prefab's
   * colour, watched it revert, and read the editor as broken (runhuman 66/67);
   * the callsite is the honest destination, so the write goes there instead of
   * refusing. Only a BARE IDENTIFIER matching a prop the instance's component
   * DECLARES routes — an expression (`color={hot ? a : b}`) has no single
   * attribute to write and keeps its refusal.
   */
  private propDrivingTypedField(
    id: string,
    object: THREE.Object3D,
    field: TypedThreeField,
  ): string | null {
    if (field.target !== 'material') return null;
    const materialOid = this.materialOidOf(object);
    if (!materialOid) return null;
    const attr = this.attrsOfOid(materialOid)?.find((a) => a.name === field.prop);
    if (!attr || attr.isLiteral) return null;
    const identifier = attr.rawValue.trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(identifier)) return null;
    return this.declaredPropsOf(id).some((spec) => spec.name === identifier) ? identifier : null;
  }

  /** One typed light/material/camera inspector row. Reads the LIVE value; the
   *  attribute's literal-vs-dynamic state decides editability the SAME way the
   *  generic component grid does — a dynamic (expression-bound) attribute is
   *  read-only, an unwritten one is a greyed default that an edit appends. */
  private typedThreeRow(
    id: string,
    object: THREE.Object3D,
    field: TypedThreeField,
  ): PropertyDescriptor {
    // A TEXTURE SLOT is not a JSX attribute at all — `map={…}` binds a
    // `THREE.Texture` a loader hook produced, so there is no literal for the
    // attribute scan to find and "unwritten" would grey every slot forever.
    // It is writable whenever there is a material to assign to; the
    // source-persistence half refuses per edit (see `setTypedThree`), which is
    // where that honesty belongs.
    if (field.type === 'asset') {
      return {
        path: field.path,
        label: field.label,
        type: field.type,
        group: field.group,
        readonly: !firstMaterial(object),
        ...(firstMaterial(object)
          ? {}
          : { readonlyReason: 'This object has no material to assign a texture to.' }),
      };
    }
    const oid = this.typedFieldOid(id, object, field);
    const attrs =
      field.target === 'material' ? (oid ? this.attrsOfOid(oid) : null) : this.attrsOf(id);
    const attr = attrs?.find((a) => a.name === field.prop) ?? null;
    const routedProp = this.propDrivingTypedField(id, object, field);
    const dynamic =
      ((attr ? !attr.isLiteral : false) && !routedProp) ||
      this.dynamicPaths.has(`${id}|${field.path}`);
    const writable = !!oid && !!this.writeBackend?.writeProp && !dynamic;
    return {
      path: field.path,
      label: field.label,
      type: field.type,
      ...(field.options ? { options: [...field.options] } : {}),
      group: field.group,
      readonly: !writable,
      ...(attr ? {} : { defaulted: true }),
    };
  }

  private readTypedThree(object: THREE.Object3D, field: TypedThreeField): unknown {
    return readTypedField(object, firstMaterial(object), field);
  }

  /**
   * A TEXTURE-SLOT assignment: real on the live material, and honestly
   * unpersisted here.
   *
   * This lane's one dialect is the JSX ATTRIBUTE writer, and a texture is not
   * expressible as one — `<meshStandardMaterial map={brick} />` binds an object
   * a loader hook (`useTexture`) produced in the component's own body, so
   * persisting this assignment means editing the component's imports, hook
   * calls and bindings, not an attribute literal. Writing the path as a string
   * attribute would produce source that does not compile to the thing the
   * author just saw, which is precisely the fabrication the anti-shim rule
   * forbids.
   *
   * So the edit resolves LIVE-ONLY through the same pipe every other refusal
   * uses: the value lands on the running material for this session, the ack
   * says `persisted: false`, and the reason names the mechanism.
   */
  private setTypedAsset(
    id: string,
    object: THREE.Object3D,
    field: TypedThreeField,
    value: unknown,
  ): Promise<WriteAck> {
    const material = firstMaterial(object);
    const applied = applyTypedField(object, material, field, value);
    if (applied !== null) {
      this.valueEcho.set(`${id}|${field.path}`, readTypedField(object, material, field));
      this.store.shell.notifyIngestEdit();
    }
    return runWritePipe({
      resolve: (): WriteResolution =>
        resolvesLiveOnly(
          applied === null
            ? `"${field.label}" has no material on "${id}" to assign to`
            : `a texture slot binds a loaded THREE.Texture, not a JSX attribute literal — ` +
                `assigning "${field.prop}" in source means adding a useTexture() binding to the ` +
                `component, which this adapter's attribute writer cannot author`,
        ),
      record: () => undefined,
      report: (reason) =>
        console.warn(`[R3fSourceAuthoringAdapter] this edit stays live-only — ${reason}.`),
    });
  }

  /** Apply a typed edit: mutate the live object for an immediate preview, then
   *  persist the attribute to source through the SAME `writeProp` path a
   *  Transform or a JSX-prop edit uses (`addIfMissing` appends an unwritten
   *  attribute; the remount converges on the same value from source). */
  private async writeTypedThree(
    id: string,
    object: THREE.Object3D,
    field: TypedThreeField,
    value: unknown,
  ): Promise<boolean> {
    // The instance prop that drives this field, when the material binds one
    // (see `propDrivingTypedField`): write the CALLSITE literal the user can
    // actually own, through the same door the generic prop row uses.
    const routedProp = this.propDrivingTypedField(id, object, field);
    if (routedProp) {
      const material = firstMaterial(object);
      const before = readTypedField(object, material, field);
      const applied = applyTypedField(object, material, field, value);
      if (applied === null) return false;
      this.store.shell.notifyIngestEdit();
      const wrote = await this.writeJsxProp(
        id,
        `${JSX_PATH_PREFIX}${routedProp}`,
        routedProp,
        applied,
      );
      if (!wrote && before !== null && before !== undefined) {
        applyTypedField(object, material, field, before);
        this.store.shell.notifyIngestEdit();
      }
      return wrote;
    }
    const oid = this.typedFieldOid(id, object, field);
    const material = firstMaterial(object);
    if (!oid || !this.writeBackend?.writeProp) {
      console.warn(
        `[R3fSourceAuthoringAdapter] cannot write "${field.path}" on "${id}": ` +
          `${oid ? 'no source-write backend in this session' : 'no source stamp for this field'}.`,
      );
      return false;
    }
    const before = readTypedField(object, material, field);
    const applied = applyTypedField(object, material, field, value);
    if (applied === null) return false;
    const echoKey = `${id}|${field.path}`;
    this.valueEcho.set(echoKey, readTypedField(object, material, field));
    this.store.shell.notifyIngestEdit();
    let res: Awaited<ReturnType<NonNullable<SourceWriteBackend['writeProp']>>>;
    try {
      res = await this.writeBackend.writeProp(oid, field.prop, this.serializeValue(applied), {
        addIfMissing: true,
      });
    } catch (error) {
      this.valueEcho.delete(echoKey);
      await this.refreshSourceState();
      this.store.shell.notifyIngestEdit();
      console.warn(
        `[R3fSourceAuthoringAdapter] typed "${field.prop}" write failed for oid "${oid}": ${String(error)}`,
      );
      return false;
    }
    if (!res.changed) {
      // THE PROP THAT DRIVES IT, when the server says the material attribute is
      // expression-bound and this instance DECLARES a prop of that name. A
      // prefab's material reads its component's prop (`color={color}`), so the
      // value in force is the literal on the instance's own callsite
      // (`<HeroBox color="#c8dce1" />`) — the honest destination, and the one
      // the generic prop row already writes. Two human passes changed a
      // prefab's colour, watched it revert, and read the editor as broken
      // (runhuman 66/67). Gated on the server's own `dynamic` verdict, so a
      // literal that merely failed to change never routes here.
      if (res.dynamic && this.declaredPropsOf(id).some((spec) => spec.name === field.prop)) {
        this.valueEcho.delete(echoKey);
        if (await this.writeJsxProp(id, `${JSX_PATH_PREFIX}${field.prop}`, field.prop, applied)) {
          return true;
        }
      }
      this.valueEcho.delete(echoKey);
      if (res.dynamic) this.dynamicPaths.add(echoKey);
      // Same contract as the transform path above: a refused source write
      // REVERTS the live preview, so the widget never keeps showing a value
      // that did not land (a human changed a prefab's material color, saw it
      // stick on screen, and reported the editor lying when the card and the
      // next remount disagreed — runhuman pass 41). The narration goes to the
      // EDITOR console: a raw console.warn is invisible in the product.
      if (before !== null && before !== undefined) applyTypedField(object, material, field, before);
      this.store.shell.notifyIngestEdit();
      editorConsole.warn(
        `“${field.prop}” on “${this.hierarchy.node(id)?.label ?? id}” is ${
          res.dynamic
            ? 'bound to an expression in the component’s own source, so a direct edit cannot land — the preview was reverted. Edit the prop that drives it (or the component source) instead.'
            : `not writable here (${res.error ?? 'no change'}) — the preview was reverted.`
        }`,
        'editor',
      );
      return false;
    }
    return true;
  }

  // --------------------------------------------------------------- clipboard

  /** The selected source elements as useful plain JSX, highest ancestors only
   * and in source order. Selecting a group and one of its children copies the
   * group once, exactly as a scene hierarchy treats that selection. */
  private structureClipboardPayload(ids: readonly string[]): R3fStructureClipboard | null {
    const selected = new Set(ids);
    const topLevel = [...new Set(ids)].filter((id) => {
      let parentId = this.hierarchy.node(id)?.parentId ?? null;
      while (parentId) {
        if (selected.has(parentId)) return false;
        parentId = this.hierarchy.node(parentId)?.parentId ?? null;
      }
      return true;
    });
    const elements: Array<{ file: string; offset: number; text: string }> = [];
    const seenOids = new Set<string>();
    for (const id of topLevel) {
      const oid = this.oidOf(id);
      if (!oid || seenOids.has(oid)) continue;
      seenOids.add(oid);
      const entry = this.oidIndex.get(oid);
      const source = entry ? this.sources.get(entry.file) : undefined;
      if (!entry || source === undefined) return null;
      const offset = lineColToOffset(source, entry.line, entry.col);
      const end = findElementEnd(source, offset);
      if (source[offset] !== '<' || end <= offset) return null;
      const sourceIndent = source.slice(source.lastIndexOf('\n', offset - 1) + 1, offset);
      const raw = source.slice(offset, end);
      const text = /^\s*$/.test(sourceIndent)
        ? raw
            .split('\n')
            .map((line, index) =>
              index > 0 && line.startsWith(sourceIndent) ? line.slice(sourceIndent.length) : line,
            )
            .join('\n')
        : raw;
      elements.push({ file: entry.file, offset, text });
    }
    if (elements.length === 0) return null;
    const sourceFile = elements[0]!.file;
    if (elements.some((element) => element.file !== sourceFile)) return null;
    elements.sort((a, b) => a.offset - b.offset);
    // A paste that lands byte-identically ON its source reads as "nothing was
    // pasted" (runhuman pass 19) — carry a landing shift, sized at copy time
    // from the first copied object's own width, the way duplicates offset.
    const firstObject = this.transformObject(topLevel[0] ?? '');
    const width = firstObject
      ? new Box3().setFromObject(firstObject).getSize(new Vector3()).x
      : Number.NaN;
    return {
      sourceFile,
      text: elements.map((element) => element.text).join('\n'),
      count: elements.length,
      pasteOffset: [Number.isFinite(width) && width > 0 ? width + 0.5 : 1.5, 0, 0],
    };
  }

  private refuseStructureClipboard(reason: string): false {
    console.warn(`[R3fSourceAuthoringAdapter] ${reason}`);
    showTransientHint(reason);
    return false;
  }

  private async copyStructure(ids: readonly string[]): Promise<boolean> {
    this.structureClipboard = null;
    const payload = this.structureClipboardPayload(ids);
    if (!payload) {
      return this.refuseStructureClipboard(
        'Copy needs source-addressable entities from one source file. Generated or cross-file selections stay unchanged.',
      );
    }
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard?.writeText) {
      return this.refuseStructureClipboard(
        'The system clipboard is unavailable, so no entities were copied.',
      );
    }
    try {
      await clipboard.writeText(payload.text);
    } catch {
      return this.refuseStructureClipboard('The system clipboard refused the entity copy.');
    }
    this.structureClipboard = payload;
    showTransientHint(`Copied ${payload.count} ${payload.count === 1 ? 'entity' : 'entities'}.`);
    return true;
  }

  private async cutStructure(ids: readonly string[]): Promise<false | WriteAck> {
    if (!(await this.copyStructure(ids))) return false;
    return clipboardOutcome(await this.removeMany(ids));
  }

  private clipboardPasteTarget(
    parentId: string | null,
  ): { id: string; oid: string; file: string; op: 'create' | 'create-sibling' } | null {
    if (!parentId || parentId === this.documentNodeId) {
      const topLevel = this.topLevelEntryElements();
      const id = topLevel.at(-1) ?? null;
      const oid = id ? this.oidOf(id) : null;
      const entry = oid ? this.oidIndex.get(oid) : undefined;
      if (!id || !oid || !entry) return null;
      // INTO THE SCENE'S BELT, exactly as a drop with nothing selected goes
      // (see `assetDropPlan`): the world's content lives in its scene, and the
      // scene's placeables live inside a provider. Appending at the definition
      // root's tail put the paste OUTSIDE `<Physics>` — select a tree, Ctrl+C,
      // Ctrl+V, and the world died on `useRapier must be used within
      // <Physics/>` and auto-undid (runhuman pass 124), the same crash the drop
      // lane fixed three times over before it learned the belt.
      const entryScene = this.topLevelInstanceDefinitionRoot(id);
      if (entryScene && this.childrenSlotForOid(entryScene.oid) === 'open') {
        const anchor = this.sceneDropAnchor(entryScene);
        return anchor
          ? { id, oid: anchor, file: entryScene.file, op: 'create-sibling' }
          : { id, oid: entryScene.oid, file: entryScene.file, op: 'create' };
      }
      // A sole JSX return value cannot gain an adjacent sibling without first
      // being wrapped in a fragment. When it is an open composition root, its
      // children ARE the document-root entities, so insert there. Multiple
      // top-level live rows already imply a multi-root source shape and can
      // safely append after the last one.
      const op =
        topLevel.length === 1 && this.childrenSlotForOid(oid) === 'open'
          ? 'create'
          : topLevel.length > 1
            ? 'create-sibling'
            : null;
      return op ? { id, oid, file: entry.file, op } : null;
    }
    const oid = this.definitionOid(parentId) ?? this.oidOf(parentId);
    const entry = oid ? this.oidIndex.get(oid) : undefined;
    if (!oid || !entry || this.childrenSlotForOid(oid) !== 'open') return null;
    // A scene ROW as the target means the same thing: next to its placeables.
    const definition = this.definitionOid(parentId);
    if (definition) {
      const anchor = this.sceneDropAnchor({ oid: definition, file: entry.file });
      if (anchor) return { id: parentId, oid: anchor, file: entry.file, op: 'create-sibling' };
    }
    return { id: parentId, oid, file: entry.file, op: 'create' };
  }

  private canPasteStructure(parentId: string | null): boolean {
    const payload = this.structureClipboard;
    const target = this.clipboardPasteTarget(parentId);
    return !!payload && !!target && target.file === payload.sourceFile;
  }

  private async pasteStructure(parentId: string | null): Promise<false | WriteAck> {
    const payload = this.structureClipboard;
    if (!payload) {
      return this.refuseStructureClipboard('Copy or cut an entity in this scene before pasting.');
    }
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard?.readText) {
      return this.refuseStructureClipboard(
        'The system clipboard is unavailable, so nothing was pasted.',
      );
    }
    try {
      // Compare with line endings NORMALIZED: Windows round-trips a
      // multi-line copy through the OS clipboard as CRLF, so a nine-entity
      // block came back "changed" and the paste refused while a single-line
      // copy passed (runhuman pass 35 — the refusal named itself, which is
      // how the tester could tell us). A real foreign overwrite still differs
      // after normalization.
      const normalize = (text: string): string => text.replace(/\r\n/g, '\n');
      if (normalize(await clipboard.readText()) !== normalize(payload.text)) {
        return this.refuseStructureClipboard(
          'The clipboard changed after the entity copy, so nothing was pasted.',
        );
      }
    } catch {
      return this.refuseStructureClipboard('The system clipboard refused the entity paste.');
    }
    const target = this.clipboardPasteTarget(parentId);
    if (!target) {
      return this.refuseStructureClipboard(
        'Paste needs a source-addressable parent with a children slot.',
      );
    }
    if (target.file !== payload.sourceFile) {
      return this.refuseStructureClipboard(
        'Cross-file paste is refused because the destination may not import the copied component dependencies.',
      );
    }
    const snippet = payload.pasteOffset
      ? offsetSnippetPositions(payload.text, payload.pasteOffset)
      : payload.text;
    this.recordPendingCreatedSelection(
      target.op === 'create'
        ? target.id
        : (this.hierarchy.node(target.id)?.parentId ?? this.documentNodeId),
    );
    return clipboardOutcome(await this.structOp(target.id, target.op, { snippet }, target.oid));
  }

  // -------------------------------------------------------------- structure

  readonly structure: StructureProvider = {
    // R3 — preset create: the hierarchy's Create submenu (driven by
    // `creatableKinds` below) inserts an R3F-idiomatic snippet as the last
    // child of the selected source-addressable element, through the SAME
    // sha-guarded whole-file undo path as delete/duplicate. The new node's
    // id is unknowable until the remount stamps it (oids are content
    // signatures assigned server-side), so the `id` half is '' — the same
    // honest convention `ReactRootAuthoringAdapter.structure.create` uses —
    // and the `ack` half is this creation's own piped write, handed back
    // rather than fired `void` (see `StructuralIdWrite`).
    create: (kind, parentId) => {
      const snippet = R3F_CREATE_PRESETS[kind];
      if (!snippet || !parentId) {
        return {
          id: '',
          ack: this.structRefusal(
            `create refused: ${
              snippet ? 'no parent node given' : `unknown preset kind "${kind}"`
            }.`,
          ),
        };
      }
      // Component rows use their CALLSITE oid for instance props, but their
      // child hierarchy belongs inside the returned native root. Target that
      // definition-side root for Add Child; native rows already use their own
      // oid for both concerns.
      const definitionOid = this.definitionOid(parentId);
      const parentOid = definitionOid ?? this.oidOf(parentId);
      const parentFile = parentOid ? this.oidIndex.get(parentOid)?.file : undefined;
      const ack = this.structOp(
        parentId,
        'create',
        {
          snippet,
          ...(kind === 'reflectionProbe'
            ? {
                ensureImport: {
                  name: 'ReflectionProbe',
                  module: relativeImportSpecifier(
                    parentFile
                      ? this.projectRelativeSourceFile(parentFile)
                      : this.options.entryPath,
                    'src/lib/reflections',
                  ),
                },
              }
            : {}),
        },
        parentOid,
      );
      // In INSTANCES mode a native preset created under a NESTED component
      // row lands in that component's DEFINITION, where this view folds it
      // (only the top-level instance is transparent — see
      // `insideTransparentTopLevel`) and a viewport click resolves to the
      // owner — so the element the author just made cannot be selected from
      // this document. That is an OPEN gap, warned by name, never a silent
      // success (a human tester followed a softer version of this message
      // into the read-only asset preview and could not scale it).
      const parentObject = this.byId.get(parentId);
      const folded =
        this.options.hierarchyMode !== 'definition' &&
        definitionOid !== undefined &&
        kind !== 'reflectionProbe' &&
        !(parentObject && this.insideTransparentTopLevel(parentObject));
      if (!folded) return { id: '', ack };
      const parentLabel = this.hierarchy.node(parentId)?.label ?? parentId;
      const label = R3F_CREATE_LABELS[kind] ?? kind;
      const file = parentFile ? this.projectRelativeSourceFile(parentFile) : undefined;
      return {
        id: '',
        ack: ack.then((result) => {
          if (result.persisted) {
            editorConsole.warn(
              `Added ${label} inside ${parentLabel}'s definition${file ? ` (${file})` : ''}. ` +
                `This hierarchy folds ${parentLabel}'s own elements under it, so the new ${label} ` +
                `cannot be selected here yet — edit it in ${file ?? 'that file'} ` +
                `(right-click ${parentLabel} → Open Component Source).`,
              'authoring',
            );
          }
          return result;
        }),
      };
    },
    creatableKinds: (parentId) => {
      // Presets are offered only when the selected row's native composition
      // root is source-addressable and has a real children slot. For a custom
      // component row that is the definition-side root described above; for a
      // native row it is the row's own element.
      if (!parentId || parentId === this.documentNodeId) return [];
      const parentOid = this.definitionOid(parentId) ?? this.oidOf(parentId);
      if (!parentOid || this.childrenSlotForOid(parentOid) !== 'open') return [];
      return Object.keys(R3F_CREATE_PRESETS)
        .filter((kind) => kind !== 'reflectionProbe' || this.reflectionProbeAvailable)
        .map((kind) => ({
          kind,
          label: R3F_CREATE_LABELS[kind] ?? kind,
        }));
    },
    // R3 — wrap selection in `<group>` / replace a wrapper with its children.
    // Both are existing writer ops (`wrapElement`/`unwrapElement`), newly
    // exposed for R3F worlds; the group tag is the R3F-idiomatic container.
    wrap: (id, wrapperTag) => this.structOp(id, 'wrap', { wrapperTag: wrapperTag ?? 'group' }),
    unwrap: (id) => this.structOp(id, 'unwrap'),
    group: (ids) => {
      const uniqueIds = [...new Set(ids)];
      // Nothing was attempted, so there is no write to ack — `void` is the
      // honest outcome, not a fabricated live-only floor.
      if (uniqueIds.length < 2 || !this.writeBackend?.writeStructMany) {
        return { id: null, ack: undefined };
      }
      const nodes = uniqueIds.map((id) => this.hierarchy.node(id));
      const parentId = nodes[0]?.parentId;
      if (
        !parentId ||
        nodes.some((node) => !node || node.parentId !== parentId) ||
        uniqueIds.some((id) => !this.oidOf(id))
      ) {
        return {
          id: null,
          ack: this.structRefusal('group requires two or more source-addressable siblings.'),
        };
      }
      // The remount assigns the new group its content-derived OID; there is no
      // honest synchronous id to return before the source write completes — but
      // the write's own ack is, and it goes back with it.
      return { id: '', ack: this.groupMany(uniqueIds) };
    },
    canUngroup: (id) => {
      const object = this.byId.get(id);
      const entry = object ? this.oidEntryOf(object) : null;
      return Boolean(
        object &&
          entry?.tag === 'group' &&
          !this.isComponentBoundary(object) &&
          this.hierarchy.node(id)?.childIds.length,
      );
    },
    ungroup: (id) => {
      if (!this.structure.canUngroup?.(id)) return { ids: [], ack: undefined };
      const children = this.hierarchy.node(id)?.childIds ?? [];
      // The promoted children keep the ids they already had, so THIS half is
      // genuinely synchronous; the source write's ack is not, and rides along.
      return { ids: [...children], ack: this.structOp(id, 'unwrap') };
    },
    remove: (id) => this.dropSelectionOnRemoval([id], this.structOp(id, 'delete')),
    removeMany: (ids) => this.dropSelectionOnRemoval(ids, this.removeMany(ids)),
    copy: (ids) => this.copyStructure(ids),
    canCopy: (ids) => this.structureClipboardPayload(ids) !== null,
    cut: (ids) => this.cutStructure(ids),
    paste: (parentId) => this.pasteStructure(parentId),
    canPaste: (parentId) => this.canPasteStructure(parentId),
    // The copy's own oid is minted by the remount, so the id half answers with
    // the SOURCE id (see `StructureProvider.duplicate`) and the ack half is the
    // write itself — handed back so `duplicateSelection` can await each id's
    // byte before firing the next, the same serialization `remove` needs.
    duplicate: (id) => {
      this.recordPendingCreatedSelection(
        this.hierarchy.node(id)?.parentId ?? this.documentNodeId,
        id,
      );
      return {
        id,
        ack: this.structOp(id, 'duplicate', { duplicate: this.duplicateRewrite(id) }),
      };
    },
    // A hierarchy drag rewrites SOURCE, so it is gated like one (R1–R4, see
    // `ui-source/reparent-guard.ts`). Everything decidable from the source text
    // — lexical capture, the destination's children slot, literal-vs-dynamic
    // transform channels — is decided by the shared planner; this side supplies
    // the two facts only the live scene has (the re-based local transform, and
    // how many times each side actually renders) and turns every refusal into a
    // sentence the author can read.
    reparent: (id, newParentId) => {
      // Onto a TOP-LEVEL instance row ("Main Scene") means "back under the
      // scene": the callsite `<Scene/>` lives in another file and renders no
      // children, so the honest destination is the definition's root — the
      // same routing a Content drop takes. A human grouped two cubes, moved a
      // third in, and could not move it back out ("cannot move across
      // files" — runhuman pass 47).
      const parentOid = newParentId
        ? (this.topLevelInstanceDefinitionRoot(newParentId)?.oid ?? this.oidOf(newParentId))
        : null;
      if (!parentOid) {
        return this.refuseReparent(
          newParentId
            ? 'That row has no authored source element to move into.'
            : 'The world root is not an authored source element — drop onto a row instead.',
        );
      }
      const context = this.reparentContext(id, newParentId!);
      if ('error' in context) return this.refuseReparent(context.error);
      return this.reparentThrough(id, parentOid, context);
    },
    reorder: (id, beforeSiblingId) => {
      const opts: { targetOid?: string; parentOid?: string } = {};
      if (beforeSiblingId) {
        const targetOid = this.oidOf(beforeSiblingId);
        if (!targetOid) {
          return this.structRefusal('reorder target has no source stamp — refused.');
        }
        opts.targetOid = targetOid;
      } else {
        const node = this.hierarchy.node(id);
        const parentOid = node?.parentId ? this.oidOf(node.parentId) : null;
        if (!parentOid) {
          return this.structRefusal('reorder-to-end needs a source-addressable parent — refused.');
        }
        opts.parentOid = parentOid;
      }
      return this.structOp(id, 'reorder', opts);
    },
  };

  // ------------------------------------------------------------- asset drop
  //
  // "Drag a model from the asset browser into your scene" — the core authoring
  // loop — expressed in this adapter's own truth: a JSX element written into the
  // world source, through the SAME sha-guarded whole-file struct path
  // delete/duplicate/create already use, so an insert is one undo entry for free.
  //
  // Two callers, two shapes of target (see `AssetDropProvider`):
  //   - the VIEWPORT passes `''` plus the world point under the cursor. `''` (and
  //     the document row, which the composite translates to `''`) means "the world
  //     itself": the model is appended after the LAST top-level element authored in
  //     the entry file. A world's root JSX is usually a fragment, which carries no
  //     OID and so cannot be inserted INTO — but its children all carry one, which
  //     is what `create-sibling` exists for.
  //   - the HIERARCHY passes the row dropped on and no position. That row's element
  //     hosts the model as its last child (`create`), which requires an element
  //     with a children slot: a self-closing tag and an unstamped row are both
  //     refused BY NAME rather than silently mis-placed.

  readonly assetDrop: AssetDropProvider = {
    accepts: (nodeId, assetPath, context) => {
      // Warm the declared-prop read while the drag is still over the target,
      // so the drop below usually finds it resolved.
      const component = context?.item?.kind === 'component' ? context.item : null;
      if (component) void this.ensureComponentPropSpecs(component);
      return this.assetDropPlan(nodeId, assetPath, context).ok;
    },
    drop: async (nodeId, assetPath, context) => {
      const component = context?.item?.kind === 'component' ? context.item : null;
      if (component) {
        await this.ensureComponentPropSpecs(component);
        // A component that needs what no drop can give is refused by name
        // (the canvas lane refuses the same way): a required, defaultless,
        // non-enum prop means the bare element throws in its first render
        // and the world goes down (runhuman pass 148's <Bunker grid>).
        const missing = this.unsuppliedRequiredProps(component);
        if (missing.length > 0) {
          const said =
            `${component.name} needs ${missing.map((spec) => `\`${spec.name}\``).join(', ')} — ` +
            'required props with no default, which a drop cannot supply. Place it from a story ' +
            `that provides them, or give them defaults in ${component.sourcePath}.`;
          console.warn(`[R3fSourceAuthoringAdapter] asset drop refused — ${said}`);
          showTransientHint(said);
          return;
        }
      }
      const plan = this.assetDropPlan(nodeId, assetPath, context);
      if (!plan.ok) {
        // Both callers consult `accepts` first, so this is the direct-call path
        // (a test, the composite, a future caller) — it still says why, in both
        // channels, rather than dropping the gesture on the floor.
        console.warn(`[R3fSourceAuthoringAdapter] asset drop refused — ${plan.reason}`);
        showTransientHint(plan.reason);
        return;
      }
      // A DROP SELECTS WHAT IT MADE, like duplicate and paste (runhuman pass
      // 51's rule). Without it the new element landed unselected behind the
      // hierarchy's child cap — "… 11 more" — and a human hunting for the
      // thing they just dropped had to expand and read (pass 122: "some of
      // these items… I don't think they're loading"). The copy-selection
      // resolver needs the element the write went AFTER and that element's
      // hierarchy parent; a sibling drop knows both from its anchor oid.
      const anchorId = plan.op === 'create-sibling' ? this.idForOid(plan.sourceOid) : null;
      const createdUnder = anchorId
        ? (this.hierarchy.node(anchorId)?.parentId ?? plan.parentId)
        : plan.parentId;
      this.recordPendingCreatedSelection(createdUnder, anchorId ?? undefined);
      return this.structOp(
        plan.parentId,
        plan.op,
        { snippet: plan.snippet, ensureImport: plan.ensureImport },
        plan.sourceOid ?? null,
      );
    },
  };

  /** The live id of an oid's representative occurrence, or null. */
  private idForOid(oid: string | undefined): string | null {
    if (!oid) return null;
    const object = this.oidRepresentative.get(oid);
    return object ? (this.idByObject.get(object) ?? null) : null;
  }

  /** Decide a drop WITHOUT writing: either the exact source op it becomes, or the
   *  sentence explaining why this world cannot take it. `accepts` and `drop` read
   *  the same answer so the drag affordance and the write can never disagree. */
  private assetDropPlan(
    nodeId: string,
    assetPath: string,
    context?: AssetDropContext,
  ): AssetDropPlan {
    if (!this.writeBackend) {
      return { ok: false, reason: 'This session has no source writer, so nothing can be added.' };
    }
    const component = context?.item?.kind === 'component' ? context.item : null;
    if (component && component.surface !== 'three') {
      return {
        ok: false,
        reason: `${component.name} is a ${component.surface} component, not a Three prefab.`,
      };
    }
    if (!component && !MODEL_EXTENSION_RE.test(assetPath)) {
      return {
        ok: false,
        reason:
          `${assetPath} is not a .glb/.gltf model. A three world mounts models as scene ` +
          'nodes; an image or an audio file has no element to become here — a texture ' +
          'belongs on a material, not in the hierarchy.',
      };
    }
    const snippetFor = (siblingParentId: string | null): string =>
      component
        ? this.componentSnippet(component.name, context, siblingParentId)
        : this.modelSnippet(assetPath, context, siblingParentId);
    if (nodeId === '' || nodeId === this.documentNodeId) {
      const parentId = this.lastTopLevelEntryElement();
      if (!parentId) {
        return {
          ok: false,
          reason:
            `No top-level element of this world is authored in ${this.options.entryPath}, so ` +
            'there is nowhere to append the model — drop it onto a hierarchy row instead.',
        };
      }
      // NOTHING SELECTED MEANS "INTO THE WORLD", AND THE WORLD'S CONTENT LIVES
      // IN ITS SCENE. Appending as a SIBLING of the entry's last top-level row
      // puts the drop beside `<CitadelScene/>`, next to policy components like
      // `<InputRig/>` — outside every provider the scene mounts. A prefab that
      // needs one dies there and takes the world with it before its first
      // commit: `useRapier must be used within <Physics />`, which blocked one
      // tester on TerraceTree and another on CitadelTower (runhuman passes 101
      // and 108), and `<Physics>` sits inside the scene component in all three
      // physics examples — the thin-entry layout the template teaches.
      //
      // A drop ONTO that scene row already resolves correctly, and says why in
      // the branch below: the callsite renders no children, so the honest
      // target is the definition's own root. An empty selection means the same
      // thing, so it takes the same path. Only when the last top-level row is
      // not an enterable component does the sibling append stand.
      const entryScene = this.topLevelInstanceDefinitionRoot(parentId);
      if (entryScene && this.childrenSlotForOid(entryScene.oid) === 'open') {
        // WHERE inside the scene: next to the scene's OWN placeables, not as
        // the root group's last child. The root's tail sits OUTSIDE every
        // provider the scene mounts — `<Physics>` wraps the arena's content in
        // all three physics examples — so a prefab carrying a `RigidBody`
        // appended there dies before first commit (`useRapier must be used
        // within <Physics/>`), the world crashes, and the auto-undo reverts
        // the drop: the human sees "it didn't get added" plus console errors
        // (runhuman passes 101/108/113; reproduced with file-level evidence,
        // 2026-09-01 — the write landed as `</Physics>`'s sibling and was
        // auto-reverted). The anchor is read from the scene's own source, not
        // guessed: the parent of the LAST component-instance element in the
        // definition file is where this scene keeps things like the thing
        // being dropped. A scene with no instances anchors at its root, as
        // before.
        const anchor = this.sceneDropAnchor(entryScene);
        return {
          ok: true,
          parentId,
          op: anchor ? 'create-sibling' : 'create',
          snippet: snippetFor(parentId),
          sourceOid: anchor ?? entryScene.oid,
          ensureImport: component
            ? this.componentImport(parentId, component, entryScene.file)
            : { name: GLTF_TAG, module: DREI_MODULE },
        };
      }
      return {
        ok: true,
        parentId,
        op: 'create-sibling',
        snippet: snippetFor(this.documentNodeId),
        ensureImport: component
          ? this.componentImport(parentId, component)
          : { name: GLTF_TAG, module: DREI_MODULE },
      };
    }
    if (!this.oidOf(nodeId)) {
      return { ok: false, reason: 'That row has no authored source element to add the model to.' };
    }
    // A drop onto a TOP-LEVEL component instance row ("Main Scene") means
    // "into the scene": the callsite `<Scene/>` renders no children, so the
    // honest target is the definition's own root — the file whose natives
    // the hierarchy already shows as this row's children. A nested instance
    // stays a sealed unit, exactly as its rows do.
    const definitionRoot = this.topLevelInstanceDefinitionRoot(nodeId);
    if (definitionRoot) {
      const definitionSlot = this.childrenSlotForOid(definitionRoot.oid);
      if (definitionSlot !== 'open') {
        return {
          ok: false,
          reason:
            definitionSlot === 'unknown'
              ? "That component's source file has not loaded yet — try the drop again in a moment."
              : `${this.hierarchy.node(nodeId)?.label ?? 'That component'}'s root element is written self-closing, so nothing can be authored inside it.`,
        };
      }
      // Same anchor rule as the empty-selection branch above: insert AFTER the
      // scene's last placeable, inside whatever provider it lives in.
      const rowAnchor = this.sceneDropAnchor(definitionRoot);
      return {
        ok: true,
        parentId: nodeId,
        op: rowAnchor ? 'create-sibling' : 'create',
        snippet: snippetFor(nodeId),
        sourceOid: rowAnchor ?? definitionRoot.oid,
        ensureImport: component
          ? this.componentImport(nodeId, component, definitionRoot.file)
          : { name: GLTF_TAG, module: DREI_MODULE },
      };
    }
    const slot = this.childrenSlot(nodeId);
    if (slot === 'unknown') {
      return {
        ok: false,
        reason: "That row's source file has not loaded yet — try the drop again in a moment.",
      };
    }
    if (slot === 'self-closing') {
      const tag = this.hierarchy.node(nodeId)?.label ?? 'That element';
      return {
        ok: false,
        reason:
          `<${tag}> is written self-closing, so it has no children slot to put the model in. ` +
          'Drop onto a row that wraps its children, or onto the viewport.',
      };
    }
    return {
      ok: true,
      parentId: nodeId,
      op: 'create',
      snippet: snippetFor(nodeId),
      ensureImport: component
        ? this.componentImport(nodeId, component)
        : { name: GLTF_TAG, module: DREI_MODULE },
    };
  }

  /** A dropped instance is named the way a duplicate is — the next free
   *  "<Component> N" among the rows it lands beside — so two drops never read
   *  as one thing twice in the hierarchy (a human's third cube arrived as a
   *  bare "HeroBox" row next to "Hero Box" and "Hero Box 2" — pass 45). */
  /**
   * A dropped thing gets a name no sibling already has.
   *
   * Both drop kinds need this and only one had it: a component drop produced
   * "Jump Pad 2" while three dropped models were all called "Barrel", so a
   * scene with three of them had three identical rows and a human reported
   * that clicking one "can't be selected" — it selected a different barrel of
   * the same name (runhuman pass 100). One rule, one implementation, so the
   * two drop paths cannot drift apart again.
   */
  private uniqueSiblingName(base: string, siblingParentId: string | null): string {
    const siblingLabels = new Set(
      (siblingParentId ? (this.hierarchy.node(siblingParentId)?.childIds ?? []) : [])
        .map((childId) => this.hierarchy.node(childId)?.label)
        .filter((label): label is string => typeof label === 'string'),
    );
    let name = base;
    for (let n = 2; siblingLabels.has(name); n++) name = `${base} ${n}`;
    return name;
  }

  private componentSnippet(
    name: string,
    context: AssetDropContext | undefined,
    siblingParentId: string | null,
  ): string {
    const instanceName = this.uniqueSiblingName(name, siblingParentId);
    const component = context?.item?.kind === 'component' ? context.item : null;
    const attrs =
      ` name=${JSON.stringify(instanceName)}` +
      (context?.position ? ` position={${tupleText(context.position)}}` : '') +
      (component ? this.requiredEnumDefaults(component) : '');
    return `<${name}${attrs} />`;
  }

  /**
   * The declared-prop specs of a droppable component, by definition — the
   * backend's per-definition door (`componentProps`), resolved once per
   * component and read synchronously by the snippet. `null` when the backend
   * has no door or the read failed: the drop then writes what it always wrote.
   */
  private readonly componentPropSpecs = new Map<string, readonly ComponentPropSpec[] | null>();
  private readonly componentPropSpecsPending = new Map<string, Promise<void>>();

  private componentSpecKey(component: DroppableComponent): string {
    return `${component.sourcePath}::${component.exportKind}:${component.name}`;
  }

  private ensureComponentPropSpecs(component: DroppableComponent): Promise<void> {
    const key = this.componentSpecKey(component);
    if (this.componentPropSpecs.has(key)) return Promise.resolve();
    const pending = this.componentPropSpecsPending.get(key);
    if (pending) return pending;
    const door = this.writeBackend?.componentProps;
    if (!door) {
      this.componentPropSpecs.set(key, null);
      return Promise.resolve();
    }
    const read = door(this.projectRelativeSourceFile(component.sourcePath), {
      name: component.name,
      exportKind: component.exportKind,
    })
      .then((specs) => {
        this.componentPropSpecs.set(key, specs);
      })
      .catch((error: unknown) => {
        console.warn(
          `[R3fSourceAuthoringAdapter] declared props of ${component.name} unavailable — ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
        this.componentPropSpecs.set(key, null);
      })
      .finally(() => {
        this.componentPropSpecsPending.delete(key);
      });
    this.componentPropSpecsPending.set(key, read);
    return read;
  }

  /**
   * A REQUIRED enum prop is written with its FIRST option, so the drop renders
   * something. The snippet used to write only name/position, and a component
   * whose `kind: WeaponKind` is required rendered NOTHING until the author
   * found the prop (`[WeaponModel] no such kind undefined` on every
   * `<WeaponPickup>` drop — runhuman pass 123). Only enums: their first option
   * is a real value the component accepts; a required string or number has no
   * honest default and is left for the author, as before. Props the snippet
   * already writes, and props with a declared default, are skipped.
   */
  /** Required, defaultless props the snippet cannot write: not an enum (which
   *  gets its first option) and not one the snippet owns. */
  private unsuppliedRequiredProps(component: DroppableComponent): ComponentPropSpec[] {
    const specs = this.componentPropSpecs.get(this.componentSpecKey(component));
    if (!specs) return [];
    return specs.filter(
      (spec) =>
        !spec.optional &&
        spec.defaultText === undefined &&
        spec.type !== 'enum' &&
        !SNIPPET_OWNED_PROPS.has(spec.name),
    );
  }

  private requiredEnumDefaults(component: DroppableComponent): string {
    const specs = this.componentPropSpecs.get(this.componentSpecKey(component));
    if (!specs) return '';
    let attrs = '';
    for (const spec of specs) {
      if (spec.optional || spec.defaultText !== undefined || spec.type !== 'enum') continue;
      if (SNIPPET_OWNED_PROPS.has(spec.name)) continue;
      const first = spec.options?.[0];
      if (first === undefined) continue;
      attrs +=
        typeof first === 'string'
          ? ` ${spec.name}=${JSON.stringify(first)}`
          : ` ${spec.name}={${first}}`;
    }
    return attrs;
  }

  /**
   * The element a scene-level drop inserts AFTER: the last component-instance
   * element in the definition file (source order). Inserting as its SIBLING
   * places the drop inside whatever provider the scene's own placeables live
   * in — `<Physics>` in the three physics examples — without asking any
   * children-slot question about the provider element itself (an IMPORTED
   * component's slot answers 'unknown', which is exactly how the first
   * version of this anchor silently fell back to the crashing root; verified
   * live: the useRapier crash survived the parent-based anchor). `null` when
   * the definition has no component instances — the caller falls back to
   * appending at the definition root, as before.
   */
  private sceneDropAnchor(definitionRoot: { oid: string; file: string }): string | null {
    // The belt is chosen by POPULATION, not by position: the parent element
    // holding the MOST component instances is where this scene keeps its
    // placeables (`<Physics>` in the physics examples, the root group
    // elsewhere). "Last capitalized element in the file" was the previous
    // rule, and it silently anchored OUTSIDE the belt — third-person's file
    // ends `</Physics> <PerspectiveCamera/>`, so drops landed beside the
    // camera and every physics prefab crashed on useRapier (verified live,
    // twice). Anchoring after the belt's own last child needs no
    // children-slot answer about the provider, and non-physics elements
    // render identically inside `<Physics>`, so the belt is safe for every
    // droppable.
    let belt: { oid: string; line: number; col: number }[] | null = null;
    for (const list of this.sceneInstancesByParent(definitionRoot).values()) {
      if (!belt || list.length > belt.length) belt = list;
    }
    if (!belt) return null;
    let last = belt[0]!;
    for (const entry of belt) {
      if (entry.line > last.line || (entry.line === last.line && entry.col > last.col))
        last = entry;
    }
    return last.oid;
  }

  /** The scene component's own component-instance elements, grouped by their
   *  PARENT element's oid — the raw material {@link sceneDropAnchor} picks the
   *  placeable belt from. Scoped to the definition root's component body: a
   *  definition file can hold several components. */
  private sceneInstancesByParent(definitionRoot: {
    oid: string;
    file: string;
  }): Map<string, { oid: string; line: number; col: number }[]> {
    const rootComponent = this.oidIndex.get(definitionRoot.oid)?.component ?? null;
    const byParent = new Map<string, { oid: string; line: number; col: number }[]>();
    for (const [oid, entry] of this.oidIndex) {
      if (entry.file !== definitionRoot.file) continue;
      if (rootComponent !== null && entry.component !== rootComponent) continue;
      if (!/^[A-Z]/.test(entry.tag)) continue; // component instances only
      if (oid === definitionRoot.oid) continue;
      const list = byParent.get(entry.parentOid ?? '') ?? [];
      list.push({ oid, line: entry.line, col: entry.col });
      byParent.set(entry.parentOid ?? '', list);
    }
    return byParent;
  }

  /** The definition-side root element of a TOP-LEVEL component instance row,
   *  or null for anything else (a native, a nested instance, a row with no
   *  definition stamp). */
  private topLevelInstanceDefinitionRoot(id: string): { oid: string; file: string } | null {
    const object = this.byId.get(id);
    if (!object || !isComponentInstanceRoot(object)) return null;
    if (this.componentOwnerChain(object).length > 1) return null;
    const oid = this.definitionOid(id);
    const file = oid ? this.oidIndex.get(oid)?.file : undefined;
    return oid && file ? { oid, file } : null;
  }

  private componentImport(
    parentId: string,
    component: DroppableComponent,
    fromFile?: string,
  ): { name: string; module: string; kind: 'default' | 'named' } {
    const from = fromFile ?? this.sourceLocation(parentId)?.file ?? this.options.entryPath;
    return {
      name: component.name,
      module: this.relativeProjectModule(from, component.sourcePath),
      kind: component.exportKind,
    };
  }

  private relativeProjectModule(fromFile: string, targetFile: string): string {
    const fromProject = this.projectRelativeSourceFile(fromFile);
    const fromParts = fromProject.split('/').slice(0, -1);
    const targetParts = normalizeProjectPath(this.projectRelativeSourceFile(targetFile))
      .replace(/\.[cm]?[jt]sx?$/, '')
      .split('/');
    while (fromParts[0] && fromParts[0] === targetParts[0]) {
      fromParts.shift();
      targetParts.shift();
    }
    const relative = [...fromParts.map(() => '..'), ...targetParts].join('/');
    return relative.startsWith('.') ? relative : `./${relative}`;
  }

  /** The drei one-liner (see {@link MODEL_EXTENSION_RE}'s comment for why this
   *  element and not a hand-rolled loader component). `position` is written only
   *  when the caller knew one — a hierarchy drop deliberately places the model at
   *  its parent's origin rather than inventing a point. */
  /**
   * A DROPPED MODEL IS A GROUP THAT CONTAINS A `<Gltf>`, not a bare `<Gltf>`.
   *
   * The identity stamp this editor addresses nodes by (`userData-oid`) is
   * pierced onto a HOST element by fiber. `<Gltf>` is a third-party COMPONENT,
   * so the stamp's survival depends on drei forwarding props through `Clone`
   * onto whatever host element it happens to create — and measurably it does
   * not arrive: a dropped model rendered, persisted across reload and could be
   * clicked, but never got a hierarchy row, and the gizmo refused it as "a
   * rendered part with no authored source identity" (runhuman passes 82 and
   * 83, the second a literal question-by-question diagnostic).
   *
   * Wrapping it in a `<group>` — a host element this transform stamps directly
   * — gives the drop a real node: a hierarchy row, a transform to move, and a
   * name to rename. It is also what a person writes by hand when they want to
   * place a model, so the callsite stays ordinary source with no editor-only
   * construct in it.
   */
  private modelSnippet(
    assetPath: string,
    context: AssetDropContext | undefined,
    siblingParentId: string | null,
  ): string {
    const groupAttrs = [
      `name="${jsxAttrText(this.uniqueSiblingName(modelNodeName(assetPath), siblingParentId))}"`,
    ];
    if (context?.position) groupAttrs.push(`position={${tupleText(context.position)}}`);
    return (
      `<group ${groupAttrs.join(' ')}>\n` +
      `  <${GLTF_TAG} src="${jsxAttrText(assetPath)}" />\n` +
      `</group>`
    );
  }

  /** The world-level insertion anchor: the top-level row whose element sits LAST
   *  in the entry file, so an appended sibling lands at the end of the world's own
   *  block. Null when no top-level row is authored there (an entry that only
   *  renders imported components' internals, or a source fetch that hasn't
   *  landed). */
  private lastTopLevelEntryElement(): string | null {
    return this.topLevelEntryElements().at(-1) ?? null;
  }

  /** Source-ordered authored rows immediately below the virtual document. */
  private topLevelEntryElements(): string[] {
    const entryFile = normalizeProjectPath(this.options.entryPath);
    const entries: Array<{ id: string; offset: number }> = [];
    for (const childId of this.hierarchy.node(this.documentNodeId)?.childIds ?? []) {
      const oid = this.oidOf(childId);
      const entry = oid ? this.oidIndex.get(oid) : undefined;
      if (!entry || normalizeProjectPath(entry.file) !== entryFile) continue;
      const src = this.sources.get(entry.file);
      if (src === undefined) continue;
      const offset = lineColToOffset(src, entry.line, entry.col);
      if (src[offset] !== '<') continue; // stale index vs source — never guess
      entries.push({ id: childId, offset });
    }
    entries.sort((a, b) => a.offset - b.offset);
    return entries.map((entry) => entry.id);
  }

  /** Whether the row's element can host children in SOURCE. `unknown` when the
   *  file isn't cached — never assumed open, because `insertChildElement` on a
   *  self-closing tag silently writes a SIBLING instead of a child. */
  private childrenSlot(id: string): 'open' | 'self-closing' | 'unknown' {
    const oid = this.oidOf(id);
    return oid ? this.childrenSlotForOid(oid) : 'unknown';
  }

  private childrenSlotForOid(oid: string): 'open' | 'self-closing' | 'unknown' {
    const entry = this.oidIndex.get(oid);
    if (!entry) return 'unknown';
    const src = this.sources.get(entry.file);
    if (src === undefined) return 'unknown';
    const start = lineColToOffset(src, entry.line, entry.col);
    if (src[start] !== '<') return 'unknown';
    const tagEnd = findTagEnd(src, start);
    if (tagEnd < 0) return 'unknown';
    return src[tagEnd - 1] === '/' ? 'self-closing' : 'open';
  }

  /** One refusal sentence, said in both channels the editor has: the console (for a
   *  log a test or an agent can read) and the transient hint (for the author who just
   *  dragged the row). A silent refusal is the failure mode this whole gate exists to
   *  replace. */
  private refuseReparent(reason: string): Promise<WriteAck> {
    return this.structRefusal(`reparent refused — ${reason}`, reason);
  }

  /**
   * R2/R3's live half: the local transform that keeps the element exactly where it is
   * on screen once the destination's accumulated parent transform applies to it, plus
   * the render counts each side has.
   *
   * Refuses BEFORE any write when a channel that must change is not writable — an
   * expression-bound `position={spawn}`, or a component that does not forward the
   * channel to its native root. `transformEditability` already owns that question and
   * already phrases the answer, so this is the gizmo's rule reused rather than a second
   * opinion about the same source.
   */
  private reparentContext(
    id: string,
    newParentId: string,
  ): StructReparentContext | { error: string } {
    const destinationInstances = this.liveInstanceCount(newParentId);
    const sourceInstances = this.liveInstanceCount(id);
    const counts: StructReparentContext = {
      ...(destinationInstances === undefined ? {} : { destinationInstances }),
      ...(sourceInstances === undefined ? {} : { sourceInstances }),
    };
    const moved = this.transformObject(id);
    const destination = this.byId.get(newParentId);
    if (!moved || !destination) return counts;

    moved.updateWorldMatrix(true, false);
    destination.updateWorldMatrix(true, false);
    // Same math as the gizmo's local/world toggle: the element's world matrix
    // expressed in the destination's space. Instances are cloned off the objects
    // themselves so this file needs no value import of three.
    const local = destination.matrixWorld.clone().invert().multiply(moved.matrixWorld);
    const position = moved.position.clone();
    const quaternion = moved.quaternion.clone();
    const scale = moved.scale.clone();
    local.decompose(position, quaternion, scale);
    const euler = moved.rotation.clone().setFromQuaternion(quaternion, moved.rotation.order);

    const channels: Array<[ReparentChannel, number[], number[]]> = [
      ['position', position.toArray(), moved.position.toArray()],
      [
        'rotation',
        [euler.x, euler.y, euler.z],
        [moved.rotation.x, moved.rotation.y, moved.rotation.z],
      ],
      ['scale', scale.toArray(), moved.scale.toArray()],
    ];
    const rebase: { -readonly [K in ReparentChannel]?: number[] } = {};
    for (const [channel, next, current] of channels) {
      if (this.nearlyEqual(next, current)) continue;
      const editability = this.transformEditability(id, channel);
      if (!editability.writable) {
        return {
          error:
            `Moving this changes its world ${channel}, so the move would have to rewrite ` +
            `${channel} — but ${editability.reason ?? `${channel} is not writable here.`}`,
        };
      }
      rebase[channel] = next;
    }
    const hasRebase = Object.keys(rebase).length > 0;
    return { ...counts, ...(hasRebase ? { rebase: rebase as ReparentRebase } : {}) };
  }

  /** The one write. A refusal from the planner leaves the file byte-identical and
   *  arrives here as `error`; an applied move is a single `writeStruct` (tuple
   *  rewrites included), so project history holds it as one undo step. */
  private reparentThrough(
    id: string,
    parentOid: string,
    context: StructReparentContext,
  ): Promise<WriteAck> {
    const oid = this.oidOf(id);
    if (!oid) return this.refuseReparent('This row has no authored source element to move.');
    return this.structPipe.pipedStruct(
      async () => {
        const res = await this.writeBackend!.writeStruct(oid, 'reparent', {
          parentOid,
          ...context,
        });
        if (!res.changed) {
          void this.refuseReparent(res.error ?? 'The move produced no source change.');
          return false;
        }
        if (res.warning) showTransientHint(res.warning);
        this.store.shell.notifyIngestEdit();
        return true;
      },
      'reparent',
      this.writeBackend?.writeStruct !== undefined,
      this.destinationOf(id),
    );
  }

  /**
   * THE STRUCT DIALECT, one producer (`struct-write-pipe.ts`): the pipe
   * choreography this class used to spell privately — and its react/canvas
   * twins spelled again — now shared. This lane contributes its identity
   * resolution (the OID index), its destination sentences, and its
   * on-changed hook; the shared module owns the `source-structure`
   * resolution, the live-only floor, and the refusal spellings.
   */
  private readonly structPipe = createStructWritePipe({
    // biome-ignore lint/suspicious/noConsole: a refused source write must be visible
    report: (message) => console.warn(`[R3fSourceAuthoringAdapter] ${message}`),
    noWriterReason: NO_SOURCE_WRITER_REASON,
    backend: () => this.writeBackend,
    onChanged: () => this.store.shell.notifyIngestEdit(),
  });

  /**
   * What a duplicate should differ in, so it reads as a SECOND thing rather
   * than a copy stacked exactly on the original (a human build session was
   * confused by that even when pre-warned): the next free "Name N" among the
   * row's siblings, and a position nudge of the object's own width plus a
   * gap along +X. Both land only where source can honestly take them — see
   * `writer.ts` `DuplicateRewrite`.
   */
  /**
   * NAMES AND OFFSETS THIS SESSION HAS ALREADY MINTED but the live scene has
   * not adopted yet. A duplicate derives both from the LIVE hierarchy, which
   * only learns about a write when the remount lands — so a burst of Ctrl+D
   * presses each read the same pre-write tree and produced identical copies
   * stacked in one place with one name (runhuman pass 66: "they are all
   * stacked somewhere together... HeroBox 2, 2, 2"). Cleared by `adoptScene`,
   * where the new live tree becomes authoritative again — the same lifetime
   * `valueEcho`/`dynamicPaths` have.
   */
  private pendingDuplicateLabels = new Set<string>();
  private pendingDuplicateCounts = new Map<string, number>();

  private duplicateRewrite(id: string): DuplicateRewrite {
    const node = this.hierarchy.node(id);
    const rewrite: DuplicateRewrite = {};
    if (node) {
      const base = node.label.replace(/ \d+$/, '');
      const siblingLabels = new Set(
        (node.parentId ? (this.hierarchy.node(node.parentId)?.childIds ?? []) : [])
          .map((childId) => this.hierarchy.node(childId)?.label)
          .filter((label): label is string => typeof label === 'string'),
      );
      let n = 2;
      while (siblingLabels.has(`${base} ${n}`) || this.pendingDuplicateLabels.has(`${base} ${n}`))
        n++;
      rewrite.name = `${base} ${n}`;
      this.pendingDuplicateLabels.add(rewrite.name);
    }
    const object = this.transformObject(id);
    if (object) {
      const size = new Box3().setFromObject(object).getSize(new Vector3());
      const width = Number.isFinite(size.x) && size.x > 0 ? size.x : 1;
      // Each un-adopted copy steps one width further, so a burst lays out a
      // row instead of a stack.
      const step = (this.pendingDuplicateCounts.get(id) ?? 0) + 1;
      this.pendingDuplicateCounts.set(id, step);
      rewrite.positionOffset = [(width + 0.5) * step, 0, 0];
    }
    return rewrite;
  }

  private structOp(
    id: string,
    op: string,
    opts?: StructOpOptions,
    sourceOid?: string | null,
  ): Promise<WriteAck> {
    return this.structPipe.structOp(
      sourceOid ?? this.oidOf(id),
      id,
      op,
      opts,
      this.destinationOf(id),
    );
  }

  /**
   * A DELETED ELEMENT'S ID MUST NOT STAY SELECTED.
   *
   * Oids are positional (`file:component:tag:occurrence`), so removing an
   * element RENUMBERS every later sibling of that tag: the id string the store
   * still holds then resolves, after the remount, to a DIFFERENT element —
   * gizmo and Inspector silently sitting on a neighbour nobody picked. A human
   * hit this three times and read it as "renaming moves the gizmo" (runhuman
   * pass 118); the Opus reproduction showed the jump is armed by the delete
   * and merely becomes visible at the next remount: deleting `West Jump Pad 2`
   * left the selection resolving to `East Jump Pad` (2026-09-01). Nothing
   * selected is the honest state after a delete.
   */
  private dropSelectionOnRemoval(
    ids: readonly string[],
    ack: Promise<WriteAck>,
  ): Promise<WriteAck> {
    const removed = new Set(ids);
    const wasSelected = [...this.store.shell.selectedEntityIds].some((id) => removed.has(id));
    if (wasSelected) this.store.shell.selectMultiple([]);
    return ack;
  }

  private async removeMany(ids: readonly string[]): Promise<WriteAck> {
    const oids = [...new Set(ids.map((id) => this.oidOf(id)).filter((o): o is string => !!o))];
    if (oids.length === 0 || !this.writeBackend?.writeStructMany) {
      // No batch door: the per-id loop IS the write, and the batch's honest ack
      // is the LAST id's — one gesture, one answer, never a blanket `true`.
      let ack: WriteAck = LIVE_ONLY_ACK;
      for (const id of ids) ack = await this.structOp(id, 'delete');
      return ack;
    }
    return this.structPipe.structMany(oids, 'delete', undefined, this.destinationOf(ids[0] ?? ''));
  }

  private groupMany(ids: readonly string[]): Promise<WriteAck> {
    const oids = ids.map((id) => this.oidOf(id)).filter((oid): oid is string => Boolean(oid));
    return this.structPipe.structMany(oids, 'group', undefined, this.destinationOf(ids[0] ?? ''));
  }

  /** A structural verb that never reaches a writer — the shared pipe's floor,
   *  with the optional author-facing hint this lane's drag refusals carry. */
  private structRefusal(reason: string, hint?: string): Promise<WriteAck> {
    return this.structPipe.structRefusal(reason, hint);
  }

  subscribe(listener: () => void): () => void {
    return this.store.shell.subscribe(listener);
  }

  get documentId(): string {
    return this.documentNodeId;
  }
}

/**
 * One session-ledger warning per element for the missing-source-metadata
 * refusal above — the condition is permanent until a page reload, so a
 * silent per-read refusal left the author (measured: a blind probe) reading
 * adapter source to learn the fix.
 */
const reportedMissingSourceMetadata = new Set<string>();
function reportMissingSourceMetadataOnce(id: string): void {
  if (reportedMissingSourceMetadata.has(id)) return;
  reportedMissingSourceMetadata.add(id);
  editorConsole.warn(
    `Element "${id}" has no source metadata — added by hot reload, so the OID index does not ` +
      'cover it until the editor page reloads. Its Inspector fields refuse writes until then; ' +
      'reload the page to author it.',
  );
}
