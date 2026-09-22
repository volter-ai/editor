/**
 * THE ROOT BINDING — a game's declaration of itself, bound, as ONE host-side
 * value.
 *
 * A game is a native program plus a declaration of itself; the editor is a
 * universal client of that declaration; the host must not know what it is
 * hosting. Today that declaration arrives at the host as a scatter — a
 * `RootInstance`, a `MountedRoot`, an `AuthoringAdapter` provider bag, a
 * `SystemAdapters` slot map, a `ResolvedAdapterRoot`, a parsed
 * `AdapterDefinition` — and every consumer re-assembles its own subset by
 * hand. `RootBinding` is that same material REGROUPED under one name, by the
 * FIVE protocol families a host actually talks in.
 *
 * ## This file declares the vocabulary AND performs the regrouping
 *
 * {@link createRootBinding} is the one place the five families are assembled,
 * and it is a pure re-address of values it is HANDED — it loads nothing,
 * fetches nothing, and constructs no provider. The editor's
 * `binding-resolver.ts` (`resolveRootBinding(root, realm, adapterDef)`) is what
 * gathers those values per realm and calls this; `RootInstance.binding`
 * (`runtime/game.ts`) is where the result lives for the life of the mount.
 * Keeping the assembly here rather than in the resolver is what makes the
 * reference-equality rule below checkable in ONE function instead of once per
 * realm.
 *
 * ## The one rule that makes this a regrouping and not an abstraction
 *
 * **Every member is a REFERENCE to the thing that already exists — never a
 * facade, never a copy, never a wrapper.** `substrate.mounted` IS the
 * `MountedRoot` the adapter returned. `observation.debugRegistry` IS the ONE
 * game-scoped registry every root of that game shares (this binding neither
 * owns it nor tears it down). And the providers that are read AND written
 * through — `selection`, `transforms`, `inspector`, `instances`,
 * `spatialHandles`, `boxEdit`, `text` — appear in BOTH
 * {@link ProjectionBinding} and {@link TruthBinding} as literally the same
 * object, so `binding.projection.selection === binding.truth.selection`. A
 * facade at either address would make the two views disagree the first time
 * anything stateful moved through one of them; reference equality is what
 * makes "regrouping" a checkable claim instead of a promise.
 */

import type { ResolvedAdapterRoot } from '../manifest/load';
import type { AdapterDefinition } from './adapter-module';
import type {
  AssetDropProvider,
  AssetSubjectProvider,
  AuthoringCapabilities,
  AuthoringProvenance,
  BoxEditProvider,
  ColorSampleProvider,
  ComponentInstancesProvider,
  HierarchyProvider,
  InspectorProvider,
  PersistenceProvider,
  PickProvider,
  RectProvider,
  RelatedSubjectsProvider,
  SelectionProvider,
  SpatialHandlesProvider,
  StoriesProvider,
  StructureProvider,
  TextProvider,
  TransformProvider,
  TruthProvider,
} from './authoring';
import type { DebugRegistryRef } from './debug-registry-ref';
import type { NativeDebugBinding, NativeSystemsBinding } from './native-entry-surface';
import type { MountedRoot, RootStateObserver, SurfaceAdapter } from './root-adapter';
import type { SystemAdapters } from './system-adapter';

/**
 * THE PROTOCOL VOCABULARY — the five families a host talks to a root in, and
 * the ONLY place they are enumerated.
 *
 * This union is the single enumeration on purpose: `RootBinding`'s keys are
 * pinned to it by {@link RootBindingKeysAreExactlyTheProtocolFamilies} below,
 * so a sixth family cannot be added at one address and forgotten at the
 * other, and no second list of these names may exist anywhere in the repo
 * (`adapter-binding-protocol-families.test.ts` is the tripwire).
 */
export type ProtocolFamily = 'substrate' | 'projection' | 'truth' | 'observation' | 'project';

/**
 * WHAT MOUNTED, AND HOW IT RUNS.
 *
 * The adapter that produced the mount, the mount itself, and the two
 * lifecycle facts that are properties of the ROOT rather than of the mounted
 * handle (`pausable` is the manifest's per-world play/pause semantics;
 * `loop` is the declared loop model the loop gate reports against). Every
 * other lifecycle member — `update`, `fixedUpdate`, `setPaused`, `step`,
 * `resize`, `dispose`, `disposeComplete`, `drivesOwnLoop` — is reached
 * through `mounted`, unrepeated, because repeating them here would be the
 * facade this binding exists not to be.
 */
