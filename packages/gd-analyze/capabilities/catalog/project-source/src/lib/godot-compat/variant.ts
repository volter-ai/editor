/**
 * Godot built-in Variant support that has not earned a dedicated protocol module.
 *
 * Vector2's complete pinned Godot 4.7 API lives in `vector2.ts`; this file consumes its plain
 * mutable value record for Rect2 and Transform2D. That keeps engine semantics in copied compat
 * while Pixi-facing code can still accept the same structural `{ x, y }` values directly.
 */

import {
  isGodotPackedArray,
  godotPackedArrayCall,
  packedArrayKind,
  type PackedByteArray,
  type PackedStringArray,
  packedStringArray,
} from './packed-array';
import { godotPoolArrayCall } from './pool-array';
import { godotPoolByteArrayCall } from './pool-byte-array';
import { godotPackedByteBinaryCall } from './packed-array-binary';
import { godotArrayBsearchCustom, godotArrayCall } from './array';
import { godotDictionaryCall } from './dictionary-protocol';
import { godotStringCall } from './string';
import { stringLength } from './string-core';
import { godotVariantValueLength } from './variant-value';
import { GodotCallable } from './callable';
import { godotObjectCall, godotObjectHasBinding } from './object';
import { godotVector2Call, type Vector2 } from './vector2';
import { godotVector3Call } from './vector3';
import type { Vector3 } from './variant-3d';

type Draw = () => number;

