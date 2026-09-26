/**
 * ResourceSaver.save / ResourceLoader.load — starter-kit-city-builder
 * `builder.gd:153` / `:161` / `:175`.
 *
 * Pinned dump (`vendor/extension-api/godot-4.7-extension_api.json`):
 *   ResourceSaver.save(resource: Resource, path: String = "", flags: SaverFlags = 0) -> Error
 *   ResourceLoader.load(path: String, type_hint: String = "", cache_mode: CacheMode = 1) -> Resource
 *
 * There is no Godot binary `.res` writer on this lane. The live save the
 * player triggers (`user://map.res`) is the game's own DataMap
 * (`cash` + `structures: [{position, orientation, structure}]`) snapshotted
 * as JSON. Godot's saver writes a file; this writes the same structured
 * value to the FileAccess-owned IndexedDB-backed `user://` mount so a later load reconstructs a NEW
 * object. Storing the live reference would be silent-wrong: `builder.gd`
 * keeps mutating `map.cash` after save, and a second save does
 * `map.structures.clear()` on that same object.
 *
 * An authored `res://*.res` is decoded by gd-analyze at translation time and registered as a
 * factory by the emitted world. Loading it constructs a fresh instance of the project's emitted
 * `class_name` Resource classes; the browser never parses Godot's binary container.
 *
 * ## Resource ownership
 *
 * **Owns:** the authored-factory stack. **Shares:** FileAccess's project-keyed durable browser
 * filesystem. **Teardown:**
 * {@link registerAuthoredResource} hands back the remover for its own registration; nothing else
 * here has a lifetime.
 *
 * Neither `resourceLoaderLoad(path)` nor `resourceSaverSave(resource, path)` is handed an owner
 * object — the emitter's rows pass the path and nothing else, and the world's registration effect
 * runs before its `SceneContext` exists — so there is no game to key this on the way
 * `@vgai/engine`'s `core/game-scoped-slot.ts` keys the engine's own per-game state. Two DIFFERENT
 * translated games on one page sharing a `res://` path or a `user://` key would collide. Closing
 * that means threading the context through those emitter rows and the emitted world's
 * registration; it is not closed here.
 */

import { godotGlobalCall, type GodotRid } from './gdscript-builtins';
import { FileAccessMode, GodotFileAccess, godotFileSystemPaths } from './file-access';
import { registerGodotObjectIdentity } from './object';
import { packedStringArray, type PackedStringArray } from './packed-array';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';

/**
 * Project-owned authored resources, as a per-path STACK of registrations.
 *
 * A stack rather than one entry per path because a path can legitimately be registered twice at
 * once: the editor mounts an edit world and a play world of the SAME game, and each one's
 * `useEffect` registers the project's `GODOT_AUTHORED_RESOURCES`. With a plain `Map` the second
 * mount overwrote the first, and then the second UNMOUNT deleted the entry outright — leaving the
 * still-mounted first world's `ResourceLoader.load("res://….res")` returning `null` forever. Here
 * the newest registration answers, each unregister removes ITS OWN by identity, and the one
 * underneath comes back.
 *
 * The residual, stated rather than hidden: this is module-scoped, so two DIFFERENT games on one
 * page that both author the same `res://` path would see the later one's factory. Fixing that
 * needs an owner object at the `resourceLoaderLoad(path)` call site, and the emitter has none
 * there — see this module's header.
 */
const AUTHORED = new Map<string, (() => unknown)[]>();
const RESOURCE_PATHS = new WeakMap<object, string>();
const RESOURCE_CACHE = new Map<string, WeakRef<object>>();
const RESOURCE_CHANGED = new WeakMap<object, SignalHandle<readonly []>>();
const RESOURCE_SETUP_LOCAL_REQUESTED = new WeakMap<object, SignalHandle<readonly []>>();
const RESOURCE_LOCAL_TO_SCENE = new WeakMap<object, boolean>();
const RESOURCE_LOCAL_SCENES = new WeakMap<object, unknown>();
const RESOURCE_SCENE_UNIQUE_IDS = new WeakMap<object, string>();
const RESOURCE_RIDS = new WeakMap<object, GodotRid>();
const RESOURCE_BY_RID = new Map<bigint, object>();
const RESOURCE_PROTOCOLS = new WeakMap<object, GodotResourceProtocol>();
const THREADED_LOADS = new Map<string, { status: 1 | 2 | 3; resource: unknown }>();
interface ResourceUidEntry { path: string; order: number }
const RESOURCE_UID_PATHS = new Map<bigint, ResourceUidEntry[]>();
let resourceUidOrder = 0;
let abortOnMissingResources = true;
const RESOURCE_UID_ALPHABET = 'abcdefghijklmnopqrstuvwxy012345678';
const RESOURCE_FORMAT_LOADERS: GodotResourceFormatLoader[] = [];
const RESOURCE_FORMAT_SAVERS: GodotResourceFormatSaver[] = [];

/** Source-overridable ResourceFormatLoader protocol used by translated plugin scripts. */
export class GodotResourceFormatLoader {
  constructor() { registerGodotObjectIdentity(this, 'ResourceFormatLoader'); }

