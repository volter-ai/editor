/**
 * `createSceneIndex` — the LIVE scene index (punchlist P2, `observe`).
 *
 * `scene-query.ts` answers "which objects carry tag X?" by walking the whole
 * graph on every call, and it tells nobody when the answer changes. This
 * module is the notified half: a tag/entity-id index kept current as objects
 * join and leave the scene, plus the change signals a game needs so it never
 * has to poll.
 *
 * ## The one event primitive is `EventTarget`
 *
 * There is no bus, no emitter class, no `subscribe()` returning a closure.
 * `index.events` is a plain `EventTarget` dispatching `CustomEvent`s, and
 * **unsubscribe is `AbortSignal`** — the platform's own answer:
 *
 * ```ts
 * const ac = new AbortController();
 * ctx.sceneIndex.events.addEventListener(
 *   'tagadded',
 *   (e) => console.log((e as SceneIndexEvent<'tagadded'>).detail.object.name),
 *   { signal: ac.signal },
 * );
 * ac.abort(); // done — nothing to remember, nothing to leak
 * ```
 *
 * {@link onSceneIndexEvent} is the same call with the detail typed for you.
 * `index.eventsFor(obj)` is the per-object target (Roblox's `inst.Changed`):
 * the same events, already filtered to one object, so a listener that only
 * cares about one entity does not filter by hand.
 *
 * ## How the index stays live: three's own parent events, not a monkeypatch
 *
 * three r155+ dispatches `childadded`/`childremoved` on the **parent** from
 * `Object3D.add`/`remove` (and therefore from `attach`, `clear`,
 * `removeFromParent`, and R3F's reconciler, which all go through those two).
 * The index subscribes to those two events on every object it indexes; on
 * `childadded` it walks the new subtree, indexes it, and subscribes each
 * node, and on `childremoved` it does the inverse. `Object3D.prototype` is
 * NOT patched — nothing in this repo patches a library prototype.
 *
 * Consequences worth knowing:
 *
 * - **The quiet-frame cost is zero.** The index registers no system and runs
 *   no per-frame reconcile; it does work only when three tells it something
 *   moved. Nothing here ticks.
 * - **Reparenting nets out to one entry.** `parent.add(obj)` removes `obj`
 *   from its old parent first, so a move inside the indexed tree fires
 *   `childremoved` then `childadded` — unindex, then index. The object ends
 *   up indexed exactly once (and a listener sees an `entityremoved` followed
 *   by an `entityadded`, which is the truth about what happened).
 * - **Splicing `parent.children` by hand is invisible to the index**, because
 *   it is invisible to three as well. Use `add`/`remove`.
 *
 * ## Tags are stored where they always were
 *
 * `addTag`/`removeTag` write the existing `userData['tags']` array, so
 * `queryByTag` keeps returning the truth and nothing has to be migrated. The
 * index is the fast, notified path over the same storage. A game that writes
 * `userData['tags']` by hand gets a stale index — that is not prevented, it is
 * repaired: call {@link SceneIndex.reindex} on the object.
 *
 * ## Attributes
 *
 * `getAttribute`/`setAttribute`/`deleteAttribute` are typed accessors over ONE
 * new reserved userData key, `attributes` (registered in `ecs/user-data.ts`,
 * `Record<string, string | number | boolean>`). They emit `attributechanged`
 * only when the value actually changes, so a re-set of the same value is
 * silent.
 *
 * ## What this deliberately does NOT do
 *
 * - **No property-level `Changed` on transforms.** three does not notify on
 *   `position.set(...)`; faking it means diffing every transform every frame,
 *   and a signal that is really a per-frame poll is worse than no signal —
 *   it hides its own cost. Read the transform when you need it, or drive the
 *   change from the code that made it.
 * - **No `Touched`.** Contact/trigger events are Rapier's, dispatched through
 *   `ctx.collisions.onCollision`. A second path would be a second truth.
 * - **No 2D index.** This module indexes a three graph only.
 */

import type * as THREE from 'three';
import { deleteUserData, getUserData, setUserData } from './user-data';

/** The value types an attribute may hold — deliberately JSON-simple, so an
 *  attribute survives serialization and network replication unchanged. */
export type AttributeValue = string | number | boolean;

