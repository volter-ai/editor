import type { Container } from 'pixi.js';

/**
 * AuthoringAdapter-2D — the Pixi analog of the editor AuthoringAdapter /
 * ThreeAuthoringAdapter, implemented DIRECTLY over a live PixiJS display tree
 * (no fabricated document — the anti-shim rule). Used by the editor to
 * inspect + edit Pixi display-tree entities (first-party OR an ingested unmodified game),
 * with stable structural-path ids so edits re-bind after the tree rebuilds.
 */

export interface EditorNode2D {
  id: string;
  label: string;
  kind: 'sprite' | 'animatedsprite' | 'text' | 'container' | string;
  parentId: string | null;
  childIds: string[];
}

export interface Transform2DValue {
  position: [number, number];
  rotation: number;
  scale: [number, number];
}

export interface Property2D {
  path: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'vec2' | 'color';
  value: unknown;
}

/** An in-memory edit overlay keyed by structural-path id (2D). */
export interface Override2D {
  label?: string;
  alpha?: number;
  position?: [number, number];
  rotation?: number;
  scale?: [number, number];
  tint?: number;
  visible?: boolean;
}
export type Overlay2D = Record<string, Override2D>;

function kindOf(o: Container): string {
  const ctor = o.constructor?.name?.toLowerCase() ?? 'container';
  if (ctor.includes('animatedsprite')) return 'animatedsprite';
  if (ctor.includes('nineslice')) return 'nineslicesprite';
  if (ctor.includes('tiling')) return 'tilingsprite';
  if (ctor.includes('sprite')) return 'sprite';
  if (ctor.includes('text')) return 'text';
  if (ctor.includes('graphics')) return 'graphics';
  return 'container';
}

/**
 * Hierarchy row text — the Pixi sibling of three's `object.name || object.type`.
 *
 * Authored `.label` first. Then a GAME name: a field, a bag key, or a class
 * that owns this `.view`. Stock Pixi types (`Sprite`, `Graphics`, `_Container`)
 * are not names — they used to win and hide every owner. Then the texture
 * alias (`Sprite.from('satellite')`). Then a remaining game constructor
 * (`TitleScreen`, `PrimaryButton`). Bare `new Container()` still reads as
 * `container` — plus its child count when it has children, because ten
 * unnamed siblings that all read `container` name nothing at all; the
 * editor loads games that never labelled anything and the panel still has
 * to be legible. The count is DISPLAY only (row ids keep using raw
 * `.label`) and rides only this last fallthrough: a row that earned a real
 * name is never decorated.
 */
function displayLabel(o: Container): string {
  const authored = authoredLabel(o);
  if (authored) return authored;
  const owner = viewOwnerLabel(o);
  if (owner) return owner;
  const asset = textureLabel(o);
  if (asset) return asset;
  const ctor = usefulCtorName(o);
  if (ctor) return ctor;
  const kind = kindOf(o);
  const childCount = o.children?.length ?? 0;
  return childCount > 0 ? `${kind} (${childCount})` : kind;
}

/**
 * Pixi v8 stamps Sprite/Graphics `.label` with the class name. That is not an
 * authored name.
 *
 * The minified-constructor guard is about the SAME leak: a shipped build's
 * `_Container` becomes `e`, and that `e` is a class name wearing a label's
 * clothes. It is only that leak when the label IS this object's own class
 * name — `container.label = 'fx'` (or 'ui', 'hp') is a name the game
 * actually authored, and a game gets to be terse.
 */
function authoredLabel(o: Container): string | undefined {
  const authored = o.label?.trim();
  if (!authored) return undefined;
  if (isMinifiedCtor(authored) && authored !== o.constructor?.name) return authored;
  if (isGenericPixiCtor(authored)) return undefined;
  return authored;
}

function isMinifiedCtor(name: string): boolean {
  return name.length <= 2 && name === name.toLowerCase();
}

/** Pixi's own display types. The shipped build prefixes them `_`. */
const STOCK_PIXI_CTOR = new Set([
  'container',
  'displayobject',
  'sprite',
  'animatedsprite',
  'nineslicesprite',
  'tilingsprite',
  'text',
  'bitmaptext',
  'htmltext',
  'graphics',
  'mesh',
]);

function isGenericPixiCtor(name: string): boolean {
  if (isMinifiedCtor(name) || name === 'Object' || name === 'Function') return true;
  return STOCK_PIXI_CTOR.has(name.replace(/^_+/, '').toLowerCase());
}