export interface SubstrateBinding {
  /** The surface-tagged adapter the resolver produced for this root. */
  readonly adapter: SurfaceAdapter;
  /** The handle the adapter's `mount` returned — the same object, not a view. */
  readonly mounted: MountedRoot;
  /** Per-world play/pause semantics (D10's per-world default is `true`). */
  readonly pausable: boolean;
  /** The declared loop model: host-ticked, or the game owns its own rAF. */
  readonly loop: ResolvedAdapterRoot['loop'];
}

/**
 * READ VIEWS of the provider set — what the editor's panels ASK this root.
 *
 * `capabilities` and `hierarchy` are required because an `AuthoringAdapter`
 * cannot exist without them; every other member is optional and absent means
 * "this root does not support that", never a fabricated empty.
 *
 * The seven members marked STRADDLER also appear on {@link TruthBinding}, as
 * the same object (see this module's header).
 */
export interface ProjectionBinding {
  readonly capabilities: AuthoringCapabilities;
  readonly hierarchy: HierarchyProvider;
  readonly provenance?: AuthoringProvenance | undefined;
  /** STRADDLER. */
  readonly selection?: SelectionProvider | undefined;
  /** STRADDLER. */
  readonly transforms?: TransformProvider | undefined;
  /** STRADDLER. */
  readonly inspector?: InspectorProvider | undefined;
  /** STRADDLER. */
  readonly instances?: ComponentInstancesProvider | undefined;
  /** STRADDLER. */
  readonly spatialHandles?: SpatialHandlesProvider | undefined;
  /** STRADDLER. */
  readonly boxEdit?: BoxEditProvider | undefined;
  /** STRADDLER. */
  readonly text?: TextProvider | undefined;
  readonly assetSubject?: AssetSubjectProvider | undefined;
  readonly related?: RelatedSubjectsProvider | undefined;
  readonly rects?: RectProvider | undefined;
  readonly pickable?: PickProvider | undefined;
  readonly stories?: StoriesProvider | undefined;
  readonly colorSample?: ColorSampleProvider | undefined;
}

/**
 * WRITE VIEWS of the provider set — what an authored edit goes THROUGH.
 *
 * The write-only members (`structure`, `persistence`, `truth`, `assetDrop`)
 * plus the seven straddlers, which are the same objects the projection holds.
 */
export interface TruthBinding {
  readonly structure?: StructureProvider | undefined;
  readonly persistence?: PersistenceProvider | undefined;
  /** Projection subject → source/data anchor and write lane, resolved together. */
  readonly truth?: TruthProvider | undefined;
  readonly assetDrop?: AssetDropProvider | undefined;
  /** STRADDLER. */
  readonly selection?: SelectionProvider | undefined;
  /** STRADDLER. */
  readonly transforms?: TransformProvider | undefined;
  /** STRADDLER. */
  readonly inspector?: InspectorProvider | undefined;
  /** STRADDLER. */
  readonly instances?: ComponentInstancesProvider | undefined;
  /** STRADDLER. */
  readonly spatialHandles?: SpatialHandlesProvider | undefined;
  /** STRADDLER. */
  readonly boxEdit?: BoxEditProvider | undefined;
  /** STRADDLER. */
  readonly text?: TextProvider | undefined;
}

/**
 * WHAT THIS ROOT LETS ANYONE WATCH — references only.
 *
 * `debugRegistry` is the ONE registry the whole Game shares. This binding
 * holds a reference to it and nothing more: it never creates it, never
 * disposes it, and per-root teardown must not end it (a game-scoped resource
 * destroyed by a root-scoped teardown is a bug this repo has already paid
 * for once).
 *
 * `entryDebug`/`entrySystems` are the entry module's own statically declared
 * bindings, harvested at resolve time and INSTALLED post-mount by
 * `adapter-runtime-bindings` — they ride here rather than being re-read from
 * the module a second time.
 */
export interface ObservationBinding {
  /** The root's system-adapter slots (physics/networking/navigation/audio/debug). */
  readonly systems?: SystemAdapters | undefined;
  /** Reference to the game-scoped registry. Never owned, never disposed here. */
  readonly debugRegistry: DebugRegistryRef | null;
  /** The ingested-world observation contract, when the adapter has one. */
  readonly observe?: RootStateObserver | undefined;
  /** Change notification → UI refresh. */
  readonly subscribe?: ((listener: () => void) => () => void) | undefined;
  /** The entry module's `debug` export, already validated. */
  readonly entryDebug?: NativeDebugBinding | undefined;
  /** The entry module's `systems` export, already validated. */
  readonly entrySystems?: NativeSystemsBinding | undefined;
}

/**
 * The entry module's static surface, WITH the realm's reach stated.
 *
 * The host holds the entry module's WHOLE namespace: a project module is
 * served by the session's own dev server, so there is nothing between the
 * module and the host. `reach` is stated rather than assumed because the
 * shape once had a second member, and a consumer that reaches for an export
 * must be able to see in the TYPE whether it can be there.
 */
