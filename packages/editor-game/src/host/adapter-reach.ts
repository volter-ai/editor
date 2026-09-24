/**
 * WHAT THE EDITOR ACTUALLY REACHES on a mounted world, measured off the
 * `AuthoringAdapter` the mount returned — and the WORDS for every capability it
 * did not reach.
 *
 * There is ONE end state for any world the editor opens: editor capability
 * identical to a native root. Anything short of that is a gap, and a gap is a
 * standing warning that keeps firing until the capability works — never a
 * grade, a rung, or a name for a place it is acceptable to stop. Nothing here
 * consults the manifest, the mount route, or the game's id: a game this module
 * has never heard of gets the same answer as one it has.
 *
 * ## The vocabulary is GENERATED, never written
 *
 * The row vocabulary used to be four hand-picked names (`capture`,
 * `transforms`, `inspector`, `persistence`), which is exactly how "all warnings
 * closed" went quiet while `stories`, `assetDrop`, `related`, `structure`,
 * `text` and a dozen more were missing on every mounted root and warned about
 * nowhere. The set is now `AUTHORING_PROVIDER_KEYS`
 * (`@vgai/project/adapter/authoring`), which the compiler pins to the
 * `AuthoringAdapter` interface itself — so a capability nobody remembered to
 * enumerate still warns, and adding a provider to the contract without giving
 * it words here does not compile.
 *
 * `capture` survives as its own fact, not a provider: it is the answer to "did
 * the editor reach this game's runtime AT ALL", and it is the thing every
 * provider stands on.
 *
 * ## N-A is a per-surface answer, and it is also a table the compiler pins
 *
 * A DOM root has no 3D `transforms` provider and never will; a three root has
 * no CSS box model. Reporting those as gaps would be noise that teaches readers
 * to ignore the report. {@link SURFACE_NOT_APPLICABLE} states the exceptions per
 * surface kind, with the REASON, and the map is a `Record` over `AdapterSurface`
 * so a fourth surface kind cannot be added without answering the question.
 * Everything not listed is a gap — under-claiming N-A costs a standing row,
 * over-claiming it hides a real one, so the table stays deliberately small.
 *
 * Pure computation + message formatting. Deliberately NO import of
 * `./editor-console`: that module touches `window` unconditionally at its top
 * level, and this module's callers (`binding-resolver.ts`) are imported by
 * headless Node/vitest suites with no `window` stub. Callers that already own
 * an `editorConsole` import do the actual logging.
 */

import type {
  AuthoringAdapter,
  AuthoringProviderKey,
  MountedThreeRoot,
  SeamEvidenceVerdict,
} from '@vgai/project/adapter';
import { AUTHORING_PROVIDER_KEYS, measureAuthoringProviders } from '@vgai/project/adapter';
import type { AdapterSurface } from '@vgai/project/adapter/adapter-surface';
import { probeAuthoringReads } from './coverage/authoring-read-probe';
import {
  authoringAdapterEpoch,
  inspectAuthoringAdapterSeams,
} from './coverage/authoring-seam-evidence';

/** Re-exported so consumers of a coverage row need one import, not two. */
export type { AuthoringProviderKey };
export { AUTHORING_PROVIDER_KEYS };

/**
 * What this mount reached. `captured` is the runtime-reach fact; `providers` is
 * the measured presence of every member of the authoring contract.
 *
 * Every field is a measurement of the live `AuthoringAdapter`, never a
 * declaration — `capabilities` is not consulted, because a flag and a provider
 * can disagree and only one of them is what the editor's panels will call.
 */
export interface AdapterReach {
  readonly captured: boolean;
  readonly providers: Readonly<Record<AuthoringProviderKey, boolean>>;
  /** Current-epoch proof, separate from provider presence. Older injected
   * fixtures may omit it; omission is unverified, never an implicit pass. */
  readonly providerEvidence?:
    | Readonly<Record<AuthoringProviderKey, SeamEvidenceVerdict>>
    | undefined;
  /** The hierarchy operation is the minimum evidence that capture reached the
   * adapter's projected runtime rather than merely obtaining an object. */
  readonly captureEvidence?: SeamEvidenceVerdict | undefined;
}

