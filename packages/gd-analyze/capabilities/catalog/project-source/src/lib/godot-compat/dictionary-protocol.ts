import { type GodotDictionary, godotDictionary } from './variant';
import type { RayMiss, RayResult } from './physics-space-3d';
import type { GodotRestMiss, GodotRestResult } from './physics-query-3d';

interface DictionaryMetadata {
  readonly keyBuiltin: number;
  readonly keyClass: string;
  readonly keyScript: unknown;
  readonly valueBuiltin: number;
  readonly valueClass: string;
  readonly valueScript: unknown;
  readOnly: boolean;
}
const metadata = new WeakMap<GodotDictionary, DictionaryMetadata>();
const emptyMetadata = (): DictionaryMetadata => ({
  keyBuiltin: 0,
  keyClass: '',
  keyScript: null,
  valueBuiltin: 0,
  valueClass: '',
  valueScript: null,
  readOnly: false,
});
const meta = (value: GodotDictionary): DictionaryMetadata => metadata.get(value) ?? emptyMetadata();

export function godotDictionaryNew(...args: unknown[]): GodotDictionary {
  if (args.length === 0) return godotDictionary();
  if (args.length === 1) {
    const source = args[0] as GodotDictionary;
    const result = source;
    metadata.set(result, meta(source));
    return result;
  }
  if (args.length === 7) {
    const result = godotDictionary([...(args[0] as GodotDictionary).entries()]);
    metadata.set(result, {
      keyBuiltin: Number(args[1]),
      keyClass: String(args[2]),
      keyScript: args[3],
      valueBuiltin: Number(args[4]),
      valueClass: String(args[5]),
      valueScript: args[6],
      readOnly: false,
    });
    return result;
  }
  throw new Error(`godot-compat: unsupported Dictionary constructor arity ${args.length}`);
}

