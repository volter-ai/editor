/**
 * PixiAuthoringAdapter — THE editor {@link AuthoringAdapter} for the CANVAS
 * surface, whatever authored the display tree it is handed.
 *
 * It is keyed on the surface, never on provenance (ARCHITECTURE-CORE §Rules):
 * a second adapter class keyed on where the graph came from is the forbidden
 * shape, so a first-party `@pixi/react` world and an ingested game's captured
 * stage are the SAME class here, differing only along two declared axes:
 *
 *  - **identity** — {@link CanvasIdentity}, the engine-side collaborator the
 *    tree walk takes. `createOidCanvasIdentity(worldId)` keys rows on the
 *    `data-oid` a first-party TSX world's containers carry (stable across a
 *    remount, so selection survives one); `STRUCTURAL_CANVAS_IDENTITY` keys
 *    them on the tree's shape, which is all a graph with no authored address
 *    can honestly offer.
 *  - **persistence** — {@link CanvasWriteTarget}, this module's collaborator.
 *    `createSourceCanvasWriteTarget` writes literal JSX props back into the
 *    project's `.tsx` through the existing `ui-source` writer;
 *    `createLiveCanvasWriteTarget` has nowhere to write and says so
 *    (`provenance.detail`), journaling its edits for the session only.
 *
 * Everything else — the tree projection, selection, viewport picking, the 2D
 * transform vocabulary, late-structural-commit re-indexing — is shared, because
 * none of it depends on who wrote the tree. Selection ink is the shared 2D
 * overlay (`rects`); this adapter never writes filters onto live objects.
 *
 * It wraps the engine's backend-neutral {@link AuthoringAdapter2D} (the walk,
 * the ids, the 2D transform primitives) and translates the engine's 2D
 * transform (x, y, scalar rotation) to/from the editor's neutral
 * {@link Transform} through `pixi-transform-channels.ts`.
 */

import {
  AuthoringAdapter2D,
  type CanvasIdentity,
  type Transform2DValue,
} from '../../runtime/pixi/authoring';
import type {
  AssetDropContext,
  AssetDropProvider,
  AuthoringAdapter,
  AuthoringCapabilities,
  AuthoringProvenance,
  AuthoringTruth,
  BoxEditProvider,
  ComponentInstancesProvider,
  DOMRectLike,
  EditorNode,
  HierarchyProvider,
  InspectorProvider,
  PersistenceProvider,
  PickProvider,
  PropertyDescriptor,
  RectProvider,
  RelatedSubjectsProvider,
  SelectionProvider,
  SpatialHandlesProvider,
  SpatialPoint3,
  StoriesProvider,
  StructuralIdWrite,
  StructuralWriteOutcome,
  StructureProvider,
  Transform,
  TransformChannel,
  TransformEditability,
  TransformProvider,
  TruthProvider,
  WriteAck,
} from '@volter/editor-project/adapter';
import type { Container, Graphics, Matrix, PointData, Sprite, Text, Texture } from 'pixi.js';
import * as shellPixi from 'pixi.js';
import type { CanvasPixiNamespace } from '../canvas-entry-runtime';
import { componentStatesProvider } from '@volter/editor-sdk/kit/component-states-registry';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import type { EditorShellStore } from '@volter/editor-threejs/kit/editor-shell-store';
import type { JournalSubject } from '../history/json-history-resource';
import { PixiProjector } from '../projection/pixi';
import { creationSiteRelated } from './creation-site-related';
import {
  isCanvasComponentInstanceRoot,
  readContainerAuthoringComponent,
  readContainerAuthoringLabel,
} from './pixi-source-identity';
import { CanvasStructureHistory } from './pixi-structure-history';
import { fromNeutralTransform, toNeutralTransform } from './pixi-transform-channels';
import { resolvesLiveOnly, runWritePipe } from '@volter/editor-sdk/kit/write-pipe';
import { editorHost } from '@volter/editor-sdk/host';

/**
 * What a write target is handed at construction — the live view it edits
 * through, and the store it journals/notifies against. A target never walks
 * the tree itself; the adapter owns that.
 */
export interface CanvasWriteContext {
  readonly a2d: AuthoringAdapter2D;
  readonly store: EditorShellStore;
  /** Whose journal a live-only edit through this target belongs to — passed
   *  through from {@link PixiAuthoringOptions.journal}. */
  readonly journal: JournalSubject;
  /** Tell the adapter's subscribers something changed. */
  notify(): void;
}

/**
 * THE PERSISTENCE AXIS. One implementation writes the project's own TSX
 * source; the other has no source to write and reports that honestly.
 *
 * Deliberately a boundary seam with two genuine implementers — the one
 * exception the no-wrappers rule records — rather than an `if (source)` branch
 * threaded through the adapter, because the two halves disagree about every
 * question a write raises: what a channel's editability is, what an inspector
 * row means, and what happens when an edit ends.
 */
export interface CanvasWriteTarget {
  /** Declared ONCE per adapter and rendered at the seam — never per row. */
  readonly provenance: AuthoringProvenance;
  /** A target with nowhere to write reports the ephemeral provider; a source
   * target reports the auto-save destination and project-history failures even
   * though there is no pending whole-document flush. */
  readonly persistence?: PersistenceProvider;
  /** Source-backed structural edits when the target can rewrite its native
   * document. Absent targets receive the adapter's live Pixi operations. */
  readonly structure?: StructureProvider;
  /** Source-native file/component placement when this target can persist it. */
  readonly assetDrop?: AssetDropProvider;
  /**
   * The source address of one node, for the inspector's READ surface.
   *
   * ABSENT ⇒ this target's substrate has no creation-site index to answer from,
   * and the adapter reports no `truth` provider at all rather than a
   * fabricated "unknown". Present ⇒ every id gets an answer, anchored or
   * reasoned. First-party TSX uses the same OID index as its guarded writes.
   */
  truth?(id: string, property: string): AuthoringTruth;
  /**
   * The COMPONENT-INSTANCE seam over this target's own truth: on the canvas
   * surface the CREATION SITE is the component, its literals are the defaults,
   * and the live object is the instance that may differ from them.
   *
   * ABSENT ⇒ this target has no source to diff a live value against, and the
   * adapter reports no `instances` provider at all rather than one whose
   * "defaults" it invented — the same conditional shape as `creationSite`.
   */
  instances?(): ComponentInstancesProvider;
  /** Portable-CSF association for a native component instance root. */
  componentIdentity?(id: string): { name: string; sourcePath?: string } | null;
  /**
   * Put a node's transform ORIGIN — a container's `pivot`, a sprite's normalized
   * `anchor` — on the live object, mid-gesture.
   *
   * BRACKETED BY `beginTransformEdit`/`endTransformEdit`, exactly as
   * {@link writeTransform} is, because moving an origin is one gesture that
   * moves TWO values: the origin itself and the `position` that compensates for
   * it so the rendered content stays where the author put it. One bracket is
   * what makes the pair one history transaction.
   *
   * ABSENT ⇒ this target cannot write an origin, and the adapter's spatial
   * handle reports itself non-writable rather than moving something that will
   * snap back.
   */
  writeOrigin?(id: string, kind: 'pivot' | 'anchor', value: readonly [number, number]): void;
  /** Called once, before any other method. */
  bind(context: CanvasWriteContext): void;
  /** The live tree was re-walked — ids may have moved. */
  onReindex(): void;
  transformEditability(id: string, channel: TransformChannel): TransformEditability;
  beginTransformEdit(id: string): void;
  /** Mid-gesture: put `next` on the live object (and anything that owns it). */
  writeTransform(id: string, next: Transform2DValue): void;
  /** Close the gesture and ANSWER for whatever write it triggered — the
   *  persistence pipe's per-edit ack (`write-pipe.ts`), or nothing when this
   *  target performed no write. */
  endTransformEdit(id: string): void | Promise<WriteAck>;
  /** Drop the native JSX prop(s) that author one transform channel. Absent
   *  when this target has no source-level notion of byte-absence. */
  removeTransform?(id: string, channel: TransformChannel): void | Promise<WriteAck>;
  properties(id: string): PropertyDescriptor[];
  get(id: string, path: string): unknown;
  /** Same ack contract as {@link endTransformEdit}. */
  set(id: string, path: string, value: unknown): void | Promise<WriteAck>;
  /** Remove one authored override and let the component default take over —
   *  the only door that restores byte-ABSENCE, since {@link set} can only write
   *  a value. Same ack contract as {@link set}. */
  remove?(id: string, path: string): void | Promise<WriteAck>;
  /**
   * Say — in THIS target's own voice — that a completed structural op lives
   * only in the session.
   *
   * A structural op has no `transformEditability` sentence to read before the
   * gesture (the {@link StructureProvider} contract has no such member), so
   * this report is the ONLY place its persistence story can be told, and a
   * silent live-only structural edit is exactly the two-truths divergence the
   * lane forbids elsewhere. It is a hook rather than a fixed sentence because
   * the two shipped targets already speak about a refused write in different
   * channels — the creation-site one through the ingest refusal report, the TSX
   * one through its `[canvas-source <entry>]` console line — and inventing a
   * third voice here is how a lane acquires two sentences for one act.
   *
   * ABSENT ⇒ the adapter says it itself, generically, through the editor
   * console. Never nothing.
   */
  reportStructureLiveOnly?(label: string, reason: string): void;
  dispose(): void;
}

