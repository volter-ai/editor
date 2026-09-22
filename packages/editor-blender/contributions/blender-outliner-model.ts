/**
 * WHAT THE OUTLINER IS LOOKING AT — the page-side half of the TREE door
 * (WORK.md §Blender in the tab is Blender, "Inspection parity", I3).
 *
 * The same shape as `blender-properties-model.ts`, and deliberately: a plain
 * React-free store with `subscribe` / `version` / `state`, one read driven by
 * the thing that displays it, re-read on every PRESENT because every mutation
 * presents (`session.py::dispatch`) and a frame is the tab's one signal that
 * what it is showing is stale.
 *
 * WHAT IT IS NOT. It holds no tree of its own making: `rows` is the engine's
 * answer, kept verbatim, and the only thing this module derives is the two
 * indexes a hierarchy provider needs — a row by id, and a row's parent — so
 * `HierarchyProvider.node(id)` is a lookup rather than a walk.
 */

import type { BlenderOutlinerRow, BlenderOutlinerTree } from '@volter/blender-engine/browser/rna';
import { editorHost } from '@volter/editor-sdk/host';
import type * as THREE from 'three';
import {
  blenderOutliner,
  blenderOutlinerSet,
  blenderPresentationDocumentId,
  blenderSessionStarted,
} from '../host/blender-runtime-host';

/** The presented view, as much of it as this module reads — structurally
 *  typed for the same reason `blender-properties-model.ts` narrows it: the
 *  document that published it and the reader are two modules meeting over one
 *  object, and `@volter/editor-blender` holds no host import. */
interface PresentedView {
  readonly root: THREE.Object3D;
  subscribeFrames(listener: () => void): () => void;
  objectForBlenderName(name: string): THREE.Object3D | null;
  /** The other direction, and the one a WRITE needs: which Blender object
   *  this three object IS, by identity in the frame's own table — never
   *  `object.name`. The transform gizmo addresses `bpy.data.objects[…]` with
   *  it (`blender-outliner-authoring.ts`). */
  blenderObjectName(object: THREE.Object3D): string | null;
  /** BLENDER'S SELECTION, off the frame — see
   *  `BlenderRuntimeView.blenderSelection`. The engine is the truth and this
   *  is the read; {@link blenderEngineSelection} is the door. */
  blenderSelection(): { readonly selected: readonly string[]; readonly active: string | null };
  /** Where `vgai.stage.mode` comes from — see `BlenderRuntimeView.stageMode`. */
  setStageMode(mode: string | null): void;
}

const isPresentedView = (value: unknown): value is PresentedView =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as PresentedView).subscribeFrames === 'function' &&
  typeof (value as PresentedView).objectForBlenderName === 'function' &&
  typeof (value as PresentedView).blenderObjectName === 'function' &&
  typeof (value as PresentedView).blenderSelection === 'function' &&
  typeof (value as PresentedView).setStageMode === 'function';

export function blenderPresentedView(): PresentedView | null {
  const published = editorHost().documents.context(blenderPresentationDocumentId());
  return isPresentedView(published) ? published : null;
}

/**
 * WHAT BLENDER HAS SELECTED, off the last frame — the one read behind the
 * Model document's selection, and the reason this module has no selection
 * state of its own.
 *
 * A frame arrives after EVERY mutation (`session.py::dispatch` presents after
 * `execute`, `rna-set` and `outliner-set`), so this answer moves the moment
 * the engine's does: a `bpy.ops.mesh.primitive_torus_add()` typed by an agent
 * leaves the torus selected and active in Blender, the present ships that,
 * and the outline in this editor follows without anyone telling it to.
 * Before the first frame it is empty, which is the honest answer for a
 * document whose engine has not presented yet.
 */
export function blenderEngineSelection(): {
  readonly selected: readonly string[];
  readonly active: string | null;
} {
  return blenderPresentedView()?.blenderSelection() ?? { selected: [], active: null };
}

