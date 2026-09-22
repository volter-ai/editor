/**
 * WHAT THE PROPERTIES SECTIONS ARE LOOKING AT — the page-side half of the RNA
 * door (WORK.md §Blender in the tab is Blender, "Inspection parity", I1).
 *
 * React-free ON PURPOSE: this module is a plain store with `subscribe` /
 * `version` / `state`, so the host's Blender side can import it without
 * pulling React into its closure, and the sections read it through one
 * `useSyncExternalStore` (`blender-properties-view.tsx`).
 *
 * THE SUBJECT IS OUR SELECTION, RESOLVED BY IDENTITY. The person clicks a node
 * in our viewport; the adapter hands that node's `THREE.Object3D`; the
 * presented view answers which Blender object that three object IS
 * (`BlenderRuntimeView.blenderObjectName`, a lookup by object identity in the
 * frame's own table — never a name match). That name goes to
 * `rna_context(object=…)`, which builds the Properties context around it
 * exactly as `buttons_context.cc` builds one around
 * `BKE_view_layer_active_object_get`. Reading our selection never WRITES the
 * engine's active object: that is a mutation, and the document would save it.
 *
 * WHEN IT RE-READS. Three times, and each is a signal rather than a poll:
 *  - a PRESENT (`BlenderRuntimeView.subscribeFrames`) — every mutation
 *    presents (`session.py::dispatch`), so a frame is "what you are showing is
 *    stale";
 *  - the RNA DOOR'S OWN VERSION (`subscribeBlenderRna`, ruling 3 of
 *    2026-09-19) — because a write can change what RNA answers and nothing the
 *    presenter draws, so no frame ships: `Node.panel_states[n].is_collapsed`
 *    and `Object.hide_render` are the two measured cases;
 *  - the SELECTION moving to another datablock.
 * A re-read that changes which TABS exist also calls the host door's
 * `documents.contextChanged`, because the tab rail IS the section list and
 * nothing in a host store moved.
 */

import type { BlenderRnaContext, BlenderRnaView } from '@volter/blender-engine/browser/rna';
import { editorHost } from '@volter/editor-sdk/host';
import type * as THREE from 'three';
import {
  blenderPresentationDocumentId,
  blenderRna,
  blenderRnaContext,
  blenderRnaSet,
  blenderSessionStarted,
  noteBlenderRnaChanged,
  subscribeBlenderRna,
} from '../host/blender-runtime-host';
import { blenderOutlinerState } from './blender-outliner-model';

/** The published Model-document context, as much of it as this module reads.
 *  Structurally typed rather than imported as the class, for the same reason
 *  `blender-runtime-host.ts` narrows its `RuntimeView`: the document that
 *  published it and the reader are two modules meeting over one object. */
interface PresentedView {
  readonly root: THREE.Object3D;
  subscribeFrames(listener: () => void): () => void;
  blenderObjectName(object: THREE.Object3D): string | null;
}

const isPresentedView = (value: unknown): value is PresentedView =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as PresentedView).subscribeFrames === 'function' &&
  typeof (value as PresentedView).blenderObjectName === 'function';

/** The active authoring adapter, as much of it as this module reads. The
 *  adapter is deliberately `unknown` at the contribution point (adapter-native
 *  API, never a fabricated projection), and `@volter/editor-blender` holds no host
 *  import — so the shape it needs is stated here and checked at runtime. */
interface Object3DAuthoringLike {
  readonly documentId: string;
  readonly hierarchy: { object3D(id: string): THREE.Object3D | null };
  readonly documentRootObject: THREE.Object3D | null;
}

const isObject3DAuthoring = (value: unknown): value is Object3DAuthoringLike =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Object3DAuthoringLike).documentId === 'string' &&
  typeof (value as Object3DAuthoringLike).hierarchy?.object3D === 'function';

function presentedView(): PresentedView | null {
  const published = editorHost().documents.context(blenderPresentationDocumentId());
  return isPresentedView(published) ? published : null;
}

/**
 * WHAT THE SELECTED NODE IS, to Blender.
 *
 *  - `{ kind: 'object', name }` — the node is one of the engine's objects;
 *  - `{ kind: 'collection', path }` — the node is a LAYER COLLECTION row of
 *    the Outliner. Clicking one in Blender calls `BKE_layer_collection_activate`
 *    (`tree_element_layer_collection_activate`, `outliner_select.cc:812-821`)
 *    and the Collection tab then shows THAT collection; activating it here
 *    would be a mutation the document saves, so the row's own address goes to
 *    the door as a parameter instead (`rna_context(collection_path=…)`), the
 *    same way the looked-at OBJECT does;
 *  - `{ kind: 'scene' }` — the node is the Scene Collection row, which is the
 *    whole file rather than an object in it, so only the tabs that need no
 *    object (Render, Output, View Layer, Scene, World, Collection) stand;
 *  - `null` — not a Blender subject at all, and no section of ours matches.
 *
 * Synchronous and cheap: `match()` runs on every inspector composition.
 */
