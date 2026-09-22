/**
 * `vgai.adapter.ts` — THE ADAPTER MODULE CONTRACT.
 *
 * ARCHITECTURE-CORE §The editor protocol, "The adapter is the game's own
 * module": the editor is a universal CLIENT of a fixed protocol and every game
 * supplies a SERVER — its adapter. That adapter is the game's OWN module,
 * `vgai.adapter.ts`, sitting beside `vgai.project.json`, default-exporting
 * {@link defineAdapter}'s result.
 *
 * It is CODE (bindings are expressions — a scene entry may carry a closure the
 * host evaluates against the mounted game) with a CONFIG's discipline: the top
 * level is a STATICALLY EVALUABLE BINDING TABLE, readable without booting the
 * game. Concretely, that is the split this module enforces:
 *
 *   - the TABLE SHAPE — regions, the scene table, observation declarations —
 *     is plain data, validated by {@link AdapterDefinitionSchema} the moment
 *     the module is evaluated. `.strict()` throughout: an unrecognized key is
 *     an error naming the key, never a silent pass-through (CLAUDE.md,
 *     "Unknown input must REJECT LOUDLY").
 *   - individual FIELDS may be closures, evaluated lazily against the mounted
 *     game (`ObservationDeclaration.answer`). A closure is never required to
 *     read the table. `editor.Layout` is an imported React component: the
 *     editor invokes it to compose surfaces and edit/play behavior. It is a
 *     runtime value, never a serialized manifest setting or a registry key.
 *
 * **Zero inference.** A binding is a DECLARATION or a finder SELECTION the
 * adapter makes — never something the host sniffs out. Finder algorithms
 * (scenes from an entrypoint selection, prefabs from story registrations, …)
 * ship host-side under `adapter/finders/`, and this module names them by
 * SELECTION only ({@link FinderSelection}). That is deliberate and load-bearing
 * twice over:
 *   1. the engine never runs a finder nobody selected — enforced mechanically
 *      by `packages/engine/test/finder-import-boundary.test.ts`, whose only
 *      sanctioned importer of the finder namespace is the editor's adapter
 *      loader;
 *   2. this module therefore imports NOTHING from `adapter/finders/`, so a
 *      game's `vgai.adapter.ts` pulls no finder implementation (and no source
 *      parser) into its own bundle. The dependency runs one way: finders
 *      import their parameter types from HERE.
 *
 * The manifest keeps only what must be readable without evaluating any module
 * — identity, roots, boot mode, `server.room`. Everything that binds behavior
 * is the adapter's. This wave adds NO manifest field.
 */

import type { KeymapContribution, StyleContribution } from './editor-looks';
import type { ComponentType } from 'react';
import { z } from 'zod';
import type { ResolvedAdapterRoot } from '../manifest/load';
import type { AdapterSurface } from './adapter-surface';
import { WRITE_ANCHOR_KINDS, type WriteAnchorKind } from './authoring';

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

/**
 * The native substrate serving a region. A surface is only the host-provided
 * medium (`canvas`); this declaration is what distinguishes Pixi, Babylon and
 * Phaser without runtime sniffing.
 */
export const SUBSTRATE_NAMES = ['three', 'pixi', 'dom', 'babylon', 'phaser'] as const;
export type SubstrateName = (typeof SUBSTRATE_NAMES)[number];

/**
 * A region's WORLD BASIS — which axis points up, and where its ground sits.
 *
 * The editor needs a ground plane to place a dropped asset or a probe point on.
 * That plane used to be the constant `y = 0` compiled into `editor-viewport.ts`,
 * which is a guess about the GAME's convention: a Z-up world (the CAD/Blender
 * idiom foreign R3F games routinely carry) got its drops silently projected onto
 * the wrong plane. It is exactly the shape "zero inference" names — a fact the
 * game's author can state, so the fix is a declaration slot rather than a
 * smarter sniff (ARCHITECTURE-CORE §The editor protocol).
 */
export interface AdapterRegionBasis {
  /** World axis pointing away from the ground. */
  readonly up: 'y' | 'z';
  /** Ground offset along {@link up}, in world units. */
  readonly groundHeight: number;
}

/**
 * The NATIVE basis — what {@link regionsFromManifestRoots} emits and what a
 * region that declares none is read as. +Y up, ground at 0: three.js' own
 * convention, which every first-party root is authored in. Stated as a value so
 * "the default" has one home instead of a copy at each reader.
 */
export const NATIVE_REGION_BASIS: AdapterRegionBasis = Object.freeze({
  up: 'y',
  groundHeight: 0,
});

/**
 * One matrix REGION: a root, its surface, and the library selections that
 * serve it. Universality lives at region granularity — which libraries serve a
 * surface is a per-surface ENGINE fact, so a new surface root in an existing
 * game is one manifest line and one derived region, never new adapter code
 * (that is exactly what {@link regionsFromManifestRoots} does).
 */