  _get_recognized_extensions(): PackedStringArray { return packedStringArray(); }
  _recognize_path(path: string, type = ''): boolean {
    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    return (type === '' || this._handles_type(type)) &&
      this._get_recognized_extensions().some((candidate) => candidate.toLowerCase() === extension);
  }
  _handles_type(_type: string): boolean { return false; }
  _get_resource_type(_path: string): string { return ''; }
  _get_resource_script_class(_path: string): string { return ''; }
  _get_resource_uid(path: string): bigint { return resourceUidGetPathId(path); }
  _get_dependencies(_path: string, _addTypes = false): PackedStringArray { return packedStringArray(); }
  _rename_dependencies(_path: string, _renames: ReadonlyMap<string, string>): number { return 0; }
  _exists(path: string): boolean { return GodotFileAccess.file_exists(path); }
  _get_classes_used(_path: string): PackedStringArray { return packedStringArray(); }
  _load(_path: string, _originalPath: string, _useSubThreads: boolean, _cacheMode: number): unknown {
    return null;
  }
}

export function createGodotResourceFormatLoader(): GodotResourceFormatLoader {
  return new GodotResourceFormatLoader();
}

/** Source-overridable ResourceFormatSaver protocol used by translated plugin scripts. */
export class GodotResourceFormatSaver {
  constructor() { registerGodotObjectIdentity(this, 'ResourceFormatSaver'); }

  _save(_resource: unknown, _path: string, _flags: number): number { return 15; }
  _set_uid(path: string, uid: bigint): number {
    resourceUidSetId(uid, path);
    return 0;
  }
  _recognize(_resource: unknown): boolean { return false; }
  _get_recognized_extensions(_resource: unknown): PackedStringArray { return packedStringArray(); }
  _recognize_path(resource: unknown, path: string): boolean {
    if (!this._recognize(resource)) return false;
    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    return this._get_recognized_extensions(resource)
      .some((candidate) => candidate.toLowerCase() === extension);
  }
}

export function createGodotResourceFormatSaver(): GodotResourceFormatSaver {
  return new GodotResourceFormatSaver();
}

function requireFormatLoader(value: unknown): GodotResourceFormatLoader {
  if (!(value instanceof GodotResourceFormatLoader)) {
    throw new TypeError('ResourceLoader format registry requires ResourceFormatLoader.');
  }
  return value;
}

function requireFormatSaver(value: unknown): GodotResourceFormatSaver {
  if (!(value instanceof GodotResourceFormatSaver)) {
    throw new TypeError('ResourceSaver format registry requires ResourceFormatSaver.');
  }
  return value;
}

function matchingFormatLoader(path: string, typeHint = ''): GodotResourceFormatLoader | undefined {
  return RESOURCE_FORMAT_LOADERS.find((loader) => loader._recognize_path(path, typeHint));
}

function matchingFormatSaver(resource: unknown, path: string): GodotResourceFormatSaver | undefined {
  return RESOURCE_FORMAT_SAVERS.find((saver) => saver._recognize_path(resource, path));
}

function resourceUidFromText(text: string): bigint {
  if (!text.startsWith('uid://') || text === 'uid://<invalid>') return -1n;
  let value = 0n;
  const radix = 34n;
  for (const character of text.slice(6)) {
    const code = character.codePointAt(0) ?? -1;
    const digit = code >= 97 && code <= 122
      ? code - 97
      : code >= 48 && code <= 57
        ? code - 48 + 25
        : -1;
    if (digit < 0) return -1n;
    value = value * radix + BigInt(digit);
  }
  return value & 0x7fffffffffffffffn;
}

function resourceUidValue(id: unknown, member: string): bigint {
  if (typeof id === 'bigint') return id;
  if (typeof id === 'number' && Number.isSafeInteger(id)) return BigInt(id);
  throw new TypeError(`${member} requires an exactly representable int64 ResourceUID.`);
}

/** Mount one saved ResourceUID entry; duplicate editor/play mounts retain stack ownership. */
export function registerResourceUid(uid: string, path: string): () => void {
  if (typeof path !== 'string' || !path.startsWith('res://')) {
    throw new TypeError('registerResourceUid path requires a res:// String.');
  }
  const id = resourceUidFromText(uid);
  if (id < 0n) throw new TypeError(`registerResourceUid received invalid UID ${JSON.stringify(uid)}.`);
  const paths = RESOURCE_UID_PATHS.get(id) ?? [];
  const entry = { path, order: ++resourceUidOrder };
  paths.push(entry);
  RESOURCE_UID_PATHS.set(id, paths);
  return () => {
    const livePaths = RESOURCE_UID_PATHS.get(id);
    const pathAt = livePaths?.lastIndexOf(entry) ?? -1;
    if (pathAt >= 0) livePaths?.splice(pathAt, 1);
    if (livePaths?.length === 0) RESOURCE_UID_PATHS.delete(id);
  };
}

export function resourceUidGetIdPath(id: unknown): string {
  const paths = RESOURCE_UID_PATHS.get(resourceUidValue(id, 'ResourceUID.get_id_path'));
  return paths?.[paths.length - 1]?.path ?? '';
}

export function resourceUidIdToText(id: unknown): string {
  let value = resourceUidValue(id, 'ResourceUID.id_to_text');
  if (value < 0n) return 'uid://<invalid>';
  let text = '';
  do {
    text = `${RESOURCE_UID_ALPHABET[Number(value % 34n)]}${text}`;
    value /= 34n;
  } while (value > 0n);
  return `uid://${text}`;
}

export function resourceUidTextToId(text: unknown): bigint {
  if (typeof text !== 'string') throw new TypeError('ResourceUID.text_to_id requires String.');
  return resourceUidFromText(text);
}

export function resourceUidHasId(id: unknown): boolean {
  return RESOURCE_UID_PATHS.has(resourceUidValue(id, 'ResourceUID.has_id'));
}

