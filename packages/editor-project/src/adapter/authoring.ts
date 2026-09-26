/**
 * AuthoringAdapter — the editor's authoring contract. The editor talks to THIS,
 * keyed by opaque string node ids, instead of to a concrete document format.
 *
 * An implementer's document model is its own private business; an ingested
 * game's adapter implements the same
 * providers directly over its live `Object3D` tree. The editor sees only the
 * interface and the advertised `capabilities` — it never branches on which
 * implementer it is talking to.
 *
 * The interface lives in the engine (not the editor) so `MountedThreeRoot.authoring`
 * can reference it without the engine depending on the editor; implementers live
 * in `packages/editor/src/authoring/`.
 *
 * **Reserved inspector paths convention:** the property paths `name`, `visible`,
 * `locked`, `renderVisible` and `exclude` are reserved — an adapter that
 * supports them exposes them through the ordinary `InspectorProvider.get`/`set`
 * (no separate provider). The shell renders the hierarchy panel's rename field,
 * eye (visibility) toggle, lock toggle, render-camera toggle and
 * exclude checkbox against these paths, generically, for any adapter that
 * reports them via `InspectorProvider.properties`.
 *
 * A COLUMN FOLLOWS WHAT THE ADAPTER ANSWERS, never a chrome knob (owner ruling,
 * 2026-09-19). `renderVisible` and `exclude` are answered by almost nothing —
 * three.js has ONE `Object3D.visible` governing viewport and render alike, and
 * nothing but a view layer has an exclusion — so their columns are absent or a
 * reserved blank cell, and appear the moment an adapter whose truth really does
 * separate them says so. `exclude` and `renderVisible` are reported in the
 * sense their name carries: `exclude: true` means EXCLUDED, `renderVisible:
 * false` means hidden from renders.
 */

import type { Transform } from './transform';

/**
 * Booleans the editor UI gates affordances on (hide what an adapter can't do).
 *
 * Deliberately SMALL: a capability flag earns its place only when the shell
 * actually branches on it. Structural affordances (create/delete/reparent) are
 * gated by `structure` PROVIDER PRESENCE instead — the flag and the provider
 * cannot disagree that way.
 */
export interface AuthoringCapabilities {
  transform: boolean;
  inspectorFields: boolean;
  persist: boolean;
}

/**
 * The adapter's own answer to "what is truth behind these rows, and how
 * writable is it" (spec 29 §5). Provenance never varies WITHIN one adapter's
 * rows — it is a property of the world boundary — so it is declared ONCE per
 * adapter and rendered at the SEAM (the composite's `world:<id>` group row,
 * or the panel header for a bare adapter), never per row. Only the adapter
 * knows its truth: the shell must read this field, never guess from adapter
 * identity (rule zero). Machine-readable operation gates stay in {@link
 * AuthoringCapabilities}/provider presence — this type carries the HUMAN
 * explanation those gates can point at when an affordance is present but
 * unavailable.
 */
export interface AuthoringProvenance {
  /**
   * What the rows project:
   * - `document` — an authored data file the editor owns (e.g. a scene file);
   * - `source-code` — the game's own source is the document (e.g. JSX);
   * - `foreign` — a live tree the editor does not own (an unmodified external
   *   game, or any world edited only through an overlay); edits go to the
   *   overlay, never the source;
   * - `live` — a running game adopted at play time; ordinary edits are not persisted;
   * - `boundary` — a declared world with no live editing surface here.
   */
  source: 'document' | 'source-code' | 'foreign' | 'live' | 'boundary';
  /** Short badge text the shell shows verbatim at the seam (e.g. "scene",
   *  "jsx", "overlay", "read-only", "live"). */
  label: string;
  /** One sentence explaining the truth/writability — shown as the seam
   *  badge's tooltip and as the reason on disabled affordances. */
  detail: string;
}

/**
 * Semantic place a node occupies in the universal authoring hierarchy.
 *
 * `kind` below remains the adapter's native kind (`mesh`, `button`,
 * `pixi-container`, ...). `role` says what the row MEANS to the editor shell,
 * so presentation and interaction never have to infer semantics from an id,
 * label, or substrate-specific kind string.
 */
export type EditorNodeRole =
  | 'folder'
  | 'root'
  | 'document'
  | 'story'
  | 'component'
  | 'instance'
  | 'element'
  | 'entity'
  | 'boundary';

/** A node in the authoring hierarchy — format-neutral. */
export interface EditorNode {
  /** STABLE id — survives reload (see ingest structural-path ids). */
  id: string;
  label: string;
  /** Adapter-declared semantic role. Optional for third-party/older adapters;
   * the shell falls back to the native `kind` only for icon selection. */
  role?: EditorNodeRole;
  /** Optional source-owned context kept visually subordinate to `label`, such
   * as `<header>` beneath a React component name or a document's file path. */
  secondaryLabel?: string;
  kind: 'mesh' | 'light' | 'camera' | 'audio' | 'group' | 'object' | (string & {});
  /**
   * What to CALL this node's type in the inspector header — the component or
   * class an author thinks of it as, when that differs from the native `kind`
   * the shell uses to pick an icon. An `<Enemy>` renders a `group`, but "group"
   * is a fact about its implementation, not its identity; Godot names the class
   * here and Unity names the prefab. Adapters that omit it keep showing `kind`.
   */
  typeLabel?: string;
  parentId: string | null;
  childIds: string[];
  /**
   * THIS ADAPTER'S OWN DEFAULT OPEN STATE for this row, overriding the shell's
   * shape heuristic (`GameHierarchy.tsx`'s `defaultExpansionByNode`, which
   * infers openness from authored depth and branch shape).
   *
   * It exists because one adapter genuinely knows better than any shape rule
   * can: Blender's Outliner has an explicit per-element flag
   * (`outliner_tree.cc:139` makes every fresh element CLOSED; only the Scene
   * Collection and the layer collections clear it,
   * `tree_display_view_layer.cc:130,167`), so "collections open, objects
   * closed" is a fact about the tree rather than a guess about it. Omitted —
   * which is every other adapter — leaves the heuristic exactly as it was.
   */
  defaultExpanded?: boolean;
  /** Opaque project-owned identity shared by authored rows across adapter roots. */
  crossSurfaceId?: string;
  /** Optional authored parent identity resolved against another row's cross-surface id. */
  crossSurfaceParentId?: string;
  /** Source-owned sibling ordinal used only when native rows are joined across surfaces. */
  crossSurfaceOrder?: number;
  /**
   * Live source-owned label for the projected group containing this row's adapter root.
   * Any row may carry it: a native surface can have no semantic root of its own when all of
   * its authored rows are children of entities owned by another surface.
   */
  crossSurfaceGroupLabel?: string;
}