export interface BlenderOutlinerState {
  readonly tree: BlenderOutlinerTree | null;
  /** Every row by `id`, and every row's parent id — the two indexes a
   *  hierarchy provider needs, rebuilt whenever the tree is replaced. */
  readonly byId: ReadonlyMap<string, BlenderOutlinerRow>;
  readonly parentOf: ReadonlyMap<string, string | null>;
  readonly error: string | null;
  readonly loading: boolean;
}

const EMPTY: BlenderOutlinerState = {
  tree: null,
  byId: new Map(),
  parentOf: new Map(),
  error: null,
  loading: false,
};

let state: BlenderOutlinerState = EMPTY;
let version = 0;
const listeners = new Set<() => void>();
let frameSubscription: (() => void) | null = null;
/** The selection the last read was made for, so a re-render does not refetch. */
let readFor: string | null = null;
/** THE SELECTION THE TREE IS OF, which outlives {@link readFor} (see
 *  {@link onFrame}). Empty until the first read; a frame before then re-reads
 *  the whole tree with no selection, which is the right answer for it. */
let lastSelectionKey = '';
let scheduled: string | null = null;

function index(tree: BlenderOutlinerTree | null): Pick<BlenderOutlinerState, 'byId' | 'parentOf'> {
  const byId = new Map<string, BlenderOutlinerRow>();
  const parentOf = new Map<string, string | null>();
  const walk = (row: BlenderOutlinerRow, parent: string | null): void => {
    byId.set(row.id, row);
    parentOf.set(row.id, parent);
    for (const child of row.children) walk(child, row.id);
  };
  for (const row of tree?.rows ?? []) walk(row, null);
  return { byId, parentOf };
}

function publish(next: Partial<BlenderOutlinerState>): void {
  state = { ...state, ...next };
  version += 1;
  for (const listener of [...listeners]) listener();
}