function resourceUidPath(value: unknown, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`${member} path requires String.`);
  return value;
}

export function resourceUidAddId(idValue: unknown, pathValue: unknown): void {
  const id = resourceUidValue(idValue, 'ResourceUID.add_id');
  const path = resourceUidPath(pathValue, 'ResourceUID.add_id');
  if (RESOURCE_UID_PATHS.has(id)) throw new Error(`ResourceUID.add_id cannot replace existing ${resourceUidIdToText(id)}.`);
  RESOURCE_UID_PATHS.set(id, [{ path, order: ++resourceUidOrder }]);
}

export function resourceUidSetId(idValue: unknown, pathValue: unknown): void {
  const id = resourceUidValue(idValue, 'ResourceUID.set_id');
  const path = resourceUidPath(pathValue, 'ResourceUID.set_id');
  const entries = RESOURCE_UID_PATHS.get(id);
  if (entries === undefined || entries.length === 0) {
    throw new Error(`ResourceUID.set_id requires an existing ${resourceUidIdToText(id)}.`);
  }
  entries[entries.length - 1]!.path = path;
  entries[entries.length - 1]!.order = ++resourceUidOrder;
}

export function resourceUidRemoveId(idValue: unknown): void {
  const id = resourceUidValue(idValue, 'ResourceUID.remove_id');
  if (!RESOURCE_UID_PATHS.delete(id)) {
    throw new Error(`ResourceUID.remove_id requires an existing ${resourceUidIdToText(id)}.`);
  }
}

export function resourceUidGetPathId(pathValue: unknown): bigint {
  const path = resourceUidPath(pathValue, 'ResourceUID.get_id_for_path');
  let found = -1n;
  let order = -1;
  for (const [id, entries] of RESOURCE_UID_PATHS) {
    const entry = entries[entries.length - 1];
    if (entry !== undefined && entry.path === path && entry.order > order) {
      found = id;
      order = entry.order;
    }
  }
  return found;
}

export function resourceUidUidToPath(uid: unknown): string {
  if (typeof uid !== 'string') throw new TypeError('ResourceUID.uid_to_path requires String.');
  return resourceUidGetIdPath(resourceUidFromText(uid));
}

export function resourceUidPathToUid(pathValue: unknown): string {
  const path = resourceUidPath(pathValue, 'ResourceUID.path_to_uid');
  const id = resourceUidGetPathId(path);
  return id < 0n ? path : resourceUidIdToText(id);
}

export function resourceUidEnsurePath(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('ResourceUID.ensure_path requires String.');
  return value.startsWith('uid://') ? resourceUidUidToPath(value) : value;
}

export function resourceUidCreateId(): bigint {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues === undefined) {
    throw new Error('ResourceUID.create_id requires browser cryptographic random bytes.');
  }
  const words = new BigUint64Array(1);
  do {
    cryptoApi.getRandomValues(words);
    words[0] = (words[0] ?? 0n) & 0x7fffffffffffffffn;
  } while (RESOURCE_UID_PATHS.has(words[0] ?? 0n));
  return words[0] ?? -1n;
}

/**
 * Resource-specific lifecycle operations supplied by the copied compat type.
 *
 * Godot implements `Resource.duplicate` through its property list, not by serializing arbitrary
 * JavaScript fields. Native Three/Pixi objects also carry renderer state that a reflective clone
 * cannot reproduce. Each compat resource therefore registers the smallest exact factory it owns;
 * the shared Resource protocol owns path/name/local-to-scene metadata around that factory.
 */
export interface GodotResourceProtocol<T extends object = object> {
  /** Allocate/copy the resource itself without recursively copying Resource-valued members. */
  createDuplicate(resource: T, subresources: boolean, memo: Map<object, object>): T;
  /** Copy Resource-valued members after source → target has been seated in the cycle memo. */
  populateDuplicate?(source: T, target: T, subresources: boolean, memo: Map<object, object>): void;
  setupLocalToScene?(resource: T, scene: unknown): void;
  resetState?(resource: T): void;
}

/** Attach Resource lifecycle behavior to an existing native or copied resource identity. */
export function bindGodotResourceProtocol<T extends object>(
  resource: T,
  protocol: GodotResourceProtocol<T>,
): T {
  RESOURCE_PROTOCOLS.set(resource, protocol as GodotResourceProtocol);
  if (!RESOURCE_PATHS.has(resource)) retainGodotResourcePath(resource, '');
  if (!RESOURCE_LOCAL_TO_SCENE.has(resource)) RESOURCE_LOCAL_TO_SCENE.set(resource, false);
  if (!RESOURCE_SCENE_UNIQUE_IDS.has(resource)) RESOURCE_SCENE_UNIQUE_IDS.set(resource, '');
  return resource;
}

/** True only for identities carrying the copied Resource lifecycle protocol. */
export function hasGodotResourceProtocol(value: unknown): value is object {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    RESOURCE_PROTOCOLS.has(value as object)
  );
}

function resourceProtocol(resource: object, member: string): GodotResourceProtocol {
  const protocol = RESOURCE_PROTOCOLS.get(resource);
  if (protocol === undefined) {
    throw new Error(
      `Resource.${member} requires the copied resource type to register its exact duplication protocol.`,
    );
  }
  return protocol;
}

