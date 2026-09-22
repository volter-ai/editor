/**
 * The INSPECTION MODEL — the data the inspector is a view of (design:
 * `docs/ARCHITECTURE-CORE.md` §Editor chrome, "The Inspection Model"; build
 * ledger: `docs/WORK.md` §Inspection Model program).
 *
 * Layer 0 is the typed field vocabulary ({@link FieldDescriptor}, a superset
 * of the engine's `PropertyDescriptor`, plus the {@link MIXED} sentinel so
 * multi-select is in the value model from day one). Layer 1 is
 * {@link InspectionSubject} — identity, quick actions, related links,
 * sections. Layer 2 is {@link InspectionSection} — an IDENTIFIED block whose
 * `body` is a field list, an opaque custom render, or the subject's live
 * preview.
 *
 * EVERYTHING a projection shows is here. What you click on decides the
 * subject; the subject decides the sections; the box is a pure view of that —
 * the section-icon strip IS `subject.sections`, each stacked section's body IS
 * its own render, the header IS its title and icon. There is deliberately no
 * channel beside the section list, not even for the live preview
 * ({@link PREVIEW_SECTION_ID} is an ordinary section): a subject part that
 * only one projection knew where to put is how two projections stop being the
 * same box.
 *
 * Layer 3 — the projections — is NOT here: `components/Inspector.tsx` renders
 * this model as the narrow column or the mini card, and
 * `inspector-presentation.ts` maps the same sections onto the section-icon
 * strip. A projection reads identity/order/title/icon off the model; it never
 * re-derives what a section IS.
 *
 * This module is deliberately close to React-free: only the opaque section
 * bodies (a contributed custom block, the live preview) name `ReactNode`.
 */

import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
import type { PropertyDescriptor, WriteAck } from '@volter/editor-project/adapter';
import type { ReactNode } from 'react';

// ---- Layer 0: fields -----------------------------------------------------

/**
 * "These subjects disagree about this field." Reserved by the design so that
 * multi-select is expressible in the value model before multi-select EDITING
 * is built: an io that spans more than one subject returns this instead of
 * inventing one of the values. Single-subject inspection (all of W1) never
 * produces it; the field renderer normalizes it to "no single value" (blank +
 * placeholder), which is the correct reading, not a special case.
 */
export const MIXED: unique symbol = Symbol('vgai.inspection.mixed');
export type Mixed = typeof MIXED;

/** A value read from an inspection subject: a real value, or {@link MIXED}. */
export type FieldValue<T> = T | Mixed;

export function isMixed(value: unknown): value is Mixed {
  return value === MIXED;
}

/**
 * The inspection layer's field vocabulary — structurally the engine adapter
 * seam's `PropertyDescriptor` (stable scriptable `path`, `type`, `label`,
 * `group`, `defaulted`, `readonly`, `resettable`, `revertsTo`), named here so
 * the model has one address space of its own. Additive kinds
 * (`color`/`vec3`/`asset-ref` beyond what the seam already carries) land in a
 * later wave by widening the seam, never by forking a second descriptor
 * shape here.
 */
export interface FieldDescriptor extends PropertyDescriptor {}

/** The one explanation every projection and write door uses for a read-only
 * field. An adapter can name its actual gate; the fallback remains honest for
 * inherently informational fields that have no more specific refusal. */
export function fieldReadonlyReason(field: FieldDescriptor): string {
  return field.readonlyReason ?? 'This field is read-only.';
}