/** What the editor cannot do while something is missing, and the named
 *  mechanism that would close it. */
export interface CapabilityGap {
  readonly missing: string;
  readonly fix: string;
}

/**
 * The capture fact's words. Separate from the provider table because it is a
 * different KIND of statement: not "this adapter omits a provider" but "no
 * adapter exists, because the editor never reached the game".
 */
export const CAPTURE_GAP: CapabilityGap = {
  missing:
    'the editor never reached this game’s scene, so hierarchy, inspector and gizmo have ' +
    'nothing to work on — not one object in it can be listed, selected, inspected or moved',
  fix:
    'make the game’s own runtime instance reachable to the host: a bare, un-rewritten ' +
    "`import 'three'` / `import 'pixi.js'` in the game's own source, so it resolves in the " +
    'editor’s realm to the very instance the capture trap is installed on',
};

/**
 * THE OTHER capture failure, and it needed its own words.
 *
 * `captured` and the HIERARCHY seam are two different facts, and the report
 * used to spend {@link CAPTURE_GAP}'s sentences on both. So a root the editor
 * had reached — an adapter in hand, a tree in the Hierarchy panel, a gizmo
 * moving things — printed *"the editor never reached this game's scene … not
 * one object in it can be listed"* and told the reader to add a bare
 * `import 'three'` to a game that already has one. A reader who checks reads
 * it as a false alarm and stops trusting the instrument, which is the exact
 * failure this module's header forbids.
 *
 * MEASURED 2026-09-19 on a `--template game` scaffold, standalone `vgai edit`
 * (it is NOT frame-specific): `hierarchy.roots()` passed, ten `hierarchy
 * .node()` calls passed, and the walk still failed — three of the default
 * scene's nodes report a `parentId` their listed parent does not claim. What
 * the reader needs is THAT, not a capture story.
 */
export const HIERARCHY_RECIPROCITY_GAP: CapabilityGap = {
  missing:
    'this root’s hierarchy does not agree with itself: the editor reached the world and can ' +
    'list it, but `hierarchy.node(id).parentId` and the parent’s own `childIds` name different ' +
    'nodes, so anything that walks UPWARD — reparent targets, paste anchors, ancestor ' +
    'selection — resolves against a tree the panel is not showing',
  fix:
    'make the adapter’s `hierarchy` reciprocal: for every id in a node’s `childIds`, ' +
    '`hierarchy.node(childId).parentId` must be that node’s own id. The report’s `detail` ' +
    'names which direction disagreed',
};

/**
 * ONE sentence pair per provider in the contract — the SAME words wherever a
 * root is short of it, because the missing thing is the provider, not the game.
 *
 * The `Record` type is the tripwire: a provider added to `AuthoringAdapter`
 * lands here as a compile error rather than as silence in every report.
 */