export function subscribeBlenderOutliner(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function blenderOutlinerVersion(): number {
  return version;
}

export function blenderOutlinerState(): BlenderOutlinerState {
  return state;
}

/**
 * THE READ NEVER STARTS INSIDE A RENDER, and that is I1's correction applied
 * here rather than rediscovered: the hierarchy asks for the tree from inside
 * React's render pass, and the read's first act is to publish `loading`, which
 * is a `setState` in every subscriber ("Cannot update a component … while
 * rendering a different component"). The WANT is recorded synchronously so a
 * second ask in the same pass queues nothing; the read runs on the next turn.
 */
function scheduleRead(key: string): void {
  if (scheduled === key) return;
  scheduled = key;
  setTimeout(() => {
    if (scheduled !== key) return;
    scheduled = null;
    void startRead(key === '' ? [] : key.split('\u0000'));
  }, 0);
}

/**
 * WHICH ANSWER WINS — a SEQUENCE, not the selection key.
 *
 * Two reads can be in flight at once: a frame arrives and schedules one
 * (`onFrame`), and a structural verb asks for one of its own
 * ({@link refreshBlenderOutliner}). Staleness used to be judged by comparing
 * `readFor` against the read's own key, which answers a different question —
 * "is this still the selection anyone wants?" — and gets the ordering wrong
 * the moment the two reads carry DIFFERENT keys: whichever started last owns
 * `readFor`, so the other one's answer is thrown away even when it is newer.
 *
 * MEASURED 2026-09-21: Add ▸ Mesh ▸ UV Sphere created the sphere, the verb's
 * own read was discarded by that comparison, and the verb then looked for the
 * new row in the tree from BEFORE the add and found none — so nothing was
 * selected. The frame's read landed a moment later and the row appeared, which
 * is why the defect looked like "selection only".
 *
 * The sequence says exactly what the guard means: the LAST READ STARTED is the
 * one whose answer the panel shows. {@link readFor} keeps its other job, which
 * is idempotence for {@link showBlenderOutliner}.
 */
let readSeq = 0;
/** The read most recently started, so {@link refreshBlenderOutliner} can wait
 *  for whichever one WINS rather than only for its own. */
let latestRead: Promise<void> = Promise.resolve();

function startRead(selected: readonly string[]): Promise<void> {
  const done = read(selected);
  latestRead = done;
  return done;
}

async function read(selected: readonly string[]): Promise<void> {
  const key = selected.join('\u0000');
  const seq = ++readSeq;
  readFor = key;
  lastSelectionKey = key;
  publish({ loading: true });
  try {
    const tree = await blenderOutliner(selected);
    if (seq !== readSeq) return;
    // THE MODE RIDES WITH THE TREE, because the tree is what needs it (pose
    // rows exist only in pose mode) and because the read happens anyway.
    // `vgai.stage.mode` is then the document's own published context — see
    // `BlenderRuntimeView.stageMode`.
    blenderPresentedView()?.setStageMode(tree?.mode ?? null);
    publish({ tree, ...index(tree), loading: false, error: null });
  } catch (error) {
    if (seq !== readSeq) return;
    publish({ loading: false, error: describe(error) });
  }
}

/**
 * A frame arrived: the tree the engine holds may be a different tree (an object
 * added, a modifier stacked, a collection excluded). Re-read it.
 *
 * IT RE-READS THE LAST SELECTION, NOT `readFor`, and that distinction is the
 * second half of the defect above: `readFor` is the IDEMPOTENCE marker and a
 * successful column write clears it deliberately (the value it holds is now
 * stale), so a frame arriving after one found nothing to re-read and the eye
 * it had just written never moved. The selection the tree was last read for is
 * its own fact and outlives both.
 */
function onFrame(): void {
  readFor = null;
  scheduleRead(lastSelectionKey);
  for (const listener of [...frameListeners]) listener();
}

/**
 * A FRAME ARRIVED — for a reader that needs the frame itself rather than the
 * tree the frame makes stale.
 *
 * {@link blenderEngineSelection} is the one such reader: a present that
 * changes nothing structural still carries a new `selected`/`active`, and the
 * tree read above would answer the same rows. It rides THIS module's frame
 * subscription rather than taking a second one, because `watchFrames` already
 * owns the "the document may not have published its view yet" retry and a
 * second copy of that is how two subscriptions drift.
 */
const frameListeners = new Set<() => void>();

export function onBlenderFrame(listener: () => void): () => void {
  watchFrames();
  frameListeners.add(listener);
  return () => {
    frameListeners.delete(listener);
  };
}

/**
 * TAKE THE FRAME SUBSCRIPTION, AND WAIT FOR THE DOCUMENT IF IT IS NOT THERE
 * YET — which is the shape of the defect the I3 walk found: the hierarchy asks
 * for the tree the moment the panel first renders, and the Model document
 * publishes its context on its own mount, so the FIRST ask can legitimately
 * find no view. Retrying "next time someone asks" is not enough, because
 * {@link showBlenderOutliner} is idempotent by selection: nothing asks again
 * until the selection moves, so a scene mutated by a script updated the
 * viewport and left the Outliner showing the old tree for good (measured
 * 2026-09-19 — `outliner_set` hid an object and its row's eye never moved).
 * `documents.waitForContext` is the door for exactly this.
 */
let awaitingView = false;
/** WHICH view the live {@link frameSubscription} is against. A document that
 *  remounts, or an engine restarted with `blender-start --fresh`, PUBLISHES A
 *  NEW `BlenderRuntimeView`; the old one's `subscribeFrames` set goes with it,
 *  so a subscription held against it is a subscription to nothing and every
 *  later present reaches no reader — the tree, and now the selection, freeze
 *  on what they last read while the viewport goes on drawing the new frames.
 *  Holding the view this subscription belongs to is what makes the identity
 *  check below possible; `frameSubscription !== null` alone cannot see it. */
let subscribedView: unknown = null;

function watchFrames(): void {
  const current = blenderPresentedView();
  if (frameSubscription !== null && subscribedView === current) return;
  if (frameSubscription !== null) {
    frameSubscription();
    frameSubscription = null;
    subscribedView = null;
  }
  const view = current;
  if (view !== null) {
    frameSubscription = view.subscribeFrames(onFrame);
    subscribedView = view;
    return;
  }
  if (awaitingView) return;
  awaitingView = true;
  void editorHost()
    .documents.waitForContext(blenderPresentationDocumentId())
    .then(() => {
      awaitingView = false;
      watchFrames();
    })
    .catch(() => {
      awaitingView = false;
    });
}

/**
 * WHAT THE OUTLINER IS SHOWING — called by the hierarchy provider on every
 * read. Idempotent: a repeat of a selection already read (or queued) does
 * nothing, and the read it does start runs outside the render pass.
 */
export function showBlenderOutliner(selected: readonly string[]): void {
  if (!blenderSessionStarted()) return;
  watchFrames();
  const key = [...selected].sort().join('\u0000');
  if (readFor === key) return;
  scheduleRead(key);
}

/**
 * RE-READ THE TREE NOW, AND ANSWER WHEN IT HAS LANDED — the awaited half of
 * {@link showBlenderOutliner}, for a caller that has just CHANGED the tree and
 * must address a row that did not exist a moment ago.
 *
 * The structural verbs are the callers (`blender-outliner-authoring.ts`'s
 * `StructureProvider`): `bpy.ops.mesh.primitive_uv_sphere_add()` returns, the
 * present that follows ships a frame, {@link onFrame} schedules a read on the
 * next turn — and the verb's contract is to hand its caller the new row's id
 * and select it, which it cannot do against the tree from before the add. So
 * it asks for the read itself and awaits it, instead of polling for a row to
 * appear.
 *
 * It is the SAME read the panel drives, not a second one: `readFor` and
 * `lastSelectionKey` move with it, so the frame's own scheduled read finds the
 * selection already current and does nothing.
 */
export async function refreshBlenderOutliner(selected: readonly string[]): Promise<void> {
  if (!blenderSessionStarted()) return;
  // Any read already QUEUED is superseded by this one before it starts.
  scheduled = null;
  let awaited = startRead([...selected].sort());
  // AND IT WAITS FOR WHICHEVER READ WINS, not merely for its own: a frame's
  // read can start WHILE this one is in flight and take the sequence, in which
  // case this one's answer is dropped and the caller must still not look at
  // the tree until the winner has published (see {@link readSeq}).
  //
  // THE CHECK IS AFTER THE AWAIT, not before it, and that is the whole
  // mechanism — a pre-test loop finds nothing newer at entry (the frame's read
  // is scheduled on a later turn), exits at once, and returns having published
  // nothing. Measured 2026-09-21: the first cut of this loop was pre-test, and
  // Add ▸ Mesh ▸ Monkey still resolved its new row against the tree from
  // before the add. It ends because each turn follows a read that started
  // strictly later than the last.
  for (;;) {
    await awaited;
    if (latestRead === awaited) return;
    awaited = latestRead;
  }
}

/**
 * WRITE ONE RESTRICTION COLUMN. The engine refuses a column it draws on no row
 * of that type BY NAME and this surfaces the refusal verbatim; a successful
 * write presents, and the frame that comes back re-reads the whole tree
 * through {@link onFrame} — so the eye shows the state the ENGINE holds rather
 * than the one that was clicked.
 */
export async function writeBlenderOutlinerColumn(
  path: string,
  column: string,
  value: boolean,
): Promise<boolean> {
  try {
    await blenderOutlinerSet(path, column, value);
    // RE-READ THE TREE HERE, rather than waiting for the frame the write
    // presented. A present is not a reliable signal for a COLUMN: `hide_render`
    // changes nothing the presenter draws, so the frame is identical and the
    // session ships nothing — measured 2026-09-19, the render camera toggled in
    // the engine and the row never moved. The write's own outcome is what the
    // row has to show, so the write asks for it.
    readFor = null;
    scheduleRead(lastSelectionKey);
    return true;
  } catch (error) {
    publish({ error: describe(error) });
    return false;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