export interface PixiAuthoringOptions {
  /** The persistence axis — required, because there is no default answer to
   *  "where does an edit go". */
  readonly target: CanvasWriteTarget;
  /**
   * THE `pixi.js` OF THE GRAPH THIS TREE CAME FROM
   * (`resolveCanvasPixiForEditor()`), and the only namespace this adapter
   * constructs or class-checks with.
   *
   * ABSENT ⇒ this bundle's own copy, which is the right answer on every
   * runtime with ONE module graph (dev, hosted, and every headless
   * suite that builds its tree with a direct `pixi.js` import). Under the
   * PACKAGED runtime the tree is the project's and this must be too: the
   * duplicate gate is `object.constructor === pixi.Container`, which is an
   * exact identity test on purpose — a game's own `class Bubble extends
   * Container` must refuse — and an exact test against the wrong instance
   * refuses everything. See `../../vite-plugin-module-doorways.ts` for the
   * measured list.
   */
  readonly pixi?: CanvasPixiNamespace | undefined;
  /**
   * The UNDO axis — whose journal this adapter's live edits belong to. Required
   * for the same reason `target` is: there is no default answer to "does this
   * stack survive my teardown", and the answer differs per lane
   * (`authoringJournal` for a held/design world whose subject outlives every
   * remount, `playJournal` for a run that ends on ■). See the ownership block
   * in `history/json-history-resource.ts`.
   */
  readonly journal: JournalSubject;
  /** The identity axis. Omitted ⇒ structural paths (the engine's default). */
  readonly identity?: CanvasIdentity | undefined;
  /**
   * The element whose client rect maps viewport pixels into this stage's own
   * coordinate space — the canvas analogue of `viewport-pick-context.ts` for
   * three (a `pickable` needs a screen↔world mapping the adapter cannot own,
   * because it is handed only a `Container`).
   *
   * A resolver, not an element, because a play/ingest surface is torn down and
   * rebuilt under a longer-lived adapter; `null` at pick time is an honest
   * degrade (no pick), never a throw. ABSENT ⇒ this adapter reports no
   * `pickable` at all — a stage with no mapped surface cannot answer where a
   * client point landed, and guessing one would fabricate a hit.
   *
   * When the element carries `data-vgai-stage-width`/`-height`, those are the
   * stage's LOGICAL size and the mapping divides the measured rect by them —
   * which is what lets a design surface presented through the shared pan/zoom
   * camera (a CSS scale) pick correctly. Without them the mapping is 1:1,
   * which is every runtime surface (`create-runtime.ts` sizes the renderer to
   * its container, so stage units are that element's client pixels).
   */
  readonly surface?: (() => HTMLElement | null) | undefined;
  /**
   * The DESIGN-TIME STATES axis: whatever can put this world into one of its
   * own named states, in the editor's ordinary stories vocabulary.
   *
   * A collaborator rather than something this class builds, for the same reason
   * `target` and `identity` are: the answer differs per lane and this adapter is
   * keyed on the SURFACE, not on provenance. An ingested game's states are the
   * scenes it declares through the game contract
   * (`contract-scenes-stories.ts`), which is a WORLD-level provider.
   *
   * ABSENT ⇒ the adapter falls back to the CSF-component lane whenever the
   * target names the component a node came from — see the `stories` field on
   * the class for why that provider is unconditional and where its honesty
   * lives instead.
   */
  readonly stories?: StoriesProvider | undefined;
  /** Optional editor-camera mapping for a native Canvas Scene. The stage
   * remains in authored world coordinates while its viewport renderer applies
   * a presentation-only matrix; this inverse maps a client pointer back into
   * those same world coordinates. Runtime/artboard surfaces omit it and keep
   * the size-based mapping above. */
  readonly pointFromClient?:
    | ((clientX: number, clientY: number, surfaceRect: DOMRect) => PointData | null)
    | undefined;
  /**
   * How an asset path becomes a texture for {@link AssetDropProvider}.
   * Defaults to Pixi's own `Assets.load`, which is what every mounted surface
   * uses; injectable so a headless test can drive the drop without a network
   * or a renderer (the same seam, and the same reason, as the creation-site
   * backend's injectable `writer`).
   */
  readonly loadTexture?: ((assetPath: string) => Promise<Texture>) | undefined;
  /** Photograph one native display subtree on an independent preview
   * Application. The live surface renderer is never a render target. */
  readonly capturePreview?:
    | ((
        object: Container,
        size: { readonly width: number; readonly height: number },
      ) => Promise<string | null>)
    | undefined;
}

/**
 * WHAT THIS SURFACE CAN CONSTRUCT — the creation palette's whole contents.
 *
 * Four kinds, each of which is visible the moment it is created (a sprite gets
 * `Texture.WHITE` and a size; a graphics gets a drawn rect): a node the author
 * cannot see is indistinguishable from a create that silently failed.
 */
/** The project-local section holding each canvas world's locked and grouped label paths. */
const EDIT_LOCKS_SECTION = 'canvasEditLocks';
type EditLocks = Record<string, { readonly locked: readonly string[]; readonly grouped: readonly string[] }>;

function readEditLocks(): EditLocks {
  return editorHost().projectLocalState.read<EditLocks>(EDIT_LOCKS_SECTION) ?? {};
}

function writeEditLocks(world: string, locks: EditLocks[string]): void {
  editorHost().projectLocalState.write(EDIT_LOCKS_SECTION, { ...readEditLocks(), [world]: locks });
}

const CANVAS_CREATABLE_KINDS: readonly { kind: string; label: string }[] = [
  { kind: 'container', label: 'Container' },
  { kind: 'sprite', label: 'Sprite' },
  { kind: 'text', label: 'Text' },
  { kind: 'graphics', label: 'Graphics' },
];

/** What a canvas world can take from the asset browser: an image becomes a
 *  Sprite. A model or an audio file has no display object to become here. */
const IMAGE_ASSET_RE = /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i;

/** Why every structural op on this surface is live-only, in one sentence — the
 *  same reason for all of them, because they all come down to the same fact:
 *  the game's source contains statements that CONSTRUCT objects, and this lane
 *  plans property writes, never statements. */
const STRUCTURE_LIVE_ONLY_REASON =
  'a canvas structural edit would have to add, delete or move a construction statement in the ' +
  "world's own source, and this lane plans property writes only — an editor-created node has no " +
  'construction site there at all';

/** The one draggable point a canvas node offers (see `spatialHandles`). Stable
 *  only within its owning node, per the {@link SpatialDragHandle} contract. */
const ORIGIN_HANDLE_ID = 'origin';

/** The origin handle's ink. Deliberately the canvas-guide language's own
 *  measure pink rather than the selection accent, so an origin never reads as
 *  selection chrome. */
const ORIGIN_HANDLE_COLOR = '#ff2d92';

/** What the adapter says when the target has no origin write at all — the
 *  generic voice the target's own sentence replaces whenever it has one. */
const ORIGIN_UNWRITABLE_REASON =
  "this world's write target has no origin write, so the pivot/anchor can be seen here but not " +
  'dragged';

/**
 * The anchor-origin view of a node: its `anchor` and `texture`, or `null` when
 * this node's origin is a plain container pivot.
 *
 * STRUCTURAL, not `instanceof`, and that is load-bearing under the packaged
 * runtime: a canvas world is mounted with the PROJECT's own `pixi.js` (see
 * `../../vite-plugin-module-doorways.ts`), which is a different module instance
 * from the one this prebuilt shell bundles — so a real `Sprite` from the world
 * fails `instanceof Sprite` here and every selected sprite would silently read
 * as a pivot node. The engine's own 2D authoring walk already refuses class
 * identity for the same reason (`@volter/editor-game/runtime/pixi/authoring`'s `kindOf` keys on the
 * constructor NAME); asking for the two fields the anchor question is actually
 * about is the same move without depending on a name a minifier may mangle.
 *
 * It also answers correctly for the sprite-shaped classes that are NOT `Sprite`
 * subclasses — `TilingSprite`, `NineSliceSprite` — which carry a real `anchor`
 * over a real `texture` and were previously mis-read as pivot nodes.
 */