function copyResourceMetadata(source: object, target: object): void {
  const name = getGodotResourceName(source);
  if (name !== '') Reflect.set(target, 'resource_name', name);
  // A duplicate is an unbound resource. Carrying resource_path would alias the loader cache and
  // differs from Godot, where a duplicated subresource has no external path.
  retainGodotResourcePath(target, '');
  RESOURCE_LOCAL_TO_SCENE.set(target, RESOURCE_LOCAL_TO_SCENE.get(source) ?? false);
  RESOURCE_SCENE_UNIQUE_IDS.set(target, '');
}

function duplicateWithProtocol(
  resource: object,
  subresources: boolean,
  memo: Map<object, object>,
): object {
  const retained = memo.get(resource);
  if (retained !== undefined) return retained;
  const protocol = resourceProtocol(resource, subresources ? 'duplicate_deep' : 'duplicate');
  const duplicate = protocol.createDuplicate(resource, subresources, memo);
  if (duplicate === resource) {
    throw new Error('Resource duplicate protocol returned the source identity.');
  }
  memo.set(resource, duplicate);
  protocol.populateDuplicate?.(resource, duplicate, subresources, memo);
  copyResourceMetadata(resource, duplicate);
  return duplicate;
}

/** Godot 3/4 `Resource.duplicate(subresources=false)`. */
export function godotResourceDuplicate<T>(resource: T, subresources = false): T {
  if (typeof subresources !== 'boolean') {
    throw new TypeError('Resource.duplicate subresources requires a bool value.');
  }
  const object = resourceObject(resource, 'duplicate');
  return duplicateWithProtocol(object, subresources, new Map()) as T;
}

/**
 * Godot 4 `Resource.duplicate_deep(mode)`. The modes differ in when an external resource is
 * duplicated; compat resources report their own external/built-in status through resource_path.
 */
export function godotResourceDuplicateDeep<T>(resource: T, mode = 1): T {
  if (!Number.isSafeInteger(mode) || mode < 0 || mode > 2) {
    throw new Error(`Resource.duplicate_deep mode must be 0, 1, or 2; received ${String(mode)}.`);
  }
  const root = resourceObject(resource, 'duplicate_deep');
  const memo = new Map<object, object>();
  const duplicateNested = (value: object): object => {
    const path = getGodotResourcePath(value);
    const isExternal = path !== '' && !godotResourceIsBuiltIn(value);
    if (mode === 0 && value !== root) return value;
    if (mode === 1 && isExternal && value !== root) return value;
    return duplicateWithProtocol(value, true, memo);
  };
  // Resource factories receive the memo and use duplicateGodotSubresource below. Register this
  // policy marker without storing hidden ambient state on the resource itself.
  DEEP_DUPLICATE_POLICY.set(memo, duplicateNested);
  return duplicateWithProtocol(root, true, memo) as T;
}

const DEEP_DUPLICATE_POLICY = new WeakMap<Map<object, object>, (value: object) => object>();

/** Duplicate a nested Resource from inside a registered resource factory. */
export function duplicateGodotSubresource<T>(value: T, memo: Map<object, object>): T {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return value;
  const object = value as object;
  if (!RESOURCE_PROTOCOLS.has(object)) return value;
  const policy = DEEP_DUPLICATE_POLICY.get(memo);
  return (policy === undefined ? duplicateWithProtocol(object, true, memo) : policy(object)) as T;
}

/** Godot `Resource.setup_local_to_scene()`. Scene is retained only by the owning protocol. */
export function godotResourceSetupLocalToScene(resource: unknown, scene: unknown = null): void {
  const object = resourceObject(resource, 'setup_local_to_scene');
  if (scene !== null) RESOURCE_LOCAL_SCENES.set(object, scene);
  resourceSetupLocalRequested(object).emit();
  resourceProtocol(object, 'setup_local_to_scene').setupLocalToScene?.(object, scene);
}

/** Scene identity installed by PackedScene before `setup_local_to_scene`; null outside that flow. */
export function godotResourceGetLocalScene(resource: unknown): unknown {
  return RESOURCE_LOCAL_SCENES.get(resourceObject(resource, 'get_local_scene')) ?? null;
}

/** Godot 4 `Resource.reset_state()`: clear transient per-instance state owned by the type. */
export function godotResourceResetState(resource: unknown): void {
  const object = resourceObject(resource, 'reset_state');
  resourceProtocol(object, 'reset_state').resetState?.(object);
}

let nextSceneUniqueId = 1;

/** Generate the stable, legal identifier alphabet accepted by `set_scene_unique_id`. */
export function godotResourceGenerateSceneUniqueId(): string {
  const serial = nextSceneUniqueId;
  nextSceneUniqueId += 1;
  return `Resource_${serial.toString(36)}`;
}

export interface GodotResourceObject {
  resource_name: string;
}

export function createGodotResource(major: 3 | 4): GodotResourceObject {
  const resource: GodotResourceObject = { resource_name: '' };
  registerGodotObjectIdentity(resource, 'Resource');
  const protocol: GodotResourceProtocol<GodotResourceObject> = {
    createDuplicate(source) {
      const copy: GodotResourceObject = { resource_name: source.resource_name };
      registerGodotObjectIdentity(copy, 'Resource');
      return bindGodotResourceProtocol(copy, protocol);
    },
  };
  bindGodotResourceProtocol(resource, protocol);
  void major;
  return resource;
}

function resourceObject(value: unknown, member: string): object {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    throw new TypeError(`Resource.${member} requires a live Resource object.`);
  }
  return value as object;
}

function resourceChanged(resource: object): SignalHandle<readonly []> {
  let signal = RESOURCE_CHANGED.get(resource);
  if (signal !== undefined) return signal;
  signal = createSignal<readonly []>();
  RESOURCE_CHANGED.set(resource, signal);
  return signal;
}