export interface PropertyDescriptor {
  path: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'vec3' | 'color' | 'enum' | 'asset' | 'json';
  readonly?: boolean;
  /**
   * Why this field cannot be written, in the adapter's own vocabulary. The
   * Inspector, its control surface, and the write refusal all project this
   * same sentence; omitting it uses the generic read-only explanation.
   */
  readonlyReason?: string;
  options?: unknown[];
  /**
   * Optional domain-shaped grouping (T3.4 slice 2): properties sharing the
   * same `group` label render together under a titled sub-section in the
   * generic inspector, instead of the flat property grid. Backward-compatible
   * — omitted (or two descriptors with different/no `group`) renders exactly
   * as before this field existed. This is the ONLY authoring-richness
   * addition v1 makes; there is no schema and no new PropertyDescriptor
   * `type` — a custom adapter reports its own domain concepts
   * (health/score/an enum, …) through the SAME provider, merely labeled into
   * a named group.
   */
  group?: string;
  /**
   * The value shown is the DECLARED DEFAULT — the document does not carry this
   * property, the thing that owns it does. Every mainstream inspector
   * distinguishes these (Unity greys an unmodified field and bolds an
   * overridden one) because otherwise you cannot tell what a document actually
   * says from what it merely inherits. Editing a defaulted property writes it
   * into the document for the first time.
   */
  defaulted?: boolean;
  /**
   * This property can be REMOVED from the document, reverting it to the
   * declared default — Unity's revert arrow, Godot's reset arrow. Only set when
   * removal is legal: the owner declares the property optional (or gives it a
   * default), so dropping it leaves a still-valid document. The inverse of
   * editing a `defaulted` property.
   */
  resettable?: boolean;
  /**
   * The SOURCE TEXT of the default a revert returns this property to (`1.55`,
   * `'raider'`), so the revert affordance can name its destination instead of
   * saying "default" and hoping.
   *
   * Set ONLY when the owner actually declares a default the adapter can read.
   * Absence is the honest, common case: an optional property with no declared
   * default is still removable — what takes over is then the owner's own
   * internal fallback or nothing at all, which this side does not know. Never
   * fill it with the property's CURRENT value: that is what the author is
   * discarding, not what they get back.
   */
  revertsTo?: string;
}

export interface HierarchyProvider {
  roots(): EditorNode[];
  node(id: string): EditorNode | null;
  /**
   * OPTIONAL semantic-join revision. A composite hierarchy uses explicit
   * `crossSurface*` fields to join native roots; this signature changes if and
   * only if those fields, their semantic ancestry, or their order changed.
   * Ordinary native-only child churn may leave it stable. `null` explicitly
   * means this provider has no semantic participation. Omission means the
   * composite must conservatively re-read the provider's whole hierarchy.
   */
  crossSurfaceStructureSignature?(): string | null;
  /**
   * OPTIONAL, THREE-SURFACE — the live scene object for raycast/gizmo binding
   * (null for a node this adapter has no object for), opaque here: its Three
   * typing is `@volter/editor-threejs`'s `threeHierarchy`. A Pixi, DOM or React
   * adapter has no scene object at all: it OMITS this method rather than
   * implementing a `() => null` stub that pretends the concept applies. Callers
   * already treat `null` as "no object here", so absence and `null` mean the
   * same thing to them — optional-chain it (`hierarchy.object3D?.(id) ?? null`).
   */
  object3D?(id: string): unknown;
  /** OPTIONAL, THREE-SURFACE — inverse of {@link object3D}. Same rule: an
   *  adapter with no scene-object tree omits it. */
  idForObject3D?(o: unknown): string | null;
}

export interface SelectionProvider {
  get(): string[];
  /** Set the selected authoring subjects. `exact` is for projections that
   * already name a real node (for example a folded-internal light inventory);
   * the default keeps the adapter's normal semantic component resolution. */
  set(ids: string[], options?: { intent?: 'semantic' | 'exact' }): void;
  /** Resolve a raw native/render hit to the semantic authoring subject. The
   * shell must not infer ownership from ancestry or substrate-specific kinds.
   * Older adapters may omit this; raw ids then remain the selection ids. */
  resolve?(
    rawId: string,
    options?: { intent?: 'normal' | 'deep'; scopeId?: string | null },
  ): SelectionResolution | null;
}

/** Adapter-owned result of semantic selection resolution: the raw native/render
 * hit mapped to the node the author actually means. ONE id, deliberately:
 * separate inspector/transform/boundary aliases would have to agree, and
 * nothing in the shell can enforce that. */
export interface SelectionResolution {
  /** Hierarchy selection and Inspector subject. */
  id: string;
}

export type TransformChannel = 'position' | 'rotation' | 'scale';

export interface TransformEditability {
  writable: boolean;
  /** Human-facing explanation for a disabled gizmo/field. */
  reason?: string;
  /**
   * Is there an AUTHORED override of this channel that {@link
   * TransformProvider.remove} could drop? The per-channel analogue of a
   * property descriptor's `resettable`, and it is answered the same way: the
   * document actually carries this channel, and this session has a door that
   * can take it back.
   *
   * It lives HERE rather than being inferred from `remove`'s presence because
   * `remove` is a lane-wide fact while this is a per-subject one — a composite
   * routes both, but only this one can say that THIS node's `position` is
   * authored and THAT node's is not. Omitted ⇒ nothing to drop, and the
   * protocol's removal door refuses by name instead of acking a revert it did
   * not perform.
   *
   * EACH HALF IS ANSWERED BY WHOEVER CAN SEE IT, and a lane that cannot read
   * its own document may not invent the first. A source lane holding the
   * file's text answers both (the first-party R3F lane reads the callsite's
   * attributes before saying yes). A lane whose client holds only an
   * oid → file:line index and writes through a server that resolves the
   * address — the vendored-ingest lane — can honestly answer only the SECOND,
   * so that is what it answers, and `remove`'s own {@link WriteAck} reports
   * whether an attribute was actually dropped (`persisted: false` when the
   * callsite carried none). The inverse is what is forbidden on every lane:
   * acking a drop that took no byte.
   */
  removable?: boolean;
}

/** The one lawful Play→source write: a person explicitly attributes the
 * selected live node's current transform to its OID-anchored source literal.
 * This is an atomic optional group so availability and the write door cannot
 * drift apart. Ordinary transform gestures remain governed by begin/apply/end
 * and therefore stay ephemeral while Play is running. */
export interface TransformSourceCommitProvider {
  availability(id: string): { available: boolean; reason?: string };
  commit(id: string): Promise<WriteAck>;
}

export interface TransformProvider {
  /** Honest inspector presentation for the substrate's transform vocabulary. */
  dimensions?(id: string): '2d' | '3d' | null;
  get(id: string): Transform;
  /** Pre-gesture persistence check. Omitted means the adapter's transform
   * capability applies uniformly. A false result must suppress manipulation
   * before the live object is moved, never discover refusal at drag end. */
  editability?(id: string, channel: TransformChannel): TransformEditability;
  /** Pause whatever controller fights the gizmo (physics/script) for editing. */
  beginEdit(id: string): void;
  apply(id: string, t: Transform): void;
  /**
   * Close the gesture — and, for an adapter that persists, ANSWER FOR IT: the
   * returned {@link WriteAck} is this edit's own outcome, produced after the
   * write it triggered has settled. Returning nothing is the honest report of
   * an adapter that performed no write, and the shell then reports the
   * live-only floor rather than borrowing an answer from somewhere else.
   */
  endEdit(id: string): void | WriteAck | Promise<void | WriteAck>;
  /**
   * Optional — DROP one channel's authored transform entirely, rather than
   * writing a value into it.
   *
   * THE SAME DOOR {@link InspectorProvider.remove} IS, for the channel the
   * Transform section owns instead of a property row. `apply`/`endEdit` write a
   * VALUE, so reverting a channel an authoring gesture APPENDED by writing the
   * old numbers back leaves `position={[0, 0, 0]}` standing where the source
   * carried nothing — the file ends one attribute heavier than it started, and
   * no byte-level edit/revert round trip can close. Only removal expresses that
   * absence, which is why a lane without this door grades UNVERIFIABLE rather
   * than passing.
   *
   * SAME ACK CONTRACT AS {@link endEdit} — the pipe's per-edit {@link WriteAck}
   * for THIS removal, awaited. Removal is a write; it moves bytes, and the
   * caller has the same right to be told where they went. Returning nothing
   * means this provider performed no persisted write and the shell reports the
   * live-only floor.
   *
   * What "absent" MEANS is the dialect writer's to decide (deleting the JSX
   * attribute, for the source lanes). Nothing above this seam infers it: a lane
   * whose transform truth IS the running object — there is no document for the
   * channel to be absent from — simply omits the method, and the protocol door
   * refuses by name rather than falling back to a value write.
   */
  remove?(id: string, channel: TransformChannel): void | WriteAck | Promise<void | WriteAck>;
  /** Explicit Play→source attribution. Absent outside an eligible live OID
   * surface; never used implicitly by a transform gesture. */
  readonly sourceCommit?: TransformSourceCommitProvider;
}