export interface AdapterRegion {
  /** The manifest root this region grades. */
  readonly id: string;
  /** What the host hands this root. */
  readonly surface: AdapterSurface;
  /** Native substrate, by name. */
  readonly substrate: SubstrateName;
  /**
   * Dialect writer, by name (`r3f`, `jsx`, `pixi-react`, …) — the truth
   * family's source writer for this region. `null` states outright that the
   * host writes no source here: the region's truth is the game's own code,
   * which the host does not author (a module or ingest root).
   */
  readonly dialect: string | null;
  /**
   * Anchor kinds this region's writer serves, drawn from the compile-pinned
   * {@link WRITE_ANCHOR_KINDS} vocabulary. A kind absent here is a red cell in
   * the matrix, which is a work order — never a silently unsupported edit.
   */
  readonly anchors: readonly WriteAnchorKind[];
  /**
   * This region's world basis. Omitted = {@link NATIVE_REGION_BASIS}, which is
   * a DECLARED default (the native adapter emits it outright), not a silent
   * fallback — same shape as an absent `vgai.adapter.ts` meaning
   * `nativeAdapter()`.
   */
  readonly basis?: AdapterRegionBasis;
  /**
   * Project-relative globs naming source files this region OWNS, for the
   * ambiguous remainder that import reach cannot place.
   *
   * A file's surface/dialect is derived from WHICH REGION'S IMPORT CLOSURE
   * reaches it — a load-bearing fact, because the region's manifest entry is
   * what the host actually executes at mount (the game would break first if it
   * lied). Reach through several regions of the SAME surface is unambiguous;
   * reach through regions of DIFFERING surfaces, or through none at all, is
   * genuinely undecidable from outside, and this is where the game's author
   * states the answer instead of the host guessing it from the file's bytes.
   *
   * READER: `packages/editor/src/ui-source/file-region-resolver.ts`'s
   * `resolveFileRegion`, consulted BEFORE reach — a declared include wins,
   * because it is a first-party statement about this exact file. Every OID
   * stamping tier, the HMR classifier, the R3F authoring diagnostics and
   * Content's component grouping read that one resolver.
   *
   * {@link regionsFromManifestRoots} emits none: the native default is PURE
   * reach, and a first-party project that needs an include has a module its
   * roots do not reach, which is a fact worth stating rather than absorbing.
   *
   * Glob vocabulary is deliberately the small one every reader already knows:
   * `**` (any depth, including none), `*` (one segment, no `/`), `?` (one
   * character). No brace expansion, no negation — a second syntax to learn is
   * how a declaration slot turns back into a language.
   */
  readonly include?: readonly string[];
  /**
   * Surfaces this root mounts BESIDE {@link AdapterRegion.surface}, each with
   * the source files that render on it. Together with `surface` — the manifest
   * root's own adapter, which is always the PRIMARY — this states the root's
   * FULL mounted surface set (decision, 2026-08-16; ARCHITECTURE-CORE §The
   * editor protocol).
   *
   * A root is not always one surface. The shipped case is an R3F game whose
   * `three` root mounts a canvas AND adopts a DOM HUD beside it
   * (`adoptGameDomRoot` already adopts the pair together): its HUD modules
   * render react-dom host elements, and `userData-oid` on a `<div>` is a prop
   * react-dom does not recognize, so the editor must know they are the `dom`
   * half. Before this slot there was nowhere to say so — `id` names the
   * manifest root this region grades, so a second `dom` region for such a root
   * would either name a root the host would try to MOUNT (fabrication, which
   * the anti-shim rule forbids) or name no root at all.
   *
   * Each mount's `include` is REQUIRED and carries the same glob vocabulary as
   * {@link AdapterRegion.include} (`**`, `*`, `?`). A mount with no files would
   * declare a surface without saying which source renders on it, which answers
   * no question any reader asks.
   *
   * READER: the same one — `resolveFileRegion`'s rung 1. A file claimed by a
   * region's own `include` AND by a mount is a contradiction in the game's own
   * declaration and settles nothing, exactly as two regions claiming one file
   * do; it falls through to reach, and failing that to the caller's loud
   * ambiguous path.
   *
   * {@link regionsFromManifestRoots} emits none: the manifest states one
   * adapter per root and NOTHING infers a second surface from source text.
   * Where the declaration and what a file renders disagree, the disagreement is
   * reported as drift (the editor's `OID003`), never resolved by reading bytes.
   */
  readonly mounts?: readonly AdapterRegionMount[];
}

/**
 * One ADDITIONAL surface a root mounts, and the source files that render on it.
 * See {@link AdapterRegion.mounts}.
 */
export interface AdapterRegionMount {
  /** The surface this part of the root mounts on. */
  readonly surface: AdapterSurface;
  /** Project-relative globs (`**`, `*`, `?`) naming the files that render here. */
  readonly include: readonly string[];
}

const AdapterRegionMountSchema = z
  .object({
    surface: z
      .enum(['three', 'canvas', 'dom'])
      .describe('An additional surface this root mounts, beside the manifest root’s own adapter'),
    include: z
      .array(z.string().min(1))
      .min(1)
      .describe(
        'Project-relative globs (`**`, `*`, `?`) naming the source files that render on this ' +
          'additional surface',
      ),
  })
  .strict();

