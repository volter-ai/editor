/**
 * "What is the inspector looking at right now?" — the LIVE half of the
 * serialized projection (`inspection/serialize.ts` is the pure half; design:
 * `docs/ARCHITECTURE-CORE.md` §Editor chrome, "The Inspection Model"; build
 * ledger: `docs/WORK.md` §Inspection Model program, W4).
 *
 * `components/Inspector.tsx` answers this question every render, for the
 * column and the card. This module answers the SAME question, with the SAME
 * calls in the SAME order, for the agent surface (`editor.inspect`) — because
 * "the agent reads what the human sees" is only true if both go through
 * `composeInspectionSubject` with identically-resolved inputs. Every step is
 * shared code, not a re-derivation: `activeInspectionSurface`,
 * `resolvePanelAuthoring`, `resolveInspectionSubjectId`, `matchedInspectorSections`,
 * `describeNullInspectionSubject`, `resolveComposeStoriesInput`.
 *
 * The two do not differ ANYWHERE any more. An asset document is the three
 * paradigm scoped to a subtree, so clicking a part inside one composes that
 * part's subject through the document's own adapter exactly as clicking a
 * node in the scene composes that node's, and the document's own identity
 * floor arrives through the same no-selection seam every other surface uses
 * (`authoring/null-inspection-subjects.tsx` reads what the document published
 * to `inspection/document-subject.ts`).
 *
 * It is a FUNCTION over live state, like `inspection/active-surface.ts`: no
 * cache, no subscription, no store. The answer is composed at the moment it
 * is asked for.
 */