/** Read/write access to one subject's fields, addressed by `path`. */
export interface InspectionFieldIo {
  get(path: string): FieldValue<unknown>;
  /**
   * Write one field — and answer for THAT write with the persistence pipe's
   * own {@link WriteAck} (`authoring/write-pipe.ts`), passed straight through
   * from whichever provider performed it. `void` is the honest report of an io
   * that performed no persisted write; the caller then reports the live-only
   * floor rather than reading a destination off the surface, which is what
   * made a three-root edit ack the DOM root's file with `persisted: true`.
   */
  set(path: string, value: unknown): void | WriteAck | Promise<void | WriteAck>;
  /**
   * Optional — SHOW a value without writing it, for a control the user drags
   * (seam: `InspectorProvider.preview`). Never persists; the control calls
   * {@link set} once when its gesture ends. Absent ⇒ the control's preview is
   * a no-op and the value still lands on commit.
   */
  preview?(path: string, value: unknown): void;
  /**
   * Drop the document's override (Unity's revert arrow) — the ONE door that can
   * express byte-ABSENCE, because {@link set} can only write a value.
   *
   * Same ack contract as `set`: the persistence pipe's own {@link WriteAck} for
   * THIS removal, passed straight through, awaited. Absent ⇒ no field in this
   * section can lose its override, and `remove-inspection-field` refuses by name
   * instead of silently degrading to a value write that would leave the prop in
   * the file.
   */
  remove?(path: string): void | WriteAck | Promise<void | WriteAck>;
}

// ---- Layer 1: subjects ---------------------------------------------------

/**
 * The SURFACE a subject belongs to — the axis presentation affinity and the
 * user's presentation preference are keyed by. `three`/`canvas`/`dom` are the
 * engine's own `AdapterSurface` values; `asset-lab` is an open asset document,
 * which is the three paradigm scoped to a SUBTREE (Unity's prefab-isolation
 * mode: same view, same hierarchy, same inspector — only the root changes).
 *
 * A surface decides two things and NOTHING else: which producer composes the
 * subject, and which key the presentation preference is stored under. It never
 * decides what a projection renders — that is subject data, all of it.
 */
export type InspectionSurfaceKind = 'three' | 'canvas' | 'dom' | 'asset-lab';

/**
 * Layer 3's three projections, named in the model so a subject can say which
 * one FITS it (never which one is showing — that is the resolver's answer):
 *  - `column` — the DEFAULT: the subject's full inspector as a slim vertical
 *    column — identity row, a section-icon strip that signposts what the
 *    subject has and jumps to a section, then every section stacked and
 *    collapsible;
 *  - `properties` — the same docked column with the sections TABBED instead
 *    of stacked: a vertical icon rail down the left edge, one section body at
 *    a time (Blender's Properties editor, Substance's too). A workspace
 *    chooses it as data (`EditorWorkspaceRegions.inspector`); the user's
 *    per-surface preference still wins;
 *  - `card` — the space-tight fallback: a MINI card (preview, name, the same
 *    icon strip) collapsing at the floor to a single-line PILL. Clicking any
 *    collapsed form restores the column.
 *
 * They differ in LAYOUT only. All three read the same subject, render the
 * same identity and section data; the icon strip, the rail and the column's
 * collapse triangles are the layout's own affordances.
 */
export type InspectionPresentation = 'card' | 'column' | 'properties';

/**
 * The subject's presentation AFFINITY — what fits this surface when the user
 * has expressed no preference for it. The default is the narrow `column` on
 * every surface (owner, 2026-08-19): with agents doing most editing the
 * inspector's daily job is looking, and an always-present slim column reads
 * details with no discovery-dependent expand gesture. The mini card is a
 * space-tight fallback the user opts into, not a per-surface default.
 */
export interface InspectionPresentationAffinity {
  readonly preferred: InspectionPresentation;
}

/**
 * The affinity for a surface — the ONE place the default lives, shared by the
 * composer (which stamps it onto the subject) and the workspace (which must
 * resolve the same answer without composing).
 *
 * The narrow `column` is the default for EVERY surface (owner, 2026-08-19):
 * the card demoted from default to a space-tight fallback the user opts into
 * per surface. The `kind` still selects which producer composed the subject
 * and which key a preference is stored under; it no longer picks the layout.
 */
export function inspectionAffinityFor(
  _kind: InspectionSurfaceKind | undefined,
): InspectionPresentation {
  return 'column';
}

/**
 * Where a projection puts a verb. `identity` verbs sit on the subject's name
 * row (today: the visibility eye); `preview` verbs are rendered over the
 * preview SECTION's body, in the box, identically in both projections (today:
 * the Asset Editor jump). A projection places by this, never by action id — a
 * renderer that branches on "is this the asset-editor button" would be exactly
 * the content knowledge this model exists to remove.
 */