/** The `detail` payload of every scene-index event, keyed by event type.
 *  Every detail carries `object`, so a scene-wide listener filters without a
 *  second lookup. */
export interface SceneIndexEventDetails {
  /** An object (and, one event each, its descendants) joined the indexed tree. */
  entityadded: { object: THREE.Object3D };
  /** An object (and, one event each, its descendants) left the indexed tree. */
  entityremoved: { object: THREE.Object3D };
  /** A tag was added via {@link SceneIndex.addTag}. */
  tagadded: { object: THREE.Object3D; tag: string };
  /** A tag was removed via {@link SceneIndex.removeTag}. */
  tagremoved: { object: THREE.Object3D; tag: string };
  /** An attribute's value changed (`value` is `undefined` after a delete;
   *  `previous` is `undefined` when it was previously unset). */
  attributechanged: {
    object: THREE.Object3D;
    name: string;
    value: AttributeValue | undefined;
    previous: AttributeValue | undefined;
  };
}

/** Every event type `index.events` / `index.eventsFor(obj)` dispatches. */
export type SceneIndexEventType = keyof SceneIndexEventDetails;

/** The `CustomEvent` a given scene-index event type dispatches. */
export type SceneIndexEvent<K extends SceneIndexEventType = SceneIndexEventType> = CustomEvent<
  SceneIndexEventDetails[K]
>;

/** Event-type → event, for callers that want a typed `addEventListener` map. */
export type SceneIndexEventMap = { [K in SceneIndexEventType]: SceneIndexEvent<K> };

/**
 * `addEventListener` with the detail typed — the ONLY convenience over the
 * platform call, and it returns nothing on purpose: unsubscribe stays
 * `AbortSignal` (`{ signal }`), never a returned closure.
 */
export function onSceneIndexEvent<K extends SceneIndexEventType>(
  target: EventTarget,
  type: K,
  listener: (detail: SceneIndexEventDetails[K], event: SceneIndexEvent<K>) => void,
  options?: { signal?: AbortSignal; once?: boolean },
): void {
  target.addEventListener(
    type,
    (event) => {
      const custom = event as SceneIndexEvent<K>;
      listener(custom.detail, custom);
    },
    options,
  );
}

/** The live scene index — see this module's header. */
export interface SceneIndex {
  /** The scene-wide signal target. Listen with `addEventListener(type, fn,
   *  { signal })`, or {@link onSceneIndexEvent} for a typed `detail`. */
  readonly events: EventTarget;
  /** The per-object signal target (Roblox's `inst.Changed`): the same events,
   *  filtered to `obj`. Created lazily and held weakly. */
  eventsFor(obj: THREE.Object3D): EventTarget;

  /** Every indexed object carrying `tag`, in index order. Never traverses. */
  byTag(tag: string): readonly THREE.Object3D[];
  /** The indexed object whose `userData['entityId']` is `id` (the first, in
   *  index order, if a project has minted the id twice). Never traverses. */
  byEntityId(id: string): THREE.Object3D | undefined;
  /** True when `obj` is currently in the indexed tree. */
  has(obj: THREE.Object3D): boolean;

  /** Add `tag` to `obj`'s `userData['tags']` and the index; emits `tagadded`.
   *  A no-op (and silent) when the tag is already present. Legal on an object
   *  that has not joined the scene yet — the tag is stored, and the index
   *  picks it up when the object is added. */
  addTag(obj: THREE.Object3D, tag: string): void;
  /** Remove `tag`; emits `tagremoved`. A no-op (and silent) when absent. */
  removeTag(obj: THREE.Object3D, tag: string): void;
  /** True when `obj` carries `tag` (reads `userData['tags']`, so it is
   *  truthful even for an object that is not in the scene yet). */
  hasTag(obj: THREE.Object3D, tag: string): boolean;

  /** Read one attribute (`undefined` when unset). */
  getAttribute(obj: THREE.Object3D, name: string): AttributeValue | undefined;
  /** Write one attribute; emits `attributechanged` only if the value changed. */
  setAttribute(obj: THREE.Object3D, name: string, value: AttributeValue): void;
  /** Delete one attribute; emits `attributechanged` with `value: undefined`. */
  deleteAttribute(obj: THREE.Object3D, name: string): void;

