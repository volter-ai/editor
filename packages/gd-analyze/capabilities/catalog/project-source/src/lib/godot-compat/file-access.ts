/** Godot FileAccess/DirAccess over a project-namespaced, IndexedDB-backed browser filesystem. */

import { godotDecodeVariant, godotEncodeVariant } from './godot-variant-marshals';
import {
  createIndexedDbFileSystemStore,
  type IndexedDbFileSystemStore,
  type StoredFileSystemSnapshot,
} from './indexeddb-filesystem';
import { packedByteArray, packedStringArray, type PackedStringArray } from './packed-array';
import { registerGodotObjectIdentity } from './object';

export const FileAccessMode = {
  READ: 1,
  WRITE: 2,
  READ_WRITE: 3,
  WRITE_READ: 7,
} as const;

/** Godot 3 File.ModeFlags: unlike Godot 4 FileAccess, there is no WRITE_READ=7 member. */
export const GodotFileModeFlags = Object.freeze({
  READ: 1,
  WRITE: 2,
  READ_WRITE: 3,
} as const);

const LEGACY_STORAGE_PREFIX = 'godot-compat:filesystem:v1:';
const LEGACY_RESOURCE_PREFIX = 'godot-compat:resource:user://';
const memoryFileSystems = new Map<string, StoredFileSystemSnapshot>();
const durableStores = new Map<string, IndexedDbFileSystemStore>();
const filesystemInitializations = new Map<string, Promise<void>>();
const projectFiles = new Map<string, Map<string, Uint8Array>>();
const projectFileTimes = new Map<string, Map<string, number>>();
let projectKey: string | undefined;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let lastFileOpenError = 0;
let temporaryFileSequence = 0;

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function legacyStorageKey(key: string): string {
  return `${LEGACY_STORAGE_PREFIX}${encodeURIComponent(key)}`;
}

/** Bind this copied compat module to the translated project that owns its user:// namespace. */
export function configureGodotFileSystem(key: string): void {
  const normalized = key.trim();
  if (normalized === '') throw new Error('Godot filesystem project key cannot be empty.');
  projectKey = normalized;
}

function configuredKey(): string {
  if (projectKey === undefined) {
    throw new Error('Godot filesystem is not configured. Call configureGodotFileSystem(projectKey).');
  }
  return projectKey;
}

function readLegacyFileSystem(key: string): StoredFileSystemSnapshot | undefined {
  let raw: string | null | undefined;
  try {
    raw = browserStorage()?.getItem(legacyStorageKey(key));
  } catch {
    return undefined;
  }
  if (raw === null || raw === undefined) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<StoredFileSystemSnapshot>;
    return {
      files: typeof value.files === 'object' && value.files !== null ? { ...value.files } : {},
      directories: Array.isArray(value.directories)
        ? value.directories.filter((entry): entry is string => typeof entry === 'string')
        : ['res://', 'user://'],
    };
  } catch {
    return undefined;
  }
}

function legacyResourceSaves(): readonly { readonly key: string; readonly path: string; readonly json: string }[] {
  const storage = browserStorage();
  if (storage === undefined) return [];
  const saves: { key: string; path: string; json: string }[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key === null || !key.startsWith(LEGACY_RESOURCE_PREFIX)) continue;
      const path = `user://${key.slice(LEGACY_RESOURCE_PREFIX.length)}`;
      const json = storage.getItem(key);
      if (json !== null) saves.push({ key, path, json });
    }
  } catch {
    return [];
  }
  return saves;
}

function durableStore(key = configuredKey()): IndexedDbFileSystemStore {
  let store = durableStores.get(key);
  if (store !== undefined) return store;
  store = createIndexedDbFileSystemStore(key);
  durableStores.set(key, store);
  return store;
}

/** Hydrate the synchronous user:// shadow before translated scripts execute. */
export async function initializeGodotFileSystem(): Promise<void> {
  const key = configuredKey();
  let initialization = filesystemInitializations.get(key);
  if (initialization === undefined) {
    initialization = (async () => {
      let persisted = await durableStore(key).load();
      const legacy = readLegacyFileSystem(key);
      let needsPersistence = false;
      if (persisted === null && legacy !== undefined) {
        persisted = legacy;
        needsPersistence = true;
      }
      let snapshot = persisted ?? { files: {}, directories: ['res://', 'user://'] };
      const migratedKeys: string[] = [];
      for (const save of legacyResourceSaves()) {
        if (snapshot.files[save.path] !== undefined) continue;
        snapshot = ensureParentDirectories(save.path, {
          files: { ...snapshot.files, [save.path]: encodeBase64(encoder.encode(save.json)) },
          directories: snapshot.directories,
        });
        migratedKeys.push(save.key);
      }
      if (migratedKeys.length > 0) {
        needsPersistence = true;
      }
      if (needsPersistence) durableStore(key).write(snapshot);
      if (migratedKeys.length > 0) {
        await durableStore(key).flush();
        if (typeof indexedDB !== 'undefined') {
          const storage = browserStorage();
          for (const migratedKey of migratedKeys) storage?.removeItem(migratedKey);
        }
      }
      memoryFileSystems.set(key, snapshot);
    })();
    filesystemInitializations.set(key, initialization);
  }
  await initialization;
}

/** Await queued browser persistence, used by hosts that need a durable save boundary. */
export async function flushGodotFileSystemPersistence(): Promise<void> {
  await durableStore().flush();
}

/** Delete the durable user:// snapshot and synchronously reset the mounted project shadow. */
export async function resetGodotFileSystemPersistence(): Promise<void> {
  const key = configuredKey();
  await durableStore(key).reset();
  browserStorage()?.removeItem(legacyStorageKey(key));
  memoryFileSystems.set(key, { files: {}, directories: ['res://', 'user://'] });
}

function readFileSystem(): StoredFileSystemSnapshot {
  const key = configuredKey();
  return memoryFileSystems.get(key) ?? { files: {}, directories: ['res://', 'user://'] };
}

function writeFileSystem(next: StoredFileSystemSnapshot): void {
  const key = configuredKey();
  const snapshot: StoredFileSystemSnapshot = {
    files: { ...next.files },
    directories: [...next.directories],
    metadata: Object.fromEntries(
      Object.entries(next.metadata ?? readFileSystem().metadata ?? {}).map(([path, value]) => [
        path,
        { ...value },
      ]),
    ),
  };
  memoryFileSystems.set(key, snapshot);
  durableStore(key).write(snapshot);
}