function resourceSetupLocalRequested(resource: object): SignalHandle<readonly []> {
  let signal = RESOURCE_SETUP_LOCAL_REQUESTED.get(resource);
  if (signal !== undefined) return signal;
  signal = createSignal<readonly []>();
  RESOURCE_SETUP_LOCAL_REQUESTED.set(resource, signal);
  return signal;
}

export function godotResourceChangedSignal(resource: unknown): GodotSignal<readonly []> {
  return resourceChanged(resourceObject(resource, 'changed')).signal;
}

export function godotResourceEmitChanged(resource: unknown): void {
  resourceChanged(resourceObject(resource, 'emit_changed')).emit();
}

export function godotResourceSetupLocalToSceneRequestedSignal(resource: unknown): GodotSignal<readonly []> {
  return resourceSetupLocalRequested(resourceObject(resource, 'setup_local_to_scene_requested')).signal;
}

export function godotResourceGetRid(resource: unknown): GodotRid {
  const object = resourceObject(resource, 'get_rid');
  let rid = RESOURCE_RIDS.get(object);
  if (rid === undefined) {
    const id = godotGlobalCall<number>('rid_allocate_id', []);
    rid = godotGlobalCall('rid_from_int64', [id]);
    RESOURCE_RIDS.set(object, rid);
    RESOURCE_BY_RID.set(rid.id, object);
  }
  return rid;
}

export function godotResourceOfRid(rid: GodotRid): object | undefined {
  return RESOURCE_BY_RID.get(rid.id);
}

function cleanDeadResourcePath(path: string): object | undefined {
  const current = RESOURCE_CACHE.get(path)?.deref();
  if (current === undefined) RESOURCE_CACHE.delete(path);
  return current;
}

function requireResourcePath(path: unknown): string {
  if (typeof path !== 'string') throw new TypeError('Resource.resource_path requires a String.');
  if (path === '') return path;
  if (!path.startsWith('res://') && !path.startsWith('user://')) {
    throw new Error(`Resource.resource_path must be empty, res://, or user://; received ${path}.`);
  }
  return path.replace(/\\/g, '/');
}

/** Attach the one ResourceCache identity used by Resource and ResourceLoader members. */
export function bindGodotResourcePath(resource: unknown, path: string): void {
  const object = resourceObject(resource, 'resource_path');
  const normalized = requireResourcePath(path);
  const previous = RESOURCE_PATHS.get(object);
  if (previous === normalized) return;
  if (normalized !== '') {
    const occupied = cleanDeadResourcePath(normalized);
    if (occupied !== undefined && occupied !== object) {
      throw new Error(`Resource path ${normalized} is already owned by another live Resource.`);
    }
  }
  if (previous !== undefined && RESOURCE_CACHE.get(previous)?.deref() === object) {
    RESOURCE_CACHE.delete(previous);
  }
  RESOURCE_PATHS.set(object, normalized);
  if (normalized !== '') RESOURCE_CACHE.set(normalized, new WeakRef(object));
}

/** Assign Resource.resource_path without inserting the identity into ResourceLoader's cache. */
function retainGodotResourcePath(resource: unknown, path: string): void {
  const object = resourceObject(resource, 'resource_path');
  const normalized = requireResourcePath(path);
  const previous = RESOURCE_PATHS.get(object);
  if (previous !== undefined && previous !== normalized && RESOURCE_CACHE.get(previous)?.deref() === object) {
    RESOURCE_CACHE.delete(previous);
  }
  RESOURCE_PATHS.set(object, normalized);
}

export function getGodotResourcePath(resource: unknown): string {
  const object = resourceObject(resource, 'resource_path');
  const retained = RESOURCE_PATHS.get(object);
  if (retained !== undefined) return retained;
  const direct = Reflect.get(object, 'resource_path');
  if (typeof direct === 'string') return direct;
  return '';
}

export const godotResourceGetPath = getGodotResourcePath;

export function setGodotResourcePath(resource: unknown, path: string): void {
  bindGodotResourcePath(resource, path);
}

export function getGodotResourceName(resource: unknown): string {
  const object = resourceObject(resource, 'resource_name');
  const direct = Reflect.get(object, 'resource_name');
  return typeof direct === 'string' ? direct : '';
}

export function setGodotResourceName(resource: unknown, name: string): void {
  if (typeof name !== 'string') throw new TypeError('Resource.resource_name requires a String.');
  const object = resourceObject(resource, 'resource_name');
  if (!Reflect.set(object, 'resource_name', name)) {
    throw new Error('Resource.resource_name cannot mutate this retained Resource identity.');
  }
  resourceChanged(object).emit();
}

export const godotResourceGetName = getGodotResourceName;
export const godotResourceSetName = setGodotResourceName;
export const godotResourceSetPath = setGodotResourcePath;

/** Godot 4 `take_over_path`: clear the previous owner's cache claim, then bind this resource. */
export function godotResourceTakeOverPath(resource: unknown, path: string): void {
  const object = resourceObject(resource, 'take_over_path');
  const normalized = requireResourcePath(path);
  const occupied = normalized === '' ? undefined : cleanDeadResourcePath(normalized);
  if (occupied !== undefined && occupied !== object) {
    RESOURCE_PATHS.set(occupied, '');
    RESOURCE_CACHE.delete(normalized);
  }
  bindGodotResourcePath(object, normalized);
}

export function godotResourceHasPath(resource: unknown): boolean {
  return getGodotResourcePath(resource) !== '';
}