export interface InspectorProvider {
  /** Schema-driven — fixed to no document format. */
  properties(id: string): PropertyDescriptor[];
  get(id: string, path: string): unknown;
  /**
   * Write one property — and, for an adapter that persists, ANSWER FOR IT: the
   * returned {@link WriteAck} is this edit's own outcome (same contract as
   * {@link TransformProvider.endEdit}). Returning nothing means no write was
   * performed by this provider, and the shell reports the live-only floor.
   */
  set(id: string, path: string, value: unknown): void | WriteAck | Promise<void | WriteAck>;
  /**
   * Optional — SHOW a value without writing it, for a control the user drags.
   *
   * The gizmo already has this pair ({@link TransformProvider.writeTransform}
   * live, {@link TransformProvider.endEdit} persisting), and a colour picker
   * needs the same shape: it streams values continuously while the pointer
   * moves, and persisting each one is a write burst the absorb cycle cannot
   * follow. So the control previews here on every change and calls
   * {@link set} ONCE when the gesture ends.
   *
   * A preview NEVER persists and is never the truth: whatever the adapter
   * mutates is discarded by the next remount unless a `set` follows. An
   * adapter that cannot show a value without writing it simply omits this,
   * and the control's preview is a no-op — the value still lands on commit.
   */
  preview?(id: string, path: string, value: unknown): void;
  /** Optional per-subject write preflight for shell affordances outside the
   * Inspector field grid (notably hierarchy eye/lock controls). The property
   * descriptor remains the Inspector's source of `readonly`; this gives other
   * generic surfaces the same answer and its adapter-authored reason. */
  editability?(id: string, path: string): { writable: boolean; reason?: string };
  /**
   * Optional — REMOVE a property's authored override entirely (not "set to a
   * value"), letting whatever governs it in its absence take over.
   *
   * THIS IS THE ONLY WAY TO EXPRESS BYTE-ABSENCE. {@link set} writes a VALUE:
   * reverting a prop an authoring gesture ADDED by setting it back to what the
   * default would have been leaves `position={[0, 0, 0]}` in the source where
   * the file previously carried nothing at all. Only removal restores the
   * bytes, which is why a lane with no `remove` cannot close its own
   * edit/revert round trip and grades UNVERIFIABLE rather than passing.
   *
   * SAME ACK CONTRACT AS {@link set} — the pipe's per-edit {@link WriteAck}
   * (`editor/src/authoring/write-pipe.ts`), awaited. Removal is a write; it
   * moves bytes, and the caller has the same right to be told where they went
   * and whether they moved. Returning nothing means this provider performed no
   * persisted write, and the shell reports the live-only floor.
   *
   * What "absent" MEANS is the dialect writer's to decide — deleting a JSX
   * attribute, dropping a CSS longhand so its shorthand cascades. Nothing above
   * this seam infers it. Adapters with no removable-override concept simply
   * omit the method; callers optional-chain, and the protocol door refuses by
   * name rather than falling back to a value write.
   */
  remove?(id: string, path: string): void | WriteAck | Promise<void | WriteAck>;
}

/**
 * An authored node that is itself an asset, even when its bytes are embedded
 * in another source document instead of living at a standalone project path.
 *
 * The first concrete case is inline SVG in a DOM/React root: its `<path>` and
 * `<g>` implementation is no more part of the authoring hierarchy than the
 * meshes inside an imported model. The adapter owns the native-to-asset
 * conversion; the shell only opens the returned image in its ordinary Asset
 * Editor document.
 */
export interface AuthoringAssetSubject {
  readonly kind: 'image';
  readonly name: string;
  readonly mediaType: 'image/svg+xml';
  readonly text: string;
  /** Project-root-relative source definition, when the adapter can prove it. */
  readonly sourcePath?: string;
}

export interface AssetSubjectProvider {
  get(id: string): AuthoringAssetSubject | null;
  /**
   * Assets known to this authoring document even when they are not in its
   * currently focused hierarchy projection. React story boards use this to
   * expose SVGs mounted in inactive story frames without flattening those
   * frames into the active hierarchy.
   */
  entries?(): ReadonlyArray<{ id: string; subject: AuthoringAssetSubject }>;
}

/** A semantic jump from one authored subject to another document/subject.
 * The adapter owns resolution and opening; the inspector only presents the
 * title and exposes the same verb to human and serialized projections. */
export interface RelatedSubjectLink {
  readonly id: string;
  readonly title: string;
  open(): void;
}

export interface RelatedSubjectsProvider {
  links(id: string): readonly RelatedSubjectLink[];
}

/** One source-owned prop that differs from its component's declared default. */
export interface ComponentInstanceOverride {
  /** The owning Inspector field path; stable and agent-addressable. */
  readonly path: string;
  readonly label: string;
  readonly value: unknown;
  /** Source text of the component default, when the declaration exposes one. */
  readonly defaultText?: string;
  /** Applying requires a literal callsite value and a literal declared default. */
  readonly canApplyToComponent: boolean;
  readonly applyUnavailableReason?: string;
  /** Placed instances that will inherit this default after the apply. */
  readonly affectedInstanceCount: number;
}

/** Derived prefab-instance facts. Nothing in this shape is persisted separately. */
export interface ComponentInstanceDescription {
  readonly componentName: string;
  readonly sourcePath?: string;
  readonly overrides: readonly ComponentInstanceOverride[];
}

export interface ComponentInstanceApplyResult {
  readonly changed: boolean;
  readonly message: string;
  /** This operation's own writer acknowledgement. Absent when the request was
   * refused before any write; live-only is an explicit WriteAck. */
  readonly write?: WriteAck;
}

/**
 * Source-derived component-instance operations. A provider exists only when an
 * adapter can prove component identity and write the component's native source.
 * No override store is implied: describe is a diff, revert removes callsite
 * props, and apply edits the component declaration itself.
 */
export interface ComponentInstancesProvider {
  describe(id: string): ComponentInstanceDescription | null;
  /** Open the native component/prefab board for this instance's surface. */
  openComponent?(id: string): void;
  revert(id: string, paths: readonly string[]): Promise<void | WriteAck>;
  applyToComponent(id: string, path: string): Promise<ComponentInstanceApplyResult>;
}

/**
 * WHAT A STRUCTURAL VERB ANSWERS WITH — the same widening
 * {@link TransformProvider.endEdit} and {@link InspectorProvider.set} carry,
 * for the same reason: the ack is produced by the component that performed
 * THIS edit, and there is nowhere else for a caller to get one.
 *
 * `void` is the honest answer for a lane whose verb performs no write of its
 * own (an in-memory adapter mutating a graph it already owns); a lane that
 * writes returns the persistence pipe's own {@link WriteAck}
 * (`editor/src/authoring/write-pipe.ts`), awaited, so a caller that awaits the
 * verb has awaited the byte.
 *
 * A structural verb resolves on ITS OWN verb: `remove` asks whether the struct
 * writer is bound, never whether the PROP writer is — resolving on a
 * value-write door is how a lane comes to ack `source-prop` for a door it does
 * not have.
 */