export type InspectionActionPlacement = 'identity' | 'preview';

/** A verb on the subject itself. */
export interface InspectionAction {
  /** Stable id; also the projection's `data-testid`. */
  readonly id: string;
  /** Accessible name + tooltip — ONE string, both roles. */
  readonly title: string;
  /** Visible text, for verbs presented as a labelled button. */
  readonly label?: string | undefined;
  /** Icon, for verbs presented as an icon button. */
  readonly icon?: IconDefinition | undefined;
  readonly placement: InspectionActionPlacement;
  /** Toggle state (`aria-pressed`), for verbs that have one. */
  readonly pressed?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly run: () => void | Promise<void>;
}

/** The subject's verbs for one placement — the ONE expression both
 *  projections filter with, so "the eye is on the identity row and the Asset
 *  Editor jump is in the preview box" cannot be true in one and false in the
 *  other. */
export function actionsPlacedAt(
  subject: InspectionSubject,
  placement: InspectionActionPlacement,
): readonly InspectionAction[] {
  return subject.quickActions.filter((action) => action.placement === placement);
}

/**
 * A jump to a RELATED subject (the derivation chain: entity → its Asset Lab
 * document → its state machine). Adapters publish these links from the same
 * subject they inspect, so every projection and the serialized agent view get
 * the same navigation without hand-rolled "Open in X" buttons.
 */
export interface SubjectLink {
  readonly id: string;
  readonly title: string;
  readonly open: () => void;
}

/** The editable name field on the identity row. */
export interface InspectionRename {
  readonly readOnly: boolean;
  readonly set: (next: string) => void;
}

/** A secondary provenance line under the identity row (today: where the
 *  object was constructed in the game's own source). */
export interface InspectionNote {
  readonly text: string;
  /** Long-form tooltip, when the one-line text is a summary. */
  readonly title?: string | undefined;
  readonly testId?: string | undefined;
}

/**
 * The subject's identity ROW — the editable name, what to call its type, and
 * the provenance line under it. Identity belongs to the SUBJECT, not to any
 * section (design: ARCHITECTURE-CORE §Editor chrome), so it is one nullable
 * group here rather than a boolean gate over loose fields. Sections are
 * FACETS of the subject and never stand in for its identity; a projection
 * renders this row exactly when it is present.
 */
/**
 * WHERE the subject's truth is written — the active adapter's own persistence
 * destination, as a secondary line on the identity row.
 *
 * This is Blender's Properties datablock row, and it is the reason the
 * Hierarchy panel no longer carries a breadcrumb row of its own: which file
 * and which kind is a fact about the THING being inspected, not about the
 * tree that lists it (Blender's Outliner header is one row and names no
 * file). The seam word — `source`, an ingest's own label — is already on this
 * row in {@link InspectionIdentity.kindLabel}, so the line carries the path
 * and nothing else.
 */
export interface InspectionDocumentLine {
  /** The adapter's persistence destination, verbatim (`src/models/cube.ts`). */
  readonly path: string;
  /** Long-form provenance for the row's tooltip, when the seam declares one. */
  readonly title?: string | undefined;
}

export interface InspectionIdentity {
  readonly rename: InspectionRename;
  /** What to CALL this thing's type (+ seam provenance), under the name. */
  readonly kindLabel?: string | undefined;
  /**
   * The adapter's own KIND NAME for this thing — `mesh`, `light`,
   * `mesh-data`, `three-source` — unformatted, which is the only difference
   * between it and {@link InspectionIdentity.kindLabel}: both are built from
   * the same `EditorNode.kind`, and a projection that has to DRAW the kind
   * cannot draw a sentence.
   *
   * It exists because Blender's Properties breadcrumb leads with the
   * DATABLOCK's glyph and never the open tab's — proved byte-identically on
   * the frames: the first breadcrumb glyph in `properties-object.png`,
   * `properties-modifier.png` and `properties-data-edit.png` is the same
   * 28x28 device crop with 0 of 784 pixels differing, while the open tab is
   * Object, Modifier and Data in turn. Neither derivation the row had could
   * answer that: `sections[0].icon` is RAIL ORDER and the active tab's icon
   * is the tab. The host already turns a kind name into a glyph in exactly
   * one place (`hierarchy-kind-icon.ts`, which rules that the kind name is
   * the carrier and `EditorNode` gains no field for it), so this carries the
   * name there rather than a second glyph anywhere.
   */
  readonly kind?: string | undefined;
  /** The document this subject is written back to. */
  readonly document?: InspectionDocumentLine | undefined;
  readonly note?: InspectionNote | undefined;
}