function anchoredSprite(object: Container): { anchor: PointData; texture: Texture } | null {
  const candidate = object as unknown as Partial<Pick<Sprite, 'anchor' | 'texture'>>;
  const anchor = candidate.anchor;
  const texture = candidate.texture;
  return anchor && texture?.orig ? { anchor, texture } : null;
}

/**
 * The frame a node's `anchor` is normalized against, in its own local units —
 * `null` for anything that is not an anchored sprite.
 *
 * This is the node's OWN view bounds, not `texture.orig`, and the two are only
 * the same for `Sprite`. Pixi normalizes an anchor against whatever its
 * `updateBounds` measures, and `TilingSprite`/`NineSliceSprite` measure their
 * authored `_width`/`_height` — the tiled/stretched region — while their
 * texture stays the little source tile. Dividing a drag delta by the texture
 * instead moved a 512-wide banner's anchor by the width of its 32px tile, so
 * the compensating position write no longer cancelled the shift and the
 * content jumped under the pointer.
 *
 * `bounds` is `ViewContainer`'s own accessor (Sprite, TilingSprite,
 * NineSliceSprite all extend it) and reports the view's box WITHOUT children,
 * which is exactly the anchored frame. Read structurally for the same reason
 * {@link anchoredSprite} is: under the packaged runtime this object comes from
 * the project's `pixi.js`, not the shell's.
 */
function anchorFrameSize(object: Container): PointData | null {
  const view = anchoredSprite(object);
  if (!view) return null;
  const bounds = (object as unknown as { bounds?: { width?: unknown; height?: unknown } }).bounds;
  if (typeof bounds?.width === 'number' && typeof bounds.height === 'number') {
    return { x: bounds.width, y: bounds.height };
  }
  return { x: view.texture.orig.width, y: view.texture.orig.height };
}

/** The default node label per kind — a legible row in the hierarchy the moment
 *  it exists, rather than an empty name the panel renders as the kind. */
function defaultLabelFor(kind: string): string {
  const entry = CANVAS_CREATABLE_KINDS.find((candidate) => candidate.kind === kind);
  return entry?.label ?? kind;
}

/** Construct one new display object, or `null` for a kind this surface does not
 *  know — never a fabricated stand-in.
 *
 *  `pixi` is THIS SURFACE's namespace ({@link PixiAuthoringOptions.pixi}): a
 *  node built from another graph's classes is a foreign object in the world's
 *  own display list, and the world's renderer is the one that has to draw it. */
function createDisplayObject(pixi: CanvasPixiNamespace, kind: string): Container | null {
  switch (kind) {
    case 'container':
      return new pixi.Container();
    case 'sprite': {
      const sprite = new pixi.Sprite(pixi.Texture.WHITE);
      sprite.setSize(64, 64);
      return sprite;
    }
    case 'text':
      return new pixi.Text({ text: 'Text', style: { fill: 0xffffff, fontSize: 24 } });
    case 'graphics':
      return new pixi.Graphics().rect(0, 0, 100, 100).fill(0xffffff);
    default:
      return null;
  }
}

/**
 * A deep copy of one display object, or a thrown refusal naming what it is.
 *
 * The refusal is the point: a game's own `class Bubble extends Container` holds
 * state this code cannot see (timers, sim references, its own texture logic),
 * and a "clone" that copied only the Container half would put a dead prop in
 * the world that LOOKS like the real thing. Only the four shapes the editor
 * itself can construct are cloneable, plus their children, recursively.
 */
function cloneDisplayObject(pixi: CanvasPixiNamespace, object: Container): Container {
  const clone = cloneShallow(pixi, object);
  copyCommonProperties(object, clone);
  for (const child of object.children ?? []) {
    clone.addChild(cloneDisplayObject(pixi, child as Container));
  }
  return clone;
}

function cloneShallow(pixi: CanvasPixiNamespace, object: Container): Container {
  // Constructor IDENTITY, not `instanceof`: a subclass passes an instanceof
  // check and is exactly the case that must refuse.
  //
  // AGAINST THIS SURFACE'S OWN NAMESPACE, not a static import — and that is
  // what makes the exact test survive the packaged runtime. `object` comes from
  // the graph the world mounted in; the shell's `Container` is a different
  // class object there, so `===` against it was false for EVERY node and a
  // plain project container was refused with the sentence below, which is about
  // a game's own subclass. Structural duck-typing is not the fix here the way
  // it is for `anchoredSprite` above: this test's whole job is exactness.
  if (object.constructor === pixi.Container) return new pixi.Container();
  if (object.constructor === pixi.Sprite) {
    const source = object as Sprite;
    const sprite = new pixi.Sprite(source.texture);
    sprite.anchor.set(source.anchor.x, source.anchor.y);
    return sprite;
  }
  if (object.constructor === pixi.Text) {
    const source = object as Text;
    const text = new pixi.Text({ text: source.text, style: source.style.clone() });
    text.anchor.set(source.anchor.x, source.anchor.y);
    return text;
  }
  if (object.constructor === pixi.Graphics) return (object as Graphics).clone(true);
  throw new Error(
    `"${object.label ?? object.constructor?.name ?? 'this node'}" cannot be duplicated: a ` +
      `${object.constructor?.name ?? 'custom'} is constructed by the game's own code, and copying ` +
      'only its display half would put a lookalike with no behaviour into the world.',
  );
}

function copyCommonProperties(source: Container, target: Container): void {
  target.label = source.label;
  target.position.set(source.position.x, source.position.y);
  target.scale.set(source.scale.x, source.scale.y);
  target.pivot.set(source.pivot.x, source.pivot.y);
  target.skew.set(source.skew.x, source.skew.y);
  target.rotation = source.rotation;
  target.alpha = source.alpha;
  target.visible = source.visible;
  if ('tint' in source && 'tint' in target) {
    (target as Container & { tint: number }).tint = (source as Container & { tint: number }).tint;
  }
}

interface CanvasBoxEditSession {
  readonly id: string;
  readonly transform: Transform;
  readonly rect: { x: number; y: number; width: number; height: number };
}

function boxPatchChannels(patch: Record<string, number>): TransformChannel[] {
  const channels = new Set<TransformChannel>();
  if (
    patch['x'] !== undefined ||
    patch['y'] !== undefined ||
    patch['originX'] !== undefined ||
    patch['originY'] !== undefined
  ) {
    channels.add('position');
  }
  if (
    patch['width'] !== undefined ||
    patch['height'] !== undefined ||
    patch['scaleXFactor'] !== undefined ||
    patch['scaleYFactor'] !== undefined
  ) {
    channels.add('scale');
    if (patch['width'] !== undefined || patch['height'] !== undefined) channels.add('position');
  }
  if (patch['rotate'] !== undefined) channels.add('rotation');
  return [...channels];
}

function rotateTransformZ(transform: Transform, degrees: number): Transform['rotation'] {
  const half = (degrees * Math.PI) / 180 / 2;
  const deltaZ = Math.sin(half);
  const deltaW = Math.cos(half);
  const [x, y, z, w] = transform.rotation;
  return [
    x * deltaW + y * deltaZ,
    y * deltaW - x * deltaZ,
    z * deltaW + w * deltaZ,
    w * deltaW - z * deltaZ,
  ];
}

function transformForBoxPatch(
  session: CanvasBoxEditSession,
  patch: Record<string, number>,
): Transform {
  const next: Transform = {
    position: [...session.transform.position],
    rotation: [...session.transform.rotation],
    scale: [...session.transform.scale],
  };
  const rotate = patch['rotate'];
  if (rotate !== undefined) next.rotation = rotateTransformZ(session.transform, rotate);
  const width = patch['width'];
  if (width !== undefined && session.rect.width > 0) {
    next.scale[0] = session.transform.scale[0] * Math.max(0.0001, width / session.rect.width);
  }
  const height = patch['height'];
  if (height !== undefined && session.rect.height > 0) {
    next.scale[1] = session.transform.scale[1] * Math.max(0.0001, height / session.rect.height);
  }
  const scaleStep = patch['scaleStep'];
  const snapScale = (value: number): number =>
    scaleStep !== undefined && scaleStep > 0 ? Math.round(value / scaleStep) * scaleStep : value;
  const nonZeroScale = (value: number): number =>
    Math.abs(value) >= 0.0001 ? value : value < 0 ? -0.0001 : 0.0001;
  const scaleXFactor = patch['scaleXFactor'];
  if (scaleXFactor !== undefined) {
    next.scale[0] = nonZeroScale(snapScale(session.transform.scale[0] * scaleXFactor));
  }
  const scaleYFactor = patch['scaleYFactor'];
  if (scaleYFactor !== undefined) {
    next.scale[1] = nonZeroScale(snapScale(session.transform.scale[1] * scaleYFactor));
  }
  return next;
}