export type StructuralWriteOutcome = void | WriteAck | Promise<void | WriteAck>;

/**
 * WHAT AN ID-RETURNING STRUCTURAL VERB ANSWERS WITH — the id and the ack, as
 * ONE return.
 *
 * The writing verbs ({@link StructureProvider.remove} and friends) answer with
 * a bare {@link StructuralWriteOutcome}, because the write IS their whole
 * answer. `create`/`duplicate`/`group`/`ungroup` owe their caller a second
 * thing — the id(s) the op produced — and those two halves settle at DIFFERENT
 * TIMES:
 *
 *  - the id is SYNCHRONOUS where a lane can mint one. The live canvas surface
 *    adds a real display object to the running tree and re-indexes before it
 *    returns, so `create` hands back an id its caller can select in the same
 *    turn ("create then immediately select it" is the ordinary shell
 *    sequence). Making the verb `async` to carry the ack would take that
 *    away from every caller to serve a value that is already known.
 *  - the ack is ASYNCHRONOUS wherever a byte is involved, and it is the only
 *    thing that says whether the edit reached the file it claims.
 *
 * So the return carries both. A source lane whose new id only exists after the
 * remount stamps it answers `id: ''` (there is no honest synchronous id) with a
 * real `ack`; a router that could not route answers with an unchanged id and
 * `ack: undefined` (no write was attempted, which is exactly what `void` means
 * in {@link StructuralWriteOutcome}).
 *
 * Firing the write and dropping the promise on the floor — `void structOp(…)`
 * behind a `return ''` — is the shape this type exists to make unrepresentable:
 * it left the caller unable to await the byte, which is how N same-file
 * duplicates went out together, each reading the file before any wrote back.
 */
export interface StructuralIdWrite<Id extends string | null = string> {
  /** The id the op produced — `''` when the lane cannot know it until its own
   *  source write completes and the world remounts. */
  readonly id: Id;
  readonly ack: StructuralWriteOutcome;
}

/** The plural half of {@link StructuralIdWrite}, for a verb that promotes a set
 *  of ids rather than minting one. */
export interface StructuralIdsWrite {
  readonly ids: readonly string[];
  readonly ack: StructuralWriteOutcome;
}

/** Clipboard-backed structural writes retain the existing `false` refusal
 * channel while answering a successful cut/paste with the write's real
 * destination. A bare `true` cannot prove a byte landed anywhere. */
export type StructuralClipboardOutcome = false | WriteAck | Promise<false | WriteAck>;

export interface StructureProvider {
  /** Create a `kind` under `parentId`, answering with the new id AND this
   *  creation's own write ack (see {@link StructuralIdWrite}). */
  create(kind: string, parentId?: string): StructuralIdWrite;
  /**
   * Remove `id`. May optionally return an awaitable when the
   * underlying write is asynchronous (e.g. a react-world source-file edit) —
   * `deleteSelection` (`editor-hotkeys.ts`) awaits it per id so a same-file
   * multi-delete's writes land strictly one at a time (see that function's own
   * doc comment for why serialization + deletion order together are what make
   * a per-id loop sound for an adapter whose OID index isn't reindexed between
   * writes). An adapter with a synchronous/in-memory remove (e.g.
   * `UIAuthoringAdapter`) returns `void` — `await`ing it is a harmless no-op.
   *
   * A source-writing lane returns THIS removal's own {@link WriteAck} (see
   * {@link StructuralWriteOutcome}).
   */
  remove(id: string): StructuralWriteOutcome;
  /** Copy `id`, answering with the copy's id AND this duplication's own write
   *  ack (see {@link StructuralIdWrite}). A source lane whose copy has no id
   *  until the remount stamps it answers with the SOURCE id it was given —
   *  `duplicate` has no refusal channel, so an empty string there would be
   *  indistinguishable from "refused". */
  duplicate(id: string): StructuralIdWrite;
  /** Duplicate a selection as one native operation and select all copies.
   * Preserves relationships within the selection and creates one undo step.
   * Absent means the caller falls back to individual duplicate operations. */
  duplicateMany?(ids: readonly string[]): StructuralWriteOutcome;
  reparent(id: string, newParentId: string | null): StructuralWriteOutcome;
  /** Reorder `id` to sit immediately before `beforeSiblingId` among its siblings
   *  (`null` = move to the end). Absent ⇒ the shell has no sibling-reorder UI
   *  for this adapter. */
  reorder?(id: string, beforeSiblingId: string | null): StructuralWriteOutcome;
  /**
   * The kinds `create` accepts for a given parent (`null` parentId = a new
   * root), each with a display label — drives the shell's creation palette.
   * Absent ⇒ the palette shows nothing for this adapter, even though `create`
   * itself may still work when called directly (e.g. programmatically, or by
   * an adapter-specific affordance outside the generic palette).
   */
  creatableKinds?(parentId: string | null): { kind: string; label: string }[];
  /** D3 (spec 27 §6) — wrap `id` in a new container element (default tag
   *  adapter-chosen, e.g. a `div`), re-parenting `id` as that container's sole
   *  child. Absent ⇒ the shell's context menu shows no Wrap item for this
   *  adapter. */
  wrap?(id: string, wrapperTag?: string): StructuralWriteOutcome;
  /** D3 (spec 27 §6) — replace `id` with its own children (the inverse of
   *  `wrap`). Absent ⇒ the shell's context menu shows no Unwrap item for this
   *  adapter. */
  unwrap?(id: string): StructuralWriteOutcome;
  /** Group sibling authoring objects beneath one new spatial parent. The
   * adapter owns transform preservation, persistence, and undo semantics.
   * Answers with the new group id — `null` when the selection cannot be
   * grouped at all — AND this grouping's own write ack (see
   * {@link StructuralIdWrite}). */
  group?(ids: readonly string[]): StructuralIdWrite<string | null>;
  /** Dissolve a plain spatial group, answering with the ids of its promoted
   * children AND this dissolution's own write ack (see
   * {@link StructuralIdsWrite}). Absent means this adapter has no lossless
   * ungroup operation. */
  ungroup?(id: string): StructuralIdsWrite;
  /** Preflight for an Ungroup affordance. Omit when ungroup is never offered. */
  canUngroup?(id: string): boolean;
  /**
   * D4.R2 (spec27 §6 D4 reopen) — remove every id in `ids` as ONE undoable
   * op (a single Ctrl+Z restores the whole batch), instead of the caller
   * looping `remove(id)` per id (which — one `remove` call = one undo push
   * per adapter, by design — produces N separate undo entries: Ctrl+Z then
   * restores them one at a time, asymmetric with the first-party adapter's
   * own single batched multi-delete undo). Absent ⇒ the shell falls back to
   * the per-id `remove` loop (today's N-entry behavior, unchanged) — an
   * honest degrade, not a silent behavior change, for any adapter that
   * hasn't implemented batching. May optionally return an awaitable, same
   * widening `remove` documents above ({@link StructuralWriteOutcome}) and for
   * the same reason (delete-order-residual fix): `deleteSelection`
   * (`editor-hotkeys.ts`) awaits it so the caller can rely on the whole
   * batch's write having landed before it returns. A synchronous/in-memory
   * implementation (e.g. `UIAuthoringAdapter`'s) returns `void` — awaiting it
   * is a harmless no-op.
   */
  removeMany?(ids: readonly string[]): StructuralWriteOutcome;
  /** Copy authored entities through the host clipboard. The adapter owns the
   * native payload (JSX for a source-backed Three/Canvas world, native records
   * for a data-backed adapter); the shell never serializes an engine-private
   * shape. */
  copy?(ids: readonly string[]): boolean | Promise<boolean>;
  /** Honest affordance preflight. Omit when copy is never offered. */
  canCopy?(ids: readonly string[]): boolean;
  /** Copy, then remove the same authored entities only after the clipboard
   * write succeeds. One adapter operation owns that ordering. */
  cut?(ids: readonly string[]): StructuralClipboardOutcome;
  /** Paste as children of `parentId`; `null` means the adapter document root.
   * The shell derives the current selection's parent so ordinary Paste creates
   * siblings, matching scene-hierarchy editors. */
  paste?(parentId: string | null): StructuralClipboardOutcome;
  /** Honest affordance preflight. It need only cover adapter/session state;
   * the actual paste still validates the live system clipboard. */
  canPaste?(parentId: string | null): boolean;
}