const AdapterRegionBasisSchema = z
  .object({
    up: z.enum(['y', 'z']).describe('World axis pointing away from the ground'),
    groundHeight: z.number().describe('Ground offset along `up`, in world units'),
  })
  .strict();

const AdapterRegionSchema = z
  .object({
    id: z.string().min(1).describe('Manifest root id this region grades'),
    surface: z.enum(['three', 'canvas', 'dom']).describe('Render surface the host hands this root'),
    substrate: z.enum(SUBSTRATE_NAMES).describe('Native substrate serving this region, by name'),
    dialect: z
      .string()
      .min(1)
      .nullable()
      .describe(
        'Dialect writer serving this region, by name; null states outright that the host writes ' +
          "no source here (the region's truth is the game's own code)",
      ),
    anchors: z
      .array(z.enum(WRITE_ANCHOR_KINDS as [WriteAnchorKind, ...WriteAnchorKind[]]))
      .describe('Anchor kinds this region’s writer serves'),
    basis: AdapterRegionBasisSchema.optional().describe(
      'World basis (up axis + ground height); omit for the native +Y / 0 default',
    ),
    include: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe(
        'Project-relative globs (`**`, `*`, `?`) naming source files this region owns, for files ' +
          'no root entry’s import closure reaches; a declared include wins over reach',
      ),
    mounts: z
      .array(AdapterRegionMountSchema)
      .min(1)
      .optional()
      .describe(
        'Surfaces this root mounts BESIDE its own adapter, each with the files that render on ' +
          'them; with `surface`, the root’s full mounted surface set',
      ),
  })
  .strict();

/**
 * How a definition supplies its regions: the RULE `'manifest-roots'` (the
 * native default — a declaration may be a rule rather than a list, the way
 * `roots[]` never enumerates a world's contents), or an explicit list a game
 * with novel bindings states outright.
 */
export type RegionBinding = 'manifest-roots' | readonly AdapterRegion[];

const RegionBindingSchema = z.union([
  z.literal('manifest-roots'),
  z.array(AdapterRegionSchema).min(1),
]);

/**
 * The per-region PARAMETERS the `'manifest-roots'` rule takes — see
 * {@link AdapterDefinition.regionIncludes}. Exactly the two fields of an
 * {@link AdapterRegion} the mechanical derivation cannot produce, because
 * neither is a fact the manifest states: which files a region owns beyond
 * its entry's reach, and which surfaces its root mounts beside its own.
 */
export interface AdapterRegionOverlay {
  /** See {@link AdapterRegion.include}. */
  readonly include?: readonly string[];
  /** See {@link AdapterRegion.mounts}. */
  readonly mounts?: readonly AdapterRegionMount[];
}

const AdapterRegionOverlaySchema = z
  .object({
    include: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe(
        'Project-relative globs (`**`, `*`, `?`) naming source files this derived region owns, ' +
          'for files no root entry’s import closure reaches; a declared include wins over reach',
      ),
    mounts: z
      .array(AdapterRegionMountSchema)
      .min(1)
      .optional()
      .describe(
        'Surfaces this root mounts BESIDE its own adapter, each with the files that render on ' +
          'them; with the derived region’s own surface, the root’s full mounted surface set',
      ),
  })
  .strict()
  .refine((value) => value.include !== undefined || value.mounts !== undefined, {
    message:
      'regionIncludes entry declares neither `include` nor `mounts` — an empty overlay states ' +
      'nothing the derivation did not already say. Remove it, or name the files it owns.',
  });

/**
 * PARAMETERS FOR THE RULE, keyed by manifest root id (decision, 2026-08-17;
 * ARCHITECTURE-CORE §The editor protocol, "Declared includes LAYER onto the
 * manifest-roots rule").
 *
 * The finder-selection shape, one level up: `regions: 'manifest-roots'` SELECTS
 * the mechanical derivation, and this table DECLARES the per-region parameters
 * it cannot derive. The two compose — {@link regionsFromManifestRoots} merges
 * them — so a first-party project states one include without hand-writing its
 * whole region table, and adding a root still grows the table for free.
 *
 * Illegal beside an explicit `regions` LIST, and rejected by name: that form is
 * the full REPLACEMENT, and its entries carry `include`/`mounts` themselves.
 * Two homes for one fact is how a declaration goes stale in one of them.
 *
 * MEASURED BASIS: a replace-only region binding means no `nativeAdapter()`
 * project can declare a single include without restating every region.
 */
const RegionIncludesSchema = z
  .record(z.string().min(1), AdapterRegionOverlaySchema)
  .describe(
    'Per-region parameters for the `manifest-roots` rule, keyed by manifest root id: the ' +
      '`include` globs and `mounts` surfaces the mechanical derivation cannot produce',
  );