export type BlenderSubject =
  | { kind: 'object'; name: string }
  | { kind: 'collection'; path: string }
  | { kind: 'scene' };

export function resolveBlenderSubject(
  node: { readonly id: string } | null,
  adapter: unknown,
): BlenderSubject | null {
  if (node === null || !isObject3DAuthoring(adapter)) return null;
  const view = presentedView();
  if (view === null) return null;
  if (node.id === adapter.documentId)
    return adapter.documentRootObject === view.root ? { kind: 'scene' } : null;
  // A COLLECTION ROW HAS NO OBJECT, so it has to be resolved before the object
  // lookup rather than after it — `object3D` answers null for one, which is the
  // honest answer and used to end the resolution here (I3's standing OPEN: the
  // rail simply stayed on the previous subject). The row table is this
  // package's own (`blender-outliner-model.ts`), so this is a map lookup.
  const row = blenderOutlinerState().byId.get(node.id);
  if (row?.type === 'TSE_LAYER_COLLECTION') return { kind: 'collection', path: row.path };
  const object = adapter.hierarchy.object3D(node.id);
  if (object === null) return null;
  // THE SCENE COLLECTION IS THE SCENE SUBJECT. Under I3 the hierarchy is
  // Blender's Outliner, whose root row is the Scene Collection and NOT a
  // document row of the host's — so the row that stands for the whole file is
  // the one whose object is the presented ROOT, and it stands for exactly what
  // the document row did: the tabs that need no object (Render, Output, View
  // Layer, Scene, World, Collection).
  if (object === view.root) return { kind: 'scene' };
  const name = view.blenderObjectName(object);
  return name === null ? null : { kind: 'object', name };
}

// ---- the store ------------------------------------------------------------

export interface BlenderPropertiesState {
  /** The object the context was read around, or null for the scene subject. */
  readonly object: string | null;
  /** The layer collection the context was read around, when the subject is a
   *  collection row; null otherwise. */
  readonly collection: string | null;
  readonly context: BlenderRnaContext | null;
  /** Fetched datablock views, keyed by RNA path. */
  readonly views: ReadonlyMap<string, BlenderRnaView>;
  /** The last refusal the door answered with, verbatim. */
  readonly error: string | null;
  readonly loading: boolean;
}

let state: BlenderPropertiesState = {
  object: null,
  collection: null,
  context: null,
  views: new Map(),
  error: null,
  loading: false,
};
let version = 0;
const listeners = new Set<() => void>();
/** The frame subscription, taken once the document has published its view. */
let frameSubscription: (() => void) | null = null;
/** Paths a fetch is already in flight for — a render must not queue a second. */
const inFlight = new Set<string>();
/** The subject the last context was read for, so a re-render does not refetch. */
let readFor: string | null = null;

function publish(next: Partial<BlenderPropertiesState>, tabsMayHaveChanged = false): void {
  state = { ...state, ...next };
  version += 1;
  for (const listener of [...listeners]) listener();
  // THE TAB RAIL IS THE SECTION LIST, and section matching is the host's
  // composition — which no store of ours can move. This is the one door that
  // re-derives it (`@volter/editor-sdk/host`, `documents.contextChanged`).
  if (tabsMayHaveChanged) editorHost().documents.contextChanged(blenderPresentationDocumentId());
}