/**
 * PersistenceProvider — whether and where an adapter's edits persist (design).
 * The ACTIVE adapter's provider is the ONE place this is decided — the host
 * (editor) never hard-codes a destination or guards on session flags; it asks the
 * provider.
 */
export interface PersistenceProvider {
  isDirty(): boolean;
  /** The last persistence failure that still requires attention. Successful
   * subsequent persistence clears it. Auto-saving source adapters use this to
   * report a rolled-back source write without inventing a dirty document. */
  lastError?(): string | null;
  /** Save to the adapter's OWN source of truth (its source file, its own
   *  data, …) — whatever that adapter defines it to be. */
  save(): Promise<void>;
  /**
   * Human/agent-readable destination this provider persists to — e.g.
   * `"src/world.tsx"`, `"live-only (not saved)"`, or `"ephemeral
   * (discarded on stop)"`. Drives the save-status UI and makes routing
   * inspectable (design §2). Implementers whose destination can change during
   * the session (a provider that tracks the currently focused document, say)
   * should expose this as a live getter rather than a value captured once.
   */
  readonly destination: string;
  /**
   * The reload contract (design §5): apply an external change to this
   * provider's persisted artifact into the RUNNING session (e.g. a file-watcher
   * update to the artifact). Absent ⇒ the host must remount to
   * pick up external changes — the honest floor, and correctly what the
   * ephemeral provider reports.
   *
   * `rawContent`, when the host has it (the file-watcher SSE payload carries the
   * artifact's exact bytes), is an OPTIONAL second parameter enabling own-echo
   * detection — an event that is exactly what this provider itself last wrote is
   * its own save reflected back, and should be skipped even outside the normal
   * debounce window (see `EditorStore.applyExternalUpdate`'s doc comment). This
   * stays optional/provider-specific — only the first-party provider currently
   * uses it — so other implementers can ignore the parameter entirely.
   */
  applyExternal?(content: unknown, rawContent?: string): void;
}

/** D12 — per-layer viewport picking. Coordinates are client (browser) px. */
export interface PickProvider {
  pick(clientX: number, clientY: number): string | null;
  /**
   * Every authorable subject below the point, frontmost first. The shell uses
   * this for the ordinary scene-editor "pick from overlap" menu; adapters
   * that cannot enumerate an overlap may omit it and still provide the
   * single-hit floor through {@link pick}.
   */
  candidates?(clientX: number, clientY: number): readonly string[];
}

/** D4 — storybook stories. */
export interface StoryRef {
  id: string;
  label: string;
}
export interface StoriesProvider {
  storiesFor(nodeId: string): StoryRef[]; // [] = none
  active(nodeId: string): string | null;
  apply(nodeId: string, storyId: string | null): void; // null clears
  /** Render ONLY this node against the story (storybook canvas); null exits. */
  isolate?(nodeId: string | null, storyId?: string): void;
  /**
   * Display vocabulary for this provider's section — e.g. an ingested game's
   * contract scenes say "Scenes"; absent means the default "Stories". The
   * states are the same seam either way; only the word the human reads
   * changes, so a game's own screens are never labelled with a design-time
   * term the game never uses.
   */
  readonly title?: string;
  /**
   * Why this provider could not enumerate, or `null` when it did. An empty
   * `storiesFor` and an UNREAD one look identical from the section that draws
   * them, and only the provider knows which it is — so the PROVIDER answers,
   * and the shell never reaches past it into one particular provider's own
   * discovery to find out (a CSF registry, a game contract's screen list).
   * Absent means the provider always ran.
   */
  unavailable?(): string | null;
}

/**
 * Where a drop landed, when the shell knows. The VIEWPORT knows a world point
 * (its ground-plane raycast under the cursor); the hierarchy panel does not,
 * and passes nothing. Optional both ways: an adapter with no placement concept
 * ignores it, and a caller with no point omits it — so neither side has to
 * pretend. Coordinates are world-space, in the adapter's own units.
 */
export interface AssetDropContext {
  readonly position?: readonly [number, number, number];
  /** Transient drag metadata. The project's native source remains truth; this
   * only tells an adapter whether the path names a file or a source component. */
  readonly item?:
    | { readonly kind: 'file'; readonly name: string }
    | {
        readonly kind: 'component';
        readonly name: string;
        readonly sourcePath: string;
        readonly exportKind: 'default' | 'named';
        readonly surface: 'three' | 'canvas' | 'dom' | 'unknown';
      };
}

/** Asset drop (hierarchy + viewport). */
export interface AssetDropProvider {
  accepts(nodeId: string, assetPath: string, context?: AssetDropContext): boolean;
  /** A drop that lands as an ELEMENT in the game's own source is a structural
   *  write, so it answers with the same {@link StructuralWriteOutcome} the rest
   *  of {@link StructureProvider}'s writing verbs do — a lane whose drop only
   *  mutates the running graph returns `void`. */
  drop(nodeId: string, assetPath: string, context?: AssetDropContext): StructuralWriteOutcome;
}

/** Plain-object rect shape shared by {@link RectProvider} — the same fields a real
 *  `DOMRect` carries (a subset, so a real `DOMRect` satisfies this structurally too).
 *  See {@link RectProvider} for the coordinate space (host-relative, not viewport). */
export interface DOMRectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Per-node screen geometry — the KEYSTONE omission today (nothing produces rects the
 *  ported inspect.ts math consumes). Coordinates are **host-relative** px: relative to
 *  the adapter's own mounted world surface (its `position:absolute; inset:0` layer), the
 *  same surface the A3 selection overlay is hosted over, so the overlay can draw against
 *  these rects directly. (NOT viewport-client — the JSDoc formerly said so in error.) */
export interface RectProvider {
  /** selectable node id → its current bounding rect, or null if unmounted/offscreen */
  rect(id: string): { x: number; y: number; width: number; height: number } | null;
  /** rects of layout-relevant neighbours, for snap/measure/box-model overlays */
  contextRects?(id: string): {
    parent?: DOMRectLike;
    siblings?: DOMRectLike[];
    paddingBox?: DOMRectLike;
  };
  /**
   * D3 (spec 27 §6) — every currently-empty container this adapter's tree
   * contains right now: no visible children, no text, a collapsed dimension
   * (the `ui-source/inspect.ts:findEmptyContainers` math) — each with a
   * grown-to-tappable placeholder rect and a display name, driving the
   * overlay's dashed empty-container hint. Host-relative, same coordinate
   * space as {@link rect}. Absent ⇒ this adapter has no "empty container"
   * concept (e.g. an adapter with no structural containers at all) — no
   * hints are drawn for it.
   */
  emptyContainers?(): { id: string; rect: DOMRectLike; displayName: string }[];
}