export const PROVIDER_GAP: Readonly<Record<AuthoringProviderKey, CapabilityGap>> = {
  provenance: {
    missing:
      'the shell shows no provenance badge for this root, so nothing tells the author what the ' +
      'rows they are editing are backed by or how writable it is',
    fix: 'the adapter must declare `provenance` (`AuthoringAdapter.provenance`)',
  },
  selection: {
    missing:
      'this root owns no selection, so a viewport hit cannot be resolved to the node the author ' +
      'actually means — a click lands on whatever raw id the substrate reports',
    fix: 'the adapter must expose a `selection` provider (`AuthoringAdapter.selection`)',
  },
  transforms: {
    missing: 'the gizmo cannot move, rotate or scale anything in this world',
    fix: 'the adapter must expose a `transforms` provider (`AuthoringAdapter.transforms`) over the captured tree',
  },
  inspector: {
    missing: 'the inspector shows no properties for a selected object in this world',
    fix: 'the adapter must expose an `inspector` provider (`AuthoringAdapter.inspector`)',
  },
  assetSubject: {
    missing:
      'an authored node that IS an asset (inline SVG, an embedded image) cannot be opened in the ' +
      'Asset Editor from this root — it stays an opaque row',
    fix: 'the adapter must expose an `assetSubject` provider (`AuthoringAdapter.assetSubject`)',
  },
  related: {
    missing:
      'the inspector offers no jump from a selected subject to the document that defines it ' +
      '(a component to its source, an instance to its story) — navigation stops at the row',
    fix: 'the adapter must expose a `related` provider (`AuthoringAdapter.related`)',
  },
  instances: {
    missing:
      'the inspector cannot distinguish a prefab instance override from its component default, ' +
      'so authors cannot revert the instance or deliberately apply its value to the component',
    fix: 'the adapter must expose an `instances` provider (`AuthoringAdapter.instances`) derived from native component source',
  },
  structure: {
    missing:
      'nothing in this world can be created, deleted, duplicated or reparented: the creation ' +
      'palette is empty and the hierarchy’s drag-drop and context-menu structure ops do nothing',
    fix: 'the adapter must expose a `structure` provider (`AuthoringAdapter.structure`)',
  },
  persistence: {
    missing:
      'edits to this world are live-only — the mount carries no write-back route to the ' +
      'game’s own source, so nothing you change survives the session',
    fix: 'the adapter must expose a `persistence` provider (`AuthoringAdapter.persistence`)',
  },
  pickable: {
    missing:
      'this root is not pickable in the viewport: clicking its content selects nothing, so it ' +
      'can only be reached from the hierarchy list',
    fix: 'the adapter must expose a `pickable` provider (`AuthoringAdapter.pickable`)',
  },
  rects: {
    missing:
      'the editor has no screen geometry for this root’s nodes, so the selection overlay, the ' +
      'measure/snap guides and the empty-container hints cannot be drawn',
    fix: 'the adapter must expose a `rects` provider (`AuthoringAdapter.rects`)',
  },
  boxEdit: {
    missing:
      'nothing in this root can be moved or resized by dragging it — its spatial values are ' +
      'reachable only by typing numbers into the inspector',
    fix: 'the adapter must expose a `boxEdit` provider (`AuthoringAdapter.boxEdit`)',
  },
  text: {
    missing: 'text in this root cannot be edited in place — double-click does nothing',
    fix: 'the adapter must expose a `text` provider (`AuthoringAdapter.text`)',
  },
  colorSample: {
    missing:
      'the eyedropper has no fallback path on this root, so colour picking is dead wherever the ' +
      'browser has no native `EyeDropper`',
    fix: 'the adapter must expose a `colorSample` provider (`AuthoringAdapter.colorSample`)',
  },
  stories: {
    missing:
      'no component of this root can be opened against a story: its prefabs never appear on the ' +
      'component board, and a designer cannot open, apply or isolate a design-time state',
    fix: 'the adapter must expose a `stories` provider (`AuthoringAdapter.stories`) reading the root’s colocated portable CSF',
  },
  truth: {
    missing:
      'the editor cannot say where any object in this world came from, so an inspector edit has ' +
      'no source address to be written back to',
    fix: 'the adapter must expose a `truth` provider (`AuthoringAdapter.truth`)',
  },
  spatialHandles: {
    missing:
      'component-owned spatial values in this world (an audio attenuation radius, a light cone, ' +
      'a collider extent) are invisible in the viewport and cannot be dragged',
    fix: 'the adapter must expose a `spatialHandles` provider (`AuthoringAdapter.spatialHandles`)',
  },
  assetDrop: {
    missing:
      'nothing can be dropped into this world: a model, image or material dragged from the asset ' +
      'browser onto the viewport or the hierarchy is refused',
    fix: 'the adapter must expose an `assetDrop` provider (`AuthoringAdapter.assetDrop`)',
  },
  subscribe: {
    missing:
      'this root never tells the editor its tree changed, so the hierarchy and inspector show a ' +
      'stale projection until something else happens to re-render them',
    fix: 'the adapter must implement `subscribe` (`AuthoringAdapter.subscribe`)',
  },
};

