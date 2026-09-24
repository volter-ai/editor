/**
 * `composeInspectionSubject` — the ONE pure function that turns the editor's
 * four inspection channels into an {@link InspectionSubject}
 * (`inspection/model.ts`). Design: `docs/ARCHITECTURE-CORE.md` §Editor chrome
 * ("The Inspection Model"); build ledger: `docs/WORK.md` §Inspection Model
 * program, W1.
 *
 * The four channels it wraps, in render order:
 *  1. the adapter's typed `InspectorProvider` descriptors — the loose
 *     (ungrouped) grid, then one section per named `group`;
 *  2. `inspector-section-registry.ts`'s matched contributions — opaque custom
 *     bodies, in registration order;
 *  3. the shell built-ins — the identity row, the live Preview section,
 *     Transform, Stories;
 *  4. the verbs — the visibility eye (lifted OUT of the descriptor grid: the
 *     hierarchy already presents visibility as an eye, and the same fact must
 *     not reappear as a labelled checkbox) and the Asset Editor jump.
 *
 * It is a FUNCTION, not a store: no cache, no module state, no subscription.
 * Every projection calls it during its own render, so the model is always as
 * fresh as the render that asked for it.
 *
 * With NOTHING selected it composes the same subject shape out of the active
 * adapter's own empty state (`inspection/null-subject.ts`) — W3, so a
 * surface's empty inspector is its own subject and never another surface's.
 *
 * Replacement is resolved HERE and nowhere else, and it is POSITIVE SPACE: a
 * contribution CLAIMS the section id it provides, and a built-in whose id is
 * claimed is simply not composed. A projection sees one list of identified
 * sections and never learns that a built-in existed.
 */

import {
  faArrowUpFromBracket,
  faAtom,
  faBookOpen,
  faCamera,
  faCube,
  faDiagramProject,
  faEye,
  faEyeSlash,
  faLightbulb,
  faMusic,
  faPalette,
  faPerson,
  faPuzzlePiece,
  faSliders,
  faUpDownLeftRight,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons';
import type {
  AuthoringAdapter,
  EditorNode,
  StoryRef,
  Transform,
  TransformChannel,
  TransformEditability,
} from '@volter/editor-project/adapter';
import { contentWorldBounds } from '@volter/editor-threejs/viewport/content-bounds';
import { createElement } from 'react';
import type * as THREE from 'three';
import {
  applyAuthoringTransform,
  beginAuthoringTransformEdit,
  commitAuthoringTransformSource,
  endAuthoringTransformEdit,
  removeAuthoringInspectorField,
  removeAuthoringTransform,
  setAuthoringInspectorField,
} from '../authoring/consumer-actions';
import { authoringDestination, provenanceForNode } from '../authoring/provenance';
import { InspectorStoriesSection } from '../components/InspectorStoriesSection';
import { InspectorTransformSection } from '../components/InspectorTransformSection';
import {
  InspectorCanvasPreviewBody,
  InspectorComponentPreviewBody,
  InspectorPreviewBody,
} from '../components/inspector-preview-section';
import { groupProperties } from '@volter/editor-sdk/kit/inspector-property-grouping';
import { rotationDegrees, withTransformChannel } from '../components/inspector-transform';
import { transformDimensionsFor } from '../components/inspector-transform-subject';
import {
  type ContentEntry,
  type ContentEntrySource,
  contentEntryForComponent,
} from '../content-entry-source-registry';
import {
  type InspectorSectionContribution,
  isSectionsProducer,
} from '@volter/editor-sdk/kit/inspector-section-registry';
import { describeInstancedPresentation } from '../instanced-presentation';
import {
  type FieldDescriptor,
  GROUP_SECTION_ORDER,
  groupSectionId,
  type InspectionAction,
  type InspectionFieldIo,
  type InspectionSection,
  type InspectionSubject,
  type InspectionSurfaceKind,
  inspectionAffinityFor,
  PREVIEW_SECTION_ID,
  PREVIEW_SECTION_ORDER,
  PROPERTIES_SECTION_ID,
  PROPERTIES_SECTION_ORDER,
  STORIES_SECTION_ID,
  STORIES_SECTION_ORDER,
  TRANSFORM_SECTION_ID,
  TRANSFORM_SECTION_ORDER,
} from '@volter/editor-sdk/kit/inspection-model';
import type { NullInspectionSubject } from './null-subject';

/** Above this many properties a group starts collapsed even when the document
 *  sets some of them — a 40-field library block is a wall, not a panel. */
const GROUP_AUTO_OPEN_MAX = 14;

/** Property groups are component blocks named by their owner (`RigidBody`,
 *  `Material`, `PlayerCharacter`…) — keyword-match the name to a legible
 *  icon; the tooltip carries the exact name either way. */
const GROUP_ICON_RULES: readonly (readonly [RegExp, IconDefinition])[] = [
  [/physic|rigid|collid/i, faAtom],
  [/material/i, faPalette],
  [/light/i, faLightbulb],
  [/camera/i, faCamera],
  [/audio|sound|music/i, faMusic],
  [/player|character|humanoid|person/i, faPerson],
  [/anim|state|machine/i, faDiagramProject],
];

export function groupIcon(name: string): IconDefinition {
  for (const [pattern, icon] of GROUP_ICON_RULES) {
    if (pattern.test(name)) return icon;
  }
  return faPuzzlePiece;
}

type PreviewRenderer = Extract<InspectionSection['body'], { readonly kind: 'preview' }>['render'];

function objectPreviewRenderer(input: {
  readonly object: THREE.Object3D;
  readonly displayName: string;
  readonly previewKey: string;
  readonly actions: readonly InspectionAction[];
}): PreviewRenderer {
  return (mode) =>
    createElement(InspectorPreviewBody, {
      object: input.object,
      displayName: input.displayName,
      previewKey: input.previewKey,
      actions: input.actions,
      ...(mode ? { mode } : {}),
    });
}

function componentPreviewRenderer(input: {
  readonly picture: { readonly source: ContentEntrySource; readonly entry: ContentEntry };
  readonly previewKey: string;
  readonly actions: readonly InspectionAction[];
}): PreviewRenderer {
  return (mode) =>
    createElement(InspectorComponentPreviewBody, {
      source: input.picture.source,
      entry: input.picture.entry,
      previewKey: input.previewKey,
      actions: input.actions,
      ...(mode ? { mode } : {}),
    });
}

function canvasPreviewRenderer(input: {
  readonly capture: (size: number) => Promise<string | null>;
  readonly previewKey: string;
  readonly actions: readonly InspectionAction[];
}): PreviewRenderer {
  return (mode) =>
    createElement(InspectorCanvasPreviewBody, {
      capture: input.capture,
      previewKey: input.previewKey,
      actions: input.actions,
      ...(mode ? { mode } : {}),
    });
}

function selectionPreviewRenderer(input: {
  readonly object: THREE.Object3D | null;
  readonly canvasCapture: ((size: number) => Promise<string | null>) | null | undefined;
  readonly picture: { readonly source: ContentEntrySource; readonly entry: ContentEntry } | null;
  readonly displayName: string;
  readonly previewKey: string;
  readonly actions: readonly InspectionAction[];
}): PreviewRenderer | null {
  // A camera's preview is its view through the scene, owned by the viewport.
  // An isolated model snapshot of the camera itself contains no image.
  if ((input.object as THREE.Camera | null)?.isCamera) return null;
  if (input.object) {
    return objectPreviewRenderer({
      object: input.object,
      displayName: input.displayName,
      previewKey: input.previewKey,
      actions: input.actions,
    });
  }
  if (input.canvasCapture) {
    return canvasPreviewRenderer({
      capture: input.canvasCapture,
      previewKey: input.previewKey,
      actions: input.actions,
    });
  }
  if (input.picture) {
    return componentPreviewRenderer({
      picture: input.picture,
      previewKey: input.previewKey,
      actions: input.actions,
    });
  }
  return null;
}

/** `transform.position` -> `position`. The three paths the Transform section's
 *  write half publishes are the only ones its io is ever handed. */
function transformChannelOf(path: string): TransformChannel {
  const channel = path.slice('transform.'.length);
  if (channel !== 'position' && channel !== 'rotation' && channel !== 'scale') {
    throw new Error(`The Transform section has no ${JSON.stringify(path)}.`);
  }
  return channel;
}

const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
};