/** One adapter-owned reference point rendered by the shared world overlay.
 * Coordinates are host-relative px, the same frame as {@link RectProvider}.
 * A provider deliberately exposes at most one point for a node so coincident
 * native concepts (for example an anchor and pivot) never become ambiguous. */
export interface BoxEditReferencePoint {
  /** True when the native source constrains this point (for example a
   * normalized 0..1 Sprite anchor). The overlay then uses only exact native
   * snap points, never an unreachable axis-aligned bounding-box target. */
  bounded?: boolean;
  id: string;
  kind: 'anchor' | 'pivot';
  label: string;
  /** Exact host-space points the native reference can reach and should snap
   * to. Useful for transformed corner/edge/center grids on rotated content. */
  snapPoints?: ReadonlyArray<{ x: number; y: number }>;
  x: number;
  y: number;
}

/** Spatial gesture → source/data write for native 2D boxes (DOM or canvas).
 * Distinct from the 3D TransformProvider. begin/apply/end bracket a single
 * undo step; apply is live-preview. */
export interface BoxEditProvider {
  begin(id: string): void;
  /** patch: any of x,y,width,height,marginTop… paddingLeft… — px deltas or absolutes.
   * `referenceX`/`referenceY` are the absolute host-relative coordinates of
   * the active {@link referencePoint}; only providers exposing that optional
   * capability receive those keys. The provider owns conversion to native
   * source units and any placement-preserving compensation. */
  apply(id: string, patch: Record<string, number>): void;
  end(id: string): void;
  /** Native transform origin for the viewport gizmo, in the same host-space
   * frame as {@link RectProvider}. A 2D scene uses this instead of guessing
   * from the visual bounds: sprites can have anchors, containers can have
   * pivots, and neither necessarily sits at the box center. */
  gizmoOrigin?(id: string): { x: number; y: number } | null;
  /** Optional single native anchor/pivot affordance for this node. */
  referencePoint?(id: string): BoxEditReferencePoint | null;
}

/** Text-content editing, ON the contract: the react-world adapter implements this
 *  provider (`react-world-authoring-adapter.ts`'s `readonly text: TextProvider`),
 *  bringing its own `editText(id)` write path onto the seam, so the overlay's
 *  double-click-to-edit-text (D3) is contract-driven rather than reaching for a
 *  concrete adapter's method. */
export interface TextProvider {
  /** the element's editable pure-text, or null if the body is dynamic/has child elements */
  get(id: string): string | null;
  set(id: string, text: string): void; // dynamic-guarded by the writer
}

/**
 * D3 (spec 27 §6) — background-color sampling at a viewport point, for the
 * eyedropper's FALLBACK path (browsers with no native `EyeDropper` API). The
 * native API, where available, samples real rendered pixels itself and needs
 * none of this. Distinct from {@link PickProvider} (which returns a node id,
 * not a color) and from `InspectorProvider.get('style.backgroundColor')`
 * (which NORMALIZES to `#rrggbb` and so loses the "transparent" signal a
 * color CHAIN walk needs — see `ui-source/inspect.ts:effectiveColorFromChain`'s
 * doc comment: it walks raw, un-normalized CSS values looking for the first
 * non-transparent one).
 */
export interface ColorSampleProvider {
  /** Raw (un-normalized) CSS `background-color` values, hit-element FIRST,
   *  walking up its ancestor chain — the exact shape
   *  `effectiveColorFromChain` consumes. `null` when nothing is hit at the
   *  point. Client (viewport) px, matching {@link PickProvider}. */
  backgroundChainAt(clientX: number, clientY: number): string[] | null;
}

/**
 * Where a node's live object CAME FROM in the game's own truth.
 *
 * `display` is the string the editor shows verbatim. The unanchored shape
 * carries a `reason` rather than a blank, because "we don't know" and "a
 * library built it" are different facts and neither may present as silence
 * (the honest-floor rule).
 *
 * TWO ANCHORED KINDS, because a game has two kinds of truth and only one of
 * them is source.
 *
 *  - `source` is the original: a `new` expression at a `file:line:col` in the
 *    game's own code, which is where an edit to a constructor literal has to be
 *    written.
 *  - `data` is the sibling a level-based game needs. Its placed cargo — the
 *    enemies, the pickups, the objectives — reaches no source literal at all;
 *    it is binary records inside a level file that the game parses at load. An
 *    authored move of one is therefore an edit to THE GAME'S OWN DATA, and
 *    the honest anchor is the data file plus the index of the record that
 *    addresses the object inside it.
 *
 * `kind` is an explicit discriminant rather than an inferred one, so a consumer
 * that only understands source anchors fails to compile against a data anchor
 * instead of silently reading `line` off something that has none.
 *
 * A data record is EXACTLY ONE object by construction — an index addresses one
 * record — so the "how many objects did this site construct?" question that
 * governs a source write has no data-side analogue and must not be invented
 * for one.
 */
export type NodeCreationSite =
  | { anchored: true; kind: 'source'; file: string; line: number; col: number; display: string }
  | {
      anchored: true;
      kind: 'data';
      /** Project-relative path of the game's own data file, POSIX separators. */
      file: string;
      /** Index of the record inside that file which addresses this object. */
      record: number;
      display: string;
    }
  | { anchored: false; reason: string };

/**
 * WHERE AN AUTHORED WRITE LANDS — the vocabulary of anchor KINDS, and the
 * closed set of them.
 *
 * {@link NodeCreationSite} answers "where did this object come from"; a kind
 * answers the write-side question beside it: WHICH LANE would carry an edit to
 * this node, and therefore WHAT has to be true for that edit to be correct. The
 * two are not the same fact — two nodes can both be `{ kind: 'source' }` at a
 * `file:line` and still be written by different lanes with different gates.
 *
 * Each kind's CORRECTNESS CONTRACT, and the named test that proves it:
 *
 *  - `source-prop` — the value is a literal PROP on an element of the game's own
 *    source (a JSX attribute the serve-time authoring stamp addresses). Lands at
 *    the anchor; survives a cold remount, because the file is truth and the next
 *    mount re-derives from it.
 *    Proof: `packages/editor/test/oid-source-persistence.test.ts`.
 *  - `source-structure` — the edit is not a VALUE at all: it adds, removes,
 *    moves or re-nests an ELEMENT of the game's own source (`delete`,
 *    `duplicate`, `wrap`/`unwrap`, `create`, `reorder`, `reparent`, `group`).
 *    It is a kind rather than a flavour of `source-prop` because it resolves on
 *    a DIFFERENT DOOR — the dialect's structural writer, not its attribute
 *    writer — and a lane can have one without the other. Claiming `source-prop`
 *    for a structural edit is exactly the classifier/writer split the
 *    persistence pipe exists to make impossible: it names a value lane that
 *    never carried the bytes. Its landing contract adds one gate the prop lane
 *    does not have: the write is WHOLE-FILE and checksum-guarded, so an op
 *    resolved against a stale element index must fail rather than land at the
 *    wrong offset.
 *    Proof: `packages/editor/test/structural-write-pipe.test.ts`.
 *  - `construction-literal` — the value is a literal in the CONSTRUCTION
 *    EXPRESSION that built the object (`new THREE.Mesh(…)` in the game's own
 *    served module). Same landing/remount contract, plus one gate the prop lane
 *    does not have: a site that constructed more than one object is refused,
 *    because rewriting its literal would move all of them.
 *    Proof: `packages/editor/test/ingest-source-persistence.test.ts`.
 *  - `physics-binding` — the node's own transform props are DEAD: a simulated
 *    body writes its matrix every frame from a spawn it reads elsewhere, so the
 *    write lands at the literal that binding reads (the component callsite whose
 *    props the `useBox(…)`/`<RigidBody>` hook takes). It carries the two
 *    contracts above AND ONE MORE: the authored value must SURVIVE RE-SETTLE —
 *    after the world re-derives from source and the design-time settle runs, the
 *    body must have re-spawned at the AUTHORED pose, not at the old one. Being
 *    silently re-posed by the owner is this kind's whole failure mode, and the
 *    reason it is a kind rather than a flavour of `source-prop`.
 *    Proof: `packages/editor/test/r3f-physics-binding.test.ts`.
 *  - `data-record` — the value is a field of a RECORD in the game's own data
 *    file, addressed by index; no source literal mentions it. Lands in that
 *    file through the game's own declared writer; survives a cold remount for
 *    the same reason source does.
 *    Proof: `packages/editor/test/ingest-source-persistence.test.ts`
 *    ("a level-data record is an anchor too").
 *  - `live-only` — there is no anchor. The edit lands on the running object for
 *    the session and NOTHING else, and the contract is that the surface SAYS SO:
 *    a write ack that claims a destination it did not reach is the lie this kind
 *    exists to keep nameable.
 *    Proof: `packages/editor/test/oid-source-persistence.test.ts`
 *    ("an object with no source stamp is refused by name")
 *    + `packages/editor/test/inspection-write-destination.test.ts`.
 */