export interface InspectionSubject {
  readonly id: string;
  /** Display name of the thing being inspected. */
  readonly title: string;
  /** The identity row, or `null` for a subject that has no identity to show
   *  (a no-selection subject whose surface named no type). */
  readonly identity: InspectionIdentity | null;
  /**
   * A quiet line for a subject with nothing to EDIT — today the no-selection
   * subject's own explanation of what its surface inspects ("Select an
   * element in the canvas…"). A projection renders it under
   * {@link InspectionSubject.title} in place of the identity row; it is a
   * string off the model, so no renderer learns which surface produced it.
   */
  readonly hint?: string | undefined;
  /** Which projection FITS this subject's surface. The resolver
   *  (`inspector-presentation.ts`) picks the actual presentation from this
   *  plus the user's per-surface override. */
  readonly presentation: InspectionPresentationAffinity;
  /** Descriptor writes represented outside a section body. The identity-row
   * visibility eye is the first case: it must stay one compact verb for a
   * person while remaining the same `editor.setField` adjustment for an
   * agent. This is a control seam only; projections render the owning chrome. */
  readonly editable?: {
    readonly fields: readonly FieldDescriptor[];
    readonly io: InspectionFieldIo;
  };
  /**
   * How many OTHER things are selected alongside this subject, when more than
   * one is. The box describes ONE of them — the one whose fields these are —
   * but a gizmo drag moves all of them, so a panel headed by a single name
   * while three objects move is the box lying about its own scope: a tester
   * shift-selected three models, watched all three move, and reported that
   * "the inspector only shows the first object" (runhuman pass 94). Absent
   * for a single selection, which is the overwhelmingly common case and needs
   * no count.
   */
  readonly alsoSelected?: number | undefined;
  readonly quickActions: readonly InspectionAction[];
  readonly related: readonly SubjectLink[];
  /** Sections in display order (already sorted by {@link InspectionSection.order}). */
  readonly sections: readonly InspectionSection[];
}

// ---- Layer 2: sections ---------------------------------------------------

/**
 * The JSON-safe VALUES a custom body publishes beside its render — the one
 * thing an opaque body can honestly say about its own contents.
 *
 * A custom body replaces rendering, so the visual projections read nothing
 * here and the serialized projection (`inspection/serialize.ts`) is its only
 * reader: an agent calling `editor.inspect` gets the section's values instead
 * of a name it cannot look inside. The channel is deliberately a flat,
 * anonymous record rather than a per-section body kind — the producer
 * (`inspection/compose.ts`) is the layer that knows what a section IS, and
 * teaching the serializer one more content name would put that knowledge back
 * in a projection.
 *
 * The rule for a producer filling it: publish WHAT THE BODY DISPLAYS, in the
 * body's own units — the Transform section shows Euler XYZ degrees, so that
 * is what it publishes, not the quaternion behind them.
 */
export type InspectionSectionData = Readonly<Record<string, unknown>>;