function normalizePath(path: string, base = 'user://'): string {
  const source = path.replace(/\\/g, '/');
  const rooted = source.startsWith('res://') || source.startsWith('user://')
    ? source
    : `${base.replace(/\/$/, '')}/${source}`;
  const schemeEnd = rooted.indexOf('://') + 3;
  const scheme = rooted.slice(0, schemeEnd);
  const parts: string[] = [];
  for (const part of rooted.slice(schemeEnd).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return scheme + parts.join('/');
}

function simplifyAbsolutePath(path: string): string {
  const source = path.replace(/\\/g, '/');
  const windowsDrive = /^[A-Za-z]:\//.exec(source)?.[0] ?? '';
  const rooted = source.startsWith('/') || windowsDrive !== '';
  if (!rooted) return source;
  const start = windowsDrive === '' ? 1 : windowsDrive.length;
  const parts: string[] = [];
  for (const part of source.slice(start).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `${windowsDrive === '' ? '/' : windowsDrive}${parts.join('/')}`;
}

/** `ProjectSettings.globalize_path` projected onto the browser's native address spaces. */
export function godotProjectGlobalizePath(path: string): string {
  if (typeof path !== 'string') {
    throw new TypeError('ProjectSettings.globalize_path requires a String path.');
  }
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return simplifyAbsolutePath(path);
  if (path.startsWith('res://')) {
    const normalized = normalizePath(path, 'res://');
    const servedPath = `/${normalized.slice('res://'.length)}`;
    if (typeof location === 'undefined') return servedPath;
    return new URL(servedPath, location.href).href;
  }
  if (path.startsWith('user://')) {
    const normalized = normalizePath(path, 'user://');
    const encoded = readFileSystem().files[normalized];
    if (encoded === undefined) {
      // The URL remains a browser-native address to the project-scoped virtual mount. FileAccess
      // can create it later; callers that require bytes use FileAccess rather than fetch.
      return `indexeddb://${encodeURIComponent(configuredKey())}/${normalized.slice('user://'.length)}`;
    }
    return `data:application/octet-stream;base64,${encoded}`;
  }
  throw new Error(
    `ProjectSettings.globalize_path(${JSON.stringify(path)}) cannot resolve a relative path without a native project root.`,
  );
}

function decodedBrowserPath(pathname: string): string {
  return pathname
    .split('/')
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        throw new Error(
          `ProjectSettings.localize_path cannot decode browser path segment ${JSON.stringify(part)}.`,
        );
      }
    })
    .join('/');
}

function projectRelativePath(path: string): { readonly simplified: string; readonly local?: string } {
  const parts: string[] = [];
  let escapedParents = 0;
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) escapedParents += 1;
      else parts.pop();
    } else {
      parts.push(part);
    }
  }
  const simplified = `${'../'.repeat(escapedParents)}${parts.join('/')}`.replace(/\/$/, '');
  return escapedParents === 0
    ? { simplified, local: `res://${parts.join('/')}` }
    : { simplified };
}

/**
 * `ProjectSettings.localize_path` over the translated project's browser resource mount.
 *
 * Source authority: Godot 3.6 `core/project_settings.cpp:62-112` and Godot 4.7
 * `core/config/project_settings.cpp`, `ProjectSettings::localize_path`.
 *
 * `res://`/`user://` are already local. Relative and root-relative browser paths are rooted at the
 * translated project's `/` resource mount, and same-origin URLs invert `globalize_path(res://…)`.
 * Native filesystem paths, outside-origin URLs, and root escapes have no browser project identity,
 * so they remain unlocalized exactly as Godot does for paths outside its resource root.
 */
export function godotProjectLocalizePath(path: string): string {
  if (typeof path !== 'string') {
    throw new TypeError('ProjectSettings.localize_path requires a String path.');
  }
  if (path.startsWith('res://')) return normalizePath(path, 'res://');
  if (path.startsWith('user://')) return normalizePath(path, 'user://');
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    return simplifyAbsolutePath(path);
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path)) {
    let url: URL;
    try {
      url = new URL(path);
    } catch {
      // Godot treats an unrecognized protocol identifier as already-localized and returns its
      // simplified spelling. With no valid URL path grammar to simplify, the exact spelling is it.
      return path;
    }
    if (
      typeof location === 'undefined' ||
      url.origin !== location.origin ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return url.href;
    }
    return normalizePath(
      `res://${decodedBrowserPath(url.pathname).replace(/^\//, '')}`,
      'res://',
    );
  }
  if (path.startsWith('/')) {
    return normalizePath(`res://${decodedBrowserPath(path).replace(/^\//, '')}`, 'res://');
  }
  const relative = projectRelativePath(path);
  return relative.local ?? relative.simplified;
}

function parentPath(path: string): string {
  const normalized = normalizePath(path);
  const schemeEnd = normalized.indexOf('://') + 3;
  const slash = normalized.lastIndexOf('/');
  return slash < schemeEnd ? normalized.slice(0, schemeEnd) : normalized.slice(0, slash);
}

function ensureParentDirectories(
  path: string,
  fs: StoredFileSystemSnapshot,
): StoredFileSystemSnapshot {
  const directories = new Set(fs.directories);
  let parent = parentPath(path);
  while (parent.endsWith('://') === false) {
    directories.add(parent);
    parent = parentPath(parent);
  }
  directories.add(parent);
  return {
    files: fs.files,
    directories: [...directories],
    ...(fs.metadata === undefined ? {} : { metadata: fs.metadata }),
  };
}

function encodeBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const packed = (a << 16) | (b << 8) | c;
    result += alphabet[(packed >>> 18) & 63];
    result += alphabet[(packed >>> 12) & 63];
    result += index + 1 < bytes.length ? alphabet[(packed >>> 6) & 63] : '=';
    result += index + 2 < bytes.length ? alphabet[packed & 63] : '=';
  }
  return result;
}

function decodeBase64(value: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = value.replace(/[^A-Za-z0-9+/=]/g, '');
  const bytes: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const a = alphabet.indexOf(clean[index] ?? 'A');
    const b = alphabet.indexOf(clean[index + 1] ?? 'A');
    const c = clean[index + 2] === '=' ? 0 : alphabet.indexOf(clean[index + 2] ?? 'A');
    const d = clean[index + 3] === '=' ? 0 : alphabet.indexOf(clean[index + 3] ?? 'A');
    const packed = (a << 18) | (b << 12) | (c << 6) | d;
    bytes.push((packed >>> 16) & 255);
    if (clean[index + 2] !== '=') bytes.push((packed >>> 8) & 255);
    if (clean[index + 3] !== '=') bytes.push(packed & 255);
  }
  return Uint8Array.from(bytes);
}

function storedBytes(path: string): Uint8Array | undefined {
  const normalized = normalizePath(path);
  if (normalized.startsWith('res://')) {
    return projectFiles.get(configuredKey())?.get(normalized)?.slice();
  }
  const encoded = readFileSystem().files[normalized];
  return encoded === undefined ? undefined : decodeBase64(encoded);
}