export type WriteAnchorKind =
  | 'source-prop'
  | 'source-structure'
  | 'construction-literal'
  | 'physics-binding'
  | 'data-record'
  | 'live-only';

/**
 * WHAT ONE EDIT DID — the ack the persistence pipe returns for THAT edit, from
 * the component that actually performed the write.
 *
 * It is deliberately NOT a property of an adapter, a session or a surface. The
 * fact it carries is per-edit, because that is the only granularity at which it
 * can be true: one composite may hold a source-backed three root beside a
 * live-only DOM root, and one three root holds body-placed nodes beside
 * ordinary JSX props. An answer computed from the SURFACE rather than from the
 * edit reports whichever child happened to be persist-capable — measured on the
 * vendored racing game, where a three-root edit acked the other root's
 * destination with `persisted: true`.
 *
 * `persisted: false` is an ANSWER, never a failure: `live-only` is a real
 * anchor kind and the contract of that kind is that the surface SAYS SO. What
 * is forbidden is a `destination` no byte reached being reported with
 * `persisted: true`.
 *
 * A provider that performs a write returns this; one that has no write to
 * perform returns nothing and the shell reports the live-only floor. There is
 * no third answer, and in particular there is no adapter-wide blanket
 * destination standing in for one — {@link PersistenceProvider.destination}
 * answers the different question "where do this surface's SAVES go", for the
 * save-status chrome.
 */
export interface WriteAck {
  /** Where THIS edit's bytes landed, in the writer's own words — or the
   *  live-only/ephemeral floor when none did. */
  readonly destination: string;
  /** Whether a byte actually moved for THIS edit. */
  readonly persisted: boolean;
}

/**
 * The exhaustiveness pin, the same shape and for the same reason as
 * {@link AUTHORING_PROVIDER_PRESENCE}: a `Record` over the union, so a lane that
 * starts producing a new kind of anchor cannot ship without joining the
 * vocabulary (the `Record` would be missing a key) and cannot invent a key the
 * union does not have (excess-property error). The values are `true` and carry
 * no meaning — the KEYS are the payload.
 *
 * What this buys downstream: the per-kind write-reach counts and `vgai doctor`'s
 * edit-write walk both enumerate {@link WRITE_ANCHOR_KINDS} rather than a
 * hand-written list, so a new kind arrives already measured and already walked
 * instead of silently untested.
 */
const WRITE_ANCHOR_KIND_PRESENCE: Readonly<Record<WriteAnchorKind, true>> = {
  'source-prop': true,
  'source-structure': true,
  'construction-literal': true,
  'physics-binding': true,
  'data-record': true,
  'live-only': true,
};

/**
 * The vocabulary as an ordered list — most-addressable first, `live-only` last,
 * so two reports of the same world are diffable line for line.
 *
 * Derived from {@link WRITE_ANCHOR_KIND_PRESENCE} rather than spelled a second
 * time: one list the compiler pins to the union, and nothing downstream can
 * enumerate a different set.
 */
export const WRITE_ANCHOR_KINDS: readonly WriteAnchorKind[] = Object.keys(
  WRITE_ANCHOR_KIND_PRESENCE,
) as WriteAnchorKind[];

/** Zero counts for every kind — the starting point of any per-kind tally, so a
 *  tally can never omit a kind by forgetting to initialize it. */
export function emptyWriteAnchorKindCounts(): Record<WriteAnchorKind, number> {
  const counts = {} as Record<WriteAnchorKind, number>;
  for (const kind of WRITE_ANCHOR_KINDS) counts[kind] = 0;
  return counts;
}

/**
 * Absent ⇒ this adapter's substrate has no creation-site index at all (a
 * document-backed world's truth is the document, not a construction site).
 * Present ⇒ every id gets an answer, anchored or reasoned.
 */
export interface AuthoringTruth {
  /** Where the runtime object came from in the game's own source or data. */
  readonly site: NodeCreationSite;
  /** The lane THIS property edit would actually take. `undefined` means the
   * subject is synthetic or otherwise has no write plan; `live-only` is a real
   * plan whose destination is the running object. */
  readonly writeAnchorKind: WriteAnchorKind | undefined;
}

/**
 * The TRUTH-family binding. One resolution answers both where a subject came
 * from and where an edit to one of its properties lands. A caller may not read
 * those facts through separate providers: that was the classifier/writer split
 * the persistence pipe exists to remove.
 */
export interface TruthProvider {
  resolve(id: string, property: string): AuthoringTruth;
}

/** A plain world-space point. Component handles cross the authoring seam as
 * data; a substrate object or renderer handle never does. */
export type SpatialPoint3 = readonly [x: number, y: number, z: number];

/** Non-interactive geometry an adapter asks the viewport to draw for one
 * spatial component. The vocabulary is intentionally geometric rather than
 * domain-shaped: audio attenuation, light range and a collider radius can all
 * use the same sphere without teaching the shell any of those concepts. */
export type SpatialHandleGuide =
  | {
      readonly kind: 'line';
      readonly points: readonly SpatialPoint3[];
      readonly color: string;
      readonly opacity?: number;
      readonly dashed?: boolean;
    }
  | {
      readonly kind: 'sphere';
      readonly center: SpatialPoint3;
      readonly radius: number;
      readonly color: string;
      readonly opacity?: number;
      readonly dashed?: boolean;
    }
  | {
      readonly kind: 'cone';
      readonly origin: SpatialPoint3;
      readonly direction: SpatialPoint3;
      readonly length: number;
      /** Full opening angle in degrees, matching Web Audio and authoring UIs. */
      readonly angle: number;
      readonly color: string;
      readonly opacity?: number;
      readonly dashed?: boolean;
    }
  | {
      readonly kind: 'box';
      readonly center: SpatialPoint3;
      readonly rotation: readonly [x: number, y: number, z: number, w: number];
      readonly halfExtents: SpatialPoint3;
      readonly color: string;
      readonly opacity?: number;
      readonly dashed?: boolean;
    }
  | {
      readonly kind: 'capsule';
      readonly center: SpatialPoint3;
      readonly rotation: readonly [x: number, y: number, z: number, w: number];
      readonly radius: number;
      readonly halfHeight: number;
      readonly color: string;
      readonly opacity?: number;
      readonly dashed?: boolean;
    };