/**
 * The MECHANICAL derivation behind the `'manifest-roots'` rule: one region per
 * declared root, its surface and adapter identity read straight off the
 * RESOLVED manifest (`@volter/editor-project/manifest/load` already decided both — this never
 * re-derives them).
 *
 * The per-surface library table below is an ENGINE fact, stated once:
 *
 * | root `adapter`        | projector | dialect       | anchors                                              |
 * |-----------------------|-----------|---------------|------------------------------------------------------|
 * | `three`               | `three`   | `r3f`         | source-prop, source-structure, construction-literal  |
 * | `canvas`              | `pixi`    | `pixi-react`  | source-prop, source-structure, construction-literal  |
 * | `dom`                 | `dom`     | `jsx`         | source-prop, source-structure                        |
 * | `{module,surface}`    | (surface) | `null`        | live-only                                            |
 * | `{ingest,surface}`    | (surface) | `null`        | live-only                                            |
 *
 * `source-structure` rides with every first-party dialect because all three
 * write through the SAME structural door (`/__ui-source/struct`) — a region
 * that can rewrite a JSX attribute in a file can rewrite that file's element
 * tree. It is listed separately rather than folded into `source-prop` because
 * they are different doors: a lane could lose one and keep the other, and the
 * matrix has to be able to say so.
 *
 * A module/ingest root's truth is the game's own source, which no first-party
 * dialect writer authors — so it declares `live-only` rather than implying a
 * write path it does not have. That is a red cell and therefore a work order,
 * which is the point of stating it.
 *
 * Every derived region carries {@link NATIVE_REGION_BASIS} outright, so the
 * editor's ground plane READS a declaration on the native path too — the
 * default is published, never assumed at the read site.
 *
 * It DERIVES no {@link AdapterRegion.include} and no {@link AdapterRegion.mounts},
 * and there is no derivation that could: the manifest states ONE adapter per
 * root and names only its entry, so a root's extra owned files and its second
 * mounted surface are facts only the game can state. It states them as
 * `regionIncludes` PARAMETERS, which this function merges onto the region it
 * derives for that root — the rule stays selected, the parameters are declared
 * (ARCHITECTURE-CORE §The editor protocol, "Declared includes LAYER onto the
 * manifest-roots rule"). A key naming no declared root merges onto nothing;
 * the LOADER reports that, because only it can see both sides.
 */
export function regionsFromManifestRoots(
  roots: readonly ResolvedAdapterRoot[],
  regionIncludes: Readonly<Record<string, AdapterRegionOverlay>> = {},
): AdapterRegion[] {
  return roots.map((root) => ({
    ...derivedRegion(root),
    ...overlayOf(regionIncludes[root.id]),
  }));
}

/** The declared half of a merged region — omitted keys leave the derived
 *  region untouched, so an overlay can only ADD what the rule cannot derive. */
function overlayOf(overlay: AdapterRegionOverlay | undefined): Partial<AdapterRegion> {
  if (!overlay) return {};
  return {
    ...(overlay.include ? { include: overlay.include } : {}),
    ...(overlay.mounts ? { mounts: overlay.mounts } : {}),
  };
}

/** Region ids an overlay names that no declared root answers to. A typo here
 *  would otherwise be a declaration that silently does nothing, which is the
 *  failure class the whole declaration lane exists to end. */
export function unmatchedRegionIncludeIds(
  roots: readonly ResolvedAdapterRoot[],
  regionIncludes: Readonly<Record<string, AdapterRegionOverlay>>,
): string[] {
  const declared = new Set(roots.map((root) => root.id));
  return Object.keys(regionIncludes).filter((id) => !declared.has(id));
}

/** One root's region, before any declared parameters are merged onto it. */
function derivedRegion(root: ResolvedAdapterRoot): AdapterRegion {
  const surface = root.surface;
  const firstParty = root.adapter.type === 'builtin';
  const substrate: SubstrateName = surface === 'canvas' ? 'pixi' : surface;
  const basis = NATIVE_REGION_BASIS;
  if (!firstParty) {
    return {
      id: root.id,
      surface,
      substrate,
      dialect: null,
      anchors: ['live-only'] as const,
      basis,
    };
  }
  if (surface === 'dom') {
    return {
      id: root.id,
      surface,
      substrate,
      dialect: 'jsx',
      anchors: ['source-prop', 'source-structure'] as const,
      basis,
    };
  }
  return {
    id: root.id,
    surface,
    substrate,
    dialect: surface === 'three' ? 'r3f' : 'pixi-react',
    anchors: ['source-prop', 'source-structure', 'construction-literal'] as const,
    basis,
  };
}

// ---------------------------------------------------------------------------
// Finder selections
// ---------------------------------------------------------------------------

/**
 * The rule form of a finder's region targeting: every region the host mounts
 * from an exported composition — a root with an `entry`.
 */
export const EXPORTED_COMPOSITION_REGIONS = 'exported-composition-regions';

/**
 * `scenesFromEntrypointSelection` — read the entrypoint's ACTIVE-SCENE
 * SELECTION, the load-bearing reference (the game itself executes it, so it
 * cannot drift: the game would break first).
 */