/** The Stories section's content for this selection, or `null` when the
 *  selection has no stories concept at all. Resolved by the caller because
 *  the gating is an adapter-TOPOLOGY question (which child adapter owns this
 *  row) rather than a composition one. */
export interface ComposeStoriesInput {
  readonly stories: readonly StoryRef[];
  readonly activeStoryId: string;
  readonly onApplyStory: (storyId: string | null) => void;
  /** B3 — a catalog component node also gets the Isolate toggle. */
  readonly isolation: { readonly isolated: boolean; readonly toggle: () => void } | null;
  /** The provider's own display vocabulary (`StoriesProvider.title`) — an
   *  ingested game's contract scenes say "Scenes". Absent ⇒ "Stories". */
  readonly title?: string;
  /** The provider's own reason its list could not be read
   *  (`StoriesProvider.unavailable`), or `null` when it ran. */
  readonly unavailableReason?: string | null;
}

export interface ComposeInspectionInput {
  readonly adapter: AuthoringAdapter;
  /** The selected node, or `null` for the NO-SELECTION subject — which is
   *  the active surface's own empty state, never a shared blank. */
  readonly nodeId: string | null;
  /** The resolved hierarchy node, or `null` when the active adapter cannot
   *  resolve the selected id. */
  readonly node: EditorNode | null;
  /** The surface this subject belongs to — decides its presentation
   *  affinity, and nothing else here. Absent in a bounded host, which names
   *  no surface and offers no preference. */
  readonly surface?: InspectionSurfaceKind | undefined;
  /** The active adapter's answer to `describeSubject(null)`
   *  (`inspection/null-subject.ts`), resolved by the caller the same way
   *  `contributions` is. Read only when `nodeId` is `null`; `null` there
   *  means this surface honestly has no empty-state subject. */
  readonly nullSubject?: NullInspectionSubject | null;
  /** `matchedInspectorSections(node, adapter)`, in registration order. */
  readonly contributions: readonly InspectorSectionContribution[];
  /** How many OTHER things are selected alongside {@link nodeId} — see
   *  {@link InspectionSubject.alsoSelected}. The caller resolves it, because
   *  the selection lives on the store and this function is pure over one
   *  node. */
  readonly alsoSelected?: number | undefined;
  /**
   * The live `Object3D` this node can be previewed FROM, or `null` when there
   * is none. Present ⇒ the subject gets a Preview section; absent ⇒ it simply
   * has no such section. It is the object rather than an id to look one up by,
   * because "previewable" and "renders honestly" have to be the same fact: a
   * part inside an asset document is a real object that is NOT in the shell's
   * object map, and an id-keyed preview could only have shown a "no longer
   * available" alert for a thing that is on screen.
   */
  readonly previewObject: THREE.Object3D | null;
  /** Live native Canvas/Pixi subtree capture. The mounted surface owns the
   * renderer, so the caller supplies the capture door when one exists. */
  readonly canvasPreview?: ((size: number) => Promise<string | null>) | null;
  /** This node has an Asset Lab document to jump to. */
  readonly assetDocument: { readonly open: () => void } | null;
  readonly stories: ComposeStoriesInput | null;
  /** Notify the shell that the adapter's truth changed (`notifyIngestEdit`). */
  readonly onEdit: () => void;
  /** See {@link OwnedInspectorRail} — present only while a document whose
   *  package owns its Properties rail is active. */
  readonly rail?: OwnedInspectorRail | undefined;
}