function textureLabel(object: Container): string | undefined {
  const texture = (object as Container & { texture?: { label?: string } }).texture;
  const raw = texture?.label?.trim();
  if (!raw || /^(_?texture)?(empty|white)$/i.test(raw)) return undefined;
  const leaf = raw.split('/').pop() ?? raw;
  return leaf.replace(/\.[a-z0-9]+$/i, '') || undefined;
}

function usefulCtorName(value: object): string | undefined {
  const name = value.constructor?.name;
  if (!name || isGenericPixiCtor(name)) return undefined;
  return name.replace(/^_+/, '') || undefined;
}

function fieldLabel(key: string): string | undefined {
  const trimmed = key.replace(/^_+/, '');
  return trimmed.length > 0 ? trimmed : undefined;
}

function isPixiDisplay(value: object): boolean {
  return (
    'addChild' in value &&
    typeof (value as { addChild?: unknown }).addChild === 'function' &&
    'children' in value
  );
}

/**
 * Bubbo-style owner, identity only. TitleScreen keeps `this._cannon` and
 * parents `this._cannon.view`. A grouping node is the field itself
 * (`this._bottomAnimContainer`). A pool or atlas lives in a bag — Array,
 * Map, Set, or an object literal (`_decor[]`, `allSystems`, `_parts[id]`).
 * Scan each ancestor's own fields first — a flood walk of Pixi internals
 * never reached `_cannon` inside the budget.
 */
function viewOwnerLabel(view: Container): string | undefined {
  const search: OwnerSearch = { seen: new WeakSet<object>(), budget: OWNER_SEARCH_BUDGET };
  let host: unknown = view.parent;
  for (let hops = 0; hops < 8 && host && typeof host === 'object'; hops++) {
    if (search.budget <= 0) return undefined;
    const found = labelFromHolder(host, view, search) ?? findHeldOwner(host, view, 2, search);
    if (found) return found;
    host = (host as { parent?: unknown }).parent;
  }
  return undefined;
}

/**
 * THE CEILING ON ONE NODE'S OWNER HUNT — what keeps a hierarchy read LINEAR in
 * the size of the tree instead of quadratic in it.
 *
 * The hunt below is a search of the GAME's object graph, and a game's object
 * graph is small: `this._cannon`, `allSystems.get('hud')`, `_decor[3]` are all
 * found within a few dozen examinations. What is not small is anything the
 * search can leak into — Pixi's own live render graph is the measured one, and
 * naming a key blacklist is a fix for the leak you already found, not for the
 * class. So every examination is charged against this budget and the search
 * simply gives up when it runs out: the node then falls through to its texture
 * alias / constructor / kind name, which is the same honest answer it gets
 * today whenever the hunt finds nothing.
 *
 * MEASURED (2026-08-20, `packages/editor/scripts/scale-harness`): entering play
 * on a 20 000-node `@pixi/react` world blocked the main thread for 199.5
 * SECONDS in one synchronous run, 69% of all profiler samples inside this
 * search, because `parentRenderGroup` reaches an array of every node in the
 * tree and the search walked it once per unlabeled node. `vgai play`,
 * `screenshot` and `stop` all timed out against a tab that was heartbeating
 * normally the whole time.
 */
const OWNER_SEARCH_BUDGET = 2_000;

/** One node's owner hunt: what it has already looked at, and what it has left. */
interface OwnerSearch {
  readonly seen: WeakSet<object>;
  /** Counts DOWN. Zero ends the hunt for this node, wherever it has reached. */
  budget: number;
}

/** Charge one examination. `false` means the hunt is over. */
function spend(search: OwnerSearch): boolean {
  if (search.budget <= 0) return false;
  search.budget -= 1;
  return true;
}

function isGameFieldKey(key: string): boolean {
  // Skip display-list indices (`0`, `1`) and Pixi internals (`children`).
  // The membership test is on the UNDERSCORED-STRIPPED key because that is how
  // Pixi v8 spells most of them (`_position`, `_bounds`, `_texture`), and a
  // set listing the bare names was silently matching none of those.
  if (!/^_?[A-Za-z][A-Za-zA-Z0-9]*$/.test(key)) return false;
  return !PIXI_INTERNAL_KEY.has(key.replace(/^_+/, ''));
}