export interface ScenesFromEntrypointSelectionParams {
  readonly finder: 'scenesFromEntrypointSelection';
  /**
   * Which regions' entrypoints to read: named region ids, or the rule
   * {@link EXPORTED_COMPOSITION_REGIONS}.
   */
  readonly regions: readonly string[] | typeof EXPORTED_COMPOSITION_REGIONS;
  /**
   * Identifier of the entrypoint's module-level selection table — the
   * `const <selection> = { <sceneId>: <Component>, … }` binding the entrypoint
   * renders at its swap slot.
   *
   * OMIT for an entrypoint that mounts ONE composition: the finder then answers
   * with the single-scene degenerate table (the root's own composition, opened
   * by mounting the region). Only legal alongside exactly one named region —
   * a selection identifier is a fact about ONE entrypoint's source, so pairing
   * it with the rule form is rejected by name rather than applied to whichever
   * region happened to match.
   */
  readonly selection?: string;
}

/**
 * `prefabsFromStories` — read the colocated portable-CSF story registrations.
 * A prefab is an ordinary source component a designer independently places,
 * declared by a story whose `meta.component` names it; the story registration
 * is the load-bearing reference here (removing it removes the declaration).
 * Zero parameters: the selection IS the whole configuration.
 */
export interface PrefabsFromStoriesParams {
  readonly finder: 'prefabsFromStories';
}

/**
 * A finder selection: the finder's registered NAME plus its own parameters.
 * The set of finders is OPEN (ARCHITECTURE-CORE §The editor protocol,
 * "Documents, not scenes"): the engine's own register in
 * `adapter/finders/registry.ts`, a contribution registers more, and this
 * module validates only the envelope — each finder's parameters are checked
 * against ITS schema the moment the loader runs it, loudly and by name.
 */
export type FinderSelection = {
  readonly finder: string;
  readonly [param: string]: unknown;
};

const FinderSelectionSchema = z
  .object({ finder: z.string().min(1).describe('Registered finder name') })
  .passthrough();

// ---------------------------------------------------------------------------
// The scene table
// ---------------------------------------------------------------------------

/**
 * How the RUNNING game is navigated to an entry — the `reachable` honesty
 * clause, stated rather than assumed. An entry whose reach is `none` is a
 * declared-but-unreachable scene: a red cell carrying its own reason.
 */
export type SceneReach =
  /** Mounting the region IS opening it — the single-composition degenerate case. */
  | { readonly kind: 'root-mount' }
  /**
   * The entrypoint's own selection table reaches it under `key`.
   *
   * `active` is the SECOND load-bearing fact about the same slot: the
   * entrypoint indexes its table with one key right now (`scenes[activeScene]`),
   * and that key's composition is literally what mounting the region renders.
   * So an active entry is the region's own standing document — it NAMES that
   * document rather than earning a second one beside it, exactly as
   * `root-mount` does. Absent means "not known to be the one at the slot",
   * which is the honest answer whenever the key cannot be read statically; it
   * is never a guess, and it is per-entry because two regions each have their
   * own slot with its own occupant.
   */
  | {
      readonly kind: 'entrypoint-selection';
      readonly selection: string;
      readonly key: string;
      readonly active?: boolean;
    }
  /** A portable story mounts it in isolation. */
  | { readonly kind: 'story'; readonly storyId: string }
  /**
   * The RUNNING game's own published scenes contract reaches it, under
   * `sceneId` (`adapter/ingest/game-contract.ts`'s `scenes.list()` ids).
   *
   * This is the LIVE reach: opening it while playing means asking the game to
   * navigate, the way its own buttons do. An authorable entry that also names
   * `source` can independently own an Edit isolation document; reach never
   * decides whether a source composition can be mounted as a piece.
   *
   * A DECLARATION, never an inference: the host does not sniff a mapping
   * between a table entry and a contract id, and it does not assume the two
   * vocabularies coincide. The adapter states which contract id this entry is,
   * and the host validates that id against the game's OWN `list()` at the
   * moment it navigates — so a game that stops publishing the scene refuses by
   * name instead of navigating somewhere else.
   */
  | { readonly kind: 'game-contract'; readonly sceneId: string }
  /** Declared, with no code path that opens it. */
  | { readonly kind: 'none'; readonly reason: string };

const SceneReachSchema = z.union([
  z.object({ kind: z.literal('root-mount') }).strict(),
  z
    .object({
      kind: z.literal('entrypoint-selection'),
      selection: z.string().min(1),
      key: z.string().min(1),
      active: z.boolean().optional(),
    })
    .strict(),
  z.object({ kind: z.literal('story'), storyId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('game-contract'), sceneId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('none'), reason: z.string().min(1) }).strict(),
]);

/** Where an entry's composition lives in the game's own source. */
export interface SceneSource {
  /** Project-relative path. */
  readonly path: string;
  /** Named export; omit when the module default-exports it. */
  readonly export?: string;
}

const SceneSourceSchema = z
  .object({ path: z.string().min(1), export: z.string().min(1).optional() })
  .strict();

/**
 * One entry of the scene table. Scenes and prefabs are SIBLINGS here — both
 * are registered compositions the editor opens in isolation through the same
 * verb, differing only in instance site (ARCHITECTURE-CORE §Roots: "A scene is
 * a ROLE, not a kind … the same kind of thing as a prefab").
 */