/**
 * A contribution's identified sections — the one place an
 * `InspectorSectionContribution` becomes `InspectionSection`s.
 *
 * A single-section registration yields exactly one, with an opaque custom
 * body. A PRODUCER (`InspectorSectionsProducer`) yields whatever the node
 * has: the react/DOM adapter's descriptor groups are its Layout / Style /
 * Position / Spacing blocks, and only the node can say how many there are.
 * Either way what comes out is model data — identity, order, icon, body —
 * and the projections cannot tell which shape produced it.
 */
export function contributionSections(
  contribution: InspectorSectionContribution,
  adapter: AuthoringAdapter,
  nodeId: string | null,
  node: EditorNode | null,
): readonly InspectionSection[] {
  if (isSectionsProducer(contribution)) return contribution.sections(node, adapter);
  const Section = contribution.Section;
  return [
    {
      id: contribution.id,
      title: contribution.title,
      // A registration's icon may be a FUNCTION of the subject
      // (`InspectorSectionIcon`) — Blender's Object Data tab draws the mark
      // its object type earns. Resolved here, once per composition, so every
      // projection downstream still receives a plain `IconDefinition`.
      icon:
        typeof contribution.icon === 'function'
          ? contribution.icon(node, adapter)
          : contribution.icon,
      order: contribution.order,
      ...(contribution.railGroup === undefined ? {} : { railGroup: contribution.railGroup }),
      ...(contribution.railDefault === undefined ? {} : { railDefault: contribution.railDefault }),
      body: { kind: 'custom', render: () => createElement(Section, { adapter, nodeId }) },
    },
  ];
}

/**
 * The positive-space replacement protocol, whole: a contribution claims the
 * section ids it PROVIDES, and a built-in whose id is claimed is never
 * composed. A section id is unique within a subject (the compact card keys
 * its tabs by it), so the FIRST claim of an id wins — registration order, the
 * same order everything else here reads.
 *
 * A contribution that loses EVERY claim renders nothing.
 */
function expandContributions(
  contributions: readonly InspectorSectionContribution[],
  adapter: AuthoringAdapter,
  nodeId: string | null,
  node: EditorNode | null,
): {
  sections: InspectionSection[];
  claimed: ReadonlySet<string>;
  /** Which package each contributed section came out of, by section id —
   *  what {@link ComposeInspectionInput.rail} filters on. */
  owners: ReadonlyMap<string, string | undefined>;
} {
  const claimed = new Set<string>();
  const owners = new Map<string, string | undefined>();
  const sections: InspectionSection[] = [];
  for (const contribution of contributions) {
    const produced = contributionSections(contribution, adapter, nodeId, node).filter(
      (section) => !claimed.has(section.id),
    );
    // A producer may also stand a built-in down without replacing it with a
    // section of its own (the descriptor channel of a node with no loose
    // fields).
    const declared = (isSectionsProducer(contribution) ? (contribution.claims ?? []) : []).filter(
      (id) => !claimed.has(id),
    );
    if (produced.length === 0 && declared.length === 0) continue;
    for (const section of produced) {
      claimed.add(section.id);
      owners.set(section.id, contribution.owner);
    }
    for (const id of declared) claimed.add(id);
    sections.push(...produced);
  }
  return { sections, claimed, owners };
}

/**
 * A DOCUMENT'S PACKAGE OWNS ITS PROPERTIES RAIL (owner ruling; WORK.md
 * §Blender in the tab is Blender, "Inspection parity", I2 decision 1).
 *
 * `owner` is the package whose `workspace.document` contribution mounts the
 * ACTIVE document and declared `export const inspectorRail = 'owned'`;
 * `builtins` is what that document listed in `export const inspectorBuiltins`.
 * Absent — the ordinary case — and composition is exactly as it was.
 */
export interface OwnedInspectorRail {
  readonly owner: string;
  readonly builtins: readonly string[];
}

/**
 * Keep only what an OWNED rail may show: this package's own contributed
 * sections, plus the built-ins the document named by id.
 *
 * WHY A FILTER AND NOT A BRANCH THROUGH THE WHOLE COMPOSER. Every built-in
 * below is composed from live inputs — a preview capture, the transform
 * channel's editability, the descriptor grid's io — and the shell's other
 * doors resolve field paths against exactly those composed sections
 * (`inspection/active-subject.ts`). Composing them and then standing them
 * down keeps one code path for what a section IS, and makes the ownership
 * rule one readable predicate instead of five `if (!rail)` guards. It is also
 * the SMALLEST change: the rule is stated once, here.
 */