/**
 * Field names that belong to Pixi (or to its EventEmitter base), never to the
 * game. Read off a live `pixi.js` v8 `Container`/`Sprite`'s own keys, so this
 * is a transcription rather than a guess — but it is the OPTIMIZATION, not the
 * correctness boundary: {@link OWNER_SEARCH_BUDGET} is what bounds the search
 * on a Pixi version whose internals this list has never heard of. Spending the
 * budget on plausible game fields instead of on the render graph is what keeps
 * the heuristic's hit rate while it is bounded.
 *
 * `view` is deliberately absent: `.view` is the very field the hunt is looking
 * for.
 */
const PIXI_INTERNAL_KEY = new Set([
  'parent',
  'children',
  'transform',
  'position',
  'origin',
  'scale',
  'pivot',
  'skew',
  'anchor',
  'worldTransform',
  'localTransform',
  'groupTransform',
  'relativeGroupTransform',
  // The render graph — the measured leak. `parentRenderGroup` is on every
  // container once a world has rendered and reaches every node in the tree.
  'renderGroup',
  'parentRenderGroup',
  'parentRenderGroupIndex',
  'parentRenderLayer',
  'relativeRenderGroupDepth',
  'renderPipeId',
  'instructionSet',
  'childrenToUpdate',
  'childrenRenderablesToUpdate',
  'effects',
  'filters',
  'mask',
  'bounds',
  'boundsArea',
  'visualBounds',
  'gpuData',
  'texture',
  'events',
  'eventsCount',
  'updateFlags',
]);

function labelFromHolder(host: object, view: Container, search: OwnerSearch): string | undefined {
  if (search.seen.has(host)) return undefined;
  search.seen.add(host);
  const asBag = nameInBag(host, view, undefined, search);
  if (asBag) return asBag;
  for (const [key, value] of Object.entries(host as Record<string, unknown>)) {
    if (!spend(search)) return undefined;
    if (!isGameFieldKey(key)) continue;
    const named = nameIfHoldsView(host, key, value, view);
    if (named) return named;
    const nested = nameInBag(value, view, key, search);
    if (nested) return nested;
  }
  return undefined;
}

function nameInBag(
  value: unknown,
  view: Container,
  fieldKey: string | undefined,
  search: OwnerSearch,
): string | undefined {
  const entries = bagEntries(value);
  if (!entries) return undefined;
  for (const [itemKey, item] of entries) {
    if (!spend(search)) return undefined;
    const named = nameBagItem(value, item, usableBagKey(itemKey) ?? fieldKey, view, search);
    if (named) return named;
  }
  return undefined;
}

function nameBagItem(
  bag: unknown,
  item: unknown,
  key: string | undefined,
  view: Container,
  search: OwnerSearch,
): string | undefined {
  if (key) {
    const named = nameIfHoldsView(
      item && typeof item === 'object' ? item : (bag as object),
      key,
      item,
      view,
    );
    if (named) return named;
  } else if (item && typeof item === 'object' && (item as { view?: unknown }).view === view) {
    const named = usefulCtorName(item);
    if (named) return named;
  }
  if (item && typeof item === 'object' && !isPixiDisplay(item)) {
    return labelFromHolder(item, view, search);
  }
  return undefined;
}

function usableBagKey(key: string): string | undefined {
  if (!key || /^\d+$/.test(key)) return undefined;
  return isGameFieldKey(key) || key.includes('-') ? (fieldLabel(key) ?? key) : undefined;
}

function* indexedBagEntries(value: ArrayLike<unknown>): Generator<[string, unknown]> {
  for (let index = 0; index < value.length; index++) yield [String(index), value[index]];
}

function* mapBagEntries(value: Map<unknown, unknown>): Generator<[string, unknown]> {
  for (const [key, item] of value.entries()) yield [String(key), item];
}

function* setBagEntries(value: Set<unknown>): Generator<[string, unknown]> {
  let index = 0;
  for (const item of value) {
    yield [String(index), item];
    index += 1;
  }
}

/**
 * A bag's entries, LAZILY.
 *
 * Lazy because the caller is budgeted ({@link OWNER_SEARCH_BUDGET}) and must be
 * able to stop: materializing the pairs first made a 20 000-element array cost
 * 20 000 allocations before the first one was even looked at, which is a cost
 * no budget above it can decline.
 */