export interface DocumentEntry {
  readonly id: string;
  readonly label: string;
  /** `scene` (swaps at the entrypoint's slot) or `prefab` (placed by a designer). */
  /** OPEN: `scene` and `prefab` are the first two kinds; a page, a component,
   *  a model, a bake are kinds the same way. */
  readonly kind: string;
  /** Owning region id; `null` for a project-scoped entry bound to no one root. */
  readonly region: string | null;
  /**
   * `true` = a composition a designer authors (it earns a matrix column).
   * `false` = TRAVERSAL: boot/loading choreography, which gets no column.
   */
  readonly authorable: boolean;
  readonly reach: SceneReach;
  readonly source?: SceneSource;
  /** Optional adapter-declared prerequisite run before `source` is constructed
   *  in Edit isolation. The export is a zero-argument function; the host never
   *  infers setup from neighboring filenames or game globals. */
  readonly isolationSetup?: SceneSource;
  /** Which finder produced it; absent = the adapter stated it outright. */
  readonly finder?: string;
}

const DocumentEntrySchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    kind: z.string().min(1),
    region: z.string().min(1).nullable(),
    authorable: z.boolean(),
    reach: SceneReachSchema,
    source: SceneSourceSchema.optional(),
    isolationSetup: SceneSourceSchema.optional(),
    finder: z.string().min(1).optional(),
  })
  .strict();

/**
 * The adapter's scene table: entries stated outright, finder selections the
 * host runs to produce the rest, and the entry open by default.
 */
export interface AdapterDocumentTable {
  readonly entries?: readonly DocumentEntry[];
  readonly find?: readonly FinderSelection[];
  /**
   * Id of the entry open by default. Omit to let the finder's own answer
   * stand — the host never picks one on its own, so "no default" stays a fact
   * rather than becoming whichever entry sorted first.
   */
  readonly default?: string;
}

const AdapterDocumentTableSchema = z
  .object({
    entries: z.array(DocumentEntrySchema).optional(),
    find: z.array(FinderSelectionSchema).optional(),
    default: z.string().min(1).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

/**
 * The two faces a declaration projects onto. They are exactly the two
 * `DebugAdapter` halves (`adapter/system-adapter.ts`): `state` becomes a
 * provider (`providers()` / `state(name)`), `command` becomes a verb
 * (`commands()` / `invoke(name, args)`). There is deliberately no third kind —
 * see {@link OBSERVATION_KIND_REFUSAL}.
 */
export const OBSERVATION_KINDS = ['command', 'state'] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

/**
 * Why a declaration may not name a `SystemAdapters` slot here.
 *
 * A game's system slots are already declared through the game contract's own
 * `systemAdapters` carrier (`adapter/ingest/game-contract.ts`), which validates
 * each slot per-surface and reports a malformed one BY NAME
 * (`contract-system-adapters.ts`). A second door onto the same slots is exactly
 * the two-declarations-one-slot problem `game-contract.ts` records for `debug`,
 * where it says outright that a second door "would let a game declare two
 * different debug planes with no rule for which wins".
 */
const OBSERVATION_KIND_REFUSAL =
  "observation.kind must be 'command' or 'state' — the two DebugAdapter faces a declaration " +
  'projects onto. A SystemAdapters slot is declared through the game contract’s `systemAdapters` ' +
  'carrier, which validates it per-surface; declaring one here would be a second door onto the ' +
  'same slot with no rule for which wins.';

/**
 * One statically declared observation slot. Declaring a slot and ANSWERING it
 * live are separate facts (the two-state rule): a slot declared here whose
 * `answer` throws, whose `answer` is absent, or whose game never booted reads as
 * broken, never as "the game has none". The projector
 * (`adapter/ingest/observation-debug-adapter.ts`) keeps that distinction: an
 * unanswerable slot is still LISTED, and refuses by name when read.
 */
export interface ObservationDeclaration {
  readonly id: string;
  readonly kind: ObservationKind;
  readonly description?: string | undefined;
  /** Command execution side; omitted means a local app-owned command. */
  readonly locus?: 'client' | 'server' | undefined;
  /**
   * Lazily evaluated against the mounted game. The field may be a closure; the
   * TABLE around it stays statically readable, which is the whole discipline.
   *
   * What `game` IS is the host's to hand over and is stated at the projector:
   * for an ingest mount it is the REALM the game's own modules ran in, because
   * a foreign game's public handles are the only thing the host can honestly
   * pass (`observation-debug-adapter.ts`).
   */
  readonly answer?: (game: unknown, ...args: unknown[]) => unknown;
}

const ObservationDeclarationSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(OBSERVATION_KINDS, { error: () => OBSERVATION_KIND_REFUSAL }),
    description: z.string().min(1).optional(),
    locus: z.enum(['client', 'server']).optional(),
    answer: z
      .custom<(game: unknown) => unknown>((value) => typeof value === 'function', {
        message: 'observation.answer must be a function evaluated against the mounted game',
      })
      .optional(),
  })
  .strict()
  .refine((value) => value.kind === 'command' || value.locus === undefined, {
    path: ['locus'],
    message: 'observation.locus is valid only for a command declaration',
  });