export interface EntryStaticSurface {
  readonly reach: 'full';
  /** The entry module's own namespace object. */
  readonly module: Record<string, unknown>;
}

/**
 * WHAT THE PROJECT DECLARED — the manifest root, the parsed `vgai.adapter.ts`
 * definition, and the entry's static surface.
 *
 * `vgai.adapter.ts` LOADING stays where it is (`project-adapter.ts`); its
 * parsed result is an INPUT to `resolveRootBinding`, not something this
 * binding goes and fetches. That is deliberate: the binding is the hand-off's
 * shape, never a second loader.
 */
export interface ProjectBinding {
  /** The manifest's own resolved root record. */
  readonly root: ResolvedAdapterRoot;
  /**
   * The project's parsed `vgai.adapter.ts`, or `null` when it declares none.
   *
   * `project-adapter.ts` is still the only thing that LOADS it; the editor's
   * `resolveComposition` asks that owner once per composition — waiting on the
   * load in flight rather than reading past it — and hands the answer to
   * `resolveRootBinding`, so every root of one game carries the same
   * declaration. `null` is therefore a fact about the PROJECT: it shipped no
   * declaration file and runs on the declared native default. Which table
   * stood in (project, registry, or native) is a separate question, answered
   * by `ProjectAdapterFacet.source`.
   */
  readonly definition: AdapterDefinition | null;
  /** The entry module's static surface, realm-honest about its reach. */
  readonly entry: EntryStaticSurface;
}

/**
 * One root's whole declaration, bound.
 *
 * The keys ARE {@link ProtocolFamily} — pinned below, so the vocabulary and
 * the value can never drift apart.
 */
export interface RootBinding {
  readonly substrate: SubstrateBinding;
  /**
   * Present only when this root's mount exposes an `AuthoringAdapter`.
   *
   * A `ProjectionBinding` cannot be fabricated — `capabilities`/`hierarchy`
   * are required — so a mount with no authoring gets no projection. It gets
   * the other four families, which are constructible from the declaration and
   * the mount alone, because withholding those too would answer "what root is
   * this, what did the project declare, what can be watched" with silence for
   * a question the mount's authoring has nothing to do with.
   *
   * Absent is a REAL state, not a rare one: the editor supplies live authoring
   * for native TSX roots itself (`play-mode.ts`'s per-root live adapters,
   * composed into one `CompositeAuthoringAdapter`) rather than through the
   * mount, so today every first-party three/canvas/dom root lands here. Moving
   * that projection into the mount is its own program item; until it does, the
   * absence is the honest report of where authoring lives.
   */
  readonly projection?: ProjectionBinding | undefined;
  /** Present exactly when {@link projection} is — same authoring adapter, same
   *  condition; see there. */
  readonly truth?: TruthBinding | undefined;
  readonly observation: ObservationBinding;
  readonly project: ProjectBinding;
}

/**
 * Compile-time pin: `keyof RootBinding` and `ProtocolFamily` are the same set
 * of names, in both directions. Adding a family to one address and not the
 * other is a type error HERE, at the vocabulary, rather than a silent
 * asymmetry every consumer inherits.
 */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;
export type RootBindingKeysAreExactlyTheProtocolFamilies = AssertTrue<
  MutuallyAssignable<keyof RootBinding, ProtocolFamily>
>;

/**
 * Everything {@link createRootBinding} needs, and nothing it could go and get
 * for itself.
 *
 * Each member is a value some OTHER owner already produced: the resolver
 * mounted the adapter, the manifest loader resolved the root, `project-adapter`
 * parsed the definition, the realm loaded the entry namespace, `createGame`
 * owns the debug registry. This shape exists so that list is stated once, at
 * the seam, instead of being re-derived per realm.
 */
export interface RootBindingParts extends RootDeclaration {
  readonly adapter: SurfaceAdapter;
  readonly mounted: MountedRoot;
  readonly pausable: boolean;
  /** The GAME-scoped registry, borrowed. Never created or disposed here. */
  readonly debugRegistry: DebugRegistryRef | null;
}

/**
 * The DECLARATION half — everything a resolver knows BEFORE anything mounts.
 *
 * This is the half that travels: `binding-resolver.ts` produces one per root
 * while it is resolving adapters, hands it to the host on the root's mount
 * spec, and the host completes the binding at REGISTRATION — the first moment
 * `mounted` exists at all. Splitting it here is what keeps the resolver from
 * having to be present at mount time, and the host from having to know how an
 * entry module was loaded.
 */