function storeBytes(path: string, bytes: Uint8Array): void {
  const normalized = normalizePath(path);
  if (normalized.startsWith('res://')) {
    throw new Error(`Godot res:// is read-only in an exported project: ${normalized}`);
  }
  let fs = readFileSystem();
  fs = ensureParentDirectories(normalized, fs);
  const now = Math.floor(Date.now() / 1000);
  const prior = fs.metadata?.[normalized];
  writeFileSystem({
    files: { ...fs.files, [normalized]: encodeBase64(bytes) },
    directories: fs.directories,
    metadata: {
      ...(fs.metadata ?? {}),
      [normalized]: {
        modifiedTime: now,
        accessTime: prior?.accessTime ?? now,
        unixPermissions: prior?.unixPermissions ?? 0o644,
      },
    },
  });
}

function fileTime(path: string, kind: 'modifiedTime' | 'accessTime'): number {
  const normalized = normalizePath(path);
  if (!fileExists(normalized)) return 0;
  if (normalized.startsWith('res://')) {
    return projectFileTimes.get(configuredKey())?.get(normalized) ?? 0;
  }
  return readFileSystem().metadata?.[normalized]?.[kind] ?? 0;
}

function unixPermissions(path: string): number {
  const normalized = normalizePath(path);
  if (!fileExists(normalized) && !directoryExists(normalized)) return 0;
  return readFileSystem().metadata?.[normalized]?.unixPermissions ??
    (directoryExists(normalized) ? 0o755 : 0o644);
}

function setUnixPermissions(path: string, permissions: number): number {
  const normalized = normalizePath(path);
  if (normalized.startsWith('res://')) return 1;
  if (!fileExists(normalized) && !directoryExists(normalized)) return 7;
  if (!Number.isInteger(permissions) || permissions < 0 || permissions > 0o7777) return 31;
  const fs = readFileSystem();
  const prior = fs.metadata?.[normalized];
  const now = Math.floor(Date.now() / 1000);
  writeFileSystem({
    ...fs,
    metadata: {
      ...(fs.metadata ?? {}),
      [normalized]: {
        modifiedTime: prior?.modifiedTime ?? now,
        accessTime: prior?.accessTime ?? now,
        unixPermissions: permissions,
      },
    },
  });
  return 0;
}

/** Snapshot mounted authored and durable user paths for ResourceLoader/DirAccess enumeration. */
export function godotFileSystemPaths(): readonly string[] {
  const authored = [...(projectFiles.get(configuredKey())?.keys() ?? [])];
  return [...new Set([...authored, ...Object.keys(readFileSystem().files)])].sort();
}

/** Seed a translated project's authored res:// bytes before its scripts run. */
export function registerProjectFile(path: string, bytes: Uint8Array | string): void {
  const normalized = normalizePath(path, 'res://');
  if (!normalized.startsWith('res://')) throw new Error(`Project file must use res://: ${path}`);
  const mounted = projectFiles.get(configuredKey()) ?? new Map<string, Uint8Array>();
  mounted.set(normalized, (typeof bytes === 'string' ? encoder.encode(bytes) : bytes).slice());
  projectFiles.set(configuredKey(), mounted);
  const times = projectFileTimes.get(configuredKey()) ?? new Map<string, number>();
  times.set(normalized, Math.floor(Date.now() / 1000));
  projectFileTimes.set(configuredKey(), times);
}