function bagEntries(value: unknown): Iterable<readonly [string, unknown]> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  // Game arrays are allowed to be exotic subclasses. Do not dispatch through
  // their overridable `map`: one shipped Pixi game returns its elements rather
  // than `[key, value]` pairs there, which made hierarchy labeling throw while
  // destructuring the result. The authoring seam treats game objects as
  // untrusted observations, so normalize with indexed reads of our own.
  if (Array.isArray(value)) return indexedBagEntries(value as ArrayLike<unknown>);
  if (value instanceof Map) return mapBagEntries(value);
  if (value instanceof Set) return setBagEntries(value);
  if (Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  return Object.entries(value as Record<string, unknown>);
}

function nameIfHoldsView(
  host: object,
  key: string,
  value: unknown,
  view: Container,
): string | undefined {
  if (value === view) {
    const field = fieldLabel(key);
    if (field && field.toLowerCase() !== 'view') {
      return usefulCtorName(value as object) ?? field;
    }
    return usefulCtorName(value as object) ?? usefulCtorName(host) ?? field;
  }
  if (value && typeof value === 'object' && (value as { view?: unknown }).view === view) {
    return usefulCtorName(value) ?? fieldLabel(key);
  }
  return undefined;
}

function findHeldOwner(
  held: object,
  view: Container,
  depth: number,
  search: OwnerSearch,
): string | undefined {
  const direct = labelFromHolder(held, view, search);
  if (direct) return direct;
  if (depth <= 0) return undefined;
  // BY KEY, exactly like `labelFromHolder`'s own scan. Iterating `Object.values`
  // here was the leak that made a hierarchy read quadratic: `parentRenderGroup`
  // sits on EVERY container once a world has rendered, and descending into it
  // reaches `childrenToUpdate[depth].list` — an array of every node in the
  // tree — so the search for one node's owner walked the whole tree, for every
  // unlabeled node. `isGameFieldKey` already knows which keys belong to Pixi
  // rather than to the game; this scan simply has to ask it too.
  for (const [key, value] of Object.entries(held as Record<string, unknown>)) {
    if (!spend(search)) return undefined;
    if (!isGameFieldKey(key)) continue;
    if (!value || typeof value !== 'object' || isPixiDisplay(value)) continue;
    const found = findHeldOwner(value, view, depth - 1, search);
    if (found) return found;
  }
  return undefined;
}

/**
 * WHERE A ROW'S ID COMES FROM — the identity axis of the canvas authoring
 * surface.
 *
 * The tree walk is the same whatever authored the tree; what differs is
 * whether the display objects carry an authored address. A first-party
 * `@pixi/react` world's containers do (the `data-oid` the editor's transform
 * stamps, which the reconciler lands on the instance), and keying on it is
 * what makes selection survive a remount. A tree the editor did NOT author has
 * no such address, so its ids are structural paths — stable for as long as the
 * tree's shape is, which is the best that graph can honestly offer.
 *
 * Both are the SAME adapter over the SAME surface; only this collaborator
 * changes. {@link STRUCTURAL_CANVAS_IDENTITY} is the default.
 */
export interface CanvasIdentity {
  /** Called once at the start of every walk — where an implementation that
   *  disambiguates repeats (one JSX element rendered ninety times) resets its
   *  per-walk counters. */
  beginWalk?(): void;
  /** The id for one display object at one position in the tree. */
  idFor(object: Container, path: readonly number[]): string;
}

/** Deterministic structural-path ids: `w2d:<path>:<kind>:<label>`. */
export const STRUCTURAL_CANVAS_IDENTITY: CanvasIdentity = {
  idFor: (object, path) => `w2d:${path.join('/')}:${kindOf(object)}:${object.label ?? ''}`,
};

/** One remembered row name, with every input it was derived from. */
interface NameMemo {
  readonly label: string;
  readonly kind: string;
  readonly parent: Container | null;
  readonly type: unknown;
  readonly own: string | null;
  readonly texture: unknown;
  readonly childCount: number;
}