function requestedBoxEditDelta(
  currentOrigin: { x: number; y: number } | null,
  currentRect: DOMRectLike | null,
  sessionRect: DOMRectLike,
  patch: Record<string, number>,
): { dx: number; dy: number } {
  const usesOrigin = patch['originX'] !== undefined || patch['originY'] !== undefined;
  if (usesOrigin) {
    return {
      dx: patch['originX'] !== undefined && currentOrigin ? patch['originX'] - currentOrigin.x : 0,
      dy: patch['originY'] !== undefined && currentOrigin ? patch['originY'] - currentOrigin.y : 0,
    };
  }
  return {
    dx: currentRect ? (patch['x'] ?? sessionRect.x) - currentRect.x : 0,
    dy: currentRect ? (patch['y'] ?? sessionRect.y) - currentRect.y : 0,
  };
}

export class PixiAuthoringAdapter implements AuthoringAdapter {
  readonly capabilities: AuthoringCapabilities;
  readonly provenance: AuthoringProvenance;
  readonly pickable?: PickProvider;
  /**
   * The selection chrome's geometry — outlines, hover, marquee — in the SAME
   * authored-space frame `RootSelectionOverlay` reads for every other surface.
   *
   * Present exactly when {@link PixiAuthoringOptions.surface} is, and for the
   * same reason it gates `pickable`: both need a mapped surface, and without
   * one there is no honest frame to answer in. `hasRectCapableChild` is what
   * decides whether the shared overlay renders at all, so this is also what
   * makes a canvas world SELECTABLE by clicking it — the overlay's own
   * interaction layer routes its picks back through `pickable`.
   */
  readonly rects?: RectProvider;
  /** Present only when the target HAS one. A source-writing target uses this
   * to disclose its auto-save destination and last project-history failure. */
  readonly persistence?: PersistenceProvider;
  /**
   * Present exactly when the target can answer where a node came from. The
   * provider is the id→object hop and nothing else — the index itself is a
   * host-side `WeakMap` (`creation-site-registry.ts`), so a running game is
   * never asked anything and never observes that it was indexed.
   */
  readonly truth?: TruthProvider;
  /**
   * Present exactly when {@link truth} is, and derived from the same
   * index: the ONE jump a canvas subject honestly has is to the line that
   * constructed it. A target with no creation-site index advertises no empty
   * capability (the same conditional shape as `pickable`/`rects`), and an
   * indexed node whose object the index never saw gets `[]` — an absence, not a
   * fabricated link.
   */
  readonly related?: RelatedSubjectsProvider;
  readonly structure: StructureProvider;
  /**
   * The handed-in {@link PixiAuthoringOptions.stories} when there is one;
   * otherwise the CSF-COMPONENT provider, built here for any target that can
   * name the component a node came from.
   *
   * That second arm is UNCONDITIONAL, and it is not the empty picker the
   * conditional shape (`pickable`/`rects`) exists to avoid. Which stories a
   * node has is the project's story registry's answer, and the registry is
   * populated by story-module discovery long after this constructor runs — so
   * there is no honest construction-time predicate to gate on, and the sibling
   * CSF lanes resolve it the same way: `R3fSourceAuthoringAdapter` and
   * `ReactRootAuthoringAdapter` both declare `stories` NON-optionally and build
   * it unconditionally, pushing the honesty into `storiesFor(id)` — which
   * answers `[]` for a node whose component has none.
   *
   * That is where the surface is hidden, and `inspector-stories-gating.ts`
   * says so twice: gate on `storiesFor(...)` returning rows, "NEVER on
   * `adapter.stories` truthiness". Presence of the provider is not an
   * advertisement — a picker only appears where there is something to pick.
   *
   * Conditionality still belongs to whatever CAN be decided up front: a
   * WORLD-level provider knows its own list, which is why
   * `createContractScenesStories` answers `null` for a game that declares no
   * scenes.
   */
  readonly stories?: StoriesProvider;
  /**
   * Present exactly when the target can read the game's own source
   * ({@link CanvasWriteTarget.instances}). On this surface the CREATION SITE is
   * the component — its literals are the defaults an instance overrides — so a
   * target with no readable source has no defaults to diff against and this
   * adapter advertises no instance capability rather than inventing one.
   */
  readonly instances?: ComponentInstancesProvider;
  readonly transforms: TransformProvider;

  private readonly a2d: AuthoringAdapter2D;
  private readonly projector: PixiProjector;
  private readonly target: CanvasWriteTarget;
  /** THE namespace — see {@link PixiAuthoringOptions.pixi}. */
  private readonly pixi: CanvasPixiNamespace;
  private readonly structureHistory: CanvasStructureHistory;
  private readonly loadTexture: (assetPath: string) => Promise<Texture>;
  private readonly capturePreview:
    | ((
        object: Container,
        size: { readonly width: number; readonly height: number },
      ) => Promise<string | null>)
    | undefined;
  private listeners = new Set<() => void>();
  private boxEditSessions = new Map<string, CanvasBoxEditSession>();
  /**
   * Lock (a click passes through the node) and Godot's Group (a click inside a grouped node selects
   * the group), held by each node's label path in this world so they survive the remount a source
   * write causes and the next session. Kept per checkout, as Unity keeps scene pickability per
   * user; Godot writes them into the scene file instead.
   */
  private lockedPaths = new Set<string>();
  private groupedPaths = new Set<string>();
  private readonly editLockWorld: string;
  /** Each node's label path, cleared whenever the tree is re-projected. */
  private pathKeys = new Map<string, string>();