/** Load authored res:// bytes before synchronous FileAccess calls begin. */
export async function registerProjectFileUrl(path: string, url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load Godot project file ${path} (${response.status}).`);
  registerProjectFile(path, new Uint8Array(await response.arrayBuffer()));
}

export class GodotFileAccess {
  static readonly READ = FileAccessMode.READ;
  static readonly WRITE = FileAccessMode.WRITE;
  static readonly READ_WRITE = FileAccessMode.READ_WRITE;
  static readonly WRITE_READ = FileAccessMode.WRITE_READ;
  private position = 0;
  private open = true;
  private dirty: boolean;
  private bigEndian = false;
  private lastError = 0;

  private constructor(
    readonly path: string,
    readonly mode: number,
    private bytes: Uint8Array,
    private readonly removeOnClose = false,
  ) {
    this.dirty = mode === FileAccessMode.WRITE || mode === FileAccessMode.WRITE_READ;
    registerGodotObjectIdentity(this, 'FileAccess');
  }

  static open(path: string, mode: number): GodotFileAccess | null {
    if (
      mode !== FileAccessMode.READ &&
      mode !== FileAccessMode.WRITE &&
      mode !== FileAccessMode.READ_WRITE &&
      mode !== FileAccessMode.WRITE_READ
    ) {
      lastFileOpenError = 31;
      return null;
    }
    const normalized = normalizePath(path);
    if (normalized.startsWith('res://') && mode !== FileAccessMode.READ) {
      lastFileOpenError = 12;
      return null;
    }
    const existing = storedBytes(normalized);
    if ((mode === FileAccessMode.READ || mode === FileAccessMode.READ_WRITE) && existing === undefined) {
      lastFileOpenError = 7;
      return null;
    }
    const bytes = mode === FileAccessMode.WRITE || mode === FileAccessMode.WRITE_READ
      ? new Uint8Array()
      : existing ?? new Uint8Array();
    lastFileOpenError = 0;
    return new GodotFileAccess(normalized, mode, bytes);
  }

  /**
   * Godot's password-encrypted FileAccess is synchronous: a successful call returns a readable
   * handle before the next GDScript expression executes. Browser SubtleCrypto derives/imports the
   * password key and decrypts AES only through Promises. Blocking that Promise on the browser main
   * thread is impossible (and would deadlock delivery of its completion), while returning either
   * a Promise or an undecrypted handle would violate the pinned API. Preserve the ordinary open
   * errors that can be decided without crypto, then refuse exactly where cryptography is required.
   */
  static open_encrypted_with_pass(
    path: string,
    mode: number,
    password: string,
  ): GodotFileAccess | null {
    if (
      typeof password !== 'string' ||
      (mode !== FileAccessMode.READ &&
        mode !== FileAccessMode.WRITE &&
        mode !== FileAccessMode.READ_WRITE &&
        mode !== FileAccessMode.WRITE_READ)
    ) {
      lastFileOpenError = 31; // ERR_INVALID_PARAMETER
      return null;
    }
    const normalized = normalizePath(path);
    if (normalized.startsWith('res://') && mode !== FileAccessMode.READ) {
      lastFileOpenError = 12; // ERR_FILE_CANT_OPEN
      return null;
    }
    if (
      (mode === FileAccessMode.READ || mode === FileAccessMode.READ_WRITE) &&
      storedBytes(normalized) === undefined
    ) {
      lastFileOpenError = 7; // ERR_FILE_NOT_FOUND
      return null;
    }
    lastFileOpenError = 2; // ERR_UNAVAILABLE
    const availability = globalThis.crypto?.subtle === undefined
      ? 'Web Crypto SubtleCrypto is unavailable in this host'
      : 'Web Crypto SubtleCrypto is asynchronous and cannot satisfy Godot’s synchronous open contract';
    throw new Error(
      `FileAccess.open_encrypted_with_pass(${JSON.stringify(normalized)}) is unavailable: ${availability}. ` +
      'No plaintext or partially initialized FileAccess handle was returned.',
    );
  }

  static get_open_error(): number { return lastFileOpenError; }

  static create_temp(
    mode = FileAccessMode.READ_WRITE,
    prefix = '',
    extension = '',
    keep = false,
  ): GodotFileAccess | null {
    if (![FileAccessMode.READ_WRITE, FileAccessMode.WRITE_READ].includes(mode as 3 | 7)) {
      lastFileOpenError = 31;
      return null;
    }
    const safePrefix = String(prefix).replace(/[^A-Za-z0-9_.-]/g, '_');
    const safeExtension = String(extension).replace(/^\./, '').replace(/[^A-Za-z0-9_-]/g, '_');
    const suffix = safeExtension === '' ? '' : `.${safeExtension}`;
    const path = `user://.tmp/${safePrefix}${temporaryFileSequence++}${suffix}`;
    lastFileOpenError = 0;
    return new GodotFileAccess(path, mode, new Uint8Array(), !keep);
  }

  static file_exists(path: string): boolean {
    return storedBytes(path) !== undefined;
  }

  static get_file_as_bytes(path: string): Uint8Array {
    return storedBytes(path) ?? new Uint8Array();
  }

  static get_file_as_string(path: string): string {
    return decoder.decode(this.get_file_as_bytes(path));
  }

  static get_sha256(path: string): string {
    return sha256Hex(this.get_file_as_bytes(path));
  }

  static get_md5(path: string): string {
    return md5Hex(this.get_file_as_bytes(path));
  }

  static get_size(path: string): number {
    return storedBytes(path)?.length ?? -1;
  }

  static get_modified_time(path: string): number { return fileTime(path, 'modifiedTime'); }
  static get_access_time(path: string): number { return fileTime(path, 'accessTime'); }
  static get_unix_permissions(path: string): number { return unixPermissions(path); }
  static set_unix_permissions(path: string, permissions: number): number {
    return setUnixPermissions(path, permissions);
  }

  is_open(): boolean {
    return this.open;
  }

  close(): void {
    if (!this.open) return;
    if (this.dirty) storeBytes(this.path, this.bytes);
    this.open = false;
    if (this.removeOnClose) removePath(this.path);
  }

  get_position(): number {
    return this.position;
  }

  get_length(): number {
    return this.bytes.length;
  }

  get_path(): string { return this.path; }
  get_path_absolute(): string { return this.path; }

  get_big_endian(): boolean { return this.bigEndian; }
  is_big_endian(): boolean { return this.bigEndian; }

  set_big_endian(enabled: boolean): void {
    if (typeof enabled !== 'boolean') {
      throw new TypeError('FileAccess.big_endian requires a bool value.');
    }
    this.bigEndian = enabled;
  }

  eof_reached(): boolean {
    return this.lastError === 18;
  }

  get_error(): number { return this.lastError; }

  seek(position: number): void {
    this.position = Math.max(0, Math.trunc(position));
    this.lastError = 0;
  }

  seek_end(offset = 0): void {
    this.position = Math.max(0, this.bytes.length + Math.trunc(offset));
    this.lastError = 0;
  }

  get_8(): number { return this.readNumber(1, (view) => view.getUint8(0)); }
  get_16(): number { return this.readNumber(2, (view) => view.getUint16(0, !this.bigEndian)); }
  get_32(): number { return this.readNumber(4, (view) => view.getUint32(0, !this.bigEndian)); }
  get_64(): number {
    const value = this.readNumber(8, (view) => view.getBigUint64(0, !this.bigEndian));
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError(`FileAccess.get_64 exceeds JavaScript's safe integer domain: ${value}`);
    }
    return Number(value);
  }
  get_float(): number { return this.readNumber(4, (view) => view.getFloat32(0, !this.bigEndian)); }
  get_half(): number {
    return halfBitsToNumber(this.readNumber(2, (view) => view.getUint16(0, !this.bigEndian)));
  }
  get_double(): number { return this.readNumber(8, (view) => view.getFloat64(0, !this.bigEndian)); }
  get_real(): number { return this.get_float(); }

  get_buffer(length: number): Uint8Array {
    this.requireOpen();
    const requested = Math.max(0, Math.trunc(length));
    const end = Math.min(this.bytes.length, this.position + requested);
    const result = this.bytes.slice(this.position, end);
    this.position = end;
    this.lastError = result.length < requested ? 18 : 0;
    return result;
  }

  get_as_text(skipCr = false): string {
    const text = decoder.decode(this.get_buffer(this.bytes.length - this.position));
    return skipCr ? text.replace(/\r/g, '') : text;
  }

  get_line(): string {
    this.requireOpen();
    if (this.position >= this.bytes.length) {
      this.lastError = 18;
      return '';
    }
    const rest = this.bytes.subarray(this.position);
    const newline = rest.indexOf(10);
    const length = newline < 0 ? rest.length : newline;
    const line = decoder.decode(this.bytes.subarray(this.position, this.position + length));
    this.position += length;
    if (newline >= 0) {
      this.position += 1;
      this.lastError = 0;
    } else {
      // Godot's line reader scans for a terminator and observes EOF after the
      // final unterminated line, even though the returned line is complete.
      this.lastError = 18;
    }
    return line.endsWith('\r') ? line.slice(0, -1) : line;
  }

  get_csv_line(delimiter = ','): PackedStringArray {
    if ([...delimiter].length !== 1) throw new Error('FileAccess CSV delimiter must be one character.');
    const row = this.get_line();
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < row.length; index += 1) {
      const char = row[index] ?? '';
      if (char === '"') {
        if (quoted && row[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        cells.push(cell);
        cell = '';
      } else cell += char;
    }
    cells.push(cell);
    return packedStringArray(cells);
  }

  get_utf8_string(length: number): string {
    return decoder.decode(this.get_buffer(length));
  }

  get_pascal_string(): string {
    const length = this.get_32();
    return this.get_utf8_string(length);
  }

  get_var(allowObjects = false): unknown {
    if (allowObjects) {
      throw new Error('FileAccess.get_var(allow_objects=true) cannot instantiate arbitrary Godot Objects.');
    }
    const length = this.get_32();
    const decoded = godotDecodeVariant(packedByteArray(this.get_buffer(length)));
    if (decoded === null) throw new Error(`FileAccess.get_var found an invalid Variant at ${this.path}.`);
    return decoded.value;
  }

  store_8(value: number): void { this.writeNumber(1, (view) => view.setUint8(0, value)); }
  store_16(value: number): void { this.writeNumber(2, (view) => view.setUint16(0, value, !this.bigEndian)); }
  store_32(value: number): void { this.writeNumber(4, (view) => view.setUint32(0, value, !this.bigEndian)); }
  store_64(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`FileAccess.store_64 requires a non-negative safe integer, got ${value}`);
    }
    this.writeNumber(8, (view) => view.setBigUint64(0, BigInt(value), !this.bigEndian));
  }
  store_float(value: number): void { this.writeNumber(4, (view) => view.setFloat32(0, value, !this.bigEndian)); }
  store_half(value: number): void {
    this.writeNumber(2, (view) => view.setUint16(0, numberToHalfBits(value), !this.bigEndian));
  }
  store_double(value: number): void { this.writeNumber(8, (view) => view.setFloat64(0, value, !this.bigEndian)); }
  store_real(value: number): void { this.store_float(value); }

  store_buffer(value: Uint8Array | readonly number[]): void {
    this.requireWritable();
    const input = value instanceof Uint8Array ? value : Uint8Array.from(value);
    const needed = this.position + input.length;
    if (needed > this.bytes.length) {
      const grown = new Uint8Array(needed);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes.set(input, this.position);
    this.position = needed;
    this.dirty = true;
    this.lastError = 0;
  }

  store_string(value: string): void { this.store_buffer(encoder.encode(value)); }
  store_pascal_string(value: string): void {
    const bytes = encoder.encode(value);
    this.store_32(bytes.length);
    this.store_buffer(bytes);
  }

  store_var(value: unknown, fullObjects = false): void {
    if (fullObjects) {
      throw new Error('FileAccess.store_var(full_objects=true) cannot serialize arbitrary Godot Objects.');
    }
    const bytes = godotEncodeVariant(value);
    this.store_32(bytes.length);
    this.store_buffer(bytes);
  }
  store_line(value: string): void { this.store_string(`${value}\n`); }
  store_csv_line(values: readonly string[], delimiter = ','): void {
    if ([...delimiter].length !== 1) throw new Error('FileAccess CSV delimiter must be one character.');
    this.store_line(values.map((value) => {
      const escaped = value.replace(/"/g, '""');
      return value.includes(delimiter) || /["\r\n]/.test(value) ? `"${escaped}"` : escaped;
    }).join(delimiter));
  }

  flush(): void {
    this.requireOpen();
    if (this.dirty) storeBytes(this.path, this.bytes);
    this.dirty = false;
  }

  resize(length: number): number {
    this.requireWritable();
    if (!Number.isSafeInteger(length) || length < 0) return 31;
    const resized = new Uint8Array(length);
    resized.set(this.bytes.subarray(0, length));
    this.bytes = resized;
    this.position = Math.min(this.position, length);
    this.dirty = true;
    return 0;
  }

  private readNumber<T>(size: number, read: (view: DataView) => T): T {
    const bytes = this.get_buffer(size);
    const padded = new Uint8Array(size);
    padded.set(bytes);
    return read(new DataView(padded.buffer));
  }

  private writeNumber(size: number, write: (view: DataView) => void): void {
    const bytes = new Uint8Array(size);
    write(new DataView(bytes.buffer));
    this.store_buffer(bytes);
  }

  private requireOpen(): void {
    if (!this.open) throw new Error(`FileAccess is closed: ${this.path}`);
  }

  private requireWritable(): void {
    this.requireOpen();
    if (this.mode === FileAccessMode.READ) throw new Error(`FileAccess is read-only: ${this.path}`);
  }
}

/** Godot 3's stateful File facade over the same project filesystem used by Godot 4 FileAccess. */
export class GodotFile {
  static readonly READ = GodotFileModeFlags.READ;
  static readonly WRITE = GodotFileModeFlags.WRITE;
  static readonly READ_WRITE = GodotFileModeFlags.READ_WRITE;
  private handle: GodotFileAccess | null = null;

  constructor() {
    registerGodotObjectIdentity(this, 'File');
  }

  open(path: string, mode: number): number {
    this.close();
    const handle = GodotFileAccess.open(path, mode);
    if (handle === null) {
      return GodotFileAccess.get_open_error();
    }
    this.handle = handle;
    return 0; // OK
  }

  open_encrypted_with_pass(path: string, mode: number, password: string): number {
    this.close();
    const handle = GodotFileAccess.open_encrypted_with_pass(path, mode, password);
    if (handle === null) return GodotFileAccess.get_open_error();
    this.handle = handle;
    return 0; // OK
  }

  file_exists(path: string): boolean {
    return GodotFileAccess.file_exists(path);
  }

  close(): void {
    this.handle?.close();
    this.handle = null;
  }

  get_as_text(skipCr = true): string {
    return this.requireHandle().get_as_text(skipCr);
  }

  get_line(): string {
    return this.requireHandle().get_line();
  }

  get_len(): number { return this.requireHandle().get_length(); }
  get_path(): string { return this.requireHandle().get_path(); }
  get_path_absolute(): string { return this.requireHandle().get_path_absolute(); }
  get_position(): number { return this.requireHandle().get_position(); }
  eof_reached(): boolean { return this.requireHandle().eof_reached(); }
  seek(position: number): void { this.requireHandle().seek(position); }
  seek_end(offset = 0): void { this.requireHandle().seek_end(offset); }
  get_8(): number { return this.requireHandle().get_8(); }
  get_16(): number { return this.requireHandle().get_16(); }
  get_32(): number { return this.requireHandle().get_32(); }
  get_64(): number { return this.requireHandle().get_64(); }
  get_float(): number { return this.requireHandle().get_float(); }
  get_real(): number { return this.requireHandle().get_float(); }
  get_double(): number { return this.requireHandle().get_double(); }
  get_buffer(length: number): Uint8Array { return this.requireHandle().get_buffer(length); }
  get_var(allowObjects = false): unknown { return this.requireHandle().get_var(allowObjects); }
  get_csv_line(delimiter = ','): PackedStringArray {
    return this.requireHandle().get_csv_line(delimiter);
  }
  get_utf8_string(length: number): string { return this.requireHandle().get_utf8_string(length); }
  get_pascal_string(): string { return this.requireHandle().get_pascal_string(); }
  get_error(): number { return this.requireHandle().get_error(); }
  get_md5(path: string): string { return GodotFileAccess.get_md5(path); }
  get_sha256(path: string): string { return GodotFileAccess.get_sha256(path); }
  get_modified_time(path: string): number { return GodotFileAccess.get_modified_time(path); }
  get_unix_permissions(path: string): number { return GodotFileAccess.get_unix_permissions(path); }
  set_unix_permissions(path: string, permissions: number): number {
    return GodotFileAccess.set_unix_permissions(path, permissions);
  }

  store_string(value: string): void {
    this.requireHandle().store_string(value);
  }

  store_line(value: string): void { this.requireHandle().store_line(value); }
  store_8(value: number): void { this.requireHandle().store_8(value); }
  store_16(value: number): void { this.requireHandle().store_16(value); }
  store_32(value: number): void { this.requireHandle().store_32(value); }
  store_64(value: number): void { this.requireHandle().store_64(value); }
  store_float(value: number): void { this.requireHandle().store_float(value); }
  store_real(value: number): void { this.requireHandle().store_float(value); }
  store_double(value: number): void { this.requireHandle().store_double(value); }
  store_buffer(value: Uint8Array | readonly number[]): void {
    this.requireHandle().store_buffer(value);
  }
  store_var(value: unknown, fullObjects = false): void {
    this.requireHandle().store_var(value, fullObjects);
  }
  store_pascal_string(value: string): void { this.requireHandle().store_pascal_string(value); }
  store_csv_line(values: readonly string[], delimiter = ','): void {
    this.requireHandle().store_csv_line(values, delimiter);
  }

  flush(): void { this.requireHandle().flush(); }
  resize(length: number): number { return this.requireHandle().resize(length); }

  is_open(): boolean { return this.handle?.is_open() ?? false; }

  get_big_endian(): boolean { return this.requireHandle().get_big_endian(); }
  set_big_endian(value: boolean): void { this.requireHandle().set_big_endian(value); }
  get_endian_swap(): boolean { return this.requireHandle().get_big_endian(); }
  set_endian_swap(value: boolean): void { this.requireHandle().set_big_endian(value); }

  private requireHandle(): GodotFileAccess {
    if (this.handle === null) throw new Error('Godot File operation requires a successfully opened file.');
    return this.handle;
  }
}

export function fileAccessOpen(path: string, mode: number): GodotFileAccess | null {
  return GodotFileAccess.open(path, mode);
}
export const fileAccessFileExists = GodotFileAccess.file_exists.bind(GodotFileAccess);
export const fileAccessGetFileAsBytes = GodotFileAccess.get_file_as_bytes.bind(GodotFileAccess);
export const fileAccessGetFileAsString = GodotFileAccess.get_file_as_string.bind(GodotFileAccess);
export const fileAccessGetSha256 = GodotFileAccess.get_sha256.bind(GodotFileAccess);
export const fileAccessGetMd5 = GodotFileAccess.get_md5.bind(GodotFileAccess);
export const fileAccessGetSize = GodotFileAccess.get_size.bind(GodotFileAccess);
export const fileAccessCreateTemp = GodotFileAccess.create_temp.bind(GodotFileAccess);
export const fileAccessGetModifiedTime = GodotFileAccess.get_modified_time.bind(GodotFileAccess);
export const fileAccessGetAccessTime = GodotFileAccess.get_access_time.bind(GodotFileAccess);
export const fileAccessGetUnixPermissions = GodotFileAccess.get_unix_permissions.bind(GodotFileAccess);
export const fileAccessSetUnixPermissions = GodotFileAccess.set_unix_permissions.bind(GodotFileAccess);

function halfBitsToNumber(bits: number): number {
  const sign = (bits & 0x8000) === 0 ? 1 : -1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function numberToHalfBits(value: number): number {
  const float = new Float32Array(1);
  const word = new Uint32Array(float.buffer);
  float[0] = value;
  const bits = word[0] ?? 0;
  const sign = (bits >>> 16) & 0x8000;
  let exponent = ((bits >>> 23) & 0xff) - 127 + 15;
  let fraction = bits & 0x007fffff;
  if (exponent <= 0) {
    if (exponent < -10) return sign;
    fraction = (fraction | 0x00800000) >>> (1 - exponent);
    if ((fraction & 0x00001000) !== 0) fraction += 0x00002000;
    return sign | (fraction >>> 13);
  }
  if (exponent >= 0x1f) {
    if (((bits >>> 23) & 0xff) === 0xff && fraction !== 0) return sign | 0x7e00;
    return sign | 0x7c00;
  }
  if ((fraction & 0x00001000) !== 0) {
    fraction += 0x00002000;
    if ((fraction & 0x00800000) !== 0) {
      fraction = 0;
      exponent += 1;
      if (exponent >= 0x1f) return sign | 0x7c00;
    }
  }
  return sign | (exponent << 10) | (fraction >>> 13);
}

let lastDirOpenError = 0;
let temporaryDirectorySerial = 0;

export class GodotDirAccess {
  private entries: string[] = [];
  private entryIndex = 0;
  private currentEntry = '';
  private includeNavigational = false;
  private includeHidden = false;

  private constructor(private currentDir: string) {}

  static open(path: string): GodotDirAccess | null {
    const normalized = normalizePath(path);
    if (!directoryExists(normalized)) {
      lastDirOpenError = 7;
      return null;
    }
    lastDirOpenError = 0;
    return new GodotDirAccess(normalized);
  }

  static get_open_error(): number { return lastDirOpenError; }

  static create_temp(prefix = '', keep = false): GodotDirAccess | null {
    if (typeof prefix !== 'string' || typeof keep !== 'boolean') {
      throw new TypeError('DirAccess.create_temp requires String prefix and bool keep.');
    }
    const safePrefix = prefix.replace(/[^A-Za-z0-9_.-]/gu, '_');
    const path = `user://tmp/${safePrefix}${Date.now().toString(36)}-${(++temporaryDirectorySerial).toString(36)}`;
    if (makeDirectory(path, true) !== 0) { lastDirOpenError = 20; return null; }
    lastDirOpenError = 0;
    void keep;
    return new GodotDirAccess(path);
  }

  static get_files_at(path: string): PackedStringArray {
    return packedStringArray(this.open(path)?.get_files() ?? []);
  }

  static get_directories_at(path: string): PackedStringArray {
    return packedStringArray(this.open(path)?.get_directories() ?? []);
  }

  static copy_absolute(from: string, to: string): number {
    return copyPath(normalizePath(from), normalizePath(to));
  }

  static dir_exists_absolute(path: string): boolean { return directoryExists(normalizePath(path)); }
  static make_dir_absolute(path: string): number { return makeDirectory(normalizePath(path), false); }
  static make_dir_recursive_absolute(path: string): number { return makeDirectory(normalizePath(path), true); }
  static remove_absolute(path: string): number { return removePath(normalizePath(path)); }
  static rename_absolute(from: string, to: string): number { return renamePath(normalizePath(from), normalizePath(to)); }

  static get_modified_time(path: string): number { return fileTime(path, 'modifiedTime'); }
  static get_unix_permissions(path: string): number { return unixPermissions(path); }
  static set_unix_permissions(path: string, permissions: number): number {
    return setUnixPermissions(path, permissions);
  }

  get_current_dir(): string { return this.currentDir; }
  get_drive_count(): number { return 2; }
  get_drive_name(index: number): string {
    if (index === 0) return 'res://';
    if (index === 1) return 'user://';
    throw new RangeError(`DirAccess.get_drive_name index ${String(index)} is outside [0, 2).`);
  }
  get_drive_label(index: number): string { return index === 0 ? 'Project' : index === 1 ? 'User Data' : ''; }
  get_current_drive(): number { return this.currentDir.startsWith('user://') ? 1 : 0; }
  get_space_left(): number {
    const estimate = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { readonly storage?: { estimate?: () => Promise<{ quota?: number; usage?: number }> } }).storage;
    void estimate;
    return 0;
  }
  get_filesystem_type(): string { return this.currentDir.startsWith('user://') ? 'IndexedDB' : 'HTTP'; }
  is_bundle(): boolean { return false; }
  is_link(path: string): boolean { void normalizePath(path, this.currentDir); return false; }
  read_link(path: string): string { void normalizePath(path, this.currentDir); return ''; }
  create_link(source: string, target: string): number {
    void normalizePath(source, this.currentDir);
    void normalizePath(target, this.currentDir);
    return 2;
  }

  change_dir(path: string): number {
    const normalized = normalizePath(path, this.currentDir);
    if (!directoryExists(normalized)) return 1;
    this.currentDir = normalized;
    return 0;
  }

  list_dir_begin(): number {
    const prefix = `${this.currentDir.replace(/\/$/, '')}/`;
    const names = new Set<string>();
    const fs = readFileSystem();
    const authored = [...(projectFiles.get(configuredKey())?.keys() ?? [])];
    for (const path of [...Object.keys(fs.files), ...authored, ...fs.directories]) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest !== '') names.add(rest.split('/')[0] ?? rest);
    }
    if (this.includeNavigational) {
      names.add('.');
      names.add('..');
    }
    this.entries = [...names]
      .filter((name) => this.includeHidden || !name.startsWith('.'))
      .sort();
    this.entryIndex = 0;
    this.currentEntry = '';
    return 0;
  }

  get_next(): string {
    this.currentEntry = this.entries[this.entryIndex++] ?? '';
    return this.currentEntry;
  }

  current_is_dir(): boolean {
    return this.currentEntry !== '' && directoryExists(`${this.currentDir}/${this.currentEntry}`);
  }

  list_dir_end(): void {
    this.entries = [];
    this.entryIndex = 0;
    this.currentEntry = '';
  }

  set_include_navigational(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('DirAccess.include_navigational requires bool.');
    this.includeNavigational = enabled;
  }

  get_include_navigational(): boolean { return this.includeNavigational; }

  set_include_hidden(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('DirAccess.include_hidden requires bool.');
    this.includeHidden = enabled;
  }

  get_include_hidden(): boolean { return this.includeHidden; }

  is_case_sensitive(_path: string): boolean { return true; }

  is_equivalent(pathA: string, pathB: string): boolean {
    return normalizePath(pathA, this.currentDir) === normalizePath(pathB, this.currentDir);
  }

  is_readable(path: string): boolean {
    const permissions = unixPermissions(normalizePath(path, this.currentDir));
    return (permissions & 0o444) !== 0;
  }

  is_writable(path: string): boolean {
    const normalized = normalizePath(path, this.currentDir);
    return !normalized.startsWith('res://') && (unixPermissions(normalized) & 0o222) !== 0;
  }

  get_files(): PackedStringArray {
    this.list_dir_begin();
    return packedStringArray(
      this.entries.filter((name) => fileExists(`${this.currentDir}/${name}`)),
    );
  }

  get_directories(): PackedStringArray {
    this.list_dir_begin();
    return packedStringArray(
      this.entries.filter((name) => directoryExists(`${this.currentDir}/${name}`)),
    );
  }

  file_exists(path: string): boolean { return fileExists(normalizePath(path, this.currentDir)); }
  dir_exists(path: string): boolean { return directoryExists(normalizePath(path, this.currentDir)); }
  make_dir(path: string): number { return makeDirectory(normalizePath(path, this.currentDir), false); }
  make_dir_recursive(path: string): number { return makeDirectory(normalizePath(path, this.currentDir), true); }
  remove(path: string): number { return removePath(normalizePath(path, this.currentDir)); }
  rename(from: string, to: string): number {
    return renamePath(normalizePath(from, this.currentDir), normalizePath(to, this.currentDir));
  }

  copy(from: string, to: string): number {
    return copyPath(normalizePath(from, this.currentDir), normalizePath(to, this.currentDir));
  }
}