function applyOwnedRail(
  sections: readonly InspectionSection[],
  owners: ReadonlyMap<string, string | undefined>,
  rail: OwnedInspectorRail | undefined,
): InspectionSection[] {
  if (rail === undefined) return [...sections];
  return sections.filter(
    (section) => owners.get(section.id) === rail.owner || rail.builtins.includes(section.id),
  );
}

export interface ComposeNullInspectionInput {
  /** The surface's own answer to `describeSubject(null)` — for an asset
   *  document that is the DOCUMENT itself
   *  (`inspection/document-subject.ts`). */
  readonly nullSubject: NullInspectionSubject | null;
  readonly surface?: InspectionSurfaceKind | undefined;
  /** Contributions matching the empty selection, and the adapter they render
   *  against. Both are absent for a subject with no adapter in play — a
   *  document with no authoring of its own describes itself — and
   *  contributions without an adapter to render them are dropped rather than
   *  half-composed. */
  readonly contributions?: readonly InspectorSectionContribution[];
  readonly adapter?: AuthoringAdapter;
  /** See {@link OwnedInspectorRail}. */
  readonly rail?: OwnedInspectorRail | undefined;
}

/**
 * The NO-SELECTION subject: the surface's own empty state
 * (`inspection/null-subject.ts`) plus whatever contributions match the null
 * selection, in one identified section list. There is no descriptor channel,
 * no transform and no preview — there is no node to have any of them — so
 * this branch composes exactly what the surface itself offered and nothing
 * that belongs to another surface.
 *
 * It DOES compose an identity row when the surface named its subject's type
 * (`kindLabel`): an asset document is a thing with a name, a type and a
 * provenance, and both projections render that row exactly as they render a
 * selection's. A three scene's empty state names no type and gets its quiet
 * headline instead. The row is read-only — nothing here renames a document.
 */
export function composeNullInspectionSubject(input: ComposeNullInspectionInput): InspectionSubject {
  const { adapter, nullSubject } = input;
  const {
    sections: contributed,
    claimed,
    owners,
  } = expandContributions(
    adapter ? (input.contributions ?? []) : [],
    // Only reachable with an adapter (`expandContributions` is handed an
    // empty list otherwise), so the cast never dereferences undefined.
    adapter as AuthoringAdapter,
    null,
    null,
  );
  // The claim protocol is the SAME on both branches. A surface's own
  // no-selection section is a built-in like any other: a contribution
  // claiming `environment` REPLACES the scene's environment block, it does
  // not appear beside it. (W4 — the selected path filtered on `claimed` from
  // W2; this one did not, so the first contribution to claim a null-subject
  // id would have duplicated the section instead of replacing it.)
  const sections = applyOwnedRail(
    [
      ...(nullSubject?.sections ?? []).filter((section) => !claimed.has(section.id)),
      ...contributed,
    ].sort((a, b) => a.order - b.order),
    owners,
    input.rail,
  );
  return {
    // The fallback identity is for a surface that named no empty-state subject
    // and yet HAS an inspector: several contributions match on the active
    // DOCUMENT rather than on a node (a story's arg knobs, the 3D board's
    // Exhibit block), so "nothing selected, and here is the document's own block" is
    // a real thing a human looks at. When there is no such block either, the
    // box unmounts and the wire says so (`inspection/active-subject.ts`
    // answers `NO_INSPECTION`) — this object is then composed and discarded,
    // never shown and never serialized.
    id: nullSubject?.id ?? 'nothing-selected',
    title: nullSubject?.title ?? 'Nothing selected',
    identity: nullSubject?.kindLabel
      ? {
          rename: { readOnly: true, set: () => undefined },
          kindLabel: nullSubject.kindLabel,
          ...(nullSubject.note ? { note: nullSubject.note } : {}),
        }
      : null,
    ...(nullSubject?.hint ? { hint: nullSubject.hint } : {}),
    presentation: { preferred: inspectionAffinityFor(input.surface) },
    quickActions: nullSubject?.quickActions ?? [],
    related: [],
    sections,
  };
}

/**
 * Give a CONTRIBUTED custom body the same `editable` the generic body it
 * REPLACED would have carried.
 *
 * A contribution that claims `properties` / `group:<id>` is saying "I draw
 * these descriptors with my own widgets" — not "these descriptors are no
 * longer writable". But `editable` is what `inspection/active-subject.ts`'s
 * `setActiveInspectionField` resolves a path against, so until this existed,
 * claiming a channel silently closed the only control-API write door onto it.
 * Measured on an ingested game's DOM HUD: every style and prop field answered
 * "The active Inspector has no field at …", because
 * `@vgai/dom/react-inspector-section.tsx` claims `PROPERTIES_SECTION_ID` and
 * renders custom bodies — so the lane the editor's panels could author was
 * unreachable to `vgai eval`'s `editor.setField`, the one door an agent has.
 *
 * The `io` handed in is the SAME one the generic bodies use and the SAME
 * `adapter.inspector.set` the contributed widgets call, so this adds a door,
 * never a second write path. A body that already declares its own `editable`
 * (the Transform section) is left exactly as it is, and a contributed section
 * with an id of its own owns no descriptors and gets nothing.
 */
function withDescriptorEditable(
  section: InspectionSection,
  io: InspectionFieldIo,
  fieldsById: ReadonlyMap<string, readonly FieldDescriptor[]>,
): InspectionSection {
  if (section.body.kind !== 'custom' || section.body.editable) return section;
  const fields = fieldsById.get(section.id);
  if (!fields || fields.length === 0) return section;
  return { ...section, body: { ...section.body, editable: { fields, io } } };
}