export function godotResourceIsBuiltIn(resource: unknown): boolean {
  const path = getGodotResourcePath(resource);
  return path === '' || path.includes('::') || path.startsWith('local://');
}

export function getGodotResourceLocalToScene(resource: unknown): boolean {
  return RESOURCE_LOCAL_TO_SCENE.get(resourceObject(resource, 'resource_local_to_scene')) ?? false;
}

export function setGodotResourceLocalToScene(resource: unknown, enabled: boolean): void {
  if (typeof enabled !== 'boolean') {
    throw new TypeError('Resource.resource_local_to_scene requires a bool value.');
  }
  RESOURCE_LOCAL_TO_SCENE.set(resourceObject(resource, 'resource_local_to_scene'), enabled);
}

export const godotResourceIsLocalToScene = getGodotResourceLocalToScene;
export const godotResourceSetLocalToScene = setGodotResourceLocalToScene;

export function godotResourceGetSceneUniqueId(resource: unknown): string {
  return RESOURCE_SCENE_UNIQUE_IDS.get(resourceObject(resource, 'get_scene_unique_id')) ?? '';
}

export function godotResourceSetSceneUniqueId(resource: unknown, id: string): void {
  if (typeof id !== 'string') throw new TypeError('Resource.set_scene_unique_id requires a String.');
  if (!/^[A-Za-z0-9_]*$/.test(id)) {
    throw new Error('Resource scene unique ID must contain only letters, numbers, and underscores.');
  }
  RESOURCE_SCENE_UNIQUE_IDS.set(resourceObject(resource, 'set_scene_unique_id'), id);
}

function writePersisted(path: string, json: string): void {
  const file = GodotFileAccess.open(path, FileAccessMode.WRITE);
  if (file === null) throw new Error(`ResourceSaver could not open ${path} (${GodotFileAccess.get_open_error()}).`);
  file.store_string(json);
  file.close();
}

function readPersisted(path: string): string | null {
  if (!GodotFileAccess.file_exists(path)) return null;
  return GodotFileAccess.get_file_as_string(path);
}

function persistedResourcePaths(): string[] {
  return godotFileSystemPaths().filter((path) => path.startsWith('user://'));
}

/**
 * A Godot-authored Resource document under `res://`. Both binary `.res` and text `.tres` are
 * decoded at translation time and registered as factories; neither is a writable browser save.
 */
function isAuthoredResourceDocument(path: string): boolean {
  return path.startsWith('res://') && (path.endsWith('.res') || path.endsWith('.tres'));
}

/** Register one translation-time-decoded `res://` Resource for this mounted world. */
export function registerAuthoredResource<T>(path: string, create: () => T): () => void {
  if (!isAuthoredResourceDocument(path)) {
    throw new Error(`godot-compat: authored Resource path must be res://*.res or res://*.tres, got "${path}"`);
  }
  return registerGodotResourceFactory(path, create);
}

/** Register a retained resource factory for another Godot resource container such as `.tscn`. */
export function registerGodotResourceFactory<T>(path: string, create: () => T): () => void {
  if (!path.startsWith('res://')) {
    throw new Error(`godot-compat: ResourceLoader factory path must start with res://, got "${path}"`);
  }
  const stack = AUTHORED.get(path) ?? [];
  stack.push(create as () => unknown);
  AUTHORED.set(path, stack);
  return () => {
    const live = AUTHORED.get(path);
    if (live === undefined) return;
    const at = live.lastIndexOf(create as () => unknown);
    if (at < 0) return;
    live.splice(at, 1);
    if (live.length === 0) AUTHORED.delete(path);
  };
}

/**
 * `ResourceSaver.save(resource, path)` — dump: `-> enum::Error`. Error.OK is 0.
 *
 * The dump's `path` DEFAULTS to `""`, which in Godot means "write the resource to its own
 * `resource_path`". There is no `resource_path` here — a saved value is the game's own data
 * object, not a Godot `Resource` — so an empty path has no destination, and writing it anyway
 * put every such save under one filesystem key where the next one overwrote it silently.
 * It throws instead, the way every other unmodelled spelling in this folder does.
 */
export function resourceSaverSave(resource: unknown, path = '', flags = 0): number {
  if (!Number.isInteger(flags) || flags < 0) {
    throw new TypeError('ResourceSaver.save flags requires a non-negative integer bitfield.');
  }
  if (path === '') path = getGodotResourcePath(resource);
  if (path === '') throw new Error('ResourceSaver.save(resource) has no path and the Resource has no resource_path.');
  const formatSaver = matchingFormatSaver(resource, path);
  if (formatSaver !== undefined) {
    const result = formatSaver._save(resource, path, flags);
    if (!Number.isInteger(result)) throw new TypeError('ResourceFormatSaver._save must return Error.');
    if (result === 0 && resource !== null &&
        (typeof resource === 'object' || typeof resource === 'function')) {
      retainGodotResourcePath(resource, path);
    }
    return result;
  }
  if (flags !== 0) {
    throw new Error(
      `ResourceSaver.save flags=${flags} requires Godot compression/path-remap semantics not present in the JSON user store.`,
    );
  }
  if (isAuthoredResourceDocument(path)) {
    throw new Error(
      `godot-compat: ResourceSaver.save("${path}") refuses an immutable authored Resource document. ` +
        'The live save is user:// (JSON snapshot of DataMap); translated res:// Resource documents are not writable.',
    );
  }
  writePersisted(path, JSON.stringify(resource));
  return 0;
}