export type InspectionSectionBody =
  | {
      readonly kind: 'fields';
      readonly fields: readonly FieldDescriptor[];
      readonly io: InspectionFieldIo;
    }
  /** An opaque block the model does not model — a contributed React section,
   *  or a built-in with chrome of its own (Transform, Stories). Custom
   *  bodies replace RENDERING, never identity: the section keeps its id,
   *  title, icon and order — and may publish its displayed values as
   *  {@link InspectionSectionData} for the readers that cannot render. */
  | {
      readonly kind: 'custom';
      readonly render: () => ReactNode;
      readonly data?: InspectionSectionData;
      /**
       * The WRITE half of {@link data}, for a body whose chrome is custom but
       * whose values are ordinary editable fields.
       *
       * Without it, a custom body is readable over the wire and writable only
       * by a person typing in its rendered rows — which for the TRANSFORM
       * section meant an agent could read a position, read the sentence
       * explaining whether it may be moved, and have no way to move it. An
       * ingest root has no source file to hand-edit instead, so that was the
       * whole authoring surface, closed.
       *
       * `io.set` must be the SAME write the rendered chrome performs (the
       * Transform section's is `onCommit`'s begin/apply/end), so there is one
       * write path and not two that can disagree.
       */
      readonly editable?: {
        readonly fields: readonly FieldDescriptor[];
        readonly io: InspectionFieldIo;
      };
    }
  /**
   * The subject's live PREVIEW — a square view of the thing itself. It is a
   * section like every other: it has an id, a title, an icon and an order, it
   * is one glyph on the section-icon strip and one block in the column, and it
   * exists exactly when the subject has something honest to show.
   *
   * `render` fills whatever box it is given, at any size — the section body,
   * the mini card's preview square, and the pill's small thumb — which is why
   * one function serves them all and no host re-derives what the subject looks
   * like. The {@link InspectionPreviewMode} is how the host says which of those
   * it is; omitting it means `'section'`.
   */
  | {
      readonly kind: 'preview';
      readonly render: (mode?: InspectionPreviewMode) => ReactNode;
    };

/**
 * How a preview body is being HOSTED — the one thing a preview's renderer
 * needs to know about its box, and deliberately not a second render function.
 *
 * - `section` (the default): the full box. The subject's `preview`-placed
 *   verbs sit in it, inside the section's own inset and border — the panel is
 *   the preview's landing view, so its verbs belong there.
 * - `thumbnail`: chrome-free FILL — the live view alone, edge to edge, with no
 *   inset, no border and NO VERBS. The small hosts (the mini card's preview
 *   square, the pill's round thumb) clip it and own the single click on it
 *   themselves, so an interactive control inside would be both a second
 *   navigation from one press and a focusable fragment of a clipped button.
 */
export type InspectionPreviewMode = 'section' | 'thumbnail';

/**
 * One identified block of a subject. EVERY section is headed by its own title
 * and icon in EVERY projection (owner, 2026-08-06: "the title of that specific
 * section is always supposed to be at the top of the section — this should be
 * consistent for all sections. And all sections need to have an icon") — the
 * column, the mini card, and the Asset Lab's box alike. So
 * there is no opt-out flag here: `title` and `icon` are required, and a
 * projection renders the header unconditionally. A custom body that also
 * printed its own name would say it twice, which is why the bodies that used
 * to (Transform, Stories, Navigation) no longer do.
 */