export function composeInspectionSubject(input: ComposeInspectionInput): InspectionSubject {
  const { adapter, nodeId, node, contributions, onEdit } = input;
  if (nodeId === null) {
    return composeNullInspectionSubject({
      nullSubject: input.nullSubject ?? null,
      surface: input.surface,
      contributions,
      adapter,
      rail: input.rail,
    });
  }

  const {
    sections: contributed,
    claimed,
    owners,
  } = expandContributions(contributions, adapter, nodeId, node);

  const io: InspectionFieldIo = {
    get: (path: string) => adapter.inspector?.get(nodeId, path),
    // Present only when the adapter can show a value without writing it.
    ...(adapter.inspector?.preview
      ? {
          preview: (path: string, value: unknown) => {
            adapter.inspector?.preview?.(nodeId, path, value);
          },
        }
      : {}),
    set: (path: string, value: unknown) => {
      if (!adapter.inspector) return undefined;
      const result = setAuthoringInspectorField(adapter, nodeId, path, value);
      onEdit();
      return result;
    },
    /** Revert-to-default: drop the document's override and let whatever
     *  governs the property in its absence take over (Unity's revert arrow).
     *  The owning provider's own ack is passed straight through, exactly as
     *  `set` does — a removal moves bytes and answers for them. Absent when the
     *  adapter declares no removal door, so the door above it can refuse by
     *  name rather than write a value that leaves the prop in the file. */
    ...(adapter.inspector?.remove
      ? {
          remove: (path: string) => {
            const result = removeAuthoringInspectorField(adapter, nodeId, path);
            onEdit();
            return result;
          },
        }
      : {}),
  };

  // The full property set is DRIVEN BY the adapter's InspectorProvider — a
  // generic descriptor list, not a hardcoded panel. 'name' is the identity
  // row's field; everything else is a section body.
  const declared = adapter.inspector?.properties(nodeId) ?? [];
  const nameProperty = declared.find((p) => p.path === 'name');
  const { ungrouped, groups } = groupProperties(declared.filter((p) => p.path !== 'name'));

  // The hierarchy already presents visibility as the EYE toggle — the same
  // fact must not reappear here as a labelled "Visible" checkbox (owner,
  // 2026-08-06). Lift the UNGROUPED `visible` boolean out of the grid and
  // make it a subject verb; a GROUPED `visible` (a component's own prop)
  // stays in its group untouched.
  const visibleField = ungrouped.find((p) => p.path === 'visible' && p.type === 'boolean');
  const looseFields = visibleField ? ungrouped.filter((p) => p !== visibleField) : ungrouped;
  /** What the SUBJECT itself exposes to a field write — see the `editable`
   *  spread at the end of this function for why `name` is in it. */
  const subjectEditableFields: FieldDescriptor[] = [
    ...(nameProperty && nameProperty.readonly !== true ? [nameProperty] : []),
    ...(visibleField ? [visibleField] : []),
  ];

  const quickActions: InspectionAction[] = [];
  if (visibleField) {
    // Unset reads as visible — `Object3D.visible` defaults true.
    const isVisible = io.get(visibleField.path) !== false;
    const title = isVisible ? 'Visible — click to hide' : 'Hidden — click to show';
    quickActions.push({
      id: 'inspector-visibility-toggle',
      title,
      icon: isVisible ? faEye : faEyeSlash,
      placement: 'identity',
      pressed: !isVisible,
      disabled: visibleField.readonly === true,
      run: async () => {
        await io.set(visibleField.path, !isVisible);
      },
    });
  }
  if (input.assetDocument) {
    quickActions.push({
      id: 'open-asset-editor',
      title: 'Open in Asset Editor',
      label: 'Open in Asset Editor',
      placement: 'preview',
      run: input.assetDocument.open,
    });
  }
  // THERE IS NO MODEL DRILL FROM A PREFAB'S MESH (2026-09-19, M1). Both quick
  // actions that stood here resolved a `geometry={build()}` prop to a
  // TypeScript model module and opened or wrote one. A model is a `.blend`
  // now (ARCHITECTURE-CORE §The project model, "A model is Blender data"), a
  // prefab uses the glTF exported from one, and nothing records WHICH `.blend`
  // produced a given glTF — so there is no `.blend`-targeted drill to replace
  // them with, only a design that does not exist yet. Recorded in WORK.md.
  const sourceCommit = adapter.transforms?.sourceCommit;
  const sourceCommitAvailability = sourceCommit?.availability(nodeId);
  if (sourceCommitAvailability?.available) {
    quickActions.push({
      id: 'commit-live-transform-source',
      title: 'Commit this live transform to its authored source literal',
      label: 'Commit transform to source',
      icon: faArrowUpFromBracket,
      placement: 'identity',
      run: async () => {
        await commitAuthoringTransformSource(adapter, nodeId);
        onEdit();
      },
    });
  }

  // Which DESCRIPTORS each replaceable built-in section id owns. A
  // contribution that CLAIMS one of these ids draws its own chrome over the
  // very same descriptors, so this is what it must stay writable through —
  // see {@link withDescriptorEditable}.
  const descriptorFieldsById = new Map<string, readonly FieldDescriptor[]>();
  descriptorFieldsById.set(PROPERTIES_SECTION_ID, looseFields);
  for (const group of groups) {
    descriptorFieldsById.set(groupSectionId(group.groupId), group.properties);
  }

  const sections: InspectionSection[] = [];
  const creationSite = adapter.truth?.resolve(nodeId, 'position').site ?? null;

  // The live PREVIEW — an ordinary section, first in the order, and present
  // exactly when there is a real native visual authority behind it. A Three
  // selection hands us its live Object3D. A Canvas selection hands us a
  // renderer-backed capture of its live display subtree; a story-backed
  // component remains the fallback where a mounted surface cannot expose a
  // renderer. The
  // `preview`-placed verbs (the Asset Editor jump) render inside either box,
  // so they read the same in the card and the column.
  const previewObject = input.previewObject;
  // The COMPONENT's own picture, from whichever content source admits it
  // (`content-entry-source-registry.ts`) — the fallback where a mounted canvas
  // surface cannot expose a renderer. The shell asks about the component this
  // node IS; what the picture is made of is the source's business.
  //
  // NARROWED 2026-09-18 (unit 11, edge 8): this used to resolve the node's
  // ACTIVE story id against the project story registry, which is a registry
  // question the host may not ask. The component's registered preview and its
  // active story are the same picture whenever the active one is the component's
  // default, which is what `StoriesProvider.active` reports for an unswitched
  // node; a node switched to a non-default variant now shows the component's
  // registered preview instead. Restoring the variant needs the CANVAS surface
  // package that owns this branch (edge 10), not a second door here.
  const componentName = node?.typeLabel ?? node?.label ?? nodeId;
  const componentPicture =
    input.surface === 'canvas' && previewObject === null && input.stories
      ? contentEntryForComponent({
          name: componentName,
          path: creationSite?.anchored === true ? creationSite.file : '',
          surface: 'canvas',
        })
      : null;
  const previewActions = quickActions.filter((action) => action.placement === 'preview');
  const previewRender = selectionPreviewRenderer({
    object: previewObject,
    canvasCapture: input.canvasPreview,
    picture: componentPicture,
    displayName: node?.label ?? nodeId,
    previewKey: nodeId,
    actions: previewActions,
  });
  if (!claimed.has(PREVIEW_SECTION_ID) && previewRender !== null) {
    sections.push({
      id: PREVIEW_SECTION_ID,
      title: 'Preview',
      icon: faCube,
      order: PREVIEW_SECTION_ORDER,
      body: {
        kind: 'preview',
        render: previewRender,
      },
    });
  }

  const transformDimensions = transformDimensionsFor(adapter, nodeId);
  if (!claimed.has(TRANSFORM_SECTION_ID) && transformDimensions !== null) {
    const transform = adapter.transforms?.get(nodeId) ?? IDENTITY_TRANSFORM;
    // Measured on the ONE node the reader selected, which is what pays for the
    // bounds walk `describeInstancedPresentation` needs (the hierarchy row's
    // detail deliberately asks the cheap question instead). `contentWorldBounds`
    // resolves instance matrices live — three's own cached object box would
    // answer for whatever pose was first asked about.
    const instanced = previewObject
      ? describeInstancedPresentation(previewObject, contentWorldBounds(previewObject))
      : null;
    const channelEditability = Object.fromEntries(
      (['position', 'rotation', 'scale'] as const).map((channel) => [
        channel,
        adapter.transforms?.editability?.(nodeId, channel) ?? {
          writable: adapter.capabilities.transform,
        },
      ]),
    ) as Record<TransformChannel, TransformEditability>;
    // The section's values in the units its ROWS use — degrees for rotation —
    // spelled once so the read channel, the writable field descriptors and the
    // write's own round trip can never quote three different numbers.
    const transformData: Record<TransformChannel, [number, number, number]> = {
      position: [...transform.position],
      rotation: rotationDegrees(transform.rotation),
      scale: [...transform.scale],
    };
    sections.push({
      id: TRANSFORM_SECTION_ID,
      title: 'Transform',
      icon: faUpDownLeftRight,
      order: TRANSFORM_SECTION_ORDER,
      body: {
        kind: 'custom',
        // The section's own values, for the readers that cannot render one
        // (`inspection/serialize.ts` — P18). Same `transform` the body below
        // is handed, converted the same way its rows convert it: the rotation
        // rows DISPLAY Euler XYZ degrees (`rotationDegrees`), so degrees is
        // what the wire carries — a quaternion here would be a second answer
        // to the question the panel already answers.
        data: {
          ...transformData,
          // The same per-channel verdict the rendered rows lock and explain
          // themselves with. It belongs on the wire for the reason the values
          // above do: a reader that cannot render the section still has to be
          // able to ask "can I move this, and if not why not" — and for an
          // ingest mount that answer IS the product surface (the creation-site
          // gate's reason, verbatim).
          editability: channelEditability,
          // The same two facts the human is shown — the row's unit count and
          // the world-anchored sentence — so an agent reading this section
          // cannot conclude the transform means something the panel is warning
          // it does not. Absent entirely for a node that is not an instanced
          // draw, which is nearly every node.
          ...(instanced ? { instanced } : {}),
        },
        // The WRITE half of the three values above, through the same
        // begin/apply/end `onCommit` performs. An agent could read this
        // section and the sentence explaining whether it may move — and had no
        // way to move it; for an ingest root, whose only authoring surface is
        // the editor, that closed the lane entirely.
        editable: {
          fields: (['position', 'rotation', 'scale'] as const).map((channel) => {
            const readonly =
              !adapter.capabilities.transform || !channelEditability[channel].writable;
            return {
              path: `transform.${channel}`,
              label: channel[0]!.toUpperCase() + channel.slice(1),
              type: 'vec3' as const,
              value: transformData[channel],
              readonly,
              // The SAME two declarations a property row carries, for the
              // channel this section owns instead: the adapter's `removable`,
              // and the io below saying the lane has a door at all. Both are
              // read, neither inferred — `remove-inspection-field` refuses by
              // name when either is missing rather than writing a value that
              // would leave the attribute in the file.
              //
              // HOW MUCH `removable` CLAIMS IS THE ADAPTER'S TO SAY, and it is
              // not the same on every lane — see `TransformEditability`
              // (`@volter/editor-project/adapter/authoring`), which apportions it: a lane
              // holding its own source text answers both halves (the callsite
              // carries this channel AND there is a door), while one that
              // holds only an oid → file:line index answers for the DOOR, and
              // the removal's own ack reports whether a byte actually left. So
              // `resettable` here means "this lane will attempt the drop and
              // answer honestly for it", never "a byte is guaranteed to move".
              ...(!readonly &&
              adapter.transforms?.remove &&
              channelEditability[channel].removable === true
                ? { resettable: true }
                : {}),
            };
          }),
          io: {
            get: (path) => transformData[transformChannelOf(path)],
            // `endEdit` closes the gesture AND answers for whatever write it
            // triggered (`TransformProvider.endEdit`), so the gesture's own ack
            // is what this io returns — never a destination read off the
            // surface afterwards.
            set: (path, value) => {
              if (!adapter.transforms) return undefined;
              const next = withTransformChannel(
                transform,
                transformChannelOf(path),
                value as number[],
              );
              beginAuthoringTransformEdit(adapter, nodeId);
              applyAuthoringTransform(adapter, nodeId, next);
              const ack = endAuthoringTransformEdit(adapter, nodeId);
              onEdit();
              return ack;
            },
            // Revert-to-default for a transform channel — the ONE door that
            // can express byte-ABSENCE, because `set` above can only write
            // three numbers. Present exactly when the adapter declares one, so
            // the door above can refuse `REMOVAL_UNAVAILABLE` by name instead
            // of a value write that pretends to be a revert; the provider's
            // own ack is passed straight through, exactly as `set` does.
            ...(adapter.transforms?.remove
              ? {
                  remove: (path: string) => {
                    const ack = removeAuthoringTransform(adapter, nodeId, transformChannelOf(path));
                    onEdit();
                    return ack;
                  },
                }
              : {}),
          },
        },
        render: () =>
          createElement(InspectorTransformSection, {
            dimensions: transformDimensions,
            transform,
            readOnly: !adapter.capabilities.transform,
            channelEditability,
            ...(instanced?.note ? { note: instanced.note } : {}),
            // The section's gesture IS the adapter's: one `beginEdit` when
            // the hand (or the caret) takes the field, live `apply` per
            // scrub move, and the ONE `endEdit` write on release/Enter — the
            // same shape the gizmo drives, so a scrub or a typed number is
            // one undo step and one remount.
            onBegin: () => {
              beginAuthoringTransformEdit(adapter, nodeId);
            },
            onPreview: (next: Transform) => {
              applyAuthoringTransform(adapter, nodeId, next);
            },
            onCommit: (next: Transform) => {
              applyAuthoringTransform(adapter, nodeId, next);
              endAuthoringTransformEdit(adapter, nodeId);
              onEdit();
            },
          }),
      },
    });
  }

  // `properties` names the whole DESCRIPTOR CHANNEL — the loose grid plus the
  // `group:<id>` blocks its named groups produce (see the constant's own
  // doc) — so claiming it stands the channel down entirely.
  if (!claimed.has(PROPERTIES_SECTION_ID)) {
    // The loose grid is headed like every other section — "Properties", with
    // its own glyph, in every projection. `visible` lives on the identity row
    // as the eye, so it never earns this section by itself.
    if (looseFields.length > 0) {
      sections.push({
        id: PROPERTIES_SECTION_ID,
        title: 'Properties',
        icon: faSliders,
        order: PROPERTIES_SECTION_ORDER,
        defaultOpen: true,
        body: { kind: 'fields', fields: looseFields, io },
      });
    }
    groups.forEach((group, index) => {
      // A group is one owner's block (a component, a wrapper tag) and
      // collapses like Transform does — the same affordance, because it is
      // the same kind of thing. A wrapper like `<RigidBody>` can declare 40+
      // props, so a block whose fields are almost all unset starts CLOSED: it
      // stays discoverable without burying the props this document sets.
      const authored = group.properties.filter((p) => !p.defaulted).length;
      sections.push({
        id: groupSectionId(group.groupId),
        title: group.name,
        icon: groupIcon(group.name),
        order: GROUP_SECTION_ORDER + index,
        description:
          authored > 0
            ? `${authored} set of ${group.properties.length}`
            : `${group.properties.length} properties`,
        defaultOpen: authored > 0 && group.properties.length <= GROUP_AUTO_OPEN_MAX,
        testId: `ingest-group-${group.groupId}`,
        body: { kind: 'fields', fields: group.properties, io },
      });
    });
  }

  const stories = input.stories;
  if (!claimed.has(STORIES_SECTION_ID) && stories) {
    sections.push(composeStoriesSection(stories));
  }

  sections.push(
    ...contributed.map((section) => withDescriptorEditable(section, io, descriptorFieldsById)),
  );

  // STABLE — equal-ordered contributions keep registration order, which is
  // how contributions that share `CONTRIBUTED_SECTION_ORDER` stay in the
  // order their modules registered them (`Array.prototype.sort` is specified
  // stable).
  sections.sort((a, b) => a.order - b.order);

  // A DOCUMENT WHOSE PACKAGE OWNS ITS RAIL shows only that package's sections
  // (plus the built-ins it named). One statement of the rule, after everything
  // has been composed — see {@link applyOwnedRail}.
  const railed = applyOwnedRail(sections, owners, input.rail);

  // Resolved per NODE, not off the active adapter: a composite session's
  // active adapter deliberately declares no provenance of its own (its worlds'
  // declarations differ), so the badge is the GOVERNING child's —
  // `authoring/provenance.ts`. For a plain adapter this is the adapter's own
  // declaration, unchanged.
  const subjectProvenance = provenanceForNode(adapter, nodeId);
  const subjectDestination = authoringDestination(adapter);

  return {
    id: nodeId,
    title: node?.label ?? '',
    // Identity belongs to the SUBJECT, so every selection has this row: the
    // name, what kind of thing it is, and where it came from. Sections are
    // FACETS of that subject and never stand in for it.
    identity: {
      rename: {
        // Writable exactly when the adapter DECLARES a writable `name` field.
        // An adapter that describes no `name` at all also drops the path in
        // `inspector.set` (the react/DOM lanes return on any non-style path,
        // and a root-group row answers only its manifest facts), so an
        // editable box over one is a control that silently discards what you
        // type — the row still SHOWS the name, it just cannot pretend to
        // rewrite it.
        readOnly: nameProperty === undefined || nameProperty.readonly === true,
        set: (next: string) => io.set('name', next),
      },
      kindLabel: `${node?.typeLabel ?? node?.kind ?? ''}${
        subjectProvenance ? ` · ${subjectProvenance.label}` : ''
      }`,
      // The same fact the line above formats, UNFORMATTED — the identity row
      // draws the kind's glyph and a sentence cannot be drawn. See
      // `InspectionIdentity.kind`.
      ...(node?.kind ? { kind: node.kind } : {}),
      // WHERE this is written back. It used to head the Hierarchy panel as a
      // breadcrumb row of its own; the Outliner's header is one row and names
      // no file, and the datablock this belongs to is the one being inspected
      // (`InspectionDocumentLine`). A composite session declares no single
      // destination, so it gets no line — the same silence its `provenance`
      // keeps, and for the same reason.
      ...(subjectDestination
        ? {
            document: {
              path: subjectDestination,
              ...(subjectProvenance?.detail ? { title: subjectProvenance.detail } : {}),
            },
          }
        : {}),
      // Only an ANCHORED truth earns a note. An unanchored resolution is the
      // honest fallback the composite hands back for a subject its truth index
      // does not reach (a react/DOM element, a synthetic group row): its
      // `reason` is "no live object for this selection", which as a creation
      // note reads "Source · no live object" over a perfectly mounted,
      // editable element — a false provenance line. No anchor ⇒ no note.
      note: creationSite?.anchored
        ? {
            // The label names WHICH truth this object came out of, because
            // "Source" over a level-data record would be false: no source
            // line mentions where a placed robot stands.
            text: `${creationSite.kind === 'data' ? 'Level data' : 'Source'} · ${creationSite.display}`,
            title:
              creationSite.kind === 'data'
                ? `Placed by record ${creationSite.record} of ${creationSite.file}, the game's own level data`
                : `Constructed by a \`new\` expression at ${creationSite.file} line ${creationSite.line}, column ${creationSite.col}`,
            testId: 'inspector-creation-site',
          }
        : undefined,
    },
    presentation: { preferred: inspectionAffinityFor(input.surface) },
    // THE SUBJECT'S OWN WRITABLE FIELDS, which is the door `editor.setField`
    // resolves a path against.
    //
    // `name` is one of them, and it was missing. The identity row DRAWS it and
    // writes it through `io.set('name', …)` — the same call the hierarchy's
    // inline rename makes — but it was never listed here, so the one door an
    // agent has answered "The active Inspector has no field at \"name\"" for
    // every adapter in the estate. Measured 2026-09-21 on a Blender Model
    // document, where renaming an object is one of the macro adjustments the
    // document exists for and had no reachable door at all: the Outliner's
    // rename is a context menu, the Properties rail is the workbench's own
    // view, and neither is drivable.
    //
    // Same shape and same argument as `withDescriptorEditable` above — it adds
    // a door onto the write path that already exists, never a second one — and
    // the readonly descriptor is left out so a refusal stays a refusal (the
    // Blender Outliner returns `readonly: true` for a collection row).
    ...(subjectEditableFields.length > 0
      ? { editable: { fields: subjectEditableFields, io } }
      : {}),
    ...(input.alsoSelected ? { alsoSelected: input.alsoSelected } : {}),
    quickActions,
    related: adapter.related?.links(nodeId) ?? [],
    sections: railed,
  };
}

/**
 * The Stories section from a resolved {@link ComposeStoriesInput}.
 */
export function composeStoriesSection(stories: ComposeStoriesInput): InspectionSection {
  return {
    id: STORIES_SECTION_ID,
    // The provider names its own states when it has a better word for them
    // (an ingested game's screens are "Scenes"); "Stories" is the default,
    // not a fixed heading.
    title: stories.title ?? 'Stories',
    icon: faBookOpen,
    order: STORIES_SECTION_ORDER,
    body: {
      kind: 'custom',
      render: () =>
        createElement(InspectorStoriesSection, {
          stories: stories.stories,
          activeStoryId: stories.activeStoryId,
          onApplyStory: stories.onApplyStory,
          isolation: stories.isolation,
          unavailableReason: stories.unavailableReason ?? null,
        }),
    },
  };
}