// ---------------------------------------------------------------------------
// Native input
// ---------------------------------------------------------------------------

/** The action value shapes the session input door already speaks. */
export const ADAPTER_INPUT_VALUE_TYPES = [
  'digital',
  'scalar',
  'vector2',
  'pointerDelta',
  'pointerPosition',
] as const;
export type AdapterInputValueType = (typeof ADAPTER_INPUT_VALUE_TYPES)[number];
export type AdapterInputValue = boolean | number | { readonly x: number; readonly y: number };

/** One action in an app-owned input store. */
export interface AdapterInputAction {
  readonly name: string;
  readonly valueType: AdapterInputValueType;
}

/**
 * Adapter-side binding from the universal session input door to a game's
 * ordinary input store. The game owns both its physical-device listeners and
 * its state; this table only tells the host how to drive that same state for a
 * bot or live REPL session. No component imports this contract.
 */
export interface AdapterInputBinding {
  /** Manifest root whose native scheduler consumes these actions. */
  readonly root: string;
  /** Current action vocabulary. A closure permits an app-owned dynamic map. */
  readonly actions: (game: unknown) => readonly AdapterInputAction[];
  /** Apply one action through the app's own input-store write path. */
  readonly set: (game: unknown, action: string, value: AdapterInputValue) => void;
  /** Release every app-owned virtual action. */
  readonly clear: (game: unknown) => void;
}

const AdapterInputBindingSchema = z
  .object({
    root: z.string().min(1),
    actions: z.custom<AdapterInputBinding['actions']>((value) => typeof value === 'function', {
      message: 'input.actions must be a function returning the app-owned action vocabulary',
    }),
    set: z.custom<AdapterInputBinding['set']>((value) => typeof value === 'function', {
      message: 'input.set must be a function writing the app-owned input store',
    }),
    clear: z.custom<AdapterInputBinding['clear']>((value) => typeof value === 'function', {
      message: 'input.clear must be a function releasing app-owned virtual actions',
    }),
  })
  .strict();

// ---------------------------------------------------------------------------
// The definition
// ---------------------------------------------------------------------------

/** Project-owned editor defaults. User layout choices remain session state. */
export interface AdapterEditorLayoutProps {
  readonly playing: boolean;
  readonly paused: boolean;
}
export interface AdapterEditorConfiguration {
  /** Imported React implementation; owns both composition and edit/play presentation. */
  readonly Layout?: ComponentType<AdapterEditorLayoutProps>;

  /**
   * The project's LOOK, imported from the package that carries it
   * (`@vgai/blender`'s `blenderStyle`). Palette, material, icon set and chrome
   * regions in one object — the same `StyleContribution` the package's
   * `workspace.style` contribution registers, named here as the project's
   * choice. Beneath a person's own settings and above their cross-project
   * ones (`settings-store.ts`).
   */
  readonly style?: StyleContribution;
  /** The project's KEY BINDINGS, imported the same way (`blenderKeymap`). */
  readonly keymap?: KeymapContribution;

  /** Registered workspace to open when this checkout has no saved workspace. */
  readonly workspace?: string;
  /** Inspector layout beneath the active workspace and the user's override. */
  readonly inspector?: 'column' | 'properties' | 'card';
  /** Utility registry ids to reveal when Play settles; omitted means none. */
  readonly playUtilities?: readonly string[];
}

const AdapterEditorConfigurationSchema = z
  .object({
    Layout: z
      .custom<ComponentType<AdapterEditorLayoutProps>>(
        (value) => typeof value === 'function',
        'Layout must be an imported React component',
      )
      .optional(),
    style: z
      .custom<StyleContribution>(
        (value) =>
          typeof value === 'object' &&
          value !== null &&
          typeof Reflect.get(value, 'id') === 'string',
        'style must be an imported StyleContribution object',
      )
      .optional(),
    keymap: z
      .custom<KeymapContribution>(
        (value) =>
          typeof value === 'object' &&
          value !== null &&
          typeof Reflect.get(value, 'id') === 'string',
        'keymap must be an imported KeymapContribution object',
      )
      .optional(),
    workspace: z.string().min(1).optional(),
    inspector: z.enum(['column', 'properties', 'card']).optional(),
    playUtilities: z.array(z.string().min(1)).optional(),
  })
  .strict();

/** The adapter module's default export, after {@link defineAdapter}. */
export interface AdapterDefinition {
  readonly editor?: AdapterEditorConfiguration;
  readonly regions: RegionBinding;
  /**
   * Per-region parameters for the `'manifest-roots'` RULE, keyed by manifest
   * root id — the `include` globs and `mounts` surfaces the mechanical
   * derivation cannot produce. {@link regionsFromManifestRoots} merges them;
   * an explicit `regions` LIST carries its own and rejects these by name.
   */
  readonly regionIncludes: Readonly<Record<string, AdapterRegionOverlay>>;
  readonly documents: AdapterDocumentTable;
  readonly observation: readonly ObservationDeclaration[];
  readonly input?: AdapterInputBinding | undefined;
}

/** What a game writes. Every field optional — the near-empty adapter is the
 *  first-party case, and an adapter's SIZE measures the game's distance from
 *  native. */