/**
 * The providers that are absent BY DESIGN for a surface kind, each with the
 * reason a reader needs. A `Record` over `AdapterSurface`, so a new surface kind
 * cannot skip the question.
 *
 * Kept deliberately small. An N-A entry is a promise that no editor capability
 * is lost, and a wrong one HIDES a real gap — the exact failure this whole
 * derivation exists to end. Everything not listed here reports as a gap, which
 * is the cheap direction to be wrong in.
 */
export const SURFACE_NOT_APPLICABLE: Readonly<
  Record<AdapterSurface, Partial<Record<AuthoringProviderKey, string>>>
> = {
  three: {
    assetSubject:
      'the current asset-subject contract is an inline SVG embedded in a DOM source document; ' +
      'a Three scene-graph node has no such representation',
    rects:
      'screen rects are the DOM visual editor’s coordinate system; a three root is manipulated ' +
      'in world space through the gizmo',
    boxEdit:
      'the CSS box model has no three analogue — spatial editing here is the `transforms` ' +
      'provider plus the gizmo',
    text: 'a three world has no editable element text body',
    colorSample: 'the eyedropper’s CSS background-chain walk has no three analogue',
  },
  canvas: {
    assetSubject:
      'the current asset-subject contract is an inline SVG embedded in a DOM source document; ' +
      'a canvas display node has no such representation',
    // `boxEdit` is deliberately NOT excused here: `PixiAuthoringAdapter` ships
    // a real one (the overlay's drag-to-move/resize bridged onto the 2D
    // transforms), so on the Pixi surface the row measures `ok` — and a canvas
    // adapter without one (a structural Phaser/Babylon capture) is honestly
    // short of a capability the surface has, which is a gap, not an N-A.
    text: 'a canvas world has no editable element text body',
    colorSample: 'the eyedropper’s CSS background-chain walk has no canvas analogue',
  },
  dom: {
    transforms:
      'a DOM root has no 3D transform; its spatial editing is the `boxEdit` provider, which is ' +
      'reported on its own row',
    spatialHandles:
      'world-space component guides have no DOM analogue — a DOM root’s geometry is its box, ' +
      'reported by `rects`/`boxEdit`',
  },
};

/**
 * MEASURE the reach of a mounted world from the authoring surface it returned.
 *
 * No authoring surface at all means nothing was captured, and every provider
 * that stands on the captured tree is missing with it — reported per provider
 * rather than collapsed into one word, because each one is a separate thing the
 * user cannot do.
 */
/** Every provider absent — what an uncaptured mount reaches. Derived from the
 *  same vocabulary as a real measurement, never spelled out. */
const NO_PROVIDERS: Readonly<Record<AuthoringProviderKey, boolean>> = Object.freeze(
  Object.fromEntries(AUTHORING_PROVIDER_KEYS.map((key) => [key, false])) as Record<
    AuthoringProviderKey,
    boolean
  >,
);

/** A mount that reached nothing: no capture, no provider. Named because the
 *  no-authoring floor, the coverage stories and the tests all need to say the
 *  same thing, and each spelling it out would re-create the hand list. */
export const UNCAPTURED_REACH: AdapterReach = Object.freeze({
  captured: false,
  providers: NO_PROVIDERS,
});

export function measureAdapterReach(
  mounted: Pick<MountedThreeRoot, 'authoring'>,
  subject = 'root',
): AdapterReach {
  const { authoring } = mounted;
  if (!authoring) return UNCAPTURED_REACH;
  return measureAdapter(authoring as AuthoringAdapter, subject);
}

/**
 * The composite's PUBLIC child-walk door (`CompositeAuthoringAdapter
 * .childAdapters()`, T0), duck-typed rather than `instanceof`-checked: this
 * module must stay importable by headless Node suites (see the header), and
 * the composite's own import graph touches `window` via `editor-console`.
 * Only the composite defines this member, and only the fields this signature
 * names are read.
 */
interface CompositeChildWalk {
  childAdapters?: () => ReadonlyArray<{ readonly adapter: AuthoringAdapter }>;
}