/** Godot 3's stateful Directory facade over the same project filesystem used by DirAccess. */
export class GodotDirectory {
  private handle: GodotDirAccess | null = null;

  open(path: string): number {
    const handle = GodotDirAccess.open(path);
    if (handle === null) return 19; // ERR_CANT_OPEN
    this.handle = handle;
    return 0; // OK
  }

  copy(from: string, to: string): number {
    return this.requireHandle().copy(from, to);
  }

  dir_exists(path: string): boolean {
    return this.requireHandle().dir_exists(path);
  }

  file_exists(path: string): boolean {
    return this.requireHandle().file_exists(path);
  }

  get_current_dir(): string {
    return this.requireHandle().get_current_dir();
  }

  get_modified_time(path: string): number {
    return GodotDirAccess.get_modified_time(path);
  }

  get_space_left(): number {
    throw new Error('Directory.get_space_left has no synchronous browser storage-quota carrier.');
  }

  change_dir(path: string): number {
    return this.requireHandle().change_dir(path);
  }

  make_dir(path: string): number {
    return this.requireHandle().make_dir(path);
  }

  make_dir_recursive(path: string): number {
    return this.requireHandle().make_dir_recursive(path);
  }

  remove(path: string): number {
    return this.requireHandle().remove(path);
  }

