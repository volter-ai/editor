/**
 * @godot-class AnimationLibrary
 * @role PROTOCOL
 *
 * Godot 4.7's `AnimationLibrary` (`scene/resources/animation_library.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): named animations in insertion order (a `HashMap`),
 * listed alphabetically, relaying their `changed` signals; its mixers listen to its
 * `animation_added`/`removed`/`renamed`/`changed` signals. A library a scene declares is loaded
 * from the translation's data file.
 */

import { type Animation, type GodotAnimationData, godot_animation_connect_changed, godot_animation_from_data } from './animation';

/** What a mixer hears from a library it holds (the library's four signals). */
export interface GodotAnimationLibraryListener {
  readonly added: (name: string) => void;
  readonly removed: (name: string) => void;
  readonly renamed: (from: string, to: string) => void;
  readonly changed: (name: string) => void;
}

export interface AnimationLibrary {
  readonly animations: Map<string, Animation>;
  readonly disconnects: Map<string, () => void>;
  readonly listeners: Set<GodotAnimationLibraryListener>;
}

/** An animation library as the translation's data file writes it: its animations by name, in file order. */
export interface GodotAnimationLibraryData {
  readonly animations: readonly { readonly name: string; readonly animation: GodotAnimationData }[];
}

/** `AnimationLibrary::is_valid_animation_name` (`animation_library.cpp:36`). */
function validName(name: string): boolean {
  return !(name === '' || /[/:,[]/u.test(name));
}

function emit(self: AnimationLibrary, signal: (listener: GodotAnimationLibraryListener) => void): void {
  for (const listener of [...self.listeners]) signal(listener);
}

/** Connects an animation's `changed` to the library's `animation_changed` under its name. */
function watch(self: AnimationLibrary, name: string, animation: Animation): void {
  self.disconnects.set(name, godot_animation_connect_changed(animation, () => emit(self, (listener) => listener.changed(name))));
}

function unwatch(self: AnimationLibrary, name: string): void {
  self.disconnects.get(name)?.();
  self.disconnects.delete(name);
}

/**
 * @godot AnimationLibrary (protocol)
 * @source scene/resources/animation_library.cpp:203
 */
export function construct(): AnimationLibrary {
  return { animations: new Map(), disconnects: new Map(), listeners: new Set() };
}

/**
 * A library as its file states it (`_set_data`, `animation_library.cpp:148`): each animation added
 * in the file's order.
 *
 * @godot AnimationLibrary (protocol)
 * @source scene/resources/animation_library.cpp:148
 */
export function godot_animation_library_load(data: GodotAnimationLibraryData): AnimationLibrary {
  const self = construct();
  for (const entry of data.animations) add_animation(self, entry.name, godot_animation_from_data(entry.animation));
  return self;
}

/**
 * Listens for the library's signals, as a mixer that holds it does.
 *
 * @godot AnimationLibrary (protocol)
 * @source scene/animation/animation_mixer.cpp:320
 */
export function godot_animation_library_listen(self: AnimationLibrary, listener: GodotAnimationLibraryListener): () => void {
  self.listeners.add(listener);
  return () => self.listeners.delete(listener);
}

/**
 * Replacing a name removes the old animation first (`animation_removed`), then adds at the end.
 *
 * @godot AnimationLibrary.add_animation
 * @source scene/resources/animation_library.cpp:48
 */
export function add_animation(self: AnimationLibrary, name: string, animation: Animation | null): number {
  if (!validName(String(name))) return 31;
  if (animation === null || animation === undefined) return 31;
  const key = String(name);
  if (self.animations.has(key)) {
    unwatch(self, key);
    self.animations.delete(key);
    emit(self, (listener) => listener.removed(key));
  }
  self.animations.set(key, animation);
  watch(self, key, animation);
  emit(self, (listener) => listener.added(key));
  return 0;
}

/**
 * @godot AnimationLibrary.remove_animation
 * @source scene/resources/animation_library.cpp:64
 */
export function remove_animation(self: AnimationLibrary, name: string): void {
  const key = String(name);
  if (!self.animations.has(key)) return;
  unwatch(self, key);
  self.animations.delete(key);
  emit(self, (listener) => listener.removed(key));
}

/**
 * The renamed animation moves to the end of the insertion order (`insert` then `erase`).
 *
 * @godot AnimationLibrary.rename_animation
 * @source scene/resources/animation_library.cpp:73
 */
export function rename_animation(self: AnimationLibrary, name: string, newname: string): void {
  const from = String(name);
  const to = String(newname);
  const animation = self.animations.get(from);
  if (animation === undefined || !validName(to) || self.animations.has(to)) return;
  unwatch(self, from);
  watch(self, to, animation);
  self.animations.set(to, animation);
  self.animations.delete(from);
  emit(self, (listener) => listener.renamed(from, to));
}

/**
 * @godot AnimationLibrary.has_animation
 * @source scene/resources/animation_library.cpp:85
 */
export function has_animation(self: AnimationLibrary, name: string): boolean {
  return self.animations.has(String(name));
}

/**
 * Null for a missing name.
 *
 * @godot AnimationLibrary.get_animation
 * @source scene/resources/animation_library.cpp:89
 */
export function get_animation(self: AnimationLibrary, name: string): Animation | null {
  return self.animations.get(String(name)) ?? null;
}

/**
 * The names in `StringName::AlphCompare` order (`animation_library.cpp:111`).
 *
 * @godot AnimationLibrary.get_animation_list
 * @source scene/resources/animation_library.cpp:95
 */
export function get_animation_list(self: AnimationLibrary): string[] {
  return [...self.animations.keys()].sort(godot_string_name_alph_compare);
}

/**
 * `StringName::AlphCompare` (`core/string/string_name.h:136`): `str_compare` over code points.
 *
 * @godot AnimationLibrary (protocol)
 * @source core/string/string_name.h:141
 */
export function godot_string_name_alph_compare(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    const l = (left[i] as string).codePointAt(0) as number;
    const r = (right[i] as string).codePointAt(0) as number;
    if (l !== r) return l < r ? -1 : 1;
  }
  return left.length - right.length;
}

/**
 * @godot AnimationLibrary.get_animation_list_size
 * @source scene/resources/animation_library.cpp:125
 */
export function get_animation_list_size(self: AnimationLibrary): number {
  return self.animations.size;
}