export class AuthoringAdapter2D {
  private readonly byId = new Map<string, Container>();
  private overlay: Overlay2D = {};
  private dirty = false;
  private readonly identity: CanvasIdentity;
  /**
   * THE ROW-NAME MEMO — what makes a hierarchy read linear instead of a
   * reflective flood walk per node per read.
   *
   * {@link displayLabel} is not a field read. For anything the game did not
   * label itself it calls `viewOwnerLabel`, which climbs eight ancestors and
   * reflects over each one's own fields, its bags, and two levels of whatever
   * those hold — a deliberate search for the game object that owns this
   * `.view`. Measured 2026-08-20 on a 1822-node `@pixi/react` canvas world,
   * with the tab VISIBLE and the world rendering, one full projection walk
   * cost ~800ms, essentially all of it here: once a world has rendered, the
   * ancestors' own fields include Pixi's live render-group graph, so the
   * search walks that too and finds nothing, every time, for every node.
   *
   * And it was asked four times per node per derivation — the projection
   * walk, the conformance probe and the hierarchy facet each re-ask — which
   * is how a status snapshot reached 115,433 `toNode` calls on one tree.
   *
   * ## What invalidates a remembered name
   *
   * Every input the derivation reads OFF THE OBJECT: its authored `.label`,
   * its class, its texture, its parent, and how many children it has. Any of
   * those changing re-derives — so a rename, a reparent, a retexture, and a
   * sibling added or removed are all seen. What a remembered name does NOT
   * re-notice is a game reassigning an ANCESTOR's field to point at this view
   * after the fact, with the tree otherwise untouched; `viewOwnerLabel` is a
   * naming heuristic, not a verdict, and the alternative is the 800ms walk
   * above on every read of the tree.
   */
  private readonly names = new WeakMap<Container, NameMemo>();

  constructor(
    private readonly root: Container,
    opts: { overlay?: Overlay2D; identity?: CanvasIdentity } = {},
  ) {
    if (opts.overlay) this.overlay = opts.overlay;
    this.identity = opts.identity ?? STRUCTURAL_CANVAS_IDENTITY;
    this.refresh();
  }

  /**
   * Walk the live tree assigning deterministic structural-path ids.
   *
   * Separate from {@link refresh} because the two are wanted at different rates: the ids have to be
   * current whenever the tree is READ (a world that mounts its content asynchronously — a
   * translated port waiting on its resources, anything behind Suspense — commits real nodes after
   * the adapter was handed its root, and an unindexed node is one the hierarchy cannot name), while
   * re-applying the edit overlay is a WRITE and must happen only when something asked for it.
   */
  reindex(): { count: number; sprites: number } {
    this.byId.clear();
    this.identity.beginWalk?.();
    let count = 0;
    let sprites = 0;
    const visit = (o: Container, path: readonly number[]): void => {
      const id = this.identity.idFor(o, path);
      (o as Container & { __authId?: string }).__authId = id;
      this.byId.set(id, o);
      count++;
      if (kindOf(o).includes('sprite')) sprites++;
      o.children.forEach((c, i) => {
        visit(c as Container, [...path, i]);
      });
    };
    this.root.children.forEach((c, i) => {
      visit(c as Container, [i]);
    });
    return { count, sprites };
  }

  /** {@link reindex}, then reapply every saved overlay edit to the live tree. */
  refresh(): { count: number; sprites: number } {
    const counts = this.reindex();
    for (const [id, ov] of Object.entries(this.overlay)) this.applyOverride(id, ov);
    return counts;
  }

  roots(): EditorNode2D[] {
    return this.root.children.map((c) => this.toNode(c as Container));
  }

  node(id: string): EditorNode2D | null {
    const o = this.byId.get(id);
    return o ? this.toNode(o) : null;
  }

  displayObject(id: string): Container | null {
    return this.byId.get(id) ?? null;
  }

  /** This object's row name, derived once and remembered until one of the
   *  inputs it is derived from changes. See {@link names}. */
  private nameOf(o: Container): NameMemo {
    const cached = this.names.get(o);
    const parent = o.parent ?? null;
    const type = o.constructor;
    const own = o.label ?? null;
    const texture = (o as Container & { texture?: unknown }).texture ?? null;
    const childCount = o.children?.length ?? 0;
    if (
      cached &&
      cached.parent === parent &&
      cached.type === type &&
      cached.own === own &&
      cached.texture === texture &&
      cached.childCount === childCount
    ) {
      return cached;
    }
    const derived: NameMemo = {
      label: displayLabel(o),
      kind: kindOf(o),
      parent,
      type,
      own,
      texture,
      childCount,
    };
    this.names.set(o, derived);
    return derived;
  }

  private toNode(o: Container): EditorNode2D {
    const self = o as Container & { __authId?: string };
    const { label, kind } = this.nameOf(o);
    return {
      id: self.__authId ?? '',
      label,
      kind,
      parentId: (o.parent as (Container & { __authId?: string }) | null)?.__authId ?? null,
      childIds: o.children.map((c) => (c as Container & { __authId?: string }).__authId ?? ''),
    };
  }