function sameValue(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (depth > 64) return true;
  if (a instanceof Map && b instanceof Map)
    return (
      a.size === b.size &&
      [...a].every(([key, value]) => b.has(key) && sameValue(value, b.get(key), depth + 1))
    );
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, i) => sameValue(value, b[i], depth + 1));
  return false;
}
function clone(value: unknown, deep: boolean, depth = 0): unknown {
  if (!deep || depth > 64) return value;
  if (value instanceof Map)
    return new Map(
      [...value].map(([key, entry]) => [
        clone(key, true, depth + 1),
        clone(entry, true, depth + 1),
      ]),
    );
  if (Array.isArray(value)) return value.map((entry) => clone(entry, true, depth + 1));
  return value;
}
function copyMetadata(source: GodotDictionary, target: GodotDictionary): void {
  metadata.set(target, { ...meta(source), readOnly: false });
}
function duplicateDictionary(source: GodotDictionary, deep: boolean): GodotDictionary {
  const result = godotDictionary(
    [...source].map(([key, value]) => [clone(key, deep), clone(value, deep)]),
  );
  copyMetadata(source, result);
  return result;
}
function hash(value: unknown): number {
  const text =
    value instanceof Map
      ? JSON.stringify([...value], (_key, entry) =>
          typeof entry === 'bigint' ? entry.toString() : entry,
        )
      : JSON.stringify(value);
  let result = 2166136261;
  for (const char of text ?? '') {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}
function typedEqual(a: DictionaryMetadata, b: DictionaryMetadata, side?: 'key' | 'value'): boolean {
  const key =
    a.keyBuiltin === b.keyBuiltin && a.keyClass === b.keyClass && a.keyScript === b.keyScript;
  const value =
    a.valueBuiltin === b.valueBuiltin &&
    a.valueClass === b.valueClass &&
    a.valueScript === b.valueScript;
  return side === 'key' ? key : side === 'value' ? value : key && value;
}

function compareDictionaryKeys(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  const leftText = String(left);
  const rightText = String(right);
  if (leftText < rightText) return -1;
  if (leftText > rightText) return 1;
  return 0;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the exhaustive official Dictionary ClassDB dispatch is intentionally one auditable switch.
export function godotDictionaryCall(
  receiver: RayResult,
  method: 'empty' | 'is_empty',
  args: readonly unknown[],
): receiver is RayMiss;
export function godotDictionaryCall(
  receiver: GodotRestResult,
  method: 'empty' | 'is_empty',
  args: readonly unknown[],
): receiver is GodotRestMiss;
export function godotDictionaryCall<T = unknown>(
  receiver: GodotDictionary | RayResult | GodotRestResult,
  method: string,
  args: readonly unknown[],
): T;
export function godotDictionaryCall(
  receiver: GodotDictionary | RayResult | GodotRestResult,
  method: string,
  args: readonly unknown[],
): unknown {
  if (!(receiver instanceof Map)) {
    if (method === 'empty' || method === 'is_empty') return receiver.empty();
    throw new Error(`godot-compat: unsupported ray-result Dictionary.${method}`);
  }
  const m = meta(receiver);
  let result: unknown;
  switch (method) {
    case 'size':
      result = receiver.size;
      break;
    case 'empty':
    case 'is_empty':
      result = receiver.size === 0;
      break;
    case 'clear':
      if (!m.readOnly) receiver.clear();
      result = null;
      break;
    case 'assign':
      if (!m.readOnly) {
        receiver.clear();
        for (const [k, v] of args[0] as GodotDictionary) receiver.set(k, v);
      }
      result = null;
      break;
    case 'sort':
      if (!m.readOnly) {
        const sorted = [...receiver].sort(([a], [b]) => compareDictionaryKeys(a, b));
        receiver.clear();
        for (const entry of sorted) receiver.set(...entry);
      }
      result = null;
      break;
    case 'merge':
      if (!m.readOnly)
        for (const [k, v] of args[0] as GodotDictionary)
          if (Boolean(args[1]) || !receiver.has(k)) receiver.set(k, v);
      result = null;
      break;
    case 'merged': {
      result = duplicateDictionary(receiver, false);
      godotDictionaryCall(result as GodotDictionary, 'merge', args);
      break;
    }
    case 'has':
      result = receiver.has(args[0]);
      break;
    case 'has_all':
      result = (args[0] as unknown[]).every((key) => receiver.has(key));
      break;
    case 'find_key':
      result = [...receiver].find(([, v]) => sameValue(v, args[0]))?.[0] ?? null;
      break;
    case 'erase':
      result = !m.readOnly && receiver.delete(args[0]);
      break;
    case 'hash':
      result = hash(receiver);
      break;
    case 'keys':
      result = [...receiver.keys()];
      break;
    case 'values':
      result = [...receiver.values()];
      break;
    case 'duplicate':
      result = duplicateDictionary(receiver, Boolean(args[0]));
      break;
    case 'duplicate_deep':
      result = duplicateDictionary(receiver, true);
      break;
    case 'get':
      result = receiver.has(args[0]) ? receiver.get(args[0]) : (args[1] ?? null);
      break;
    case 'get_or_add':
      if (receiver.has(args[0])) result = receiver.get(args[0]);
      else {
        result = args[1] ?? null;
        if (!m.readOnly) receiver.set(args[0], result);
      }
      break;
    case 'set':
      if (m.readOnly) result = false;
      else {
        receiver.set(args[0], args[1]);
        result = true;
      }
      break;
    case 'is_typed':
      result = m.keyBuiltin !== 0 || m.valueBuiltin !== 0;
      break;
    case 'is_typed_key':
      result = m.keyBuiltin !== 0;
      break;
    case 'is_typed_value':
      result = m.valueBuiltin !== 0;
      break;
    case 'is_same_typed':
      result = typedEqual(m, meta(args[0] as GodotDictionary));
      break;
    case 'is_same_typed_key':
      result = typedEqual(m, meta(args[0] as GodotDictionary), 'key');
      break;
    case 'is_same_typed_value':
      result = typedEqual(m, meta(args[0] as GodotDictionary), 'value');
      break;
    case 'get_typed_key_builtin':
      result = m.keyBuiltin;
      break;
    case 'get_typed_value_builtin':
      result = m.valueBuiltin;
      break;
    case 'get_typed_key_class_name':
      result = m.keyClass;
      break;
    case 'get_typed_value_class_name':
      result = m.valueClass;
      break;
    case 'get_typed_key_script':
      result = m.keyScript;
      break;
    case 'get_typed_value_script':
      result = m.valueScript;
      break;
    case 'make_read_only':
      m.readOnly = true;
      metadata.set(receiver, m);
      result = null;
      break;
    case 'is_read_only':
      result = m.readOnly;
      break;
    case 'recursive_equal':
      result = sameValue(receiver, args[0], Number(args[1]));
      break;
    default:
      throw new Error(`godot-compat: unsupported Dictionary.${method}`);
  }
  return result;
}

export function godotDictionaryOperator(
  operator: string,
  left: GodotDictionary,
  right: unknown,
): unknown {
  switch (operator) {
    case '==':
      return right instanceof Map && sameValue(left, right);
    case '!=':
      return !(right instanceof Map && sameValue(left, right));
    case 'not':
      return left.size === 0;
    case 'in':
      if (Array.isArray(right)) return right.some((entry) => sameValue(left, entry));
      if (right instanceof Map) return [...right.keys()].some((entry) => sameValue(left, entry));
      return false;
    default:
      throw new Error(`godot-compat: unsupported Dictionary operator ${operator}`);
  }
}