/** `ResourceLoader.load(path)` — dump: `-> Resource`. A miss is runtime null. */
export function resourceLoaderLoad<T>(path: string, typeHint = '', cacheMode = 1): T {
  if (!Number.isInteger(cacheMode) || cacheMode < 0 || cacheMode > 3) {
    throw new RangeError(`ResourceLoader.load cache_mode must be 0..3; received ${cacheMode}.`);
  }
  if (cacheMode >= 2) {
    throw new Error(
      `ResourceLoader.load cache_mode=${cacheMode} requires replacing live subresources atomically.`,
    );
  }
  if (cacheMode === 1) {
    const cached = cleanDeadResourcePath(path);
    if (cached !== undefined) return cached as T;
  }
  const formatLoader = matchingFormatLoader(path, typeHint);
  if (formatLoader !== undefined) {
    const resource = formatLoader._load(path, path, false, cacheMode);
    if (resource !== null && resource !== undefined &&
        (typeof resource === 'object' || typeof resource === 'function')) {
      if (cacheMode === 1) bindGodotResourcePath(resource, path);
      else retainGodotResourcePath(resource, path);
    }
    return (resource ?? null) as T;
  }
  if (typeHint !== '') {
    return null as T;
  }
  if (AUTHORED.has(path)) {
    const stack = AUTHORED.get(path);
    const newest = stack?.[stack.length - 1];
    const resource = newest?.() ?? null;
    if (resource !== null && (typeof resource === 'object' || typeof resource === 'function')) {
      if (cacheMode === 1) bindGodotResourcePath(resource, path);
      else retainGodotResourcePath(resource, path);
    }
    return resource as T;
  }
  const json = readPersisted(path);
  if (json === null) return null as T;
  const resource = JSON.parse(json) as T;
  if (resource !== null && (typeof resource === 'object' || typeof resource === 'function')) {
    if (cacheMode === 1) bindGodotResourcePath(resource, path);
    else retainGodotResourcePath(resource, path);
  }
  return resource;
}

export interface GodotResourceInteractiveLoader {
  poll(): number;
  get_resource(): unknown;
  get_stage(): number;
  get_stage_count(): number;
}

/** Godot 3 interactive loading over the already-decoded retained project Resource registry. */
export function resourceLoaderLoadInteractive(path: string, typeHint = ''): GodotResourceInteractiveLoader | null {
  const resource = resourceLoaderLoad<unknown>(path, typeHint, 1);
  if (resource === null) return null;
  let complete = false;
  const loader: GodotResourceInteractiveLoader = {
    poll() { complete = true; return 18; },
    get_resource() { return complete ? resource : null; },
    get_stage() { return complete ? 1 : 0; },
    get_stage_count() { return 1; },
  };
  registerGodotObjectIdentity(loader, 'ResourceInteractiveLoader');
  return loader;
}

export function resourceLoaderHasCached(path: string): boolean {
  return cleanDeadResourcePath(path) !== undefined;
}

export function resourceLoaderGetCachedRef<T>(path: string): T {
  return (cleanDeadResourcePath(path) ?? null) as T;
}

/** `ResourceLoader.exists(path, type_hint = "")` over the same live stores as `load`. */
export function resourceLoaderExists(path: string, typeHint = ''): boolean {
  const formatLoader = matchingFormatLoader(path, typeHint);
  if (formatLoader !== undefined) return formatLoader._exists(path);
  if (typeHint !== '') return false;
  if (isAuthoredResourceDocument(path)) return AUTHORED.has(path);
  return readPersisted(path) !== null;
}

/** ResourceLoader.list_directory: immediate recognized resources and child directories, sorted. */
export function resourceLoaderListDirectory(directoryPath: string): PackedStringArray {
  if (typeof directoryPath !== 'string') {
    throw new TypeError('ResourceLoader.list_directory requires a String path.');
  }
  const directory = directoryPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!directory.startsWith('res://') && !directory.startsWith('user://')) {
    throw new Error(`ResourceLoader.list_directory requires res:// or user://, got ${directoryPath}.`);
  }
  const prefix = `${directory}/`;
  const entries = new Set<string>();
  for (const path of [...AUTHORED.keys(), ...persistedResourcePaths()]) {
    if (!path.startsWith(prefix)) continue;
    const remainder = path.slice(prefix.length);
    if (remainder === '') continue;
    const slash = remainder.indexOf('/');
    entries.add(slash < 0 ? remainder : `${remainder.slice(0, slash)}/`);
  }
  return packedStringArray([...entries].sort());
}

/** Browser resources are already mounted before scripts; a threaded request can complete now. */
export function resourceLoaderLoadThreadedRequest(
  path: string,
  typeHint = '',
  useSubThreads = false,
  cacheMode = 1,
): number {
  if (typeof useSubThreads !== 'boolean') {
    throw new TypeError('ResourceLoader.load_threaded_request use_sub_threads requires bool.');
  }
  try {
    const resource = resourceLoaderLoad(path, typeHint, cacheMode);
    THREADED_LOADS.set(path, { status: resource === null ? 2 : 3, resource });
    if (resource === null) {
      throw new Error(`ResourceLoader.load_threaded_request could not load ${JSON.stringify(path)}.`);
    }
    return 0;
  } catch (error) {
    THREADED_LOADS.set(path, { status: 2, resource: null });
    if (abortOnMissingResources) throw error;
    return 1;
  }
}