import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import { CompositeAuthoringAdapter } from '../authoring/composite-authoring-adapter';
import { documentViewport } from '@volter/editor-sdk/kit/document-viewports';
import { inspectionNodeMedia } from '@volter/editor-sdk/kit/inspection-node-media';
import { resolvePanelAuthoring } from '../authoring/panel-authoring';
import { LIVE_ONLY_ACK, type WriteAck } from '@volter/editor-sdk/kit/write-pipe';
import { describeAssetSelectionSubject } from '../components/asset-selection-section';
import { ingestCoverageSection } from '@volter/editor-sdk/kit/CapabilityCoverageSection';
import { resolveInspectionSubjectId } from '../components/inspector-selection';
import { resolveComposeStoriesInput } from '../components/inspector-stories-gating';
import { kindDocumentEntry } from '../components/kind-documents';
import type { EditorShellStore } from '../editor-shell-store';
import { inspectorPresentationOverride } from '../inspector-presentation';
import { matchedInspectorSections } from '@volter/editor-sdk/kit/inspector-section-registry';
import { liveCoverage } from '@volter/editor-sdk/kit/live-session-registry';
import { documentContributionForKind } from '../tool-loader';
import { GAME_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import {
  activeWorkspaceDocument,
  activeWorkspaceDocumentId,
  type WorkspaceDocumentSelection,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { activeChromeRegions } from '../workspace-regions';
import { activeInspectionSurface } from './active-surface';
import {
  composeInspectionSubject,
  composeNullInspectionSubject,
  type OwnedInspectorRail,
} from './compose-subject';
import {
  type InspectionDisplay,
  inspectorBelongsToAnotherDocument,
  resolveInspectionDisplay,
} from './display';
import { GAME_SUBJECT_ID } from './game-subject';
import {
  type FieldDescriptor,
  fieldReadonlyReason,
  type InspectionFieldIo,
  type InspectionSubject,
  type InspectionSurfaceKind,
} from '@volter/editor-sdk/kit/inspection-model';
import { describeNullInspectionSubject } from './null-subject';
import { NO_INSPECTION, type SerializedInspection, serializeInspectionSubject } from './serialize';

/** A composed subject plus "is there an inspector at all?" — everything the
 *  one compose call site produces, before any projection decision. */
export interface ComposedInspection {
  readonly subject: InspectionSubject;
  /** A selection, or the surface's own `describeSubject(null)` answer, or a
   *  contribution that matched the empty selection (the asset browser's
   *  transient selection is one). `false` means NOTHING renders. */
  readonly available: boolean;
}

/** One capture function per live document viewport. Inspector composition is a
 * pure read and may run for unrelated shell updates; keeping this callback
 * stable prevents those updates from retriggering an expensive GPU readback.
 * `previewKey` still requests a fresh frame when the actual selection changes. */
const viewportCaptures = new WeakMap<object, (size: number) => Promise<string | null>>();

function viewportCapture(
  viewport: { capture?(size?: number): string | null },
): ((size: number) => Promise<string | null>) | null {
  if (!viewport.capture) return null;
  const existing = viewportCaptures.get(viewport);
  if (existing) return existing;
  const capture = async (size: number) => viewport.capture?.(size) ?? null;
  viewportCaptures.set(viewport, capture);
  return capture;
}

interface NativeCanvasPreviewAdapter extends AuthoringAdapter {
  previewImage(id: string, width: number, height: number): Promise<string | null>;
}

function hasNativeCanvasPreview(adapter: AuthoringAdapter): adapter is NativeCanvasPreviewAdapter {
  return typeof (adapter as Partial<NativeCanvasPreviewAdapter>).previewImage === 'function';
}

/** Resolve the native canvas-preview owner behind a selected id, including a
 * manifest composite. Capability presence is enough; importing the concrete
 * Pixi adapter here made every Three-only editor boot initialize Pixi. */
function canvasPreviewFor(
  adapter: AuthoringAdapter,
  nodeId: string | null,
  surface: InspectionSurfaceKind | undefined,
): ((size: number) => Promise<string | null>) | null {
  if (!nodeId) return null;
  // Asset Lab already owns the canonical native viewport. Re-mounting the
  // selected Object3D inside Inspector duplicates its scene, animation mixer
  // and render loop (and a lone SkinnedMesh cannot own its sibling bones).
  // Capture the existing viewport once instead: honest native pixels, no
  // second continuously-rendered rig, and no fabricated preview hierarchy.
  if (surface === 'asset-lab') {
    const viewport = documentViewport(activeWorkspaceDocumentId());
    return viewport ? viewportCapture(viewport) : null;
  }
  let candidate = adapter;
  if (adapter instanceof CompositeAuthoringAdapter) {
    const worldId = adapter.ownerOf(nodeId);
    candidate =
      adapter.childAdapters().find((child) => child.worldId === worldId)?.adapter ?? adapter;
  }
  return hasNativeCanvasPreview(candidate)
    ? (size) => candidate.previewImage(nodeId, size, size)
    : null;
}

/**
 * WHOSE RAIL IS THIS? — the active document's own package's, when that
 * document declared `export const inspectorRail = 'owned'` (owner ruling,
 * WORK.md §Blender in the tab is Blender, "Inspection parity", I2 decision 1).
 *
 * The one case shipped today is the Model document: Blender's Properties
 * editor draws the tabs `ED_buttons_tabs_list` returns and nothing else, so
 * the host's Preview / Transform / generic Object / Geometry / Materials
 * blocks stand down beside Blender's sixteen. The resolution is a lookup, not
 * a policy: a kind document's entry names its kind, the kind names its
 * contribution (`tool-loader.ts`'s `documentContributionForKind`), and the
 * contribution says whether it owns the rail and which built-ins it keeps.
 *
 * Spread into the compose input, so a document that owns nothing contributes
 * no key at all and composition is byte-identical to before this existed.
 */
function ownedInspectorRail(): { rail: OwnedInspectorRail } | null {
  const documentId = activeWorkspaceDocumentId();
  if (documentId === null) return null;
  const entry = kindDocumentEntry(documentId);
  if (entry === undefined) return null;
  const contribution = documentContributionForKind(entry.kind);
  if (contribution === undefined || contribution.inspectorRail !== 'owned') return null;
  return {
    rail: { owner: contribution.owner, builtins: contribution.inspectorBuiltins ?? [] },
  };
}

/**
 * The ONE compose call site for the live shell — the whole of "resolve the
 * four channels for THIS binding and hand them to `inspection/compose.ts`".
 *
 * Two callers, and they differ only in where the binding comes from:
 * {@link describeActiveInspectionSubject} resolves it from live state, and
 * `components/Inspector.tsx`'s bounded design-system host is handed one. They
 * used to be two copies of this block; keeping the copies in step was
 * discipline, and the point of the model is that it should be structure.
 */
export function composeInspectionForBinding(input: {
  readonly store: EditorShellStore;
  readonly adapter: AuthoringAdapter;
  readonly documentSelection: WorkspaceDocumentSelection | null;
  /** Absent in a bounded host: it names no surface, so its subject carries no
   *  per-surface affinity and its projection offers no preference switch. */
  readonly surface?: InspectionSurfaceKind | undefined;
}): ComposedInspection {
  const { store, adapter, documentSelection, surface } = input;
  // PRODUCER SELECTION, and the only one: a single click in the Assets
  // browser names its own subject, so the asset is what the box shows — not a
  // section bolted onto whatever was selected before it.
  const assetSubject = describeAssetSelectionSubject();
  if (assetSubject !== null) {
    return {
      subject: composeNullInspectionSubject({ nullSubject: assetSubject, surface }),
      available: true,
    };
  }
  const nodeId = resolveInspectionSubjectId(documentSelection, store.selectedEntityIds, adapter);
  const node = nodeId ? adapter.hierarchy.node(nodeId) : null;
  // A selected id the current adapter's hierarchy cannot resolve matches NO
  // contribution, and is not the null selection either. This occurs briefly
  // during Edit↔Play ownership handoff; do not route the stale id into the
  // adapter's inspector (which correctly refuses ids no current root owns).
  if (nodeId !== null && node === null) {
    return {
      subject: composeNullInspectionSubject({ nullSubject: null, surface }),
      available: false,
    };
  }
  const onEdit = () => store.notifyIngestEdit();
  // The null subject is resolved BEFORE the contributions, because it is an
  // input to matching them: with nothing selected every surface hands a
  // matcher the same `(null, adapter)`, so the subject's id is the only thing
  // that says WHICH empty state this is (`inspector-section-registry.ts`'s
  // `InspectorSectionMatchContext`). Resolving it after meant a contribution
  // scoped to one empty-state subject appeared in all of them.
  const nullSubject = nodeId
    ? null
    : describeNullInspectionSubject({ adapter, surface, store, onEdit });
  const contributions = nodeId
    ? node
      ? matchedInspectorSections(node, adapter)
      : []
    : matchedInspectorSections(null, adapter, { nullSubjectId: nullSubject?.id ?? null });
  const media = nodeId ? inspectionNodeMedia(adapter, nodeId) : null;
  const subject = composeInspectionSubject({
    adapter,
    nodeId,
    node,
    surface,
    contributions,
    ...(nodeId ? {} : { nullSubject }),
    // Outside Asset Lab the node's medium previews it in isolation. Asset Lab
    // already owns that native viewport, so `canvasPreviewFor` supplies a
    // one-shot capture instead of a second live render loop.
    media: surface === 'asset-lab' ? null : media,
    canvasPreview: canvasPreviewFor(adapter, nodeId, surface),
    assetDocument: media?.assetDocument ?? null,
    stories: resolveComposeStoriesInput(adapter, node, nodeId),
    // A DOCUMENT WHOSE PACKAGE OWNS ITS PROPERTIES RAIL stands the shell's own
    // sections down (`inspection/compose.ts`, `OwnedInspectorRail`).
    ...(ownedInspectorRail() ?? {}),
    // The box describes ONE node; a gizmo drag moves every selected one.
    // Say how many, so a three-object drag is not headed by a single name
    // (`InspectionSubject.alsoSelected`). Only the SHARED store selection
    // counts: a document that supplies its own selection is answering for
    // itself and the scene's selection is not what its reader is looking at.
    ...(documentSelection === null && nodeId !== null && store.selectedEntityIds.size > 1
      ? { alsoSelected: store.selectedEntityIds.size - 1 }
      : {}),
    onEdit,
  });
  return {
    subject,
    available: nodeId !== null || nullSubject !== null || contributions.length > 0,
  };
}

/**
 * The subject showing right now, resolved into the ONE
 * {@link InspectionDisplay} every consumer reads: the composed subject, the
 * surface it belongs to, whether there is an inspector at all, and which
 * projection is showing it. `components/Inspector.tsx` renders it,
 * the workspace host gates the dock panel and the floating card
 * on it, and `inspectActiveSubject` serializes it — all from this one call,
 * so no consumer can reach a different answer (see `inspection/display.ts`).
 */
export function describeActiveInspectionSubject(store: EditorShellStore): InspectionDisplay {
  const surface = activeInspectionSurface(store);
  const { adapter, documentSelection } = resolvePanelAuthoring(store);
  const composed = composeInspectionForBinding({
    store,
    adapter,
    documentSelection,
    surface,
  });
  const { subject } = composed;
  // DECISION (2026-08-14, owner-reported): a project-TOOL document owns its
  // whole surface, so the scene's inspector must not float over it.
  //
  // `resolvePanelAuthoring` has no tool-document branch, so with the Data sheet
  // active it falls through to the scene's composite adapter and composes
  // whatever was selected in the 3D scene BEFORE the tab switch — the compact
  // card then renders over a document that is not its subject's (measured
  // live: active document `tool:data-tables.document`, `editor.inspect()`
  // answering `world:world` at surface `three`, presentation `card`).
  //
  // The test is the same POSITIVE shape `active-surface.ts` uses for Asset Lab:
  // does the ACTIVE tool document publish its own inspection context? A tool
  // document that does (the humanoid builder's Object3D preview publishes a
  // `WorkspaceDocumentSelection`) keeps its inspector, because that inspector
  // IS the document's. One that does not is being described by another
  // document's selection, and per the inspector doctrine — "with nothing
  // selected the inspector shows nothing" — nothing is what it gets.
  const available =
    composed.available &&
    (subject.id !== GAME_SUBJECT_ID || subject.sections.length > 0) &&
    !inspectorBelongsToAnotherDocument({
      activeDocumentKind: activeWorkspaceDocument()?.descriptor.kind ?? null,
      documentSelection,
    });
  const report = activeWorkspaceDocumentId() === GAME_DOCUMENT_ID ? liveCoverage() : null;
  if (report) {
    const coverage = ingestCoverageSection(report);
    const coverageSubject: InspectionSubject = available
      ? {
          ...subject,
          sections: [
            ...subject.sections.filter((section) => section.id !== coverage.id),
            coverage,
          ].sort((a, b) => a.order - b.order),
        }
      : {
          id: `ingest:${report.summary.worldId}`,
          title: 'Ingested game',
          identity: null,
          hint: 'This mount exposes no editable scene subject. Coverage below says exactly which editor seams it did earn.',
          presentation: subject.presentation,
          quickActions: [],
          related: [],
          sections: [coverage],
        };
    return resolveInspectionDisplay({
      subject: coverageSubject,
      surface,
      available: true,
      override: inspectorPresentationOverride(surface),
      workspaceDefault: activeChromeRegions().inspector ?? null,
    });
  }
  return resolveInspectionDisplay({
    subject,
    surface,
    available,
    override: inspectorPresentationOverride(surface),
    workspaceDefault: activeChromeRegions().inspector ?? null,
  });
}

/**
 * The active inspection subject as JSON — the whole of `editor.inspect`'s
 * browser side.
 *
 * It reads the SAME `available` flag the dock and the card gate on, so the
 * wire cannot claim a subject the human is not being shown: with nothing
 * selected on a surface that has no empty-state subject, the box unmounts and
 * this answers {@link NO_INSPECTION}. Serializing the composed subject anyway
 * would report a placeholder nobody is looking at as though it were the
 * inspector's contents — the fabrication the anti-shim rule names, on the one
 * surface that exists to be believed.
 */
export function inspectActiveSubject(store: EditorShellStore): SerializedInspection {
  const { subject, surface, presentation, available } = describeActiveInspectionSubject(store);
  if (!available) return NO_INSPECTION;
  return serializeInspectionSubject(subject, { surface, presentation });
}

/** Run one verb from the active Inspector's own composed subject.
 *
 * This is the action counterpart to {@link setActiveInspectionField}: the
 * control plane resolves the same action the human projection renders and
 * awaits that action's own completion. It deliberately takes no entity id —
 * the active Inspector subject is the address, just as it is for field edits.
 */
export async function runActiveInspectionAction(
  store: EditorShellStore,
  actionId: string,
): Promise<SerializedInspection> {
  const { subject, available } = describeActiveInspectionSubject(store);
  if (!available) throw new Error('No Inspector subject is active.');
  const matches = subject.quickActions.filter((action) => action.id === actionId);
  if (matches.length !== 1) {
    const availableActions = subject.quickActions.map((action) => action.id);
    throw new Error(
      matches.length === 0
        ? `Inspector action ${JSON.stringify(actionId)} is not available. ` +
            (availableActions.length > 0
              ? `Available actions: ${availableActions.join(', ')}.`
              : 'This subject exposes no actions.')
        : `Inspector action id ${JSON.stringify(actionId)} is ambiguous (${matches.length} matches).`,
    );
  }
  const action = matches[0];
  if (!action || action.disabled) {
    throw new Error(`Inspector action ${JSON.stringify(actionId)} is disabled.`);
  }
  await action.run();
  return inspectActiveSubject(store);
}

function assertInspectionFieldValue(field: FieldDescriptor, value: unknown): void {
  const invalid = (expected: string): never => {
    throw new Error(`Inspector field ${JSON.stringify(field.path)} expects ${expected}.`);
  };
  if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    invalid('a finite number');
  }
  if (field.type === 'boolean' && typeof value !== 'boolean') invalid('a boolean');
  if (
    (field.type === 'string' ||
      field.type === 'color' ||
      field.type === 'asset' ||
      field.type === 'enum') &&
    typeof value !== 'string'
  ) {
    invalid('a string');
  }
  if (
    field.type === 'vec3' &&
    (!Array.isArray(value) ||
      value.length !== 3 ||
      value.some((component) => typeof component !== 'number' || !Number.isFinite(component)))
  ) {
    invalid('three finite numbers');
  }
  if (field.type === 'enum' && field.options && !field.options.includes(value)) {
    throw new Error(
      `Inspector field ${JSON.stringify(field.path)} accepts: ${field.options.map(String).join(', ')}.`,
    );
  }
}

/**
 * Write one field through the same live Inspector IO the human projection uses,
 * and report WHERE THAT WRITE went.
 *
 * The destination is not decoration. With no persistence route open — the
 * structural lane over a fiber world, or an ingest root that is playing rather
 * than held — the write lands on the live object, journals live-only and
 * changes no byte. That is the product working as designed, but silence about
 * it is indistinguishable from a write that vanished, and a caller diffing the
 * tree to find out will call the healthy case a defect. So `persisted: false`
 * is an ANSWER.
 *
 * THE ACK COMES FROM THE WRITE, not from the surface. It is whatever the
 * persistence pipe returned to the provider that performed THIS edit
 * (`authoring/write-pipe.ts`), handed straight up through `io.set`. Reading a
 * destination off the ACTIVE ADAPTER afterwards is what this replaced: the
 * composite joined only its persist-capable children, so a three-root edit
 * acked the DOM root's file with `persisted: true` — measured on the vendored
 * racing game. An io that performed no persisted write returns nothing, and
 * the live-only floor below is the honest answer for it; there is deliberately
 * no fallback that reads a destination from anywhere else.
 */
export async function setActiveInspectionField(
  store: EditorShellStore,
  path: string,
  value: unknown,
): Promise<{ subject: SerializedInspection; write: WriteAck }> {
  const match = resolveWritableField(store, path);
  assertInspectionFieldValue(match.field, value);
  const write = (await match.io.set(path, value)) ?? LIVE_ONLY_ACK;
  return { subject: inspectActiveSubject(store), write };
}

/** One editable path in the active Inspector, with the io that owns it. */
interface FieldMatch {
  readonly field: FieldDescriptor;
  readonly io: InspectionFieldIo;
}

/**
 * Resolve ONE writable field of the active subject — the shared front half of
 * every field door (`set` and `remove`), so the two cannot disagree about which
 * io owns a path or about what "no such field" means.
 */
function resolveWritableField(store: EditorShellStore, path: string): FieldMatch {
  const { subject, available } = describeActiveInspectionSubject(store);
  if (!available) throw new Error('No Inspector subject is active.');
  const subjectMatches = (subject.editable?.fields ?? [])
    .filter((field) => field.path === path)
    .map((field) => ({ field, io: subject.editable!.io }));
  const sectionMatches = subject.sections.flatMap((section) => {
    // A custom body's `editable` is the same (fields, io) pair a fields body
    // is, declared by a section that draws its own chrome — the Transform
    // section is the shipped one. Reading them together is what keeps ONE
    // write path per field.
    const body = section.body;
    const editable =
      body.kind === 'fields'
        ? { fields: body.fields, io: body.io }
        : body.kind === 'custom'
          ? body.editable
          : undefined;
    if (!editable) return [];
    return editable.fields
      .filter((field) => field.path === path)
      .map((field) => ({ field, io: editable.io }));
  });
  const matches = [...subjectMatches, ...sectionMatches];
  if (matches.length === 0) {
    throw new Error(`The active Inspector has no field at ${JSON.stringify(path)}.`);
  }
  if (matches.length > 1) {
    throw new Error(`The active Inspector exposes ${JSON.stringify(path)} more than once.`);
  }
  const match = matches[0]!;
  if (match.field.readonly) {
    throw new Error(
      `Inspector field ${JSON.stringify(path)} is read-only: ${fieldReadonlyReason(match.field)}`,
    );
  }
  return match;
}

/**
 * The refusal a caller must be able to tell apart from every other one: this
 * lane cannot express byte-absence for this field, so nothing was attempted.
 *
 * It is NOT a failure of the removal — it is the absence of the door. The
 * distinction is the whole reason the class exists: an instrument grading an
 * edit/revert round trip must report a missing seam as UNVERIFIABLE and a
 * removal that ran and left the bytes changed as FAILED, and prose cannot be
 * matched on. `command-listener.ts` turns this into the wire's
 * `code: 'REMOVAL_UNAVAILABLE'`.
 */
export class InspectionRemovalUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InspectionRemovalUnavailableError';
  }
}