/** Measure an adapter directly, for callers that hold one rather than a mount. */
export function measureAdapter(adapter: AuthoringAdapter, subject = 'root'): AdapterReach {
  const epoch = authoringAdapterEpoch(adapter);
  const evidence = inspectAuthoringAdapterSeams({
    adapter,
    subject,
    epoch,
    receipts: probeAuthoringReads({ adapter, subject, epoch }),
  });
  const providers = { ...measureAuthoringProviders(adapter) };
  const children = (adapter as CompositeChildWalk).childAdapters?.();
  if (children) {
    // A composite deliberately implements neither `pickable` nor `provenance`
    // (`authoring/composite-authoring-adapter.ts`'s own notes): the shell's
    // delivering doors are composite-aware — viewport picking walks
    // `childAdapters()` in `authoring/layered-pick.ts`, and provenance
    // resolves per node through `authoring/provenance.ts`'s governing-adapter
    // hop (the hierarchy's world rows read each child's own badge). Reading
    // the composite's absent fields would report a capability the editor in
    // fact delivers — the exact instrument failure this module's header
    // forbids — so these two rows measure the door the panels actually call:
    // any child that answers it. Everything else the composite either routes
    // itself (measured directly above) or genuinely lacks.
    providers.pickable ||= children.some((child) => child.adapter.pickable !== undefined);
    providers.provenance ||= children.some((child) => child.adapter.provenance !== undefined);
  }
  return {
    captured: true,
    providers,
    providerEvidence: evidence.providers,
    // The WALK, not the carrier — see `AuthoringSeamEvidence.hierarchyWalk`.
    // `captureEvidence`'s documented meaning (above) is "a current-epoch
    // hierarchy OPERATION proves capture reached the projected runtime", and
    // the carrier grade answers a strictly stronger question that no three
    // adapter can pass, so reading it here made the capture row's `ok` branch
    // unreachable.
    captureEvidence: evidence.hierarchyWalk,
  };
}

/**
 * Is this provider absent BY DESIGN on this surface? The reason, or `null` when
 * its absence is a real gap. An unknown surface kind gets `null` — never a
 * fabricated exemption.
 */
export function notApplicableReason(
  surface: AdapterSurface | null,
  provider: AuthoringProviderKey,
): string | null {
  if (surface === null) return null;
  return SURFACE_NOT_APPLICABLE[surface]?.[provider] ?? null;
}

/** The providers this mount has not reached and that its surface does not excuse,
 *  in report order. */
export function reachGaps(
  reach: AdapterReach,
  surface: AdapterSurface | null = null,
): readonly AuthoringProviderKey[] {
  return AUTHORING_PROVIDER_KEYS.filter(
    (key) => !reach.providers[key] && notApplicableReason(surface, key) === null,
  );
}

/** Greppable prefix shared by every capability warning this module produces. */
export const CAPABILITY_GAP_PREFIX = 'capability-gap';

/**
 * The ONE warning shape for a world the editor cannot fully author, or `null`
 * when it reaches everything its surface can have (a complete mount says
 * nothing — silence is what "identical to native" sounds like).
 *
 * `mechanism` is the mount's own description of how it reached the game
 * (the capture route, a failure reason) — diagnosis the reader needs to act on
 * the fix, never a verdict.
 */
export function formatCapabilityWarning(
  worldId: string,
  reach: AdapterReach,
  mechanism: string,
  surface: AdapterSurface | null = null,
): string | null {
  const lines: string[] = [];
  if (!reach.captured) {
    lines.push(`  ✗ capture — ${CAPTURE_GAP.missing}\n      fix: ${CAPTURE_GAP.fix}`);
  }
  for (const key of reachGaps(reach, surface)) {
    lines.push(`  ✗ ${key} — ${PROVIDER_GAP[key].missing}\n      fix: ${PROVIDER_GAP[key].fix}`);
  }
  if (lines.length === 0) return null;
  return [
    `${CAPABILITY_GAP_PREFIX} world "${worldId}" — ${lines.length} editor capabilit${
      lines.length === 1 ? 'y is' : 'ies are'
    } missing (${mechanism}). This world is not authorable the way a native one is:`,
    ...lines,
  ].join('\n');
}