export function resourceLoaderLoadThreadedGetStatus(path: string, progress: unknown[] = []): number {
  if (!Array.isArray(progress)) {
    throw new TypeError('ResourceLoader.load_threaded_get_status progress requires an Array.');
  }
  const request = THREADED_LOADS.get(path);
  if (progress.length > 0 || request !== undefined) progress[0] = request?.status === 3 ? 1 : 0;
  return request?.status ?? 0;
}

export function resourceLoaderLoadThreadedGet<T>(path: string): T {
  const request = THREADED_LOADS.get(path);
  if (request === undefined) {
    throw new Error(`ResourceLoader.load_threaded_get(${JSON.stringify(path)}) has no request.`);
  }
  THREADED_LOADS.delete(path);
  return (request.status === 3 ? request.resource : null) as T;
}

export function resourceLoaderSetAbortOnMissingResources(abort: boolean): void {
  if (typeof abort !== 'boolean') {
    throw new TypeError('ResourceLoader.set_abort_on_missing_resources requires bool.');
  }
  abortOnMissingResources = abort;
}

export function resourceLoaderGetDependencies(path: string): PackedStringArray {
  const loader = matchingFormatLoader(path);
  if (loader !== undefined) return loader._get_dependencies(path, false);
  throw new Error(
    `ResourceLoader.get_dependencies(${JSON.stringify(path)}) requires the imported Godot resource dependency table; ` +
      'the browser resource mount contains decoded factories and bytes, not a Godot ResourceFormatLoader.',
  );
}

export function resourceLoaderGetRecognizedExtensionsForType(type: string): PackedStringArray {
  if (typeof type !== 'string') {
    throw new TypeError('ResourceLoader.get_recognized_extensions_for_type requires String.');
  }
  return packedStringArray(RESOURCE_FORMAT_LOADERS
    .filter((loader) => type === '' || loader._handles_type(type))
    .flatMap((loader) => [...loader._get_recognized_extensions()]));
}

export function resourceLoaderGetResourceUid(path: string): bigint {
  if (typeof path !== 'string') throw new TypeError('ResourceLoader.get_resource_uid requires String.');
  return resourceUidGetPathId(path);
}

export function resourceLoaderAddFormatLoader(loaderValue: unknown, atFront = false): void {
  const loader = requireFormatLoader(loaderValue);
  if (typeof atFront !== 'boolean') throw new TypeError('ResourceLoader add format loader at_front requires bool.');
  const existing = RESOURCE_FORMAT_LOADERS.indexOf(loader);
  if (existing >= 0) RESOURCE_FORMAT_LOADERS.splice(existing, 1);
  if (atFront) RESOURCE_FORMAT_LOADERS.unshift(loader);
  else RESOURCE_FORMAT_LOADERS.push(loader);
}

export function resourceLoaderRemoveFormatLoader(loaderValue: unknown): void {
  const loader = requireFormatLoader(loaderValue);
  const index = RESOURCE_FORMAT_LOADERS.indexOf(loader);
  if (index >= 0) RESOURCE_FORMAT_LOADERS.splice(index, 1);
}

export function resourceSaverSetUid(path: string, uid: number | bigint): number {
  if (typeof path !== 'string') throw new TypeError('ResourceSaver.set_uid path requires String.');
  const id = resourceUidValue(uid, 'ResourceSaver.set_uid');
  const saver = RESOURCE_FORMAT_SAVERS.find((candidate) =>
    candidate._get_recognized_extensions(null).some((extension) => path.endsWith(`.${extension}`)));
  if (saver !== undefined) return saver._set_uid(path, id);
  const current = resourceUidGetPathId(path);
  if (current >= 0n && current !== id) resourceUidRemoveId(current);
  if (resourceUidHasId(id)) resourceUidSetId(id, path);
  else resourceUidAddId(id, path);
  return 0;
}

export function resourceSaverGetRecognizedExtensions(resource: unknown): PackedStringArray {
  return packedStringArray(RESOURCE_FORMAT_SAVERS
    .filter((saver) => saver._recognize(resource))
    .flatMap((saver) => [...saver._get_recognized_extensions(resource)]));
}

export function resourceSaverAddFormatSaver(saverValue: unknown, atFront = false): void {
  const saver = requireFormatSaver(saverValue);
  if (typeof atFront !== 'boolean') throw new TypeError('ResourceSaver add format saver at_front requires bool.');
  const existing = RESOURCE_FORMAT_SAVERS.indexOf(saver);
  if (existing >= 0) RESOURCE_FORMAT_SAVERS.splice(existing, 1);
  if (atFront) RESOURCE_FORMAT_SAVERS.unshift(saver);
  else RESOURCE_FORMAT_SAVERS.push(saver);
}

export function resourceSaverRemoveFormatSaver(saverValue: unknown): void {
  const saver = requireFormatSaver(saverValue);
  const index = RESOURCE_FORMAT_SAVERS.indexOf(saver);
  if (index >= 0) RESOURCE_FORMAT_SAVERS.splice(index, 1);
}

export function resourceSaverGetResourceIdForPath(path: string, generate = false): number {
  if (typeof path !== 'string') throw new TypeError('ResourceSaver.get_resource_id_for_path requires String.');
  if (typeof generate !== 'boolean') throw new TypeError('ResourceSaver.get_resource_id_for_path generate requires bool.');
  let id = resourceUidGetPathId(path);
  if (id < 0n && generate) {
    id = resourceUidCreateId();
    resourceUidAddId(id, path);
  }
  if (id < 0n) return -1;
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  if (id > maxSafe) throw new RangeError('ResourceSaver path ID exceeds exactly representable JavaScript int range.');
  return Number(id);
}