export function subscribeBlenderProperties(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function blenderPropertiesVersion(): number {
  return version;
}

export function blenderPropertiesState(): BlenderPropertiesState {
  return state;
}

/** THE ENGINE MOVED: everything read off it is stale. The CONTEXT is
 *  re-read immediately (the tabs may have changed — a modifier was added, a
 *  bone became active); the datablock views are dropped and re-read by
 *  whichever section is still showing them.
 *
 *  Two things call this, and the second is why it is no longer named
 *  `onFrame`: a PRESENTED FRAME, and the RNA door's own version (ruling 3,
 *  2026-09-19 — `blenderRnaVersion`). A write that changes nothing the
 *  presenter draws ships no frame, and before this the rail simply kept the
 *  values it had. */
function onEngineMoved(): void {
  const subject = readFor;
  readFor = null;
  publish({ views: new Map() });
  if (subject !== null) scheduleContextRead(subject);
}

// THE FRAME IS ONE SIGNAL AND THE RNA DOOR IS THE OTHER. This subscription is
// module-level rather than taken beside the frame one, because the RNA door
// exists from the first import while the document's view arrives later — and a
// write made before the first present is exactly the case that went unseen.
subscribeBlenderRna(() => {
  onEngineMoved();
});

/**
 * THE READ NEVER STARTS INSIDE A RENDER. `showBlenderSubject` is called from a
 * tab's `match()`, which the host runs while it is RENDERING the workspace —
 * and the read's first act is to publish `loading`, which is a `setState` in
 * every subscribed component. React said so by name ("Cannot update a
 * component (BlenderPropertiesSection) while rendering a different
 * component"), measured live 2026-09-19. The WANT is recorded
 * synchronously so a second matcher in the same pass does not queue a second
 * read; the read itself runs on the next turn of the loop, outside the render.
 */
let scheduledKey: string | null = null;

function scheduleContextRead(key: string): void {
  if (scheduledKey === key) return;
  scheduledKey = key;
  setTimeout(() => {
    if (scheduledKey !== key) return;
    scheduledKey = null;
    void readContext(key);
  }, 0);
}

/** The read KEY is the subject, spelled so one string round-trips: `''` is the
 *  scene, `collection:<address>` a layer collection, anything else an object
 *  NAME. A collection's address is an RNA path and always contains a `.`, so
 *  the prefix cannot collide with a datablock name. */
function subjectKey(subject: BlenderSubject): string {
  if (subject.kind === 'scene') return '';
  return subject.kind === 'collection' ? `collection:${subject.path}` : subject.name;
}

function watchFrames(): void {
  if (frameSubscription !== null) return;
  const view = presentedView();
  if (view === null) return;
  // A FRAME IS REPORTED TO THE RNA DOOR'S VERSION, not consumed here. The
  // subscription lives in this module because this module is what the document
  // publishes its view to, but the signal belongs to every view over the
  // engine — so it is minted in ONE place (ruling 3) and this module hears its
  // own frame back through `subscribeBlenderRna` above, exactly as the node
  // view and the UV view do.
  frameSubscription = view.subscribeFrames(noteBlenderRnaChanged);
}

async function readContext(key: string): Promise<void> {
  const collection = key.startsWith('collection:') ? key.slice('collection:'.length) : null;
  const object = collection === null && key !== '' ? key : null;
  readFor = key;
  publish({ loading: true, object, collection });
  try {
    const context = await blenderRnaContext(object ?? undefined, collection ?? undefined);
    if (readFor !== key) return;
    // ALWAYS a tab-rail notification, and that is a correction rather than a
    // convenience: the gate a tab matches on is BOTH the subject this context
    // was read for and the tab list, so comparing only the list missed the
    // case that actually happens — selecting the Cube after the document row
    // reads the SAME thirteen tabs for a different subject, the gated tabs'
    // `state.object !== object` went false, and nothing ever said so. Measured
    // live 2026-09-19: Collection/Modifiers/Particles/Object Data/Material
    // disappeared on the first selection and only came back on a re-select.
    publish({ context, loading: false, error: null }, true);
  } catch (error) {
    if (readFor !== key) return;
    publish({ context: null, loading: false, error: describe(error) }, true);
  }
}

/**
 * WHAT THE PANEL IS LOOKING AT — called by every tab's `match()` on every
 * composition, and by the section bodies. Idempotent: a repeat of the subject
 * already read (or already queued) does nothing, and the read it does start
 * runs outside the render pass (see {@link scheduleContextRead}).
 */
export function showBlenderSubject(subject: BlenderSubject): void {
  if (!blenderSessionStarted()) return;
  watchFrames();
  const key = subjectKey(subject);
  if (readFor === key) return;
  scheduleContextRead(key);
}

/** The view of one datablock, fetching it on first ask. `undefined` means
 *  "not read yet", which is what a section renders as its loading state. */
export function blenderRnaViewFor(path: string): BlenderRnaView | undefined {
  const held = state.views.get(path);
  if (held !== undefined) return held;
  if (inFlight.has(path) || !blenderSessionStarted()) return undefined;
  inFlight.add(path);
  void blenderRna(path)
    .then((view) => {
      inFlight.delete(path);
      if (view === null) return;
      const views = new Map(state.views);
      views.set(path, view);
      publish({ views, error: null });
    })
    .catch((error: unknown) => {
      inFlight.delete(path);
      publish({ error: describe(error) });
    });
  return undefined;
}

/**
 * WRITE ONE PROPERTY. The engine refuses a read-only one by name and this
 * surfaces that refusal verbatim; a successful write presents, and the frame
 * that comes back re-reads everything through {@link onEngineMoved}, so the field
 * shows the value the ENGINE holds rather than the one that was typed.
 */
export async function writeBlenderRnaProperty(
  path: string,
  property: string,
  value: unknown,
  index?: number,
): Promise<boolean> {
  try {
    await blenderRnaSet(path, property, value, index);
    // The write presented; a re-read of this one datablock closes the loop
    // even if the frame listener has not been taken yet.
    const views = new Map(state.views);
    views.delete(path);
    publish({ views, error: null });
    return true;
  } catch (error) {
    publish({ error: describe(error) });
    return false;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