/**
 * REMOVE one field's authored override through the same Inspector IO the human
 * revert arrow uses, and report WHERE THAT REMOVAL went.
 *
 * ## Why this exists beside {@link setActiveInspectionField}
 *
 * `set` writes a VALUE, and a value is not the same thing as an absence. When
 * an authoring gesture adds a prop the source did not carry — the append path
 * in every dialect writer — reverting it through the value door writes the
 * default back EXPLICITLY (`position={[0, 0, 0]}`), so the file is left one
 * attribute heavier than it started. Byte-level revert is then impossible
 * through the protocol, which is exactly what `scripts/doctor-walk.ts` measured
 * as "BOTH product doors failed to revert" on a healthy lane.
 *
 * ## What it will NOT do
 *
 * It never falls back to a value write, and it never guesses what absence means
 * for a dialect. Two declarations gate it, both read rather than inferred:
 * the descriptor's own `resettable` (the adapter saying removal is legal here)
 * and the io's `remove` (the lane saying it has a door at all). Missing either
 * one raises {@link InspectionRemovalUnavailableError} — a NAMED refusal an
 * instrument can grade as an unreached seam, never a silent no-op and never a
 * write that pretends to be a revert.
 */
export async function removeActiveInspectionField(
  store: EditorShellStore,
  path: string,
): Promise<{ subject: SerializedInspection; write: WriteAck }> {
  const match = resolveWritableField(store, path);
  if (match.field.resettable !== true) {
    throw new InspectionRemovalUnavailableError(
      `Inspector field ${JSON.stringify(path)} does not declare itself removable ` +
        "(`resettable`), so this lane has no way to express the property's absence. " +
        'Write a value with `set-inspection-field` instead — and note that doing so cannot ' +
        'restore byte-absence for a property an edit ADDED.',
    );
  }
  if (!match.io.remove) {
    throw new InspectionRemovalUnavailableError(
      `The Inspector io that owns ${JSON.stringify(path)} implements no removal door, so the ` +
        "property's authored override cannot be dropped through this editor. The dialect writer " +
        'that owns this source edit owns removal too; until it does, an edit/revert round trip ' +
        'over this lane is unverifiable at byte level.',
    );
  }
  const write = (await match.io.remove(path)) ?? LIVE_ONLY_ACK;
  return { subject: inspectActiveSubject(store), write };
}