  rename(from: string, to: string): number {
    return this.requireHandle().rename(from, to);
  }

  list_dir_begin(skipNavigational = false, skipHidden = false): number {
    const handle = this.requireHandle();
    handle.set_include_navigational(!skipNavigational);
    handle.set_include_hidden(!skipHidden);
    return handle.list_dir_begin();
  }

  get_next(): string {
    return this.requireHandle().get_next();
  }

  current_is_dir(): boolean {
    return this.requireHandle().current_is_dir();
  }

  list_dir_end(): void {
    this.requireHandle().list_dir_end();
  }

  private requireHandle(): GodotDirAccess {
    if (this.handle === null) {
      this.handle = GodotDirAccess.open('res://');
    }
    if (this.handle === null) throw new Error('Godot Directory could not open the project res:// root.');
    return this.handle;
  }
}

function fileExists(path: string): boolean {
  return storedBytes(path) !== undefined;
}

function directoryExists(path: string): boolean {
  const normalized = normalizePath(path);
  if (readFileSystem().directories.includes(normalized)) return true;
  const prefix = `${normalized.replace(/\/$/, '')}/`;
  return [...(projectFiles.get(configuredKey())?.keys() ?? [])].some((file) => file.startsWith(prefix));
}

function makeDirectory(path: string, recursive: boolean): number {
  const normalized = normalizePath(path);
  if (normalized.startsWith('res://')) return 1;
  const fs = readFileSystem();
  if (!recursive && !directoryExists(parentPath(normalized))) return 1;
  const next = recursive ? ensureParentDirectories(`${normalized}/placeholder`, fs) : fs;
  const now = Math.floor(Date.now() / 1000);
  writeFileSystem({
    files: next.files,
    directories: [...new Set([...next.directories, normalized])],
    metadata: {
      ...(next.metadata ?? {}),
      [normalized]: {
        modifiedTime: now,
        accessTime: now,
        unixPermissions: 0o755,
      },
    },
  });
  return 0;
}