/** One draggable point. `id` is stable only within its owning node; `label`
 * feeds accessible/editor hints rather than becoming a persisted name. */
export interface SpatialDragHandle {
  readonly id: string;
  readonly label: string;
  readonly position: SpatialPoint3;
  readonly color: string;
  readonly writable: boolean;
  readonly reason?: string;
}

/** One adapter-owned component projection. `category` is a viewport overlay
 * channel (for example `audio`), not a game-object kind; unknown categories
 * obey the master Helpers toggle instead of being rejected. */
export interface SpatialHandleLayer {
  readonly id: string;
  readonly category: string;
  readonly guides: readonly SpatialHandleGuide[];
  readonly handles: readonly SpatialDragHandle[];
}

/**
 * Format-neutral direct-manipulation seam for component-owned spatial values.
 *
 * The viewport draws only the returned geometry. During a drag it returns a
 * world-space point to the adapter; the adapter alone knows whether that means
 * an AudioSource distance, a light cone, a collider extent, or something else,
 * and the adapter alone owns live preview + source persistence. `commit` runs
 * once at gesture end, so source/HMR/history are never hammered per pointer
 * move. Absent means this adapter has no spatial component handles.
 */
export interface SpatialHandlesProvider {
  layers(id: string): readonly SpatialHandleLayer[];
  preview(id: string, handleId: string, worldPosition: SpatialPoint3): void;
  /** Commit the preview and pass through the owning writer's acknowledgement.
   * `void` remains the honest live-only/no-write floor; callers must not grade
   * it as a persisted round trip. */
  commit(id: string, handleId: string, worldPosition: SpatialPoint3): StructuralWriteOutcome;
}

export interface AuthoringAdapter {
  readonly capabilities: AuthoringCapabilities;
  /** Spec 29 §5 — seam-level provenance ("what is truth behind these rows").
   *  Absent ⇒ the shell shows no provenance badge (degrade silently — never
   *  fabricate a claim the adapter didn't make). */
  readonly provenance?: AuthoringProvenance;
  readonly hierarchy: HierarchyProvider; // required — minimum is "read the tree"
  readonly selection?: SelectionProvider;
  readonly transforms?: TransformProvider;
  readonly inspector?: InspectorProvider;
  /** The selected node is an atomic asset that can open in the Asset Editor. */
  readonly assetSubject?: AssetSubjectProvider;
  readonly related?: RelatedSubjectsProvider;
  /** Source-derived prefab/component instance overrides and native writes. */
  readonly instances?: ComponentInstancesProvider;
  readonly structure?: StructureProvider;
  readonly persistence?: PersistenceProvider;
  /** D12 — per-layer viewport picking. Absent ⇒ this adapter is not pickable. */
  readonly pickable?: PickProvider;
  /** T0 (spec 27 §2) — per-node screen geometry for a DOM visual editor's overlay/
   *  snap/measure math. Absent ⇒ this adapter produces no rects (no overlay). */
  readonly rects?: RectProvider;
  /** T0 (spec 27 §2) — spatial drag-resize/move → source/data write for non-Object3D
   *  (DOM) nodes. Absent ⇒ no box-edit gesture for this adapter. */
  readonly boxEdit?: BoxEditProvider;
  /** T0 (spec 27 §2) — double-click-to-edit-text on the contract (wires the react
   *  adapter's existing off-contract `editText`). Absent ⇒ no in-place text edit. */
  readonly text?: TextProvider;
  /** D3 (spec 27 §6) — eyedropper fallback color sampling. Absent ⇒ the
   *  canvas eyedropper swatch has no non-native path for this adapter. */
  readonly colorSample?: ColorSampleProvider;
  /** D4 — storybook stories. Absent ⇒ no stories for any node in this adapter. */
  readonly stories?: StoriesProvider;
  /** Projection subject → source/data anchor and write lane, resolved together. */
  readonly truth?: TruthProvider;
  /** Adapter-owned component guides and direct-manipulation points. */
  readonly spatialHandles?: SpatialHandlesProvider;
  /** Asset drop (hierarchy + viewport). Absent ⇒ this adapter accepts no drops. */
  readonly assetDrop?: AssetDropProvider;
  /** Change notification → UI refresh. */
  subscribe?(listener: () => void): () => void;
}

/**
 * THE PROVIDER VOCABULARY — every member of {@link AuthoringAdapter} beyond the
 * two an adapter cannot exist without.
 *
 * Why this exists: the editor's coverage warnings are supposed to make stopping
 * short of a native root IMPOSSIBLE, and they cannot do that while the row
 * vocabulary is a hand-written list frozen at what its author happened to know.
 * A list like that goes quiet at "all warnings closed" while whole capabilities
 * — stories, asset drop, related subjects, structure — were never enumerated at
 * all, so nothing ever warned about them. So the vocabulary IS the type: adding
 * a provider to `AuthoringAdapter` and forgetting it here is a COMPILE ERROR
 * (the `Record` below is missing a key), and inventing a key the type does not
 * have is an excess-property error. There is no third way to add a provider.
 *
 * `capabilities` and `hierarchy` are excluded because they are required members
 * — every adapter has them by construction, so "absent" is not a state they can
 * be in and a row about them could never say anything.
 */
export type AuthoringProviderKey = Exclude<keyof AuthoringAdapter, 'capabilities' | 'hierarchy'>;

/**
 * The exhaustiveness pin. A `Record` over the key union, so the compiler — not
 * a scan, not a reviewer — is what refuses a vocabulary that has drifted from
 * the interface above. The values are `true` and carry no meaning: the KEYS are
 * the payload.
 */
const AUTHORING_PROVIDER_PRESENCE: Readonly<Record<AuthoringProviderKey, true>> = {
  provenance: true,
  selection: true,
  transforms: true,
  inspector: true,
  assetSubject: true,
  related: true,
  instances: true,
  structure: true,
  persistence: true,
  pickable: true,
  rects: true,
  boxEdit: true,
  text: true,
  colorSample: true,
  stories: true,
  truth: true,
  spatialHandles: true,
  assetDrop: true,
  subscribe: true,
};

/**
 * The vocabulary as an ordered list — declaration order of the interface, so
 * two reports of the same root are diffable line for line.
 *
 * Derived from {@link AUTHORING_PROVIDER_PRESENCE} rather than spelled a second
 * time: one list that the compiler pins to the type, and nothing downstream can
 * enumerate a different set.
 */
export const AUTHORING_PROVIDER_KEYS: readonly AuthoringProviderKey[] = Object.keys(
  AUTHORING_PROVIDER_PRESENCE,
) as AuthoringProviderKey[];

/**
 * Which providers this adapter actually exposes — PRESENCE, measured off the
 * object itself. Nothing here consults `capabilities`, the adapter's class, the
 * route that built it, or the game's id: an adapter this function has never
 * heard of gets the same answer as one it has.
 */
export function measureAuthoringProviders(
  adapter: AuthoringAdapter,
): Readonly<Record<AuthoringProviderKey, boolean>> {
  const measured = {} as Record<AuthoringProviderKey, boolean>;
  for (const key of AUTHORING_PROVIDER_KEYS) {
    measured[key] = (adapter as unknown as Record<string, unknown>)[key] !== undefined;
  }
  return measured;
}