/** Godot's `Color` Variant — linear component values may exceed 1 for HDR modulation. */
export interface ColorValue {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function color(r: number, g: number, b: number, a = 1): ColorValue {
  return Object.freeze({ r, g, b, a });
}

/**
 * `Color.GRAY` — the pinned 4.7 dump's own constant
 * `Color(0.74509805, 0.74509805, 0.74509805, 1)`.
 * `virtual_joystick.gd:10` defaults the pressed tint to it.
 */
export const COLOR_GRAY: ColorValue = color(0.74509805, 0.74509805, 0.74509805, 1);

/**
 * Godot's 2x3 `Transform2D` — origin plus the two basis columns.
 *
 * `virtual_joystick.gd` reads `get_global_transform_with_canvas().get_scale()`
 * to convert a pivot offset and a hit-test size into the same space the
 * touch lands in. The overlay is laid out in the project's DESIGN PIXELS
 * (`translate/emit/overlay.ts`): the host's ancestor transform supplies
 * on-screen fit, and touch positions are mapped back into that same space
 * (`createInput`'s pointer sink). So the canvas transform's scale, IN THE
 * SPACE THE UI AND THE TOUCH SHARE, is identity.
 */
export type { GodotTransform2D as Transform2D } from './transform-2d';
export { transform2DFromOrigin, transform2DScale } from './transform-2d';

/**
 * Godot's `Rect2` — position + size, both `Vector2`.
 *
 * Only `size` is measured (`Player.gd:10`, `get_viewport_rect().size`), but a
 * `Rect2` without its `position` is not a `Rect2`, and the one place that
 * builds one (`node.ts`'s `getViewportRect`) knows both halves for free.
 */
export type { GodotRect2 as Rect2 } from './rect2';
export { rect2 } from './rect2';

type OpenVariantMethod =
  | 'has'
  | 'size'
  | 'empty'
  | 'is_empty'
  | 'clear'
  | 'keys'
  | 'values'
  | 'has_all'
  | 'find_key'
  | 'get'
  | 'get_or_add'
  | 'merge'
  | 'merged'
  | 'substr'
  | 'findn'
  | 'rfindn'
  | 'find_last'
  | 'split'
  | 'rsplit'
  | 'strip_edges'
  | 'format'
  | 'to_upper'
  | 'trim_prefix'
  | 'trim_suffix'
  | 'to_utf8'
  | 'to_int'
  | 'to_float'
  | 'is_valid_integer'
  | 'is_valid_int'
  | 'is_valid_float'
  | 'capitalize'
  | 'get_file'
  | 'get_base_dir'
  | 'get_extension'
  | 'get_basename'
  | 'path_join'
  | 'plus_file'
  | 'to_snake_case'
  | 'to_camel_case'
  | 'to_pascal_case'
  | 'to_kebab_case'
  | 'left'
  | 'right'
  | 'contains'
  | 'containsn'
  | 'count'
  | 'countn'
  | 'match'
  | 'matchn'
  | 'is_subsequence_of'
  | 'is_subsequence_ofi'
  | 'is_subsequence_ofn'
  | 'repeat'
  | 'insert'
  | 'lstrip'
  | 'rstrip'
  | 'strip_escapes'
  | 'unicode_at'
  | 'ord_at'
  | 'replace'
  | 'append'
  | 'push_back'
  | 'pop_back'
  | 'pop_front'
  | 'erase'
  | 'find'
  | 'rfind'
  | 'reverse'
  | 'invert'
  | 'sort'
  | 'slice'
  | 'duplicate'
  | 'to_lower'
  | 'begins_with'
  | 'ends_with'
  | 'length'
  | 'assign'
  | 'fill'
  | 'resize'
  | 'bsearch'
  | 'pick_random'
  | 'shuffle'
  | 'sort_custom'
  | 'is_same_typed'
  | 'is_same_typed_key'
  | 'is_same_typed_value'
  | 'find_custom'
  | 'rfind_custom'
  | 'bsearch_custom'
  | 'map'
  | 'filter'
  | 'reduce'
  | 'any'
  | 'all'
  | 'min'
  | 'max'
  | 'set'
  | 'front'
  | 'back'
  | 'push_front'
  | 'append_array'
  | 'remove_at'
  | 'remove'
  | 'pop_at'
  | 'hash'
  | 'duplicate_deep'
  | 'make_read_only'
  | 'is_read_only'
  | 'is_typed'
  | 'get_typed_builtin'
  | 'get_typed_class_name'
  | 'get_typed_script'
  | 'distance_to'
  | 'direction_to'
  | 'normalized'
  | 'is_zero_approx'
  | 'angle'
  | 'get_string_from_utf8';

const OPEN_VARIANT_ARITIES: Readonly<Record<OpenVariantMethod, readonly [number, number]>> = {
  has: [1, 1],
  size: [0, 0],
  empty: [0, 0],
  is_empty: [0, 0],
  clear: [0, 0],
  keys: [0, 0],
  values: [0, 0],
  has_all: [1, 1],
  find_key: [1, 1],
  get: [1, 2],
  get_or_add: [1, 2],
  merge: [1, 2],
  merged: [1, 2],
  substr: [1, 2],
  findn: [1, 2],
  rfindn: [1, 2],
  find_last: [1, 1],
  split: [0, 3],
  rsplit: [0, 3],
  strip_edges: [0, 2],
  format: [1, 2],
  to_upper: [0, 0],
  trim_prefix: [1, 1],
  trim_suffix: [1, 1],
  to_utf8: [0, 0],
  to_int: [0, 0],
  to_float: [0, 0],
  is_valid_integer: [0, 0],
  is_valid_int: [0, 0],
  is_valid_float: [0, 0],
  capitalize: [0, 0],
  get_file: [0, 0],
  get_base_dir: [0, 0],
  get_extension: [0, 0],
  get_basename: [0, 0],
  path_join: [1, 1],
  plus_file: [1, 1],
  to_snake_case: [0, 0],
  to_camel_case: [0, 0],
  to_pascal_case: [0, 0],
  to_kebab_case: [0, 0],
  left: [1, 1],
  right: [1, 1],
  contains: [1, 1],
  containsn: [1, 1],
  count: [1, 3],
  countn: [1, 3],
  match: [1, 1],
  matchn: [1, 1],
  is_subsequence_of: [1, 1],
  is_subsequence_ofi: [1, 1],
  is_subsequence_ofn: [1, 1],
  repeat: [1, 1],
  insert: [2, 2],
  lstrip: [1, 1],
  rstrip: [1, 1],
  strip_escapes: [0, 0],
  unicode_at: [1, 1],
  ord_at: [1, 1],
  replace: [2, 2],
  append: [1, 1],
  push_back: [1, 1],
  pop_back: [0, 0],
  pop_front: [0, 0],
  erase: [1, 2],
  find: [1, 2],
  rfind: [1, 2],
  reverse: [0, 0],
  invert: [0, 0],
  sort: [0, 0],
  slice: [1, 4],
  duplicate: [0, 1],
  to_lower: [0, 0],
  begins_with: [1, 1],
  ends_with: [1, 1],
  length: [0, 0],
  assign: [1, 1],
  fill: [1, 1],
  resize: [1, 1],
  bsearch: [1, 2],
  pick_random: [0, 0],
  shuffle: [0, 0],
  sort_custom: [1, 1],
  is_same_typed: [1, 1],
  is_same_typed_key: [1, 1],
  is_same_typed_value: [1, 1],
  find_custom: [1, 2],
  rfind_custom: [1, 2],
  bsearch_custom: [2, 3],
  map: [1, 1],
  filter: [1, 1],
  reduce: [1, 2],
  any: [1, 1],
  all: [1, 1],
  min: [0, 0],
  max: [0, 0],
  set: [2, 2],
  front: [0, 0],
  back: [0, 0],
  push_front: [1, 1],
  append_array: [1, 1],
  remove_at: [1, 1],
  remove: [1, 1],
  pop_at: [1, 1],
  hash: [0, 0],
  duplicate_deep: [0, 1],
  make_read_only: [0, 0],
  is_read_only: [0, 0],
  is_typed: [0, 0],
  get_typed_builtin: [0, 0],
  get_typed_class_name: [0, 0],
  get_typed_script: [0, 0],
  distance_to: [1, 1],
  direction_to: [1, 1],
  normalized: [0, 0],
  is_zero_approx: [0, 0],
  angle: [0, 0],
  get_string_from_utf8: [0, 0],
};

function variantCarrierName(receiver: unknown): string {
  if (receiver === null) return 'Nil';
  if (receiver === undefined) return 'undefined';
  if (typeof receiver === 'object') return receiver.constructor?.name ?? 'Object';
  return typeof receiver;
}

function isOpenVector2(receiver: unknown): receiver is Vector2 {
  return receiver !== null && typeof receiver === 'object' &&
    typeof (receiver as { x?: unknown }).x === 'number' &&
    typeof (receiver as { y?: unknown }).y === 'number' &&
    !('z' in receiver);
}

function isOpenVector3(receiver: unknown): receiver is Vector3 {
  return receiver !== null && typeof receiver === 'object' &&
    typeof (receiver as { x?: unknown }).x === 'number' &&
    typeof (receiver as { y?: unknown }).y === 'number' &&
    typeof (receiver as { z?: unknown }).z === 'number' &&
    !('w' in receiver);
}

function exactOpenVariantArity(method: OpenVariantMethod, args: readonly unknown[]): void {
  const [minimum, maximum] = OPEN_VARIANT_ARITIES[method];
  if (args.length < minimum || args.length > maximum) {
    const expected = minimum === maximum ? String(minimum) : `${minimum}..${maximum}`;
    throw new TypeError(
      `godot-compat: runtime Variant.${method} requires ${expected} arguments; received ${args.length}.`,
    );
  }
}

function exactOpenStringArguments(
  godotMajor: 3 | 4,
  method: OpenVariantMethod,
  args: readonly unknown[],
): void {
  if ((method === 'split' || method === 'rsplit') && godotMajor === 3 && args.length === 0) {
    throw new TypeError(`godot-compat: Godot 3 String.${method} requires a delimiter.`);
  }
  if (method === 'substr') {
    if (!Number.isSafeInteger(args[0]) ||
        (args.length === 2 && !Number.isSafeInteger(args[1]))) {
      throw new TypeError('godot-compat: String.substr requires integer from/length arguments.');
    }
  }
  if (
    method === 'find' || method === 'rfind' || method === 'findn' ||
    method === 'rfindn' || method === 'find_last'
  ) {
    if (typeof args[0] !== 'string' ||
        (args.length === 2 && !Number.isSafeInteger(args[1]))) {
      throw new TypeError(`godot-compat: String.${method} requires String and optional int.`);
    }
  }
  if (method === 'split' || method === 'rsplit') {
    if ((args.length >= 1 && typeof args[0] !== 'string') ||
        (args.length >= 2 && typeof args[1] !== 'boolean') ||
        (args.length >= 3 && !Number.isSafeInteger(args[2]))) {
      throw new TypeError(
        `godot-compat: String.${method} requires String, optional bool, optional int.`,
      );
    }
  }
  if (method === 'strip_edges' &&
      args.some((value) => typeof value !== 'boolean')) {
    throw new TypeError('godot-compat: String.strip_edges arguments require bool.');
  }
  if ((method === 'trim_prefix' || method === 'trim_suffix') && typeof args[0] !== 'string') {
    throw new TypeError(`godot-compat: String.${method} requires a String argument.`);
  }
  if ((method === 'path_join' || method === 'plus_file') && typeof args[0] !== 'string') {
    throw new TypeError(`godot-compat: String.${method} requires a String path.`);
  }
  if ((method === 'left' || method === 'right') && !Number.isSafeInteger(args[0])) {
    throw new TypeError(`godot-compat: String.${method} requires an integer length.`);
  }
  if (
    method === 'contains' || method === 'containsn' || method === 'match' ||
    method === 'matchn' || method === 'is_subsequence_of' ||
    method === 'is_subsequence_ofi' || method === 'is_subsequence_ofn' ||
    method === 'lstrip' || method === 'rstrip'
  ) {
    if (typeof args[0] !== 'string') {
      throw new TypeError(`godot-compat: String.${method} requires a String argument.`);
    }
  }
  if (method === 'count' || method === 'countn') {
    if (typeof args[0] !== 'string' ||
        (args.length >= 2 && !Number.isSafeInteger(args[1])) ||
        (args.length >= 3 && !Number.isSafeInteger(args[2]))) {
      throw new TypeError(
        `godot-compat: String.${method} requires String and optional int from/to arguments.`,
      );
    }
  }
  if (method === 'repeat' && !Number.isSafeInteger(args[0])) {
    throw new TypeError('godot-compat: String.repeat requires an integer count.');
  }
  if (method === 'insert' &&
      (!Number.isSafeInteger(args[0]) || typeof args[1] !== 'string')) {
    throw new TypeError('godot-compat: String.insert requires an int position and String value.');
  }
  if (method === 'erase' &&
      (!Number.isSafeInteger(args[0]) ||
        (args.length === 2 && !Number.isSafeInteger(args[1])))) {
    throw new TypeError('godot-compat: String.erase requires an int position and optional int chars.');
  }
  if ((method === 'unicode_at' || method === 'ord_at') && !Number.isSafeInteger(args[0])) {
    throw new TypeError(`godot-compat: String.${method} requires an integer index.`);
  }
}

/**
 * Exact runtime dispatch for a source Variant whose concrete built-in remains open.
 *
 * This is deliberately a finite method/carrier matrix, not JavaScript property forwarding:
 * unsupported carrier-method pairs stay loud, while every accepted call delegates to the same
 * retained String, Array, Packed/PoolArray, or Dictionary protocol as a statically proven call.
 */
function godotOpenBuiltinVariantCall(
  godotMajor: 3 | 4,
  method: OpenVariantMethod,
  receiver: unknown,
  args: readonly unknown[],
  random?: Draw,
): unknown {
  if (method === 'bsearch_custom') {
    return godotArrayBsearchCustom(godotMajor, receiver, args);
  }
  exactOpenVariantArity(method, args);
  if ((method === 'empty' && godotMajor !== 3) || (method === 'is_empty' && godotMajor !== 4)) {
    throw new TypeError(`godot-compat: Variant.${method} is not declared in Godot ${godotMajor}.`);
  }
  if ((method === 'invert' && godotMajor !== 3) || (method === 'reverse' && godotMajor !== 4)) {
    throw new TypeError(`godot-compat: Array.${method} is not declared in Godot ${godotMajor}.`);
  }
  if (method === 'slice' && godotMajor !== 4) {
    throw new TypeError(
      'godot-compat: open Godot 3 Array.slice refuses because its inclusive end differs from ' +
        'the retained Godot 4 end-exclusive owner.',
    );
  }
  if ((method === 'assign' || method === 'is_same_typed' ||
      method === 'is_same_typed_key' || method === 'is_same_typed_value' ||
      method === 'sort_custom' || method === 'find_custom' || method === 'rfind_custom' ||
      method === 'map' || method === 'filter' ||
      method === 'reduce' || method === 'any' || method === 'all' ||
      method === 'min' || method === 'max') && godotMajor !== 4) {
    throw new TypeError(`godot-compat: Variant.${method} has no matching Godot 3 contract.`);
  }
  if ((method === 'set' || method === 'remove_at' ||
      method === 'pop_at' || method === 'hash' || method === 'duplicate_deep' ||
      method === 'make_read_only' || method === 'is_read_only' || method === 'is_typed' ||
      method === 'get_typed_builtin' || method === 'get_typed_class_name' ||
      method === 'get_typed_script') && godotMajor !== 4) {
    throw new TypeError(`godot-compat: Array.${method} is not declared in Godot 3.x.`);
  }
  if (method === 'remove' && godotMajor !== 3) {
    throw new TypeError('godot-compat: Array.remove is not declared in Godot 4.x.');
  }
  if ((method === 'remove_at' || method === 'remove' || method === 'pop_at') &&
      !Number.isSafeInteger(args[0])) {
    throw new TypeError(`godot-compat: Array.${method} index requires int.`);
  }
  if (method === 'set' && !Number.isSafeInteger(args[0])) {
    throw new TypeError('godot-compat: Array.set index requires int.');
  }
  if (method === 'append_array' &&
      (!Array.isArray(args[0]) || isGodotPackedArray(args[0]))) {
    throw new TypeError('godot-compat: Array.append_array requires an ordinary Array.');
  }
  if (method === 'duplicate_deep' && args.length === 1 && !Number.isSafeInteger(args[0])) {
    throw new TypeError('godot-compat: Array.duplicate_deep mode requires int.');
  }
  if (method === 'resize' && !Number.isSafeInteger(args[0])) {
    throw new TypeError('godot-compat: collection resize requires an integer size.');
  }
  if (method === 'bsearch' && args.length === 2 && typeof args[1] !== 'boolean') {
    throw new TypeError('godot-compat: collection bsearch before argument requires bool.');
  }
  if (method === 'sort_custom' && !(args[0] instanceof GodotCallable)) {
    throw new TypeError('godot-compat: Array.sort_custom requires a retained Callable.');
  }
  const callableIndex = method === 'find_custom' || method === 'rfind_custom' || method === 'map' ||
      method === 'filter' || method === 'reduce' || method === 'any' || method === 'all'
      ? 0
      : undefined;
  if (callableIndex !== undefined && !(args[callableIndex] instanceof GodotCallable)) {
    throw new TypeError(`godot-compat: Array.${method} requires a retained Callable.`);
  }
  if ((method === 'find_custom' || method === 'rfind_custom') && args.length === 2 &&
      !Number.isSafeInteger(args[1])) {
    throw new TypeError(`godot-compat: Array.${method} from argument requires int.`);
  }
  if (
    (method === 'find_key' || method === 'get_or_add' || method === 'merged') &&
    godotMajor !== 4
  ) {
    throw new TypeError(`godot-compat: Dictionary.${method} is not declared in Godot 3.x.`);
  }
  if ((method === 'is_valid_integer' || method === 'find_last') && godotMajor !== 3) {
    throw new TypeError(`godot-compat: String.${method} is not declared in Godot 4.x.`);
  }
  if (method === 'is_valid_int' && godotMajor !== 4) {
    throw new TypeError('godot-compat: String.is_valid_int is not declared in Godot 3.x.');
  }
  if (method === 'plus_file' && godotMajor !== 3) {
    throw new TypeError('godot-compat: String.plus_file is not declared in Godot 4.x.');
  }
  if ((method === 'contains' || method === 'containsn' || method === 'is_subsequence_ofn' ||
      method === 'unicode_at') && godotMajor !== 4) {
    throw new TypeError(`godot-compat: String.${method} is not declared in Godot 3.x.`);
  }
  if ((method === 'is_subsequence_ofi' || method === 'ord_at') && godotMajor !== 3) {
    throw new TypeError(`godot-compat: String.${method} is not declared in Godot 4.x.`);
  }
  if (
    (method === 'path_join' || method === 'to_snake_case' || method === 'to_camel_case' ||
      method === 'to_pascal_case' || method === 'to_kebab_case' || method === 'right') &&
    godotMajor !== 4
  ) {
    throw new TypeError(
      `godot-compat: open String.${method} has no matching Godot 3 owner in this runtime.`,
    );
  }
  if (method === 'replace' && args.some((value) => typeof value !== 'string')) {
    throw new TypeError('godot-compat: String.replace requires two String arguments.');
  }
  if (
    (method === 'begins_with' || method === 'ends_with') &&
    typeof args[0] !== 'string'
  ) {
    throw new TypeError(`godot-compat: String.${method} requires one String argument.`);
  }
  if (method === 'duplicate' && args.length === 1 && typeof args[0] !== 'boolean') {
    throw new TypeError('godot-compat: Array/Dictionary.duplicate deep argument requires bool.');
  }
  if (method === 'has_all' &&
      (!Array.isArray(args[0]) || isGodotPackedArray(args[0]))) {
    throw new TypeError('godot-compat: Dictionary.has_all requires an Array of keys.');
  }
  if (method === 'merge' || method === 'merged') {
    if (!(args[0] instanceof Map)) {
      throw new TypeError(`godot-compat: Dictionary.${method} requires a Dictionary.`);
    }
    if (args.length === 2 && typeof args[1] !== 'boolean') {
      throw new TypeError(`godot-compat: Dictionary.${method} overwrite requires bool.`);
    }
  }
  if (typeof receiver === 'string') {
    exactOpenStringArguments(godotMajor, method, args);
    if (method === 'erase' && godotMajor === 3) {
      throw new TypeError(
        'godot-compat: open Godot 3 String.erase refuses because its in-place void contract ' +
          'cannot mutate a retained primitive String carrier.',
      );
    }
    if (method === 'size' || method === 'length') return stringLength(receiver);
    if (
      method === 'empty' || method === 'is_empty' ||
      method === 'replace' || method === 'to_lower' ||
      method === 'begins_with' || method === 'ends_with' || method === 'substr' ||
      method === 'find' || method === 'rfind' || method === 'findn' ||
      method === 'rfindn' || method === 'find_last' || method === 'split' ||
      method === 'rsplit' || method === 'strip_edges' || method === 'to_int' ||
      method === 'format' || method === 'to_upper' ||
      method === 'trim_prefix' || method === 'trim_suffix' ||
      method === 'to_utf8' ||
      method === 'to_float' || method === 'is_valid_integer' ||
      method === 'is_valid_int' || method === 'is_valid_float' || method === 'capitalize' ||
      method === 'get_file' || method === 'get_base_dir' || method === 'get_extension' ||
      method === 'get_basename' || method === 'path_join' || method === 'plus_file' ||
      method === 'to_snake_case' || method === 'to_camel_case' ||
      method === 'to_pascal_case' || method === 'to_kebab_case' ||
      method === 'left' || method === 'right' || method === 'contains' ||
      method === 'containsn' || method === 'count' || method === 'countn' ||
      method === 'match' || method === 'matchn' || method === 'is_subsequence_of' ||
      method === 'is_subsequence_ofi' || method === 'is_subsequence_ofn' ||
      method === 'repeat' || method === 'insert' || method === 'erase' ||
      method === 'reverse' || method === 'lstrip' || method === 'rstrip' ||
      method === 'strip_escapes' || method === 'unicode_at' || method === 'ord_at'
    ) return godotStringCall(method, receiver, args);
  } else if (isOpenVector3(receiver) &&
      (method === 'distance_to' || method === 'direction_to' || method === 'normalized' ||
        method === 'is_zero_approx')) {
    return godotVector3Call(method, receiver, args);
  } else if (isOpenVector2(receiver) &&
      (method === 'distance_to' || method === 'direction_to' || method === 'normalized' ||
        method === 'is_zero_approx' || method === 'angle')) {
    return godotVector2Call(method, receiver, args);
  } else if (method === 'length' && typeof receiver === 'object' && receiver !== null) {
    return godotVariantValueLength(receiver);
  } else if (receiver instanceof Map) {
    if (
      method === 'has' || method === 'size' || method === 'empty' || method === 'is_empty' ||
      method === 'erase' || method === 'duplicate' || method === 'clear' ||
      method === 'keys' || method === 'values' || method === 'has_all' ||
      method === 'find_key' || method === 'get' || method === 'get_or_add' ||
      method === 'merge' || method === 'merged' || method === 'is_same_typed' ||
      method === 'is_same_typed_key' || method === 'is_same_typed_value'
    ) {
      if (method === 'erase' && args.length !== 1) {
        throw new TypeError('godot-compat: Dictionary.erase requires exactly one argument.');
      }
      if ((method === 'is_same_typed' || method === 'is_same_typed_key' ||
          method === 'is_same_typed_value') && !(args[0] instanceof Map)) {
        throw new TypeError(`godot-compat: Dictionary.${method} requires a Dictionary.`);
      }
      return godotDictionaryCall(receiver, method, args);
    }
  } else if (isGodotPackedArray(receiver)) {
    if (method === 'get_string_from_utf8' && packedArrayKind(receiver) === 'byte') {
      return godotMajor === 3
        ? godotPoolByteArrayCall(method, receiver as PackedByteArray, args)
        : godotPackedByteBinaryCall(method, receiver as PackedByteArray, args);
    }
    const packedMethodAvailable = godotMajor === 3
      ? method === 'has' || method === 'size' || method === 'empty' || method === 'append' ||
        method === 'fill' || method === 'resize'
      : method === 'has' || method === 'size' || method === 'is_empty' || method === 'append' ||
        method === 'erase' || method === 'duplicate' || method === 'fill' ||
        method === 'resize' || method === 'bsearch';
    if (
      packedMethodAvailable
    ) {
      if (method === 'duplicate' && args.length !== 0) {
        throw new TypeError('godot-compat: Packed/PoolArray.duplicate takes no arguments.');
      }
      return godotMajor === 3
        ? godotPoolArrayCall(method, receiver, args)
        : godotPackedArrayCall(method, receiver, args);
    }
  } else if (Array.isArray(receiver)) {
    if (
      method === 'has' || method === 'size' || method === 'empty' ||
      method === 'is_empty' || method === 'append' ||
      method === 'erase' || method === 'duplicate' || method === 'push_back' ||
      method === 'pop_back' || method === 'pop_front' || method === 'clear' ||
      method === 'find' || method === 'rfind' || method === 'reverse' ||
      method === 'invert' || method === 'sort' || method === 'slice' ||
      method === 'assign' || method === 'fill' || method === 'resize' ||
      method === 'bsearch' || method === 'pick_random' || method === 'shuffle' ||
      method === 'sort_custom' || method === 'is_same_typed' ||
      method === 'find_custom' || method === 'rfind_custom' ||
      method === 'map' || method === 'filter' ||
      method === 'reduce' || method === 'any' || method === 'all' ||
      method === 'min' || method === 'max'
      || method === 'get' || method === 'set' || method === 'front' || method === 'back' ||
      method === 'push_front' || method === 'append_array' || method === 'insert' ||
      method === 'remove_at' || method === 'remove' || method === 'pop_at' ||
      method === 'count' || method === 'hash' || method === 'duplicate_deep' ||
      method === 'make_read_only' || method === 'is_read_only' || method === 'is_typed' ||
      method === 'get_typed_builtin' || method === 'get_typed_class_name' ||
      method === 'get_typed_script'
    ) {
      if (method === 'erase' && args.length !== 1) {
        throw new TypeError('godot-compat: Array.erase requires exactly one argument.');
      }
      if ((method === 'assign' || method === 'is_same_typed') && !Array.isArray(args[0])) {
        throw new TypeError(`godot-compat: Array.${method} requires an Array.`);
      }
      if (method === 'get' && args.length !== 1) {
        throw new TypeError('godot-compat: Array.get requires exactly one argument.');
      }
      if (method === 'get' && godotMajor !== 4) {
        throw new TypeError('godot-compat: Array.get is not declared in Godot 3.x.');
      }
      if (method === 'get' && !Number.isSafeInteger(args[0])) {
        throw new TypeError('godot-compat: Array.get index requires int.');
      }
      if (method === 'count' && args.length !== 1) {
        throw new TypeError('godot-compat: Array.count requires exactly one argument.');
      }
      if (method === 'insert' && !Number.isSafeInteger(args[0])) {
        throw new TypeError('godot-compat: Array.insert position requires int.');
      }
      const result = godotArrayCall(method, receiver, args, random);
      return godotMajor === 3 && (method === 'resize' || method === 'insert') ? null : result;
    }
  }
  throw new TypeError(
    `godot-compat: Variant.${method} is unavailable on ${variantCarrierName(receiver)}.`,
  );
}

/**
 * Runtime Variant call door. Retained Object/ClassDB/script identity gets first refusal so authored
 * and native object methods are never constrained by a same-spelled built-in collection method.
 * Non-object carriers remain the finite built-in protocol above and unknown names stay loud.
 */
export function godotOpenVariantCall<T = unknown>(
  godotMajor: 3 | 4,
  method: string,
  receiver: unknown,
  args: readonly unknown[],
  random?: Draw,
): T;
export function godotOpenVariantCall(
  godotMajor: 3 | 4,
  method: string,
  receiver: unknown,
  args: readonly unknown[],
  random?: Draw,
): unknown {
  if (godotObjectHasBinding(receiver)) {
    return godotObjectCall(receiver, [method, ...args]);
  }
  if (!Object.hasOwn(OPEN_VARIANT_ARITIES, method)) {
    throw new TypeError(
      `godot-compat: Variant.${method} has no built-in owner on ${variantCarrierName(receiver)}.`,
    );
  }
  return godotOpenBuiltinVariantCall(
    godotMajor,
    method as OpenVariantMethod,
    receiver,
    args,
    random,
  );
}

/**
 * `String.split(delimiter)` with Godot's default `allow_empty=true, maxsplit=0`.
 *
 * The pinned 4.7 dump declares
 * `PackedStringArray split(String delimiter="", bool allow_empty=true, int maxsplit=0) const`.
 * JS `String.prototype.split` with one argument is that default: unlimited splits, empty
 * parts kept. `starter-kit-fps` `audio.gd:26` is `sound_path.split(",")`. A call that
 * passes `allow_empty` or `maxsplit` is a different function and the emitter refuses it
 * rather than approximating.
 */
export function splitString(value: string, delimiter: string): PackedStringArray {
  return packedStringArray(value.split(delimiter));
}

/**
 * `String.strip_edges()` with both sides default true.
 *
 * The pinned 4.7 dump declares `String strip_edges(bool left=true, bool right=true) const`.
 * JS `trim()` is that default. `starter-kit-fps` `audio.gd:27` is
 * `sounds[…].strip_edges()` on a comma-split path. A call that passes `left`/`right` is
 * a different function and the emitter refuses it.
 */
export function stripEdges(value: string): string {
  return value.trim();
}

/**
 * `arr.is_empty()` — Godot 4's spelling of 3.x's `Array.empty()`.
 *
 * `starter-kit-3d-platformer` `audio.gd:30` gates its pool drain on
 * `not queue.is_empty() and not available.is_empty()`. Written as its own member rather than left
 * as `size(arr) === 0` for the reason {@link distanceTo} is: one Godot idiom, one emitted shape.
 */
export function isEmpty(array: readonly unknown[]): boolean {
  return array.length === 0;
}

/**
 * `arr.pop_front()` — remove and RETURN the first element.
 *
 * starter-kit-city-builder `audio.gd:35-37` gates on `is_empty()` then uses the result as the
 * player (`player.volume_db = …`). Godot returns `null` from an empty array; this lane throws
 * instead, because every measured caller already gated and a `T | null` result made the
 * attributed `AudioStreamPlayer` unusable (`player` possibly null). A caller that did not
 * gate is a new site, not a silent null.
 */
export function popFront<T>(array: T[]): T {
  if (array.length === 0) {
    throw new Error(
      'godot-compat: Array.pop_front() on an empty array. Godot returns null; this lane throws. ' +
        'audio.gd:35 already gates on is_empty().',
    );
  }
  return array.shift() as T;
}

/** `Array.resize(size)` — preserve entries, truncate when smaller, append Godot `null` Variant
 * values when larger. JS sparse holes read as `undefined`, which Godot never stores in an Array. */
export function arrayResize<T>(array: (T | null)[], nextSize: number): void {
  const size = Math.max(0, Math.trunc(nextSize));
  if (size <= array.length) {
    array.length = size;
    return;
  }
  while (array.length < size) array.push(null);
}

/** `Array.fill(value)` — replace every existing element without changing the array's size. */
export function arrayFill<T>(array: T[], value: T): void {
  array.fill(value);
}

/** `Array.has(value)` — scalar Variants compare by value and objects by identity. */
export function arrayHas<T>(array: readonly T[], value: T): boolean {
  return array.includes(value);
}

/** `Array.erase(value)` — remove the first equal value, doing nothing when absent. */
export function arrayErase<T>(array: T[], value: T): void {
  const index = array.indexOf(value);
  if (index !== -1) array.splice(index, 1);
}

/** Godot Dictionary's identity-preserving representation. Plain JS objects collapse object keys. */
export type GodotDictionary<K = any, V = any> = Map<K, V>;

export function godotDictionary(entries: readonly (readonly [any, any])[] = []): GodotDictionary {
  return new Map(entries);
}

/**
 * Runtime `value in container` for an open Variant container.
 *
 * Godot's content operator is not JavaScript's property-key operator. Arrays search VALUES and
 * Dictionaries search KEYS with Variant equality; Strings search for a String substring. The
 * Array protocol already owns Variant equality (including nested Array/Dictionary values), so the
 * runtime-open door delegates both collection cases to that one implementation instead of
 * growing a second equality model here.
 */
export function godotVariantIn(value: unknown, container: unknown): boolean {
  if (Array.isArray(container)) {
    return godotArrayCall('has', container, [value]) as boolean;
  }
  if (container instanceof Map) {
    return godotArrayCall('has', [...container.keys()], [value]) as boolean;
  }
  if (typeof container === 'string') {
    if (typeof value !== 'string') {
      throw new TypeError(
        `godot-compat: Variant operator \`in\` requires a String left operand for a String ` +
          `container; received ${variantCarrierName(value)}.`,
      );
    }
    return container.includes(value);
  }
  throw new TypeError(
    `godot-compat: Variant operator \`in\` requires an Array, Dictionary, or String container; ` +
      `received ${variantCarrierName(container)}.`,
  );
}

export function dictionaryGet<K, V>(value: ReadonlyMap<K, V>, key: unknown): V {
  return value.get(key as K) as V;
}

export function dictionarySet<K, V>(value: Map<K, V>, key: K, next: V): void {
  value.set(key, next);
}

/** `Dictionary.keys()` — a new Array in insertion order, as Godot returns. */
export function dictionaryKeys<K>(value: ReadonlyMap<K, unknown>): K[] {
  return [...value.keys()];
}

export function dictionaryHas<K>(value: ReadonlyMap<K, unknown>, key: K): boolean {
  return value.has(key);
}

export function dictionaryErase<K>(value: Map<K, unknown>, key: K): boolean {
  return value.delete(key);
}