function copyPath(from: string, to: string): number {
  const bytes = storedBytes(from);
  if (bytes === undefined) return 7; // ERR_FILE_NOT_FOUND
  try {
    storeBytes(to, bytes);
    return 0;
  } catch {
    return 12; // ERR_FILE_CANT_OPEN
  }
}

function removePath(path: string): number {
  const normalized = normalizePath(path);
  if (normalized.startsWith('res://')) return 1;
  const fs = readFileSystem();
  if (fs.files[normalized] !== undefined) {
    const files = { ...fs.files };
    const metadata = { ...(fs.metadata ?? {}) };
    delete files[normalized];
    delete metadata[normalized];
    writeFileSystem({ files, directories: fs.directories, metadata });
    return 0;
  }
  if (!fs.directories.includes(normalized)) return 1;
  const prefix = `${normalized}/`;
  if (Object.keys(fs.files).some((file) => file.startsWith(prefix)) || fs.directories.some((dir) => dir.startsWith(prefix))) return 1;
  const metadata = { ...(fs.metadata ?? {}) };
  delete metadata[normalized];
  writeFileSystem({
    files: fs.files,
    directories: fs.directories.filter((dir) => dir !== normalized),
    metadata,
  });
  return 0;
}

function renamePath(from: string, to: string): number {
  if (from.startsWith('res://') || to.startsWith('res://')) return 1;
  const fs = readFileSystem();
  if (fs.files[from] !== undefined) {
    const files = { ...fs.files, [to]: fs.files[from] };
    const metadata = { ...(fs.metadata ?? {}) };
    if (metadata[from] !== undefined) metadata[to] = metadata[from];
    delete files[from];
    delete metadata[from];
    writeFileSystem(ensureParentDirectories(to, { files, directories: fs.directories, metadata }));
    return 0;
  }
  if (!fs.directories.includes(from) || fs.files[to] !== undefined || fs.directories.includes(to)) return 1;
  const prefix = `${from}/`;
  const files = Object.fromEntries(Object.entries(fs.files).map(([path, value]) => [path.startsWith(prefix) ? `${to}/${path.slice(prefix.length)}` : path, value]));
  const directories = fs.directories.map((path) => path === from ? to : path.startsWith(prefix) ? `${to}/${path.slice(prefix.length)}` : path);
  const metadata = Object.fromEntries(
    Object.entries(fs.metadata ?? {}).map(([path, value]) => [
      path === from ? to : path.startsWith(prefix) ? `${to}/${path.slice(prefix.length)}` : path,
      value,
    ]),
  );
  writeFileSystem(ensureParentDirectories(`${to}/placeholder`, { files, directories, metadata }));
  return 0;
}