export interface RootDeclaration {
  /** The manifest's own resolved root record. `loop` rides on it. */
  readonly root: ResolvedAdapterRoot;
  /** The project's parsed `vgai.adapter.ts`, or `null` when it declares none —
   *  see {@link ProjectBinding.definition} for the current wiring truth. */
  readonly definition: AdapterDefinition | null;
  /** The entry module's static surface, realm-honest about its reach. */
  readonly entry: EntryStaticSurface;
  /** The entry module's validated `debug` export, harvested at resolve. */
  readonly entryDebug?: NativeDebugBinding | undefined;
  /** The entry module's validated `systems` export, harvested at resolve. */
  readonly entrySystems?: NativeSystemsBinding | undefined;
}

/**
 * REGROUP the parts into the five families. No loading, no defaulting, no
 * fabrication: every member of the result is one of `parts`' own values or one
 * of `parts.mounted.authoring`'s own provider objects, read straight off it.
 *
 * The straddlers are read ONCE into locals and written to both bindings, which
 * is what makes `binding.projection.selection === binding.truth.selection` true
 * by construction rather than by care —
 * `adapter-binding-protocol-families.test.ts` asserts it over a value this
 * function built.
 *
 * `subscribe` is the one exception to "the same reference", and deliberately:
 * it is a METHOD on its adapter (`three-authoring-adapter` reads `this.store`
 * inside it), so a bare property read would hand the caller a function whose
 * `this` is the observation binding. It is bound to the authoring adapter that
 * owns it — the same function over the same receiver, with nothing interposed.
 * It is not a straddler and carries no equality claim.
 *
 * An absent `mounted.authoring` costs this root its `projection` and `truth`
 * and NOTHING ELSE. There is no such thing as an empty `ProjectionBinding` —
 * `capabilities`/`hierarchy` are required — so those two families are simply
 * not there, which is the honest report. The other three are built from the
 * declaration and the mount, neither of which the authoring adapter has
 * anything to do with; refusing them as well would answer "which root is
 * this, what did the project declare, what can be watched" with silence, and
 * that is what made `binding` unreadable for every native TSX root the editor
 * plays (the editor supplies their authoring itself — see
 * {@link RootBinding.projection}).
 */
export function createRootBinding(parts: RootBindingParts): RootBinding {
  const authoring = parts.mounted.authoring;

  // Read each straddler ONCE — the two bindings below then hold these exact
  // objects, not two reads of the same key.
  const { selection, transforms, inspector, instances, spatialHandles, boxEdit, text } =
    authoring ?? {};

  return {
    substrate: {
      adapter: parts.adapter,
      mounted: parts.mounted,
      pausable: parts.pausable,
      loop: parts.root.loop,
    },
    ...(authoring === undefined
      ? {}
      : projectionAndTruth(authoring, {
          selection,
          transforms,
          inspector,
          instances,
          spatialHandles,
          boxEdit,
          text,
        })),
    observation: {
      systems: parts.mounted.systems,
      debugRegistry: parts.debugRegistry,
      observe: parts.mounted.observe,
      subscribe: authoring?.subscribe?.bind(authoring),
      entryDebug: parts.entryDebug,
      entrySystems: parts.entrySystems,
    },
    project: {
      root: parts.root,
      definition: parts.definition,
      entry: parts.entry,
    },
  };
}

/** The two authoring-dependent families, built together from the ONE adapter
 *  and the straddlers already read off it — so the reference-equality rule is
 *  still decided in a single place. */
function projectionAndTruth(
  authoring: NonNullable<MountedRoot['authoring']>,
  straddlers: Pick<
    ProjectionBinding,
    'selection' | 'transforms' | 'inspector' | 'instances' | 'spatialHandles' | 'boxEdit' | 'text'
  >,
): { projection: ProjectionBinding; truth: TruthBinding } {
  const { selection, transforms, inspector, instances, spatialHandles, boxEdit, text } = straddlers;
  return {
    projection: {
      capabilities: authoring.capabilities,
      hierarchy: authoring.hierarchy,
      provenance: authoring.provenance,
      selection,
      transforms,
      inspector,
      instances,
      spatialHandles,
      boxEdit,
      text,
      assetSubject: authoring.assetSubject,
      related: authoring.related,
      rects: authoring.rects,
      pickable: authoring.pickable,
      stories: authoring.stories,
      colorSample: authoring.colorSample,
    },
    truth: {
      structure: authoring.structure,
      persistence: authoring.persistence,
      truth: authoring.truth,
      assetDrop: authoring.assetDrop,
      selection,
      transforms,
      inspector,
      instances,
      spatialHandles,
      boxEdit,
      text,
    },
  };
}