  /** Re-read `obj`'s subtree from `userData` — the escape hatch for code that
   *  wrote `userData['tags']`/`userData['entityId']` by hand. Indexes anything
   *  in the subtree that is not indexed yet (emitting `entityadded`) and
   *  re-syncs the tag/id entries of everything that is. */
  reindex(obj: THREE.Object3D): void;

  /** Drop every listener this index installed and forget everything it knows.
   *  Called from the owning root's teardown; safe to call twice. */
  dispose(): void;
}

function readTags(obj: THREE.Object3D): string[] {
  const tags = getUserData(obj, 'tags');
  return Array.isArray(tags) ? tags : [];
}

function readAttributes(obj: THREE.Object3D): Record<string, AttributeValue> | undefined {
  const attributes = getUserData(obj, 'attributes');
  return attributes && typeof attributes === 'object' ? attributes : undefined;
}

/**
 * Build a live index over `root` and everything currently under it. One index
 * per three root; the root adapter creates it and exposes it as
 * `ctx.sceneIndex`.
 */
export function createSceneIndex(root: THREE.Object3D): SceneIndex {
  const events = new EventTarget();
  // Weak on purpose: the per-object target exists only while something else
  // still references the object. The index keeps NO map from target back to
  // object, so a removed-and-forgotten object can be collected with its target.
  const objectTargets = new WeakMap<THREE.Object3D, EventTarget>();

  const indexed = new Set<THREE.Object3D>();
  const tagged = new Map<string, Set<THREE.Object3D>>();
  // Arrays, not single values: a project that mints the same entityId twice
  // must not blind `byEntityId` for the survivor when one of them is removed.
  const byId = new Map<string, THREE.Object3D[]>();
  // The tag/id snapshot each object was indexed under, so unindexing (and
  // `reindex`) can undo exactly what indexing did even if `userData` has been
  // rewritten by hand in between.
  const indexedTags = new WeakMap<THREE.Object3D, string[]>();
  const indexedIds = new WeakMap<THREE.Object3D, string>();
  let disposed = false;

  function emit<K extends SceneIndexEventType>(type: K, detail: SceneIndexEventDetails[K]): void {
    // Two distinct CustomEvent instances: one Event object cannot carry two
    // `target`s, and re-dispatching a dispatched event is a spec footgun.
    events.dispatchEvent(new CustomEvent(type, { detail }));
    const perObject = objectTargets.get(detail.object);
    if (perObject) perObject.dispatchEvent(new CustomEvent(type, { detail }));
  }

  function addToTagIndex(obj: THREE.Object3D, tag: string): void {
    let set = tagged.get(tag);
    if (!set) {
      set = new Set();
      tagged.set(tag, set);
    }
    set.add(obj);
  }

  function removeFromTagIndex(obj: THREE.Object3D, tag: string): void {
    const set = tagged.get(tag);
    if (!set) return;
    set.delete(obj);
    if (set.size === 0) tagged.delete(tag);
  }

  function addToIdIndex(obj: THREE.Object3D, id: string): void {
    const list = byId.get(id);
    if (list) {
      if (!list.includes(obj)) list.push(obj);
    } else {
      byId.set(id, [obj]);
    }
  }

  function removeFromIdIndex(obj: THREE.Object3D, id: string): void {
    const list = byId.get(id);
    if (!list) return;
    const at = list.indexOf(obj);
    if (at !== -1) list.splice(at, 1);
    if (list.length === 0) byId.delete(id);
  }

  const onChildAdded = (event: { child: THREE.Object3D }): void => {
    indexSubtree(event.child);
  };
  const onChildRemoved = (event: { child: THREE.Object3D }): void => {
    unindexSubtree(event.child);
  };

  /** Point the tag entries at whatever `userData['tags']` says right now,
   *  undoing whatever the object was previously indexed under. */
  function syncTags(obj: THREE.Object3D): void {
    for (const tag of indexedTags.get(obj) ?? []) removeFromTagIndex(obj, tag);
    const tags = [...new Set(readTags(obj))];
    indexedTags.set(obj, tags);
    for (const tag of tags) addToTagIndex(obj, tag);
  }

  /** Same, for the entity-id entry. */
  function syncId(obj: THREE.Object3D): void {
    const previous = indexedIds.get(obj);
    if (previous !== undefined) removeFromIdIndex(obj, previous);
    indexedIds.delete(obj);
    const id = getUserData(obj, 'entityId');
    if (typeof id === 'string' && id !== '') {
      indexedIds.set(obj, id);
      addToIdIndex(obj, id);
    }
  }

  function indexOne(obj: THREE.Object3D): void {
    if (indexed.has(obj)) return;
    indexed.add(obj);
    // three's EventDispatcher de-dupes an identical (type, listener) pair, so
    // this is idempotent even if an object somehow arrives twice.
    obj.addEventListener('childadded', onChildAdded);
    obj.addEventListener('childremoved', onChildRemoved);
    syncTags(obj);
    syncId(obj);
    emit('entityadded', { object: obj });
  }

  function unindexOne(obj: THREE.Object3D): void {
    if (!indexed.has(obj)) return;
    indexed.delete(obj);
    obj.removeEventListener('childadded', onChildAdded);
    obj.removeEventListener('childremoved', onChildRemoved);

    for (const tag of indexedTags.get(obj) ?? []) removeFromTagIndex(obj, tag);
    indexedTags.delete(obj);
    const id = indexedIds.get(obj);
    if (id !== undefined) {
      removeFromIdIndex(obj, id);
      indexedIds.delete(obj);
    }

    emit('entityremoved', { object: obj });
  }

  function indexSubtree(subtreeRoot: THREE.Object3D): void {
    if (disposed) return;
    subtreeRoot.traverse(indexOne);
  }

  function unindexSubtree(subtreeRoot: THREE.Object3D): void {
    if (disposed) return;
    // `traverse` still works on a detached subtree: `remove` only broke the
    // link to the parent, the children below are intact.
    subtreeRoot.traverse(unindexOne);
  }

  indexSubtree(root);

  return {
    events,

    eventsFor(obj) {
      let target = objectTargets.get(obj);
      if (!target) {
        target = new EventTarget();
        objectTargets.set(obj, target);
      }
      return target;
    },

    byTag(tag) {
      const set = tagged.get(tag);
      return set ? [...set] : [];
    },

    byEntityId(id) {
      return byId.get(id)?.[0];
    },

    has(obj) {
      return indexed.has(obj);
    },

    addTag(obj, tag) {
      const tags = readTags(obj);
      if (tags.includes(tag)) return;
      setUserData(obj, 'tags', [...tags, tag]);
      if (indexed.has(obj)) {
        indexedTags.set(obj, [...(indexedTags.get(obj) ?? []), tag]);
        addToTagIndex(obj, tag);
      }
      emit('tagadded', { object: obj, tag });
    },

    removeTag(obj, tag) {
      const tags = readTags(obj);
      if (!tags.includes(tag)) return;
      setUserData(
        obj,
        'tags',
        tags.filter((t) => t !== tag),
      );
      if (indexed.has(obj)) {
        indexedTags.set(
          obj,
          (indexedTags.get(obj) ?? []).filter((t) => t !== tag),
        );
        removeFromTagIndex(obj, tag);
      }
      emit('tagremoved', { object: obj, tag });
    },

    hasTag(obj, tag) {
      return readTags(obj).includes(tag);
    },

    getAttribute(obj, name) {
      return readAttributes(obj)?.[name];
    },

    setAttribute(obj, name, value) {
      const attributes = readAttributes(obj);
      const previous = attributes?.[name];
      if (previous === value) return;
      if (attributes) attributes[name] = value;
      else setUserData(obj, 'attributes', { [name]: value });
      emit('attributechanged', { object: obj, name, value, previous });
    },

    deleteAttribute(obj, name) {
      const attributes = readAttributes(obj);
      if (!attributes || !(name in attributes)) return;
      const previous = attributes[name];
      delete attributes[name];
      if (Object.keys(attributes).length === 0) deleteUserData(obj, 'attributes');
      emit('attributechanged', { object: obj, name, value: undefined, previous });
    },

    reindex(obj) {
      if (disposed) return;
      obj.traverse((node) => {
        if (indexed.has(node)) {
          syncTags(node);
          syncId(node);
        } else {
          indexOne(node);
        }
      });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const obj of indexed) {
        obj.removeEventListener('childadded', onChildAdded);
        obj.removeEventListener('childremoved', onChildRemoved);
      }
      indexed.clear();
      tagged.clear();
      byId.clear();
    },
  };
}