export function dirAccessOpen(path: string): GodotDirAccess | null { return GodotDirAccess.open(path); }
export function dirAccessDirExists(path: string): boolean { return directoryExists(path); }
export function dirAccessMakeDirAbsolute(path: string): number { return makeDirectory(path, false); }
export function dirAccessMakeDirRecursiveAbsolute(path: string): number { return makeDirectory(path, true); }
export function dirAccessRemoveAbsolute(path: string): number { return removePath(path); }
export function dirAccessRenameAbsolute(from: string, to: string): number { return renamePath(normalizePath(from), normalizePath(to)); }

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function rotateLeft(value: number, amount: number): number {
  return (value << amount) | (value >>> (32 - amount));
}

/** Synchronous RFC 1321 MD5 used by Godot's synchronous FileAccess.get_md5 API. */
export function md5Hex(input: Uint8Array): string {
  const length = input.length;
  const paddedLength = Math.ceil((length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[length] = 0x80;
  const end = new DataView(bytes.buffer);
  end.setUint32(paddedLength - 8, (length * 8) >>> 0, true);
  end.setUint32(paddedLength - 4, Math.floor(length / 0x20000000), true);
  const shifts = [
    7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
    5,9,14,20, 5,9,14,20, 5,9,14,20, 5,9,14,20,
    4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
    6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21,
  ];
  const constants = Array.from(
    { length: 64 },
    (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x1_0000_0000) >>> 0,
  );
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let offset = 0; offset < paddedLength; offset += 64) {
    const block = new DataView(bytes.buffer, offset, 64);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let index = 0; index < 64; index += 1) {
      let f: number;
      let word: number;
      if (index < 16) {
        f = (b & c) | (~b & d);
        word = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        word = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        word = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        word = (7 * index) % 16;
      }
      const sum = (a + f + (constants[index] ?? 0) + block.getUint32(word * 4, true)) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(sum, shifts[index] ?? 0)) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0]
    .map((value) => [...Array(4)].map((_, index) => ((value >>> (index * 8)) & 255).toString(16).padStart(2, '0')).join(''))
    .join('');
}

/** Synchronous SHA-256 because Godot's FileAccess.get_sha256 is synchronous. */
export function sha256Hex(input: Uint8Array): string {
  const constants = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const length = input.length;
  const paddedLength = Math.ceil((length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[length] = 0x80;
  new DataView(bytes.buffer).setUint32(paddedLength - 4, length * 8, false);
  const hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const view = new DataView(bytes.buffer, offset, 64);
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15] ?? 0;
      const b = words[index - 2] ?? 0;
      const s0 = rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3);
      const s1 = rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10);
      words[index] = ((words[index - 16] ?? 0) + s0 + (words[index - 7] ?? 0) + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temp1 = (h! + s1 + choice + constants[index]! + words[index]!) >>> 0;
      const s0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temp2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d! + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    const round = [a,b,c,d,e,f,g,h];
    for (let index = 0; index < 8; index += 1) hash[index] = (hash[index]! + round[index]!) >>> 0;
  }
  return hash.map((value) => value.toString(16).padStart(8, '0')).join('');
}
