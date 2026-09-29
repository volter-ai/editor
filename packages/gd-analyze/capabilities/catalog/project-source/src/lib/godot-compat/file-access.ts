/**
 * @godot-class FileAccess
 * @role BINDING
 *
 * Godot 4.7's `FileAccess` (`core/io/file_access.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) onto the page's `localStorage`, where
 * `ResourceSaver.save` already keeps `user://` (`resource-loader.ts`, the same `godot:<path>` key):
 * Godot's web platform keeps `user://` in the browser's persistent storage too. A file is held as
 * its UTF-8 bytes while open, so positions and lengths are byte counts as Godot's are, and every
 * store writes through (the page may be closed without `close()`). `res://` files are not shipped
 * to the page: opening or testing one throws rather than answering a different game.
 */

/** `FileAccess.ModeFlags` (`core/io/file_access.h:55`). */
const READ = 1;
const WRITE = 2;
const READ_WRITE = 3;
const WRITE_READ = 7;

export interface FileAccess {
  readonly path: string;
  readonly mode: number;
  bytes: Uint8Array;
  position: number;
  open: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function storage(): Storage | undefined {
  try {
    return (globalThis as { readonly localStorage?: Storage }).localStorage;
  } catch {
    return undefined;
  }
}

const key = (path: string) => `godot:${path}`;

function userPath(path: string): boolean {
  if (path.startsWith('user://')) return true;
  throw new Error(`godot-compat: FileAccess of ${path}: only user:// is kept on the page; project files are not shipped to it`);
}

function writeThrough(self: FileAccess): void {
  if (self.mode === READ) return;
  storage()?.setItem(key(self.path), decoder.decode(self.bytes));
}

function write(self: FileAccess, text: string): boolean {
  if (!self.open || self.mode === READ) return false;
  const data = encoder.encode(text);
  const end = self.position + data.length;
  const next = new Uint8Array(Math.max(end, self.bytes.length));
  next.set(self.bytes);
  next.set(data, self.position);
  self.bytes = next;
  self.position = end;
  writeThrough(self);
  return true;
}

/**
 * `FileAccess.open(path, flags)`: the file, or null (Godot's error) when a read finds none. `WRITE`
 * and `WRITE_READ` start it empty; `READ_WRITE` needs it to exist.
 *
 * @godot FileAccess.open
 * @source core/io/file_access.cpp:187
 */
export function open(path: string, flags: number): FileAccess | null {
  if (!userPath(path)) return null;
  const store = storage();
  if (store === undefined) return null;
  const text = store.getItem(key(path));
  if ((flags === READ || flags === READ_WRITE) && text === null) return null;
  const bytes = flags === WRITE || flags === WRITE_READ ? new Uint8Array(0) : encoder.encode(text ?? '');
  const self: FileAccess = { path, mode: flags, bytes, position: 0, open: true };
  writeThrough(self);
  return self;
}

/**
 * @godot FileAccess.file_exists
 * @source core/io/file_access.cpp:54
 */
export function file_exists(path: string): boolean {
  return userPath(path) && storage()?.getItem(key(path)) != null;
}

/**
 * The whole file as UTF-8, wherever the cursor is.
 *
 * @godot FileAccess.get_as_text
 * @source core/io/file_access.cpp:537
 */
export function get_as_text(self: FileAccess): string {
  return decoder.decode(self.bytes);
}

/**
 * @godot FileAccess.get_file_as_string
 * @source core/io/file_access.cpp:916
 */
export function get_file_as_string(path: string): string {
  const file = open(path, READ);
  return file === null ? '' : get_as_text(file);
}

/**
 * The next line, without its `\n` and any `\r`.
 *
 * @godot FileAccess.get_line
 * @source core/io/file_access.cpp:448
 */
export function get_line(self: FileAccess): string {
  const start = self.position;
  let end = self.bytes.indexOf(10, start);
  if (end < 0) end = self.bytes.length;
  self.position = Math.min(end + 1, self.bytes.length);
  return decoder.decode(self.bytes.subarray(start, end)).replaceAll('\r', '');
}

/**
 * @godot FileAccess.store_string
 * @source core/io/file_access.cpp:1066
 */
export function store_string(self: FileAccess, text: string): boolean {
  return write(self, text);
}

/**
 * @godot FileAccess.store_line
 * @source core/io/file_access.cpp:840
 */
export function store_line(self: FileAccess, line: string): boolean {
  return write(self, `${line}\n`);
}

/**
 * @godot FileAccess.get_position
 * @source core/io/file_access.cpp:1033
 */
export function get_position(self: FileAccess): number {
  return self.position;
}

/**
 * @godot FileAccess.get_length
 * @source core/io/file_access.cpp:1034
 */
export function get_length(self: FileAccess): number {
  return self.bytes.length;
}

/**
 * @godot FileAccess.seek
 * @source core/io/file_access.cpp:1031
 */
export function seek(self: FileAccess, position: number): void {
  self.position = Math.max(0, Math.min(position, self.bytes.length));
}

/**
 * @godot FileAccess.eof_reached
 * @source core/io/file_access.cpp:1035
 */
export function eof_reached(self: FileAccess): boolean {
  return self.position >= self.bytes.length;
}

/**
 * @godot FileAccess.get_path
 * @source core/io/file_access.cpp:1028
 */
export function get_path(self: FileAccess): string {
  return self.path;
}

/**
 * @godot FileAccess.is_open
 * @source core/io/file_access.cpp:1030
 */
export function is_open(self: FileAccess): boolean {
  return self.open;
}

/**
 * Nothing is buffered: every store already wrote through.
 *
 * @godot FileAccess.flush
 * @source core/io/file_access.cpp:1027
 */
export function flush(self: FileAccess): void {
  writeThrough(self);
}

/**
 * @godot FileAccess.close
 * @source core/io/file_access.cpp:1072
 */
export function close(self: FileAccess): void {
  writeThrough(self);
  self.open = false;
}