export interface InspectionSection {
  /** Stable id — the section-icon strip's jump target, and the key a registry
   *  contribution CLAIMS to replace a built-in. */
  readonly id: string;
  readonly title: string;
  readonly icon: IconDefinition;
  /** Display order; the composer returns sections already sorted by it. */
  readonly order: number;
  readonly body: InspectionSectionBody;
  /** Supporting line beside the title ("3 set of 12"). */
  readonly description?: string | undefined;
  /** Initial open state for the section header. */
  readonly defaultOpen?: boolean | undefined;
  /** `data-testid` for the section's wrapper, when it has one. */
  readonly testId?: string | undefined;
  /**
   * Stay MOUNTED while another tab is showing. The properties column shows one
   * section at a time; a section that HOSTS contributions which publish what
   * they know while rendered (an asset's `asset.inspector` sections and the
   * verbs they publish into the identity row and `editor.inspect()`) must keep
   * rendering, hidden, or the verb would exist only after a person visits its
   * tab. Sections that merely display leave this unset.
   */
  readonly keepMounted?: boolean | undefined;
  /**
   * WHICH GROUP OF THE RAIL this section belongs to — read by the PROPERTIES
   * presentation alone, which draws a separator wherever the group changes.
   *
   * Blender's own rail is grouped rather than flat: `ED_buttons_tabs_list`
   * (`space_buttons/space_buttons.cc:201-255`) calls `add_spacer()` between
   * the tool tab, the scene group (Render, Output, View Layer, Scene, World),
   * Collection, the object group (Object, Modifiers, Effects, Particles,
   * Physics, Constraints, Data, Bone, Bone Constraints, Material) and
   * Texture, and each spacer appends a `BCONTEXT_SEPARATOR` the rail draws as
   * a gap rather than a tab. The name is free and compared for equality only;
   * consecutive sections sharing one form a group, and sections that name
   * none form a group of their own.
   */
  readonly railGroup?: string | undefined;
  /**
   * THE TAB THE RAIL OPENS ON, before a person has chosen one for this
   * subject. The Properties presentation otherwise takes the FIRST tab, and
   * Blender does not: its `SpaceProperties.context` is stored per screen in
   * the startup file, and at factory settings `bpy.data.screens['Layout']`
   * reads `OBJECT` while the rail's first tab is Render (measured against
   * Blender 5.2 LTS, walk 5 parity row 3). At most one section should declare
   * it; the first that does wins, and a rail with none opens on its first tab
   * as before.
   */
  readonly railDefault?: boolean | undefined;
}

// ---- Section identity ----------------------------------------------------
//
// The ids are a CONTRACT: they are the section-icon strip's jump targets, and
// a registry contribution REPLACES a built-in by claiming its id
// (`inspection/compose.ts`) — the whole of the positive-space replacement
// protocol.

/** The subject's live preview. First in every projection: the first block in
 *  the column, and on the mini card the preview square above the name. */
export const PREVIEW_SECTION_ID = 'preview';
export const TRANSFORM_SECTION_ID = 'transform';
/**
 * The adapter's DESCRIPTOR GRID — the ungrouped (loose) fields, plus the
 * `group:<id>` sub-sections its named `PropertyDescriptor.group`s produce.
 * Claiming this id therefore claims the whole descriptor channel: a
 * contribution that renders a node's properties richly presents its groups
 * too, and the generic grid must not double-render them beside it.
 */
export const PROPERTIES_SECTION_ID = 'properties';
export const STORIES_SECTION_ID = 'stories';

/** A shared FACET id, contributed rather than built in: the args of the open
 *  story document. Every story-document surface (React CSF, three) registers
 *  its own body for it under this one identity, because it is the same facet
 *  of the same kind of subject seen from a different lane. */
export const STORY_ARGS_SECTION_ID = 'story-args';
export const STORY_ARGS_SECTION_TITLE = 'Story Args';
// The section's GLYPH lives in `components/story-args-section.ts` — this
// data-model module stays free of the icon package (see that file), and the
// icon must be DISTINCT from the generic property grid's `faSliders` so the
// section-icon strip's glyphs never collide.

/** A named `PropertyDescriptor.group`'s section (`groupId` is the slug from
 *  `inspector-property-grouping.ts`) — a sub-section OF
 *  {@link PROPERTIES_SECTION_ID}'s channel. */
export function groupSectionId(groupId: string): string {
  return `group:${groupId}`;
}

// ---- Section order -------------------------------------------------------
//
// Display order, spaced so a channel can grow without colliding with the
// next. A contribution declares its own order on the same scale
// (`InspectorSectionContribution.order`); the composer sorts STABLY, so
// equal-ordered contributions keep registration order.

export const PREVIEW_SECTION_ORDER = 100;
export const TRANSFORM_SECTION_ORDER = 1000;
export const PROPERTIES_SECTION_ORDER = 2000;
export const GROUP_SECTION_ORDER = 3000;
export const STORIES_SECTION_ORDER = 4000;
/** Where a registry contribution sits unless it says otherwise: after every
 *  built-in block. A contribution that CLAIMS a built-in id replaces that
 *  block's identity, not necessarily its position. */
export const CONTRIBUTED_SECTION_ORDER = 5000;