export interface AdapterDefinitionInput {
  readonly editor?: AdapterEditorConfiguration;
  readonly regions?: RegionBinding;
  readonly regionIncludes?: Readonly<Record<string, AdapterRegionOverlay>>;
  readonly documents?: AdapterDocumentTable;
  readonly observation?: readonly ObservationDeclaration[];
  readonly input?: AdapterInputBinding | undefined;
}

/**
 * Why the two forms may not be combined, said in the error a game's author
 * reads. An explicit region list REPLACES the derivation and its entries carry
 * `include`/`mounts` themselves; layering a second table over it would put one
 * fact in two homes, with no rule for which wins.
 */
const REGION_INCLUDES_WITH_LIST_REFUSAL =
  '`regionIncludes` states parameters for the `manifest-roots` RULE, so it cannot be paired ' +
  'with an explicit `regions` list — that form is the full replacement, and each entry carries ' +
  'its own `include`/`mounts`. Move these globs onto the matching `regions[]` entry, or drop the ' +
  'list and let the derivation run.';

export const AdapterDefinitionSchema = z
  .object({
    editor: AdapterEditorConfigurationSchema.optional(),
    regions: RegionBindingSchema.optional(),
    regionIncludes: RegionIncludesSchema.optional(),
    documents: AdapterDocumentTableSchema.optional(),
    observation: z.array(ObservationDeclarationSchema).optional(),
    input: AdapterInputBindingSchema.optional(),
  })
  .strict()
  // An EMPTY table beside a list is fine and must stay fine: `defineAdapter`
  // publishes `regionIncludes: {}` on every definition, and its output is
  // parsed a second time by the host's loader — a refusal on the key's mere
  // presence would reject the module's own valid output on the round trip.
  .refine(
    (value) =>
      value.regionIncludes === undefined ||
      Object.keys(value.regionIncludes).length === 0 ||
      !Array.isArray(value.regions),
    { message: REGION_INCLUDES_WITH_LIST_REFUSAL },
  );

/**
 * Validate and freeze a game's binding table.
 *
 * Called TWICE by design and with one schema: once here, in the game's own
 * module, so a malformed table fails at the author's own file with the key
 * named; and once in the host's loader, because the loaded default export is
 * untrusted input crossing a module boundary. Two call sites, one rule — not
 * two ways to say the same thing.
 */
export function defineAdapter(input: AdapterDefinitionInput = {}): AdapterDefinition {
  const parsed = AdapterDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `vgai.adapter.ts: invalid adapter definition — ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return Object.freeze({
    ...(input.editor
      ? {
          editor: Object.freeze({
            ...input.editor,
            ...(input.editor.playUtilities
              ? { playUtilities: Object.freeze([...input.editor.playUtilities]) }
              : {}),
          }),
        }
      : {}),
    regions: input.regions ?? 'manifest-roots',
    regionIncludes: Object.freeze({ ...(input.regionIncludes ?? {}) }),
    documents: Object.freeze({ ...(input.documents ?? {}) }),
    observation: Object.freeze([...(input.observation ?? [])]),
    ...(input.input ? { input: input.input } : {}),
  });
}

/** Extra bindings a near-native game adds without restating the native ones. */
export interface NativeAdapterOptions {
  /** Scene-table entries this game states outright, beside what the finders find. */
  readonly scenes?: readonly DocumentEntry[];
  /** Per-region `include`/`mounts` parameters for the derivation — see
   *  {@link AdapterDefinition.regionIncludes}. */
  readonly regionIncludes?: Readonly<Record<string, AdapterRegionOverlay>>;
}

/**
 * THE NATIVE DEFAULT — regions derived mechanically from the manifest's
 * `roots[]`, and a scene table produced by the two shipped finders. This is
 * what a first-party project ships (`export default nativeAdapter()`), and it
 * is also what a project with NO `vgai.adapter.ts` gets: that absence is the
 * declared native default, not a silent fallback.
 */
export function nativeAdapter(options: NativeAdapterOptions = {}): AdapterDefinition {
  return defineAdapter({
    regions: 'manifest-roots',
    ...(options.regionIncludes ? { regionIncludes: options.regionIncludes } : {}),
    documents: {
      ...(options.scenes ? { entries: options.scenes } : {}),
      find: [
        { finder: 'scenesFromEntrypointSelection', regions: EXPORTED_COMPOSITION_REGIONS },
        { finder: 'prefabsFromStories' },
      ],
    },
  });
}

/**
 * Parse an untrusted default export (the loaded `vgai.adapter.ts`) into a
 * definition. Rejects loudly — an unknown key, a bad finder name, a
 * `selection` paired with the rule form all fail by name.
 */
export function parseAdapterDefinition(value: unknown): AdapterDefinition {
  if (value === null || typeof value !== 'object') {
    throw new Error(
      'vgai.adapter.ts must default-export defineAdapter({…}) / nativeAdapter() — ' +
        `got ${value === null ? 'null' : typeof value}`,
    );
  }
  return defineAdapter(value as AdapterDefinitionInput);
}