  constructor(
    private readonly root: Container,
    private readonly store: EditorShellStore,
    opts: PixiAuthoringOptions,
  ) {
    this.target = opts.target;
    this.pixi = opts.pixi ?? shellPixi;
    this.transforms = {
      dimensions: () => '2d',
      get: (id): Transform => {
        const value = this.a2d.getTransform(id);
        if (!value) return { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
        return toNeutralTransform(value);
      },
      editability: (id, channel) => this.target.transformEditability(id, channel),
      beginEdit: (id) => this.target.beginTransformEdit(id),
      apply: (id, transform) => {
        this.target.writeTransform(id, fromNeutralTransform(transform));
        this.notify();
      },
      endEdit: (id) => {
        return this.target.endTransformEdit(id);
      },
      ...(this.target.removeTransform
        ? {
            remove: (id: string, channel: TransformChannel) =>
              this.target.removeTransform?.(id, channel),
          }
        : {}),
    };
    // THIS SURFACE's `Assets`, so a dropped image lands in the cache the
    // world's own loader reads — the shell's is a separate cache that would
    // fetch and decode the same file a second time.
    this.loadTexture =
      opts.loadTexture ?? ((assetPath) => this.pixi.Assets.load<Texture>(assetPath));
    this.capturePreview = opts.capturePreview;
    this.structureHistory = new CanvasStructureHistory(root, store, opts.journal, () =>
      this.afterStructuralChange(),
    );
    this.a2d = new AuthoringAdapter2D(root, {
      ...(opts.identity ? { identity: opts.identity } : {}),
    });
    this.projector = new PixiProjector(root, this.a2d, {
      surface: opts.surface ?? (() => null),
      ...(opts.pointFromClient ? { pointFromClient: opts.pointFromClient } : {}),
    });
    this.provenance = this.target.provenance;
    const surface = opts.surface;
    if (surface) {
      this.pickable = {
        pick: (clientX, clientY) => {
          const hit = this.projector.pick(clientX, clientY, (id) => this.isPickLocked(id));
          return hit ? this.groupOf(hit) : hit;
        },
        candidates: (clientX, clientY) =>
          this.projector.candidates(clientX, clientY, (id) => this.isPickLocked(id)),
      };
      this.rects = {
        rect: (id) => this.projector.rect(id),
        frame: (id) => this.projector.frame(id),
        contextRects: (id) => this.projector.contextRects(id),
      };
    }
    if (opts.stories) this.stories = opts.stories;
    this.watchStructure(root);
    this.capabilities = {
      transform: true,
      inspectorFields: true,
      // First-party source targets auto-save per edit but still expose the
      // destination and rollback failure through PersistenceProvider. A
      // foreign/live target's provider may be only an ephemeral disclosure,
      // which is not a persistence capability.
      persist:
        this.target.provenance.source === 'source-code' && this.target.persistence !== undefined,
    };
    this.target.bind({ a2d: this.a2d, store, journal: opts.journal, notify: () => this.notify() });
    this.editLockWorld = opts.journal.id;
    const saved = readEditLocks()[this.editLockWorld];
    this.lockedPaths = new Set(saved?.locked ?? []);
    this.groupedPaths = new Set(saved?.grouped ?? []);
    const structure = this.target.structure ?? this.liveStructure;
    // A placed creation reaches the structure in the new node's PARENT's own space: the target
    // writes `x`/`y` as authored, and only this adapter knows the frame `rects` answer in.
    this.structure = {
      ...structure,
      create: (kind, parentId, at) =>
        structure.create(kind, parentId, at ? this.pointInParent(parentId ?? null, at) : undefined),
    };
    this.assetDrop =
      this.target.assetDrop ??
      ({
        accepts: (nodeId, assetPath) =>
          IMAGE_ASSET_RE.test(assetPath) && this.containerFor(nodeId || null) !== null,
        drop: (nodeId, assetPath, context) => this.dropAsset(nodeId, assetPath, context),
      } satisfies AssetDropProvider);
    const persistence = this.target.persistence;
    if (persistence) this.persistence = persistence;
    const truthOf = this.target.truth?.bind(this.target);
    if (truthOf) {
      this.truth = { resolve: (id, property) => truthOf(id, property) };
      this.related = creationSiteRelated((id) => truthOf(id, 'position').site);
    }
    // The CSF-component lane: a target that names the component a node came
    // from gets the portable-CSF story association, unconditionally, exactly as
    // the R3F and React lanes build theirs. `storiesFor(id)` is where a node
    // with no story says so — see the `stories` field for why that is the only
    // place the answer is knowable.
    if (!opts.stories && this.target.componentIdentity) {
      this.stories = componentStatesProvider(
        'canvas',
        store.shell,
        (id) => this.target.componentIdentity?.(id) ?? null,
      );
    }
    const instances = this.target.instances?.();
    if (instances) {
      this.instances = {
        // NO GATE HERE — the TARGET answers for its own instances.
        //
        // This used to wrap `describe` in "the CSF provider has a story for
        // this node", which is the portable-CSF lane's own sentence
        // (`r3f-source-authoring-adapter.ts` says it inside the adapter that
        // owns both halves). Asked as a blanket wrapper it is asked of targets
        // whose instance notion is NOT CSF at all: once the live target learned
        // to name a class-owned object's component, every ingested game's
        // instances capability went dark for any class with no matching story —
        // the exact silent capability deletion this wrapper was last edited to
        // prevent. The CSF gate now lives in `pixi-source-write-target.ts`,
        // beside the component identity it is a statement about; a target whose
        // component IS its construction statement has no story to require.
        describe: (id) => instances.describe(id),
        ...(instances.openComponent
          ? { openComponent: (id: string) => instances.openComponent?.(id) }
          : {}),
        revert: (id, paths) => instances.revert(id, paths),
        applyToComponent: (id, path) => instances.applyToComponent(id, path),
      };
    }
  }

  refresh(): { count: number; sprites: number } {
    return this.projector.refresh();
  }

  /** The selected live display subtree as pixels, or `null` when this mounted
   * surface did not expose a renderer-backed capture door. */
  previewImage(id: string, width: number, height: number): Promise<string | null> {
    const object = this.projector.object(id);
    return object && this.capturePreview
      ? this.capturePreview(object, { width, height })
      : Promise.resolve(null);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  // ------------------------------------------------- late structural commits
  //
  // Re-indexing at the READ (see `hierarchy` below) is what makes a late
  // subtree NAMEABLE; this is what makes the panel ask again. Pixi emits
  // `childAdded`/`childRemoved` on the parent, so watching the root plus every
  // indexed object covers every path a new subtree can enter through, and the
  // listeners are re-attached after each notification so a freshly-committed
  // subtree is itself watched. Both axes need it, for different reasons: an
  // ingested port waits on its resources, and a first-party world commonly
  // gates its whole content on an atlas.

  private watchedForStructure: Container[] = [];
  private structureNotifyQueued = false;

  private readonly onStructureChanged = (): void => {
    // STALENESS IS ANSWERED NOW; the walk is what waits. The projector holds
    // one projection per synchronous turn, and it can only know to drop it
    // when a mover tells it — its own write paths do, and this watcher is the
    // other mover: the GAME committed, behind the adapter's back, which is the
    // whole reason this watcher exists. A read arriving before the microtask
    // below (a status/coverage pass, `hierarchy.roots()` from a panel) would
    // otherwise answer from the walk taken before the commit.
    this.projector.invalidate();
    // One notification per commit burst: React's commit is synchronous, so a
    // microtask runs after the WHOLE subtree is in the tree, however many
    // `childAdded` events it fired.
    if (this.structureNotifyQueued) return;
    this.structureNotifyQueued = true;
    queueMicrotask(() => {
      this.structureNotifyQueued = false;
      this.projector.reproject();
      this.pathKeys.clear();
      this.watchStructure(this.root);
      this.target.onReindex();
      this.notify();
      this.store.shell.notifyIngestEdit();
    });
  };

  private watchStructure(root: Container): void {
    for (const object of this.watchedForStructure) {
      object.off('childAdded', this.onStructureChanged);
      object.off('childRemoved', this.onStructureChanged);
    }
    this.watchedForStructure = [];
    const watch = (object: Container): void => {
      // A tracked node is not guaranteed to be a real PixiJS display object —
      // the same reason `getTransform` tolerates one without a position. An
      // emitter it does not have is a node whose structure cannot change under
      // us either, so skipping it loses nothing.
      if (typeof object.on === 'function' && typeof object.off === 'function') {
        object.on('childAdded', this.onStructureChanged);
        object.on('childRemoved', this.onStructureChanged);
        this.watchedForStructure.push(object);
      }
      for (const child of object.children ?? []) watch(child as Container);
    };
    watch(root);
  }

  // -------------------------------------------------------------- hierarchy

  readonly hierarchy: HierarchyProvider = {
    // THE READ IS THE REFRESH POINT. A world whose content arrives after the
    // adapter was handed its root commits real nodes into this same tree
    // later, and a node the last index never saw carries no id: its parent
    // reports a child it cannot name, so the hierarchy stops at the last row
    // that WAS indexed while the viewport draws the whole world. The index is a
    // walk of a display list, so re-doing it per read is cheaper than any
    // scheme for noticing when it went stale.
    roots: () => {
      this.projector.project();
      return this.projector
        .roots()
        .map((node) => this.toEditorNode(node.id))
        .filter((node): node is EditorNode => node !== null);
    },
    node: (id) => this.toEditorNode(id),
    // No `object3D`/`idForObject3D`: canvas entities are PIXI display objects,
    // not THREE — the concept does not apply here (no 3D gizmo binding).
  };

  private toEditorNode(id: string): EditorNode | null {
    const node = this.projector.node(id);
    if (!node) return null;
    const object = this.projector.object(id);
    const componentRoot = object ? isCanvasComponentInstanceRoot(object) : false;
    const component = componentRoot ? readContainerAuthoringComponent(object) : undefined;
    return {
      id: node.id,
      label:
        (componentRoot && object ? readContainerAuthoringLabel(object) : undefined) ?? node.label,
      role: componentRoot ? 'component' : 'entity',
      kind: node.kind,
      ...(component ? { typeLabel: component } : {}),
      parentId: node.parentId,
      childIds: node.childIds,
    };
  }

  readonly selection: SelectionProvider = {
    get: () => [...this.store.shell.selectedEntityIds],
    set: (ids) => {
      this.store.shell.selectMultiple(ids);
      this.notify();
    },
  };

  // -------------------------------------------------------------- structure
  //
  // EVERY OP IS A LIVE OP ON THE CAPTURED TREE — Pixi's own
  // `addChild`/`removeChild`/`addChildAt` — bracketed in ONE
  // `CanvasStructureHistory` transaction, so one Ctrl+Z reverts the whole op.
  // That is the same project-history path a transform gesture takes; see that
  // module for why the structural state is a resource of its own.
  //
  // PERSISTENCE IS REPORTED, NEVER PRETENDED. A canvas structural edit would
  // have to add, delete or move a CONSTRUCTION STATEMENT in the world's own
  // source, and neither persistence axis plans statements: the TSX target
  // writes JSX props, the creation-site target rewrites a literal at the line
  // that constructed an object. An editor-created node has no such line at all.
  // So the live op proceeds — a canvas world is authorable in the session the
  // same way a live three world is — and the target says, in its own voice,
  // that it stays there (`reportStructureLiveOnly`). Source insertion is a
  // separate capability, and inventing half of it here would be the sidecar the
  // ingest-authoring model forbids.
  //
  // Absent on purpose: `wrap`/`unwrap`/`group`/`ungroup`/`copy`/`cut`/`paste`.
  // The shell hides those affordances for this adapter, which is the honest
  // degrade — a half-answer would be a menu item that silently does nothing.

  private readonly liveStructure: StructureProvider = {
    create: (kind, parentId, at) => this.createStructuralNode(kind, parentId ?? null, at),
    remove: (id) => this.removeStructuralNodes([id]),
    removeMany: (ids) => this.removeStructuralNodes(ids),
    duplicate: (id) => this.duplicateStructuralNode(id),
    reparent: (id, newParentId) => this.reparentStructuralNode(id, newParentId),
    reorder: (id, beforeSiblingId) => this.reorderStructuralNode(id, beforeSiblingId),
    // The palette is the same everywhere in this tree: any container can hold
    // any of these, including the stage root (`parentId === null`).
    creatableKinds: () => CANVAS_CREATABLE_KINDS.map((entry) => ({ ...entry })),
  };

  /** The container an op's `parentId` names — `null`/`''` is the stage root,
   *  which is a legal parent even though it is not one of this adapter's rows. */
  private containerFor(parentId: string | null): Container | null {
    if (!parentId) return this.root;
    const object = this.projector.object(parentId);
    if (!object || typeof object.addChild !== 'function') return null;
    return object;
  }

  private refuseStructure(reason: string): Promise<WriteAck> {
    return runWritePipe({
      resolve: () => resolvesLiveOnly(reason),
      record: () => undefined,
      report: (said) =>
        editorConsole.warn(`[canvas] structural edit refused — ${said}`, 'authoring'),
    });
  }

  /**
   * Say where a completed structural op lives, in the target's own voice when it
   * has one (see {@link CanvasWriteTarget.reportStructureLiveOnly}) — and ANSWER
   * FOR IT through the pipe.
   *
   * This lane has no structural writer at all (see the block comment above), so
   * its resolution is the live-only arm, which by the pipe's type has no `write`
   * member: an ack claiming a destination is a compile error here rather than a
   * discipline. Acking `persisted: true` for an op that only ever touched RAM is
   * exactly the blanket answer the pipe replaced.
   */
  private reportStructureLiveOnly(label: string): Promise<WriteAck> {
    return runWritePipe({
      resolve: () => resolvesLiveOnly(STRUCTURE_LIVE_ONLY_REASON),
      record: () => undefined,
      report: (reason) => {
        if (this.target.reportStructureLiveOnly) {
          this.target.reportStructureLiveOnly(label, reason);
          return;
        }
        editorConsole.log(`[canvas] ${label} is live-only — ${reason}.`, 'authoring');
      },
    });
  }

  /**
   * Re-index and tell the panels, SYNCHRONOUSLY.
   *
   * The `childAdded` watcher below queues the same work in a microtask (one
   * notification per React commit burst), but an op's own caller needs the new
   * id NOW — `create` returns one, and "create then immediately select it" is
   * the ordinary shell sequence.
   */
  private afterStructuralChange(): void {
    this.projector.reproject();
    this.pathKeys.clear();
    this.watchStructure(this.root);
    this.target.onReindex();
    this.notify();
    this.store.shell.notifyIngestEdit();
  }

  private idOf(object: Container): string {
    return (object as Container & { __authId?: string }).__authId ?? '';
  }

  /**
   * The lane that mints a GENUINELY SYNCHRONOUS id: the object is in the running
   * tree and re-indexed before this returns, so the caller can select it in the
   * same turn. The live-only report is the other half of the answer and rides
   * back in `ack` (see `StructuralIdWrite`) instead of being fired `void`.
   */
  /** A point in the `rects` frame, in the space of the container a new child of `parentId` joins. */
  private pointInParent(
    parentId: string | null,
    at: { readonly x: number; readonly y: number },
  ): { x: number; y: number } | undefined {
    const parent = this.containerFor(parentId);
    if (!parent || typeof parent.updateLocalTransform !== 'function') return undefined;
    const local = this.localToRootMatrix(parent).clone().invert().apply({ x: at.x, y: at.y });
    return { x: local.x, y: local.y };
  }

  private createStructuralNode(
    kind: string,
    parentId: string | null,
    at?: { readonly x: number; readonly y: number },
  ): StructuralIdWrite {
    const parent = this.containerFor(parentId);
    if (!parent) {
      return {
        id: '',
        ack: this.refuseStructure(`no node with id "${parentId}" can hold children.`),
      };
    }
    const node = createDisplayObject(this.pixi, kind);
    if (!node) {
      return {
        id: '',
        ack: this.refuseStructure(`"${kind}" is not a kind this canvas surface can construct.`),
      };
    }
    node.label = defaultLabelFor(kind);
    if (at) node.position.set(at.x, at.y);
    const label = `Create ${node.label}`;
    this.structureHistory.track(parent);
    this.structureHistory.track(node);
    this.structureHistory.run(label, () => {
      parent.addChild(node);
    });
    this.afterStructuralChange();
    return { id: this.idOf(node), ack: this.reportStructureLiveOnly(label) };
  }

  /** One transaction for the whole batch — `remove` is the single-id case of
   *  the same op, so a multi-delete is one Ctrl+Z rather than N. */
  private removeStructuralNodes(ids: readonly string[]): Promise<WriteAck> {
    const doomed: Container[] = [];
    let refusal: Promise<WriteAck> | null = null;
    for (const id of ids) {
      const object = this.projector.object(id);
      if (!object?.parent) {
        refusal = this.refuseStructure(`"${id}" is not a removable node in this tree.`);
        continue;
      }
      doomed.push(object);
    }
    if (doomed.length === 0) {
      return refusal ?? this.refuseStructure('the selection held no removable node.');
    }
    const label =
      doomed.length === 1
        ? `Delete ${doomed[0]!.label ?? 'node'}`
        : `Delete ${doomed.length} nodes`;
    for (const object of doomed) {
      this.structureHistory.track(object);
      if (object.parent) this.structureHistory.track(object.parent as Container);
    }
    this.structureHistory.run(label, () => {
      for (const object of doomed) object.parent?.removeChild(object);
    });
    this.afterStructuralChange();
    return this.reportStructureLiveOnly(label);
  }

  private duplicateStructuralNode(id: string): StructuralIdWrite {
    const object = this.projector.object(id);
    const parent = (object?.parent as Container | null) ?? null;
    if (!object || !parent) {
      // A THROW, not a silent '' — `duplicate` has no refusal channel in its
      // signature, and a caller that gets an empty id back cannot tell "refused"
      // from "the new node has no id yet".
      throw new Error(`"${id}" is not a duplicable node in this tree.`);
    }
    // Built BEFORE the transaction opens: an uncloneable node must refuse
    // without having recorded a history entry for a copy that never happened.
    const clone = cloneDisplayObject(this.pixi, object);
    clone.label = `${object.label || 'node'} copy`;
    const label = `Duplicate ${object.label ?? 'node'}`;
    const index = parent.children.indexOf(object);
    this.structureHistory.track(parent);
    this.structureHistory.track(clone);
    this.structureHistory.run(label, () => {
      parent.addChildAt(clone, index + 1);
    });
    this.afterStructuralChange();
    return { id: this.idOf(clone), ack: this.reportStructureLiveOnly(label) };
  }

  private reparentStructuralNode(id: string, newParentId: string | null): Promise<WriteAck> {
    const object = this.projector.object(id);
    if (!object) return this.refuseStructure(`"${id}" is not a node in this tree.`);
    const parent = this.containerFor(newParentId);
    if (!parent) {
      return this.refuseStructure(`no node with id "${newParentId}" can hold children.`);
    }
    if (parent === object || this.isAncestorOf(object, parent)) {
      return this.refuseStructure('a node cannot be reparented into itself or its own descendant.');
    }
    // WORLD TRANSFORM PRESERVED, computed from the accumulated LOCAL walk —
    // deliberately not Pixi's own `reparentChild`, which reads `worldTransform`.
    // That matrix is populated by the RENDER pass (see `hitTestChildren`), so on
    // a stage no renderer has drawn yet it is identity, and `reparentChild`
    // would silently teleport the node to the new parent's origin.
    const world = this.localToRootMatrix(object);
    const parentWorld = this.localToRootMatrix(parent);
    const label = `Move ${object.label ?? 'node'}`;
    this.structureHistory.track(object);
    if (object.parent) this.structureHistory.track(object.parent as Container);
    this.structureHistory.track(parent);
    this.structureHistory.run(label, () => {
      parent.addChild(object);
      object.setFromMatrix(parentWorld.clone().invert().append(world));
    });
    this.afterStructuralChange();
    return this.reportStructureLiveOnly(label);
  }

  private reorderStructuralNode(id: string, beforeSiblingId: string | null): Promise<WriteAck> {
    const object = this.projector.object(id);
    const parent = (object?.parent as Container | null) ?? null;
    if (!object || !parent) {
      return this.refuseStructure(`"${id}" is not a reorderable node in this tree.`);
    }
    const sibling = beforeSiblingId ? this.projector.object(beforeSiblingId) : null;
    if (beforeSiblingId && (!sibling || sibling.parent !== parent)) {
      return this.refuseStructure(`"${beforeSiblingId}" is not a sibling of "${id}".`);
    }
    const label = `Reorder ${object.label ?? 'node'}`;
    this.structureHistory.track(parent);
    this.structureHistory.track(object);
    this.structureHistory.run(label, () => {
      const current = parent.children.indexOf(object);
      // `addChildAt` on the SAME parent lifts the node out first, so every
      // index above it shifts down by one — which is why a downward move lands
      // one slot earlier than the target's current index. `null` means "to the
      // end", i.e. the last slot of the lifted-out array.
      const target = sibling ? parent.children.indexOf(sibling) : parent.children.length;
      parent.addChildAt(object, Math.max(0, current < target ? target - 1 : target));
    });
    this.afterStructuralChange();
    return this.reportStructureLiveOnly(label);
  }

  private isAncestorOf(ancestor: Container, node: Container): boolean {
    let cursor: Container | null = node.parent as Container | null;
    while (cursor) {
      if (cursor === ancestor) return true;
      cursor = cursor.parent as Container | null;
    }
    return false;
  }

  /**
   * One object's matrix in the stage root's frame, accumulated from each
   * ancestor's own `localTransform` — the same render-pass-independent walk
   * `hitTestChildren` does, for the same reason.
   */
  private localToRootMatrix(object: Container): Matrix {
    const chain: Container[] = [];
    let cursor: Container | null = object;
    while (cursor && cursor !== this.root) {
      chain.push(cursor);
      cursor = cursor.parent as Container | null;
    }
    const matrix = new this.pixi.Matrix();
    for (let i = chain.length - 1; i >= 0; i--) {
      const node = chain[i]!;
      node.updateLocalTransform();
      matrix.append(node.localTransform);
    }
    return matrix;
  }

  // ------------------------------------------------------------- asset drop
  //
  // "Drag an image from the asset browser onto the world" — the canvas lane's
  // half of the core authoring loop. An image becomes a Sprite through the SAME
  // create machinery and the same one-transaction bracket as
  // `structure.create`, so it is one Ctrl+Z and it carries the same honest
  // live-only report.
  //
  // Two callers, two shapes of target (see `AssetDropProvider`): the VIEWPORT
  // passes `''` (the world itself) plus the point under the cursor, in the
  // stage's own coordinate space — the frame `rects` answers in; the HIERARCHY
  // passes the row dropped on and no position, and the sprite lands at that
  // parent's origin.

  readonly assetDrop: AssetDropProvider;

  private async dropAsset(
    nodeId: string,
    assetPath: string,
    context?: AssetDropContext,
  ): Promise<WriteAck> {
    if (!IMAGE_ASSET_RE.test(assetPath)) {
      // Both shell callers consult `accepts` first, so this is the direct-call
      // path — it still says why rather than dropping the gesture on the floor.
      return this.refuseStructure(
        `${assetPath} is not an image. A canvas world mounts an image as a Sprite; a model or an ` +
          'audio file has no display object to become here.',
      );
    }
    const parent = this.containerFor(nodeId || null);
    if (!parent) {
      return this.refuseStructure(`no node with id "${nodeId}" can hold a dropped asset.`);
    }
    let texture: Texture;
    try {
      texture = await this.loadTexture(assetPath);
    } catch (error) {
      return this.refuseStructure(
        `${assetPath} could not be loaded as a texture: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const sprite = new this.pixi.Sprite(texture);
    // Centred on the drop point, which is where the user aimed.
    sprite.anchor.set(0.5, 0.5);
    sprite.label = assetPath.split('/').pop() ?? 'Sprite';
    const point = context?.position;
    if (point) {
      const local = this.localToRootMatrix(parent).clone().invert().apply({
        x: point[0],
        y: point[1],
      });
      sprite.position.set(local.x, local.y);
    }
    const label = `Add ${sprite.label}`;
    this.structureHistory.track(parent);
    this.structureHistory.track(sprite);
    this.structureHistory.run(label, () => {
      parent.addChild(sprite);
    });
    this.afterStructuralChange();
    // A drop is a structural write like any other, so it answers with its own
    // ack (`AssetDropProvider.drop`) rather than producing one and discarding it.
    return this.reportStructureLiveOnly(label);
  }

  // -------------------------------------------------------------- transforms

  /**
   * Canvas-native manipulation contribution for the shared 2D selection
   * overlay. The overlay speaks absolute stage-space rectangles and rotation
   * deltas; this provider translates those gestures into the same neutral
   * transform channel the inspector uses. The Pixi target still owns source
   * persistence, physics coordination, and the one-undo-step bracket.
   */
  readonly boxEdit: BoxEditProvider = {
    begin: (id) => {
      const rect = this.projector.rect(id);
      if (!rect) {
        this.boxEditSessions.delete(id);
        return;
      }
      this.boxEditSessions.set(id, { id, rect, transform: this.transforms.get(id) });
      this.transforms.beginEdit?.(id);
    },
    apply: (id, patch) => this.applyBoxEdit(id, patch),
    end: (id) => {
      const session = this.boxEditSessions.get(id);
      this.boxEditSessions.delete(id);
      if (!session) return;
      this.transforms.endEdit?.(id);
    },
    gizmoOrigin: (id) => this.gizmoOriginOf(id),
  };

  /** Pixi's position projected through its parent chain is the invariant
   * point around which its native pivot rotates/scales. For a Sprite, anchor
   * shifts the rendered vertices around this same point; neither case can be
   * recovered from the visual bounds' center. */
  private gizmoOriginOf(id: string): { x: number; y: number } | null {
    const object = this.projector.object(id);
    if (!object || typeof object.getGlobalPosition !== 'function') return null;
    const point = object.getGlobalPosition();
    return { x: point.x, y: point.y };
  }

  private applyBoxEdit(id: string, patch: Record<string, number>): void {
    const session = this.boxEditSessions.get(id);
    if (!session) return;
    if (
      boxPatchChannels(patch).some(
        (channel) => this.transforms.editability?.(id, channel).writable === false,
      )
    ) {
      return;
    }
    const next = transformForBoxPatch(session, patch);
    this.transforms.apply(id, next);
    if (
      patch['x'] === undefined &&
      patch['y'] === undefined &&
      patch['originX'] === undefined &&
      patch['originY'] === undefined &&
      patch['width'] === undefined &&
      patch['height'] === undefined
    ) {
      return;
    }
    this.repositionBoxEditBounds(id, session, patch, next);
  }

  private repositionBoxEditBounds(
    id: string,
    session: CanvasBoxEditSession,
    patch: Record<string, number>,
    next: Transform,
  ): void {
    const object = this.projector.object(id);
    if (!object) return;
    const currentOrigin = this.gizmoOriginOf(id);
    const currentRect = this.projector.rect(id);
    const { dx, dy } = requestedBoxEditDelta(currentOrigin, currentRect, session.rect, patch);
    const parent = object.parent;
    if (parent && typeof parent.toLocal === 'function') {
      const origin = parent.toLocal({ x: 0, y: 0 });
      const shifted = parent.toLocal({ x: dx, y: dy });
      next.position[0] += shifted.x - origin.x;
      next.position[1] += shifted.y - origin.y;
    } else {
      next.position[0] += dx;
      next.position[1] += dy;
    }
    this.transforms.apply(id, next);
  }

  // --------------------------------------------------------- spatial handles
  //
  // THE ONE COMPONENT-OWNED SPATIAL VALUE A CANVAS NODE HAS that its box does
  // not already report: its transform ORIGIN — a container's `pivot`, a
  // sprite's normalized `anchor`. Everything else the three lane draws here (an
  // attenuation radius, a light cone, a collider extent) is a component this
  // surface has no analogue of; the origin is the one that is real, and it is
  // invisible in every other panel because it is not a rect and not a position.
  //
  // WHY THE ORIGIN MOVE COMPENSATES `position`. The origin's world point IS the
  // node's global position (Pixi maps the pivot to `position`, and a sprite's
  // anchor point to its local zero), so changing the origin alone can never move
  // the handle — the dot would spring back under the cursor on every drag. The
  // gesture therefore does what every editor's origin affordance does: the
  // CONTENT stays where the author put it and the ORIGIN follows the pointer,
  // which takes one write to the origin and one compensating write to
  // `position`. Both land inside ONE `beginTransformEdit`/`endTransformEdit`
  // bracket, so they are one history transaction and one Ctrl+Z.
  //
  // The category is `origin` rather than one of the shell's named helper
  // channels: `HelperVisibility` names lights, colliders, audio and their
  // siblings, none of which this is, and the contract's own rule for a category
  // the shell does not know is that it obeys the master Helpers toggle (see
  // `SpatialHandleLayer`) — which is the correct behaviour here.

  readonly spatialHandles: SpatialHandlesProvider = {
    layers: (id) => {
      const origin = this.originOf(id);
      if (!origin) return [];
      const editability = this.target.transformEditability(id, 'position');
      const writable = !!this.target.writeOrigin && editability.writable;
      return [
        {
          id: `origin:${id}`,
          category: 'origin',
          guides: [],
          handles: [
            {
              id: ORIGIN_HANDLE_ID,
              label: origin.kind === 'anchor' ? 'Sprite anchor' : 'Pivot',
              position: [origin.world.x, origin.world.y, 0],
              color: ORIGIN_HANDLE_COLOR,
              writable,
              // The target's own sentence when it has one; when it has no
              // origin write at all, the adapter says so itself — the same
              // "ABSENT ⇒ the adapter says it generically" rule
              // `reportStructureLiveOnly` follows.
              ...(writable
                ? {}
                : {
                    reason:
                      this.target.writeOrigin && editability.reason
                        ? editability.reason
                        : ORIGIN_UNWRITABLE_REASON,
                  }),
            },
          ],
        },
      ];
    },
    preview: (id, handleId, worldPosition) => {
      this.moveOrigin(id, handleId, worldPosition, 'preview');
    },
    commit: (id, handleId, worldPosition) => this.moveOrigin(id, handleId, worldPosition, 'commit'),
  };

  /** The node whose origin gesture is currently open, so a `commit` that
   *  arrives without a preview still brackets exactly one gesture. */
  private originEditId: string | null = null;

  /**
   * One node's transform origin: which native value it is, its value in the
   * node's own units, and where it sits in the stage's frame (the SAME frame
   * `rects` answers in, so the overlay draws it with no correction).
   */
  private originOf(
    id: string,
  ): { kind: 'pivot' | 'anchor'; value: PointData; world: PointData } | null {
    const object = this.projector.object(id);
    if (!object || typeof object.updateLocalTransform !== 'function') return null;
    const sprite = anchoredSprite(object);
    const kind = sprite ? 'anchor' : 'pivot';
    const value = sprite
      ? { x: sprite.anchor.x, y: sprite.anchor.y }
      : { x: object.pivot.x, y: object.pivot.y };
    // The LOCAL point the origin occupies: a container's pivot is that point
    // outright; a sprite's anchor names a point ON THE TEXTURE, which Pixi
    // always renders at the sprite's local zero.
    const local: PointData = sprite ? { x: 0, y: 0 } : value;
    const world = this.localToRootMatrix(object).apply({ x: local.x, y: local.y });
    return { kind, value, world: { x: world.x, y: world.y } };
  }

  /**
   * Move `id`'s origin to a stage-space point, keeping the rendered content
   * still. `phase` is the whole difference between a live preview and the end
   * of the gesture: both write the same two values, and only `commit` closes
   * the bracket that records them.
   */
  private moveOrigin(
    id: string,
    handleId: string,
    worldPosition: SpatialPoint3,
    phase: 'preview' | 'commit',
  ): StructuralWriteOutcome {
    if (handleId !== ORIGIN_HANDLE_ID) return;
    const origin = this.originOf(id);
    const object = this.projector.object(id);
    const writeOrigin = this.target.writeOrigin;
    if (!origin || !object || !writeOrigin) return;
    if (!this.target.transformEditability(id, 'position').writable) return;
    if (this.originEditId !== id) {
      this.target.beginTransformEdit(id);
      this.originEditId = id;
    }
    object.updateLocalTransform();
    // The local point that currently lands under the pointer — the point the
    // origin has to become for the content to stay where it is.
    const target = this.localToRootMatrix(object)
      .clone()
      .invert()
      .apply({ x: worldPosition[0], y: worldPosition[1] });
    const localOrigin = origin.kind === 'anchor' ? { x: 0, y: 0 } : origin.value;
    const delta = { x: target.x - localOrigin.x, y: target.y - localOrigin.y };
    const size = origin.kind === 'anchor' ? anchorFrameSize(object) : null;
    if (origin.kind === 'anchor' && (!size || size.x === 0 || size.y === 0)) return;
    const next: readonly [number, number] = size
      ? [origin.value.x + delta.x / size.x, origin.value.y + delta.y / size.y]
      : [target.x, target.y];
    // `position` compensates through the object's own rotation/scale, which is
    // what keeps the content still under a rotated or scaled node.
    const matrix = object.localTransform;
    const current = this.a2d.getTransform(id);
    writeOrigin(id, origin.kind, next);
    if (current) {
      this.target.writeTransform(id, {
        ...current,
        position: [
          current.position[0] + matrix.a * delta.x + matrix.c * delta.y,
          current.position[1] + matrix.b * delta.x + matrix.d * delta.y,
        ],
      });
    }
    this.notify();
    if (phase === 'commit') {
      const ack = this.target.endTransformEdit(id);
      this.originEditId = null;
      return ack;
    }
  }

  // --------------------------------------------------------------- inspector

  readonly inspector: InspectorProvider = {
    properties: (id) => [
      ...this.target.properties(id),
      { path: 'locked', label: 'Locked', type: 'boolean', group: 'Visibility' },
      { path: 'grouped', label: 'Grouped', type: 'boolean', group: 'Visibility' },
    ],
    get: (id, path) =>
      path === 'locked'
        ? this.lockedPaths.has(this.pathKeyOf(id))
        : path === 'grouped'
          ? this.groupedPaths.has(this.pathKeyOf(id))
          : this.target.get(id, path),
    set: (id, path, value) => {
      if (path === 'locked' || path === 'grouped') {
        const set = path === 'locked' ? this.lockedPaths : this.groupedPaths;
        if (value === true) set.add(this.pathKeyOf(id));
        else set.delete(this.pathKeyOf(id));
        writeEditLocks(this.editLockWorld, {
          locked: [...this.lockedPaths],
          grouped: [...this.groupedPaths],
        });
        this.notify();
        return;
      }
      // The TARGET's per-edit ack, passed straight through.
      return this.target.set(id, path, value);
    },
    remove: (id, path) => this.target.remove?.(id, path),
  };

  /** `id`'s label path from its world's root: each step the authored label and its place among
   *  same-labelled siblings, so it holds across line edits and reloads (a rename drops it). */
  private pathKeyOf(id: string): string {
    const known = this.pathKeys.get(id);
    if (known !== undefined) return known;
    const labelOf = (nodeId: string): string => this.projector.object(nodeId)?.label ?? '';
    const segments: string[] = [];
    let current: string | null = id;
    while (current) {
      const node = this.projector.node(current);
      if (!node) break;
      const siblings = node.parentId
        ? (this.projector.node(node.parentId)?.childIds ?? [])
        : this.projector.roots().map((root) => root.id);
      const label = labelOf(current);
      const place = siblings.filter((sibling) => labelOf(sibling) === label).indexOf(current);
      segments.unshift(`${label}#${Math.max(0, place)}`);
      current = node.parentId ?? null;
    }
    const key = segments.join('/');
    this.pathKeys.set(id, key);
    return key;
  }

  /** The outermost grouped node that contains `id`, or `id` itself when none does. */
  private groupOf(id: string): string {
    let group = id;
    let current: string | null = id;
    while (current) {
      if (this.groupedPaths.has(this.pathKeyOf(current))) group = current;
      current = this.projector.node(current)?.parentId ?? null;
    }
    return group;
  }

  private isPickLocked(id: string): boolean {
    let current: string | null = id;
    while (current) {
      if (this.lockedPaths.has(this.pathKeyOf(current))) return true;
      current = this.projector.node(current)?.parentId ?? null;
    }
    return false;
  }

  // ----------------------------------------------------------------- related
  //
  // A canvas subject's ONE honest jump is to the line that constructed it —
  // the shared kit piece (`creation-site-related.ts`), wired in the
  // constructor exactly when {@link truth} is present.

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.boxEditSessions.clear();
    this.pathKeys.clear();
    for (const object of this.watchedForStructure) {
      object.off('childAdded', this.onStructureChanged);
      object.off('childRemoved', this.onStructureChanged);
    }
    this.watchedForStructure = [];
    this.structureHistory.dispose();
    this.target.dispose();
    this.listeners.clear();
  }
}