  // --- Transforms ---
  getTransform(id: string): Transform2DValue | null {
    const o = this.byId.get(id);
    // A tracked node isn't guaranteed to be a real PixiJS display object with
    // a transform (e.g. test doubles / non-positional fixture nodes walked
    // via the composite adapter's overlay path) — treat a missing position
    // the same as a missing node: no transform to report, not a crash.
    if (!o || !o.position || !o.scale) return null;
    return {
      position: [o.position.x, o.position.y],
      rotation: o.rotation,
      scale: [o.scale.x, o.scale.y],
    };
  }

  setTransform(id: string, t: Partial<Transform2DValue>): void {
    const o = this.byId.get(id);
    if (!o) return;
    if (t.position) o.position.set(t.position[0], t.position[1]);
    if (t.rotation !== undefined) o.rotation = t.rotation;
    if (t.scale) o.scale.set(t.scale[0], t.scale[1]);
    this.overlay[id] ??= {};
    const ov = this.overlay[id];
    if (t.position) ov.position = t.position;
    if (t.rotation !== undefined) ov.rotation = t.rotation;
    if (t.scale) ov.scale = t.scale;
    this.dirty = true;
  }

  // --- Inspector (reflected fields) ---
  properties(id: string): Property2D[] {
    const o = this.byId.get(id);
    if (!o) return [];
    const props: Property2D[] = [
      { path: 'label', label: 'Name', type: 'string', value: o.label ?? '' },
      { path: 'visible', label: 'Visible', type: 'boolean', value: o.visible },
      { path: 'alpha', label: 'Alpha', type: 'number', value: o.alpha },
    ];
    if ('tint' in o)
      props.push({
        path: 'tint',
        label: 'Tint',
        type: 'color',
        value: (o as { tint: number }).tint,
      });
    return props;
  }

  set(id: string, path: string, value: unknown): void {
    const o = this.byId.get(id) as (Container & Record<string, unknown>) | undefined;
    if (!o) return;
    o[path] = value;
    this.overlay[id] ??= {};
    if (path === 'label') this.overlay[id].label = value as string;
    if (path === 'alpha') this.overlay[id].alpha = value as number;
    if (path === 'tint') this.overlay[id].tint = value as number;
    if (path === 'visible') this.overlay[id].visible = value as boolean;
    this.dirty = true;
  }

  private applyOverride(id: string, ov: Override2D): void {
    const o = this.byId.get(id);
    if (!o) return;
    if (ov.label !== undefined) o.label = ov.label;
    if (ov.alpha !== undefined) o.alpha = ov.alpha;
    if (ov.position) o.position.set(ov.position[0], ov.position[1]);
    if (ov.rotation !== undefined) o.rotation = ov.rotation;
    if (ov.scale) o.scale.set(ov.scale[0], ov.scale[1]);
    if (ov.tint !== undefined && 'tint' in o) (o as { tint: number }).tint = ov.tint;
    if (ov.visible !== undefined) o.visible = ov.visible;
  }

  /**
   * Re-apply a saved/external overlay onto the (already-walked) live tree, merging
   * it into the in-memory overlay so a later `serializeOverlay()`/save preserves it
   * and a later `refresh()` re-applies it again. Ids absent from the current tree
   * are skipped (orphaned, not an error) — the 2D analog of
   * `ThreeAuthoringAdapter.applyOverlay` (T3.2 slice 3). Used both for the initial
   * reload (constructor `opts.overlay`) and for `PersistenceProvider.applyExternal`
   * (re-apply a changed overlay file without a full remount).
   */
  applyOverlay(overlay: Overlay2D): { applied: number; orphaned: number } {
    let applied = 0;
    let orphaned = 0;
    for (const [id, ov] of Object.entries(overlay)) {
      if (!this.byId.has(id)) {
        orphaned++;
        continue;
      }
      this.applyOverride(id, ov);
      this.overlay[id] = { ...this.overlay[id], ...ov };
      applied++;
    }
    return { applied, orphaned };
  }

  isDirty(): boolean {
    return this.dirty;
  }
  serializeOverlay(): Overlay2D {
    return this.overlay;
  }
  /** Replace, rather than merge, overlay state after an exact history restore. */
  replaceOverlay(overlay: Overlay2D): void {
    this.overlay = structuredClone(overlay);
    for (const [id, ov] of Object.entries(this.overlay)) this.applyOverride(id, ov);
    this.dirty = true;
  }
  /** Clear the dirty flag after a successful save (mirrors ThreeAuthoringAdapter). */
  markClean(): void {
    this.dirty = false;
  }
}
